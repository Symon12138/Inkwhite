import { test, expect, openEditor } from './fixtures';

test('界面字号同步顶部底部，正文一套字号独立控制双端', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.app-footer .font-controls')).toHaveCount(1);
  await expect(page.locator('.md-source')).toHaveCSS('font-family', await page.locator('.md-preview').evaluate(el => getComputedStyle(el).fontFamily));
  await page.locator('[data-menubar-trigger="theme"]').click();
  await page.getByRole('menuitem', { name: '设置…', exact: true }).click();
  await page.getByRole('combobox', { name: '界面字号' }).selectOption('24');
  await page.keyboard.press('Escape');
  for (const selector of ['.menubar-trigger', '.save-status', '.word-count', '.font-controls-label', '.font-size-value', '.font-select', '.footer-font-import']) {
    await expect(page.locator(selector).first()).toHaveCSS('font-size', '24px');
  }
  await page.setViewportSize({ width: 960, height: 600 });
  await page.getByRole('button', { name: '放大正文字号', exact: true }).click();
  const size = await page.locator('.md-source').evaluate(el => getComputedStyle(el).fontSize);
  await expect(page.locator('.md-preview')).toHaveCSS('font-size', size);
  await expect(page.locator('.source-highlight-layer')).toHaveCSS('font-size', size);
  await page.locator('.font-select').selectOption('songti');
  await page.reload();
  await expect(page.locator('.md-source')).toHaveCSS('font-size', size);
  await expect(page.locator('.md-preview')).toHaveCSS('font-size', size);
  await expect(page.locator('.word-count')).toHaveCSS('font-size', '24px');
  await expect(page.locator('.md-source')).toHaveCSS('font-family', await page.locator('.md-preview').evaluate(el => getComputedStyle(el).fontFamily));
});

test('沉浸阅读字号按钮可点击并同步源码', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: '沉浸式阅读', exact: true }).click();
  await page.mouse.move(500, 10); // 顶边唤出自动隐藏的沉浸工具条
  await page.getByRole('button', { name: '放大正文字号（同步源码）', exact: true }).click();
  const size = await page.locator('.md-preview').evaluate(el => getComputedStyle(el).fontSize);
  await expect(page.locator('.md-source')).toHaveCSS('font-size', size);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menubar')).toBeVisible();
});

test('旧的独立字号优先保留阅读字号并统一双端', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const key = 'md-editor-warm-v1';
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    localStorage.setItem(key, JSON.stringify({ ...saved, content: '# 迁移', fontSize: 14, previewFontSize: 22 }));
  });
  await page.reload();
  await expect(page.locator('.md-source')).toHaveCSS('font-size', '22px');
  await expect(page.locator('.md-preview')).toHaveCSS('font-size', '22px');
});
