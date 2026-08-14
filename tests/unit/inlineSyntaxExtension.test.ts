// M1-4：行内语法扩展（上标 / 下标 / 高亮 / emoji）单元测试。
// 被测模块：src/editor/markdownExtensions/inlineSyntaxExtension.ts。
//
// 实证基线（tests/unit/markdownExtensionsSpike.test.ts 已固化，实现前先读）：
//   - ~x~ 单波浪被 marked 的 del 规则渲染为 <del>（须用自定义 inline 扩展抢先拦截）；
//   - ~~x~~ 必须保持 <del>（start() 不得命中双波浪）；
//   - ==x== / ^x^ / :smile: 无扩展时均为字面文本。
//
// 实测结论（本文件各测试断言的是 marked@18.0.5 + 本扩展后的实测输出）：
//   - 扩展 inline tokenizer 先于内置规则尝试（S0.1 事实）；带 start() 才能在句中
//     触发 text 规则不停止的定界符（^ = : 均不在 text 停止集内，~ 在）。
//   - 代码 span 由内置 codespan 规则原子消费；text 规则在 ` 前停止，故平衡代码
//     span 天然不被截断；未闭合反引号串（text 规则 first-group 路径）需在
//     tokenizer 侧用前序 token 检查拦截（codeRunBefore）。
//   - 数学扩展已落地（mathExtension 注册序在前，M1-2 完成）：$x^2$ 由 math 的
//     tokenizer 整体消费为 KaTeX，本扩展不得吞公式内上标（互斥两测按实测修正，
//     见对应测试注释）。
//
// 隔离约定：每个测试各自 new Marked() 并 resetMarkdownExtensionRegistry /
// setMarkedTarget（参考 markdownExtensionRegistry.test.ts 的 isolated 模式），
// 避免注册状态跨测试串扰。

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
import { inlineSyntaxExtension } from '../../src/editor/markdownExtensions/inlineSyntaxExtension.ts';
import { mathExtension } from '../../src/editor/markdownExtensions/mathExtension.ts';

/** 真实 marked + 本扩展的单管线渲染（与 _renderPreview 共用 renderMarkdown）。 */
function render(src: string, modules = [inlineSyntaxExtension]): string {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(...modules);
  return renderMarkdown(src).html;
}

// ===== 上标 ^x^ =====

test('上标：x^2^ → <sup>2</sup>，句首/句中/句尾均可', () => {
  assert.equal(render('x^2^'), '<p>x<sup>2</sup></p>\n');
  assert.equal(render('面积 x^2^ 平方米'), '<p>面积 x<sup>2</sup> 平方米</p>\n');
  assert.equal(render('a x^2^'), '<p>a x<sup>2</sup></p>\n');
});

test('上标：内容含空白/换行/^ 时不匹配，保持字面', () => {
  // 内容含空格：^a b^ 不得匹配（tokenizer 自检语法）。
  assert.equal(render('^a b^'), '<p>^a b^</p>\n');
  // 无闭合 ^：a^b 保持字面。
  assert.equal(render('a^b'), '<p>a^b</p>\n');
  // 负例：a^b c^d 两个 ^ 均无闭合，保持字面。
  assert.equal(render('a^b c^d'), '<p>a^b c^d</p>\n');
  // 空内容 ^^：保持字面。
  assert.equal(render('a^^'), '<p>a^^</p>\n');
});

// ===== 下标 ~x~ =====

test('下标：单波浪 ~x~ → <sub>x</sub>（优先于 marked 内置 del 规则）', () => {
  assert.equal(render('H~2~O'), '<p>H<sub>2</sub>O</p>\n');
  assert.equal(render('a ~x~ b'), '<p>a <sub>x</sub> b</p>\n');
});

test('下标：~~x~~ 必须保持 <del>（start() 与 tokenizer 均不得命中双波浪）', () => {
  assert.equal(render('~~x~~'), '<p><del>x</del></p>\n');
  assert.equal(render('a ~~x~~ b'), '<p>a <del>x</del> b</p>\n');
});

test('下标：~~~ 三波浪按实测保持围栏/字面（不产生 <sub>）', () => {
  // 独立成行时命中 block fences：开围栏 ~~~，语言 x~~~，无闭合行 → 空内容代码块。
  assert.equal(render('~~~x~~~'), '<pre><code class="language-x~~~">\n</code></pre>\n');
  // 行内时 fences 不触发，del 也不匹配（LDelim 前瞻 [^\s~] 被第三个 ~ 挡住）→ 字面。
  assert.equal(render('a ~~~x~~~ b'), '<p>a ~~~x~~~ b</p>\n');
});

