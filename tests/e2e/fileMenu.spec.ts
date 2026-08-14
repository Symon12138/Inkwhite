import { test, expect, openEditor, setSource } from './fixtures';

test('顶栏文件菜单包含新建、打开、保存与另存为，点击外部关闭', async ({ page }) => {
  await openEditor(page);

  await page.getByRole('button', { name: '更多操作' }).click();
  await expect(page.locator('.file-menu')).toHaveClass(/is-open/);
  const fileMenu = page.locator('.file-menu');
  await expect(fileMenu.getByRole('menuitem', { name: '新建文档' })).toBeVisible();
  await expect(fileMenu.getByRole('menuitem', { name: /^打开/ })).toBeVisible();
  await expect(fileMenu.getByRole('menuitem', { name: /^保存/ })).toBeVisible();
  await expect(fileMenu.getByRole('menuitem', { name: /另存为/ })).toBeVisible();

  // 顶栏不再保留独立的新建/打开按钮
  await expect(page.getByRole('button', { name: '新建文档' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开文件' })).toHaveCount(0);

  // 菜单完整落在视口内，不被右缘裁切
  const menuBox = await fileMenu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width);

  await page.locator('.md-source').click();
  await expect(page.locator('.file-menu')).not.toHaveClass(/is-open/);
});

test('通过文件菜单新建空白文档', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 旧内容');
  page.on('dialog', (dialog) => dialog.accept());

  await page.getByRole('button', { name: '更多操作' }).click();
  await page.locator('.file-menu').getByRole('menuitem', { name: '新建文档' }).click();

  await expect(page.locator('.md-source')).toHaveValue('');
  await expect(page.locator('.file-menu')).not.toHaveClass(/is-open/);
});

test('非桌面环境打开与另存为提示需要桌面端', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 正文');
  // 消除 600ms 自动保存定时器与状态栏断言的竞态：先等自动保存落定再操作。
  await expect(page.locator('.save-status')).toHaveText(/已自动保存/);

  await page.getByRole('button', { name: '更多操作' }).click();
  await page.locator('.file-menu').getByRole('menuitem', { name: /^打开/ }).click();
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);

  await page.getByRole('button', { name: '更多操作' }).click();
  await page.locator('.file-menu').getByRole('menuitem', { name: /另存为/ }).click();
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);
});
