// M1-5：Front Matter 扩展单元测试（node:test，零依赖）。
// 被测模块：src/editor/markdownExtensions/frontMatterExtension.ts。
//
// 覆盖：
//   1. 文档开头 ---\ntitle: x\n--- 识别为 .front-matter 卡片（details/summary + dl 键值行）；
//   2. 负例回落无扩展基线（hr + setext）：
//      - --- 单行（hr）；
//      - 未闭合（无 --- 闭合行）；
//      - 无 key: value 行；
//      - 非首行（正文出现后不再识别）；
//      - 引用 / 列表上下文内不识别；
//   3. raw 含整个 FM 块（含尾随换行）→ 后续正文源偏移零平移；
//   4. 键值经 HTML 转义以 textContent 安全呈现，<script> 恶意值不执行。

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
import { frontMatterExtension } from '../../src/editor/markdownExtensions/frontMatterExtension.ts';

function renderWithFm(src: string): string {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(frontMatterExtension);
  return renderMarkdown(src).html;
}

function tokensWithFm(src: string): Token[] {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(frontMatterExtension);
  return renderMarkdown(src).tokens;
}

// ===== 识别 =====

test('文档开头 ---\\ntitle: x\\n--- 渲染为 .front-matter 卡片（details/summary + dl 键值行）', () => {
  const html = renderWithFm('---\ntitle: x\n---');
  assert.match(html, /<details class="front-matter">/);
  assert.match(html, /<summary>/);
  assert.match(html, /<dt>title<\/dt><dd>x<\/dd>/);
  assert.doesNotMatch(html, /<hr>/);
  assert.doesNotMatch(html, /<h2>title: x<\/h2>/);
});

test('多键值、值含冒号与中文均保留', () => {
  const html = renderWithFm('---\ntitle: 我的文档\nurl: https://example.com/a:b\ntags: a, b\n---');
  assert.match(html, /<dt>title<\/dt><dd>我的文档<\/dd>/);
  assert.match(html, /<dt>url<\/dt><dd>https:\/\/example\.com\/a:b<\/dd>/);
  assert.match(html, /<dt>tags<\/dt><dd>a, b<\/dd>/);
});

test('前导空行容忍：空白后的 FM 块仍识别为文档开头', () => {
  const html = renderWithFm('\n\n---\ntitle: x\n---');
  assert.match(html, /<details class="front-matter">/);
});

test('闭合行允许尾随空白；token 的 raw 含整个 FM 块（含闭合行尾随换行）', () => {
  const src = '---\ntitle: x\n---  \n';
  const html = renderWithFm(src);
  assert.match(html, /<details class="front-matter">/);
  const tokens = tokensWithFm(src);
  assert.equal(tokens[0].type, 'frontMatter');
  assert.equal(tokens[0].raw, src);
});

// ===== 负例（回落 hr + setext 基线）=====

test('--- 单行仍是 <hr>', () => {
  const html = renderWithFm('---');
  assert.equal(html, '<hr>\n');
});

test('未闭合（缺闭合 ---）回落基线 hr + 段落', () => {
  const html = renderWithFm('---\ntitle: x');
  assert.doesNotMatch(html, /front-matter/);
  assert.match(html, /^<hr>\n/);
  assert.match(html, /<p>title: x<\/p>/);
});

test('无 key: value 行回落基线 hr + setext h2', () => {
  const html = renderWithFm('---\njust some prose\n---');
  assert.doesNotMatch(html, /front-matter/);
  assert.equal(html, '<hr>\n<h2>just some prose</h2>\n');
});

test('空块 ---\\n--- 回落基线（连续两个 hr）', () => {
  const html = renderWithFm('---\n---\n');
  assert.doesNotMatch(html, /front-matter/);
  assert.equal(html, '<hr>\n<hr>\n');
});

test('非首行不受影响：正文出现后的 FM 块回落 hr + setext', () => {
  const html = renderWithFm('text\n\n---\ntitle: x\n---');
  assert.doesNotMatch(html, /front-matter/);
  assert.match(html, /<p>text<\/p>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<h2>title: x<\/h2>/);
});

test('引用内 > ---\\ntitle: x\\n--- 不识别为 FM（blockquote 递归守卫）', () => {
  const html = renderWithFm('> ---\ntitle: x\n---');
  assert.doesNotMatch(html, /front-matter/);
  // 回落基线（无扩展实测）：引用内 hr + 段落，末尾 --- 在引用外成为 hr
  assert.equal(html, '<blockquote>\n<hr>\n<p>title: x</p>\n</blockquote>\n<hr>\n');
});

test('列表项内 - ---\\ntitle: x\\n--- 不识别为 FM', () => {
  const html = renderWithFm('- ---\ntitle: x\n---');
  assert.doesNotMatch(html, /front-matter/);
});

test('[TOC] 后的 FM 块不属于文档开头，不识别为 FM', () => {
  const html = renderWithFm('[TOC]\n\n---\ntitle: x\n---');
  assert.doesNotMatch(html, /front-matter/);
});

// ===== raw 零平移 =====

test('raw 含整个 FM 块：后续正文 token 的源偏移与无扩展基线一致（零平移）', () => {
  const src = '---\ntitle: x\n---\n\n# H';
  const tokens = tokensWithFm(src);
  const heading = tokens.find((t) => t.type === 'heading') as { raw: string } | undefined;
  assert.ok(heading, '应有 heading token');
  assert.equal(heading.raw, '# H');
  const fm = tokens[0] as { raw: string };
  // marked 会把紧邻的单字符 \n space token 并入前一 block token 的 raw（空间合并），
  // 故 FM raw 为 '---\ntitle: x\n---\n' + 被并入的 '\n'——正文起点偏移仍与源码一致
  assert.equal(fm.raw, '---\ntitle: x\n---\n\n');
  assert.equal(src.indexOf('# H'), fm.raw.length);
  const html = renderWithFm(src);
  assert.match(html, /<h1>H<\/h1>/);
  // 与无 FM 时 # H 的渲染逐字节一致（FM 块整体消费，正文零平移）
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  assert.ok(html.endsWith(m.parse('# H')));
});

// ===== 安全 =====

test('FM 内 <script> 恶意值被转义为文本，不产出可执行标签', () => {
  const html = renderWithFm('---\ntitle: <script>window.__xss=1</script>\n---');
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<dd>&lt;script&gt;window\.__xss=1&lt;\/script&gt;<\/dd>/);
});

test('键也转义（恶意键名不注入结构）', () => {
  const html = renderWithFm('---\n<img src=x onerror=alert(1)>: v\n---');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
