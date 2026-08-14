// M1-3：脚注扩展（[^id] 引用 + [^id]: 定义 + 文末脚注区）单元测试。
// 被测模块：src/editor/markdownExtensions/footnoteExtension.ts。
//
// 语义（计划 B03，M1-1 契约见 markdownExtensionRegistry.ts 头部注释）：
//   - block 扩展拦截 `[^id]: body` 定义行（优先于内置 def，实证见
//     markdownExtensionsSpike.test.ts / markdownBaseline.test.ts）；
//   - inline 扩展拦截 `[^id]` 引用（优先于 reflink），但 `[^id](` 链接与
//     `[^id][` 引用式链接不匹配（保持基线行为）；
//   - transformTokens 遍历整棵 token 树（list/blockquote/table 嵌套）收集
//     ref 与 def：首个定义胜出；只有被引用的定义进脚注区；重复引用共用
//     条目但独立回链（id = fnref-<id>-<序号>）；未定义引用替换为字面文本
//     token `[^id]`；tokens 末尾按 footnoteOrder（首次引用序）注入
//     footnoteSection；
//   - 定义体按 Markdown 渲染（多行/列表/代码可用），状态全部挂 ctx，
//     连续两次渲染输出逐字节一致。
//
// 隔离约定：每个测试 `new Marked(RENDER_MARKDOWN_OPTIONS)` 并
// resetMarkdownExtensionRegistry / setMarkedTarget（参考
// markdownExtensionRegistry.test.ts 的 isolated 模式）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import {
  RENDER_MARKDOWN_OPTIONS,
  registerMarkdownExtensions,
  renderMarkdown,
  resetMarkdownExtensionRegistry,
  setMarkedTarget,
  type MarkedTarget
} from '../../src/editor/markdownExtensions/markdownExtensionRegistry.ts';
import { footnoteExtension } from '../../src/editor/markdownExtensions/footnoteExtension.ts';

/** 真实 marked + 脚注扩展的单管线渲染（与 _renderPreview 共用 renderMarkdown）。 */
function render(src: string): string {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(footnoteExtension);
  return renderMarkdown(src).html;
}

/** 渲染并返回 tokens（供结构断言）。 */
function renderTokens(src: string): ReturnType<typeof renderMarkdown> {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(footnoteExtension);
  return renderMarkdown(src);
}

/** 引用上标（ordinal = 该 id 第几次出现）。 */
const SUP = (id: string, ordinal: number): string =>
  `<sup class="footnote-ref"><a href="#fn-${id}" id="fnref-${id}-${ordinal}">${id}</a></sup>`;

/** 回链锚点。 */
const BACKREF = (id: string, n: number): string =>
  `<a class="footnote-backref" href="#fnref-${id}-${n}">\u21A9</a>`;

/** 脚注区（entries 按 footnoteOrder）。 */
function SECTION(entries: Array<{ id: string; bodyHtml: string; refs: number }>): string {
  const items = entries.map((e) => {
    const backrefs = Array.from({ length: e.refs }, (_, i) => BACKREF(e.id, i + 1)).join(' ');
    return `<li id="fn-${e.id}">${e.bodyHtml}${backrefs}</li>`;
  });
  return `<section class="footnotes">\n<ol>\n${items.join('\n')}\n</ol>\n</section>\n`;
}

// ===== 基本引用 + 文末脚注区 =====

test('基本：正文 [^1] → <sup class="footnote-ref">，文末注入 .footnotes 脚注区', () => {
  const src = '正文[^1]。\n\n[^1]: 注释';
  assert.equal(
    render(src),
    `<p>正文${SUP('1', 1)}。</p>\n` +
      SECTION([{ id: '1', bodyHtml: '<p>注释</p>\n', refs: 1 }])
  );
});

test('脚注区在文末：正文之后的段落仍排在脚注区前面', () => {
  const src = '正文[^1]。\n\n[^1]: 注释\n\n末尾段落';
  assert.equal(
    render(src),
    `<p>正文${SUP('1', 1)}。</p>\n` +
      `<p>末尾段落</p>\n` +
      SECTION([{ id: '1', bodyHtml: '<p>注释</p>\n', refs: 1 }])
  );
});

// ===== 首个定义胜出 =====

test('首个定义胜出：重复定义取文档中第一个', () => {
  const src = '[^d]: 第一个\n\n[^d]: 第二个\n\n正文[^d]';
  const html = render(src);
  assert.equal(
    html,
    `<p>正文${SUP('d', 1)}</p>\n` +
      SECTION([{ id: 'd', bodyHtml: '<p>第一个</p>\n', refs: 1 }])
  );
  assert.ok(!html.includes('第二个'), '第二个定义不得进入脚注区');
});

// ===== 重复引用：共用条目 + 独立回链 =====

