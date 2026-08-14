// M1-2：数学扩展（KaTeX）单元测试。
// 被测模块：src/editor/markdownExtensions/mathExtension.ts。
//
// 契约（M1-1 定稿，见 markdownExtensionRegistry.ts 头部注释）：MarkdownExtensionModule =
// { extensions; transformTokens? }；注册序 math 在前（editorEntry 已接好）。
//
// 设计要点（实现前经 probe-math4.mjs 实测固化，断言的是本实现 + marked@18.0.5 后的实测输出）：
//   - 行内 $...$：内容非空、不含 $ 与换行、首尾非空白（$ x $ 不触发）；闭合 $ 后邻
//     单词字符或 $ 时整串不触发（$x$y$、$a$$b$ 保持字面，GitHub 风格闭侧规则）；开侧
//     前邻单词字符或 $ 不触发（a$x$ 保持字面）；前导反斜杠为奇数的 $ 不触发
//     （\\$5 由 escape 规则消费为字面 $5）。
//   - 行内 \(...\)：开侧只查前导反斜杠奇偶（\\\\(x\\) 不触发）；内容可跨行（实测允许，
//     \(a\nb\) 整体消费）；内容 trim 后非空（\\(\\) 保持字面，反斜杠被 escape 消耗）。
//   - 块级 $$...$$ / \[...\]：只认独立行（行首、≤3 空格缩进；行内 a $$x$$ b、尾随
//     $$x$$ tail、a$$x$$ 均不触发）；单行（$$x$$）或多行（闭合行亦须行首、≤3 空格）；
//     内容 trim 后非空（$$$$、$$\n$$ 不触发）；4 空格缩进为代码块（内置 code 规则优先）。
//   - 代码 span / 围栏内不解析（内置规则原子消费，扩展不可见）。
//   - 错误公式 → .katex-error 且不抛异常（throwOnError:false）；块级错误公式的
//     .katex-display 包装由本扩展补齐（实测 KaTeX displayMode 错误路径不产出该包装）。
//   - 输出结构：行内 <span class="katex">（含 katex-mathml/semantics/annotation 与
//     katex-html aria-hidden 双轨）；块级 <span class="katex-display"> 包装。
//   - 与 inlineSyntax 共存时 $x^2$ 由 math 整体消费（注册序 math 在前），^ 不产生 <sup>。
//
// 隔离约定：每个测试各自 new Marked() 并 resetMarkdownExtensionRegistry /
// setMarkedTarget（参考 markdownExtensionRegistry.test.ts 的 isolated 模式）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import {
  RENDER_MARKDOWN_OPTIONS,
  registerMarkdownExtensions,
  renderMarkdown,
  resetMarkdownExtensionRegistry,
  setMarkedTarget,
  type MarkdownExtensionModule,
  type MarkedTarget
} from '../../src/editor/markdownExtensions/markdownExtensionRegistry.ts';
import { mathExtension } from '../../src/editor/markdownExtensions/mathExtension.ts';
import { inlineSyntaxExtension } from '../../src/editor/markdownExtensions/inlineSyntaxExtension.ts';

/** 真实 marked + 本扩展的单管线渲染（与 _renderPreview 共用 renderMarkdown）。 */
function render(src: string, modules: MarkdownExtensionModule[] = [mathExtension]): string {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(...modules);
  return renderMarkdown(src).html;
}

const KATEX_SPAN = '<span class="katex">';
const KATEX_DISPLAY_SPAN = '<span class="katex-display">';

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ===== 行内 $...$ =====

test('行内 $x^2$ → <span class="katex">，含 MathML 语义标注，无 <sup>', () => {
  const html = render('$x^2$');
  assert.ok(html.startsWith('<p>' + KATEX_SPAN), '应包裹在段落内且以 .katex 开头');
  assert.ok(html.includes('<span class="katex-mathml">'), '应有 MathML 语义层');
  assert.ok(html.includes('<math xmlns="http://www.w3.org/1998/Math/MathML">'));
  assert.ok(html.includes('<semantics>'));
  assert.ok(html.includes('<annotation encoding="application/x-tex">x^2</annotation>'));
  assert.ok(html.includes('<span class="katex-html" aria-hidden="true">'), '应有视觉层（KaTeX CSS 挂载点）');
  assert.ok(!html.includes('<sup>'), '^ 不得渲染为 <sup>（归数学整体消费）');
});

