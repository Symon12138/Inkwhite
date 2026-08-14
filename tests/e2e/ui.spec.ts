import { test, expect, openEditor, setSource, selectInSource } from './fixtures';

// 扁平顶栏（ui-ux-pro-max 重构）：单行导航、字体选择与导入、工具栏更多浮层。

test('扁平顶栏：无菜单栏行，文件菜单在顶栏，字体选择器就位', async ({ page }) => {
  await openEditor(page);

  // 菜单栏整行已移除
  await expect(page.locator('.app-menubar')).toHaveCount(0);

  // 文件菜单回到顶栏（aria-label 不变）
  await page.getByRole('button', { name: '更多操作' }).click();
  await expect(page.locator('.file-menu')).toHaveClass(/is-open/);
  await page.locator('.md-source').click();
  await expect(page.locator('.file-menu')).not.toHaveClass(/is-open/);

  // 字体选择器有系统字体选项
  const fontSelect = page.locator('.font-select');
  await expect(fontSelect).toBeVisible();
  const options = await fontSelect.locator('option').allTextContents();
  expect(options.some((o) => o.includes('楷体'))).toBe(true);
  expect(options.some((o) => o.includes('宋体'))).toBe(true);
  expect(await page.locator('.font-import').count()).toBe(1);
});

test('工具栏更多浮层：展开 8 项，插入表格与分隔线生效', async ({ page }) => {
  await openEditor(page);

  await page.locator('.more-tools-toggle').click();
  await expect(page.locator('.more-tools')).toHaveClass(/is-open/);
  const items = await page.locator('.more-tools .header-menu-item').allTextContents();
  expect(items.length).toBeGreaterThanOrEqual(8);
  expect(items).toContain('插入表格');
  expect(items).toContain('分隔线');

  // 插入表格 → 源码出现表格 md（插入在光标处），预览渲染出 table
  await page.locator('.more-tools .header-menu-item', { hasText: '插入表格' }).click();
  await expect(page.locator('.md-source')).toHaveValue(/\| 列 1 \| 列 2 \| 列 3 \|/);
  await expect(page.locator('.md-preview table')).toBeVisible();
  // 浮层自动关闭
  await expect(page.locator('.more-tools')).not.toHaveClass(/is-open/);

  // 分隔线 → 预览多一个 hr（示例文档原有 1 个）
  await page.locator('.more-tools-toggle').click();
  await page.locator('.more-tools .header-menu-item', { hasText: '分隔线' }).click();
  await expect(page.locator('.md-preview hr')).toHaveCount(2);
});

test('新格式按钮：删除线/高亮/下划线（常用行）与上标/下标/任务/脚注/代码块（更多浮层）', async ({ page }) => {
  await openEditor(page);

  const wrapAndCheck = async (btnTitle: string, expected: string) => {
    await setSource(page, '示例文字');
    await selectInSource(page, '示例文字');
    await page.locator(`.source-toolbar-actions .tbtn[title="${btnTitle}"]`).click();
    await expect(page.locator('.md-source')).toHaveValue(expected);
  };

  await wrapAndCheck('删除线', '~~示例文字~~');
  await wrapAndCheck('高亮', '==示例文字==');
  await wrapAndCheck('下划线', '<u>示例文字</u>');

  // 更多浮层里的格式
  const wrapViaMore = async (itemText: string, expected: string) => {
    await setSource(page, '示例文字');
    await selectInSource(page, '示例文字');
    await page.locator('.more-tools-toggle').click();
    await page.locator('.more-tools .header-menu-item', { hasText: itemText }).click();
    await expect(page.locator('.md-source')).toHaveValue(expected);
  };

  await wrapViaMore('上标', '^示例文字^');
  await wrapViaMore('下标', '~示例文字~');
  await wrapViaMore('任务列表', '- [ ] 示例文字');
  await wrapViaMore('脚注', '[^示例文字]');

  // 代码块
  await setSource(page, 'const x = 1');
  await selectInSource(page, 'const x = 1');
  await page.locator('.more-tools-toggle').click();
  await page.locator('.more-tools .header-menu-item', { hasText: '代码块' }).click();
  await expect(page.locator('.md-source')).toHaveValue('```\nconst x = 1\n```');
});

test('字体选择：切换字体应用到预览正文并持久化', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 标题\n\n正文内容');

  await page.locator('.font-select').selectOption('songti');
  await page.waitForTimeout(200);

  const family = await page.locator('.md-preview').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family.toLowerCase()).toContain('songti');

  // 持久化：刷新后仍生效
  await page.reload();
  await page.locator('.md-source').waitFor({ timeout: 15000 });
  await expect(page.locator('.font-select')).toHaveValue('songti');
  const familyAfter = await page.locator('.md-preview').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(familyAfter.toLowerCase()).toContain('songti');
});

test('字体导入：导入 ttf 后出现在已导入组并应用到正文', async ({ page }) => {
  await openEditor(page);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.font-import').click();
  const chooser = await chooserPromise;
  await chooser.setFiles('C:\\Windows\\Fonts\\arial.ttf');

  await expect(page.locator('.save-status')).toHaveText(/已导入字体/);
  await expect(page.locator('.font-select optgroup[label="已导入"]')).toHaveCount(1);
  await expect(page.locator('.font-select')).toHaveValue(/^imported:arial$/i);

  const family = await page.locator('.md-preview').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family.toLowerCase()).toContain('arial');
});
