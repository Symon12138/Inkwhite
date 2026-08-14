// M2-EXPORT-CORE：Word 中间管线（src/editor/flattenDocument.ts）的纯逻辑单测。
// 覆盖两段式的 collect 阶段（collectWordImages / flattenForWord）——纯 DOM 变换，
// node 可单测；renderWordImages 的光栅化是浏览器能力，由 tests/e2e/htmlExport.spec.ts 覆盖。
// 红测先行：本文件先写，跑一遍确认失败（模块不存在），再实现到全绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectWordImages, flattenForWord, WORD_FAILED_DIAGRAM_TEXT } from '../../src/editor/flattenDocument.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 迷你 DOM：与 exportMethods.test.ts 同构的替身（wordExport.test.ts 亦复用之）。
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
  ownerDocument: MiniDoc;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttributeNames(): string[];
  readonly textContent: string;
  readonly childNodes: MiniEl[];
  appendChild(child: MiniEl): MiniEl;
  remove(): void;
  replaceWith(...nodes: MiniEl[]): void;
  querySelectorAll(selector: string): MiniEl[];
  querySelector(selector: string): MiniEl | null;
  closest(selector: string): MiniEl | null;
  matches(selector: string): boolean;
}

interface MiniDoc {
  createElement(tag: string): MiniEl;
  createTextNode(content: string): MiniEl;
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

function makeText(content: string, doc: MiniDoc): MiniEl {
  return {
    nodeType: TEXT_NODE,
    tagName: '#text',
    text: content,
    children: [],
    parent: null,
    attrs: new Map(),
    ownerDocument: doc,
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    getAttributeNames: () => [],
    get textContent() { return content; },
    get childNodes() { return []; },
    appendChild(child) { return child; },
    remove() {},
    replaceWith() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null,
    matches: () => false
  };
}

function makeEl(tag: string, doc: MiniDoc, attrs: Record<string, string> = {}): MiniEl {
  const node: MiniEl = {
    nodeType: ELEMENT_NODE,
    tagName: tag.toUpperCase(),
    text: '',
    children: [],
    parent: null,
    attrs: new Map(Object.entries(attrs)),
    ownerDocument: doc,
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name)! : null; },
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
    removeAttribute(name) { this.attrs.delete(name); },
    getAttributeNames() { return [...this.attrs.keys()]; },
    get textContent() {
      if (this.children.length === 0) return this.text;
      return this.children.map((c) => c.textContent).join('');
    },
    get childNodes() { return this.children; },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    remove() {
      if (!this.parent) return;
      const siblings = this.parent.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parent = null;
    },
    replaceWith(...nodes) {
      if (!this.parent) return;
      const siblings = this.parent.children;
      const index = siblings.indexOf(this);
      if (index < 0) return;
      siblings.splice(index, 1, ...nodes);
      nodes.forEach((n) => { n.parent = this.parent; });
      this.parent = null;
    },
    querySelectorAll(selector) {
      const out: MiniEl[] = [];
      collectAll(this, selector, out);
      return out;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    closest(selector) {
      let current: MiniEl | null = this;
      while (current) {
        if (current.nodeType === ELEMENT_NODE && matchesSelector(current, selector)) return current;
        current = current.parent;
      }
      return null;
    },
    matches(selector) { return matchesSelector(this, selector); }
  };
  return node;
}

function makeDoc(): MiniDoc {
  const doc: MiniDoc = {
    createElement(tag: string) { return makeEl(tag, doc); },
    createTextNode(content: string) { return makeText(content, doc); }
  };
  return doc;
}

function el(tag: string, attrs: Record<string, string> = {}, children: MiniEl[] = []): MiniEl {
  const node = makeDoc().createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => node.appendChild(c));
  return node;
}

function text(content: string): MiniEl {
  return makeDoc().createTextNode(content);
}

