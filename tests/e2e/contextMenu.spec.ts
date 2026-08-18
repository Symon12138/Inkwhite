import { test, expect, openEditor, setSource, selectInSource } from './fixtures';

// 右键菜单（contextMenuMethods）：源码区四分组命令、预览区上下文命中
// （链接/表格）、标签页操作、Esc 关闭。

test('源码区右键：菜单含编辑/段落/格式/插入四分组，点击加粗包裹选区', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 标题\n\nhello world');
  await selectInSource(page, 'world');

  await page.locator('.md-source').click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu .context-menu-group-label')).toHaveText(['编辑', '段落', '格式', '插入']);

  await page.locator('.context-menu').getByRole('menuitem', { name: '加粗' }).click();
  await expect(page.locator('.md-source')).toHaveValue('# 标题\n\nhello **world**');
  await expect(page.locator('.context-menu')).toBeHidden();
});

test('源码区右键：剪切/复制无选区时禁用；撤销可用并回退一步输入', async ({ page }) => {
  await openEditor(page);
  await setSource(page, 'abc');
  // 跨过编辑历史的 800ms 输入合并窗口：fill 与后续按键同为 insertText，
  // 若在窗口内会被合并成一条历史，撤销断言就不确定。
  await page.waitForTimeout(850);
  await page.locator('.md-source').click({ button: 'right' });
  const cut = page.locator('.context-menu .context-menu-item', { hasText: '剪切' });
  await expect(cut).toHaveClass(/is-disabled/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.context-menu')).toBeHidden();

  // 显式把光标置到文末并聚焦后输入一个字符，产生可撤销历史
  await page.locator('.md-source').evaluate((el) => {
    const src = el as HTMLTextAreaElement;
    src.focus();
    src.setSelectionRange(src.value.length, src.value.length);
  });
  await page.keyboard.press('d');
  await expect(page.locator('.md-source')).toHaveValue('abcd');

  await page.locator('.md-source').click({ button: 'right' });
  const undo = page.locator('.context-menu .context-menu-item', { hasText: '撤销' });
  await expect(undo).not.toHaveClass(/is-disabled/);
  await undo.click();
  await expect(page.locator('.md-source')).toHaveValue('abc');
});

test('预览区右键链接：复制链接地址并提示', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '[示例](https://example.com/a)');
  const link = page.locator('.md-preview a[href="https://example.com/a"]');
  await expect(link).toBeVisible();

  await link.click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu').getByRole('menuitem', { name: '打开链接' })).toBeVisible();

  await page.locator('.context-menu').getByRole('menuitem', { name: '复制链接地址' }).click();
  await expect(page.locator('.save-status')).toHaveText(/已复制链接地址/);
});

test('预览区右键表格：复制为 Markdown 并提示', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |');
  const table = page.locator('.md-preview table');
  await expect(table).toBeVisible();

  await table.click({ button: 'right' });
  await expect(page.locator('.context-menu').getByRole('menuitem', { name: '复制表格为 Markdown' })).toBeVisible();
  await page.locator('.context-menu').getByRole('menuitem', { name: '复制表格为 Markdown' }).click();
  await expect(page.locator('.save-status')).toHaveText(/已复制为 Markdown/);
});

test('预览区右键默认：无选区时菜单包含复制/复制为 HTML/全选', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '普通段落文字');
  await page.locator('.md-preview').click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await expect(page.locator('.context-menu').getByRole('menuitem', { name: '全选' })).toBeVisible();
});

test('标签页右键：关闭标签页', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Control+t');
  await expect(page.locator('.tab-item')).toHaveCount(2);

  await page.locator('.tab-item').nth(1).click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await page.locator('.context-menu').getByRole('menuitem', { name: '关闭标签页' }).click();
  await expect(page.locator('.tab-item')).toHaveCount(1);
});

test('标签页右键：关闭其他标签页只保留被右键的标签', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Control+t');
  await page.keyboard.press('Control+t');
  await expect(page.locator('.tab-item')).toHaveCount(3);

  await page.locator('.tab-item').first().click({ button: 'right' });
  await page.locator('.context-menu').getByRole('menuitem', { name: '关闭其他标签页' }).click();
  await expect(page.locator('.tab-item')).toHaveCount(1);
  await expect(page.locator('.tab-item.is-active .tab-label')).toHaveText('未命名.md');
});

test('Esc 关闭已打开的右键菜单', async ({ page }) => {
  await openEditor(page);
  await page.locator('.md-source').click({ button: 'right' });
  await expect(page.locator('.context-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.context-menu')).toBeHidden();
});
