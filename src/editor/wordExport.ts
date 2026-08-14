// M2-EXPORT-CORE：docx 生成（docx@9.7.1，WORD_SPIKE.md 选型结论）。
// 把 flattenDocument 的扁平化单文档映射为 OOXML 文档树：
//   标题（HeadingLevel）→ 段落；段落/行内样式 → TextRun（bold/italics/等宽/换行）；
//   列表 → bullet/numbering 段落（任务列表勾选态以 ☑/☐ 符号保留）；
//   代码 → 等宽字体段落（docx 无 CodeBlock，按实测以 Consolas 段落输出）；
//   表格 → Table/TableRow/TableCell；图片 → ImageRun（data URL → 字节）；
//   公式/图表占位（span[data-word-image]）→ 按 key 查 WordImage 产出 ImageRun，
//   失败条目输出占位文本（DG9 Word 出口）。
// 产物由 Packer 打包为 ZIP（ArrayBuffer，PK 头）；结构化断言见
// tests/unit/wordExport.test.ts（node zlib 解压 document.xml）与
// tests/e2e/htmlExport.spec.ts（页内 ZIP 条目扫描）。

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  type ParagraphChild
} from 'docx';
import type { WordImage } from './flattenDocument.ts';

const MONO_FONT = 'Consolas';
const ORDERED_LIST_REFERENCE = 'export-ordered-list';
const FALLBACK_IMAGE_WIDTH = 480;
const FALLBACK_IMAGE_HEIGHT = 360;
const FAILED_IMAGE_TEXT = '（图表渲染失败）';
const FAILED_REMOTE_IMAGE_TEXT = '（图片未能载入）';

export interface BuildDocxInput {
  title: string;
  /** flattenForWord 产出的扁平化文档树 */
  flattenedRoot: Element;
  /** renderWordImages 回填后的图片条目（key 与占位节点 data-word-image 对应） */
  images: WordImage[];
}

interface BuildContext {
  images: Map<string, WordImage>;
}

const HEADING_LEVELS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6
};

// 容器标签：按块级内容递归，否则作为单段落输出
const CONTAINER_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN', 'HEADER', 'FOOTER',
  'BLOCKQUOTE', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION', 'CENTER'
]);

const BLOCK_TAGS = new Set([
  ...CONTAINER_TAGS,
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'IMG', 'HR'
]);

/**
 * 构建 docx 文档：扁平化 DOM 树 → docx 文档树 → Packer 打包为 ArrayBuffer。
 * 纯同步映射（图片字节已在 data URL 里）；耗时点在消费方的 flatten/render 阶段。
 */
export async function buildDocx(input: BuildDocxInput): Promise<ArrayBuffer> {
  const ctx: BuildContext = {
    images: new Map(input.images.map((image) => [image.key, image]))
  };
  const children = buildBlocks(input.flattenedRoot, ctx);
  const titleParagraph = new Paragraph({
    text: input.title || '未命名文档',
    heading: HeadingLevel.TITLE
  });
  const doc = new Document({
    title: input.title,
    numbering: {
      config: [{
        reference: ORDERED_LIST_REFERENCE,
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START
        }]
      }]
    },
    sections: [{ properties: {}, children: [titleParagraph, ...children] }]
  });
  return Packer.toArrayBuffer(doc);
}

