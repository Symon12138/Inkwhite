// M2-EXPORT-CORE：HTML 导出管线（src/editor/exportMethods.ts）与共享工具
// （src/editor/shareExportUtils.ts）的纯逻辑单测。node 无 DOM：用迷你 DOM 替身
// + 注入式 fetch 覆盖剥离/检查/组装逻辑；浏览器全链路由 tests/e2e/htmlExport.spec.ts 覆盖。
// 红测先行：本文件先写，跑一遍确认失败（模块不存在），再实现到全绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freezeCssVariables,
  resolveCssVariables,
  estimateDataUrlBytes,
  fontFallbackCss,
  pruneFontFaceSrcs,
  buildFailureAppendix,
  assertSafeSvg,
  sanitizeExportSvgs,
  FONT_INLINE_LIMIT_BYTES
} from '../../src/editor/exportMethods.ts';
import {
  stripCommentMarks,
  inlineFontFaces,
  inlineImages,
  replaceFailedDiagrams,
  FAILED_DIAGRAM_TEXT,
  REMOVED_SVG_TEXT
} from '../../src/editor/shareExportUtils.ts';

// ─────────────────────────────────────────────────────────────────────────────
// 迷你 DOM：只实现被测模块实际用到的表面（nodeType/tagName/attrs/children/
// querySelectorAll/closest/replaceWith/remove/textContent/ownerDocument）。
// 真实 DOM 在浏览器端由 E2E 覆盖；这里的替身保证 node 单测可断言。
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

