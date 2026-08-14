// M3-TABLE：基于 token 定位的表格编辑纯逻辑（B07）。
//
// 定位策略：接线层用 marked.lexer 的 table token 拿整表源码区间（raw 累积偏移），
// 本模块只在该区间内按行边界编辑——代码块/脚注/Front Matter 内的 `|` 文本
// 不产生 table token，天然不误判。单元格切分按未转义 `|`（`\|` 不切）。
//
// 粒度（B07 决策）：行级/分隔行级——插入行、删除行、插入列、删除列、改对齐。
// 所有错误路径返回原字符串（幂等安全）。

export interface TableRange {
  start: number;
  end: number;
}

export type TableEditOp =
  | { type: 'insertRow'; at: 'above' | 'below'; rowIndex: number }
  | { type: 'deleteRow'; rowIndex: number }
  | { type: 'insertColumn'; at: 'left' | 'right'; colIndex: number }
  | { type: 'deleteColumn'; colIndex: number }
  | { type: 'setAlign'; colIndex: number; align: 'left' | 'center' | 'right' };

/** 按未转义 `|` 切分表格行；`\|` 保留在单元格内容里不切分。行首尾的边界 `|` 是分隔符不是单元格。 */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length && line[i + 1] === '|') {
      current += '\\|';
      i += 1;
      continue;
    }
    if (ch === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  // 边界 `|` 产生的首尾空元素：行以 | 开头则丢弃第一个，以 | 结尾则丢弃最后一个
  if (line.startsWith('|')) cells.shift();
  if (line.endsWith('|')) cells.pop();
  return cells;
}

/** 用单元格数组重建一行（统一裁剪补位：spaced 风格每格 ` x `，tight 风格无空白）。 */
function joinCells(cells: string[], style: 'spaced' | 'tight'): string {
  if (style === 'tight') return '|' + cells.map((c) => c.trim()).join('|') + '|';
  return '|' + cells.map((c) => ' ' + c.trim() + ' ').join('|') + '|';
}

function rowStyle(line: string): 'spaced' | 'tight' {
  return line.includes(' | ') || line.endsWith(' |') ? 'spaced' : 'tight';
}

