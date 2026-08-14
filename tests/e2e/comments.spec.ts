import { test, expect, openEditor, setSource } from './fixtures';
import type { Page } from '@playwright/test';

// 在预览里选中一段文字，浮出划词工具条。
// headless Chromium 对 contentEditable="false" 的 .md-preview 用真实鼠标拖动
// 无法建立选区（text:"" collapsed:true，Playwright 已知行为），所以改为在页面内
// 创建真实 Range 选区并派发 mouseup，走与真实手势相同的 _onPreviewSelect 路径。
async function selectInPreview(page: Page) {
  await page.locator('.md-preview p').first().evaluate((p) => {
    const range = document.createRange();
    range.selectNodeContents(p);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    p.closest('.md-preview')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('.selection-toolbar')).toBeVisible();
}

async function createIdeaComment(page: Page) {
  await selectInPreview(page);
  await page.getByRole('button', { name: /写想法/ }).click();
  await expect(page.locator('.comments-panel')).toBeVisible();
  await expect(page.locator('.comments-panel .comment-quote')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 批注链路\n\n这是一段足够长的正文，用来在预览里划选并创建批注验证按钮可用。');
});

test('批注卡片的复制与删除按钮可用，复制在按钮上原地反馈', async ({ page }) => {
  await createIdeaComment(page);

  await page.getByRole('button', { name: '复制', exact: true }).click();
  // 点击的按钮原地闪现「✓ 已复制」，之后恢复原文案
  await expect(page.locator('.comments-panel button.is-copied')).toHaveText(/✓ 已复制/);
  await expect(page.locator('.save-status')).toHaveText(/已复制该批注/);
  await expect(page.locator('.comments-panel button.is-copied')).toHaveCount(0, { timeout: 3000 });
  await expect(page.getByRole('button', { name: '复制', exact: true })).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('.comments-panel .comment-quote')).toHaveCount(0);
  await expect(page.locator('.save-status')).toHaveText(/已删除批注/);
});

test('删除批注需要二次确认，取消则保留', async ({ page }) => {
  await createIdeaComment(page);

  // Playwright 默认 dismiss 对话框：等价于用户点了「取消」
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('.comments-panel .comment-quote')).toHaveCount(1);
});

test('官网版划词工具条隐藏依赖本地 Bridge 的翻译与问 AI', async ({ page }) => {
  await selectInPreview(page);

  await expect(page.locator('.selection-toolbar .translate-entry')).toBeHidden();
  await expect(page.locator('.selection-toolbar .ai-entry')).toBeHidden();
  await expect(page.getByRole('button', { name: /写想法/ })).toBeVisible();
});

test('想法批注可贴入自己找到的回答，刷新后仍保留', async ({ page }) => {
  await createIdeaComment(page);

  await page.getByRole('button', { name: '回复', exact: true }).click();
  const replyInput = page.locator('.comment-reply-input');
  await expect(replyInput).toBeVisible();
  await expect(replyInput).toBeFocused();
  await replyInput.fill('这是我从别处找到的答案');

  await page.reload();
  await expect(page.locator('.md-source')).toBeVisible();
  await page.getByRole('button', { name: '批注', exact: true }).click();
  await expect(page.locator('.comment-reply-input')).toHaveValue('这是我从别处找到的答案');
});

test('复制全部批注与复制全文+批注在按钮上原地反馈', async ({ page }) => {
  await createIdeaComment(page);

  await page.getByRole('button', { name: '复制全部批注' }).click();
  await expect(page.locator('.comments-panel button.is-copied')).toHaveText(/✓ 已复制/);
  await expect(page.locator('.save-status')).toHaveText(/已复制全部批注/);
  await expect(page.getByRole('button', { name: '复制全部批注' })).toBeVisible({ timeout: 3000 });

  await page.getByRole('button', { name: '复制全文+批注' }).click();
  await expect(page.locator('.comments-panel button.is-copied')).toHaveText(/✓ 已复制/);
  await expect(page.locator('.save-status')).toHaveText(/已复制全文/);
  await expect(page.getByRole('button', { name: '复制全文+批注' })).toBeVisible({ timeout: 3000 });
});
