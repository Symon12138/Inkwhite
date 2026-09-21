import { test, expect, openEditor, setSource, clickMenubarItem } from './fixtures';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// 长文：确保跨多页，能验证分页与每页都有内容。
const LONG_DOC = Array.from({ length: 40 }, (_, i) =>
  '## 第 ' + (i + 1) + ' 节标题' + String.fromCharCode(10) + String.fromCharCode(10) +
  '这是第 ' + (i + 1) + ' 段正文，含**加粗**与*斜体*，用于验证导出为多页 PDF 时排版与内容都完整。'
).join(String.fromCharCode(10) + String.fromCharCode(10));

test('导出 PDF：直接生成文件（不再调用打印对话框）', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    (window as any).__printCalled = false;
    window.print = () => { (window as any).__printCalled = true; };
  });
  await setSource(page, LONG_DOC);
  await page.locator('.md-preview').evaluate((el) => el.__awaitPreviewReady());
  const download = page.waitForEvent('download');
  await clickMenubarItem(page, 'file', '导出 PDF');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  expect(await page.evaluate(() => (window as any).__printCalled)).toBe(false);
  await file.cancel();
});

test('导出 PDF：字节结构合法、多页、每页位图含文字像素', async ({ page }, info) => {
  await openEditor(page);
  await setSource(page, LONG_DOC);
  await page.locator('.md-preview').evaluate((el) => el.__awaitPreviewReady());
  const download = page.waitForEvent('download');
  await clickMenubarItem(page, 'file', '导出 PDF');
  const path = info.outputPath('飞白导出样例.pdf');
  await (await download).saveAs(path);
  const buffer = readFileSync(path);
  const text = buffer.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(text).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  const pageCount = Number(/\/Count (\d+)/.exec(text)![1]);
  expect(pageCount).toBeGreaterThan(1);
  const startxref = Number(/startxref\s+(\d+)/.exec(text)![1]);
  expect(text.slice(startxref, startxref + 4)).toBe('xref');

  // 逐页解压 FlateDecode 位图：尺寸自洽且确实画了深色文字像素（不是空白页）。
  const marker = /<< \/Type \/XObject \/Subtype \/Image \/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/g;
  const pages: Array<{ width: number; height: number; rgb: Buffer }> = [];
  let match: RegExpExecArray | null;
  while ((match = marker.exec(text))) {
    const start = match.index + match[0].length;
    const length = Number(match[3]);
    pages.push({ width: Number(match[1]), height: Number(match[2]), rgb: inflateSync(buffer.subarray(start, start + length)) });
  }
  expect(pages).toHaveLength(pageCount);
  for (const [index, page] of pages.entries()) {
    expect(page.rgb.length, '第 ' + (index + 1) + ' 页字节数应与宽高自洽').toBe(page.width * page.height * 3);
    let dark = 0;
    for (let offset = 0; offset < page.rgb.length; offset += 3) {
      if (page.rgb[offset] < 128 && page.rgb[offset + 1] < 128 && page.rgb[offset + 2] < 128) dark += 1;
    }
    expect(dark, '第 ' + (index + 1) + ' 页必须有文字像素').toBeGreaterThan(200);
  }
});
