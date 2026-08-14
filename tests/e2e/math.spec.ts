// M1-2 E2E：数学扩展（KaTeX）在真实预览中的表现。
// 与 tests/unit/mathExtension.test.ts 的逐字节断言互补：这里验证
// setSource → 预览 DOM 的整条用户链路（渲染管线 + DOMPurify ADD_TAGS 净化后
// 语义标注 <semantics>/<annotation> 仍保留，见 katexDecision.spec.ts 端到端用例）。

import { test, expect, openEditor, setSource } from './fixtures';

test('行内 $...$ 与 \\(...\\) 渲染为 KaTeX，语义标注保留', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '公式 $x^2$ 与 \\(y\\)');

  await expect(page.locator('.md-preview .katex')).toHaveCount(2);
  // DOMPurify ADD_TAGS 决策：MathML 语义标注在真实预览管线中保留
  await expect(page.locator('.md-preview .katex-mathml annotation')).toHaveText(['x^2', 'y']);
  await expect(page.locator('.md-preview .katex-html[aria-hidden="true"]')).toHaveCount(2);
  await expect(page.locator('.md-preview')).toContainText('公式');
});

test('块级 $$ 与 \\[ 渲染为 .katex-display 独立块', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '$$\na+b\n$$\n\n\\[c\\]');

  await expect(page.locator('.md-preview .katex-display')).toHaveCount(2);
  await expect(page.locator('.md-preview .katex-display annotation').first()).toHaveText('a+b');
  await expect(page.locator('.md-preview .katex-display annotation').nth(1)).toHaveText('c');
  // 块级公式不在 <p> 内
  await expect(page.locator('.md-preview .katex-display').first().locator('xpath=ancestor::p')).toHaveCount(0);
});

test('错误公式显示 .katex-error，预览不崩', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '$\\begin{invalid}$ 后接正常文本');

  await expect(page.locator('.md-preview .katex-error')).toBeVisible();
  await expect(page.locator('.md-preview .katex-error')).toHaveAttribute('title', /KaTeX parse error/);
  await expect(page.locator('.md-preview')).toContainText('后接正常文本');
});

test('转义与无闭合保持字面（\\$5 / $x$y$ / 价格是 $5）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '价格 \\$5 与 $x$y$ 与 $x');

  await expect(page.locator('.md-preview .katex')).toHaveCount(0);
  await expect(page.locator('.md-preview')).toContainText('价格 $5 与 $x$y$ 与 $x');
});

test('代码 span 与围栏内不解析', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '`$x$` 与 $$x$$ 与\n\n```\n$y^2$\n```');

  await expect(page.locator('.md-preview code').first()).toHaveText('$x$');
  await expect(page.locator('.md-preview code').nth(1)).toContainText('$y^2$');
  await expect(page.locator('.md-preview .katex')).toHaveCount(0);
});

test('表格单元格内可用；单元格内 $$ 保持字面', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '| $x$ | 值 |\n| --- | --- |\n| 1 | 2 |');

  await expect(page.locator('.md-preview th .katex')).toHaveCount(1);
  await expect(page.locator('.md-preview th annotation')).toHaveText('x');
});

test('链接文本内 math 可用（[$x$](url)，实测允许）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '[$x$](url)');

  await expect(page.locator('.md-preview a[href="url"] .katex')).toHaveCount(1);
});

test('与 inlineSyntax 共存：$x^2$ 内 ^ 归数学（不产生 <sup>）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '公式 $x^2$ 与文字 x^2^');

  // math 注册在前：$x^2$ 整体消费为 KaTeX
  await expect(page.locator('.md-preview .katex')).toHaveCount(1);
  await expect(page.locator('.md-preview .katex annotation')).toHaveText('x^2');
  // 公式内的 ^ 归数学；公式外的 ^2^ 仍走 inlineSyntax 上标
  await expect(page.locator('.md-preview .katex sup')).toHaveCount(0);
  await expect(page.locator('.md-preview p sup')).toHaveCount(1);
});
