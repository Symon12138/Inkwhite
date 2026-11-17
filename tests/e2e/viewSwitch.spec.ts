import { test, expect, openEditor, clickMenubarItem } from './fixtures';

test('编辑视图：源码工具栏「预览效果」按钮切到预览视图', async ({ page }) => {
  await openEditor(page);
  await clickMenubarItem(page, 'view', '编辑视图');
  await expect(page.locator('.editor-main')).toHaveClass(/editor-mode-active/);
  const btn = page.locator('.source-switch-preview');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('.editor-main')).toHaveClass(/preview-mode-active/);
  await expect(page.locator('.md-source')).toBeHidden();
});

test('预览视图：预览工具栏「编辑」按钮切回编辑视图', async ({ page }) => {
  await openEditor(page);
  await clickMenubarItem(page, 'view', '预览视图');
  await expect(page.locator('.editor-main')).toHaveClass(/preview-mode-active/);
  const btn = page.locator('.preview-switch-editor');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('.editor-main')).toHaveClass(/editor-mode-active/);
  await expect(page.locator('.md-source')).toBeVisible();
});

test('分屏视图不显示单栏切换按钮（两栏同屏无需切换）', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.editor-main')).not.toHaveClass(/editor-mode-active|preview-mode-active/);
  await expect(page.locator('.source-switch-preview')).toBeHidden();
  await expect(page.locator('.preview-switch-editor')).toBeHidden();
});

test('切换按钮有可访问名称且视图切换后仍可继续用菜单切回分屏', async ({ page }) => {
  await openEditor(page);
  await clickMenubarItem(page, 'view', '编辑视图');
  await expect(page.locator('.source-switch-preview')).toHaveAttribute('aria-label', /预览/);
  await page.locator('.source-switch-preview').click();
  await expect(page.locator('.preview-switch-editor')).toHaveAttribute('aria-label', /编辑/);
  await clickMenubarItem(page, 'view', '分屏视图');
  await expect(page.locator('.md-source')).toBeVisible();
  await expect(page.locator('.md-preview')).toBeVisible();
});
test('窄屏（≤760px）单栏视图下切换按钮仍可见且可点击', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await openEditor(page);
  await clickMenubarItem(page, 'view', '编辑视图');
  const toPreview = page.locator('.source-switch-preview');
  await expect(toPreview).toBeVisible();
  await toPreview.click();
  await expect(page.locator('.editor-main')).toHaveClass(/preview-mode-active/);
  const toEditor = page.locator('.preview-switch-editor');
  await expect(toEditor).toBeVisible();
  await toEditor.click();
  await expect(page.locator('.editor-main')).toHaveClass(/editor-mode-active/);
});
