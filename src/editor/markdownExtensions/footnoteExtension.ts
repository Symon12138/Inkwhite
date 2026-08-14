// M1-3 实现：脚注扩展（[^id] 引用 → <sup class="footnote-ref"> + 文末脚注区）。
//
// 机制（marked@18.0.5 实证，见 tests/unit/footnoteExtension.test.ts、
// tests/unit/markdownExtensionsSpike.test.ts 与 markdownBaseline.test.ts）：
//   - 基线：`[^1]: 注释` 被内置 def 规则劫持为链接定义，`[^1]` 变成
//     href=百分号编码的引用链接；自定义 block 扩展带 start() 时优先于
//     内置 def；自定义 inline 扩展带 start() 时优先于 reflink。
//   - block：footnoteDef 在每次 blockTokens 迭代先于内置规则尝试（扩展
//     tokenizer 收到整段剩余 src，必须用行首守卫）；start() 只用于让
//     paragraph 在定义行前停住（start 收到 src.slice(1)）。定义体按
//     Markdown 规则收集：首行 + 4 空格/tab 缩进的续行 + 空行后缩进续行
//     （空行组并入 raw，避免 def 后紧跟单 \n space token 触发 marked 的
//     space 合并分支）。
//   - inline：footnoteRef 的 start() 匹配 `[^` 让 text 提前停住；
//     tokenizer 负向前瞻 `[^id](`（链接）与 `[^id][`（引用式链接）不匹配，
//     保持基线行为；前序 token 是 escape（`\[^1]`）或含反引号的 text
//     （未闭合代码串）时拒绝。
//   - transformTokens：两阶段——先整树收集定义（首个定义胜出，文本挂
//     ctx.footnotes），再整树解析引用（按首次引用序记 ctx.footnoteOrder，
//     出现序号记 ordinal，未定义引用替换为字面 text token），剥离全部
//     footnoteDef，末尾按 footnoteOrder 注入 footnoteSection。
//   - footnoteSection renderer：定义体用无扩展的 Lexer（RENDER_MARKDOWN_
//     OPTIONS）重 lex 成块级子 tokens，再经 this.parser.parse 渲染，因此
//     多行/列表/代码在定义体内可用，且体内不会产生 footnoteDef/Ref 递归。
//
// 结构样式已由 styles.css 预置（.footnotes/.footnote-ref/.footnote-backref），
// 本模块只产出结构，不得改 styles.css。
//
// 契约（定稿，见 markdownExtensionRegistry.ts 头部注释，不得更改）：
//   MarkdownExtensionModule = { extensions; transformTokens? }

import { Lexer } from 'marked';
import type { RendererThis, Token, TokenizerAndRendererExtension, TokenizerThis, Tokens } from 'marked';
import {
  RENDER_MARKDOWN_OPTIONS,
  type MarkdownExtensionModule,
  type MarkdownParseContext
} from './markdownExtensionRegistry.ts';

/** footnoteDef token：block 层定义行（transformTokens 阶段剥离，不直达 parser）。 */
interface FootnoteDefToken extends Tokens.Generic {
  type: 'footnoteDef';
  id: string;
  /** 定义体原文（首行 + 去 4 空格缩进的续行），renderer 阶段按 Markdown 重渲染 */
  body: string;
}

/** footnoteRef token：inline 层引用；ordinal 由 transformTokens 按出现序填充。 */
interface FootnoteRefToken extends Tokens.Generic {
  type: 'footnoteRef';
  id: string;
  ordinal?: number;
}

/** footnoteSection token：transformTokens 注入 tokens 末尾的脚注区。 */
interface FootnoteSectionToken extends Tokens.Generic {
  type: 'footnoteSection';
  entries: Array<{ id: string; body: string; refs: number }>;
}

// ===== block：`[^id]: body` 定义行 =====

/** 定义行头：允许 0-3 空格缩进（与 marked 内置 block 规则一致）。 */
const DEF_HEADER_RE = /^ {0,3}\[\^([^\]\n]+)\]:[ \t]*/;

/**
 * start()：让 paragraph/text 在定义行前停住（start 收到 src.slice(1)，
 * 返回其中定义行起始位置）。要求首行有非空 body（与 tokenizer 的
 * 空 body 拒绝一致，避免无 body 定义行被拆出段落）。
 */
function footnoteDefStart(src: string): number | undefined {
  const match = /(?:^|\n) {0,3}\[\^[^\]\n]+\]:[ \t]*\S/.exec(src);
  return match ? match.index : undefined;
}

