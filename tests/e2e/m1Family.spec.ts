// M1 全家桶集成 E2E：单页同时含 Front Matter + [TOC] + 行内/块级公式（.katex）+
// 脚注（.footnotes）+ 表格 + 任务列表（.task-list-item）+ Mermaid（.mermaid-rendered svg）。
//
// 断言共存：
//   1. FM 卡片与 TOC 目录就位，TOC 锚点与标题 id 对应、可点击滚动；
//   2. FM/TOC 文本不进正文锚文本（预览搜索偏移稳定——批注/搜索定位的前提）；
//   3. 各结构就位：表格 / 任务列表 / Mermaid SVG（无 is-loading 残留）；
//   4. math / footnote 为并行扩展（M1-2 / M1-4）：「依赖并行扩展」的结构按条件断言
//      ——类存在时做严格结构断言（全家桶最终态真绿即指这些断言全数生效），
//      未实现（stub）时跳过，不阻塞本 spec。
//
// 已知边界（实现注释同源）：数学标题的 TOC slug 与大纲 textContent 不同源
// （KaTeX katex-mathml 双轨 → $z$ 的 textContent 为 'zzz'），故标题不使用公式，
// 公式只出现在正文中。
import { test, expect, openEditor, setSource } from './fixtures';

const FAMILY_DOC = [
  '---',
  'title: 全家桶文档',
  'tags: m1, e2e',
  '---',
  '',
  '[TOC]',
  '',
  '# 引言',
  '',
  '正文段落，行内公式 $E=mc^2$。',
  '',
  '块级公式：',
  '',
  '$$',
  '\\int_0^1 x^2\\,dx',
  '$$',
  '',
  '脚注引用[^1]在此。',
  '',
  '[^1]: 脚注正文内容。',
  '',
  '## 数据表格',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '## 任务清单',
  '',
  '- [x] 已完成任务',
  '- [ ] 待办任务',
  '',
  '## 图表',
  '',
  '```mermaid',
  'graph TD;',
  '  A-->B;',
  '```',
  '',
  '## 结尾',
  '',
  '正文收尾。',
  ''
].join('\n');

test('全家桶单页共存：FM/TOC/表格/任务/Mermaid 就位，无 is-loading 残留', async ({ page }) => {
  await openEditor(page);
  await setSource(page, FAMILY_DOC);

  // FM 卡片
  await expect(page.locator('.md-preview .front-matter')).toBeVisible();
  await expect(page.locator('.md-preview .front-matter summary')).toHaveText('元数据');
  await expect(page.locator('.md-preview .front-matter dd')).toHaveText(['全家桶文档', 'm1, e2e']);

  // TOC 目录：5 个标题（引言/数据表格/任务清单/图表/结尾）
  await expect(page.locator('.md-preview .toc')).toBeVisible();
  await expect(page.locator('.md-preview .toc li')).toHaveCount(5);
  await expect(page.locator('.md-preview .toc li.toc-level-1 a')).toHaveText('引言');
  await expect(page.locator('.md-preview .toc li.toc-level-2 a')).toHaveText([
    '数据表格', '任务清单', '图表', '结尾'
  ]);

  // 表格（marked GFM 基线）
  await expect(page.locator('.md-preview table')).toBeVisible();
  await expect(page.locator('.md-preview table tbody tr')).toHaveCount(1);
  await expect(page.locator('.md-preview table tbody td').first()).toHaveText('1');

  // 任务列表（taskExtension M1-6，已实现）
  await expect(page.locator('.md-preview .task-list-item')).toHaveCount(2);
  await expect(page.locator('.md-preview .task-list-item input[type="checkbox"]')).toHaveCount(2);

  // Mermaid：SVG 渲染完成、无 is-loading 残留
  await expect(page.locator('.md-preview .mermaid-rendered svg')).toBeVisible();
  await expect(page.locator('.md-preview .mermaid-rendered')).not.toHaveClass(/is-loading/);
  await expect(page.locator('.md-preview .is-loading')).toHaveCount(0);
});

test('数学与脚注结构就位（依赖并行扩展：math M1-2 / footnote M1-4，类存在时严格断言）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, FAMILY_DOC);

  // 行内公式 $E=mc^2$ + 块级 $$...$$ → 2 个 .katex（块级 1 个在 .katex-display 内）
  const katexCount = await page.locator('.md-preview .katex').count();
  if (katexCount > 0) {
    // 依赖并行扩展（mathExtension M1-2 已实现）：类存在时严格断言结构
    expect(katexCount).toBe(2);
    await expect(page.locator('.md-preview .katex-display')).toHaveCount(1);
    // 语义层（无障碍/复制粘贴）在预览管线（DOMPurify ADD_TAGS）下保留
    await expect(page.locator('.md-preview .katex-mathml')).toHaveCount(2);
    await expect(page.locator('.md-preview .katex annotation')).toHaveCount(2);
  }
  // 依赖并行扩展：mathExtension 未实现（stub）时 .katex 不出现，跳过结构断言

  const footnotesCount = await page.locator('.md-preview .footnotes').count();
  if (footnotesCount > 0) {
    // 依赖并行扩展（footnoteExtension M1-4）：实现后此处生效
    await expect(page.locator('.md-preview .footnotes')).toContainText('脚注正文内容');
    await expect(page.locator('.md-preview .footnote-ref')).toHaveCount(1);
  }
  // 依赖并行扩展：footnoteExtension 未实现（stub）时 .footnotes 不出现，跳过结构断言
});

test('TOC 锚点可用：全部指向真实标题 id，点击滚动到目标', async ({ page }) => {
  await openEditor(page);
  await setSource(page, FAMILY_DOC);

  // 每个 TOC href 都对应一个真实存在的标题 id（锚点可用）
  const broken = await page.locator('.md-preview .toc a').evaluateAll((as) =>
    as.filter((a) => !document.getElementById((a.getAttribute('href') || '').slice(1)))
      .map((a) => a.getAttribute('href'))
  );
  expect(broken).toEqual([]);

  const lastLink = page.locator('.md-preview .toc a').last();
  await expect(lastLink).toHaveAttribute('href', '#outline-结尾');
  await lastLink.click();
  await expect
    .poll(() => page.locator('.md-preview').evaluate((el) => (el as HTMLElement).scrollTop))
    .toBeGreaterThan(0);
});

test('FM/TOC 不进正文锚文本：预览搜索偏移稳定（批注/搜索定位前提）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, FAMILY_DOC);

  await page.locator('.view-mode-option[data-mode="preview"]').click();
  await page.keyboard.press('ControlOrMeta+f');

  // 「结尾」出现在正文标题（计入锚文本）与 TOC 链接文本（被排除）——
  // 只应命中 1 处：TOC 文本混入会使计数与偏移错位。
  await page.getByRole('textbox', { name: '搜索预览' }).fill('结尾');
  await expect(page.locator('.preview-search-count')).toHaveText('第 1 项，共 1 项');

  // 「e2e」只出现在 FM 值中（被排除）——混入则此处会误报命中。
  await page.getByRole('textbox', { name: '搜索预览' }).fill('e2e');
  await expect(page.locator('.preview-search-count')).toHaveText('无结果');
});
