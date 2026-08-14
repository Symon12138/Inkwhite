// M1-4 实现：行内语法扩展（上标 ^x^ / 下标 ~x~ / 高亮 ==x== → <mark> / emoji :word:）。
//
// 机制（marked@18.0.5 实证，见 tests/unit/markdownExtensionsSpike.test.ts 与
// tests/unit/inlineSyntaxExtension.test.ts 头部注释）：
//   - marked 的 inline 循环在每个位置先按 extensions 数组序尝试扩展 tokenizer，
//     全部失败才轮到内置规则；text 规则不停止于 ^ = :（停止集为 [\\<![`*~_]
//     等），因此 sup/mark/emoji 必须带 start() 让 text 提前停住（start 收到
//     src.slice(1)，返回其中首个完整合法模式的位置）；~ 在 text 停止集内，
//     sub 无需 start()。
//   - 单波浪 ~x~ 会被内置 del 规则渲染为 <del>，本扩展的 sub tokenizer 在 del
//     之前被尝试以抢先拦截；但 start()/tokenizer 必须排除 ~~ / ~~~ 前导，
//     否则会截断 ~~x~~ 的 <del>。sub 闭合 ~ 后不得再跟 ~（与 del 的
//     (?=[^~]|$) 一致）；内容含空白时 sub 拒绝并回退给 del（~a b~ → <del>）。
//   - 代码 span 由内置 codespan 规则原子消费；未闭合反引号串由 text 规则
//     first-group 路径吞掉（产出的 text token 含反引号），此时 start() 可能
//     在串内制造新位置，四个 tokenizer 必须用前序 token 检查拦截
//     （hasUnclosedCodeRun），保持与无扩展基线一致的字面输出。
//   - 数学扩展注册序在前：math 落地后 $...$ 由 math 的 tokenizer 整体消费，
//     本扩展不得（也不会）吞公式内上标（$x^2$ 由 math 整体消费为 KaTeX，
//     ^ 不产生 <sup>，见互斥两测）。
//   - 高亮内容经 childTokens 再行内解析（==**粗**== → <mark><strong>粗</strong></mark>）；
//     sup/sub 内容同样再解析（与 del/em/strong 的 tokens 机制一致）。
//
// 结构样式已由 styles.css 预置（sup/sub/mark），本模块只产出结构。
//
// 契约（定稿，见 markdownExtensionRegistry.ts 头部注释，不得更改）：
//   MarkdownExtensionModule = { extensions; transformTokens? }

import type {
  RendererThis,
  Token,
  TokenizerAndRendererExtension,
  TokenizerThis,
  Tokens
} from 'marked';
import type { MarkdownExtensionModule } from './markdownExtensionRegistry';

/** 冻结的 emoji 短代码映射表（模块级只读常量，无可变状态）。 */
const EMOJI_MAP: ReadonlyMap<string, string> = new Map([
  ['smile', '\u{1F604}'],
  ['heart', '\u2764\uFE0F'],
  ['+1', '\u{1F44D}'],
  ['-1', '\u{1F44E}'],
  ['thumbsup', '\u{1F44D}'],
  ['tada', '\u{1F389}'],
  ['fire', '\u{1F525}'],
  ['rocket', '\u{1F680}'],
  ['warning', '\u26A0\uFE0F'],
  ['checkered_flag', '\u{1F3C1}'],
  ['clap', '\u{1F44F}'],
  ['thinking', '\u{1F914}'],
  ['pray', '\u{1F64F}'],
  ['ok_hand', '\u{1F44C}']
]);

/** emoji 边界：前后须为空白或 Unicode 标点/符号（含 。 等 CJK 标点）。 */
const BOUNDARY_RE = /[\s\p{P}\p{S}]/u;

/** 上标：^content^（内容不含空白/换行/^；闭合后不紧跟 ^，与 del 的 (?=[^~]|$) 同思路）。 */
const SUP_RE = /^\^([^\s^]+)\^(?=[^\^]|$)/;
/** 下标：~content~（单波浪前导；内容不含空白/换行/~；闭合后不紧跟 ~）。 */
const SUB_RE = /^~([^\s~]+)~(?=[^~]|$)/;
/** 高亮：==content==（内容不含空白/换行/=；闭合后不紧跟 =）。 */
const MARK_RE = /^==([^\s=]+)==(?![=])/;
/** emoji：:shortcode:（短代码字符集：ASCII 字母/数字/_/+-）。 */
const EMOJI_RE = /^:([A-Za-z0-9_+\-]+):/;