test('下标：负例保持字面（无闭合/空白内容/不平衡双波浪）', () => {
  assert.equal(render('x~y'), '<p>x~y</p>\n');
  assert.equal(render('~ x~'), '<p>~ x~</p>\n');
  assert.equal(render('~x ~'), '<p>~x ~</p>\n');
  // start() 不得截断双波浪：~~x~ 不平衡时整串字面，不得拆出 <sub>。
  assert.equal(render('a ~~x~ b'), '<p>a ~~x~ b</p>\n');
});

test('下标：内容含空白时 sub 不匹配，回退给 del（与无扩展基线一致）', () => {
  // 实测：~a b~ 的 sub 内容含空格被拒，marked del 规则允许内容含空格 → <del>a b</del>。
  assert.equal(render('~a b~'), '<p><del>a b</del></p>\n');
});

// ===== 高亮 ==x== =====

test('高亮：==x== → <mark>x</mark>，内容可为多字符', () => {
  assert.equal(render('==x=='), '<p><mark>x</mark></p>\n');
  assert.equal(render('a ==重点内容== b'), '<p>a <mark>重点内容</mark> b</p>\n');
});

test('高亮：内容再经行内解析（childTokens），==**粗**== → <mark><strong>粗</strong></mark>', () => {
  assert.equal(render('==**粗**=='), '<p><mark><strong>粗</strong></mark></p>\n');
});

test('高亮：单等号 =x= 不动；==== 空内容不匹配；跨行不匹配', () => {
  assert.equal(render('a =x= b'), '<p>a =x= b</p>\n');
  assert.equal(render('===='), '<p>====</p>\n');
  // 跨行：内容含 \n 被拒（breaks:true 下 \n 渲染为 <br>）。
  assert.equal(render('==a\nb=='), '<p>==a<br>b==</p>\n');
});

// ===== emoji :word: =====

// 冻结映射表逐项断言（映射表即模块内 EMOJI_MAP，逐项验证防缺漏）。
const EMOJI_CASES: Array<[string, string]> = [
  ['smile', '\u{1F604}'],
  ['heart', '\u2764\uFE0F'],
  ['+1', '\u{1F44D}'],
  ['-1', '\u{1F44E}'],
  ['thumbsup', '\u{1F44D}'],
  ['tada', '\u{1F389}'],
  ['fire', '\u{1F525}'],
  ['rocket', '\u{1F680}'],
  ['warning', '\u26A0\uFE0F'],
  ['checkered_flag', '\u{1F3C1}'],
  ['clap', '\u{1F44F}'],
  ['thinking', '\u{1F914}'],
  ['pray', '\u{1F64F}'],
  ['ok_hand', '\u{1F44C}']
];

test('emoji：映射表逐项 :name: → 对应字符（含 +1/-1 数字短代码）', () => {
  for (const [name, char] of EMOJI_CASES) {
    assert.equal(render(`a :${name}: b`), `<p>a ${char} b</p>\n`, `:${name}: 应替换为 ${char}`);
  }
});

test('emoji：前后需空白/标点——a:smile:b、a:smile: b、2:smile:、:smile:2 均不转', () => {
  assert.equal(render('a:smile:b'), '<p>a:smile:b</p>\n');
  assert.equal(render('a:smile: b'), '<p>a:smile: b</p>\n');
  assert.equal(render('2:smile:'), '<p>2:smile:</p>\n');
  assert.equal(render(':smile:2'), '<p>:smile:2</p>\n');
});

test('emoji：标点前界可触发——(x):smile: y 与句末 :smile:。', () => {
  assert.equal(render('(x):smile: y'), '<p>(x)\u{1F604} y</p>\n');
  assert.equal(render('a :smile:。'), `<p>a \u{1F604}。</p>\n`);
});

test('emoji：::before 不转（无闭合冒号）；https:// 不转（内容 // 不在短代码字符集）', () => {
  assert.equal(render('a::before'), '<p>a::before</p>\n');
  assert.equal(render('https://x.com'), '<p><a href="https://x.com">https://x.com</a></p>\n');
});

test('emoji：未知短代码 :nope: 原样保留', () => {
  assert.equal(render('a :nope: b'), '<p>a :nope: b</p>\n');
});

test('emoji：中文语境——中文:smile: 不转（汉字非空白/标点），中文 :smile: 转', () => {
  assert.equal(render('中文:smile:好'), '<p>中文:smile:好</p>\n');
  assert.equal(render('中文 :smile: 好'), '<p>中文 \u{1F604} 好</p>\n');
});

