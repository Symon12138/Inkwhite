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

test('源码工具栏：加粗/标题/链接 按钮包裹或加前缀选区', async ({ page }) => {
  const source = page.locator('.md-source');

  // 加粗
  await selectInSource(page, 'world');
  await page.locator('.source-toolbar-actions [aria-label="加粗"]').click();
  await expect(source).toHaveValue('hello **world**');

  // 标题（## ）作用于当前整行
  await page.locator('.md-source').evaluate((el) => {
    const s = el as HTMLTextAreaElement; s.focus(); s.setSelectionRange(s.value.length, s.value.length);
  });
  await page.locator('.source-toolbar-actions [aria-label="标题"]').click();
  await expect(source).toHaveValue('## hello **world**');

  // 链接：选中后包裹为 [text](https://)（world 在 **…** 内部，仅包裹纯文本）
  await selectInSource(page, 'world');
  await page.locator('.source-toolbar-actions [aria-label="链接"]').click();
  await expect(source).toHaveValue('## hello **[world](https://)**');
});

test('源码工具栏：更多格式 ⋯ → 插入表格渲染出 table', async ({ page }) => {
  const source = page.locator('.md-source');
  // 表格需独立成段才能渲染 GFM table：给源码末尾补空行
  await setSource(page, 'hello world\n\n');
  await page.locator('.source-toolbar-actions [aria-label="更多格式"]').click();
  await page.locator('.more-tools').getByRole('menuitem', { name: '插入表格' }).click();

  await expect(source).toHaveValue(/| 列 1 \| 列 2 \| 列 3 \|/);
  await expect(page.locator('.md-preview table')).toBeVisible();
});
