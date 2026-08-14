// M1-2：数学扩展（KaTeX）。行内 $...$ / \(...\)，块级 $$...$$ / \[...\]。
//
// 产出结构（样式已由 styles.css 预置，本模块只产出结构，不得改 styles.css）：
//   - 行内：<span class="katex">（renderToString，throwOnError:false / trust:false /
//     output:'htmlAndMathml' → katex-mathml 语义层 + katex-html 视觉层双轨）；
//   - 块级：<span class="katex-display"> 包装（displayMode:true；KaTeX 错误路径不产出
//     该包装，实测后由本扩展补齐，保证错误公式同样以块级呈现）；
//   - 错误公式：<span class="katex-error">，不抛异常。
//
// 契约（定稿，见 markdownExtensionRegistry.ts 头部注释，不得更改）：
//   MarkdownExtensionModule = {
//     extensions: TokenizerAndRendererExtension[];            // marked.use 扩展
//     transformTokens?: (tokens, ctx) => tokens;              // 可选 token 变换
//   };
// 保持命名导出 mathExtension 不变（editorEntry 已按此名注册，注册序 math 在前）。
//
// 语法规则（实现前经 probe-math4.mjs 实测固化）：
//   - 行内 $...$：内容非空、不含 $ 与换行、首尾非空白；开侧前邻单词字符或 $ 不触发
//     （a$x$ 字面）；闭合 $ 后邻单词字符或 $ 不触发（$x$y$ / $a$$b$ 字面，GitHub 风格
//     闭侧规则）；前导反斜杠为奇数的 $ 不触发（转义由 marked escape 规则消费，天然
//     保持奇偶一致）。
//   - 行内 \(...\)：开侧只查前导反斜杠奇偶（LaTeX 风格，词中 a\(x\)b 亦可触发）；
//     内容可跨行（实测允许）；内容 trim 后非空。
//   - 块级 $$...$$ / \[...\]：只认独立行（行首、≤3 空格缩进；行内 a $$x$$ b、尾随
//     $$x$$ tail 不触发）；单行或多行（闭合行亦须行首、≤3 空格）；内容 trim 后非空。
//   - 代码 span / 围栏、4 空格缩进代码内不解析（内置规则原子消费）。
//
// marked 机制要点（marked@18.0.5，Lexer.ts 源码实证）：
//   - 扩展 tokenizer 在每个位置最先尝试；start() 只用于 text 规则的「裁剪」——
//     start 收到 src.slice(1)，返回定界符位置，text token 在此前停下让扩展命中。
//   - 块级裁剪（paragraph 规则）若命中非行首定界符，会把段落拆碎并产生 <br> 伪影
//     （probe Q2/R3 实测），故块级 start() 只匹配「\n + ≤3 空格」后的行首定界符，
//     行首本身的命中由 tokenizer 直接处理；tokenizer 再用前序 token 尾符校验行首。

import katex from 'katex';
import type { RendererThis, TokenizerAndRendererExtension, Tokens } from 'marked';
import type { MarkdownExtensionModule } from './markdownExtensionRegistry';

/** 与 katexDecision.spec.ts 决策一致的渲染选项（M1 定稿）。 */
const KATEX_OPTIONS = { throwOnError: false, trust: false, output: 'htmlAndMathml' } as const;
const KATEX_DISPLAY_OPTIONS = { ...KATEX_OPTIONS, displayMode: true } as const;

// 样式注入：浏览器端经 Vite 加载 KaTeX CSS（打包进应用样式）；node 单测环境跳过——
// node ESM 无法加载 .css（probe R2 实测 ERR_UNKNOWN_FILE_EXTENSION），
// 且单测只断言结构、不依赖样式。
if (typeof document !== 'undefined') {
  await import('katex/dist/katex.min.css');
}

/** 统计 pos 前连续反斜杠个数（转义奇偶判定）。 */
function backslashesBefore(src: string, pos: number): number {
  let n = 0;
  for (let i = pos - 1; i >= 0 && src[i] === '\\'; i--) n += 1;
  return n;
}

interface InlineMathMatch {
  raw: string;
  text: string;
}

/**
 * 行内 $...$：src[i] === '$'。prevChar 为前一个字符（undefined = 行首/未知）。
 * 返回 { raw, text } 或 null。start() 与 tokenizer 共用，保证两侧判定一致。
 */
function matchInlineDollar(src: string, i: number, prevChar: string | undefined): InlineMathMatch | null {
  if (src[i + 1] === '$') return null; // $$ 是块级定界符，行内不触发
  if (prevChar === '$' || (prevChar !== undefined && /\w/.test(prevChar))) return null; // 开侧
  for (let j = i + 1; j < src.length; j++) {
    const ch = src[j];
    if (ch === '\n') return null; // 内容不得含换行
    if (ch !== '$') continue;
    if (backslashesBefore(src, j) % 2 === 1) continue; // 转义 $ 是内容字符，继续找闭合
    const content = src.slice(i + 1, j);
    if (!/^\S(?:[^$\n]*?\S)?$/.test(content)) return null; // 非空、首尾非空白、不含 $/\n
    const next = src[j + 1];
    if (next === undefined || !/[\w$]/.test(next)) return { raw: src.slice(i, j + 1), text: content };
    return null; // 闭合后邻单词字符/$：整串不触发（$x$y$ 保持字面）
  }
  return null;
}

/**
 * 行内 \(...\)：src[i] === '\\' && src[i + 1] === '('。只查开侧奇偶，不做单词边界
 * 检查（LaTeX 风格，a\(x\)b 可触发）；闭合取首个未转义的 \)。内容 trim 后非空。
 */
