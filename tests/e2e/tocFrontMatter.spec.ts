// M1-5：[TOC] + Front Matter 端到端（真实浏览器 + 真实预览管线）。
//
// 断言的是用户可见行为：
//   1. FM 卡片（details/summary + 键值行）与 [TOC] 目录（层级条目）同页渲染；
//   2. TOC 锚点与大纲（_renderOutline）id 集合一致——含行内语法标题的 slug 同源
//      （^..^ 上标 / ==..== 高亮渲染后的 DOM 文本与 TOC 剥内文本归一一致）；
//      「依赖并行扩展」：inlineSyntax（M1-4）已实现；数学（M1-2）的 KaTeX 输出
//      含 katex-mathml 双轨，heading.textContent 为「数学源+语义+视觉」拼接
//      （$z$ → 'zzz'），与 TOC 的剥 $..$ 取内文本（'z'）不同源——属已记录的
//      已知边界，数学标题不参与 id 集合一致性断言（见实现注释）；
//   3. 引用/列表内 [TOC] 保持字面文本（不渲染目录）；
//   4. FM 负例（--- 单行 / 未闭合 / 无 key:value / 非首行）回落 hr + setext 基线；
//   5. FM 内 <script> 恶意值转义为文本、不执行；
//   6. FM/TOC 文本不进正文锚文本（预览搜索偏移稳定）；
//   7. TOC 锚点可点击并滚动到目标标题。
import { test, expect, openEditor, setSource } from './fixtures';

test('Front Matter 卡片与 [TOC] 目录同页渲染', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '---',
    'title: 我的文档',
    'tags: a, b',
    '---',
    '',
    '[TOC]',
    '',
    '# 一、简介',
    '',
    '## 1.1 背景',
    '',
    '正文内容。',
    ''
  ].join('\n'));

  // FM 卡片：details/summary + dl 键值行
  await expect(page.locator('.md-preview .front-matter')).toBeVisible();
  await expect(page.locator('.md-preview .front-matter summary')).toHaveText('元数据');
  await expect(page.locator('.md-preview .front-matter dt')).toHaveText(['title', 'tags']);
  await expect(page.locator('.md-preview .front-matter dd')).toHaveText(['我的文档', 'a, b']);

  // TOC 目录：条目 = 各级标题，层级缩进类就位
  await expect(page.locator('.md-preview .toc')).toBeVisible();
  await expect(page.locator('.md-preview .toc li')).toHaveCount(2);
  await expect(page.locator('.md-preview .toc li.toc-level-1 a')).toHaveText('一、简介');
  await expect(page.locator('.md-preview .toc li.toc-level-2 a')).toHaveText('1.1 背景');
  await expect(page.locator('.md-preview .toc a[href="#outline-一简介"]')).toHaveCount(1);
  await expect(page.locator('.md-preview .toc a[href="#outline-11-背景"]')).toHaveCount(1);

  // FM 块整体消费，正文照常渲染
  await expect(page.locator('.md-preview h1')).toHaveText('一、简介');
  await expect(page.locator('.md-preview p')).toContainText('正文内容');
});

