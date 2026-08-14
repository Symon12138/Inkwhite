import { test, expect, openEditor, setSource } from './fixtures';

// Mermaid 渲染回归（S0.0）：批次守卫 bug 曾导致 SVG 永不注入预览。
test('Mermaid 代码块渲染为 SVG 并移除加载态', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '```mermaid\ngraph TD;\n  A-->B;\n```');

  await expect(page.locator('.mermaid-rendered svg')).toBeVisible();
  await expect(page.locator('.mermaid-rendered')).not.toHaveClass(/is-loading/);
});

test('无 language 标签的 Mermaid 围栏块也能被识别渲染', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '```\ngraph TD;\n  A-->B;\n```');

  await expect(page.locator('.mermaid-rendered svg')).toBeVisible();
});

test('非法 Mermaid 源码显示错误态而不是一直加载', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '```mermaid\nthis is not a diagram\n```');

  await expect(page.locator('.mermaid-rendered.has-error')).toBeVisible();
});