test('emoji：\\:smile: 转义后不转（escape token 后拒绝，与无扩展基线一致）', () => {
  assert.equal(render('\\:smile: x'), '<p>:smile: x</p>\n');
});

// ===== 互斥交互（以实测为准） =====

test('互斥：$x^2$ 内 ^ 不吞（math 在前注册，公式整体消费为 KaTeX）', () => {
  // 注册序与 editorEntry 一致：math 在前。math 落地后 $x^2$ 由 math tokenizer
  // 整体消费为 KaTeX（annotation 保留 x^2），^ 不再可见；本扩展不得在公式内
  // 产出 <sup>。此断言为 math 实现落地后的实测修正（原 stub 期断言字面）。
  const html = render('公式 $x^2$ 文字', [mathExtension, inlineSyntaxExtension]);
  assert.ok(html.includes('<p>公式 <span class="katex">'), '公式整体消费为 KaTeX');
  assert.ok(html.includes('<annotation encoding="application/x-tex">x^2</annotation>'));
  assert.ok(!html.includes('<sup>'), '^ 归数学，不得在公式内产出 <sup>');
});

test('互斥：==$x$== 高亮内含公式（mark 内 childTokens 命中 KaTeX）', () => {
  // 实测机制：== 处 math tokenizer 不匹配（$ 锚定）→ mark tokenizer 先拿到整段；
  // 内容 $x$ 作为 childTokens 再经行内解析——math 落地后在 mark 内命中 KaTeX。
  // 此断言为 math 实现落地后的实测修正（原 stub 期断言 <mark>$x$</mark>）。
  const html = render('==$x$==', [mathExtension, inlineSyntaxExtension]);
  assert.ok(html.includes('<mark><span class="katex">'), 'mark 内命中 KaTeX');
  assert.ok(html.includes('<annotation encoding="application/x-tex">x</annotation>'));
});

test('互斥：表格单元格内可用（mark/sup/sub/emoji）', () => {
  const src = '| ==cell== | x^2^ |\n| --- | --- |\n| a~b~ | :smile: |';
  assert.equal(
    render(src),
    '<table>\n<thead>\n<tr>\n<th><mark>cell</mark></th>\n<th>x<sup>2</sup></th>\n</tr>\n</thead>\n<tbody><tr>\n<td>a<sub>b</sub></td>\n<td>\u{1F604}</td>\n</tr>\n</tbody></table>\n'
  );
});

test('互斥：平衡代码 span 内不转（四个定界符均保持 <code> 原文）', () => {
  assert.equal(render('`==x==`'), '<p><code>==x==</code></p>\n');
  assert.equal(render('`~x~`'), '<p><code>~x~</code></p>\n');
  assert.equal(render('`^2^`'), '<p><code>^2^</code></p>\n');
  assert.equal(render('`:smile:`'), '<p><code>:smile:</code></p>\n');
  // 代码 span 内含定界符（== 在 span 中部）：span 仍原子消费，不截断。
  assert.equal(render('a`code==x==` b'), '<p>a<code>code==x==</code> b</p>\n');
});

test('互斥：未闭合反引号串后不转（codeRunBefore 拦截，保持字面/基线行为）', () => {
  // 未闭合 ` 按 GFM 为字面文本；mark/sup/emoji 不得在其中转换。
  assert.equal(render('a`code ==x== b'), '<p>a`code ==x== b</p>\n');
  assert.equal(render('a`code ^2^ b'), '<p>a`code ^2^ b</p>\n');
  assert.equal(render('a`code :smile: b'), '<p>a`code :smile: b</p>\n');
  // 平衡代码 span 之后可正常转换。
  assert.equal(render('a`code` :smile: b'), '<p>a<code>code</code> \u{1F604} b</p>\n');
});

// ===== 混合与状态隔离 =====

test('混合文本：四种语法 + del 共存', () => {
  assert.equal(
    render('x^2^ 与 H~2~O，==重点==，:smile: 与 ~~删~~'),
    '<p>x<sup>2</sup> 与 H<sub>2</sub>O，<mark>重点</mark>，\u{1F604} 与 <del>删</del></p>\n'
  );
});

test('状态隔离：连续两次渲染输出逐字节一致（无模块级可变状态）', () => {
  const src = 'a ~b~ c :smile: ==d== ^e^';
  const a = render(src);
  const b = render(src);
  assert.equal(a, b);
  assert.equal(a, '<p>a <sub>b</sub> c \u{1F604} <mark>d</mark> <sup>e</sup></p>\n');
});
