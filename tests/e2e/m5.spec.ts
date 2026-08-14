import { test, expect, openEditor, setSource } from './fixtures';

// M5 多文档标签页：标签栏渲染、新建/切换/关闭（含 dirty 确认与中键）、
// 内容隔离、重启恢复。

test('标签栏渲染：初始一个标签，标题跟随文档名', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.tab-item')).toHaveCount(1);
  await expect(page.locator('.tab-item.is-active .tab-label')).toHaveText('未命名.md');
});

test('Ctrl+T 新建标签：内容隔离、Ctrl+Tab 切换保留各自内容', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '第一个标签内容');

  await page.keyboard.press('Control+t');
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await expect(page.locator('.tab-item.is-active .tab-label')).toHaveText('未命名-2.md');
  await setSource(page, '第二个标签内容');

  // 切回第一个
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.tab-item.is-active .tab-label')).toHaveText('未命名.md');
  await expect(page.locator('.md-source')).toHaveValue('第一个标签内容');

  // 切到第二个
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('.md-source')).toHaveValue('第二个标签内容');
});

test('关闭 dirty 标签需确认；取消保留、确认关闭', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Control+t'); // 新标签
  await setSource(page, '未保存内容');
  await expect(page.locator('.tab-item.is-active .tab-dirty')).toHaveClass(/is-dirty/);

  // 取消
  await page.keyboard.press('Control+w');
  await expect(page.locator('.close-confirm-overlay')).toBeVisible();
  await page.locator('.close-confirm-actions .abtn').first().click(); // 取消
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await expect(page.locator('.md-source')).toHaveValue('未保存内容');

  // 确认关闭
  await page.keyboard.press('Control+w');
  await page.locator('.close-confirm-actions .abtn.danger').click();
  await expect(page.locator('.tab-item')).toHaveCount(1);
  await expect(page.locator('.tab-item.is-active .tab-label')).toHaveText('未命名.md');
});

test('中键关闭标签', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Control+t');
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await page.locator('.tab-item.is-active').click({ button: 'middle' });
  await expect(page.locator('.tab-item')).toHaveCount(1);
});

test('文件菜单新建文档 = 新标签', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.locator('.file-menu').getByRole('menuitem', { name: '新建文档' }).click();
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await expect(page.locator('.md-source')).toHaveValue('');
});

test('重启恢复：多个标签与各自内容、活动标签', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '标签甲内容');
  await page.keyboard.press('Control+t');
  await setSource(page, '标签乙内容');
  await page.keyboard.press('Control+Tab'); // 回到甲
  await setSource(page, '标签甲内容-改');
  await expect(page.locator('.save-status')).toHaveText(/已自动保存/); // 等自动保存落定

  await page.reload();
  // 恢复内容无标题，不能复用 openEditor（其等待 h1）；手动等待就绪
  await page.waitForSelector('.md-source');
  await expect(page.locator('.tab-item')).toHaveCount(2);
  // 活动标签 = 甲（关闭前所在）
  await expect(page.locator('.tab-item.is-active .tab-label')).toHaveText('未命名.md');
  await expect(page.locator('.md-source')).toHaveValue('标签甲内容-改');

  // 切到乙，内容保留
  await page.locator('.tab-item').nth(1).click();
  await expect(page.locator('.md-source')).toHaveValue('标签乙内容');
});
