// M4 E2E：任务勾选交互（P8 完整交付）。
// 点击预览 checkbox → 只改目标源码 [ ]/[x] → 可撤销；其余内容不变。

import { test, expect, openEditor, setSource } from './fixtures';

test('任务项渲染：task-list-item 类 + 可交互 checkbox + data-task-idx 序号', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '- [x] 完成\n- [ ] 待办');

  const items = page.locator('.md-preview li.task-list-item');
  await expect(items).toHaveCount(2);
  const first = items.nth(0).locator('input[type="checkbox"]');
  const second = items.nth(1).locator('input[type="checkbox"]');
  await expect(first).not.toBeDisabled();
  await expect(first).toBeChecked();
  await expect(first).toHaveAttribute('data-task-idx', '0');
  await expect(second).not.toBeDisabled();
  await expect(second).not.toBeChecked();
  await expect(second).toHaveAttribute('data-task-idx', '1');
});

test('点击 checkbox 只改目标任务标记，可撤销（M4 完整交互）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '- [x] 完成\n\n正文 [ ] 不是任务\n\n- [ ] 待办');

  // 点击第二个任务（待办）→ [ ] 变 [x]
  await page.locator('.md-preview li.task-list-item').nth(1).locator('input[type="checkbox"]').click();
  await expect(page.locator('.md-source')).toHaveValue('- [x] 完成\n\n正文 [ ] 不是任务\n\n- [x] 待办');
  // 正文中的 [ ] 不受影响（非任务上下文；textarea 用 value 断言而非文本内容）
  await expect(page.locator('.md-source')).toHaveValue(/正文 \[ \] 不是任务/);

  // 再点第一个任务（完成）→ [x] 变 [ ]
  await page.locator('.md-preview li.task-list-item').nth(0).locator('input[type="checkbox"]').click();
  await expect(page.locator('.md-source')).toHaveValue('- [ ] 完成\n\n正文 [ ] 不是任务\n\n- [x] 待办');

  // 撤销回到初始（应用层 undo 只在源码区聚焦时接管，先聚焦；每次点击独立条目）
  await page.locator('.md-source').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.md-source')).toHaveValue('- [x] 完成\n\n正文 [ ] 不是任务\n\n- [x] 待办');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.md-source')).toHaveValue('- [x] 完成\n\n正文 [ ] 不是任务\n\n- [ ] 待办');
});

test('嵌套任务列表点击只改目标项', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '- [ ] 外层\n  - [x] 内层');

  // 外层 li 包含内层 li，用 data-task-idx 精确定位
  const outer = page.locator('.md-preview input[data-task-idx="0"]');
  const inner = page.locator('.md-preview input[data-task-idx="1"]');
  await expect(page.locator('.md-preview li.task-list-item')).toHaveCount(2);

  await outer.click();
  await expect(page.locator('.md-source')).toHaveValue('- [x] 外层\n  - [x] 内层');
  await inner.click();
  await expect(page.locator('.md-source')).toHaveValue('- [x] 外层\n  - [ ] 内层');
});

test('普通列表不加类；代码块内 - [x] 不渲染 checkbox', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '- 普通项\n\n```\n- [x] 代码里的任务\n```');

  await expect(page.locator('.md-preview li.task-list-item')).toHaveCount(0);
  await expect(page.locator('.md-preview input[type="checkbox"]')).toHaveCount(0);
  await expect(page.locator('.md-preview code')).toContainText('- [x] 代码里的任务');
});
