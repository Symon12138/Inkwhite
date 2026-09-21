// @ts-nocheck
// 「导出 PDF」：不经过系统打印对话框，直接把预览渲染成 PDF 文件。
//
// 做法与长图同源：把预览克隆放进固定版心的宿主里量高度，交给 SVG <foreignObject>
// 让浏览器按导出 CSS 自行排版并光栅化，再按 A4 页面切成多页、无损压缩进 PDF。
// 排版、字体、纸色全部与预览同源，不另写渲染器。
//
// 长文必须分带渲染：一次性光栅化整篇会申请一张超高画布（几千万像素），
// 浏览器会长时间卡死甚至直接失败。这里按「带」渲染——每带只覆盖若干页的高度，
// 内存与耗时随页数线性增长。
// 纯计算（页面尺寸/边距解析/切页/PDF 字节）在 pdfComposer.ts，便于单测。
import {
  A4_PAGE,
  mmToPx,
  mmToPt,
  pxToPt,
  parsePageMargin,
  planPdfBreaks,
  buildPdf,
  pdfFileName
} from './pdfComposer.ts';
import { tauriBridge } from './tauriBridge.ts';
import { inlineFontFaces, stripCommentMarks, replaceFailedDiagrams } from './shareExportUtils.ts';
import { extractExportCss } from './exportComposer.ts';
import { resolveCssVariables } from './exportMethods.ts';

const AVOID_BREAK_SELECTOR = 'p, li, pre, blockquote, table, img, h1, h2, h3, h4, h5, h6, .mermaid-rendered, .katex-display';
const PDF_SCALES = [2, 1.5, 1];
const MAX_CANVAS_SIDE = 32000;
const MAX_CANVAS_AREA = 268435456;
// 单带设备像素高度上限：够放下数页，又不至于逼近画布上限。
const MAX_BAND_DEVICE_HEIGHT = 12000;

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

// 从带画布裁出单页：带内偏移换算成设备像素后原样拷贝。
function cropPage(band: HTMLCanvasElement, topDevice: number, heightDevice: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = band.width;
  canvas.height = Math.max(1, heightDevice);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(band, 0, topDevice, band.width, heightDevice, 0, 0, band.width, heightDevice);
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

// 把连续页归成带：一带的设备像素高度不超过上限，页数多时分多带渲染。
function planBands(slices: Array<{ top: number; height: number }>, scale: number, pageHeightPx: number) {
  const bands: Array<{ top: number; height: number; pages: Array<{ top: number; height: number }> }> = [];
  let current = null;
  for (const slice of slices) {
    if (current && (current.height + slice.height) * scale > MAX_BAND_DEVICE_HEIGHT) {
      bands.push(current);
      current = null;
    }
    if (!current) current = { top: slice.top, height: slice.height, pages: [] };
    current.pages.push(slice);
    current.height = slice.top + slice.height - current.top;
  }
  if (current) bands.push(current);
  return bands;
}

export class PdfMethods {
  async onExportPdf() {
    const prev = this.previewRef.current;
    if (!prev) return;
    if (this._pdfBusy) return;
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
    const contentWidthPx = Math.max(1, Math.round(mmToPx(A4_PAGE.widthMm - margin.left - margin.right)));
    const pageHeightPx = mmToPx(A4_PAGE.heightMm - margin.top - margin.bottom);
    const { host, node } = await this._buildPdfPoster(preview, contentWidthPx);
    try {
      const hostTop = host.getBoundingClientRect().top;
      const totalHeight = Math.max(1, node.offsetHeight);
      const blocks = collectBlocks(host, hostTop);
      const slices = planPdfBreaks(blocks, pageHeightPx, totalHeight);
      // 倍率按「带」而不是整篇挑：分带后单带很矮，长文也能保持清晰度。
      const scale = pickScale(contentWidthPx, Math.min(totalHeight, MAX_BAND_DEVICE_HEIGHT / 2));
      if (!scale) throw new Error('版心过宽，超出画布上限 · 请调大页边距后重试');
      const bands = planBands(slices, scale, pageHeightPx);
      const css = this._exportCss(preview);
      const fontsCss = await inlineFontFaces(document.styleSheets);
      const paperColor = getComputedStyle(preview).backgroundColor || '#ffffff';
      const pages = [];
      for (let index = 0; index < bands.length; index += 1) {
        this._setStatus('正在生成 PDF ' + (index + 1) + '/' + bands.length + '…');
        const band = bands[index];
        const canvas = await this._rasterizeBand(node, contentWidthPx, band, scale, css, fontsCss, paperColor);
        for (const slice of band.pages) {
          const topDevice = Math.round((slice.top - band.top) * scale);
          const heightDevice = Math.max(1, Math.round(slice.height * scale));
          const stream = await compressRgb(canvasToRgb(cropPage(canvas, topDevice, heightDevice)));
          const heightPt = pxToPt(slice.height);
          pages.push({
            stream,
            filter: 'FlateDecode',
            widthPx: canvas.width,
            heightPx: heightDevice,
            xPt: mmToPt(margin.left),
            yPt: A4_PAGE.heightPt - mmToPt(margin.top) - heightPt,
            widthPt: pxToPt(contentWidthPx),
            heightPt
          });
        }
      }
      return buildPdf(pages, { widthPt: A4_PAGE.widthPt, heightPt: A4_PAGE.heightPt });
    } finally {
      host.remove();
    }
  }

  // 导出样式只抽一次：分带渲染时重复抽取会明显拖慢长文导出。
  _exportCss(preview) {
    const computed = getComputedStyle(preview);
    const readVar = (name) => computed.getPropertyValue(name).trim();
    return resolveCssVariables(extractExportCss(document.styleSheets), readVar);
  }

  async _buildPdfPoster(preview, contentWidthPx) {
    const doc = preview.ownerDocument;
    const host = doc.createElement('div');
    host.setAttribute('data-pdf-measure-host', '');
    host.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + contentWidthPx + 'px;pointer-events:none;';
    const clone = preview.cloneNode(true);
    clone.className = 'md-preview';
    clone.removeAttribute('contenteditable');
    for (const node of Array.from(clone.querySelectorAll('.code-copy-btn, .table-edit-toolbar'))) node.remove();
    // 与 HTML/长图一致：批注标记默认剥离；失败图表换成占位文本（不把报错块画进 PDF）。
    stripCommentMarks(clone);
    replaceFailedDiagrams(clone);
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

  // 只渲染一条带：用 relative 位移把该带移到 foreignObject 顶部，再按带高定画布。
  async _rasterizeBand(node, width, band, scale, css, fontsCss, paperColor) {
    const { rasterizeNode } = await import('./shareExportUtils.ts');
    const bandHeight = Math.min(band.height, MAX_BAND_DEVICE_HEIGHT / scale);
    return rasterizeNode(node, {
      width,
      height: bandHeight,
      scale,
      css,
      fontsCss,
      wrapperClass: 'md-preview',
      wrapperStyle: 'position:relative;top:-' + band.top + 'px;',
      paperColor,
      // 取不回的图（跨源、断链）写成缺图说明，不留一段错位空白。
      onInlineFailed: (img, src) => {
        const missing = node.ownerDocument.createElement('div');
        missing.className = 'longimg-missing';
        missing.textContent = '图片未能载入 · ' + (img.getAttribute('alt') || src);
        img.replaceWith(missing);
      }
    });
  }
}