/** 判定分隔行：第二行形态（单元格全是 `---` 类标记）。 */
function isDelimiterRow(line: string): boolean {
  const cells = splitCells(line).filter((c) => c.trim() !== '');
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

function makeDelimiterCell(align: 'left' | 'center' | 'right' | null): string {
  if (align === 'left') return ':---';
  if (align === 'center') return ':---:';
  if (align === 'right') return '---:';
  return '---';
}

interface ParsedTable {
  lines: string[];
  lineStarts: number[]; // 每行在区间内的起始偏移（相对 range.start）
  headerIndex: number;
  delimiterIndex: number; // -1 表示无分隔行（非 GFM 表头）
}

function parseTable(source: string, range: TableRange): ParsedTable | null {
  const block = source.slice(range.start, range.end);
  const lines = block.split('\n');
  if (lines.length < 2) return null;
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const headerIndex = 0;
  const delimiterIndex = isDelimiterRow(lines[1]) ? 1 : -1;
  return { lines, lineStarts, headerIndex, delimiterIndex };
}

/** 区间内替换整块表格（编辑后行数可能变化）。 */
function replaceBlock(source: string, range: TableRange, newBlock: string): string {
  return source.slice(0, range.start) + newBlock + source.slice(range.end);
}

function applyOp(block: string, op: TableEditOp): string {
  const range: TableRange = { start: 0, end: block.length };
  const parsed = parseTable(block, range);
  if (!parsed) return block;
  const { lines, delimiterIndex } = parsed;
  const bodyStart = delimiterIndex >= 0 ? delimiterIndex + 1 : 1;
  const style = rowStyle(lines[0]);

  switch (op.type) {
    case 'insertRow': {
      const rowIndex = bodyStart + op.rowIndex; // 数据行 → 物理行索引
      if (rowIndex < bodyStart || rowIndex > lines.length - 1) return block;
      const refCells = splitCells(lines[rowIndex]);
      const newRow = joinCells(refCells, style);
      lines.splice(op.at === 'above' ? rowIndex : rowIndex + 1, 0, newRow);
      return lines.join('\n');
    }
    case 'deleteRow': {
      const rowIndex = bodyStart + op.rowIndex;
      if (rowIndex < bodyStart || rowIndex > lines.length - 1) return block;
      // 删除最后一行 → 整表删除（接线层负责把区间替换为空）
      if (bodyStart === rowIndex && rowIndex === lines.length - 1) return '';
      lines.splice(rowIndex, 1);
      return lines.join('\n');
    }
    case 'insertColumn': {
      const headerCells = splitCells(lines[parsed.headerIndex]);
      const colIndex = Math.max(0, Math.min(op.colIndex, headerCells.length));
      const target = op.at === 'left' ? colIndex : colIndex + 1;
      const updated = lines.map((line, i) => {
        const cells = splitCells(line);
        if (delimiterIndex >= 0 && i === delimiterIndex) {
          cells.splice(target, 0, '---');
        } else {
          cells.splice(target, 0, '');
        }
        return joinCells(cells, style);
      });
      return updated.join('\n');
    }
    case 'deleteColumn': {
      const headerCells = splitCells(lines[parsed.headerIndex]);
      if (op.colIndex < 0 || op.colIndex >= headerCells.length) return block;
      const updated = lines.map((line) => {
        const cells = splitCells(line);
        if (op.colIndex < cells.length) cells.splice(op.colIndex, 1);
        return joinCells(cells, style);
      });
      return updated.join('\n');
    }
    case 'setAlign': {
      if (delimiterIndex < 0) return block; // 无分隔行不可改对齐
      const delimiterCells = splitCells(lines[delimiterIndex]);
      if (op.colIndex < 0 || op.colIndex >= delimiterCells.length) return block;
      delimiterCells[op.colIndex] = makeDelimiterCell(op.align);
      lines[delimiterIndex] = joinCells(delimiterCells, style);
      return lines.join('\n');
    }
  }
  return block;
}

/**
 * 主入口：在 markdown 源码的表格区间上应用编辑操作。
 * 删除最后一行时返回的块为空串——接线层应把区间替换为空（去掉整表）。
 */
export function editTable(markdown: string, range: TableRange, op: TableEditOp): string {
  if (!(range.start >= 0 && range.end >= range.start && range.end <= markdown.length)) {
    return markdown;
  }
  const block = markdown.slice(range.start, range.end);
  const next = applyOp(block, op);
  return next === block ? markdown : replaceBlock(markdown, range, next);
}

/**
 * 接线辅助：从 marked.lexer tokens 中提取全部 table token 的源码区间。
 * 块级累积 `token.raw.length`；嵌套（list/blockquote 内）需要递归——本函数
 * 处理顶层与 `tokens` 子数组递归，与 M1 单管线 `_lastTokens` 消费一致。
 */
export function collectTableRanges(
  tokens: Array<{ type: string; raw: string; tokens?: unknown[] }>,
  baseOffset = 0
): TableRange[] {
  const ranges: TableRange[] = [];
  let offset = baseOffset;
  for (const token of tokens) {
    const start = offset;
    offset += token.raw.length;
    if (token.type === 'table') {
      ranges.push({ start, end: offset });
    }
    if (token.tokens && token.tokens.length) {
      // 子 token 的 raw 相对 item.text 等，不直接累加——list_item 场景由
      // 上层 item.raw 定位；这里只处理 blockquote 的整块子 token。
      if (token.type === 'blockquote') {
        const first = token.tokens[0] as { raw?: string } | undefined;
        const childBase = first?.raw ? start + token.raw.indexOf(first.raw) : start;
        ranges.push(...collectTableRanges(token.tokens as Array<{ type: string; raw: string; tokens?: unknown[] }>, childBase));
      }
    }
  }
  return ranges;
}
