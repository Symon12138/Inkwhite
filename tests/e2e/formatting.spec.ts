import { test, expect, openEditor, setSource, selectInSource, clickMenubarItem } from './fixtures';

test.beforeEach(async ({ page }) => {
  await openEditor(page);
  await setSource(page, 'hello world');
});

test('菜单加粗选区并可撤销、重做', async ({ page }) => {
  const source = page.locator('.md-source');
  await selectInSource(page, 'world');

  await clickMenubarItem(page, 'format', '加粗');
  await expect(source).toHaveValue('hello **world**');
  await expect(page.locator('.md-preview strong')).toHaveText('world');

  await clickMenubarItem(page, 'edit', '撤销');
  await expect(source).toHaveValue('hello world');

  await clickMenubarItem(page, 'edit', '重做');
  await expect(source).toHaveValue('hello **world**');
});

test('快捷键在原文区触发撤销', async ({ page }) => {
  const source = page.locator('.md-source');
  await selectInSource(page, 'world');
  await clickMenubarItem(page, 'format', '斜体');
  await expect(source).toHaveValue('hello *world*');

  await source.press('ControlOrMeta+z');
  await expect(source).toHaveValue('hello world');
});

test('引用与列表命令作用于整行', async ({ page }) => {
  const source = page.locator('.md-source');
  await selectInSource(page, 'hello');

  await clickMenubarItem(page, 'para', '引用');
  await expect(source).toHaveValue('> hello world');
  await expect(page.locator('.md-preview blockquote')).toContainText('hello world');
});