// ─────────────────────────────────────────────────────────────────────────────
// 块级映射
// ─────────────────────────────────────────────────────────────────────────────
function buildBlocks(root: Element, ctx: BuildContext): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const child of Array.from(root.children)) {
    const tag = (child.tagName || '').toUpperCase();
    if (HEADING_LEVELS[tag]) {
      out.push(new Paragraph({ children: inlineRuns(child, ctx), heading: HEADING_LEVELS[tag] }));
      continue;
    }
    if (tag === 'UL') {
      for (const li of listItems(child)) {
        const prefix = taskItemPrefix(li);
        out.push(new Paragraph({
          children: prefix ? [new TextRun(prefix), ...inlineRuns(li, ctx)] : inlineRuns(li, ctx),
          bullet: { level: 0 }
        }));
      }
      continue;
    }
    if (tag === 'OL') {
      for (const li of listItems(child)) {
        out.push(new Paragraph({ children: inlineRuns(li, ctx), numbering: { reference: ORDERED_LIST_REFERENCE, level: 0 } }));
      }
      continue;
    }
    if (tag === 'PRE') {
      out.push(codeParagraph(child));
      continue;
    }
    if (tag === 'TABLE') {
      out.push(tableBlock(child, ctx));
      continue;
    }
    if (tag === 'IMG') {
      const run = imageRunFromImg(child);
      out.push(new Paragraph({ children: run ? [run] : [new TextRun(FAILED_REMOTE_IMAGE_TEXT)] }));
      continue;
    }
    if (tag === 'SPAN' && child.getAttribute('data-word-image')) {
      out.push(wordImageParagraph(child, ctx));
      continue;
    }
    if (tag === 'HR') {
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB' } }, children: [] }));
      continue;
    }
    out.push(...paragraphsFrom(child, ctx));
  }
  return out;
}

function listItems(list: Element): Element[] {
  return Array.from(list.children).filter((c) => (c.tagName || '').toUpperCase() === 'LI');
}

// 容器元素：含块级后代则递归，否则作为单段落输出（行内内容由 inlineRuns 处理）
function paragraphsFrom(el: Element, ctx: BuildContext): (Paragraph | Table)[] {
  if (hasBlockChildren(el)) return buildBlocks(el, ctx);
  const runs = inlineRuns(el, ctx);
  return runs.length ? [new Paragraph({ children: runs })] : [];
}

function hasBlockChildren(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    const tag = (child.tagName || '').toUpperCase();
    if (BLOCK_TAGS.has(tag)) return true;
    if (hasBlockChildren(child)) return true;
  }
  return false;
}

function codeParagraph(pre: Element): Paragraph {
  const text = (pre.textContent || '').replace(/\n$/, '');
  const lines = text.split('\n');
  const runs = lines.map((line, i) => new TextRun({ text: line, font: MONO_FONT, break: i > 0 ? 1 : 0 }));
  return new Paragraph({ children: runs });
}

function tableBlock(table: Element, ctx: BuildContext): Table {
  const rows: TableRow[] = [];
  for (const row of tableRows(table)) {
    const cells = Array.from(row.children).filter((c) => {
      const tag = (c.tagName || '').toUpperCase();
      return tag === 'TD' || tag === 'TH';
    });
    rows.push(new TableRow({
      children: cells.map((cell) => new TableCell({
        children: [new Paragraph({ children: inlineRuns(cell, ctx) })]
      }))
    }));
  }
  return new Table({ rows });
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of Array.from(table.children)) {
    const tag = (child.tagName || '').toUpperCase();
    if (tag === 'TR') rows.push(child);
    if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TFOOT') rows.push(...tableRows(child));
  }
  return rows;
}

// 任务列表勾选态：以 ☑/☐ 前缀符号保留（checkbox 控件本身不映射）
function taskItemPrefix(li: Element): string {
  if (!(li.getAttribute('class') || '').split(/\s+/).includes('task-list-item')) return '';
  const box = li.querySelector('input');
  if (!box) return '';
  const checked = (box as HTMLInputElement).checked || box.getAttribute('checked') !== null;
  return checked ? '☑ ' : '☐ ';
}

