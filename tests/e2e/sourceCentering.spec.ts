import { test, expect, openEditor, clickMenubarItem } from './fixtures';

// 源码栏与预览一致：版心居中存在上限，避免编辑视图下正文贴左显得突兀。
// 硬约束：搜索高亮层绝对覆盖在 textarea 上，两者必须逐像素对齐，否则搜索标记错位。
test('源码栏版心居中：上限与预览一致，且高亮层与文本框对齐', async ({ page }) => {
  await openEditor(page); // 分屏：此时预览可见，取它的版心上限作基准
  await page.setViewportSize({ width: 1600, height: 900 });
  const previewMaxWidth = await page
    .locator('.md-preview > *')
    .first()
    .evaluate((el) => getComputedStyle(el).maxWidth);

  // 编辑视图：源码栏独占整宽，居中与否肉眼可辨
  await clickMenubarItem(page, 'view', '编辑视图');
  await expect(page.locator('.editor-main')).toHaveClass(/editor-mode-active/);

  const result = await page.evaluate(() => {
    const area = document.querySelector('.source-editor-area') as HTMLElement;
    const source = document.querySelector('.md-source') as HTMLTextAreaElement;
    const layer = document.querySelector('.source-highlight-layer') as HTMLElement;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, width: r.width, right: r.right };
    };
    return {
      sourceMaxWidth: getComputedStyle(source).maxWidth,
      source: rect(source),
      layer: rect(layer),
      area: rect(area)
    };
  });

  // 1) 与预览同一版心上限（同源、不各写一个数）
  expect(result.sourceMaxWidth).toBe(previewMaxWidth);
  expect(result.sourceMaxWidth).not.toBe('none');

  // 2) 确实居中：左右留白基本相等，且确有留白
  const leftGap = result.source.left - result.area.left;
  const rightGap = result.area.right - result.source.right;
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
  expect(leftGap).toBeGreaterThan(100);

  // 3) 高亮层与文本框对齐（搜索标记不许错位）
  expect(Math.abs(result.layer.left - result.source.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.layer.width - result.source.width)).toBeLessThanOrEqual(1);
});
