// S0.1 收尾：Markdown 单管线（lexer → parser）可行性刻画测试。
//
// 目的：验证在编辑器同一配置（gfm: true, breaks: true，见
// src/editor/MarkdownEditorLogic.ts 里 window.marked.setOptions 的调用）下，
// marked.parser(marked.lexer(src), 同选项) 与 marked.parse(src) 逐字节一致。
// M1 将把 _renderPreview 改为 lexer → token 变换 → parser 的单管线，并缓存
// _lastTokens（本文档最后一个测试刻画 tokens 复用稳定性）；本文件为改道提供
// 「输出等价」的回归锚点：只要本文件全绿，M1 改道不改变任何已刻画输入的渲染。
//
// 隔离约定：每个测试用独立 new Marked() 实例，绝不使用全局 marked.use，
// 避免污染其他测试文件（同 markdownExtensionsSpike.test.ts 的 isolated 模式）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';

const EDITOR_OPTIONS = { gfm: true, breaks: true };

// 同一实例、同选项：parser(lexer(src), opts) 必须与 parse(src) 逐字节一致。
// sanity 用于防「输入根本没命中目标语法构造」的空转断言。
function assertSinglePipeline(src: string, sanity: RegExp, label: string) {
  const m = new Marked(EDITOR_OPTIONS);
  const pipeline = m.parser(m.lexer(src), { gfm: true, breaks: true });
  const direct = m.parse(src);
  assert.equal(pipeline, direct, label + '：单管线输出必须与 parse(src) 逐字节一致');
  assert.match(pipeline, sanity, label + '：输入应确实命中预期的语法构造（防空转）');
}

test('标题 + 段落（含 breaks 单换行 → <br>）', () => {
  assertSinglePipeline(
    '# 标题\n\n第一段 **粗体** 与 *斜体*。\n\n第一行\n第二行',
    /<h1>标题<\/h1>[\s\S]*<strong>粗体<\/strong>[\s\S]*<br>/,
    'headings+paragraph'
  );
});

test('表格（含 \\| 转义管道）', () => {
  assertSinglePipeline(
    '| a \\| b | c |\n| --- | --- |\n| 1 | 2 |',
    /<table>[\s\S]*<th>a \| b<\/th>/,
    'table-escaped-pipe'
  );
});

test('任务列表（GFM checkbox）', () => {
  assertSinglePipeline(
    '- [x] 完成\n- [ ] 待办',
    /<input checked=""[\s\S]*type="checkbox"/,
    'task-list'
  );
});

test('代码围栏（含 mermaid 标记块与 js 块）', () => {
  assertSinglePipeline(
    '```mermaid\nflowchart TD\n  A-->B\n```\n\n```js\nconst x = 1;\n```',
    /<pre><code class="language-mermaid">[\s\S]*<pre><code class="language-js">/,
    'fence-mermaid'
  );
});

test('嵌套列表（ul 套 ul/ol）', () => {
  assertSinglePipeline(
    '- a\n  - a1\n    - a1i\n- b\n  1. b1\n  2. b2',
    /<li>a<ul>[\s\S]*<li>b<ol>/,
    'nested-list'
  );
});

test('blockquote（含引内列表）', () => {
  assertSinglePipeline(
    '> 引用一行\n>\n> 引用二行\n>\n> - 引内列表',
    /<blockquote>[\s\S]*<li>引内列表<\/li>/,
    'blockquote'
  );
});

test('图片 + 链接（含 title）', () => {
  assertSinglePipeline(
    '![替代文本](/img.png "工具提示")\n\n[链接文本](https://example.com "标题")',
    /<img src="\/img\.png" alt="替代文本" title="工具提示">[\s\S]*<a href="https:\/\/example\.com" title="标题">链接文本<\/a>/,
    'image+link'
  );
});

test('HTML 原始块', () => {
  assertSinglePipeline(
    '<div class="x">\n<p>原始 HTML</p>\n</div>\n\n普通段落',
    /<div class="x">\s*<p>原始 HTML<\/p>\s*<\/div>[\s\S]*<p>普通段落<\/p>/,
    'html-raw'
  );
});

test('hr + setext 标题', () => {
  assertSinglePipeline(
    '前段\n\n---\n\nSetext 标题\n===',
    /<hr>[\s\S]*<h1>Setext 标题<\/h1>/,
    'hr+setext'
  );
});

test('中文混合文档（标题/列表/表格/引用/hr）', () => {
  assertSinglePipeline(
    '# 中文标题\n\n中文段落，含**加粗**与`代码`。\n\n- 项目一\n- 项目二\n\n| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |\n\n> 中文引用\n\n---',
    /<h1>中文标题<\/h1>[\s\S]*<table>[\s\S]*<blockquote>[\s\S]*<hr>/,
    'chinese-mixed'
  );
});

test('同一 tokens 可重复送入 parser 且输出稳定（_lastTokens 缓存前提）', () => {
  const m = new Marked(EDITOR_OPTIONS);
  const src = '# H\n\n- a\n- b\n\n| 1 | 2 |\n| --- | --- |';
  const tokens = m.lexer(src);
  const first = m.parser(tokens, { gfm: true, breaks: true });
  const second = m.parser(tokens, { gfm: true, breaks: true });
  assert.equal(first, second, '同一 tokens 重复解析输出必须逐字节一致');
  assert.equal(first, m.parse(src), 'tokens 复用输出必须与 parse(src) 一致');
});
