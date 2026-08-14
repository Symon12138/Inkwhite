import { test, expect, openEditor, setSource } from './fixtures';

// M3 编辑体验全链路（浏览器路径）：
// 粘贴 HTML→Markdown、粘贴图片→data URL 引用、表格工具栏编辑+撤销、
// spellcheck 属性、复制为 HTML。

test('粘贴 HTML 转为 Markdown 插入光标处', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '开头\n\n结尾');
  await page.locator('.md-source').focus();

  await page.evaluate(() => {
    const src = document.querySelector('.md-source') as HTMLTextAreaElement;
    src.setSelectionRange(3, 3); // 「开头\n\n结尾」中第一个换行后
    const dt = new DataTransfer();
    dt.setData('text/html', '<h2>小标题</h2><p><strong>粗体</strong> 与 <a href="https://x.com">链接</a></p>');
    dt.setData('text/plain', '小标题 粗体 与 链接');
    src.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('.md-source')).toHaveValue(/^开头\n## 小标题\n\n\*\*粗体\*\* 与 \[链接\]\(https:\/\/x\.com\)\n结尾$/);
  // 预览同步渲染出 h2 与粗体
  await expect(page.locator('.md-preview h2')).toHaveText('小标题');
});

test('粘贴图片文件插入 data URL 引用（浏览器内联策略）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '正文\n');
  await page.locator('.md-source').focus();

  // 1x1 PNG
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.evaluate((b64) => {
    const src = document.querySelector('.md-source') as HTMLTextAreaElement;
    src.setSelectionRange(3, 3);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'paste.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    src.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, pngBase64);

  await expect(page.locator('.md-source')).toHaveValue(/正文\n!\[paste\]\(data:image\/png;base64,/);
  // 预览渲染出图片
  await expect(page.locator('.md-preview img[src^="data:image/png"]')).toBeVisible();
});

test('表格工具栏：点击表格出现工具条，插入行可撤销', async ({ page }) => {
  await openEditor(page);
  await setSource(page, ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
  await expect(page.locator('.md-preview table')).toBeVisible();

  // 点击表格第二行第一列单元格
  await page.locator('.md-preview table tbody tr').nth(0).locator('td').nth(0).click();
  await expect(page.locator('.table-toolbar')).toBeVisible();

  await page.locator('.table-toolbar-btn[data-action="row-below"]').click();
  await expect(page.locator('.md-source')).toHaveValue([
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 1 | 2 |'
  ].join('\n'));
  // 预览同步
  await expect(page.locator('.md-preview table tbody tr')).toHaveCount(2);

  // 可撤销
  await page.keyboard.press('Control+z');
  await expect(page.locator('.md-source')).toHaveValue(['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
});

test('表格工具栏：改对齐与删列', async ({ page }) => {
  await openEditor(page);
  await setSource(page, ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
  await page.locator('.md-preview table tbody tr').nth(0).locator('td').nth(0).click();
  await page.locator('.table-toolbar-btn[data-action="align-center"]').click();
  await expect(page.locator('.md-source')).toHaveValue(['| a | b |', '| :---: | --- |', '| 1 | 2 |'].join('\n'));

  await page.locator('.md-preview table tbody tr').nth(0).locator('td').nth(1).click();
  await page.locator('.table-toolbar-btn[data-action="del-col"]').click();
  await expect(page.locator('.md-source')).toHaveValue(['| a |', '| :---: |', '| 1 |'].join('\n'));
});

test('spellcheck 属性默认开启（B21 设置接线）', async ({ page }) => {
  await openEditor(page);
  const spellcheck = await page.locator('.md-source').getAttribute('spellcheck');
  expect(spellcheck).toBe('true');
});

test('复制为 HTML：选中预览文字后按钮产出安全 HTML 载荷', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 标题\n\n段落 <script>alert(1)</script>');
  await expect(page.locator('.md-preview h1')).toHaveText('标题');

  // 桩掉 navigator.clipboard.write 捕获载荷（clipboard 为只读属性，须 defineProperty）
  await page.evaluate(() => {
    (window as any).__copiedPayload = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          (window as any).__copiedPayload = items;
        }
      }
    });
  });

  // 真实鼠标拖选预览段落（程序化 selection 不触发选择工具条）
  const para = page.locator('.md-preview p').first();
  await para.scrollIntoViewIfNeeded();
  const box = await para.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 4, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator('.selection-toolbar')).toBeVisible();
  await page.locator('.selection-toolbar button[title="复制为带格式 HTML"]').click();
  // 点击后立即读状态（自动保存定时器可能随后覆盖）
  const afterClick = await page.locator('.save-status').textContent();
  console.log('AFTER CLICK STATUS:', afterClick);
  await expect.poll(() => page.evaluate(() => !!window.__copiedPayload)).toBe(true);

  const payload = await page.evaluate(async () => {
    const items = (window as any).__copiedPayload as ClipboardItem[];
    const htmlBlob = await items[0].getType('text/html');
    return await htmlBlob.text();
  });
  expect(payload).not.toMatch(/<script/i);
  expect(payload).not.toMatch(/on\w+=/i);
});
