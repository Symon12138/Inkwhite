import { test, expect, openEditor, setSource } from './fixtures';

test('Word captures rendered preview typography without modifying the live preview', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# Heading\n\nBody **bold** and ~~removed~~.\n\n> Quote');
  await expect(page.locator('.md-preview h1')).toHaveText('Heading');
  const result = await page.evaluate(async () => {
    const { captureWordStyles } = await import('/src/editor/wordExportStyles.ts');
    const preview = document.querySelector('.md-preview') as HTMLElement;
    preview.style.fontFamily = '"Noto Serif SC", serif';
    preview.style.fontSize = '22px';
    const original = preview.outerHTML;
    const clone = preview.cloneNode(true) as HTMLElement;
    captureWordStyles(preview, clone);
    const body = preview.querySelector('p')!;
    return {
      unchanged: preview.outerHTML === original,
      font: clone.style.fontFamily,
      size: clone.querySelector('p')!.style.fontSize,
      expectedSize: getComputedStyle(body).fontSize,
      headingSize: clone.querySelector('h1')!.style.fontSize,
      expectedHeadingSize: getComputedStyle(preview.querySelector('h1')!).fontSize,
      weight: clone.querySelector('strong')!.style.fontWeight,
      strike: clone.querySelector('del')!.style.textDecorationLine
    };
  });
  expect(result.unchanged).toBe(true);
  expect(result.font).toContain('Noto Serif SC');
  expect(result.size).toBe(result.expectedSize);
  expect(result.headingSize).toBe(result.expectedHeadingSize);
  expect(Number(result.weight)).toBeGreaterThanOrEqual(600);
  expect(result.strike).toContain('line-through');
});
