// M1-5 实现：[TOC] 目录扩展。
//
// 能力：
//   - block tokenizer：独占行 [TOC]（行首、顶层 state.top === true）→ toc token，
//     raw 只含标记本身（[TOC]）；
//   - start() 只匹配「真正行首」的 [TOC]：marked@18 传给 start 的是 src.slice(1)
//     （lexer 段落裁剪），位置 0 在原文中处于行中（前邻字符非换行——换行会被 space
//     token 先行消费），若返回 0 会把段落拆碎并造成 x[TOC] 行中误触发（tocprobe.mjs
//     的 D/E 伪影）；故只认位置 ≥1 且前邻为 \n 的出现；
//   - 引用/列表内误触发修复（transformTokens 树遍历）：
//       · 引用 > [TOC]：blockquote 递归强制 state.top = true（见
//         tests/unit/markdownExtensionsSpike.test.ts 事实 3），tokenizer 无法区分，
//         由 transformTokens 把嵌套在 blockquote/list（任意深度）内的 toc token
//         降级为字面 <p>[TOC]</p>；
//       · 列表项 - [TOC]：列表项递归置 state.top = false，tokenizer 守卫直接拦截；
//       · 围栏 / 缩进代码内 [TOC]：内置 code/fences tokenizer 原子消费，天然不触发；
//   - slug 同源：顶层 toc token 按文档序收集全部 heading（含引用/列表内的标题，
//     与 _renderOutline 的 querySelectorAll 文档序一致），对 heading token 文本剥
//     ^..^ / ==..== / $..$ / 反引号取内文本（行内语法渲染后的 DOM 文本节点即其内
//     文本，与 textContent 归一一致）后走 slugify.outlineSlug，共用 used 集合；
//   - renderer 产 <div class="toc"><ul><li class="toc-level-N"><a href="#outline-…">…
//     条目文本 HTML 转义，不拼接不可信 innerHTML。
//   结构样式已由 styles.css 预置（.toc 容器/.toc-level-*），本模块只产出结构，
//   不得改 styles.css。
//
// 契约（定稿，见 markdownExtensionRegistry.ts 头部注释，不得更改）：
//   MarkdownExtensionModule = { extensions; transformTokens? };
// 保持命名导出 tocExtension 不变（editorEntry 已按此名注册，注册序第 4）。

import type { Token, Tokens, TokenizerAndRendererExtension } from 'marked';
import type { MarkdownExtensionModule } from './markdownExtensionRegistry';
import { outlineSlug } from './slugify.ts';

const TOC_MARKER = '[TOC]';

/** TOC 条目：level = 标题层级（1..6），id = 与大纲同源的锚点 id，text = 归一标题 */
interface TocEntry {
  level: number;
  id: string;
  text: string;
}

/** toc token 上挂条目的私有字段（transformTokens 填充，renderer 读取） */
interface TocToken extends Tokens.Generic {
  type: 'toc';
  entries: TocEntry[];
}

/** HTML 转义（用户内容一律转义，不拼接不可信 innerHTML） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 标题文本归一（与 _renderOutline 的 textContent 对齐）：剥行内语法标记取内文本。
 * ^..^ 上标 / ==..== 高亮 / $..$ 公式 / `..` 代码 span——渲染后的 DOM 文本均为
 * 内文本，按同样规则剥取后再 outlineSlug，保证 TOC 锚点 id 与大纲 id 同源一致。
 */
export function headingTextForSlug(text: string): string {
  return text
    .replace(/\^([^^]+)\^/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/** 降级字面 token：<p>[TOC]</p>（与无扩展时引用内段落结构一致） */
function literalTocToken(): Token {
  return {
    type: 'paragraph',
    raw: TOC_MARKER,
    text: TOC_MARKER,
    tokens: [{ type: 'text', raw: TOC_MARKER, text: TOC_MARKER }]
  };
}

/** 收集 token 的块级子 token 数组（list 项 / table 单元格 / 通用 tokens） */
function blockChildren(token: Token): Token[][] {
  if (token.type === 'list') {
    return (token as Tokens.List).items.map((item) => item.tokens);
  }
  if (token.type === 'table') {
    const table = token as Tokens.Table;
    const cells: Token[][] = [];
    for (const cell of table.header) cells.push(cell.tokens);
    for (const row of table.rows) for (const cell of row) cells.push(cell.tokens);
    return cells;
  }
  return 'tokens' in token && Array.isArray(token.tokens) ? [token.tokens] : [];
}

/** 降级指定数组内的嵌套 toc token（该数组必为 blockquote/list 等的子数组，非顶层） */
function downgradeInArray(tokens: Token[]): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'toc') {
      tokens[i] = literalTocToken();
      continue;
    }
    for (const child of blockChildren(token)) downgradeInArray(child);
  }
}

/**
 * 树遍历：把嵌套在 blockquote/list（任意深度）内的 toc token 降级为字面段落。
 * 只处理子数组——顶层数组里的 toc token 是合法目录，不得降级。
 */
function downgradeNestedToc(tokens: Token[]): void {
  for (const token of tokens) {
    for (const child of blockChildren(token)) downgradeInArray(child);
  }
}

/** 文档序收集标题并产出与大纲同源的 slug（index = 文档序序号，used 跨标题累积） */
function collectHeadings(tokens: Token[], entries: TocEntry[], used: Set<string>): void {
  for (const token of tokens) {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading;
      const text = headingTextForSlug(heading.text);
      entries.push({ level: heading.depth, id: outlineSlug(text, entries.length, used), text });
    }
    for (const child of blockChildren(token)) collectHeadings(child, entries, used);
  }
}

/** transformTokens：降级嵌套 toc → 为顶层 toc token 挂文档标题条目 */
function transformToc(tokens: Token[]): Token[] {
  downgradeNestedToc(tokens);
  const entries: TocEntry[] = [];
  const used = new Set<string>();
  collectHeadings(tokens, entries, used);
  for (const token of tokens) {
    if (token.type === 'toc') (token as TocToken).entries = entries;
  }
  return tokens;
}

const tocExtensionDef: TokenizerAndRendererExtension = {
  name: 'toc',
  level: 'block',
  start(src: string): number | undefined {
    // marked 传 src.slice(1)：位置 0 在原文中处于行中（前邻字符非换行），返回它会
    // 拆碎段落造成 x[TOC] 误触发；只有前邻 \n 的才是真正行首。
    const idx = src.indexOf(TOC_MARKER, 1);
    if (idx <= 0 || src[idx - 1] !== '\n') return undefined;
    return idx;
  },
  tokenizer(src: string): Token | undefined {
    // 列表项递归内 state.top === false（marked 实证，见 spike 事实 3），直接拦截；
    // 引用内 top 被强制为 true，由 transformTokens 树遍历降级。
    if (this.lexer.state.top !== true) return undefined;
    // 独占行守卫：[TOC] 或 [TOC]\n（后接内容 / 行中 / 围栏内均不触发）
    if (src !== TOC_MARKER && !src.startsWith(TOC_MARKER + '\n')) return undefined;
    return { type: 'toc', raw: TOC_MARKER, entries: [] };
  },
  renderer(token: Tokens.Generic): string {
    const entries = (token as TocToken).entries ?? [];
    const items = entries
      .map((e) => `<li class="toc-level-${e.level}"><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`)
      .join('');
    // 与其他块级 renderer 一致，输出以换行结尾
    return `<div class="toc"><ul>${items}</ul></div>\n`;
  }
};

export const tocExtension: MarkdownExtensionModule = {
  extensions: [tocExtensionDef],
  transformTokens: transformToc
};
