// WP8b（S0.3）：导出 HTML 组装纯逻辑（src/editor/exportComposer.ts）的单测。
// 本模块只做字符串组装：不碰 DOM、不抓字体、不清洗 URL——那些是消费方（M2 导出管线）的活。
// 先红后绿：本文件先写，跑一遍确认失败（模块不存在），再实现到全绿。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_SELECTOR,
  composeExportHtml,
  extractExportCss
} from '../../src/editor/exportComposer.ts';

// 样式表替身：只提供 extract 真正用到的形状（cssRules / selectorText / style），
// 与 tests/unit/longImageComposer.test.ts 的替身同构。
function createSheet(rules: unknown[]) {
  return { get cssRules() { return rules; } } as unknown as CSSStyleSheet;
}

function createStyleRule(selectorText: string, cssText: string) {
  return { selectorText, style: { cssText } };
}

test('组装标准文档骨架：DOCTYPE、charset、lang、title、meta 齐全', () => {
  const html = composeExportHtml({
    title: '导出 <测试> & "引号"',
    bodyHtml: '<p>正文</p>',
    meta: [{ name: 'description', content: 'a & b' }]
  });

  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<html lang="zh-CN">'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  // title 与 meta 内容做 HTML 转义，注入无法突破标签边界
  assert.ok(html.includes('<title>导出 &lt;测试&gt; &amp; &quot;引号&quot;</title>'));
  assert.ok(html.includes('<meta name="description" content="a &amp; b">'));
  assert.ok(html.includes('<body>'));
  assert.ok(html.includes('</body>'));
});

test('lang 可覆盖，空 title 不报错', () => {
  const html = composeExportHtml({ title: '', bodyHtml: '', lang: 'en' });
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('<title></title>'));
});

