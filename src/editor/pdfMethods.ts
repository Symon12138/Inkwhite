// @ts-nocheck
// 「导出 PDF」：不经过系统打印对话框，直接把预览渲染成 PDF 文件。
//
// 做法与长图同源：把预览克隆放进固定版心的宿主里量高度，交给 SVG <foreignObject>
// 让浏览器按导出 CSS 自行排版并光栅化，再按 A4 页面切成多页、无损压缩进 PDF。
// 排版、字体、纸色全部与预览同源，不另写渲染器。
// 纯计算（页面尺寸/边距解析/切页/PDF 字节）在 pdfComposer.ts，便于单测。
import {
  A4_PAGE,
  DEFAULT_PAGE_MARGIN_MM,
  mmToPx,
  mmToPt,
  pxToPt,
  parsePageMargin,
  planPdfBreaks,
  buildPdf,
  pdfFileName
} from './pdfComposer.ts';
import { tauriBridge } from './tauriBridge.ts';
import { inlineFontFaces } from './shareExportUtils.ts';
import { extractExportCss } from './exportComposer.ts';
import { resolveCssVariables } from './exportMethods.ts';

const AVOID_BREAK_SELECTOR = 'p, li, pre, blockquote, table, img, h1, h2, h3, h4, h5, h6, .mermaid-rendered, .katex-display';
const PDF_SCALES = [2, 1.5, 1];
const MAX_CANVAS_SIDE = 32000;
const MAX_CANVAS_AREA = 268435456;

function pickScale(width: number, height: number): number {
  return PDF_SCALES.find((scale) => {
    const w = width * scale;
    const h = height * scale;
    return w <= MAX_CANVAS_SIDE && h <= MAX_CANVAS_SIDE && w * h <= MAX_CANVAS_AREA;
  }) || 0;
}

// 每页一张位图：RGB 原始字节经 deflate 压缩（PDF FlateDecode，无损）。
async function compressRgb(rgb: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function canvasToRgb(canvas: HTMLCanvasElement): Uint8Array {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  const rgba = context.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source];
    rgb[target + 1] = rgba[source + 1];
    rgb[target + 2] = rgba[source + 2];
  }
  return rgb;
}

// 页面切片：把整张光栅化画布按页高裁到新画布（一张位图一页）。
function slicePage(source: HTMLCanvasElement, topDevice: number, heightDevice: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = Math.max(1, heightDevice);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, topDevice, source.width, heightDevice, 0, 0, source.width, heightDevice);
  return canvas;
}

// 版心块位置：用于把分页断点落在段落/表格/图边界，避免劈开一行字。
function collectBlocks(host: HTMLElement, hostTop: number): Array<{ top: number; height: number }> {
  const blocks: Array<{ top: number; height: number }> = [];
  for (const node of Array.from(host.querySelectorAll(AVOID_BREAK_SELECTOR))) {
    const rect = node.getBoundingClientRect();
    if (!(rect.height > 0)) continue;
    blocks.push({ top: rect.top - hostTop, height: rect.height });
  }
  return blocks;
}

