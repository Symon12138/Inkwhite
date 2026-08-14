// M4-F：状态统计（B22）。
// 统计口径（写死并测试，不声称与 Typora 内部算法相同）：
//   - 字数 words：CJK 字符逐个计数 + 连续拉丁字母/数字串计 1 个词
//   - 字符数 chars：非空白字符数（含 CJK 与标点）
//   - 行数 lines：按 \n 切分（空文档为 0；尾部无换行也算一行）
//   - 段落数 paragraphs：按空行分隔的 trim 后非空块
// 全部纯函数，node 可单测。

const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const WORD_RE = /[A-Za-z0-9]+/g;

export function countWords(text: string): number {
  let words = 0;
  for (const ch of text) {
    if (CJK_RE.test(ch)) words += 1;
  }
  const latin = text.match(WORD_RE);
  if (latin) words += latin.length;
  return words;
}

export function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

export function countParagraphs(text: string): number {
  if (!text.trim()) return 0;
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0).length;
}

export interface TextStats {
  words: number;
  chars: number;
  lines: number;
  paragraphs: number;
}

export function computeStats(text: string): TextStats {
  return {
    words: countWords(text),
    chars: countChars(text),
    lines: countLines(text),
    paragraphs: countParagraphs(text)
  };
}

/** 状态栏展示（口径同 computeStats）。 */
export function formatStats(stats: TextStats): string {
  return stats.words + ' 字 · ' + stats.chars + ' 字符 · ' + stats.lines + ' 行 · ' + stats.paragraphs + ' 段';
}
