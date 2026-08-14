// M3-PASTE：粘贴分流与 HTML→Markdown 转换（B09）。
//
// 接线层（编辑区 paste 事件）把 clipboardData 摘要成 PasteInput 交给本模块：
// 图片文件 → 'image'；text/html → 'html'（Turndown + 表格规则转 Markdown）；
// 否则 'plain'。所有函数纯逻辑、node 可跑。

import TurndownService from 'turndown';
import { addTableRules } from './markdownTableRules.ts';

export interface PasteInput {
  /** clipboardData.types 的快照（小写） */
  types: string[];
  /** clipboardData.files 中是否含 image/* 文件 */
  hasImageFiles: boolean;
  /** clipboardData.getData('text/html')（可能为 null） */
  html: string | null;
  /** clipboardData.getData('text/plain')（可能为 null） */
  text: string | null;
}

export type PasteKind = 'image' | 'html' | 'plain';

/** 分流决策：图片优先 → html → plain。 */
export function classifyPaste(data: PasteInput): PasteKind {
  if (data.hasImageFiles) return 'image';
  if (data.types.includes('text/html') && data.html) return 'html';
  return 'plain';
}

let turndown: TurndownService | null = null;

function turndownInstance(): TurndownService {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      hr: '---'
    });
    addTableRules(turndown);
  }
  return turndown;
}

/**
 * HTML → Markdown（GFM 语义保留：标题/列表/链接/表格/代码/粗斜体）。
 * 表格规则来自 markdownTableRules.addTableRules（含 `\|` 转义与 <br>）。
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  return turndownInstance().turndown(html).trim();
}

/**
 * 粘贴防劫持：剥离 `javascript:` 链接（保留链接文本）、清理残留可执行 HTML。
 * Turndown 对未知标签默认丢弃，这里兜底处理它透传的原始 HTML 片段。
 */
export function sanitizeForInsert(markdown: string): string {
  let out = String(markdown ?? '');
  // [text](javascript:...) / [text](vbscript:...) / [text](data:...) → 保留文本
  // （URL 内允许一层括号，如 alert(1)）
  out = out.replace(/\[([^\]]*)\]\((javascript|vbscript|data):((?:[^()]|\([^)]*\))*)\)/gi, '$1');
  // 裸 javascript: URL 文本（无链接包裹）→ 删掉协议部分
  out = out.replace(/(javascript|vbscript):/gi, '');
  // 残留 <script ...>...</script> / 事件属性 / on*=
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return out;
}

/** 接线层可直接消费的粘贴结果。 */
export interface PasteResult {
  kind: PasteKind;
  /** html/plain 时的 Markdown 文本（已 sanitize） */
  markdown?: string;
  /** image 时的原始文件列表（接线层落盘/内联） */
  imageFiles?: File[];
}

/** 组合分流 + 转换 + 净化，返回接线层消费结果。 */
export function buildPasteResult(data: PasteInput, imageFiles: File[] = []): PasteResult {
  const kind = classifyPaste(data);
  if (kind === 'image') return { kind, imageFiles };
  const raw = kind === 'html' ? htmlToMarkdown(data.html ?? '') : (data.text ?? '');
  return { kind, markdown: sanitizeForInsert(raw).trim() };
}