export class PdfMethods {
  async onExportPdf() {
    const prev = this.previewRef.current;
    if (!prev) return;
    const wasBusy = this._pdfBusy;
    if (wasBusy) return;
    this._pdfBusy = true;
    this._setStatus('正在生成 PDF…');
    try {
      if (typeof this._awaitPreviewReady === 'function') await this._awaitPreviewReady();
      const bytes = await this._composePdf(prev);
      const name = pdfFileName(this._exportBaseName());
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      if (tauriBridge && tauriBridge.saveExportFile) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        await tauriBridge.saveExportFile(name, '', btoa(binary));
      } else {
        this._downloadBlob(new Blob([buffer], { type: 'application/pdf' }), name);
      }
      this._setStatus('✓ 已导出 PDF ' + name);
    } catch (error) {
      this._setStatus('PDF 导出失败 · ' + ((error && error.message) || error));
    } finally {
      this._pdfBusy = false;
    }
  }

  async _composePdf(preview) {
    const settings = this.settings || {};
    const margin = parsePageMargin(settings.exportPageMargin || '');
    const contentWidthMm = A4_PAGE.widthMm - margin.left - margin.right;
    const contentHeightMm = A4_PAGE.heightMm - margin.top - margin.bottom;
    const contentWidthPx = Math.max(1, Math.round(mmToPx(contentWidthMm)));
    const pageHeightPx = mmToPx(contentHeightMm);
    const { host, node } = await this._buildPdfPoster(preview, contentWidthPx, settings);
    try {
      const hostTop = host.getBoundingClientRect().top;
      const totalHeight = Math.max(1, node.offsetHeight);
      const scale = pickScale(contentWidthPx, totalHeight);
      if (!scale) throw new Error('内容过长，超出画布上限 · 建议拆分文档后导出');
      const blocks = collectBlocks(host, hostTop);
      const slices = planPdfBreaks(blocks, pageHeightPx, totalHeight);
      const canvas = await this._rasterizePdfPoster(node, contentWidthPx, totalHeight, scale, preview);
      const pages = [];
      for ( const slice of slices) {
        const topDevice = Math.round(slice.top * scale);
        const heightDevice = Math.max(1, Math.round(slice.height * scale));
        const pageCanvas = slicePage(canvas, topDevice, heightDevice);
        const stream = await compressRgb(canvasToRgb(pageCanvas));
        const heightPt = pxToPt(slice.height);
        pages.push({
          stream,
          filter: 'FlateDecode',
          widthPx: pageCanvas.width,
          heightPx: pageCanvas.height,
          xPt: mmToPt(margin.left),
          yPt: A4_PAGE.heightPt - mmToPt(margin.top) - heightPt,
          widthPt: pxToPt(contentWidthPx),
          heightPt
        });
      }
      return buildPdf(pages, { widthPt: A4_PAGE.widthPt, heightPt: A4_PAGE.heightPt });
    } finally {
      host.remove();
    }
  }

  async _buildPdfPoster(preview, contentWidthPx, settings) {
    const doc = preview.ownerDocument;
    const host = doc.createElement('div');
    host.setAttribute('data-pdf-measure-host', '');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + contentWidthPx + 'px;pointer-events:none;';
    const clone = preview.cloneNode(true);
    clone.className = 'md-preview';
    clone.removeAttribute('contenteditable');
    for (const node of Array.from(clone.querySelectorAll('.code-copy-btn, .table-edit-toolbar'))) node.remove();
    const computed = getComputedStyle(preview);
    clone.style.cssText = [
      'width:' + contentWidthPx + 'px',
      'max-width:none',
      'height:auto',
      'overflow:visible',
      'padding:0',
      'margin:0',
      'flex:none',
      'font-family:' + computed.fontFamily,
      'font-size:' + computed.fontSize,
      'line-height:' + (parseFloat(computed.lineHeight) / parseFloat(computed.fontSize) || 1.7),
      'letter-spacing:' + computed.letterSpacing,
      'color:' + computed.color,
      'background-color:' + computed.backgroundColor
    ].join(';');
    host.appendChild(clone);
    doc.body.appendChild(host);
    if (doc.fonts && doc.fonts.ready) {
      try { await doc.fonts.ready; } catch { /* fonts.ready 不 reject，防御性 */ }
    }
    return { host, node: clone };
  }

  async _rasterizePdfPoster(node, width, height, scale, preview) {
    const sheets = document.styleSheets;
    const computed = getComputedStyle(preview);
    const readVar = (name) => computed.getPropertyValue(name).trim();
    const css = resolveCssVariables(extractExportCss(sheets), readVar);
    const fontsCss = await inlineFontFaces(sheets);
    const { rasterizeNode } = await import('./shareExportUtils.ts');
    return rasterizeNode(node, {
      width,
      height,
      scale,
      css,
      fontsCss,
      wrapperClass: 'md-preview',
      paperColor: computed.backgroundColor || '#ffffff'
    });
  }
}