test('重复引用：共用一条目，每个引用独立回链 fnref-<id>-<序号>', () => {
  const src = '前[^1]中[^1]后[^1]\n\n[^1]: 同一注释';
  assert.equal(
    render(src),
    `<p>前${SUP('1', 1)}中${SUP('1', 2)}后${SUP('1', 3)}</p>\n` +
      SECTION([{ id: '1', bodyHtml: '<p>同一注释</p>\n', refs: 3 }])
  );
  // 回链锚点 id 与 sup 锚点一一对应
  const html = render(src);
  assert.ok(html.includes('id="fnref-1-1"'));
  assert.ok(html.includes('id="fnref-1-2"'));
  assert.ok(html.includes('id="fnref-1-3"'));
  assert.equal(html.match(/class="footnote-backref"/g)?.length, 3, '三条回链');
});

// ===== 未定义引用 =====

test('未定义引用替换为字面文本 [^id]（与无扩展基线一致）', () => {
  assert.equal(render('x[^1] y'), '<p>x[^1] y</p>\n');
  // 混合：未定义的字面、已定义的正常渲染
  const src = 'a[^x] b\n\n[^y]: 有定义\n\nc[^y]';
  assert.equal(
    render(src),
    `<p>a[^x] b</p>\n<p>c${SUP('y', 1)}</p>\n` +
      SECTION([{ id: 'y', bodyHtml: '<p>有定义</p>\n', refs: 1 }])
  );
});

// ===== [^id](url) 链接 与 [^id][ 引用式链接 不匹配 =====

test('[^1](url) 仍为普通链接（链接文本 ^1），不触发脚注', () => {
  assert.equal(render('见[^1](https://example.com)'), '<p>见<a href="https://example.com">^1</a></p>\n');
});

test('[^1][x] 引用式链接不匹配（未定义时保持字面）', () => {
  assert.equal(render('见[^1][x]'), '<p>见[^1][x]</p>\n');
  assert.equal(render('见[^1][]'), '<p>见[^1][]</p>\n');
});

// ===== 代码围栏内不触发（负例） =====

test('代码围栏内的 [^id]: 定义与 [^id] 引用均不触发', () => {
  const src = '```\n[^1]: 围栏内\n[^1]\n```\n\n正文[^1]\n\n[^1]: 真定义';
  assert.equal(
    render(src),
    `<pre><code>[^1]: 围栏内\n[^1]\n</code></pre>\n` +
      `<p>正文${SUP('1', 1)}</p>\n` +
      SECTION([{ id: '1', bodyHtml: '<p>真定义</p>\n', refs: 1 }])
  );
});

test('4 空格缩进代码块内的 [^id]: 定义不触发', () => {
  const src = '    [^k]: x\n\n正文[^k]';
  assert.equal(render(src), `<pre><code>[^k]: x\n</code></pre>\n<p>正文[^k]</p>\n`);
});

// ===== 多行定义 =====

test('多行定义：缩进续行并入定义体（breaks 下单换行 → <br>）', () => {
  const src = '[^m]: 第一行\n    第二行\n\n正文[^m]';
  assert.equal(
    render(src),
    `<p>正文${SUP('m', 1)}</p>\n` +
      SECTION([{ id: 'm', bodyHtml: '<p>第一行<br>第二行</p>\n', refs: 1 }])
  );
});

test('定义体含空行 + 缩进段：两段式定义体', () => {
  const src = '[^p]: 第一段\n\n    第二段\n\n正文[^p]';
  assert.equal(
    render(src),
    `<p>正文${SUP('p', 1)}</p>\n` +
      SECTION([{ id: 'p', bodyHtml: '<p>第一段</p>\n<p>第二段</p>\n', refs: 1 }])
  );
});

// ===== 定义体内的列表与代码 =====

test('定义体支持列表与代码块（按 Markdown 渲染）', () => {
  const src = '[^l]: 列表\n    - a\n    - b\n\n[^c]: 代码\n    ```\n    x=1\n    ```\n\n正文[^l] 与 [^c]';
  assert.equal(
    render(src),
    `<p>正文${SUP('l', 1)} 与 ${SUP('c', 1)}</p>\n` +
      SECTION([
        { id: 'l', bodyHtml: '<p>列表</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n', refs: 1 },
        { id: 'c', bodyHtml: '<p>代码</p>\n<pre><code>x=1\n</code></pre>\n', refs: 1 }
      ])
  );
});

// ===== 列表 / 引用 / 表格内嵌套 =====

test('列表项与引用内：定义与引用均可收集（嵌套遍历）', () => {
  const src = '- 项[^a]\n  [^a]: 列表内定义\n\n> 引用[^q]\n>\n> [^q]: 引内定义';
  assert.equal(
    render(src),
    `<ul>\n<li>项${SUP('a', 1)}</li>\n</ul>\n` +
      `<blockquote>\n<p>引用${SUP('q', 1)}</p>\n</blockquote>\n` +
      SECTION([
        { id: 'a', bodyHtml: '<p>列表内定义</p>\n', refs: 1 },
        { id: 'q', bodyHtml: '<p>引内定义</p>\n', refs: 1 }
      ])
  );
});

