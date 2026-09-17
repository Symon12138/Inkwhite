import { test, expect, openEditor, setSource } from './fixtures';
test('Word 公式图片有墨迹且图表尺寸合理', async ({ page }) => {
await openEditor(page);
await setSource(page, "$E=mc^2$\n\n~~~mermaid\ngraph TD; A[编辑]-->B[导出];\n~~~");
await page.locator('.md-preview').evaluate(el => el.__awaitPreviewReady());
const expectedWidth = await page.locator('.mermaid-rendered svg').evaluate(el => el.getBoundingClientRect().width);
const results = await page.evaluate(async () => {
const { captureWordStyles } = await import('/src/editor/wordExportStyles.ts');
const { flattenForWord, renderWordImages, captureWordImageGeometry } = await import('/src/editor/flattenDocument.ts');
const { extractExportCss } = await import('/src/editor/exportComposer.ts');
const { resolveCssVariables } = await import('/src/editor/exportMethods.ts');
const { inlineFontFaces } = await import('/src/editor/shareExportUtils.ts');
const preview = document.querySelector('.md-preview')!;
const clone = preview.cloneNode(true) as Element;
const mathBefore = clone.querySelector('.katex')!.outerHTML;
const graphBefore = clone.querySelector('.mermaid-rendered')!.outerHTML;
captureWordStyles(preview, clone);
if (clone.querySelector('.katex')!.outerHTML !== mathBefore || clone.querySelector('.mermaid-rendered')!.outerHTML !== graphBefore) throw new Error('Word 样式捕获不能改写公式或图表内部排版');
captureWordImageGeometry(preview, clone);
const { images } = flattenForWord(clone); const computed = getComputedStyle(preview);
const css = resolveCssVariables(extractExportCss(document.styleSheets), name => computed.getPropertyValue(name).trim());
const fontsCss = await inlineFontFaces(document.styleSheets, { filter: face => /KaTeX_/.test(face) });
await renderWordImages(images, { css, fontsCss, fontSizePx: parseFloat(computed.fontSize) });
return Promise.all(images.map(async entry => {
const img = new Image(); img.src = entry.dataUrl; await img.decode();
const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
let ink = 0; for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i], pixels[i+1], pixels[i+2]) < 180 && pixels[i+3] > 128) ink++;
let edgeInk = 0;
for (let x = 0; x < img.width; x++) { const i = ((img.height - 1) * img.width + x) * 4; if (Math.min(pixels[i], pixels[i+1], pixels[i+2]) < 180) edgeInk++; }
return { width: entry.widthPx, height: entry.heightPx, ink, edgeInk, ratio: ink / (img.width * img.height) };
})); });
expect(results).toHaveLength(2);
expect(results[0].ink, JSON.stringify(results)).toBeGreaterThan(100);
expect(results[0].edgeInk, "公式底边不能截断字形").toBe(0);
expect(results[1].width, JSON.stringify(results)).toBeCloseTo(expectedWidth, 0);
expect(results[1].ink, JSON.stringify(results)).toBeGreaterThan(500);
});