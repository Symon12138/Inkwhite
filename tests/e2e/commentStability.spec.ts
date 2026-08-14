// M1-1（任务 D）：bodyText 接线后的批注/搜索稳定性 E2E。
//
// 构造带排除区（.front-matter/.toc/.footnotes，M1-2..6 将产出同类结构，
// 这里用 setSource 的 HTML 原始块直接模拟）的文档，验证：
//   1) 批注锚定基于 bodyText：排除区前置后，正文批注仍命中正确文本；
//   2) 脚注区文本不作为批注锚点：在 .footnotes 内创建批注不产生预览高亮；
//   3) 预览搜索基于 bodyText：正文关键词仍命中；仅存在于排除区的关键词不命中。
//
// 红测记录（M1-1 实施前）：用例 2/3/4 在 textContent 锚定下为红——
//   脚注区文本可被高亮（用例 2 断言 [data-comment-id] 为 0，旧行为为 1）；
//   排除区关键词可被搜到（用例 3/4 断言「无结果」，旧行为为「第 1 项，共 1 项」）。
// 接线后全部转绿。

import { test, expect, openEditor, setSource } from './fixtures';
import type { Page, Locator } from '@playwright/test';

const STABILITY_DOC = [
  '<div class="front-matter">\n<p>title: 稳定性测试</p>\n</div>',
  '',
  '<div class="toc">\n<ul>\n<li>目录项</li>\n</ul>\n</div>',
  '',
  '<div class="footnotes">\n<ol>\n<li>脚注内容：目标短语</li>\n</ol>\n</div>',
  '',
  '# 正文标题',
  '',
  '正文第一段。',
  '',
  '正文第二段包含目标短语。'
].join('\n');

// 在预览里选中指定元素内的全部文本并派发 mouseup（与 comments.spec.ts 同一路径）。
async function selectInPreview(page: Page, target: Locator) {
  await target.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    el.closest('.md-preview')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.locator('.selection-toolbar')).toBeVisible();
}

async function createIdeaComment(page: Page, target: Locator) {
  await selectInPreview(page, target);
  await page.getByRole('button', { name: /写想法/ }).click();
  await expect(page.locator('.comments-panel')).toBeVisible();
}

test('排除区前置后，正文批注仍命中正确文本（高亮与批注卡片引用一致）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, STABILITY_DOC);

  // 划选正文最后一段（front-matter 内的 p 在最前，.last() 取正文段）
  await createIdeaComment(page, page.locator('.md-preview p').last());

  // 高亮 span 包住的必须是正文文本（排除区文本不进入锚文本）
  await expect(page.locator('.md-preview [data-comment-id]')).toHaveText('正文第二段包含目标短语。');
  await expect(page.locator('.comments-panel .comment-quote')).toHaveText('正文第二段包含目标短语。');
});

test('脚注区文本不作为批注锚点：在 .footnotes 内创建批注不产生预览高亮', async ({ page }) => {
  await openEditor(page);
  await setSource(page, STABILITY_DOC);

  await createIdeaComment(page, page.locator('.md-preview .footnotes li'));

  // 批注卡片存在（创建成功），但预览无高亮：脚注区不在 bodyText 锚文本内
  await expect(page.locator('.comments-panel .comment-quote')).toHaveText('脚注内容：目标短语');
  await expect(page.locator('.md-preview [data-comment-id]')).toHaveCount(0);
});

test('预览搜索：排除区后的正文关键词仍命中', async ({ page }) => {
  await openEditor(page);
  await setSource(page, STABILITY_DOC);
  await page.locator('.view-mode-option[data-mode="preview"]').click();

  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('textbox', { name: '搜索预览' }).fill('正文第二段');
  await expect(page.locator('.preview-search-count')).toHaveText('第 1 项，共 1 项');
});

test('预览搜索：仅存在于排除区（.footnotes）的关键词不命中', async ({ page }) => {
  await openEditor(page);
  await setSource(page, STABILITY_DOC);
  await page.locator('.view-mode-option[data-mode="preview"]').click();

  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('textbox', { name: '搜索预览' }).fill('脚注内容');
  await expect(page.locator('.preview-search-count')).toHaveText('无结果');
});

test('预览搜索：仅存在于排除区（.toc）的关键词不命中', async ({ page }) => {
  await openEditor(page);
  await setSource(page, STABILITY_DOC);
  await page.locator('.view-mode-option[data-mode="preview"]').click();

  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('textbox', { name: '搜索预览' }).fill('目录项');
  await expect(page.locator('.preview-search-count')).toHaveText('无结果');
});