test('行内 $...$：句中/句尾/多个/CJK 语境均可', () => {
  assert.ok(render('公式 $x^2$ 文字').includes(KATEX_SPAN));
  assert.ok(render('公式 $x^2$ 文字').includes('<annotation encoding="application/x-tex">x^2</annotation>'));
  assert.ok(render('句尾 $a$。').includes('</span>。</p>'), '闭合 $ 后邻句号可触发');
  assert.equal(countOccurrences(render('$a$ $b$'), KATEX_SPAN), 2, '同一行两个公式各自消费');
  assert.ok(render('价格 $5$ 元').includes('<annotation encoding="application/x-tex">5</annotation>'));
});

test('行内 $...$：内容可含空格但首尾非空白（$a b$ 触发，$ x $ 不触发）', () => {
  assert.ok(render('$a b$').includes('<annotation encoding="application/x-tex">a b</annotation>'));
  assert.equal(render('$ x $'), '<p>$ x $</p>\n');
  assert.equal(render('$ $'), '<p>$ $</p>\n');
});

// ===== 行内 \(...\) =====

test('行内 \\(x\\) → <span class="katex">，词中 a\\(x\\)b 亦可触发', () => {
  const html = render('\\(x\\)');
  assert.ok(html.startsWith('<p>' + KATEX_SPAN));
  assert.ok(html.includes('<annotation encoding="application/x-tex">x</annotation>'));
  // 与 $ 不同，\( 开侧不做单词边界检查（LaTeX 风格，实测 a\(x\)b 整体消费）。
  assert.ok(render('a\\(x\\)b').includes('a' + KATEX_SPAN));
  assert.ok(render('a\\(x\\)b').endsWith('b</p>\n'), '闭合 \\）后文本正常续排');
});

test('行内 \\(...\\)：内容可跨行（实测允许整体消费）', () => {
  const html = render('\\(a\nb\\)');
  assert.ok(html.startsWith('<p>' + KATEX_SPAN));
  assert.ok(html.includes('<annotation encoding="application/x-tex">a\nb</annotation>'));
});

test('行内 \\(...\\) 在标题内可用', () => {
  assert.ok(render('# 公式 \\(x\\)').startsWith('<h1>公式 ' + KATEX_SPAN));
});

// ===== 块级 $$...$$ / \[...\] =====

test('块级 $$x$$：单行独立块 → .katex-display 包装，无 <p> 包裹', () => {
  const html = render('$$x$$');
  assert.ok(html.startsWith(KATEX_DISPLAY_SPAN), '块级输出不应有 <p> 包裹');
  assert.ok(html.includes('<annotation encoding="application/x-tex">x</annotation>'));
  assert.ok(html.includes('display="block"'), 'displayMode 生效');
  assert.ok(render('$$x^2$$').includes('<annotation encoding="application/x-tex">x^2</annotation>'));
});

test('块级 $$x$$：行尾空格不影响触发', () => {
  const html = render('$$x$$  ');
  assert.ok(html.startsWith(KATEX_DISPLAY_SPAN));
});

test('块级 $$：多行独立块（内容可为空行分隔），闭合行亦须行首', () => {
  const html = render('$$\na+b\n$$');
  assert.ok(html.startsWith(KATEX_DISPLAY_SPAN));
  assert.ok(html.includes('<annotation encoding="application/x-tex">a+b</annotation>'));
  assert.ok(render('$$\n\na\n$$').startsWith(KATEX_DISPLAY_SPAN), '内容内空行允许');
});

test('块级 \\[x\\] 与多行 \\[...\\] → .katex-display', () => {
  assert.ok(render('\\[x\\]').startsWith(KATEX_DISPLAY_SPAN));
  assert.ok(render('\\[\na+b\n\\]').includes('<annotation encoding="application/x-tex">a+b</annotation>'));
});

