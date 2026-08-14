// 共享导出工具（M2-EXPORT-CORE）：从 longImageMethods 提取的 DOM 处理原语，
// HTML 导出（exportMethods）与 Word 导出（flattenDocument）共用。
// 提取约束：行为与 longImageMethods 原实现一致（长图 E2E 为回归基线）；
// 本模块顶层不碰 DOM/浏览器 API，node 单测可直接 import（浏览器能力在函数体内）。
//
// 提取对照（longImageMethods 迁移说明）：
//   - stripCommentMarks        ← _stripPosterMarks（DG4）
//   - inlineFontFaces          ← _posterFontCss/_buildPosterFontCss/_inlineFontFace
//   - inlineImages             ← _inlinePosterImages（+ DG5 语义扩展）
//   - rasterizeNode            ← _rasterizePoster 的切片光栅化核心
//   - replaceFailedDiagrams    ← 新增（DG9），与长图无对应

import { planLongImageTiles } from './longImageComposer.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 占位文本工厂（DG6 与 DG9 共用，导出侧与 Word 侧保持一致）
// ─────────────────────────────────────────────────────────────────────────────
export const REMOVED_SVG_TEXT = 'SVG 已移除（含不安全的脚本内容）';
export const FAILED_DIAGRAM_TEXT = '图表渲染失败（原代码块内容见附录）';

// ─────────────────────────────────────────────────────────────────────────────
// DG4：批注标记剥离（原 _stripPosterMarks）
// 删 [data-comment-badge]；[data-comment-id] 拆开保留原文。
// ─────────────────────────────────────────────────────────────────────────────
export function stripCommentMarks(root: Element): void {
  root.querySelectorAll('[data-comment-badge]').forEach((badge) => badge.remove());
  root.querySelectorAll('[data-comment-id]').forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 字体与图片内联（原 _fetchAsDataUrl / _inlineFontFace / _inlinePosterImages）
// fetchUrl 可注入（node 单测没有 fetch/FileReader，注入替身）。
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAsDataUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return '';
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

export interface InlineFontFacesOptions {
  /** 测试注入：替代内部 fetch→FileReader 路径 */
  fetchUrl?: (url: string) => Promise<string>;
  /** face 过滤（按 cssText 判定）；缺省收集全部。导出侧用它限定 KaTeX 字体（DG7 范围） */
  filter?: (cssText: string) => boolean;
}

/** 收集 @font-face 并把每条 face 的首个 url() 内联为 data URL（原 _buildPosterFontCss）。 */
export async function inlineFontFaces(
  sheets: ArrayLike<CSSStyleSheet> | null | undefined,
  opts: InlineFontFacesOptions = {}
): Promise<string> {
  const fetchUrl = opts.fetchUrl ?? fetchAsDataUrl;
  const filter = opts.filter ?? (() => true);
  const faces: string[] = [];
  for (const sheet of Array.from(sheets || [])) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨源样式表读 cssRules 会抛，跳过即可
    }
    for (const rule of Array.from(rules || [])) {
      const candidate = rule as unknown as { style?: CSSStyleDeclaration; selectorText?: string; cssText?: string };
      if (candidate.style && !candidate.selectorText && /^@font-face/.test(candidate.cssText || '')) {
        faces.push(candidate.cssText || '');
      }
    }
  }
  const inlined = await Promise.all(
    faces.filter(filter).map((face) => inlineFontFaceCss(face, fetchUrl))
  );
  return inlined.filter(Boolean).join('\n');
}

