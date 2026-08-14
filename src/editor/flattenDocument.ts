// M2-EXPORT-CORE：Word 中间管线——预览克隆的扁平化单文档。
// 两段式图片处理（collect 纯逻辑可 node 单测；render 为浏览器端光栅化）：
//   1. flattenForWord / collectWordImages：剥离批注(DG4)、失败图表占位(DG9)、
//      代码高亮 span 压平为纯文本（保留 pre 结构）、KaTeX/Mermaid 标记替换为
//      占位节点（data-word-image 属性 + 原始节点引用）；
//   2. renderWordImages：把占位对应的原始节点光栅化为 PNG（rasterizeNode，
//      shareExportUtils），data URL 与 CSS px 尺寸回填到 WordImage。
// 消费方（wordExport.buildDocx）按 key 把占位节点映射为 ImageRun。
//
// 标记替换规则：
//   - .katex（行内公式）→ 占位 span，节点即 .katex；
//   - .katex-display（块级公式）→ 占位 span，节点取内层 .katex（收缩适配），
//     对齐 center；
//   - .mermaid-rendered → 占位 span，节点取内层 svg，对齐 left；
//   - .katex-error（KaTeX 错误公式）不是 .katex，保留为文本（与预览错误态一致）。

import { stripCommentMarks, replaceFailedDiagrams, rasterizeNode } from './shareExportUtils.ts';

/** Word 侧失败图表占位文案（无附录概念，用短文案） */
export const WORD_FAILED_DIAGRAM_TEXT = '图表渲染失败';

/** 光栅化产物在 Word 文档中的对齐方式 */
export type WordImageAlign = 'inline' | 'center' | 'left';

export interface WordImage {
  /** 稳定 key（文档序生成 w0/w1/…），占位节点的 data-word-image 属性值 */
  key: string;
  /** PNG data URL；由 renderWordImages 阶段填入 */
  dataUrl: string;
  /** CSS px 尺寸（docx ImageRun transformation 用） */
  widthPx: number;
  heightPx: number;
  align: WordImageAlign;
  /** 原始节点（KaTeX span / Mermaid svg），已脱离树，供光栅化 */
  node: Element | null;
  /** 树内占位节点（span[data-word-image=key]） */
  placeholder: Element | null;
  /** 光栅化失败标记（buildDocx 输出占位文本，DG9 Word 出口） */
  failed: boolean;
}

/**
 * 两段式 collect 阶段：把 KaTeX/Mermaid 节点标记替换为占位节点并登记图片条目。
 * 纯 DOM 变换（node 单测直接覆盖）；不碰布局/光栅化。
 */
export function collectWordImages(root: Element): WordImage[] {
  const images: WordImage[] = [];
  const candidates = Array.from(root.querySelectorAll('.katex-display, .katex, .mermaid-rendered'));
  let index = 0;
  for (const el of candidates) {
    const classes = (el.getAttribute('class') || '').split(/\s+/);
    let node: Element | null = el;
    let align: WordImageAlign = 'inline';
    if (classes.includes('katex')) {
      // 块级公式的外层 .katex-display 已收录，内层 .katex 跳过（closest 去重）
      if (el.closest('.katex-display')) continue;
      align = 'inline';
    } else if (classes.includes('katex-display')) {
      node = el.querySelector('.katex') ?? el;
      align = 'center';
    } else if (classes.includes('mermaid-rendered')) {
      node = el.querySelector('svg') ?? el;
      align = 'left';
    }
    const key = 'w' + index;
    index += 1;
    const placeholder = root.ownerDocument.createElement('span');
    placeholder.setAttribute('data-word-image', key);
    el.replaceWith(placeholder);
    images.push({ key, dataUrl: '', widthPx: 0, heightPx: 0, align, node, placeholder, failed: false });
  }
  return images;
}

/**
 * 代码高亮 span（.syntax-*，viewMethods._highlightCodeBlocks 产物）压平为纯文本，
 * 保留 pre/code 结构（Word 里代码按等宽段落输出，不需要着色 span）。
 */
export function flattenSyntaxSpans(root: Element): void {
  for (const span of Array.from(root.querySelectorAll('span[class*="syntax-"]'))) {
    span.replaceWith(...span.childNodes);
  }
}

export interface FlattenForWordResult {
  /** 扁平化后的文档树（原地变换，即传入的克隆） */
  root: Element;
  /** 待光栅化的公式/图表条目（dataUrl 由 renderWordImages 填入） */
  images: WordImage[];
}

/**
 * Word 中间管线主入口：DG4 剥离批注 → DG9 失败图表占位 → 代码高亮压平 →
 * KaTeX/Mermaid 标记替换。表格/标题/列表结构原样保留。
 */
