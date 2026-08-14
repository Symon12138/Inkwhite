// M3-PASTE：粘贴/复制纯逻辑单测。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPaste,
  htmlToMarkdown,
  sanitizeForInsert,
  buildPasteResult,
  type PasteInput
} from '../../src/editor/pasteMethods.ts';
import {
  describeClipboardPayload,
  isSafeHtml,
  sanitizeClipboardHtml,
  copyMarkdownSelection
} from '../../src/editor/clipboardMethods.ts';

// ===== classifyPaste =====

test('图片文件优先', () => {
  assert.equal(classifyPaste({ types: ['text/html'], hasImageFiles: true, html: '<p>x</p>', text: null }), 'image');
});

test('有 text/html 时走 html', () => {
  assert.equal(classifyPaste({ types: ['text/plain', 'text/html'], hasImageFiles: false, html: '<p>x</p>', text: 'x' }), 'html');
});

test('无 html 无图片走 plain（即使 types 含 text/html 但值为空）', () => {
  assert.equal(classifyPaste({ types: ['text/html'], hasImageFiles: false, html: null, text: 'x' }), 'plain');
  assert.equal(classifyPaste({ types: [], hasImageFiles: false, html: null, text: 'x' }), 'plain');
});

// ===== htmlToMarkdown：语义保留 =====

test('标题/段落/粗斜体/链接转换', () => {
  const md = htmlToMarkdown('<h1>大标题</h1><p>正文 <strong>粗</strong> <em>斜</em> <a href="https://x.com">链接</a></p>');
  assert.equal(md, '# 大标题\n\n正文 **粗** *斜* [链接](https://x.com)');
});

test('无序列表与嵌套列表缩进（Turndown 4 空格约定）', () => {
  const md = htmlToMarkdown('<ul><li>甲</li><li>乙<ul><li>乙一</li></ul></li></ul>');
  assert.equal(md, '-   甲\n-   乙\n    -   乙一');
});

test('表格转换：含转义管道与 <br>（addTableRules 接线验证）', () => {
  const md = htmlToMarkdown('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1<br>2</td><td>x|y</td></tr></tbody></table>');
  assert.ok(md.includes('| a | b |'), '表头行: ' + md);
  assert.ok(md.includes('| --- | --- |'), '分隔行: ' + md);
  assert.ok(md.includes('| 1<br>2 | x\\|y |'), '数据行保留 <br> 与转义管道: ' + md);
});

test('代码块转围栏', () => {
  const md = htmlToMarkdown('<pre><code>let x = 1;</code></pre>');
  assert.equal(md, '```\nlet x = 1;\n```');
});

test('行内代码与图片', () => {
  const md = htmlToMarkdown('<p>用 <code>npm i</code> 安装 <img src="a.png" alt="图"></p>');
  assert.equal(md, '用 `npm i` 安装 ![图](a.png)');
});

// ===== sanitizeForInsert =====

test('javascript: 链接剥离协议保留文本', () => {
  assert.equal(sanitizeForInsert('[点我](javascript:alert(1))'), '点我');
  assert.equal(sanitizeForInsert('[x](vbscript:msgbox)'), 'x');
});

test('残留 script 与事件属性被清除', () => {
  const out = sanitizeForInsert('<script>alert(1)</script>正文 <img onerror="x()">');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('onerror'));
  assert.ok(out.includes('正文'));
});

// ===== buildPasteResult =====

test('组合结果：html → markdown 已净化；image → 文件列表；plain → 文本', () => {
  const html: PasteInput = { types: ['text/html'], hasImageFiles: false, html: '<p><a href="javascript:x">点</a> <b>粗</b></p>', text: null };
  const r1 = buildPasteResult(html);
  assert.equal(r1.kind, 'html');
  assert.equal(r1.markdown, '点 **粗**');

  const files = [{ name: 'a.png' } as File];
  const r2 = buildPasteResult({ types: [], hasImageFiles: true, html: null, text: null }, files);
  assert.equal(r2.kind, 'image');
  assert.equal(r2.imageFiles?.length, 1);

  const r3 = buildPasteResult({ types: [], hasImageFiles: false, html: null, text: ' 纯文本\n' });
  assert.equal(r3.kind, 'plain');
  assert.equal(r3.markdown, '纯文本');
});

// ===== clipboardMethods =====

test('describeClipboardPayload：双 MIME 与安全性判定', () => {
  const d = describeClipboardPayload({ html: '<p>安全</p>', text: '安全' });
  assert.deepEqual(d.mimeTypes, ['text/html', 'text/plain']);
  assert.equal(d.htmlSafe, true);
  assert.equal(d.textLength, 2);
});

test('isSafeHtml 拒绝 script/on*/javascript:', () => {
  assert.equal(isSafeHtml('<p>ok</p>'), true);
  assert.equal(isSafeHtml('<script>1</script>'), false);
  assert.equal(isSafeHtml('<img onerror="x">'), false);
  assert.equal(isSafeHtml('<a href="javascript:x">'), false);
});

test('sanitizeClipboardHtml 剥离危险内容保留结构', () => {
  const out = sanitizeClipboardHtml('<h2>标题</h2><script>1</script><p onclick="x">正文 <a href="javascript:y">链</a></p>');
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('onclick'));
  assert.ok(!out.includes('javascript:'));
  assert.ok(out.includes('<h2>标题</h2>'));
  assert.ok(out.includes('<p>正文'));
});

test('copyMarkdownSelection：行尾空白清理保留空行', () => {
  assert.equal(copyMarkdownSelection('a  \nb\t\n\nc  '), 'a\nb\n\nc');
});
