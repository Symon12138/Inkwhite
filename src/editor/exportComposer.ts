// 「导出 HTML」的纯逻辑：把标题、正文、样式等字符串组装成自包含 HTML 文档。
// 这里不碰 DOM、不抓字体、不做 URL 清洗——那些是消费方（M2 导出管线）的活，
// 本模块只做可预测的字符串组装，便于单测直接调用（见 tests/unit/exportComposer.test.ts）；
// 渲染与交互属于将来的 exportMethods.ts（M2）。
//
// 与长图海报（longImageComposer.ts）的分工：海报把 .md-preview 改写到
// .longimg-prose 并包上品牌页眉/页脚；导出保留原选择器、不带海报壳，且纳入
// 新语法选择器（KaTeX/脚注/TOC/前置元数据/任务列表）。

import { forEachStyleRule } from './cssRuleTraversal.ts';

// 导出需要带上的语法选择器：正文排版 + 5 个新语法（.katex/.footnotes/.toc/
// .front-matter/.task-list-item）+ Mermaid。不含海报壳（.longimg-poster/
// .longimg-prose 是长图专用，不进导出）。
export const EXPORT_SELECTOR = /\.md-preview|\.katex|\.footnotes|\.toc|\.front-matter|\.task-list-item|\.mermaid-rendered/;

// 从传入的样式表集合里筛出导出要用的普通规则：保留原选择器（与海报的改写不同），
// @media（含 print）/ @font-face / @keyframes 由遍历原语一并跳过。
export function extractExportCss(sheets: ArrayLike<CSSStyleSheet> | null | undefined): string {
  const chunks: string[] = [];
  forEachStyleRule(sheets, (rule) => {
    if (!EXPORT_SELECTOR.test(rule.selectorText)) return;
    const body = rule.style.cssText;
    if (body) chunks.push(rule.selectorText + '{' + body + '}');
  });
  return chunks.join('\n');
}

export interface ExportMeta {
  name: string;
  content: string;
}

export interface ExportComposerInput {
  title: string;
  /** 已净化的正文 HTML；相对 URL 的清洗/内联由消费方在传入前完成 */
  bodyHtml: string;
  /** 已冻结为字面值的 CSS 变量块（消费方负责用 getComputedStyle 落定） */
  cssVariables?: string;
  /** 内联字体的 @font-face（消费方负责抓取/内联 woff2，见 DG7） */
  fontsCss?: string;
  /** 抽取或打包好的正文样式（可来自 extractExportCss 或构建产物） */
  cssBundle?: string;
  /** 额外 <meta>（viewport/description 等），按传入顺序输出 */
  meta?: ExportMeta[];
  /** <html lang>，默认 zh-CN（与 index.html 一致） */
  lang?: string;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 组装自包含 HTML：DOCTYPE、charset、lang、title、meta、内联 style
// （cssVariables → fontsCss → cssBundle）、body（bodyHtml 原样透传）。
// 输出物自身不引入 <script>、事件属性或任何资源引用；正文与样式按原样拼接，
// 安全与资源内联是 M2 消费方在调用前完成的职责（DOMPurify + 图片内联 + 变量冻结）。
export function composeExportHtml(input: ExportComposerInput): string {
  const lang = escapeHtml(input.lang || 'zh-CN');
  const title = escapeHtml(input.title || '');
  const metaLines = (input.meta || [])
    .map((meta) => '  <meta name="' + escapeHtml(meta.name) + '" content="' + escapeHtml(meta.content) + '">')
    .join('\n');
  const cssParts = [input.cssVariables, input.fontsCss, input.cssBundle].filter(
    (part) => typeof part === 'string' && part.trim().length > 0
  );
  const styleBlock = cssParts.length
    ? '<style>\n' + cssParts.join('\n') + '\n</style>'
    : '';
  return [
    '<!DOCTYPE html>',
    '<html lang="' + lang + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>' + title + '</title>',
    metaLines,
    styleBlock,
    '</head>',
    '<body>',
    input.bodyHtml || '',
    '</body>',
    '</html>'
  ]
    .filter((line) => line !== '')
    .join('\n');
}
