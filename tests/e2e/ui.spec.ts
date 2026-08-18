import { test, expect, openEditor, setSource, clickMenubarItem } from './fixtures';

// Typora 风格菜单栏：文件/编辑/段落/格式/视图/主题/帮助。

test('菜单栏：7 项齐全；文件操作在侧边栏；字体选择器在主题菜单', async ({ page }) => {
  await openEditor(page);

  // 菜单栏整行存在，7 个触发器
  await expect(page.locator('.menubar')).toBeVisible();
  await expect(page.locator('.menubar-trigger')).toHaveCount(7);
  await expect(page.locator('.menubar-trigger').first()).toHaveText(/文件/);

  // 文件操作集中在侧边栏「文件」页签（展开侧边栏可见）
  await page.evaluate(() => {
    const sb = document.querySelector('.document-sidebar');
    if (sb) {
      sb.classList.remove('is-collapsed');
      sb.classList.add('is-mobile-open');
    }
    const tab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement | null;
    tab?.click();
  });
  await expect(page.locator('.sidebar-file-actions')).toBeVisible();
  await expect(page.locator('.sidebar-file-actions').getByRole('menuitem', { name: '新建文档' })).toBeVisible();

  // 字体选择器位于源码工具栏（统一字体：源码+预览同步）
  const fontSelect = page.locator('.source-font-field .font-select');
  await expect(fontSelect).toBeVisible();
  const options = await fontSelect.locator('option').allTextContents();
  expect(options.some((o) => o.includes('楷体'))).toBe(true);
  expect(options.some((o) => o.includes('宋体'))).toBe(true);
});

test('菜单栏 mnemonics：Alt+E 打开编辑菜单、Esc 关闭', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Alt+KeyE');
  await expect(page.locator('[data-menubar="edit"]')).toHaveClass(/is-open/);
  await expect(page.locator('[data-menubar="edit"] .menubar-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-menubar="edit"]')).not.toHaveClass(/is-open/);
});

test('段落/格式菜单：插入表格与分隔线生效', async ({ page }) => {  await openEditor(page);

  // 格式菜单插入表格 → 源码出现表格 md，预览渲染出 table
  await clickMenubarItem(page, 'format', '插入表格');
  await expect(page.locator('.md-source')).toHaveValue(/| 列 1 \| 列 2 \| 列 3 \|/);
  await expect(page.locator('.md-preview table')).toBeVisible();

  // 段落菜单分割线 → 预览多一个 hr（示例文档原有 1 个）
  await clickMenubarItem(page, 'para', '分割线');
  await expect(page.locator('.md-preview hr')).toHaveCount(2);
});

test('字体选择：源码与预览同时切换字体并持久化', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 标题\n\n正文内容');

  await page.waitForFunction(() => {
    const sel = document.querySelector('.source-font-field .font-select') as HTMLSelectElement | null;
    return !!sel && sel.options.length >= 8;
  });
  await page.locator('.source-font-field .font-select').selectOption('songti');
  await page.waitForTimeout(200);

  // 预览正文跟随
  const prevFamily = await page.locator('.md-preview').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(prevFamily.toLowerCase()).toContain('songti');
  // 源码编辑区同步（统一字体）
  const srcFamily = await page.locator('.md-source').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(srcFamily.toLowerCase()).toContain('songti');

  // 持久化：刷新后选择器保持 songti，源码仍跟随
  await page.reload();
  await page.locator('.md-source').waitFor({ timeout: 15000 });
  await expect(page.locator('.source-font-field .font-select')).toHaveValue('songti');
  const srcAfter = await page.locator('.md-source').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(srcAfter.toLowerCase()).toContain('songti');
});

test('字体导入：导入 ttf 后出现在已导入组并应用到正文', async ({ page }) => {
  await openEditor(page);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.source-font-import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles('C:\\Windows\\Fonts\\arial.ttf');

  await expect(page.locator('.save-status')).toHaveText(/已导入字体/);
  await expect(page.locator('.font-select optgroup[label="已导入"]')).toHaveCount(1);
  await expect(page.locator('.font-select')).toHaveValue(/^imported:arial$/i);

  // 导入字体应用到预览与源码
  const prevFamily = await page.locator('.md-preview').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(prevFamily.toLowerCase()).toContain('arial');
  const srcFamily = await page.locator('.md-source').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(srcFamily.toLowerCase()).toContain('arial');
});
