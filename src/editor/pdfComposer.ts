// 纯前端 PDF 生成：把预览光栅化的页面图写成合法 PDF 字节（不经过系统打印对话框）。
// 这里只做可预测的计算与字节拼装（mm/pt/px 换算、分页切点、PDF 对象与 xref），
// 光栅化与压缩在 pdfMethods.ts（浏览器侧）。单测见 tests/unit/pdfComposer.test.ts。

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;
export const CSS_PX_PER_INCH = 96;

// A4 纵向：210×297mm。
export const A4_PAGE = {
  widthMm: 210,
  heightMm: 297,
  widthPt: 595.28,
  heightPt: 841.89
};

export const DEFAULT_PAGE_MARGIN_MM = { top: 14, right: 16, bottom: 14, left: 16 };

export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

export function pxToPt(px: number): number {
  return (px / CSS_PX_PER_INCH) * PT_PER_INCH;
}

export function mmToPx(mm: number): number {
  return (mm / MM_PER_INCH) * CSS_PX_PER_INCH;
}

export interface PageMarginMm { top: number; right: number; bottom: number; left: number }

const MARGIN_TOKEN = /^(-?\d+(?:\.\d+)?)(mm|cm|in|pt|px)?$/;

function marginToMm(token: string): number | null {
  const match = MARGIN_TOKEN.exec(token.trim().toLowerCase());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = match[2] || 'mm';
  if (unit === 'mm') return value;
  if (unit === 'cm') return value * 10;
  if (unit === 'in') return value * MM_PER_INCH;
  if (unit === 'pt') return (value / PT_PER_INCH) * MM_PER_INCH;
  return (value / CSS_PX_PER_INCH) * MM_PER_INCH;
}

// 与 CSS margin 同语法：1 值全边、2 值上下/左右、3 值上/左右/下、4 值上右下左。
export function parsePageMargin(input: string): PageMarginMm {
  const tokens = String(input || '').trim().split(/\s+/).filter(Boolean);
  const values = tokens.map(marginToMm);
  if (!values.length || values.some((value) => value === null)) return { ...DEFAULT_PAGE_MARGIN_MM };
  const [a, b = a, c = a, d = b] = values as number[];
  if (tokens.length === 2) return { top: a, right: b, bottom: a, left: b };
  if (tokens.length === 3) return { top: a, right: b, bottom: c, left: b };
  return { top: a, right: b, bottom: c, left: d };
}

export interface PdfPageSlice { top: number; height: number }

// 简单等分切页：尾部不足一页也单独成页（块感知切页见 planPdfBreaks）。
export function planPdfPages(totalHeight: number, pageHeight: number): PdfPageSlice[] {
  const step = Math.max(pageHeight, 1);
  // 空文档也给满一页，避免生成 1px 高的畸形页。
  const total = totalHeight > 0 ? totalHeight : step;
  const pages: PdfPageSlice[] = [];
  for (let top = 0; top < total; top += step) {
    pages.push({ top, height: Math.min(step, total - top) });
  }
  return pages.length ? pages : [{ top: 0, height: total }];
}

export interface PdfBlock { top: number; height: number }

// 块感知切页：尽量落在块边界，避免把一行文字或一张图从中间切开。
// 单个块高于一页时退化为页内等分，保证不会死循环。
export function planPdfBreaks(blocks: PdfBlock[], pageHeight: number, totalHeight: number): PdfPageSlice[] {
  const step = Math.max(pageHeight, 1);
  const total = Math.max(totalHeight, 1);
  const breaks: number[] = [0];
  let cursor = 0;
  const sorted = blocks.filter((b) => b.height > 0).sort((a, b) => a.top - b.top);
  while (cursor < total - 0.5) {
    const limit = cursor + step;
    // 余下内容装得下一页：直接收尾，不必再找块边界。
    let next = limit >= total ? total : 0;
    if (!next) {
      // 取页内最后一个块起点作断点：宁可该页留白，也不把块劈成两半。
      for (const block of sorted) {
        if (block.top > cursor + 0.5 && block.top <= limit) next = block.top;
      }
    }
    if (next <= cursor + 0.5) next = Math.min(limit, total);
    breaks.push(next);
    cursor = next;
  }
  const slices: PdfPageSlice[] = [];
  for (let index = 0; index < breaks.length - 1; index += 1) {
    const top = breaks[index];
    slices.push({ top, height: breaks[index + 1] - top });
  }
  return slices.length ? slices : [{ top: 0, height: total }];
}

