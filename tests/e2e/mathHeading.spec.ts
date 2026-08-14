import { test, expect, openEditor, setSource } from './fixtures';

// M1 已知边界修复：数学标题的 TOC 锚点必须与大纲 id 同源。
// 背景：_renderOutline 曾用 heading.textContent 生成 slug，KaTeX 双轨
// （mathml + annotation + html）使文本重复（`# $z$` → 'zzz'），而 TOC 扩展
// 剥 `$..$` 得 'z'——锚点错位。修复：_renderOutline 改用 bodyText（排除
// .katex-mathml），两侧同源。

test('数学标题：TOC 锚点与大纲 id 一致且可跳转', async ({ page }) => {
  await openEditor(page);
  // 内容加长到预览容器真实可滚动：点击 TOC 后标题应滚到视口顶部附近。
  // （此前内容过短时 scrollHeight==clientHeight，滚动无从发生，
  //   断言依赖 header 高度 <300px 的侥幸；header 加高后暴露。）
  const longBody = Array.from({ length: 40 }, (_, i) => `段落 ${i + 1}：这是一段足够长的正文内容，用来撑高预览。`).join('\n\n');
  await setSource(page, `[TOC]\n\n# 面积 $x^2$\n\n${longBody}`);

  // TOC 锚点集合 == 标题 id 集合（含数学标题）
  const ids = await page.evaluate(() => {
    const toc = document.querySelector('.md-preview .toc');
    const heading = document.querySelector('.md-preview h1');
    return {
      tocHrefs: Array.from(toc?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href')),
      headingId: heading?.id ?? null
    };
  });
  expect(ids.headingId).not.toBeNull();
  expect(ids.tocHrefs).toContain('#' + ids.headingId);

  // 点击 TOC 条目滚动到标题（平滑滚动是动画，轮询等待落定，避免负载高时误报）
  await page.locator('.md-preview .toc a').first().click();
  await expect
    .poll(() =>
      page.locator('.md-preview h1').evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.top < 300;
      })
    )
    .toBe(true);
});

test('行内语法标题（上标/高亮）的 TOC 锚点同样一致', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '[TOC]\n\n# 面积 x^2^ 与 ==重点==\n\n正文');

  const ids = await page.evaluate(() => {
    const toc = document.querySelector('.md-preview .toc');
    const heading = document.querySelector('.md-preview h1');
    return {
      tocHrefs: Array.from(toc?.querySelectorAll('a') ?? []).map((a) => a.getAttribute('href')),
      headingId: heading?.id ?? null
    };
  });
  expect(ids.headingId).not.toBeNull();
  expect(ids.tocHrefs).toContain('#' + ids.headingId);
});