test('块级公式与段落：前/后段落正常成段（无空行亦可，实测裁剪机制）', () => {
  assert.ok(render('para\n\n$$x$$').startsWith('<p>para</p>\n' + KATEX_DISPLAY_SPAN));
  assert.ok(render('para\n$$x$$').startsWith('<p>para</p>\n' + KATEX_DISPLAY_SPAN), '无空行分隔也触发（段落被裁剪）');
  assert.ok(render('para\n\n$$\nx\n$$\n\nmore').includes('<p>para</p>\n' + KATEX_DISPLAY_SPAN));
  assert.ok(render('para\n\n$$\nx\n$$\n\nmore').endsWith('</span>\n<p>more</p>\n'));
});

test('块级公式：标题后、引用内、列表内均可用', () => {
  assert.ok(render('# H\n$$x$$').startsWith('<h1>H</h1>\n' + KATEX_DISPLAY_SPAN));
  assert.ok(render('> $$x$$').startsWith('<blockquote>\n' + KATEX_DISPLAY_SPAN));
  assert.ok(render('- $$x$$').startsWith('<ul>\n<li>' + KATEX_DISPLAY_SPAN));
});

test('块级公式：≤3 空格缩进触发，4 空格为代码块', () => {
  assert.ok(render('   $$x$$').startsWith(KATEX_DISPLAY_SPAN), '3 空格缩进触发且无残留 <p>');
  assert.ok(render('para\n  $$x$$').includes(KATEX_DISPLAY_SPAN), '段落后 2 空格缩进触发');
  assert.equal(render('    $$x$$'), '<pre><code>$$x$$\n</code></pre>\n', '4 空格缩进为代码块');
  assert.equal(render('para\n\n    $$x$$'), '<p>para</p>\n<pre><code>$$x$$\n</code></pre>\n');
});

// ===== 转义与负例（不触发、保持字面） =====

test('转义：\\$5 → 字面 $5（escape 规则消费反斜杠，不触发数学）', () => {
  assert.equal(render('\\$5'), '<p>$5</p>\n');
  assert.equal(render('a\\$b'), '<p>a$b</p>\n');
  assert.equal(render('\\$x$'), '<p>$x$</p>\n', '转义 $ 后无闭合，整串字面');
});

test('转义：偶数反斜杠后 $ 未转义，正常触发（\\\\$x$ → 字面 \\ + 数学）', () => {
  const html = render('\\\\$x$');
  assert.ok(html.startsWith('<p>\\' + KATEX_SPAN), '2 个反斜杠被 escape 消费为字面 \\，$x$ 触发');
});

test('转义：前导反斜杠为奇数的 \\( 不触发（escape 规则消费后剩 (x) 字面）', () => {
  assert.equal(render('\\\\(x\\)'), '<p>\\(x)</p>\n');
});

test('无闭合：价格是 $5 / $x / $x$y$ / $x$$y$ / $$x$ 均保持字面', () => {
  assert.equal(render('价格是 $5'), '<p>价格是 $5</p>\n');
  assert.equal(render('$x'), '<p>$x</p>\n');
  // 闭合 $ 后邻单词字符 → 整串不触发（$x$y$ 字面，无部分消费）。
  assert.equal(render('$x$y$'), '<p>$x$y$</p>\n');
  assert.equal(render('$x$$y$'), '<p>$x$$y$</p>\n');
  assert.equal(render('$$x$'), '<p>$$x$</p>\n');
  assert.equal(render('$a$$b$'), '<p>$a$$b$</p>\n', '闭合 $ 后邻 $ 不触发');
});

test('行内 $$ 不触发块级：a $$x$$ b / text $$x$$ / $$x$$ tail / a$$x$$ 均字面', () => {
  assert.equal(render('a $$x$$ b'), '<p>a $$x$$ b</p>\n');
  assert.equal(render('text $$x$$'), '<p>text $$x$$</p>\n');
  assert.equal(render('$$x$$ tail'), '<p>$$x$$ tail</p>\n', '尾随内容不触发块级');
  assert.equal(render('a$$x$$'), '<p>a$$x$$</p>\n', '行首前有文本不触发块级');
});

test('空内容不触发：$$$$ / $$\\n$$ / \\(\\) 保持字面', () => {
  assert.equal(render('$$$$'), '<p>$$$$</p>\n');
  assert.equal(render('$$\n$$'), '<p>$$<br>$$</p>\n', 'breaks:true 下 \\n 渲染为 <br>');
  assert.equal(render('\\(\\)'), '<p>()</p>\n', '反斜杠被 escape 规则消耗');
});