/**
 * 收集定义体：首行 + 4 空格/tab 缩进续行 + 空行后缩进续行（空行并入 body
 * 作段落分隔）。定义在空行后无缩进续行处结束，此时空行组并入 raw 消费掉，
 * 避免 def token 后紧跟单 \n space token 触发 marked 的 space 合并分支
 * （该分支会把上一段落的 inline src 覆写成 def 的 text，实测会清空段落）。
 */
function collectDefBody(rest: string): { body: string; consumed: number } {
  const nl = rest.indexOf('\n');
  const firstLine = nl === -1 ? rest : rest.slice(0, nl);
  let body = firstLine;
  let consumed = nl === -1 ? rest.length : nl + 1;
  let remaining = nl === -1 ? '' : rest.slice(nl + 1);
  const lines: string[] = [];
  while (remaining.length > 0) {
    if (/^[ \t]*\n/.test(remaining)) {
      const blank = /^[ \t]*\n+/.exec(remaining)!;
      const after = remaining.slice(blank[0].length);
      if (!/^(?: {4}|\t)/.test(after)) {
        consumed += blank[0].length;
        break;
      }
      lines.push('');
      consumed += blank[0].length;
      remaining = after;
      continue;
    }
    const line = /^(?: {4}|\t)([^\n]*)(?:\n|$)/.exec(remaining);
    if (!line) break;
    lines.push(line[1]);
    consumed += line[0].length;
    remaining = remaining.slice(line[0].length);
  }
  if (lines.length) body = body === '' ? lines.join('\n') : body + '\n' + lines.join('\n');
  return { body, consumed };
}

function footnoteDefTokenizer(this: TokenizerThis, src: string): Tokens.Generic | undefined {
  // 输入守卫：每次 blockTokens 迭代都会携带整段剩余 src，必须在行首命中
  const header = DEF_HEADER_RE.exec(src);
  if (!header) return undefined;
  const { body, consumed } = collectDefBody(src.slice(header[0].length));
  if (body.trim() === '') return undefined;
  return { type: 'footnoteDef', id: header[1], body, raw: src.slice(0, header[0].length + consumed) };
}

// ===== inline：`[^id]` 引用 =====

const REF_RE = /^\[\^([^\]\n]+)\]/;

/** start()：`[^` 不在 text 规则停止集内，必须让 text 提前停住（start 收到 src.slice(1)）。 */
function footnoteRefStart(src: string): number | undefined {
  const index = src.indexOf('[^');
  return index < 0 ? undefined : index;
}

function footnoteRefTokenizer(this: TokenizerThis, src: string, tokens: Token[]): Tokens.Generic | undefined {
  // 前序 token 守卫：`\[^1]` 转义后保持字面；未闭合反引号串内不触发
  const prev = tokens[tokens.length - 1];
  if (prev !== undefined && (prev.type === 'escape' || (prev.type === 'text' && prev.raw.includes('`')))) {
    return undefined;
  }
  const match = REF_RE.exec(src);
  if (!match) return undefined;
  // 负向前瞻：[^id]( 链接与 [^id][ 引用式链接不匹配（保持基线行为）
  const after = src[match[0].length];
  if (after === '(' || after === '[') return undefined;
  return { type: 'footnoteRef', id: match[1], raw: match[0] };
}

// ===== renderers =====

/** 属性/文本最小转义（id 来自用户输入，进入 href/id/文本）。 */
function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function footnoteRefRenderer(this: RendererThis, token: Tokens.Generic): string {
  const ref = token as FootnoteRefToken;
  // 兜底：未变换的引用（理论上不会到达 parser）保持字面
  if (typeof ref.ordinal !== 'number') return escapeAttr(ref.raw);
  const id = escapeAttr(ref.id);
  return `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}-${ref.ordinal}">${id}</a></sup>`;
}

function footnoteSectionRenderer(this: RendererThis, token: Tokens.Generic): string {
  const section = token as FootnoteSectionToken;
  const items = section.entries.map((entry) => {
    // 定义体按 Markdown 重渲染：无扩展 Lexer 出块级子 tokens，parser 渲染
    const bodyHtml = this.parser.parse(new Lexer(RENDER_MARKDOWN_OPTIONS).lex(entry.body));
    const backrefs: string[] = [];
    for (let n = 1; n <= entry.refs; n++) {
      backrefs.push(`<a class="footnote-backref" href="#fnref-${escapeAttr(entry.id)}-${n}">\u21A9</a>`);
    }
    return `<li id="fn-${escapeAttr(entry.id)}">${bodyHtml}${backrefs.join(' ')}</li>`;
  });
  return `<section class="footnotes">\n<ol>\n${items.join('\n')}\n</ol>\n</section>\n`;
}

