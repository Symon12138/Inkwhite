// M1-5 实现：Front Matter 扩展（--- 元数据卡片）。
//
// 能力：
//   - block tokenizer：文档开头 ---\n...--- 元数据块 → frontMatter token；
//   - 识别守卫（全部满足才识别，否则返回 undefined 回落无扩展基线 hr + setext）：
//       a) 行首 --- 开头（^---[ \t]*\n；--- 单行是 hr，不匹配）；
//       b) this.lexer.state.top === true（列表项递归内 top = false，拦截）；
//       c) tokens === this.lexer.tokens（blockquote 递归强制 top = true 且其子
//          token 数组与顶层 tokens 不同——用数组同一性排除引用上下文，见
//          tests/unit/markdownExtensionsSpike.test.ts 事实 3）；
//       d) 顶层 tokens 仅含 space（文档开头；容忍前导空行，正文出现后不再识别）；
//       e) 扫描至闭合 --- 行（^---[ \t]*$），且正文至少一条 `key: value`；
//       未闭合 / 无 key:value / 非首行 / 引用列表内 → undefined 回落基线；
//   - raw 含整个 FM 块（含闭合行与尾随换行）→ 后续 token 的源偏移零平移；
//   - start() 只匹配「真正行首」的 ---\n（marked 传 src.slice(1)：位置 0 在原文中
//     处于行中，返回它会拆碎段落造成 x--- 行中误触发）；位置 ≥1 且前邻为 \n；
//   - renderer 产 <details class="front-matter"><summary>元数据</summary>
//     <dl><dt>key</dt><dd>value</dd>…</dl></details>（可折叠，结构样式已由
//     styles.css 预置）；键值经 HTML 转义以 textContent 安全呈现，不拼接不可信
//     innerHTML（<script> 恶意值不执行）。
//
// 契约（定稿，见 markdownExtensionRegistry.ts 头部注释，不得更改）：
//   MarkdownExtensionModule = { extensions; transformTokens? };
// 保持命名导出 frontMatterExtension 不变（editorEntry 已按此名注册，注册序第 5）。

import type { Token, Tokens, TokenizerAndRendererExtension } from 'marked';
import type { MarkdownExtensionModule } from './markdownExtensionRegistry';

/** FM 键值行 */
interface FrontMatterEntry {
  key: string;
  value: string;
}

/** frontMatter token 上挂的键值私有字段 */
interface FrontMatterToken extends Tokens.Generic {
  type: 'frontMatter';
  meta: FrontMatterEntry[];
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
 * 解析 FM 块：src 须以 ^---[ \t]*\n 开头；扫描至闭合 ^---[ \t]*$ 行；
 * 正文至少一条 `key: value`（键非空、值首字符非空白）才识别。
 * 未闭合 / 无 key:value → null（回落基线）。
 * 返回 raw（含闭合行尾随换行，源偏移零平移）与键值列表。
 */
function parseFrontMatter(src: string): { raw: string; meta: FrontMatterEntry[] } | null {
  const open = /^---[ \t]*\n/.exec(src);
  if (!open) return null;
  let pos = open[0].length;
  const meta: FrontMatterEntry[] = [];
  let hasKeyValue = false;
  while (pos < src.length) {
    const nl = src.indexOf('\n', pos);
    const lineEnd = nl === -1 ? src.length : nl;
    const line = src.slice(pos, lineEnd);
    if (/^---[ \t]*$/.test(line)) {
      if (!hasKeyValue) return null;
      const rawEnd = nl === -1 ? src.length : nl + 1;
      return { raw: src.slice(0, rawEnd), meta };
    }
    const kv = /^([^:]+):[ \t]*(\S.*)$/.exec(line);
    if (kv) {
      hasKeyValue = true;
      meta.push({ key: kv[1].trim(), value: kv[2].trim() });
    }
    pos = nl === -1 ? src.length : nl + 1;
  }
  return null; // 未闭合
}

const frontMatterExtensionDef: TokenizerAndRendererExtension = {
  name: 'frontMatter',
  level: 'block',
  start(src: string): number | undefined {
    // marked 传 src.slice(1)：位置 0 在原文中处于行中（前邻字符非换行），返回它会
    // 拆碎段落造成行中误触发；只认前邻为 \n 的 --- 行首。
    const m = /\n---[ \t]*\n/.exec(src);
    if (!m) return undefined;
    return m.index + 1;
  },
  tokenizer(src: string, tokens: Token[]): Token | undefined {
    // 列表项递归内 top === false；blockquote 递归 top 被强制 true，但传入的是
    // 子 token 数组（与 this.lexer.tokens 不同一），以此排除引用上下文。
    if (this.lexer.state.top !== true) return undefined;
    if (tokens !== this.lexer.tokens) return undefined;
    // 文档开头：此前只允许空白（space）token；正文出现后不再识别（非首行回落基线）。
    if (!tokens.every((t) => t.type === 'space')) return undefined;
    const parsed = parseFrontMatter(src);
    if (!parsed) return undefined;
    return { type: 'frontMatter', raw: parsed.raw, meta: parsed.meta };
  },
  renderer(token: Tokens.Generic): string {
    const meta = (token as FrontMatterToken).meta ?? [];
    const rows = meta
      .map((kv) => `<dt>${escapeHtml(kv.key)}</dt><dd>${escapeHtml(kv.value)}</dd>`)
      .join('');
    // 与其他块级 renderer 一致，输出以换行结尾
    return `<details class="front-matter"><summary>元数据</summary><dl>${rows}</dl></details>\n`;
  }
};

export const frontMatterExtension: MarkdownExtensionModule = {
  extensions: [frontMatterExtensionDef]
};