// ===== 代码 span 与围栏 =====

test('代码 span 与围栏内不解析（$ 与 $$ 均原样）', () => {
  assert.equal(render('`$x^2$`'), '<p><code>$x^2$</code></p>\n');
  assert.equal(render('```\n$x^2$\n```'), '<pre><code>$x^2$\n</code></pre>\n');
  assert.equal(render('```\n$$x$$\n```'), '<pre><code>$$x$$\n</code></pre>\n');
});

// ===== 错误公式 =====

test('错误公式 → .katex-error 且不抛异常（throwOnError:false）', () => {
  const html = render('$\\begin{invalid}$');
  assert.ok(html.includes('class="katex-error"'), '应产出 .katex-error 结构');
  assert.ok(html.includes('KaTeX parse error: No such environment: invalid'));
  assert.doesNotThrow(() => render('$\\begin{invalid}$'));
});

test('块级错误公式 → .katex-display 补包装 + .katex-error，不抛异常', () => {
  // 实测：KaTeX displayMode 错误路径不产出 .katex-display 包装，本扩展补齐。
  const html = render('$$\\begin{invalid}$$');
  assert.ok(html.startsWith(KATEX_DISPLAY_SPAN + '<span class="katex-error"'), '块级错误也保持 .katex-display 包装');
  assert.doesNotThrow(() => render('$$\\begin{invalid}$$'));
});

// ===== 交互 =====

test('表格单元格内可用；单元格内 $$ 不触发块级', () => {
  const html = render('| $x$ | y |\n| --- | --- |\n| 1 | 2 |');
  assert.ok(html.includes('<th>' + KATEX_SPAN), '表头单元格内 math 可用');
  assert.ok(html.includes('<annotation encoding="application/x-tex">x</annotation>'));
  assert.ok(render('| $$x$$ |\n| --- |\n| 1 |').includes('<th>$$x$$</th>'), '单元格内 $$ 为字面');
});

test('链接文本内可用（[$x$](url) → <a href="url"> 内含 .katex，实测允许）', () => {
  const html = render('[$x$](url)');
  assert.ok(html.includes('<a href="url">' + KATEX_SPAN), '链接文本内 math 渲染（按实测断言）');
  assert.ok(html.includes('<annotation encoding="application/x-tex">x</annotation>'));
});

test('与 inlineSyntax 共存：$x^2$ 由 math 整体消费（注册序 math 在前），^ 不产生 <sup>', () => {
  const html = render('公式 $x^2$ 文字', [mathExtension, inlineSyntaxExtension]);
  assert.ok(html.includes(KATEX_SPAN), 'math 注册在前，公式整体消费');
  assert.ok(html.includes('<annotation encoding="application/x-tex">x^2</annotation>'));
  assert.ok(!html.includes('<sup>'), '^ 归数学，inlineSyntax 不得在公式内产出 <sup>');
});

test('混合文本：$ 与 $$ 与 \\( 与 \\[ 共处（\\[ 行内不触发，escape 为字面 [）', () => {
  const html = render('a $x$ b 与 $$y$$ 以及 \\(z\\) 与 \\[w\\]');
  assert.equal(countOccurrences(html, KATEX_SPAN), 2, '仅 $x$ 与 \\(z\\) 触发');
  assert.ok(html.includes('$$y$$'), '行内 $$ 为字面');
  assert.ok(html.includes('[w]'), '行内 \\[ 的反斜杠被 escape 消耗为字面 [w]');
  assert.ok(!html.includes('\\[w\\]'), '反斜杠已由 escape 规则消费');
});

// ===== 状态隔离 =====

test('状态隔离：连续两次渲染输出逐字节一致（无模块级可变状态）', () => {
  const src = '公式 $x^2$ 文字\n\n$$\na+b\n$$\n\n$\\begin{invalid}$';
  const a = render(src);
  const b = render(src);
  assert.equal(a, b);
});

test('空输入 → 空输出', () => {
  assert.equal(render(''), '');
});