function isDescendantOf(node: MiniEl, ancestor: MiniEl): boolean {
  let current: MiniEl | null = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// collectWordImages：KaTeX/Mermaid 标记替换（两段式 collect 阶段）
// ─────────────────────────────────────────────────────────────────────────────
test('collectWordImages 收集行内公式/块级公式/Mermaid，文档序生成稳定 key', () => {
  const root = el('div', { class: 'md-preview' }, [
    el('p', {}, [text('公式 '), el('span', { class: 'katex' }, [text('x')])]),
    el('span', { class: 'katex-display' }, [el('span', { class: 'katex' }, [text('int')])]),
    el('div', { class: 'mermaid-rendered' }, [el('svg', {})])
  ]);

  const images = collectWordImages(root);

  assert.equal(images.length, 3);
  assert.deepEqual(images.map((i) => i.key), ['w0', 'w1', 'w2']);
  // 行内公式：节点即 .katex span，行内对齐
  assert.equal(images[0].node!.getAttribute('class'), 'katex');
  assert.equal(images[0].align, 'inline');
  // 块级公式：节点取内层 .katex（收缩适配），居中对齐
  assert.equal(images[1].node!.getAttribute('class'), 'katex');
  assert.equal(images[1].align, 'center');
  // Mermaid：节点取内层 svg，左对齐
  assert.equal(images[1].node!.tagName, 'SPAN');
  assert.equal(images[2].node!.tagName, 'SVG');
  assert.equal(images[2].align, 'left');
  // 占位节点带 data-word-image，原节点已脱离文档树
  for (const image of images) {
    const ph = image.placeholder!;
    assert.equal(ph.getAttribute('data-word-image'), image.key);
    assert.notEqual(ph.parent, null, '占位节点仍在树内');
    assert.equal(isDescendantOf(image.node!, root), false, '原节点已脱离树');
  }
  // 树内不再有 .katex/.mermaid-rendered 原节点
  assert.equal(root.querySelectorAll('.katex, .mermaid-rendered').length, 0);
  assert.equal(root.querySelectorAll('[data-word-image]').length, 3);
});

test('collectWordImages 块级公式内层 .katex 不重复收集（closest 去重）', () => {
  const root = el('div', {}, [
    el('span', { class: 'katex-display' }, [el('span', { class: 'katex' }, [text('f')])])
  ]);
  const images = collectWordImages(root);
  assert.equal(images.length, 1);
  assert.equal(images[0].key, 'w0');
  assert.equal(images[0].align, 'center');
});

test('collectWordImages 空树返回空列表', () => {
  const root = el('div', {}, [el('p', {}, [text('无公式')])]);
  assert.deepEqual(collectWordImages(root), []);
});

test('collectWordImages katex-error 公式不是 .katex，不进图片收集（保留为文本）', () => {
  const root = el('div', {}, [el('p', {}, [el('span', { class: 'katex-error' }, [text('ParseError')])])]);
  assert.deepEqual(collectWordImages(root), []);
  assert.equal(root.querySelectorAll('.katex-error').length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// flattenForWord：DG4 剥离 + 代码高亮压平 + 失败图表占位 + 图片收集
// ─────────────────────────────────────────────────────────────────────────────
test('flattenForWord 剥离批注（DG4）并返回 root/images 两段式产物', () => {
  const root = el('div', { class: 'md-preview' }, [
    el('p', {}, [
      text('正文'),
      el('span', { 'data-comment-id': 'c1' }, [text('划线文字')]),
      el('span', { 'data-comment-badge': 'c1' }, [text('1')])
    ]),
    el('p', {}, [el('span', { class: 'katex' }, [text('x')])])
  ]);

  const { root: out, images } = flattenForWord(root);

  assert.equal(out, root, '原地扁平化');
  assert.equal(out.querySelectorAll('[data-comment-id], [data-comment-badge]').length, 0);
  assert.ok(out.textContent.includes('划线文字'));
  assert.equal(images.length, 1);
  assert.equal(images[0].key, 'w0');
  assert.equal(images[0].dataUrl, '', 'dataUrl 由 renderWordImages 阶段填入');
  assert.equal(images[0].widthPx, 0);
  assert.equal(images[0].failed, false);
});

test('flattenForWord 代码高亮 span（.syntax-*）压平为纯文本，保留 pre 结构', () => {
  const root = el('div', {}, [
    el('pre', {}, [
      el('code', {}, [
        el('span', { class: 'syntax-keyword' }, [text('const')]),
        text(' '),
        el('span', { class: 'syntax-number' }, [text('42')])
      ])
    ])
  ]);

  flattenForWord(root);

  const pre = root.querySelector('pre')!;
  const code = root.querySelector('code')!;
  assert.ok(pre, 'pre 结构保留');
  assert.equal(code.textContent, 'const 42');
  assert.equal(code.querySelectorAll('span[class*="syntax-"]').length, 0);
  assert.equal(code.children.filter((c) => c.nodeType === ELEMENT_NODE).length, 0);
});

test('flattenForWord 渲染失败的 Mermaid 替换为占位文本（不收集、不栅格化）', () => {
  const root = el('div', {}, [
    el('div', { class: 'mermaid-rendered has-error' }, [text('Mermaid 渲染失败：Parse error')]),
    el('div', { class: 'mermaid-rendered' }, [el('svg', {})])
  ]);

  const { images } = flattenForWord(root);

  assert.ok(root.textContent.includes(WORD_FAILED_DIAGRAM_TEXT));
  assert.equal(root.querySelectorAll('.mermaid-rendered.has-error').length, 0);
  assert.equal(images.length, 1, '只有好图进图片列表');
  assert.equal(images[0].node!.tagName, 'SVG');
});

test('flattenForWord 表格/标题/列表结构原样保留', () => {
  const root = el('div', {}, [
    el('h1', {}, [text('标题')]),
    el('table', {}, [el('tr', {}, [el('td', {}, [text('A')])])]),
    el('ul', {}, [el('li', {}, [text('项')])])
  ]);
  flattenForWord(root);
  assert.ok(root.querySelector('h1'));
  assert.ok(root.querySelector('table'));
  assert.ok(root.querySelector('ul'), '列表容器保留');
  assert.equal(root.querySelector('ul')!.children.filter((c) => c.tagName === 'LI').length, 1);
  assert.equal(root.querySelector('h1')!.textContent, '标题');
});
