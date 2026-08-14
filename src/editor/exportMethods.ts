// M2-EXPORT-CORE：自包含 HTML 导出管线（消费 exportComposer 的纯字符串组装）。
// 职责链（对应 EXPORT_DECISIONS.md DG4–DG9，逐条落实位置见文件内注释）：
//   克隆预览 → 剥离批注(DG4) → 失败图表占位+附录(DG9) → SVG 兜底(DG6) →
//   冻结 CSS 变量 → 内联字体(DG7) → 内联图片(DG5) → 组装自包含 HTML。
// 分层：本文件保持「可单测的纯逻辑」与「浏览器端编排」分离——node 无 DOM，
// 剥离/检查/组装逻辑以纯函数导出（单测见 tests/unit/exportMethods.test.ts），
// exportHtmlFromPreview 为浏览器端编排入口（E2E 全链路见 tests/e2e/htmlExport.spec.ts）。
//
// 与长图（longImageMethods）的分工：两者共用 shareExportUtils 的剥离/内联/光栅化
// 原语；本管线多出变量冻结、字体阈值降级（DG7）、SVG 兜底（DG6）、失败图表附录（DG9）。

import { composeExportHtml, extractExportCss } from './exportComposer.ts';
import { collectCssVariableNames, cssVariableBlock } from './longImageComposer.ts';
import {
  stripCommentMarks,
  inlineFontFaces,
  inlineImages,
  replaceFailedDiagrams,
  REMOVED_SVG_TEXT
} from './shareExportUtils.ts';

/** DG7 阈值：内联字体（woff2 data URL）合计超过 1MB 即降级为系统字体栈 */
export const FONT_INLINE_LIMIT_BYTES = 1024 * 1024;

export interface ExportHtmlOptions {
  /** 导出文档 <title> */
  title: string;
  /** 相对路径 → data URL 映射（桌面端本地图片水合结果；浏览器端可传空对象） */
  localImages?: Record<string, string>;
}

export interface ExportHtmlResult {
  html: string;
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯逻辑（node 单测覆盖）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 冻结 CSS 变量：收集样式表里声明过的变量名，用 getComputedStyle 的当前值
 * 落定成 `.md-preview{--x:值;…}` 字面块（read 由调用方注入浏览器读取器）。
 */
export function freezeCssVariables(
  sheets: ArrayLike<CSSStyleSheet> | null | undefined,
  read: (name: string) => string
): string {
  return cssVariableBlock('.md-preview', collectCssVariableNames(sheets), read);
}

/**
 * 把 CSS 文本里的 var() 引用替换为字面值（多轮收敛，支持一层嵌套 fallback）。
 * 与冻结块配合，保证导出物里不残留 var(--（自包含：脱离宿主主题也能正确渲染）。
 * 未知变量且无 fallback 时保留原引用，不臆造值。
 */
export function resolveCssVariables(css: string, read: (name: string) => string): string {
  let out = css;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (whole, name: string, fallback?: string) => {
      const value = read(name);
      const candidate = (value || (fallback ?? '').trim()).trim();
      return candidate || whole;
    });
    if (next === out) return out;
    out = next;
  }
  return out;
}

/** 统计 CSS 文本里 data URL 的原始字节数（base64 载荷 × 3/4），DG7 阈值判定用。 */
export function estimateDataUrlBytes(css: string): number {
  let total = 0;
  for (const m of css.matchAll(/data:[^;,]+;base64,([A-Za-z0-9+/=]+)/g)) {
    total += Math.floor(m[1].length * 3 / 4);
  }
  return total;
}

/**
 * DG7 Path B：只保留内联成功的 data: src，剪掉 @font-face 里残留的相对路径
 * （woff/ttf 死链）。自包含导出物里每条 face 的 src 全部为 data:font/woff2。
 * 注意不能按「声明分号」切分——data URL 载荷里自带 ';base64,'，必须按 url 段剪。
 */
