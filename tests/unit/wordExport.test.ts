// M2-EXPORT-CORE：docx 生成（src/editor/wordExport.ts）的 node 单测。
// 断言策略（实测可行方案，记录于交付报告）：
//   - PK 魔数 + 字节数阈值（docx 包 Packer 产出 ZIP 结构，PK 头是硬证据）；
//   - ZIP 条目扫描：手写 EOCD+中央目录解析（~45 行，零依赖，node 单测与 E2E 页内
//     各持一份同构实现）；
//   - node 侧用内置 node:zlib 解压 word/document.xml 做内容级结构化断言
//     （浏览器无 zlib，内容断言只能在 node 侧；E2E 以条目扫描 + 页内产物形状断言兜底）。
// 红测先行：本文件先写，跑一遍确认失败（模块不存在），再实现到全绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { buildDocx, type BuildDocxInput } from '../../src/editor/wordExport.ts';
import type { WordImage } from '../../src/editor/flattenDocument.ts';

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ─────────────────────────────────────────────────────────────────────────────
// ZIP 工具：条目扫描（EOCD + 中央目录）与条目内容读取（node zlib 解压）
// ─────────────────────────────────────────────────────────────────────────────
interface ZipEntryInfo {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
}

function zipEntries(bytes: Uint8Array): ZipEntryInfo[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const from = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const out: ZipEntryInfo[] = [];
  for (let i = 0; i < count; i++) {
    if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4b || bytes[pos + 2] !== 0x01 || bytes[pos + 3] !== 0x02) break;
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    let name = '';
    for (let j = 0; j < nameLen; j++) name += String.fromCharCode(bytes[pos + 46 + j]);
    out.push({
      name,
      method: view.getUint16(pos + 10, true),
      compSize: view.getUint32(pos + 20, true),
      localOffset: view.getUint32(pos + 42, true)
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipReadEntry(bytes: Uint8Array, name: string): Uint8Array | null {
  const entry = zipEntries(bytes).find((e) => e.name === name);
  if (!entry) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLen = view.getUint16(entry.localOffset + 26, true);
  const extraLen = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compSize);
  return entry.method === 8 ? new Uint8Array(inflateRawSync(data)) : data;
}

function entryNames(bytes: Uint8Array): string[] {
  return zipEntries(bytes).map((e) => e.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// 迷你 DOM：只实现 buildDocx 遍历用到的表面（tagName/children/textContent/
// getAttribute/nodeType/childNodes/querySelector）
// ─────────────────────────────────────────────────────────────────────────────
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

interface MiniEl {
  nodeType: number;
  tagName: string;
  text: string;
  children: MiniEl[];
  parent: MiniEl | null;
  attrs: Map<string, string>;
  getAttribute(name: string): string | null;
  readonly textContent: string;
  readonly childNodes: MiniEl[];
  querySelectorAll(selector: string): MiniEl[];
  querySelector(selector: string): MiniEl | null;
}

function matchSimple(node: MiniEl, simple: string): boolean {
  let rest = simple;
  const tagMatch = /^[a-z0-9*]+/i.exec(rest);
  const tag = tagMatch ? tagMatch[0].toLowerCase() : '*';
  if (tag !== '*' && node.tagName.toLowerCase() !== tag) return false;
  if (tagMatch) rest = rest.slice(tagMatch[0].length);
  while (rest.length > 0) {
    if (rest.startsWith('.')) {
      const m = /^\.([\w-]+)/.exec(rest);
      if (!m) return false;
      const classes = (node.attrs.get('class') || '').split(/\s+/);
      if (!classes.includes(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest.startsWith('[')) {
      const m = /^\[([\w-]+)(\*)?=?"?([^"\]]*)"?\]/.exec(rest);
      if (!m) return false;
      const actual = node.attrs.get(m[1]);
      if (actual === undefined) return false;
      const wanted = m[3];
      if (wanted && (m[2] ? !actual.includes(wanted) : actual !== wanted)) return false;
      rest = rest.slice(m[0].length);
    } else {
      return false;
    }
  }
  return true;
}

function matchesSelector(node: MiniEl, selector: string): boolean {
  return selector.split(',').map((s) => s.trim()).some((s) => matchSimple(node, s));
}

function collectAll(node: MiniEl, selector: string, out: MiniEl[]): void {
  for (const child of node.children) {
    if (child.nodeType === ELEMENT_NODE && matchesSelector(child, selector)) out.push(child);
    collectAll(child, selector, out);
  }
}

function makeEl(tag: string, attrs: Record<string, string> = {}, children: MiniEl[] = []): MiniEl {
  const node: MiniEl = {
    nodeType: ELEMENT_NODE,
    tagName: tag.toUpperCase(),
    text: '',
    children,
    parent: null,
    attrs: new Map(Object.entries(attrs)),
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name)! : null; },
    get textContent() {
      if (this.children.length === 0) return this.text;
      return this.children.map((c) => c.textContent).join('');
    },
    get childNodes() { return this.children; },
    querySelectorAll(selector) {
      const out: MiniEl[] = [];
      collectAll(this, selector, out);
      return out;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  };
  children.forEach((c) => { c.parent = node; });
  return node;
}

function text(content: string): MiniEl {
  return {
    nodeType: TEXT_NODE,
    tagName: '#text',
    text: content,
    children: [],
    parent: null,
    attrs: new Map(),
    getAttribute: () => null,
    get textContent() { return content; },
    get childNodes() { return []; },
    querySelectorAll: () => [],
    querySelector: () => null
  };
}

function makeImage(key: string, dataUrl: string, align: WordImage['align'] = 'center'): WordImage {
  return { key, dataUrl, widthPx: 8, heightPx: 8, align, node: null, placeholder: null, failed: false };
}

// 组装一篇覆盖标题/段落/行内样式/列表/代码/表格/图片/公式占位的扁平化文档
function buildSampleRoot(): { root: MiniEl; images: WordImage[] } {
  const root = makeEl('div', { class: 'md-preview' }, [
    makeEl('h1', {}, [text('标题一')]),
    makeEl('p', {}, [
      text('段落 '),
      makeEl('strong', {}, [text('加粗')]),
      text(' 与 '),
      makeEl('em', {}, [text('斜体')]),
      makeEl('br', {}),
      text('换行')
    ]),
    makeEl('ul', {}, [
      makeEl('li', {}, [text('列表甲')]),
      makeEl('li', { class: 'task-list-item' }, [
        makeEl('input', { type: 'checkbox', checked: '', disabled: '' }),
        text('已完成任务')
      ]),
      makeEl('li', { class: 'task-list-item' }, [
        makeEl('input', { type: 'checkbox', disabled: '' }),
        text('待办任务')
      ])
    ]),
    makeEl('ol', {}, [
      makeEl('li', {}, [text('有序一')]),
      makeEl('li', {}, [text('有序二')])
    ]),
    makeEl('pre', {}, [makeEl('code', {}, [text('const n: number = 42;')])]),
    makeEl('table', {}, [
      makeEl('tr', {}, [makeEl('td', {}, [text('A1')]), makeEl('td', {}, [text('B1')])]),
      makeEl('tr', {}, [makeEl('td', {}, [text('A2')]), makeEl('td', {}, [text('B2')])])
    ]),
    makeEl('p', {}, [makeEl('img', { src: TINY_PNG_DATA_URL, alt: '小图' })]),
    makeEl('span', { 'data-word-image': 'w0' })
  ]);
  const images = [makeImage('w0', TINY_PNG_DATA_URL, 'center')];
  return { root, images };
}

function makeInput(input: BuildDocxInput): Promise<ArrayBuffer> {
  return buildDocx(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// buildDocx：结构映射 + ZIP 产物
// ─────────────────────────────────────────────────────────────────────────────
test('buildDocx 输出合法 ZIP（PK 魔数、体积阈值、核心条目齐全）', async () => {
  const { root, images } = buildSampleRoot();
  const buffer = await makeInput({ title: 'Word 导出测试', flattenedRoot: root as unknown as Element, images });
  const bytes = new Uint8Array(buffer);

  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 3000, '含两张图片的文档应明显大于空文档');
  const names = entryNames(bytes);
  for (const required of ['[Content_Types].xml', 'word/document.xml', 'word/_rels/document.xml.rels', '_rels/.rels']) {
    assert.ok(names.includes(required), required + ' 应在包内');
  }
  const media = names.filter((n) => n.startsWith('word/media/'));
  assert.ok(media.length >= 2, '普通图片 + 公式占位图片都应进 word/media/，实际：' + media.join(','));
});

test('buildDocx document.xml 结构化断言：标题/加粗/表格/代码字体/列表/图片/任务勾选', async () => {
  const { root, images } = buildSampleRoot();
  const buffer = await makeInput({ title: 'Word 导出测试', flattenedRoot: root as unknown as Element, images });
  const xml = new TextDecoder().decode(zipReadEntry(new Uint8Array(buffer), 'word/document.xml'));

  assert.ok(!xml.includes('Word 导出测试'), '文件名只作元数据，不额外插入正文标题');
  assert.ok(xml.includes('标题一'), 'H1 标题');
  assert.ok(xml.includes('加粗') && /<w:b(?![a-z])/.test(xml), '加粗 run（<w:b…>，非 <w:br）');
  assert.ok(xml.includes('斜体') && xml.includes('<w:i/>'), '斜体 run');
  assert.ok(xml.includes('<w:br/>'), '段落内换行');
  assert.ok(xml.includes('列表甲') && xml.includes('<w:numPr>'), '无序列表编号属性');
  assert.ok(xml.includes('有序一') && xml.includes('有序二'), '有序列表内容');
  assert.ok(xml.includes('☑') && xml.includes('☐'), '任务列表勾选状态以符号保留');
  assert.ok(xml.includes('const n: number = 42;'), '代码块文本');
  assert.ok(xml.includes('Consolas'), '代码等宽字体');
  assert.ok(xml.includes('<w:tbl>') && xml.includes('A1') && xml.includes('B2'), '表格结构 + 单元格文本');
  assert.ok(xml.includes('<w:drawing>'), '图片以 drawing 进包');
  assert.ok(xml.includes('data-word-image') === false, '占位节点不应出现在 Word 内容里');
});

test('buildDocx 失败图片（dataUrl 为空）输出占位文本段落，不进 media', async () => {
  const root = makeEl('div', {}, [makeEl('span', { 'data-word-image': 'w0' })]);
  const images = [makeImage('w0', '', 'center')];
  const buffer = await makeInput({ title: 't', flattenedRoot: root as unknown as Element, images });
  const bytes = new Uint8Array(buffer);
  const xml = new TextDecoder().decode(zipReadEntry(bytes, 'word/document.xml'));

  assert.ok(xml.includes('图表渲染失败'));
  const media = entryNames(bytes).filter((n) => n.startsWith('word/media/'));
  assert.equal(media.length, 0, '失败图不产生 media 条目');
});

test('buildDocx 非图片/损坏 data URL 的 img 输出缺图占位文本', async () => {
  const root = makeEl('div', {}, [
    makeEl('p', {}, [makeEl('img', { src: 'https://example.com/x.png', alt: '外链图' })])
  ]);
  const buffer = await makeInput({ title: 't', flattenedRoot: root as unknown as Element, images: [] });
  const xml = new TextDecoder().decode(zipReadEntry(new Uint8Array(buffer), 'word/document.xml'));
  assert.ok(xml.includes('（图片未能载入）'));
});

test('buildDocx 空文档边界：仅有标题也产出合法 docx', async () => {
  const root = makeEl('div', {});
  const buffer = await makeInput({ title: '空文档', flattenedRoot: root as unknown as Element, images: [] });
  const bytes = new Uint8Array(buffer);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 1000);
  assert.ok(entryNames(bytes).includes('word/document.xml'));
});

async function documentXml(root: MiniEl): Promise<string> {
  const buffer = await buildDocx({ title: 't', flattenedRoot: root as unknown as Element, images: [] });
  return new TextDecoder().decode(zipReadEntry(new Uint8Array(buffer), 'word/document.xml'));
}

function runFor(xml: string, textValue: string): string {
  return xml.match(/<w:r[ >][\s\S]*?<\/w:r>/g)?.find((run) => run.includes('>' + textValue + '<')) || '';
}

test('Word gives tables explicit page width and code full paragraph shading', async () => {
  const xml = await documentXml(makeEl('div', {}, [
    makeEl('table', {}, [makeEl('tr', {}, [makeEl('td', {}, [text('a')]), makeEl('td', {}, [text('b')])])]),
    makeEl('pre', {style: 'background-color: rgb(240, 240, 240)'}, [makeEl('code', {}, [text('const a = 1')])])
  ]));
  assert.ok(xml.includes('w:type="pct" w:w="100%"'), 'table must span page text width: ' + xml.match(/<w:tblW[^>]+>/)?.[0]);
  assert.ok(xml.includes('<w:tblCellMar>'), 'table cells need padding');
  assert.match(xml, /<w:pPr>[^]*?<w:shd[^]*?w:fill="F0F0F0"/, 'code background covers paragraph');
});

test('Word preserves inherited preview font, size, color and block alignment', async () => {
  const xml = await documentXml(makeEl('div', { style: 'font-family: "Noto Serif SC", serif; font-size: 20px; color: rgb(17, 34, 51)' }, [
    makeEl('p', { style: 'text-align: center; margin-bottom: 12px; line-height: 30px' }, [text('styled')]),
    makeEl('h2', { style: 'font-size: 30px; font-weight: 700' }, [text('heading')])
  ]));
  const run = runFor(xml, 'styled');
  assert.match(run, /w:ascii="Noto Serif SC"/);
  assert.match(run, /w:eastAsia="Noto Serif SC"/);
  assert.match(run, /<w:sz w:val="30"/);
  assert.match(run, /<w:color w:val="112233"/);
  assert.match(xml, /<w:jc w:val="center"/);
  assert.match(xml, /w:after="180"/);
  assert.match(xml, /w:line="450"/);
  assert.match(runFor(xml, 'heading'), /<w:sz w:val="45"/);
});

test('Word preserves underline, strike, highlight, scripts and external hyperlinks', async () => {
  const root = makeEl('div', {}, [makeEl('p', {}, [
    makeEl('u', {}, [text('under')]), makeEl('del', {}, [text('deleted')]),
    makeEl('mark', {}, [text('marked')]), makeEl('sup', {}, [text('super')]),
    makeEl('sub', {}, [text('subscript')]), makeEl('a', { href: 'https://example.com/doc?q=1' }, [text('link')])
  ])]);
  const buffer = new Uint8Array(await buildDocx({title: 't', flattenedRoot: root as unknown as Element, images: []}));
  const xml = new TextDecoder().decode(zipReadEntry(buffer, 'word/document.xml'));
  assert.match(runFor(xml, 'under'), /<w:u /);
  assert.match(runFor(xml, 'deleted'), /<w:strike/);
  assert.match(runFor(xml, 'marked'), /w:fill="FFFF00"/);
  assert.match(runFor(xml, 'super'), /w:val="superscript"/);
  assert.match(runFor(xml, 'subscript'), /w:val="subscript"/);
  assert.match(xml, /<w:hyperlink /);
  assert.ok(new TextDecoder().decode(zipReadEntry(buffer, 'word/_rels/document.xml.rels')).includes('https://example.com/doc?q=1'));
});

test('Word retains mixed container text, inline images and paragraph boundaries in table cells', async () => {
  const xml = await documentXml(makeEl('div', {}, [
    makeEl('div', {}, [text('before'), makeEl('p', {}, [text('middle')]), text('after')]),
    makeEl('p', {}, [text('left'), makeEl('img', {src: TINY_PNG_DATA_URL}), text('right')]),
    makeEl('table', {}, [makeEl('tr', {}, [makeEl('th', {}, [makeEl('p', {}, [text('cell-one')]), makeEl('p', {}, [text('cell-two')])])])])
  ]));
  assert.match(xml, /before/);
  assert.match(xml, /after/);
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  assert.ok(paragraphs.some(p => p.includes('left') && p.includes('w:drawing') && p.includes('right')));
  assert.ok(paragraphs.some(p => p.includes('cell-one') && !p.includes('cell-two')));
});

test('Word preserves nested list levels and blockquote paragraph indentation', async () => {
  const xml = await documentXml(makeEl('div', {}, [
    makeEl('blockquote', {style: 'padding-left: 24px'}, [makeEl('p', {}, [text('quoted')])]),
    makeEl('ul', {}, [makeEl('li', {}, [text('parent-item'), makeEl('ul', {}, [makeEl('li', {}, [text('nested-item')])])])])
  ]));
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const quote = paragraphs.find(p => p.includes('quoted')) || '';
  assert.match(quote, /<w:ind w:left="360"/);
  const nested = paragraphs.find(p => p.includes('nested-item')) || '';
  assert.match(nested, /<w:ilvl w:val="1"/);
  assert.ok(!nested.includes('parent-item'));
});

test('buildDocx 块级公式占位段落居中（alignment CENTER）', async () => {
  const root = makeEl('div', {}, [makeEl('span', { 'data-word-image': 'w0' })]);
  const images = [makeImage('w0', TINY_PNG_DATA_URL, 'center')];
  const buffer = await makeInput({ title: 't', flattenedRoot: root as unknown as Element, images });
  const xml = new TextDecoder().decode(zipReadEntry(new Uint8Array(buffer), 'word/document.xml'));
  assert.ok(xml.includes('<w:jc w:val="center"/>'), '居中段落属性');
});
