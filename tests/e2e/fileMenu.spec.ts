import { test, expect, openEditor, setSource, openMenubar, clickMenubarItem } from './fixtures';

/** 展开侧边栏「文件」页签（不触发桌面端状态提示） */
async function openSidebarFiles(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const sb = document.querySelector('.document-sidebar');
    if (sb) {
      sb.classList.remove('is-collapsed');
      sb.classList.add('is-mobile-open');
    }
    const tab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement | null;
    tab?.click();
  });
}

test('菜单栏「文件」菜单包含新建/打开/保存/另存为与导出；侧边栏不再放文件操作', async ({ page }) => {
  await openEditor(page);

  await openMenubar(page, 'file');
  const menu = page.locator('[data-menubar="file"] .menubar-menu');
  await expect(menu.getByRole('menuitem', { name: '新建文档' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '打开…', exact: true })).toBeVisible(); // 默认子串匹配会命中「快速打开…」
  await expect(menu.getByRole('menuitem', { name: /^保存/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /另存为/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /快速打开/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /插入图片/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /导出 HTML/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /导出 PDF/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /导出 Word/ })).toBeVisible();

  // 侧边栏不再有文件操作按钮组
  await expect(page.locator('.sidebar-file-actions')).toHaveCount(0);
});

test('侧边栏「文件」页签：无桌面端时显示目录浏览提示', async ({ page }) => {
  await openEditor(page);
  await openSidebarFiles(page);
  await expect(page.locator('.recent-document-list')).toBeVisible();
  await expect(page.locator('.file-tree-empty')).toHaveText(/桌面端环境/);
});

test('通过菜单栏文件菜单新建空白文档（新标签）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 旧内容');
  page.on('dialog', (dialog) => dialog.accept());

  await clickMenubarItem(page, 'file', '新建文档');
  await expect(page.locator('.md-source')).toHaveValue('');
  await expect(page.locator('.tab-item')).toHaveCount(2);
});

test('非桌面环境打开与另存为提示需要桌面端', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 正文');
  // 消除 600ms 自动保存定时器与状态栏断言的竞态：先等自动保存落定再操作。
  await expect(page.locator('.save-status')).toHaveText(/已自动保存/);

  await openMenubar(page, 'file');
  await page.locator('[data-menubar="file"] .menubar-menu').getByRole('menuitem', { name: '打开…', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);

  await clickMenubarItem(page, 'file', '另存为');
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);
});