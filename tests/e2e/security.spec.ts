import { test, expect, openEditor, setSource } from './fixtures';

// S0.1 DOMPurify 净化基线（浏览器层）。
// Node 无 DOM，DOMPurify 在单测环境不可用，因此净化断言放在 E2E 钉死。

test('预览清除 script 与事件属性（XSS 载荷不进入预览）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '<script>window.__xss = 1</script>\n\n<img src="x" onerror="window.__xss = 2">\n\n<p onclick="window.__xss = 3">正文</p>');

  const previewHtml = await page.locator('.md-preview').evaluate((el) => el.innerHTML);
  expect(previewHtml).not.toMatch(/<script/i);
  expect(previewHtml).not.toMatch(/onerror|onclick/i);
  expect(previewHtml).toContain('正文');
  const xss = await page.evaluate(() => (window as any).__xss ?? 0);
  expect(xss).toBe(0);
});

test('预览管线保留 KaTeX MathML semantics/annotation（M1 WP4 决策：ADD_TAGS）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '<math><semantics><mrow><mi>x</mi></mrow><annotation>\\text{x}</annotation></semantics></math>');

  const previewHtml = await page.locator('.md-preview').evaluate((el) => el.innerHTML);
  // M1 起预览管线 DOMPurify 配置 ADD_TAGS: ['semantics','annotation']
  // （viewMethods._renderPreview，见 katexDecision.spec.ts），语义标注在预览中保留；
  // 该配置不引入脚本/事件属性，XSS 防护由本文件其余用例继续覆盖。
  expect(previewHtml).toMatch(/<semantics/i);
  expect(previewHtml).toMatch(/<annotation/i);
  expect(previewHtml).not.toMatch(/<script/i);
  expect(previewHtml).not.toMatch(/onerror|onclick/i);
});

test('DOMPurify 保留 span 的 class 与 inline style（批注高亮依赖）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '<span class="keep" style="color:rgb(255, 0, 0)">t</span>');

  const span = page.locator('.md-preview span.keep');
  await expect(span).toBeVisible();
  await expect(span).toHaveCSS('color', 'rgb(255, 0, 0)');
});
