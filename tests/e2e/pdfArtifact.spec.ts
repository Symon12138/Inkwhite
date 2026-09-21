import { test, expect, openEditor, setSource, clickMenubarItem } from './fixtures';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

test('生成 PDF 样例并校验分页与像素', async ({ page }, info) => {
  await openEditor(page);
  const doc = ['# 飞白 PDF 导出样例', '', '正文含**加粗**与*斜体*，以及 `行内代码`。', '', '> 引用段落', '', '| 列A | 列B |', '|---|---|', '| 值1 | 值2 |', '', '~~~js', 'const a = 1;', '~~~', '', '$E=mc^2$'].join(String.fromCharCode(10));
  await setSource(page, doc);
  await page.locator('.md-preview').evaluate(el => el.__awaitPreviewReady());
  const download = page.waitForEvent('download');
  await clickMenubarItem(page, 'file', '导出 PDF');
  const path = info.outputPath('飞白PDF样例.pdf');
  await (await download).saveAs(path);
  const buffer = readFileSync(path);
  const text = buffer.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  const pageCount = Number(/\/Count (\d+)/.exec(text)![1]);
  const marker = /<< \/Type \/XObject \/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*\/Length (\d+) >>\nstream\n/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = marker.exec(text))) {
    const start = match.index + match[0].length;
    const rgb = inflateSync(buffer.subarray(start, start + Number(match[3])));
    let dark = 0;
    for (let o = 0; o < rgb.length; o += 3) if (rgb[o] < 128 && rgb[o + 1] < 128 && rgb[o + 2] < 128) dark += 1;
    console.log('PAGE ' + (index + 1) + ' ' + match[1] + 'x' + match[2] + ' dark=' + dark + ' bytes=' + rgb.length);
    expect(dark).toBeGreaterThan(200);
    index += 1;
  }
  console.log('PAGES ' + pageCount + ' media=' + index + ' fileBytes=' + buffer.length);
  expect(index).toBe(pageCount);
});