// 字体文件取不回来时整条 @font-face 丢掉，让 font-family 回退链接管系统字体，
// 而不是留一条指向取不到的 URL、在 SVG/导出物里渲染成默认无衬线（原 _inlineFontFace）。
async function inlineFontFaceCss(
  cssText: string,
  fetchUrl: (url: string) => Promise<string>
): Promise<string> {
  const match = /url\((['"]?)([^'")]+)\1\)/.exec(cssText);
  if (!match) return cssText;
  const dataUrl = await fetchUrl(match[2]);
  return dataUrl ? cssText.replace(match[0], 'url(' + dataUrl + ')') : '';
}

export interface InlineImagesOptions {
  /** 相对路径 → data URL 映射（桌面端本地图片水合结果），命中则直接采用 */
  localImages?: Record<string, string>;
  /** 失败回调（长图海报用占位替换）；缺省 = 保留原 URL（DG5） */
  onFailed?: (img: Element, src: string) => void;
  /** 测试注入：替代内部 fetch→FileReader 路径 */
  fetchUrl?: (url: string) => Promise<string>;
}

export interface InlineImagesResult {
  /** 内联失败的 src 列表（远程失败按 DG5 保留原 URL；相对路径无基准 URL 必死链） */
  failed: string[];
}

/**
 * 内联图片（原 _inlinePosterImages + DG5）：
 * - 移除 srcset/loading（静态导出物不需要响应式候选）；
 * - data URL 直接保留；localImages 命中直接采用；
 * - 远程（http/https/blob/file）逐个 fetch → data URL；
 * - 相对路径不尝试 fetch（自包含导出无基准 URL，fetch 结果也必然不可用），直接失败；
 * - 失败时默认保留原 URL 并记入 failed（DG5），onFailed 可接管（长图占位语义）。
 */
export async function inlineImages(
  root: Element,
  opts: InlineImagesOptions = {}
): Promise<InlineImagesResult> {
  const fetchUrl = opts.fetchUrl ?? fetchAsDataUrl;
  const failed: string[] = [];
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (img) => {
    img.removeAttribute('srcset');
    img.removeAttribute('loading');
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    const local = opts.localImages ? opts.localImages[src] : undefined;
    if (local) {
      img.setAttribute('src', local);
      return;
    }
    if (!/^(https?:|blob:|file:)/i.test(src)) {
      failed.push(src);
      if (opts.onFailed) opts.onFailed(img, src);
      return;
    }
    const dataUrl = await fetchUrl(src);
    if (dataUrl) {
      img.setAttribute('src', dataUrl);
      return;
    }
    failed.push(src);
    if (opts.onFailed) opts.onFailed(img, src);
  }));
  return { failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// DG9：Mermaid 失败占位（.has-error / is-loading 卡死态兜底）
// 替换为占位文本并返回被替换节点的错误原文（导出侧拼进文末附录，不丢信息）。
// ─────────────────────────────────────────────────────────────────────────────
export interface ReplaceFailedDiagramsOptions {
  /** 占位文本；缺省为导出侧文案（含附录指引），Word 侧可传短文案 */
  text?: string;
}

export function replaceFailedDiagrams(root: Element, opts: ReplaceFailedDiagramsOptions = {}): string[] {
  const text = opts.text ?? FAILED_DIAGRAM_TEXT;
  const texts: string[] = [];
  const failed = Array.from(root.querySelectorAll('.mermaid-rendered.has-error, .mermaid-rendered.is-loading'));
  for (const node of failed) {
    texts.push((node.textContent || '').trim());
    replaceWithTextNode(node, text);
  }
  return texts;
}

function replaceWithTextNode(node: Element, textValue: string): void {
  const doc = node.ownerDocument;
  const textNode = doc.createTextNode(textValue);
  node.replaceWith(textNode);
}

// ─────────────────────────────────────────────────────────────────────────────
// 切片光栅化核心（原 _rasterizePoster 的循环 + _loadPosterTile）
// 做法：克隆节点 → 内联图片 → 序列化为 SVG <foreignObject> 的 markup → 按设备
// 像素整切成多片分别光栅化再拼画布。Word 出口（公式/Mermaid 转 PNG）与长图共用。
// ─────────────────────────────────────────────────────────────────────────────
export interface RasterizeNodeOptions {
  /** foreignObject 宽度（CSS px）；内容按此宽度排版 */
  width: number;
  /** 内容高度（CSS px）；缺省读 node.offsetHeight（需节点已挂载） */
  height?: number;
  /** 设备像素倍率，默认 2 */
  scale?: number;
  /** 布局样式（Word：extractExportCss + 冻结变量；长图：海报 CSS） */
  css?: string;
  /** 内联 @font-face（KaTeX 字形必需） */
  fontsCss?: string;
  /** 画布底色，默认 #ffffff（切片取整后末尾差一两个像素，别露出透明底） */
  paperColor?: string;
  /** 可选：markup 外包一层带类的 div（Word 侧用 'md-preview' 命中导出样式） */
  wrapperClass?: string;
  /** 可选：wrapper 的 style 内容（如 'font-size:17px'） */
  wrapperStyle?: string;
  onProgress?: (done: number, total: number) => void;
  /** 图片内联失败回调（长图海报的占位替换） */
  onInlineFailed?: (img: Element, src: string) => void;
  /** 切片光栅化失败的报错文案（长图保持原文案） */
  tileErrorText?: string;
}

export async function rasterizeNode(node: Element, options: RasterizeNodeOptions): Promise<HTMLCanvasElement> {
  const width = options.width;
  const height = options.height || (node as HTMLElement).offsetHeight || 1;
  const scale = options.scale ?? 2;
  const clone = node.cloneNode(true) as Element;
  await inlineImages(clone, { onFailed: options.onInlineFailed });
  const css = ((options.fontsCss || '') + '\n' + (options.css || '')).trim();
  const markup = wrapRasterMarkup(new XMLSerializer().serializeToString(clone), options);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画布上下文不可用');
  // 先铺满纸色：切片高度取整后末尾可能差一两个像素，别露出透明底
  context.fillStyle = options.paperColor || '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const tiles = planLongImageTiles(height, scale);
  for (let index = 0; index < tiles.length; index += 1) {
    if (options.onProgress) options.onProgress(index, tiles.length);
    const image = await loadRasterTile(tiles[index], { width, scale, css, markup }, options.tileErrorText);
    context.drawImage(image, 0, Math.round(tiles[index].top * scale));
  }
  return canvas;
}

function wrapRasterMarkup(markup: string, options: RasterizeNodeOptions): string {
  if (!options.wrapperClass && !options.wrapperStyle) return markup;
  const parts = [];
  if (options.wrapperClass) parts.push('class="' + options.wrapperClass + '"');
  if (options.wrapperStyle) parts.push('style="' + options.wrapperStyle + '"');
  return '<div ' + parts.join(' ') + '>' + markup + '</div>';
}

// 一片切片 = 一张按设备像素定尺、viewBox 回到 CSS px 的 SVG（原 _loadPosterTile）：
// viewBox 缩放让 foreignObject 里的文字直接以输出分辨率光栅化，不是放大位图。
// 必须走 data: URL —— Chrome 把 blob: 来源的 SVG 视为跨源，画上去的画布会被污染。
function loadRasterTile(
  tile: { top: number; height: number },
  options: { width: number; scale: number; css: string; markup: string },
  errorText?: string
): Promise<HTMLImageElement> {
  const { width, scale, css, markup } = options;
  const widthPx = Math.round(width * scale);
  const heightPx = Math.ceil(tile.height * scale);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + widthPx + '" height="' + heightPx
    + '" viewBox="0 0 ' + width + ' ' + (heightPx / scale) + '">'
    + '<foreignObject x="0" y="0" width="100%" height="100%">'
    + '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + width + 'px">'
    + '<style><![CDATA[' + String(css).replace(/\]\]>/g, '') + ']]></style>'
    + '<div style="transform:translateY(' + -tile.top + 'px)">' + markup + '</div>'
    + '</div></foreignObject></svg>';
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(errorText || '长图渲染失败 · 请稍后重试'));
    image.src = url;
  });
}
