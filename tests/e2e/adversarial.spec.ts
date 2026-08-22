import { test, expect, openEditor, setSource } from './fixtures';

// 对抗性验证：主动攻击渲染管线、存储层与启动路径。
// 判定基准：无脚本执行（__pwned）、无对话框、无危险元素、应用始终可用。

const PWNED_CHECK = '!window.__pwned';

async function armTripwires(page): Promise<void> {
  await page.addInitScript(() => {
    window.__pwned = false;
    window.__dialogFired = false;
    window.addEventListener('dialog', () => { window.__dialogFired = true; });
  });
  page.on('dialog', (d) => {
    void page.evaluate(() => { window.__dialogFired = true; }).catch(() => {});
    void d.dismiss();
  });
}

async function expectNoCompromise(page) {
  const state = await page.evaluate(() => ({
    pwned: window.__pwned,
    dialog: window.__dialogFired,
    scripts: document.querySelectorAll('.md-preview script, .md-preview iframe, .md-preview object, .md-preview embed, .md-preview form').length,
    badHrefs: [...document.querySelectorAll('.md-preview a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => /^\s*(javascript|vbscript|data:text\/html)/i.test(h || '')),
    badImgs: [...document.querySelectorAll('.md-preview img')]
      .map((i) => i.getAttribute('src'))
      .filter((s) => /^\s*javascript/i.test(s || ''))
  }));
  expect(state.pwned, '不得发生脚本执行').toBeFalsy();
  expect(state.dialog, '不得触发原生对话框').toBeFalsy();
  expect(state.scripts, '预览内不得残留 script/iframe/object/embed/form').toBe(0);
  expect(state.badHrefs, '链接 href 不得为可执行协议').toEqual([]);
  expect(state.badImgs, '图片 src 不得为可执行协议').toEqual([]);
}

test('XSS 弹药库：经典注入全部被净化', async ({ page }) => {
  await armTripwires(page);
  await openEditor(page);
  const payloads = [
    '<script>window.__pwned = true</script>',
    '<img src=x onerror="window.__pwned = true">',
    '<svg onload="window.__pwned = true">',
    '<iframe src="javascript:window.__pwned = true"></iframe>',
    '<object data="javascript:window.__pwned = true"></object>',
    '<embed src="javascript:window.__pwned = true">',
    '[click](javascript:window.__pwned = true)',
    '[click](jAvaScRiPt:window.__pwned = true)',
    '[click](  javascript:window.__pwned = true)',
    '[img](javascript:window.__pwned = true)',
    '<a href="javascript:window.__pwned = true">raw anchor</a>',
    '<a href="JAVASCRIPT:window.__pwned = true">upper anchor</a>',
    '<div onclick="window.__pwned = true">raw onclick</div>',
    '<form action="javascript:window.__pwned = true"><button>go</button></form>',
    '<style>@import url("javascript:window.__pwned = true");</style>',
    '<details open ontoggle="window.__pwned = true">x</details>'
  ];
  await setSource(page, '# XSS 弹药库\n\n' + payloads.join('\n\n'));
  await page.waitForTimeout(600);
  await expectNoCompromise(page);
});

test('mXSS 探针：利用 ADD_TAGS 放行的 MathML 标签构造变异注入', async ({ page }) => {
  await armTripwires(page);
  await openEditor(page);
  // 经典 mXSS 链：注释/样式节点在重新序列化时变异为 img onerror
  const mxss = [
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=1 onerror=window.__pwned=true>">',
    '<semantics><annotation encoding="application/x-tex"><img src=1 onerror="window.__pwned = true"></annotation></semantics>',
    '<annotation encoding="text/html"><script>window.__pwned = true</script></annotation>',
    '<noscript><p title="</noscript><img src=x onerror=window.__pwned=true>">'
  ].join('\n\n');
  await setSource(page, '# mXSS\n\n' + mxss);
  await page.waitForTimeout(600);
  await expectNoCompromise(page);
});

test('结构炸弹：深层嵌套与超长列表不冻结页面', async ({ page }) => {
  await armTripwires(page);
  await openEditor(page);
  const deep = Array.from({ length: 200 }, () => '>').join(' ') + ' 核心文本';
  const longList = Array.from({ length: 5000 }, (_, i) => '- 条目 ' + i).join('\n');
  const t0 = Date.now();
  // evaluate 直写 + 手动派发 input（等同粘贴注入；fill 聚焦 15 万字中文会触发拼写检查风暴）
  await page.locator('.md-source').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, '# 炸弹\n\n' + deep + '\n\n' + longList); // 完整炸弹：解除器应保证存活
  await page.waitForTimeout(1500);
  const responsive = await page.evaluate(() => { 1 + 1; return true; });
  expect(responsive).toBe(true);
  expect(Date.now() - t0).toBeLessThan(30000);
  await expectNoCompromise(page);
});

test('巨型单 token（1MB 无空格）不拖垮渲染', async ({ page }) => {
  await armTripwires(page);
  await openEditor(page);
  await setSource(page, '# 巨型 token\n\n' + 'A'.repeat(1024 * 1024));
  await page.waitForTimeout(1200);
  const ok = await page.evaluate(() => !!document.querySelector('.md-preview h1'));
  expect(ok).toBe(true);
});

test('投毒启动：所有存储键灌入敌意数据后应用必须存活', async ({ page }) => {
  await armTripwires(page);
  await page.goto('/#editor');
  await page.evaluate(() => {
    localStorage.setItem('md-editor-warm-v1', JSON.stringify({ content: 123, fontSize: 'huge', theme: [], comments: 'not-array', viewMode: 'attack' }));
    localStorage.setItem('md-editor-tabs-v1', '"just a plain string"');
    localStorage.setItem('md-editor-read-pos-v1', JSON.stringify({
      'a.md': { top: -99999, ts: 1 },
      'b.md': { top: 1e308, ts: 2 },
      '__proto__': { polluted: true },
      'c.md': 'not-an-object'
    }));
    localStorage.setItem('md-editor-settings-v1', '{ broken json at all');
    localStorage.setItem('md-editor-search-opts', '[1,2,3]');
    localStorage.setItem('md-editor-recent-documents', JSON.stringify({ recent: [{ title: '<img src=x onerror="window.__pwned = true">', path: 'x' }] }));
    localStorage.setItem('md-editor-window-state', 'null');
  });
  await page.reload();
  await page.waitForTimeout(1200);
  // 应用存活：预览正常渲染、源码区在分屏下可见
  await expect(page.locator('.md-preview h1').first()).toBeVisible({ timeout: 20000 });
  await expectNoCompromise(page);
  // 敌意 recent 标题不得注入真实元素
  const injected = await page.locator('.menubar img[src="x"], .document-sidebar img[src="x"]').count();
  expect(injected).toBe(0);
});

test('敌意标签标题（HTML 注入标签栏）被转义呈现', async ({ page }) => {
  await armTripwires(page);
  await page.goto('/#editor');
  await page.evaluate(() => {
    localStorage.setItem('md-editor-tabs-v1', JSON.stringify({
      activeId: 't1',
      tabs: [
        { id: 't1', title: '<img src=x onerror="window.__pwned = true">', content: '# 敌意标题', fileName: 'evil.md', filePath: '', comments: [], dirty: false, createdAt: 1 },
        { id: 't2', title: '普通标签.md', content: '# 普通', fileName: 'normal.md', filePath: '', comments: [], dirty: false, createdAt: 2 }
      ]
    }));
  });
  await page.reload();
  await page.waitForTimeout(1200);
  await expectNoCompromise(page);
  const tabImgs = await page.locator('.tab-bar img').count();
  expect(tabImgs, '标签栏不得出现被注入的 img 元素').toBe(0);
  await expect(page.locator('.tab-bar')).toContainText('<img src=x');
});

test('阅读位置映射原型污染与异常值安全', async ({ page }) => {
  await armTripwires(page);
  await openEditor(page);
  await page.evaluate(() => {
    localStorage.setItem('md-editor-read-pos-v1', JSON.stringify({
      '__proto__': { polluted: true },
      'constructor': { top: 5, ts: 1 },
      'x.md': { top: 'not-a-number', ts: 2 }
    }));
  });
  await setSource(page, '# 污染测试\n\n正文');
  await page.locator('.md-preview').evaluate((el) => { el.scrollTop = 300; });
  await page.waitForTimeout(700); // 越过防抖
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), 'md-editor-read-pos-v1');
  expect(typeof stored).toBe('object');
  await page.reload();
  await page.waitForTimeout(800);
  const protoOk = await page.evaluate(() => !({}).polluted && !window.__pwned);
  expect(protoOk, '原型不得被污染').toBe(true);
});