export function pruneFontFaceSrcs(css: string): string {
  if (!/url\((['"]?)data:[^'")]+\1\)/.test(css)) return css;
  // 内联成功的 face 首个 url 必为 data:；剪掉其后的非 data url 段（连同前置逗号与空白）
  return css.replace(/,\s*url\((['"]?)((?!data:)[^'")]+)\1\)\s*(?:format\([^)]*\))?/g, '');
}

/**
 * DG7 Path B：从内联失败的 face 提取字体族，声明系统字体降级栈。
 * !important 压过 cssBundle 里 katex.min.css 的 .katex 字体声明（同特异度后到者胜，
 * 但 fontsCss 排在 cssBundle 之前，必须提权）。
 */
export function fontFallbackCss(fontsCss: string): string {
  const families: string[] = [];
  for (const m of fontsCss.matchAll(/font-family:\s*([^;{}]+);?/g)) {
    const family = m[1].trim();
    if (family && !families.includes(family)) families.push(family);
  }
  if (!families.length) return '';
  return '.katex, .katex-display, .katex-error { font-family: ' + families.join(', ')
    + ', "Times New Roman", serif !important; }';
}

/**
 * DG9 附录：渲染失败图表的原文（转义安全，只经 textContent 层落地）。
 */
export function buildFailureAppendix(texts: string[]): string {
  const escapeHtml = (value: string) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const items = texts.map((t) => '<pre>' + escapeHtml(t) + '</pre>').join('');
  return '<h2>附录：渲染失败的图表</h2>' + items;
}

/**
 * DG6：SVG 兜底检查——含 <script>、事件属性（on*）、<foreignObject>（可内嵌
 * HTML 的逃逸口）即判定不安全。预览净化是主防线，这里是导出物离开应用前的
 * 第二道闸（防御纵深，单测直接构造恶意节点覆盖）。
 */
export function assertSafeSvg(svg: Element): boolean {
  if (svg.querySelector('script, foreignObject')) return false;
  for (const node of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
    for (const name of node.getAttributeNames()) {
      if (/^on/i.test(name)) return false;
    }
  }
  return true;
}

/**
 * DG6 兜底扫描：不安全 SVG 替换为占位文本。
 * `.mermaid-rendered` 内的 SVG 是渲染器产物（flowchart 的 htmlLabels 会合法地
 * 使用 foreignObject，已实测），信任放行——用户不可控其内容。
 */
export function sanitizeExportSvgs(root: Element): void {
  for (const svg of Array.from(root.querySelectorAll('svg'))) {
    if (svg.closest('.mermaid-rendered')) continue;
    if (!assertSafeSvg(svg)) {
      const textNode = svg.ownerDocument.createTextNode(REMOVED_SVG_TEXT);
      svg.replaceWith(textNode);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 浏览器端编排入口（E2E 全链路覆盖）
// ─────────────────────────────────────────────────────────────────────────────
export async function exportHtmlFromPreview(
  preview: Element,
  opts: ExportHtmlOptions
): Promise<ExportHtmlResult> {
  const warnings: string[] = [];
  const clone = preview.cloneNode(true) as Element;

  // DG4：批注默认剥离（badge 移除、id span 拆开保留原文）
  stripCommentMarks(clone);

  // DG9：Mermaid 失败节点替换为占位文本，原文进文末附录（不丢信息）
  const failedDiagramTexts = replaceFailedDiagrams(clone);
  if (failedDiagramTexts.length) {
    const appendix = clone.ownerDocument.createElement('div');
    appendix.className = 'export-appendix';
    appendix.innerHTML = buildFailureAppendix(failedDiagramTexts);
    clone.appendChild(appendix);
    warnings.push(failedDiagramTexts.length + ' 个图表渲染失败，已替换为占位文本（原代码见文末附录）');
  }

  // DG6：SVG 兜底（script/事件属性/foreignObject → 占位文本）
  sanitizeExportSvgs(clone);

  const sheets = document.styleSheets;
  const computed = getComputedStyle(document.body);
  const readVar = (name: string) => computed.getPropertyValue(name).trim();

  // 冻结 CSS 变量：主题/纸色落定成字面值（脱离宿主主题也能正确渲染）
  const cssVariables = freezeCssVariables(sheets, readVar);

  // DG7：内联 @font-face 的 woff2 为 data URL；超阈值降级为系统字体栈 + 提示。
  // 范围限定 KaTeX 字体（决策主题）：应用另有 1.99MB 的正文子集字体（Canger），
  // 一并内联会让每个导出物背 2MB+ 成本，与「轻量分享物」定位相悖——正文走
  // .md-preview 声明的回退栈（'Kaiti SC' 等，与长图取不回字体时的行为一致）。
  // POC 实测：katex 0.16.47 全量 woff2 259KB < 1MB 阈值 → 走 Path A。
  let fontsCss = await inlineFontFaces(sheets, {
    filter: (face) => /font-family:\s*['"]?KaTeX_/i.test(face)
  });
  if (fontsCss) {
    fontsCss = pruneFontFaceSrcs(fontsCss);
    if (estimateDataUrlBytes(fontsCss) > FONT_INLINE_LIMIT_BYTES) {
      fontsCss = fontFallbackCss(fontsCss);
      warnings.push('公式字体未内联（合计超过 ' + (FONT_INLINE_LIMIT_BYTES / 1024 / 1024) + 'MB 阈值），导出后以系统字体渲染，观感可能有差');
    }
  }

  // DG5：远程图内联为 data URL；失败保留原 URL + 计数提示。相对路径在自包含
  // 导出物里必然死链（无基准 URL），替换为占位文本并同样计数。
  const { failed } = await inlineImages(clone, {
    localImages: opts.localImages,
    onFailed: (img, src) => {
      if (/^https?:\/\//i.test(src)) return; // DG5：远程图失败保留原 URL
      const missing = clone.ownerDocument.createElement('span');
      missing.className = 'export-img-missing';
      missing.textContent = '图片未能载入 · ' + (img.getAttribute('alt') || src);
      img.replaceWith(missing);
    }
  });
  if (failed.length) {
    warnings.push(failed.length + ' 张图片未能内联，导出文件需联网或会缺图');
  }

  // 组装：cssVariables → fontsCss → cssBundle（composer 固定顺序）；cssBundle 内
  // 的 var() 引用解析为字面值，保证导出物无 var(-- 残留
  const cssBundle = resolveCssVariables(extractExportCss(sheets), readVar);
  const html = composeExportHtml({
    title: opts.title,
    bodyHtml: clone.innerHTML,
    cssVariables,
    fontsCss,
    cssBundle,
    meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]
  });
  return { html, warnings };
}