test('输出无 script 标签、无事件属性、无 javascript: 引用（注入 title 被转义）', () => {
  // bodyHtml 用干净负载：事件属性若由消费方带入会原样透传（见「原样透传」用例），
  // 这里只验证本函数自身不产生任何可执行结构
  const html = composeExportHtml({
    title: '"><script>alert(1)</script>',
    bodyHtml: '<p>正文</p>',
    meta: [{ name: 'x', content: '"><img onerror="y()">' }]
  });

  // 注入内容被转义后不再是标签/属性：不出现真实 <script 标签与 javascript: 引用
  assert.ok(!/<script/i.test(html));
  assert.ok(!/javascript:/i.test(html));
  // 唯一的 on* 出现是转义文本形态：onerror= 后跟 &quot; 实体而非引号，
  // 处于 meta content 属性值内部，不构成事件属性
  const onHandlerOccurrences = html.match(/\son\w+\s*=\s*(&quot;|")/g) ?? [];
  assert.deepEqual(onHandlerOccurrences, [' onerror=&quot;']);
  // 转义后的注入文本仍在输出里（逐字符可见，不执行）
  assert.ok(html.includes('&lt;script&gt;'));
});

test('cssVariables 冻结为字面值传入时，输出无 var(-- 残留', () => {
  const html = composeExportHtml({
    title: 't',
    bodyHtml: '<p>正文</p>',
    cssVariables: ':root{--paper-bg:#f4ebd9;--paper-text:#1c1a17;}'
  });

  assert.ok(!html.includes('var(--'));
  assert.ok(html.includes('--paper-bg:#f4ebd9'));
});

test('cssVariables 未冻结时原样透传：冻结是消费方责任，本函数不代劳', () => {
  const html = composeExportHtml({
    title: 't',
    bodyHtml: '',
    cssVariables: ':root{--paper-bg:var(--theme-bg);}'
  });

  // 透传而非悄悄改写——若消费方忘了冻结，导出物里会带 var(--，
  // 由 M2 管线的「冻结步骤」（getComputedStyle 落定）负责消除
  assert.ok(html.includes(':root{--paper-bg:var(--theme-bg);}'));
});

test('bodyHtml 原样透传：本函数不引入、也不清洗相对 URL（清洗是 M2 消费方责任）', () => {
  const bodyHtml = '<img src="images/pic.png" alt=""><a href="docs/guide.html">指南</a>';
  const html = composeExportHtml({ title: 't', bodyHtml });

  // 逐字节出现在输出里，且只出现一次（本函数没额外复制/改写任何资源引用）
  assert.ok(html.includes(bodyHtml));
  assert.equal(html.split('images/pic.png').length - 1, 1);
  assert.equal(html.split('docs/guide.html').length - 1, 1);
  // 注意：本函数不做 URL 清洗。M2 消费方必须在传入 bodyHtml 之前
  // 完成相对路径内联（转 data URL/绝对路径）或按需丢弃，否则导出物会有死链。
});

test('内联样式按 cssVariables → fontsCss → cssBundle 顺序合并，空段省略', () => {
  const html = composeExportHtml({
    title: 't',
    bodyHtml: '',
    cssVariables: ':root{--a:1;}',
    fontsCss: '@font-face{font-family:X;}',
    cssBundle: '.md-preview{color:red;}'
  });

  const styleText = html.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';
  assert.ok(styleText.indexOf(':root{--a:1;}') < styleText.indexOf('@font-face{font-family:X;}'));
  assert.ok(styleText.indexOf('@font-face{font-family:X;}') < styleText.indexOf('.md-preview{color:red;}'));
});

test('样式全空时不输出空 <style> 块', () => {
  const html = composeExportHtml({ title: 't', bodyHtml: '<p>x</p>' });
  assert.ok(!html.includes('<style'));
});

test('选择器集合覆盖 5 个新语法选择器与既有正文/Mermaid 选择器', () => {
  const newSyntax = ['.katex', '.footnotes', '.toc', '.front-matter', '.task-list-item'];
  const existing = ['.md-preview', '.mermaid-rendered'];
  for (const selector of [...newSyntax, ...existing]) {
    assert.ok(EXPORT_SELECTOR.test(selector), selector + ' 应命中导出选择器集合');
  }
  // 复合选择器同样命中
  for (const compound of ['.md-preview .katex', '.footnotes ol', '.toc a', '.front-matter table', '.task-list-item input', '.mermaid-rendered svg']) {
    assert.ok(EXPORT_SELECTOR.test(compound), compound + ' 应命中');
  }
  // 应用壳与海报壳不进导出
  assert.ok(!EXPORT_SELECTOR.test('.app-header'));
  assert.ok(!EXPORT_SELECTOR.test('.longimg-poster'));
  assert.ok(!EXPORT_SELECTOR.test('.longimg-prose'));
});

test('抽取导出样式：保留原选择器、纳入新语法选择器、剔除无关规则', () => {
  const css = extractExportCss([
    createSheet([
      createStyleRule('.md-preview', 'color: red'),
      createStyleRule('.md-preview h1', 'font-size: 2.1em'),
      createStyleRule('.katex', 'font-size: 1.1em'),
      createStyleRule('.footnotes', 'border-top: 1px solid #ccc'),
      createStyleRule('.toc a', 'text-decoration: none'),
      createStyleRule('.front-matter', 'margin-bottom: 2em'),
      createStyleRule('.task-list-item input', 'accent-color: #f0a838'),
      createStyleRule('.mermaid-rendered svg', 'min-width: 620px'),
      createStyleRule('.app-header', 'height: 54px'),
      createStyleRule('.longimg-poster', 'width: 720px')
    ])
  ]);

  // 与长图海报不同：导出保留原选择器（.md-preview 不改写为 .longimg-prose）
  assert.match(css, /\.md-preview\{color: red\}/);
  assert.match(css, /\.md-preview h1\{font-size: 2\.1em\}/);
  // 5 个新语法选择器 + Mermaid 都进来
  assert.match(css, /\.katex\{font-size: 1\.1em\}/);
  assert.match(css, /\.footnotes\{border-top: 1px solid #ccc\}/);
  assert.match(css, /\.toc a\{text-decoration: none\}/);
  assert.match(css, /\.front-matter\{margin-bottom: 2em\}/);
  assert.match(css, /\.task-list-item input\{accent-color: #f0a838\}/);
  assert.match(css, /\.mermaid-rendered svg\{min-width: 620px\}/);
  // 无关与海报壳规则不带走
  assert.doesNotMatch(css, /app-header/);
  assert.doesNotMatch(css, /longimg-poster/);
  assert.doesNotMatch(css, /longimg-prose/);
});

test('抽取导出样式：@media（含 @media print）与 @font-face、@keyframes 不进导出', () => {
  const printMedia = { media: { mediaText: 'print' }, cssRules: [createStyleRule('.md-preview', 'color: black')] };
  const screenMedia = { media: { mediaText: '(max-width: 760px)' }, cssRules: [createStyleRule('.md-preview', 'font-size: 0.8em')] };
  const fontFace = { style: { cssText: 'font-family: X' }, cssText: '@font-face{font-family:X}' };
  const keyframes = { style: { cssText: 'opacity: 0' }, cssText: '@keyframes fade{from{opacity:0}}' };

  const css = extractExportCss([
    createSheet([
      printMedia,
      screenMedia,
      fontFace,
      keyframes,
      createStyleRule('.md-preview', 'color: red')
    ])
  ]);

  // print 规则不进导出（打印样式属于宿主页面；导出物是屏幕阅读文档）
  assert.equal(css, '.md-preview{color: red}');
});

test('抽取导出样式：跨源样式表读 cssRules 抛错时跳过，不影响其余样式', () => {
  const blocked = { get cssRules(): unknown[] { throw new Error('SecurityError'); } } as unknown as CSSStyleSheet;

  const css = extractExportCss([blocked, createSheet([createStyleRule('.md-preview', 'color: red')])]);

  assert.equal(css, '.md-preview{color: red}');
});

test('空输入边界：无样式、无 meta、无正文也产出合法最小文档', () => {
  const html = composeExportHtml({ title: '', bodyHtml: '' });

  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<html lang="zh-CN">'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('<title></title>'));
  assert.ok(html.includes('<body>'));
  assert.ok(html.includes('</body>'));
  assert.ok(!html.includes('<style'));
  assert.ok(!html.includes('<meta name="'));
});
