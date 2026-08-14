// M1-5：[TOC] 目录扩展单元测试（node:test，零依赖）。
// 被测模块：src/editor/markdownExtensions/tocExtension.ts。
//
// 覆盖：
//   1. 顶层独占行 [TOC] 触发，产出 .toc 容器与层级条目（.toc-level-N + #outline-<slug>）；
//   2. 引用 / 列表 / 引用+列表嵌套内的 [TOC] 误触发修复（transformTokens 树遍历降级
//      为字面 <p>[TOC]</p>；列表项递归由 tokenizer 的 state.top 守卫拦截）；
//   3. 围栏 / 缩进代码 / 行中 [TOC] / 非独占行均不触发；
//   4. slug 同源：含行内语法（^sup^ / ==高亮== / $公式$ / `代码`）的标题，TOC 锚点
//      id 与大纲（viewMethods._renderOutline 基于 textContent + outlineSlug）一致；
//   5. 重复标题递增后缀、引用内标题也入目录、条目文本 HTML 转义。
//
// 隔离约定：与 markdownExtensionRegistry.test.ts 相同——每个测试
// resetMarkdownExtensionRegistry + setMarkedTarget(new Marked(RENDER_MARKDOWN_OPTIONS))
// + registerMarkdownExtensions(tocExtension)，不污染其他测试文件。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import type { Token } from 'marked';
import {
  registerMarkdownExtensions,
  renderMarkdown,
  resetMarkdownExtensionRegistry,
  setMarkedTarget,
  RENDER_MARKDOWN_OPTIONS,
  type MarkedTarget
} from '../../src/editor/markdownExtensions/markdownExtensionRegistry.ts';
import { tocExtension } from '../../src/editor/markdownExtensions/tocExtension.ts';
import { outlineSlug } from '../../src/editor/markdownExtensions/slugify.ts';

function renderWithToc(src: string): string {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(tocExtension);
  return renderMarkdown(src).html;
}

function tokensWithToc(src: string): Token[] {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(tocExtension);
  return renderMarkdown(src).tokens;
}

// ===== 顶层触发 =====

test('顶层独占行 [TOC] 渲染为 .toc 容器，条目按标题层级带缩进类与锚点', () => {
  const html = renderWithToc('[TOC]\n\n# A\n\n## B\n\n### C');
  assert.match(html, /<div class="toc"><ul>/);
  assert.match(html, /<li class="toc-level-1"><a href="#outline-a">A<\/a><\/li>/);
  assert.match(html, /<li class="toc-level-2"><a href="#outline-b">B<\/a><\/li>/);
  assert.match(html, /<li class="toc-level-3"><a href="#outline-c">C<\/a><\/li>/);
  assert.doesNotMatch(html, /<p>\[TOC\]<\/p>/);
});

test('[TOC] 独占行后紧跟标题（无空行）同样触发，raw 只含标记本身', () => {
  const html = renderWithToc('[TOC]\n# H');
  assert.match(html, /<div class="toc">/);
  assert.match(html, /<h1>H<\/h1>/);
  const tokens = tokensWithToc('[TOC]\n# H');
  assert.equal(tokens[0].type, 'toc');
  // marked 会把紧邻的单字符 \n space token 并入前一 block token 的 raw（空间合并）
  assert.equal(tokens[0].raw, '[TOC]\n');
});

test('文档无标题时 [TOC] 渲染为空目录容器（结构一致）', () => {
  const html = renderWithToc('[TOC]');
  assert.equal(html, '<div class="toc"><ul></ul></div>\n');
});

test('顶层非首行独占 [TOC] 同样触发（text\\n\\n[TOC]）', () => {
  const html = renderWithToc('text\n\n[TOC]\n\n# H');
  assert.match(html, /<div class="toc">/);
  assert.match(html, /<h1>H<\/h1>/);
});

// ===== 引用 / 列表内误触发修复 =====

test('引用内 > [TOC] 不触发目录，保持字面文本（降级为 <p>[TOC]</p>）', () => {
  const html = renderWithToc('> [TOC]');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.equal(html, '<blockquote>\n<p>[TOC]</p>\n</blockquote>\n');
});

test('列表项内 - [TOC] 不触发目录（tokenizer 的 state.top 守卫）', () => {
  const html = renderWithToc('- [TOC]');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.equal(html, '<ul>\n<li>[TOC]</li>\n</ul>\n');
});

test('引用>列表 > - [TOC] 不触发目录', () => {
  const html = renderWithToc('> - [TOC]');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.equal(html, '<blockquote>\n<ul>\n<li>[TOC]</li>\n</ul>\n</blockquote>\n');
});

