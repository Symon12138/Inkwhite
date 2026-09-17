import { test, expect, openEditor, setSource } from './fixtures';
import { writeFileSync } from 'node:fs';

test('HTML 离线重开保留预览容器、字号、标题、代码和表格样式', async ({ page, context }, info) => {
  await openEditor(page);
  await setSource(page, "# 标题\n\n正文 **加粗** ==高亮==\n\n> 引用\n\n- 列表\n\n| A | B |\n|---|---|\n| 一 | 二 |\n\n~~~js\nconst n = 42;\n~~~");
  await page.getByRole('button', { name: '放大正文字号', exact: true }).click();
  const selectors = ['.md-preview', '.md-preview h1', '.md-preview p', '.md-preview strong', '.md-preview blockquote', '.md-preview pre', '.md-preview th'];
  const props = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'backgroundColor', 'letterSpacing', 'borderBottomStyle'];
  const result = await page.evaluate(async ({ selectors, props }) => {
    const preview = document.querySelector('.md-preview')!;
    await preview.__awaitPreviewReady();
    const before = selectors.map((s: string) => props.map((p: string) => (getComputedStyle(document.querySelector(s)!) as unknown as Record<string, string>)[p]));
    const { exportHtmlFromPreview } = await import('/src/editor/exportMethods.ts');
    const result = await exportHtmlFromPreview(preview, { title: '格式保真验证' });
    return { ...result, before };
  }, { selectors, props });
  writeFileSync(info.outputPath('preview-fidelity.html'), result.html);
  const exportedBefore = result.before;
  const exported = await context.newPage();
  await exported.setContent(result.html);
  await expect(exported.locator('.md-preview')).toHaveCount(1);
  const after = await exported.evaluate(({ selectors, props }) => selectors.map(s => {
    const c = getComputedStyle(document.querySelector(s)!);
    return props.map(p => c[p]);
  }), { selectors, props });
  expect(after).toEqual(exportedBefore);
  await expect(exported.locator('.code-copy-btn')).toHaveCount(0);
  await exported.close();
});