test('表格单元格内引用可用', () => {
  const src = '| a[^t] | b |\n| --- | --- |\n| 1 | 2 |\n\n[^t]: 表格脚注';
  assert.equal(
    render(src),
    `<table>\n<thead>\n<tr>\n<th>a${SUP('t', 1)}</th>\n<th>b</th>\n</tr>\n</thead>\n` +
      `<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>\n` +
      SECTION([{ id: 't', bodyHtml: '<p>表格脚注</p>\n', refs: 1 }])
  );
});

// ===== 收集顺序 =====

test('引用先于定义出现也能解析（两阶段收集）', () => {
  const src = '先用[^z]\n\n[^z]: 后定义';
  assert.equal(
    render(src),
    `<p>先用${SUP('z', 1)}</p>\n` +
      SECTION([{ id: 'z', bodyHtml: '<p>后定义</p>\n', refs: 1 }])
  );
});

test('脚注区按首次引用顺序（footnoteOrder），与定义书写顺序无关', () => {
  const src = '乙[^b] 甲[^a]\n\n[^a]: 甲注\n[^b]: 乙注';
  assert.equal(
    render(src),
    `<p>乙${SUP('b', 1)} 甲${SUP('a', 1)}</p>\n` +
      SECTION([
        { id: 'b', bodyHtml: '<p>乙注</p>\n', refs: 1 },
        { id: 'a', bodyHtml: '<p>甲注</p>\n', refs: 1 }
      ])
  );
});

test('未被引用的定义不进脚注区（且不产生输出）', () => {
  const src = '[^u]: 未引用\n\n正文[^1]\n\n[^1]: 已引用';
  const html = render(src);
  assert.equal(
    html,
    `<p>正文${SUP('1', 1)}</p>\n` +
      SECTION([{ id: '1', bodyHtml: '<p>已引用</p>\n', refs: 1 }])
  );
  assert.ok(!html.includes('未引用'), '未引用定义不得出现在输出中');
});

// ===== 转义与代码串负例 =====

test('\\[^1] 转义后保持字面（escape token 后拒绝），已定义也不触发', () => {
  const src = '\\[^1] 与 [^1]\n\n[^1]: 真注';
  assert.equal(
    render(src),
    `<p>[^1] 与 ${SUP('1', 1)}</p>\n` +
      SECTION([{ id: '1', bodyHtml: '<p>真注</p>\n', refs: 1 }])
  );
});

test('未闭合反引号串内的 [^1] 不触发（codeRunBefore 拦截，保持字面）', () => {
  assert.equal(render('a`code [^1] b'), '<p>a`code [^1] b</p>\n');
  // 已闭合代码 span 内的 [^1] 是代码原文；span 之后的引用正常
  const src = 'a`[^1]` b 与 [^2]\n\n[^2]: 正常';
  assert.equal(
    render(src),
    `<p>a<code>[^1]</code> b 与 ${SUP('2', 1)}</p>\n` +
      SECTION([{ id: '2', bodyHtml: '<p>正常</p>\n', refs: 1 }])
  );
});

test('空 body 定义不匹配：[^e]: 保持字面', () => {
  assert.equal(render('[^e]:\n\n正文[^e]'), '<p>[^e]:</p>\n<p>正文[^e]</p>\n');
});

// ===== 无脚注输入：与基线一致 =====

test('无脚注输入不注入 section（输出与无扩展基线一致）', () => {
  assert.equal(render('# 标题\n\n正文 **粗体**。'), '<h1>标题</h1>\n<p>正文 <strong>粗体</strong>。</p>\n');
});

// ===== tokens 结构 =====

test('tokens：footnoteDef 被剥离、footnoteSection 注入末尾', () => {
  const { tokens } = renderTokens('正文[^1]\n\n[^1]: 注释\n\n[^1]: 重复定义');
  const types = tokens.map((t) => t.type);
  assert.deepEqual(types, ['paragraph', 'space', 'footnoteSection'], '定义 token 不得残留，section 在末尾');
  const section = tokens[tokens.length - 1] as unknown as {
    type: string;
    entries: Array<{ id: string; body: string; refs: number }>;
  };
  assert.equal(section.type, 'footnoteSection');
  assert.deepEqual(
    section.entries.map((e) => [e.id, e.body, e.refs]),
    [['1', '注释', 1]]
  );
});

// ===== 状态隔离 =====

test('状态隔离：连续两次渲染输出逐字节一致（无模块级可变状态）', () => {
  const src = '前[^1]与[^a]。\n\n[^a]: 甲注\n[^1]: 一注\n\n- [^1] 再次';
  const a = render(src);
  const b = render(src);
  assert.equal(a, b);
  assert.equal(
    a,
    `<p>前${SUP('1', 1)}与${SUP('a', 1)}。</p>\n` +
      `<ul>\n<li>${SUP('1', 2)} 再次</li>\n</ul>\n` +
      SECTION([
        { id: '1', bodyHtml: '<p>一注</p>\n', refs: 2 },
        { id: 'a', bodyHtml: '<p>甲注</p>\n', refs: 1 }
      ])
  );
});
