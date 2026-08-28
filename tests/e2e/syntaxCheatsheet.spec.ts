import { test, expect, openEditor } from './fixtures';

test('帮助菜单包含语法大全', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-menubar-trigger="help"]').click();
  await expect(page.getByRole('menuitem', { name: '语法大全' })).toBeVisible();
});

test('语法大全浮层开关：点击菜单打开、Esc 关闭', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-menubar-trigger="help"]').click();
  await page.getByRole('menuitem', { name: '语法大全' }).click();
  const overlay = page.locator('.syntax-cheatsheet-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('语法大全')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});

test('语法大全：点击遮罩关闭', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-menubar-trigger="help"]').click();
  await page.getByRole('menuitem', { name: '语法大全' }).click();
  const overlay = page.locator('.syntax-cheatsheet-overlay');
  await expect(overlay).toBeVisible();
  // 点击遮罩边缘（overlay 自身，非 modal）
  await overlay.click({ position: { x: 10, y: 10 } });
  await expect(overlay).toBeHidden();
});

test('语法大全：搜索实时过滤', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-menubar-trigger="help"]').click();
  await page.getByRole('menuitem', { name: '语法大全' }).click();
  const grid = page.locator('[data-syntax-grid]');
  await expect(grid.locator('.syntax-card').first()).toBeVisible();
  const initialCount = await grid.locator('.syntax-card').count();
  await page.locator('[data-syntax-search]').fill('粗体');
  const filtered = await grid.locator('.syntax-card').count();
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(initialCount);
  await expect(grid.locator('.syntax-card').first()).toContainText('粗体');
});

test('语法大全：分类筛选', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-menubar-trigger="help"]').click();
  await page.getByRole('menuitem', { name: '语法大全' }).click();
  await page.locator('.syntax-category-btn').filter({ hasText: '表格' }).click();
  const cards = page.locator('[data-syntax-grid] .syntax-card');
  await expect(cards.first()).toBeVisible();
  const filteredCount = await cards.count();
  const titles = await cards.allTextContents();
  // 表格分类下应有表格相关条目
  expect(titles.join(' ')).toMatch(/表格/);
  await page.locator('.syntax-category-btn').filter({ hasText: '全部' }).click();
  const allCount = await page.locator('[data-syntax-grid] .syntax-card').count();
  expect(allCount).toBeGreaterThan(filteredCount);
});

test('语法大全：点击卡片插入语法到编辑器', async ({ page }) => {
  await openEditor(page);
  // 清空并确保可插入
  await page.locator('.md-source').fill('');
  await page.locator('[data-menubar-trigger="help"]').click();
  await page.getByRole('menuitem', { name: '语法大全' }).click();
  // 选“粗体”卡片的插入按钮
  const boldCard = page.locator('.syntax-card').filter({ hasText: '粗体' }).first();
  await expect(boldCard).toBeVisible();
  await boldCard.locator('.syntax-card-insert').click();
  // 浮层关闭，编辑器获得插入内容，预览更新
  await expect(page.locator('.syntax-cheatsheet-overlay')).toBeHidden();
  await expect(page.locator('.md-source')).toHaveValue(/粗体文本/);
  await expect(page.locator('.preview-pane .md-preview strong').first()).toBeVisible();
});

test('语法大全：复制按钮反馈', async ({ page }) => {
  await openEditor(page);
  await page.locator('[data-menubar-trigger="help"]').click();
  await page.getByRole('menuitem', { name: '语法大全' }).click();
  const firstCopy = page.locator('.syntax-card-copy').first();
  await expect(firstCopy).toBeVisible();
  await firstCopy.click();
  await expect(firstCopy).toHaveText('已复制');
});