function matchInlineParen(src: string, i: number): InlineMathMatch | null {
  if (backslashesBefore(src, i) % 2 === 1) return null; // 前导奇反斜杠 → 转义，不触发
  for (let j = i + 2; j + 1 < src.length; j++) {
    if (src[j] === '\\' && src[j + 1] === ')' && backslashesBefore(src, j) % 2 === 0) {
      const content = src.slice(i + 2, j);
      if (content.trim() === '') return null;
      return { raw: src.slice(i, j + 2), text: content };
    }
  }
  return null;
}

interface BlockMathMatch {
  len: number;
  text: string;
}

/**
 * 块级 $$...$$ / \[...\]：src[i] 为定界符首字符（i 处即行首，缩进由调用方处理）。
 * 单行（$$x$$，内容不含 $/换行，闭合后仅空白至行尾）或多行（闭合行亦须行首）；
 * 内容 trim 后非空。返回 { len, text } 或 null。
 */
function matchBlock(src: string, i: number): BlockMathMatch | null {
  const rest = src.slice(i);
  let m: RegExpExecArray | null = null;
  if (rest.startsWith('$$')) {
    m = /^\$\$([^$\n]+)[ \t]*\$\$[ \t]*(?=\n|$)/.exec(rest)
      || /^\$\$\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?=\n|$)/.exec(rest);
  } else if (rest.startsWith('\\[')) {
    m = /^\\\[([^\]\n]+)[ \t]*\\\][ \t]*(?=\n|$)/.exec(rest)
      || /^\\\[\n([\s\S]*?)\n {0,3}\\\][ \t]*(?=\n|$)/.exec(rest);
  }
  if (!m) return null;
  const content = (m[1] ?? '').trim();
  if (!content) return null;
  return { len: m[0].length, text: content };
}

/** 块级 start()：只认「\n + ≤3 空格」后的行首定界符（行首本身由 tokenizer 直接处理）。 */
function blockStart(src: string): number {
  for (let i = 0; i < src.length; i++) {
    const isDollar = src[i] === '$' && src[i + 1] === '$';
    const isBracket = src[i] === '\\' && src[i + 1] === '[';
    if (!isDollar && !isBracket) continue;
    if (backslashesBefore(src, i) % 2 === 1) continue;
    // 行首检查：前邻 ≤3 空格（不含 tab），再前必须为 \n；i === 0 跳过（交给 tokenizer）
    let j = i;
    let spaces = 0;
    while (j > 0 && src[j - 1] === ' ' && spaces < 3) {
      j -= 1;
      spaces += 1;
    }
    if (j === 0 || src[j - 1] !== '\n') continue;
    if (matchBlock(src, i)) return i;
  }
  return -1;
}

export const mathExtension: MarkdownExtensionModule = {
  extensions: [
    {
      name: 'inlineMath',
      level: 'inline',
      start(src: string): number {
        for (let i = 0; i < src.length; i++) {
          if (src[i] === '$' && backslashesBefore(src, i) % 2 === 0) {
            const prev = i > 0 ? src[i - 1] : undefined;
            if (matchInlineDollar(src, i, prev)) return i;
          }
          if (src[i] === '\\' && src[i + 1] === '(' && backslashesBefore(src, i) % 2 === 0) {
            if (matchInlineParen(src, i)) return i;
          }
        }
        return -1;
      },
      tokenizer(src: string, tokens: Array<{ raw: string }>) {
        const prev = tokens.length ? tokens[tokens.length - 1].raw.slice(-1) : undefined;
        if (src[0] === '$') {
          const m = matchInlineDollar(src, 0, prev);
          if (m) return { type: 'inlineMath', raw: m.raw, text: m.text };
        }
        if (src[0] === '\\' && src[1] === '(') {
          const m = matchInlineParen(src, 0);
          if (m) return { type: 'inlineMath', raw: m.raw, text: m.text };
        }
        return undefined;
      },
      renderer(this: RendererThis, token: Tokens.Generic) {
        return katex.renderToString(token.text ?? '', KATEX_OPTIONS);
      }
    },
    {
      name: 'blockMath',
      level: 'block',
      start: blockStart,
      tokenizer(src: string, tokens: Array<{ raw: string }>) {
        // 前序 token 尾符校验行首（块起点/上一 token 以换行结尾）；防段内 $$ 拆段。
        const prevRaw = tokens.length ? tokens[tokens.length - 1].raw : undefined;
        if (prevRaw !== undefined && !/[\n][ \t]*$/.test(prevRaw)) return undefined;
        let i = 0;
        while (i < src.length && src[i] === ' ' && i < 3) i += 1;
        if (i >= src.length) return undefined;
        const isDollar = src[i] === '$' && src[i + 1] === '$';
        const isBracket = src[i] === '\\' && src[i + 1] === '[';
        if (!isDollar && !isBracket) return undefined;
        if (backslashesBefore(src, i) % 2 === 1) return undefined;
        const m = matchBlock(src, i);
        if (!m) return undefined;
        return { type: 'blockMath', raw: src.slice(0, i + m.len), text: m.text };
      },
      renderer(this: RendererThis, token: Tokens.Generic) {
        const html = katex.renderToString(token.text ?? '', KATEX_DISPLAY_OPTIONS);
        // 实测：KaTeX displayMode 错误路径不产出 .katex-display 包装，补齐以保持一致。
        const wrapped = html.includes('class="katex-display"') ? html : `<span class="katex-display">${html}</span>`;
        return wrapped + '\n';
      }
    }
  ]
};
