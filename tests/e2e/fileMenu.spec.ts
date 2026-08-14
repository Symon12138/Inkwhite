import { test, expect, openEditor, setSource } from './fixtures';

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

test('侧边栏文件页签包含新建、打开、保存与另存为等文件操作', async ({ page }) => {
  await openEditor(page);
  await openSidebarFiles(page);

  const actions = page.locator('.sidebar-file-actions');
  await expect(actions).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: '新建文档' })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /^打开/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /^保存/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /另存为/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /快速打开/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /插入图片/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /导出 HTML/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /导出 PDF/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /导出 Word/ })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: /设置/ })).toBeVisible();

  // 顶栏不再保留独立的新建/打开按钮
  await expect(page.getByRole('button', { name: '新建文档' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开文件' })).toHaveCount(0);
});

test('通过侧边栏文件操作新建空白文档', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 旧内容');
  page.on('dialog', (dialog) => dialog.accept());

  await openSidebarFiles(page);
  await page.locator('.sidebar-file-actions').getByRole('menuitem', { name: '新建文档' }).click();

  await expect(page.locator('.md-source')).toHaveValue('');
});

test('非桌面环境打开与另存为提示需要桌面端', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 正文');
  // 消除 600ms 自动保存定时器与状态栏断言的竞态：先等自动保存落定再操作。
  await expect(page.locator('.save-status')).toHaveText(/已自动保存/);

  await openSidebarFiles(page);
  await page.locator('.sidebar-file-actions').getByRole('menuitem', { name: /^打开/ }).click();
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);

  await page.locator('.sidebar-file-actions').getByRole('menuitem', { name: /另存为/ }).click();
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);
});
