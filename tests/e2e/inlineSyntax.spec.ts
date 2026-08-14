// M1-4 E2E：行内语法扩展（上标/下标/高亮/emoji）在真实预览中的表现。
// 与 tests/unit/inlineSyntaxExtension.test.ts 的逐字节断言互补：这里验证
// setSource → 预览 DOM 的整条用户链路（渲染管线 + DOMPurify 净化后仍保留结构）。

import { test, expect, openEditor, setSource } from './fixtures';

test('混合文本：sup/sub/mark 存在，~~x~~ 为 del，emoji 替换，未知短代码字面', async ({ page }) => {
  await openEditor(page);
  await setSource(page, 'x^2^ 与 H~2~O，==重点==，:smile: 与 ~~删掉~~ 与 :nope:');

  await expect(page.locator('.md-preview sup')).toHaveText('2');
  await expect(page.locator('.md-preview sub')).toHaveText('2');
  await expect(page.locator('.md-preview mark')).toHaveText('重点');
  await expect(page.locator('.md-preview del')).toHaveText('删掉');
  // emoji 已替换为字符；未知短代码原样保留。
  await expect(page.locator('.md-preview')).toContainText('\u{1F604}');
  await expect(page.locator('.md-preview')).toContainText(':nope:');
});

test('表格单元格内可用，代码 span 内不转', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '| ==cell== | x^2^ |\n| --- | --- |\n| a~b~ | :smile: |\n\n`==x==` 保持代码');

  await expect(page.locator('.md-preview table td').first()).toContainText('a');
  await expect(page.locator('.md-preview th mark')).toHaveText('cell');
  await expect(page.locator('.md-preview th sup')).toHaveText('2');
  await expect(page.locator('.md-preview td sub')).toHaveText('b');
  await expect(page.locator('.md-preview td').last()).toContainText('\u{1F604}');
  // 代码 span：==x== 保持原样，不出现第二个 mark。
  await expect(page.locator('.md-preview code')).toHaveText('==x==');
  await expect(page.locator('.md-preview mark')).toHaveCount(1);
});