test('TOC 锚点与大纲 id 集合一致（含行内语法标题的 slug 同源）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '[TOC]',
    '',
    '# 一、总览',
    '',
    '# x^2^ 公式',
    '',
    '# ==重点==',
    '',
    '## 二、细节',
    '',
    '### 三、补充',
    ''
  ].join('\n'));

  // _renderOutline 在预览渲染后同步写入 heading.id；TOC href 与其逐项一致。
  // 行内语法标题：x^2^ → <sup>2</sup>（textContent 'x2 公式'）；==重点== →
  // <mark>重点</mark>（textContent '重点'）——TOC 侧剥取内文本后同源。
  const hrefs = await page
    .locator('.md-preview .toc a')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const ids = await page
    .locator('.md-preview h1, .md-preview h2, .md-preview h3, .md-preview h4, .md-preview h5, .md-preview h6')
    .evaluateAll((hs) => hs.map((h) => h.id));
  expect(hrefs.length).toBe(ids.length);
  expect(hrefs.map((h) => (h ?? '').replace(/^#/, '')).sort()).toEqual([...ids].sort());

  // 逐项抽查（与 outlineSlug 归一一致）
  await expect(page.locator('.md-preview .toc a[href="#outline-x2-公式"]')).toHaveCount(1);
  await expect(page.locator('.md-preview .toc a[href="#outline-重点"]')).toHaveCount(1);
  await expect(page.locator('.md-preview .toc a[href="#outline-二细节"]')).toHaveCount(1);
  await expect(page.locator('.md-preview .toc a[href="#outline-三补充"]')).toHaveCount(1);
});

test('引用/列表内的 [TOC] 保持字面文本，不渲染目录', async ({ page }) => {
  await openEditor(page);
  await setSource(page, ['> [TOC]', '', '- [TOC]', '', '> - [TOC]', ''].join('\n'));

  await expect(page.locator('.md-preview .toc')).toHaveCount(0);
  await expect(page.locator('.md-preview blockquote p').first()).toHaveText('[TOC]');
  await expect(page.locator('.md-preview blockquote ul li').first()).toHaveText('[TOC]');
  await expect(page.locator('.md-preview ul > li').first()).toHaveText('[TOC]');
});

test('FM 负例回落无扩展基线（hr + setext，不出现卡片）', async ({ page }) => {
  await openEditor(page);
  // --- 单行 → hr
  await setSource(page, '---\n\n正文。');
  await expect(page.locator('.md-preview .front-matter')).toHaveCount(0);
  await expect(page.locator('.md-preview hr')).toHaveCount(1);

  // 未闭合 → hr + 段落
  await setSource(page, '---\ntitle: x\n\n正文。');
  await expect(page.locator('.md-preview .front-matter')).toHaveCount(0);
  await expect(page.locator('.md-preview hr')).toHaveCount(1);

  // 无 key:value → hr + setext h2
  await setSource(page, '---\njust prose\n---');
  await expect(page.locator('.md-preview .front-matter')).toHaveCount(0);
  await expect(page.locator('.md-preview h2')).toHaveText('just prose');

  // 非首行不受影响 → hr + setext h2
  await setSource(page, '正文\n\n---\ntitle: x\n---');
  await expect(page.locator('.md-preview .front-matter')).toHaveCount(0);
  await expect(page.locator('.md-preview h2')).toHaveText('title: x');
});

test('FM 内 <script> 恶意值被转义为文本，不执行', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '---',
    'title: <script>window.__fmXss = 1</script>',
    '---',
    '',
    '# H',
    ''
  ].join('\n'));

  await expect(page.locator('.md-preview .front-matter dd')).toHaveText(
    '<script>window.__fmXss = 1</script>'
  );
  const xss = await page.evaluate(() => (window as { __fmXss?: number }).__fmXss ?? 0);
  expect(xss).toBe(0);
});

test('FM 与 TOC 文本不进正文锚文本（预览搜索偏移稳定）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '---',
    'title: 目标词',
    '---',
    '',
    '[TOC]',
    '',
    '# 标题',
    '',
    '正文含 目标词 一处。',
    ''
  ].join('\n'));

  await page.locator('.view-mode-option[data-mode="preview"]').click();
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('textbox', { name: '搜索预览' }).fill('目标词');
  // FM title 与 TOC 链接文本均被 bodyText 排除——只有正文一处命中；
  // 若卡片/目录文本混入锚文本，偏移会被污染（批注/搜索定位错位）。
  await expect(page.locator('.preview-search-count')).toHaveText('第 1 项，共 1 项');
});

test('TOC 锚点可点击并滚动到目标标题', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '[TOC]',
    '',
    '# 一',
    '',
    '内容一。',
    '',
    '## 二',
    '',
    '内容二。',
    '',
    '### 三',
    '',
    '内容三。',
    '',
    '### 四',
    '',
    '内容四。',
    '',
    '### 五',
    '',
    '内容五。',
    ''
  ].join('\n'));

  const lastLink = page.locator('.md-preview .toc a').last();
  await expect(lastLink).toHaveAttribute('href', '#outline-五');
  await lastLink.click();
  // 预览容器（.md-preview）平滑滚动到目标标题（_openPreviewLink 的 # 链接处理）
  await expect
    .poll(() => page.locator('.md-preview').evaluate((el) => (el as HTMLElement).scrollTop))
    .toBeGreaterThan(0);
});