// 选择器匹配：只支持被测模块用到的形态——tag / .class / [attr] / [attr="v"] /
// [class*="syntax-"] / 逗号列表（无后代组合器）。
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
  const node: MiniEl = {
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
  return node;
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
      let node: MiniEl | null = this;
      while (node) {
        if (node.nodeType === ELEMENT_NODE && matchesSelector(node, selector)) return node;
        node = node.parent;
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

function assertNoCommentMarks(node: MiniEl): void {
  assert.equal(node.querySelectorAll('[data-comment-id]').length, 0);
  assert.equal(node.querySelectorAll('[data-comment-badge]').length, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// DG4：批注剥离（shareExportUtils.stripCommentMarks）
// ─────────────────────────────────────────────────────────────────────────────
test('DG4 剥离批注标记：badge 移除、id span 拆开保留原文', () => {
  const root = el('div', {}, [
    el('p', {}, [
      text('正文开头'),
      el('span', { 'data-comment-id': 'c1' }, [text('被批注的文字')]),
      text('继续'),
      el('span', { 'data-comment-badge': 'c1' }, [text('1')])
    ])
  ]);

  stripCommentMarks(root);

  assertNoCommentMarks(root);
  const p = root.querySelector('p')!;
  // 原文完整：包裹 span 拆开，badge 整棵移除
  assert.equal(p.textContent, '正文开头被批注的文字继续');
  assert.equal(p.children.filter((c) => c.nodeType === ELEMENT_NODE).length, 0);
});

test('DG4 无批注时剥离是空操作', () => {
  const root = el('div', {}, [el('p', {}, [text('干净正文')])]);
  stripCommentMarks(root);
  assert.equal(root.querySelector('p')!.textContent, '干净正文');
});

// ─────────────────────────────────────────────────────────────────────────────
// DG5：图片内联（shareExportUtils.inlineImages）
// ─────────────────────────────────────────────────────────────────────────────
const DATA_URL_PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('DG5 远程图内联成功时替换为 data URL，并移除 srcset/loading', async () => {
  const root = el('div', {}, [
    el('img', { src: 'https://example.com/a.png', srcset: 'a.png 2x', loading: 'lazy' })
  ]);
  const result = await inlineImages(root, {
    fetchUrl: async () => DATA_URL_PNG
  });

  assert.deepEqual(result.failed, []);
  const img = root.querySelector('img')!;
  assert.equal(img.getAttribute('src'), DATA_URL_PNG);
  assert.equal(img.getAttribute('srcset'), null);
  assert.equal(img.getAttribute('loading'), null);
});

test('DG5 远程图内联失败：保留原 URL + 返回失败列表（不替换、不删除）', async () => {
  const root = el('div', {}, [el('img', { src: 'https://example.com/broken.png' })]);
  const result = await inlineImages(root, { fetchUrl: async () => '' });

  assert.deepEqual(result.failed, ['https://example.com/broken.png']);
  const img = root.querySelector('img')!;
  assert.equal(img.getAttribute('src'), 'https://example.com/broken.png');
});

test('DG5 失败回调可用于占位替换（长图海报语义），默认行为保留 URL', async () => {
  const root = el('div', {}, [el('img', { src: 'https://example.com/x.png', alt: '缺图' })]);
  const calls: Array<[MiniEl, string]> = [];
  await inlineImages(root, {
    fetchUrl: async () => '',
    onFailed: (img, src) => { calls.push([img as unknown as MiniEl, src]); }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'https://example.com/x.png');
  assert.equal(calls[0][0].getAttribute('alt'), '缺图');
});

test('DG5 已是 data URL 的图不动、不发起 fetch', async () => {
  let fetches = 0;
  const root = el('div', {}, [el('img', { src: DATA_URL_PNG })]);
  await inlineImages(root, { fetchUrl: async () => { fetches += 1; return ''; } });
  assert.equal(fetches, 0);
  assert.equal(root.querySelector('img')!.getAttribute('src'), DATA_URL_PNG);
});

test('DG5 相对路径图：不尝试 fetch（导出物无基准 URL 必然死链），走失败路径', async () => {
  let fetches = 0;
  const root = el('div', {}, [el('img', { src: 'images/pic.png' })]);
  const result = await inlineImages(root, { fetchUrl: async () => { fetches += 1; return ''; } });

  assert.equal(fetches, 0);
  assert.deepEqual(result.failed, ['images/pic.png']);
  assert.equal(root.querySelector('img')!.getAttribute('src'), 'images/pic.png');
});

test('DG5 localImages 映射命中时直接采用 data URL（桌面端水合结果）', async () => {
  const root = el('div', {}, [el('img', { src: 'images/local.png' })]);
  const result = await inlineImages(root, { localImages: { 'images/local.png': DATA_URL_PNG } });
  assert.deepEqual(result.failed, []);
  assert.equal(root.querySelector('img')!.getAttribute('src'), DATA_URL_PNG);
});

// ─────────────────────────────────────────────────────────────────────────────
// DG7：字体内联（shareExportUtils.inlineFontFaces）与阈值降级
// ─────────────────────────────────────────────────────────────────────────────
function createSheet(rules: unknown[]) {
  return { get cssRules() { return rules; } } as unknown as CSSStyleSheet;
}

function createFaceRule(cssText: string) {
  return { cssText, style: { cssText: '' }, selectorText: '' };
}

function createPlainRule(selectorText: string) {
  return { cssText: selectorText + '{color:red}', style: { cssText: 'color:red' }, selectorText };
}

test('inlineFontFaces 收集 @font-face 并把首个 url() 内联为 data URL', async () => {
  const sheets = [
    createSheet([
      createFaceRule('@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:400;src:url(/fonts/KaTeX_Main-Regular.woff2) format("woff2"),url(/fonts/KaTeX_Main-Regular.woff) format("woff")}'),
      createPlainRule('.md-preview')
    ])
  ];
  const css = await inlineFontFaces(sheets, { fetchUrl: async () => 'data:font/woff2;base64,AAAA' });

  assert.ok(css.includes('url(data:font/woff2;base64,AAAA)'), '首个 url 被替换');
  assert.ok(css.includes('KaTeX_Main'));
  assert.ok(!css.includes('selectorText') && !css.includes('.md-preview'), '普通规则不进入字体 CSS');
});

test('inlineFontFaces 字体取回失败：整条 face 丢弃（回退链兜底）', async () => {
  const sheets = [
    createSheet([
      createFaceRule('@font-face{font-family:KaTeX_Main;src:url(/fonts/a.woff2) format("woff2")}')
    ])
  ];
  const css = await inlineFontFaces(sheets, { fetchUrl: async () => '' });
  assert.equal(css, '');
});

test('inlineFontFaces 无 url() 的 face 原样保留；跨源 sheet 抛错跳过', async () => {
  const sheets = [
    { get cssRules(): unknown[] { throw new Error('SecurityError'); } },
    createSheet([createFaceRule('@font-face{font-family:Local;src:local("X")}')])
  ] as unknown as ArrayLike<CSSStyleSheet>;
  const css = await inlineFontFaces(sheets, { fetchUrl: async () => 'data:font/woff2;base64,AAAA' });
  assert.equal(css, '@font-face{font-family:Local;src:local("X")}');
});

test('inlineFontFaces filter 选项只内联命中面（导出侧限定 KaTeX 字体，DG7 范围）', async () => {
  const sheets = [
    createSheet([
      createFaceRule('@font-face{font-family:\'Canger JinKai 04\';src:url(/fonts/canger.woff2) format("woff2")}'),
      createFaceRule('@font-face{font-family:KaTeX_Main;src:url(/fonts/katex.woff2) format("woff2")}')
    ])
  ];
  const css = await inlineFontFaces(sheets, {
    fetchUrl: async () => 'data:font/woff2;base64,AAAA',
    filter: (face) => /font-family:\s*['"]?KaTeX_/i.test(face)
  });
  assert.ok(css.includes('KaTeX_Main'));
  assert.ok(!css.includes('Canger JinKai 04'), '非命中 face 不内联');
});

test('DG7 阈值常量：1MB，与决策记录一致', () => {
  assert.equal(FONT_INLINE_LIMIT_BYTES, 1024 * 1024);
});

test('estimateDataUrlBytes 按 base64 载荷折算原始字节', () => {
  // 4 个 base64 字符 ≈ 3 字节
  assert.equal(estimateDataUrlBytes('url(data:font/woff2;base64,AAAA)'), 3);
  assert.equal(estimateDataUrlBytes('a(data:font/woff2;base64,AAAA)b(data:font/woff2;base64,AAA=)'), 6);
  assert.equal(estimateDataUrlBytes('no data urls'), 0);
});

test('pruneFontFaceSrcs 只保留内联成功的 data: src（自包含导出无死链）', () => {
  const css = '@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:400;'
    + 'src:url(data:font/woff2;base64,AAAA) format("woff2"),url(fonts/KaTeX_Main-Regular.woff) format("woff"),url(fonts/KaTeX_Main-Regular.ttf) format("truetype");}';
  const out = pruneFontFaceSrcs(css);

  assert.ok(out.includes('src:url(data:font/woff2;base64,AAAA) format("woff2")'));
  assert.ok(!out.includes('KaTeX_Main-Regular.woff'));
  assert.ok(!out.includes('KaTeX_Main-Regular.ttf'));
});

test('pruneFontFaceSrcs 处理逗号后带空格的 url 段（浏览器样式表的真实形态）', () => {
  const css = '@font-face{font-family:KaTeX_AMS;src:url(data:font/woff2;base64,QUJD) format("woff2"), '
    + 'url("/node_modules/katex/dist/fonts/KaTeX_AMS-Regular.woff") format("woff"), '
    + 'url("/node_modules/katex/dist/fonts/KaTeX_AMS-Regular.ttf") format("truetype");}';
  const out = pruneFontFaceSrcs(css);

  assert.ok(out.includes('url(data:font/woff2;base64,QUJD) format("woff2")'));
  assert.ok(!out.includes('/node_modules/katex/'), '应剪掉内联后的相对路径死链');
});

test('pruneFontFaceSrcs 无 data: src 的 face 原样保留；无 face 时原样返回', () => {
  const plain = '@font-face{font-family:X;src:url(fonts/x.woff2) format("woff2")}';
  assert.equal(pruneFontFaceSrcs(plain), plain);
  assert.equal(pruneFontFaceSrcs('.md-preview{color:red}'), '.md-preview{color:red}');
});

test('fontFallbackCss 从 face 提取字体族并声明系统降级栈（Path B）', () => {
  const css = '@font-face{font-family:KaTeX_Main;src:url(a.woff2)}'
    + '@font-face{font-family:KaTeX_AMS;src:url(b.woff2)}';
  const out = fontFallbackCss(css);

  assert.ok(out.includes('KaTeX_Main'));
  assert.ok(out.includes('KaTeX_AMS'));
  assert.ok(out.includes('"Times New Roman", serif'));
  assert.ok(out.includes('!important'), '降级栈需压过 cssBundle 中的 .katex 字体声明');
});

test('fontFallbackCss 无字体族时返回空串', () => {
  assert.equal(fontFallbackCss(''), '');
  assert.equal(fontFallbackCss('.md-preview{color:red}'), '');
});

// ─────────────────────────────────────────────────────────────────────────────
// 冻结 CSS 变量与解析
// ─────────────────────────────────────────────────────────────────────────────
test('freezeCssVariables 收集样式表变量并以 getComputedStyle 值落定为字面块', () => {
  const sheets = [
    createSheet([
      { selectorText: ':root', style: { length: 2, item: (i: number) => ['--fs-xl', '--paper-bg'][i] } }
    ])
  ] as unknown as ArrayLike<CSSStyleSheet>;
  const read = (name: string) => ({ '--fs-xl': '17px', '--paper-bg': '#f4ebd9' })[name] ?? '';
  const block = freezeCssVariables(sheets, read);

  assert.equal(block, '.md-preview{--fs-xl:17px;--paper-bg:#f4ebd9;}');
});

test('freezeCssVariables 无变量时输出空串', () => {
  const block = freezeCssVariables([], () => '');
  assert.equal(block, '');
});

test('resolveCssVariables 把 var() 引用替换为字面值（含 fallback）', () => {
  const read = (name: string) => ({ '--fs-xl': '17px' })[name] ?? '';
  const out = resolveCssVariables(
    '.md-preview{font-size:var(--fs-xl)}.md-preview h1{font-size:var(--missing, 1.5em)}',
    read
  );
  assert.equal(out, '.md-preview{font-size:17px}.md-preview h1{font-size:1.5em}');
});

test('resolveCssVariables 未知变量且无 fallback 时保留原引用（不臆造值）', () => {
  const out = resolveCssVariables('.md-preview{color:var(--ghost)}', () => '');
  assert.equal(out, '.md-preview{color:var(--ghost)}');
});

test('resolveCssVariables 嵌套 fallback 经多轮替换收敛', () => {
  const out = resolveCssVariables('.a{color:var(--x, var(--y, red))}', (name) => ({ '--x': '' })[name] ?? '');
  assert.equal(out, '.a{color:red}');
});

// ─────────────────────────────────────────────────────────────────────────────
// DG9：Mermaid 失败占位 + 附录
// ─────────────────────────────────────────────────────────────────────────────
test('DG9 replaceFailedDiagrams：has-error 节点替换为占位文本并返回错误原文', () => {
  const root = el('div', {}, [
    el('div', { class: 'mermaid-rendered has-error' }, [text('Mermaid 渲染失败：Parse error')]),
    el('div', { class: 'mermaid-rendered' }, [el('svg', {})])
  ]);
  const texts = replaceFailedDiagrams(root);

  assert.deepEqual(texts, ['Mermaid 渲染失败：Parse error']);
  const nodes = root.querySelectorAll('.mermaid-rendered');
  assert.equal(nodes.length, 1, '好图保留');
  assert.equal(nodes[0].getAttribute('class'), 'mermaid-rendered');
  // 错误节点被文本节点替换：正文里出现占位文本，不再是 .has-error 节点
  assert.ok(root.textContent.includes(FAILED_DIAGRAM_TEXT));
  assert.ok(!root.textContent.includes('Mermaid 渲染失败'));
});

test('DG9 is-loading 卡死态同样兜底替换', () => {
  const root = el('div', {}, [el('div', { class: 'mermaid-rendered is-loading' }, [text('正在渲染流程图…')])]);
  replaceFailedDiagrams(root);
  assert.ok(root.textContent.includes(FAILED_DIAGRAM_TEXT));
  assert.equal(root.querySelectorAll('.mermaid-rendered.is-loading').length, 0);
});

test('buildFailureAppendix 生成转义安全的附录 HTML（原文进 pre）', () => {
  const html = buildFailureAppendix(['Mermaid 渲染失败：Parse error <script>', 'a & b']);
  assert.ok(html.includes('<h2>附录：渲染失败的图表</h2>'));
  assert.ok(html.includes('<pre>Mermaid 渲染失败：Parse error &lt;script&gt;</pre>'));
  assert.ok(html.includes('<pre>a &amp; b</pre>'));
  assert.ok(!/<script>/.test(html));
});

// ─────────────────────────────────────────────────────────────────────────────
// DG6：SVG 兜底检查
// ─────────────────────────────────────────────────────────────────────────────
test('DG6 assertSafeSvg：含 script / 事件属性 / foreignObject 判定不安全', () => {
  const doc = makeDoc();
  const withScript = el('svg', {}, [el('script', {}, [text('alert(1)')])]);
  const withOnload = el('svg', { onload: 'x()' }, [text('x')]);
  const withForeignObject = el('svg', {}, [el('foreignObject', {}, [el('div', {}, [text('hi')])])]);
  const clean = el('svg', { width: '100', height: '50' }, [el('path', { d: 'M0 0' })]);

  assert.equal(assertSafeSvg(withScript), false);
  assert.equal(assertSafeSvg(withOnload), false);
  assert.equal(assertSafeSvg(withForeignObject), false);
  assert.equal(assertSafeSvg(clean), true);
  assert.equal(assertSafeSvg(el('div', {}, [el('svg', {}, [])])), true);
});

test('DG6 sanitizeExportSvgs：不安全 SVG 替换为占位文本；.mermaid-rendered 内 SVG 放行', () => {
  const root = el('div', {}, [
    el('svg', { width: '10' }, [el('script', {}, [text('x')])]),
    el('div', { class: 'mermaid-rendered' }, [el('svg', {}, [el('foreignObject', {}, [text('label')])])])
  ]);

  sanitizeExportSvgs(root);

  const svgs = root.querySelectorAll('svg');
  assert.equal(svgs.length, 1, '只有 mermaid 的 svg 保留');
  assert.ok(svgs[0].closest('.mermaid-rendered'));
  assert.ok(root.textContent.includes(REMOVED_SVG_TEXT));
});