/**
 * codeRunBefore：前序 token 是含反引号的 text token，说明正处于未闭合反引号
 * 串内（text 规则 first-group 路径，codespan 已在串首失败过），此时不转换，
 * 保持与无扩展基线一致的字面输出。已闭合的代码 span 是 codespan token，不在此列。
 */
function hasUnclosedCodeRun(tokens: Token[]): boolean {
  const prev = tokens[tokens.length - 1];
  return prev !== undefined && prev.type === 'text' && prev.raw.includes('`');
}

function supTokenizer(this: TokenizerThis, src: string, tokens: Token[]): Tokens.Generic | undefined {
  if (hasUnclosedCodeRun(tokens)) return undefined;
  const match = SUP_RE.exec(src);
  if (!match) return undefined;
  return { type: 'sup', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
}

function subTokenizer(this: TokenizerThis, src: string, tokens: Token[]): Tokens.Generic | undefined {
  if (hasUnclosedCodeRun(tokens)) return undefined;
  const match = SUB_RE.exec(src);
  if (!match) return undefined;
  return { type: 'sub', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
}

function markTokenizer(this: TokenizerThis, src: string, tokens: Token[]): Tokens.Generic | undefined {
  if (hasUnclosedCodeRun(tokens)) return undefined;
  const match = MARK_RE.exec(src);
  if (!match) return undefined;
  return { type: 'mark', raw: match[0], text: match[1], tokens: this.lexer.inlineTokens(match[1]) };
}

function emojiTokenizer(this: TokenizerThis, src: string, tokens: Token[]): Tokens.Generic | undefined {
  if (hasUnclosedCodeRun(tokens)) return undefined;
  const match = EMOJI_RE.exec(src);
  if (!match) return undefined;
  const char = EMOJI_MAP.get(match[1]);
  if (char === undefined) return undefined;
  const prev = tokens[tokens.length - 1];
  if (prev !== undefined && !BOUNDARY_RE.test(prev.raw.slice(-1))) return undefined;
  const after = src[match[0].length];
  if (after !== undefined && !BOUNDARY_RE.test(after)) return undefined;
  return { type: 'emoji', raw: match[0], text: char };
}

/** start() 返回 src.slice(1) 内首个完整合法模式的位置（tokenizer 必会匹配的约定）。 */
function supStart(src: string): number | undefined {
  return /\^[^\s^]+\^(?=[^\^]|$)/.exec(src)?.index;
}

function markStart(src: string): number | undefined {
  return /==[^\s=]+==(?![=])/.exec(src)?.index;
}

function emojiStart(src: string): number | undefined {
  const re = /:([A-Za-z0-9_+\-]+):/g;
  for (let match = re.exec(src); match !== null; match = re.exec(src)) {
    if (!EMOJI_MAP.has(match[1])) continue;
    const after = src[match.index + match[0].length];
    if (after === undefined || BOUNDARY_RE.test(after)) return match.index;
  }
  return undefined;
}

function supRenderer(this: RendererThis, token: Tokens.Generic): string {
  return `<sup>${this.parser.parseInline(token.tokens ?? [])}</sup>`;
}

function subRenderer(this: RendererThis, token: Tokens.Generic): string {
  return `<sub>${this.parser.parseInline(token.tokens ?? [])}</sub>`;
}

function markRenderer(this: RendererThis, token: Tokens.Generic): string {
  return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
}

function emojiRenderer(this: RendererThis, token: Tokens.Generic): string {
  return String(token.text);
}

const extensions: TokenizerAndRendererExtension[] = [
  { name: 'sup', level: 'inline', start: supStart, tokenizer: supTokenizer, renderer: supRenderer },
  { name: 'sub', level: 'inline', tokenizer: subTokenizer, renderer: subRenderer },
  { name: 'mark', level: 'inline', start: markStart, tokenizer: markTokenizer, renderer: markRenderer },
  { name: 'emoji', level: 'inline', start: emojiStart, tokenizer: emojiTokenizer, renderer: emojiRenderer }
];

export const inlineSyntaxExtension: MarkdownExtensionModule = {
  extensions
};