// 公式/图表占位：按 key 查 WordImage；渲染失败输出占位文本（DG9 Word 出口）
function wordImageParagraph(placeholder: Element, ctx: BuildContext): Paragraph {
  const key = placeholder.getAttribute('data-word-image') || '';
  const entry = ctx.images.get(key);
  const run = entry ? imageRunFromEntry(entry) : null;
  if (!run || !entry) {
    return new Paragraph({ children: [new TextRun(FAILED_IMAGE_TEXT)] });
  }
  return new Paragraph({
    children: [run],
    alignment: entry.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 图片映射（data URL → ImageRun；失败 → null，由调用方输出占位文本）
// ─────────────────────────────────────────────────────────────────────────────
function imageRunFromEntry(entry: WordImage | undefined): ImageRun | null {
  if (!entry || entry.failed || !entry.dataUrl) return null;
  return imageRunFromDataUrl(entry.dataUrl, entry.widthPx, entry.heightPx, '');
}

function imageRunFromImg(img: Element): ImageRun | null {
  const src = img.getAttribute('src') || '';
  const width = parseFloat(img.getAttribute('width') || '') || FALLBACK_IMAGE_WIDTH;
  const height = parseFloat(img.getAttribute('height') || '') || FALLBACK_IMAGE_HEIGHT;
  return imageRunFromDataUrl(src, width, height, img.getAttribute('alt') || '');
}

// data:image/(png|jpeg|jpg|gif);base64,… → ImageRun；识别不了的格式返回 null
function imageRunFromDataUrl(dataUrl: string, width: number, height: number, alt: string): ImageRun | null {
  const match = /^data:image\/(png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const type = mime === 'png' ? 'png' : (mime === 'jpeg' || mime === 'jpg') ? 'jpg' : 'gif';
  return new ImageRun({
    type,
    data: base64ToBytes(match[2]),
    transformation: {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    },
    altText: alt ? { name: alt, title: alt, description: alt } : undefined
  });
}

// base64 → Uint8Array：node（Buffer）与浏览器（atob）双环境
function base64ToBytes(base64: string): Uint8Array {
  const nodeBuffer = (globalThis as { Buffer?: { from(data: string, enc: string): Uint8Array } }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(base64, 'base64');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// 行内映射
// ─────────────────────────────────────────────────────────────────────────────
function inlineRuns(el: Element, ctx: BuildContext): ParagraphChild[] {
  const runs: ParagraphChild[] = [];
  walkInlineChildren(el, ctx, false, false, false, runs);
  return runs;
}

// 行内节点调度：文本 → TextRun（继承 bold/italics/mono 上下文）；BR → 换行；
// IMG / 公式图表占位 → ImageRun；strong/b、em/i、code 切换样式上下文后递归；
// 其余标签（a/u/s/del/mark/sup/sub/span…）透传文字与子结构。
function walkInlineNode(
  node: Node,
  ctx: BuildContext,
  bold: boolean,
  italics: boolean,
  mono: boolean,
  runs: ParagraphChild[]
): void {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const textValue = node.textContent || '';
    if (textValue) {
      runs.push(new TextRun({
        text: textValue,
        bold: bold || undefined,
        italics: italics || undefined,
        font: mono ? MONO_FONT : undefined
      }));
    }
    return;
  }
  const element = node as Element;
  const tag = (element.tagName || '').toUpperCase();
  if (tag === 'BR') {
    runs.push(new TextRun({ break: 1 }));
    return;
  }
  if (tag === 'IMG') {
    const run = imageRunFromImg(element);
    if (run) runs.push(run);
    return;
  }
  if (tag === 'SPAN' && element.getAttribute('data-word-image')) {
    const key = element.getAttribute('data-word-image') || '';
    const run = imageRunFromEntry(ctx.images.get(key));
    if (run) runs.push(run);
    return;
  }
  if (tag === 'STRONG' || tag === 'B') {
    walkInlineChildren(element, ctx, true, italics, mono, runs);
    return;
  }
  if (tag === 'EM' || tag === 'I') {
    walkInlineChildren(element, ctx, bold, true, mono, runs);
    return;
  }
  if (tag === 'CODE') {
    walkInlineChildren(element, ctx, bold, italics, true, runs);
    return;
  }
  walkInlineChildren(element, ctx, bold, italics, mono, runs);
}

function walkInlineChildren(
  el: Element,
  ctx: BuildContext,
  bold: boolean,
  italics: boolean,
  mono: boolean,
  runs: ParagraphChild[]
): void {
  for (const child of Array.from(el.childNodes)) {
    walkInlineNode(child, ctx, bold, italics, mono, runs);
  }
}
