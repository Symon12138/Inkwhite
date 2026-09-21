import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  A4_PAGE,
  mmToPt,
  mmToPx,
  pxToPt,
  parsePageMargin,
  planPdfPages,
  planPdfBreaks,
  buildPdf,
  pdfFileName
} from '../../src/editor/pdfComposer.ts';

test('单位换算：mm/pt/px 与 A4 页面尺寸', () => {
  assert.equal(Math.round(mmToPt(25.4)), 72);
  assert.equal(Math.round(pxToPt(96)), 72);
  assert.equal(Math.round(mmToPx(25.4)), 96);
  assert.equal(A4_PAGE.widthPt, 595.28);
  assert.equal(A4_PAGE.heightPt, 841.89);
});

test('parsePageMargin 支持 1/2/3/4 值与多单位，非法回退默认', () => {
  assert.deepEqual(parsePageMargin('14mm 16mm'), { top: 14, right: 16, bottom: 14, left: 16 });
  assert.deepEqual(parsePageMargin('10mm'), { top: 10, right: 10, bottom: 10, left: 10 });
  assert.deepEqual(parsePageMargin('1mm 2mm 3mm'), { top: 1, right: 2, bottom: 3, left: 2 });
  assert.deepEqual(parsePageMargin('1mm 2mm 3mm 4mm'), { top: 1, right: 2, bottom: 3, left: 4 });
  assert.deepEqual(parsePageMargin('2cm'), { top: 20, right: 20, bottom: 20, left: 20 });
  assert.deepEqual(parsePageMargin('bad'), { top: 14, right: 16, bottom: 14, left: 16 });
  assert.deepEqual(parsePageMargin(''), { top: 14, right: 16, bottom: 14, left: 16 });
});

test('planPdfPages 等分切页，尾部不足一页也成页', () => {
  assert.deepEqual(planPdfPages(0, 100), [{ top: 0, height: 100 }]);
  const pages = planPdfPages(250, 100);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0], { top: 0, height: 100 });
  assert.deepEqual(pages[2], { top: 200, height: 50 });
});

test('planPdfBreaks 落在块边界，超高块退化为页内切分', () => {
  const blocks = [{ top: 0, height: 60 }, { top: 60, height: 60 }, { top: 120, height: 60 }, { top: 180, height: 40 }];
  const pages = planPdfBreaks(blocks, 100, 220);
  assert.deepEqual(pages[0], { top: 0, height: 60 });
  assert.deepEqual(pages[1], { top: 60, height: 60 });
  assert.deepEqual(pages[2], { top: 120, height: 100 });
  const tall = planPdfBreaks([{ top: 0, height: 250 }], 100, 250);
  assert.equal(tall.length, 3);
  assert.equal(tall[2].height, 50);
});

test('buildPdf 产出合法 PDF：头部、页数、图像滤镜、xref 偏移与 EOF', () => {
  const stream = new Uint8Array([0x78, 0x9c, 1, 2, 3]);
  const page = { stream, filter: 'FlateDecode' as const, widthPx: 2, heightPx: 2, xPt: 10, yPt: 20, widthPt: 100, heightPt: 200 };
  const bytes = buildPdf([page, page], { widthPt: A4_PAGE.widthPt, heightPt: A4_PAGE.heightPt });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Type \/Pages \/Count 2/);
  assert.match(text, /\/Filter \/FlateDecode/);
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text, /q 100 0 0 200 10 20 cm \/Im0 Do Q/);
  const startxref = Number(/startxref\s+(\d+)/.exec(text)![1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const offsets = [...text.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
  // 目录 1 + 页树 1 + 每页 3 个对象（页/内容流/图像）
  assert.equal(offsets.length, 8);
  for (const offset of offsets) assert.match(text.slice(offset, offset + 12), /^\d+ 0 obj/);
  assert.equal(bytes.length, text.length);
});

test('pdfFileName 去除 md 后缀并清理非法字符', () => {
  assert.equal(pdfFileName('文档.md'), '文档.pdf');
  assert.equal(pdfFileName('a/b:c'), 'a b c.pdf');
  assert.equal(pdfFileName(''), '导出.pdf');
});