export interface PdfImagePage {
  /** 已压缩的图像字节（FlateDecode 为 zlib/deflate；DCTDecode 为 JPEG） */
  stream: Uint8Array;
  filter: 'FlateDecode' | 'DCTDecode';
  /** 位图尺寸（设备像素） */
  widthPx: number;
  heightPx: number;
  /** 在页面上的位置与显示尺寸（pt，左下角原点） */
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}
export interface PdfDocumentOptions { widthPt: number; heightPt: number }

const encoder = new TextEncoder();

function textBytes(text: string): Uint8Array {
  // PDF 语法部分全是 ASCII/拉丁字符，逐个取低字节即可（不引入 UTF-8 多字节）。
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff;
  return out;
}

function num(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

// 极简 PDF 1.4 写出器：每页一张图像 XObject，xref 表按真实字节偏移生成。
// 字节按块累积后一次拼接：图像流有数 MB，绝不能走 push(...bytes) 展开（会爆栈）。
export function buildPdf(pages: PdfImagePage[], options: PdfDocumentOptions): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const total = pages.length;
  const push = (bytes: Uint8Array) => { parts.push(bytes); length += bytes.length; };
  const pushText = (text: string) => { push(textBytes(text)); };
  const startObject = (id: number) => { offsets[id] = length; pushText(id + ' 0 obj\n'); };
  const endObject = () => { pushText('endobj\n'); };
  pushText('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

  const pageIds = pages.map((_, index) => 3 + index * 3);
  const pagesId = 2;
  const catalogId = 1;

  startObject(catalogId);
  pushText('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>\n');
  endObject();

  startObject(pagesId);
  pushText('<< /Type /Pages /Count ' + total + ' /Kids [' + pageIds.map((id) => id + ' 0 R').join(' ') + '] >>\n');
  endObject();

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const content = 'q ' + num(page.widthPt) + ' 0 0 ' + num(page.heightPt) + ' ' + num(page.xPt) + ' ' + num(page.yPt) + ' cm /Im0 Do Q\n';
    const contentBytes = textBytes(content);

    startObject(pageId);
    pushText('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + num(options.widthPt) + ' ' + num(options.heightPt) + '] '
      + '/Resources << /XObject << /Im0 ' + imageId + ' 0 R >> >> /Contents ' + contentId + ' 0 R >>\n');
    endObject();

    startObject(contentId);
    pushText('<< /Length ' + contentBytes.length + ' >>\nstream\n');
    push(contentBytes);
    pushText('endstream\n');
    endObject();

    startObject(imageId);
    pushText('<< /Type /XObject /Subtype /Image /Width ' + page.widthPx + ' /Height ' + page.heightPx
      + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /' + page.filter + ' /Length ' + page.stream.length + ' >>\nstream\n');
    push(page.stream);
    pushText('\nendstream\n');
    endObject();
  });

  const xrefStart = length;
  const size = 3 + total * 3;
  pushText('xref\n0 ' + size + '\n0000000000 65535 f \n');
  for (let id = 1; id < size; id += 1) {
    pushText(String(offsets[id] || 0).padStart(10, '0') + ' 00000 n \n');
  }
  pushText('trailer\n<< /Size ' + size + ' /Root ' + catalogId + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF\n');

  const out = new Uint8Array(length);
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.length; }
  return out;
}


export function pdfFileName(title: string): string {
  const base = String(title || '')
    .replace(/\.md$/i, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '导出';
  return base + '.pdf';
}