export function flattenForWord(clone: Element): FlattenForWordResult {
  stripCommentMarks(clone);
  replaceFailedDiagrams(clone, { text: WORD_FAILED_DIAGRAM_TEXT });
  flattenSyntaxSpans(clone);
  const images = collectWordImages(clone);
  return { root: clone, images };
}

// ─────────────────────────────────────────────────────────────────────────────
// 两段式 render 阶段（浏览器端：布局测量 + 光栅化，E2E 覆盖）
// ─────────────────────────────────────────────────────────────────────────────
export interface RenderWordImagesOptions {
  /** 布局样式（extractExportCss + freezeCssVariables 的拼接；KaTeX 排版必需） */
  css?: string;
  /** 内联 @font-face（inlineFontFaces 输出；KaTeX 字形必需） */
  fontsCss?: string;
  /** 光栅化倍率，默认 2 */
  scale?: number;
  /** 阅读字号（px）；与预览一致地传给测量宿主与光栅上下文 */
  fontSizePx?: number;
  /** 自定义测量宿主（默认创建隐藏宿主并回收） */
  host?: HTMLElement;
}

/**
 * 两段式 render 阶段：逐个把原始节点挂到隐藏测量宿主（取真实布局尺寸，
 * 含 svg 的 width/viewBox 兜底），再用 rasterizeNode 光栅化为 PNG data URL，
 * 回填 WordImage.dataUrl/widthPx/heightPx；失败置 failed（buildDocx 输出占位文本）。
 */
export async function renderWordImages(
  images: WordImage[],
  opts: RenderWordImagesOptions = {}
): Promise<WordImage[]> {
  const doc = (images[0]?.placeholder?.ownerDocument) ?? document;
  const host = opts.host ?? createMeasureHost(doc);
  const style = doc.createElement('style');
  style.textContent = [opts.fontsCss, opts.css].filter(Boolean).join('\n');
  const wrapper = doc.createElement('div');
  wrapper.className = 'md-preview';
  if (opts.fontSizePx) wrapper.style.fontSize = opts.fontSizePx + 'px';
  host.appendChild(style);
  host.appendChild(wrapper);
  if (doc.fonts && doc.fonts.ready) {
    // 字体没就位时量到的宽度会偏小；数据 URL 字体加载是异步的，先等就绪
    try { await doc.fonts.ready; } catch { /* fonts.ready 理论不 reject，防御性吞掉 */ }
  }
  const scale = opts.scale ?? 2;
  for (const entry of images) {
    if (!entry.node) continue;
    wrapper.appendChild(entry.node);
    const box = measureWordNode(entry.node);
    wrapper.removeChild(entry.node);
    if (!(box.width > 0) || !(box.height > 0)) {
      entry.failed = true;
      continue;
    }
    try {
      const canvas = await rasterizeNode(entry.node, {
        width: box.width,
        height: box.height,
        scale,
        css: opts.css,
        fontsCss: opts.fontsCss,
        wrapperClass: 'md-preview',
        wrapperStyle: opts.fontSizePx ? 'font-size:' + opts.fontSizePx + 'px' : undefined,
        paperColor: '#ffffff'
      });
      const dataUrl = await canvasToPngDataUrl(canvas);
      if (!dataUrl) {
        entry.failed = true;
        continue;
      }
      entry.dataUrl = dataUrl;
      entry.widthPx = box.width;
      entry.heightPx = box.height;
    } catch {
      entry.failed = true;
    }
  }
  if (!opts.host) host.remove();
  return images;
}

function createMeasureHost(doc: Document): HTMLElement {
  const host = doc.createElement('div');
  host.setAttribute('data-word-measure-host', '');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = '1200px';
  host.style.visibility = 'hidden';
  host.style.pointerEvents = 'none';
  doc.body.appendChild(host);
  return host;
}

// 布局尺寸：优先 offsetWidth/offsetHeight（挂载后强制回流）；svg 无布局尺寸时
// 用 width/height 属性，width 缺失或百分比时按 viewBox 纵横比从另一维推算。
function measureWordNode(node: Element): { width: number; height: number } {
  const el = node as HTMLElement;
  let width = el.offsetWidth || 0;
  let height = el.offsetHeight || 0;
  const svg = node.tagName === 'svg' ? node : node.querySelector('svg');
  if (svg) {
    const attrW = parseFloat(svg.getAttribute('width') || '');
    const attrH = parseFloat(svg.getAttribute('height') || '');
    if (!width && attrW > 0) width = attrW;
    if (!height && attrH > 0) height = attrH;
    const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
      if (width > 0 && !height) height = width * viewBox[3] / viewBox[2];
      if (height > 0 && !width) width = height * viewBox[2] / viewBox[3];
    }
  }
  return { width: width > 0 ? width : 100, height: height > 0 ? height : 100 };
}

function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}