test('列表>引用 - > [TOC] 不触发目录（树遍历需下钻 list→blockquote 两级）', () => {
  const html = renderWithToc('- > [TOC]');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.equal(html, '<ul>\n<li><blockquote>\n<p>[TOC]</p>\n</blockquote>\n</li>\n</ul>\n');
});

test('引用内 [TOC] 降级后不收集引用外标题为目录（无 .toc 结构）', () => {
  const html = renderWithToc('> [TOC]\n\n# H');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.match(html, /<blockquote>\n<p>\[TOC\]<\/p>\n<\/blockquote>/);
  assert.match(html, /<h1>H<\/h1>/);
});

// ===== 不触发负例 =====

test('围栏代码内的 [TOC] 不触发', () => {
  const html = renderWithToc('```\n[TOC]\n```');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.match(html, /<pre><code>\[TOC\]\n<\/code><\/pre>/);
});

test('4 空格缩进代码内的 [TOC] 不触发', () => {
  const html = renderWithToc('    [TOC]');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.match(html, /<pre><code>\[TOC\]/);
});

test('行中 [TOC]（x[TOC] / abc[TOC] def）不触发——start 行首守卫', () => {
  assert.doesNotMatch(renderWithToc('x[TOC]'), /<div class="toc">/);
  assert.doesNotMatch(renderWithToc('abc[TOC] def'), /<div class="toc">/);
  assert.doesNotMatch(renderWithToc('x[TOC]\n# H'), /<div class="toc">/);
  assert.equal(renderWithToc('x[TOC]'), '<p>x[TOC]</p>\n');
});

test('非独占行 [TOC] 后面有字不触发', () => {
  const html = renderWithToc('[TOC] 后面有字');
  assert.doesNotMatch(html, /<div class="toc">/);
  assert.equal(html, '<p>[TOC] 后面有字</p>\n');
});

// ===== slug 同源（与 _renderOutline 的 textContent + outlineSlug 一致）=====

test('行内语法标题：剥 ^..^ / ==..== / $..$ / 反引号取内文本后与大纲 slug 同源', () => {
  const html = renderWithToc('[TOC]\n\n# x^2^\n\n# ==y==\n\n# $z$\n\n# `code`');
  // _renderOutline 侧（DOM textContent→outlineSlug）：
  //   x^2^ → x<sup>2</sup> → 'x2'；==y== → <mark>y</mark> → 'y'；
  //   $z$ → 'z'；`code` → <code>code</code> → 'code'。
  assert.match(html, /<a href="#outline-x2">/);
  assert.match(html, /<a href="#outline-y">/);
  assert.match(html, /<a href="#outline-z">/);
  assert.match(html, /<a href="#outline-code">/);
});

test('slug 归一与 outlineSlug 完全同源：中文/符号/重复标题按文档序共用 used 集合', () => {
  const html = renderWithToc('[TOC]\n\n# 我的 标题\n\n# Hello, World! 2.0\n\n# 标题\n\n# 标题');
  const used = new Set<string>();
  assert.match(html, new RegExp('href="#' + outlineSlug('我的 标题', 0, used) + '"'));
  assert.match(html, new RegExp('href="#' + outlineSlug('Hello, World! 2.0', 1, used) + '"'));
  assert.match(html, new RegExp('href="#' + outlineSlug('标题', 2, used) + '"'));
  assert.match(html, new RegExp('href="#' + outlineSlug('标题', 3, used) + '"'));
  // 重复标题递增后缀（第二个标题 → -2；used 集合与 _renderOutline 同语义）
  assert.match(html, /<a href="#outline-标题-2">/);
  assert.doesNotMatch(html, /<a href="#outline-标题-3">/);
});

test('引用内的标题同样进入目录（与大纲的 DOM 文档序一致）', () => {
  const html = renderWithToc('[TOC]\n\n# A\n\n> ## B');
  assert.match(html, /<a href="#outline-a">A<\/a>/);
  assert.match(html, /<a href="#outline-b">B<\/a>/);
});

// ===== 安全 =====

test('标题含 HTML 时条目文本转义（不拼接不可信 innerHTML）', () => {
  const html = renderWithToc('[TOC]\n\n# <script>alert(1)</script>');
  const tocPart = html.slice(0, html.indexOf('</div>'));
  assert.doesNotMatch(tocPart, /<script/);
  assert.match(tocPart, /&lt;script&gt;/);
});