// ===== transformTokens：收集 / 解析 / 注入 =====

/** 返回 token 的子树数组（list items / table cells / 通用 tokens 字段）。 */
function childTokenArrays(token: Token): Token[][] {
  if (token.type === 'list') {
    return (token as Tokens.List).items.map((item) => item.tokens);
  }
  if (token.type === 'table') {
    const table = token as Tokens.Table;
    const arrays: Token[][] = [];
    for (const cell of table.header) if (Array.isArray(cell.tokens)) arrays.push(cell.tokens);
    for (const row of table.rows) for (const cell of row) if (Array.isArray(cell.tokens)) arrays.push(cell.tokens);
    return arrays;
  }
  const generic = token as { tokens?: unknown };
  return Array.isArray(generic.tokens) ? [generic.tokens as Token[]] : [];
}

/** 用 fn 的返回值替换 token 的各子树数组。 */
function replaceChildArrays(token: Token, fn: (children: Token[]) => Token[]): void {
  if (token.type === 'list') {
    for (const item of (token as Tokens.List).items) item.tokens = fn(item.tokens);
    return;
  }
  if (token.type === 'table') {
    const table = token as Tokens.Table;
    for (const cell of table.header) if (Array.isArray(cell.tokens)) cell.tokens = fn(cell.tokens);
    for (const row of table.rows) for (const cell of row) if (Array.isArray(cell.tokens)) cell.tokens = fn(cell.tokens);
    return;
  }
  const generic = token as { tokens?: unknown };
  if (Array.isArray(generic.tokens)) generic.tokens = fn(generic.tokens as Token[]);
}

/** 阶段一：整树收集定义（文档序，首个定义胜出），文本挂 ctx.footnotes。 */
function collectDefs(tokens: Token[], ctx: MarkdownParseContext): void {
  for (const token of tokens) {
    if (token.type === 'footnoteDef') {
      const def = token as FootnoteDefToken;
      if (!ctx.footnotes.has(def.id)) ctx.footnotes.set(def.id, def.body);
      continue;
    }
    for (const children of childTokenArrays(token)) collectDefs(children, ctx);
  }
}

/**
 * 阶段二：解析引用并剥离定义。
 * - 已定义引用：按文档序填 ordinal（fnref-<id>-<序号>），首次引用记入
 *   ctx.footnoteOrder（去重插入序 = 脚注区顺序）；
 * - 未定义引用：替换为字面 text token（[^id]）；
 * - footnoteDef：全部剥离（不直达 parser）。
 */
function resolveAndStrip(tokens: Token[], ctx: MarkdownParseContext, counts: Map<string, number>): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    if (token.type === 'footnoteDef') continue;
    if (token.type === 'footnoteRef') {
      const ref = token as FootnoteRefToken;
      if (ctx.footnotes.has(ref.id)) {
        const ordinal = (counts.get(ref.id) ?? 0) + 1;
        counts.set(ref.id, ordinal);
        ref.ordinal = ordinal;
        if (!ctx.footnoteOrder.includes(ref.id)) ctx.footnoteOrder.push(ref.id);
        out.push(ref);
      } else {
        out.push({ type: 'text', text: ref.raw, raw: ref.raw });
      }
      continue;
    }
    replaceChildArrays(token, (children) => resolveAndStrip(children, ctx, counts));
    out.push(token);
  }
  return out;
}

export const footnoteExtension: MarkdownExtensionModule = {
  extensions: [
    { name: 'footnoteDef', level: 'block', start: footnoteDefStart, tokenizer: footnoteDefTokenizer },
    { name: 'footnoteRef', level: 'inline', start: footnoteRefStart, tokenizer: footnoteRefTokenizer, renderer: footnoteRefRenderer },
    { name: 'footnoteSection', renderer: footnoteSectionRenderer }
  ],
  transformTokens(tokens, ctx) {
    collectDefs(tokens, ctx);
    const counts = new Map<string, number>();
    const out = resolveAndStrip(tokens, ctx, counts);
    if (ctx.footnoteOrder.length === 0) return out;
    const entries = ctx.footnoteOrder.map((id) => ({
      id,
      body: ctx.footnotes.get(id) ?? '',
      refs: counts.get(id) ?? 0
    }));
    const section: FootnoteSectionToken = { type: 'footnoteSection', entries, raw: '' };
    out.push(section);
    return out;
  }
};
