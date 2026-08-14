// S0.1 Markdown 扩展行为刻画 spike（characterization tests，只读实证、不做实现）。
// 目的：在实现 M1 扩展（数学 / [TOC] / Front Matter / 上标下标高亮 / 表格操作）之前，
// 把 marked@18.0.5 的「无扩展基线行为」固化为断言，供后续实现与 P4 表格操作引用。
// 全部应为绿；断言的是实测行为，与最初「预期」不符处以实测为准并在注释中写明结论。
//
// 与最初预期的三处不符（详见各测试注释）：
//   1) 事实 2：单波浪 ~x~ 也被 marked 渲染为 <del>（预期保持字面）。
//   2) 事实 3：引用 > [TOC] 递归时 this.lexer.state.top 实测为 true（预期 false）。
//   3) 事实 4：Front Matter 渲染为 <hr> + setext <h2>（预期 hr + 段落）。
//
// 隔离约定：每个测试各自 `new Marked()`，绝不使用 marked.use 全局注册，
// 避免污染其他测试文件（参考 markdownBaseline.test.ts 的 isolated 模式）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';

// ===== 事实 1：数学语法（无扩展）=====

test('数学定界符无扩展时全部为字面文本（$、$$、\\(、\\[ 均不渲染）', () => {
  const m = new Marked();
  assert.equal(m.parse('$x$'), '<p>$x$</p>\n');
  assert.equal(m.parse('$$x$$'), '<p>$$x$$</p>\n');
  // 实测：\( 与 \[ 的反斜杠被 marked 的 escape 规则消耗，输出 (x) / [x]，
  // 并非原样保留 \(x\)（escape 可转义字符集含 ( [，见 rules.inline.escape）。
  assert.equal(m.parse('\\(x\\)'), '<p>(x)</p>\n');
  assert.equal(m.parse('\\[x\\]'), '<p>[x]</p>\n');
});

test('\\$ 转义为字面 $（反斜杠被消耗，无公式渲染）', () => {
  const m = new Marked();
  assert.equal(m.parse('价格 \\$5'), '<p>价格 $5</p>\n');
});

test('代码围栏内的 $x^2$ 原样为代码文本', () => {
  const m = new Marked();
  assert.equal(m.parse('```\n$x^2$\n```'), '<pre><code>$x^2$\n</code></pre>\n');
});

// ===== 事实 2：删除线 / 上标 / 下标 / 高亮 =====

test('~~x~~ 渲染为 <del>；单波浪 ~x~ 也被 marked 渲染为 <del>（实测，非 GFM 规范）', () => {
  const m = new Marked();
  assert.equal(m.parse('a ~~b~~ c'), '<p>a <del>b</del> c</p>\n');
  // 实测与最初预期「~x~ 保持字面」不符：marked@18 的 del 规则接受 1~2 个波浪号，
  // 单波浪 ~b~ 同样渲染 <del>。实现下标扩展时必须以带 start() 的 inline 扩展抢先拦截 ~x~。
  assert.equal(m.parse('a ~b~ c'), '<p>a <del>b</del> c</p>\n');
  // 波浪号后紧跟空白时不触发（del 规则要求 (?=\S) 前瞻）。
  assert.equal(m.parse('~ b ~'), '<p>~ b ~</p>\n');
});

test('==高亮== 与 ^上标^ 无扩展时为字面文本', () => {
  const m = new Marked();
  assert.equal(m.parse('==x=='), '<p>==x==</p>\n');
  assert.equal(m.parse('x^2^'), '<p>x^2^</p>\n');
});

// ===== 事实 3：[TOC] 与 lexer.state.top 探针 =====

test('[TOC] 无扩展时渲染为段落文本', () => {
  const m = new Marked();
  assert.equal(m.parse('[TOC]'), '<p>[TOC]</p>\n');
});

test('block 扩展 tokenizer 内 this.lexer.state.top：顶层/引用为 true，仅列表项内为 false（实证）', () => {
  const iso = new Marked();
  iso.use({
    extensions: [{
      name: 'tocTopProbe',
      level: 'block',
      start(src: string) {
        return src.startsWith('[TOC]') ? 0 : undefined;
      },
      tokenizer(src: string) {
        // 注意：marked 在每个 blockTokens 迭代都会调用扩展 tokenizer，
        // 必须用 src.startsWith 守卫，否则会在同一位置重复触发。
        if (!src.startsWith('[TOC]')) return undefined;
        return { type: 'tocTopProbe', raw: '[TOC]', top: this.lexer.state.top };
      },
      renderer(token: { top: boolean }) {
        return `<probe-top:${token.top}>`;
      }
    }]
  });
  // 顶层：[TOC] 直接命中，state.top === true。
  assert.equal(iso.parse('[TOC]'), '<probe-top:true>');
  // 列表项内：list tokenizer 对每个 item 显式置 state.top = false 后递归，实测 false。
  assert.equal(iso.parse('- [TOC]'), '<ul>\n<li><probe-top:false></li>\n</ul>\n');
  // 引用内：实测为 true，与最初预期「引用内递归时为 false」不符。
  // 原因：marked@18 blockquote tokenizer 先保存 state.top，强制置 true 后再
  // blockTokens(内容)（为让引用内段落/setext 标题正常解析），递归结束才恢复。
  // 因此 state.top === false 只等价于「正处在列表项递归内」，不能用来识别引用上下文。
  assert.equal(iso.parse('> [TOC]'), '<blockquote>\n<probe-top:true></blockquote>\n');
  // 组合嵌套（同一机制）：引用>列表 → 列表项内 false；列表>引用 → 引用内 true。
  assert.equal(iso.parse('> - [TOC]'), '<blockquote>\n<ul>\n<li><probe-top:false></li>\n</ul>\n</blockquote>\n');
  assert.equal(iso.parse('- > [TOC]'), '<ul>\n<li><blockquote>\n<probe-top:true></blockquote>\n</li>\n</ul>\n');
});

// ===== 事实 4：Front Matter =====

test('纯 --- 单行是 <hr>', () => {
  const m = new Marked();
  assert.equal(m.parse('---'), '<hr>\n');
});

test('Front Matter ---\\ntitle: x\\n--- 无扩展时为 <hr> + setext <h2>（实测，非 hr+段落）', () => {
  const m = new Marked();
  // 实测与最初预期「hr + 段落」不符：第一个 --- 被 hr tokenizer 消费后，
  // 剩余 'title: x\n---' 命中 lheading（setext 二级标题，lheading 先于 paragraph 检查），
  // 因此 token 序列为 [hr, heading(depth=2)]。
  assert.equal(m.parse('---\ntitle: x\n---'), '<hr>\n<h2>title: x</h2>\n');
  const tokens = m.lexer('---\ntitle: x\n---') as unknown as Array<{ type: string; depth?: number }>;
  assert.equal(tokens.map((t) => t.type).join(','), 'hr,heading');
  assert.equal(tokens[1].depth, 2);
  // 后接正文时正文仍正常成段/标题。
  assert.equal(m.parse('---\ntitle: x\n---\n\n# H'), '<hr>\n<h2>title: x</h2>\n<h1>H</h1>\n');
});

// ===== 事实 5：任务列表 raw 偏移 =====

test('任务列表：list/item/checkbox 的 raw 与源码逐字符对应（累积偏移断言）', () => {
  const m = new Marked();
  const src = '- [x] a\n- [ ] b';
  const tokens = m.lexer(src);
  const list = tokens.find((t) => t.type === 'list') as unknown as {
    raw: string;
    items: Array<{
      raw: string;
      text: string;
      task: boolean;
      checked?: boolean;
      tokens: Array<{ type: string; raw: string; checked?: boolean }>;
    }>;
  };
  assert.ok(list, '应产出 list token');
  // list.raw 与源码完全一致（逐字符对应）。
  assert.equal(list.raw, src);
  assert.equal(list.items.length, 2);
  // item.raw 是源码的连续切片：item0 保留尾部换行（8 字符），item1 从偏移 8 开始。
  assert.equal(list.items[0].raw, src.slice(0, 8)); // '- [x] a\n'
  assert.equal(list.items[1].raw, src.slice(8)); // '- [ ] b'
  // 累积偏移：item0 之后的位置正好是 item1 的起点。
  assert.equal(list.items[1].raw, src.slice(list.items[0].raw.length));
  assert.equal(list.items[0].raw + list.items[1].raw, src);
  // 任务标记从 text 剥离，但保留在 raw 与 checkbox token 中。
  assert.equal(list.items[0].text, 'a');
  assert.equal(list.items[1].text, 'b');
  assert.equal(list.items[0].task, true);
  assert.equal(list.items[0].checked, true);
  assert.equal(list.items[1].task, true);
  assert.equal(list.items[1].checked, false);
  // checkbox token raw = 标记 + 尾随空格，且正好是源码中 [x] 的原始区间 src.slice(2,6)。
  assert.equal(list.items[0].tokens[0].type, 'checkbox');
  assert.equal(list.items[0].tokens[0].raw, src.slice(2, 6)); // '[x] '
  assert.equal(list.items[0].tokens[0].checked, true);
  assert.equal(list.items[1].tokens[0].raw, src.slice(10, 14)); // '[ ] '
  assert.equal(list.items[1].tokens[0].checked, false);
});

test('嵌套任务列表：item.raw 保留 [x]/[ ]，内层列表 raw 与源码偏移对应', () => {
  const m = new Marked();
  const src = '- [x] a\n  - [ ] b';
  const list = m.lexer(src).find((t) => t.type === 'list') as unknown as {
    raw: string;
    items: Array<{ raw: string; task: boolean; tokens: Array<{ type: string } & Record<string, unknown>> }>;
  };
  assert.equal(list.raw, src);
  // 外层 item.raw 完整保留 '[x]' 与内层 '[ ] b'（含 2 空格缩进）。
  assert.equal(list.items[0].raw, src);
  assert.equal(list.items[0].task, true);
  assert.deepEqual(
    list.items[0].tokens.map((t) => t.type),
    ['checkbox', 'text', 'list']
  );
  // 内层列表：raw 是去缩进后的 item 文本（偏移 8 的 2 空格 + 从 10 开始的 '- [ ] b'）。
  const inner = list.items[0].tokens.find((t) => t.type === 'list') as unknown as {
    raw: string;
    items: Array<{ raw: string; task: boolean; checked?: boolean }>;
  };
  assert.ok(inner, '应有内层 list token');
  assert.equal(inner.raw, src.slice(8 + 2)); // '- [ ] b'
  assert.equal(inner.items[0].raw, src.slice(10)); // 内层 item.raw 保留 '[ ]'
  assert.equal(inner.items[0].task, true);
  assert.equal(inner.items[0].checked, false);
  assert.equal(
    m.parse(src),
    '<ul>\n<li><input checked="" disabled="" type="checkbox"> a<ul>\n<li><input disabled="" type="checkbox"> b</li>\n</ul>\n</li>\n</ul>\n'
  );
});

// ===== 事实 6：表格 token 与管道切分 =====

test('表格 token：header/rows/align/raw 结构与源码逐字符对应', () => {
  const m = new Marked();
  const src = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  const tokens = m.lexer(src);
  const table = tokens.find((t) => t.type === 'table') as unknown as {
    raw: string;
    align: Array<string | null>;
    header: Array<{ text: string; header: boolean }>;
    rows: Array<Array<{ text: string; header: boolean }>>;
  };
  assert.equal(tokens.length, 1);
  assert.equal(table.raw, src);
  assert.deepEqual(table.align, [null, null]);
  assert.deepEqual(
    table.header.map((h) => [h.text, h.header]),
    [['a', true], ['b', true]]
  );
  assert.deepEqual(
    table.rows.map((r) => r.map((c) => [c.text, c.header])),
    [[['1', false], ['2', false]]]
  );
  assert.equal(
    m.parse(src),
    '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>\n'
  );
});

test('转义管道 \\|：token.raw 保留 \\|，单元格文本还原为字面 |', () => {
  const m = new Marked();
  const src = '| a \\| b | c |\n| --- | --- |\n| 1 | 2 |';
  const table = m.lexer(src).find((t) => t.type === 'table') as unknown as {
    raw: string;
    header: Array<{ text: string }>;
    rows: Array<Array<{ text: string }>>;
  };
  assert.ok(table, '转义管道不应破坏表格');
  assert.ok(table.raw.includes('\\|'), 'token.raw 应保留转义管道 \\|（源码逐字符）');
  assert.deepEqual(
    table.header.map((h) => h.text),
    ['a | b', 'c']
  );
  assert.deepEqual(
    table.rows.map((r) => r.map((c) => c.text)),
    [['1', '2']]
  );
  assert.match(m.parse(src), /<th>a \| b<\/th>/);
});

test('代码 span 内管道（表头行）：整表退化为段落，不产出 table token（P4 输入事实）', () => {
  const m = new Marked();
  const src = '| `a|b` | c |\n| --- | --- |\n| 1 | 2 |';
  const tokens = m.lexer(src);
  // 实测：marked 的单元格切分只认反斜杠转义（_splitCells），`a|b` 内的管道被当作
  // 分隔符，表头行被切成 5 个单元格 ≠ 分隔行 2 个 → 表格 tokenizer 放弃（count 不等），
  // 整段回退为单个 paragraph token。
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'paragraph');
  assert.equal(tokens[0].raw, src);
  assert.equal(m.parse(src), '<p>| <code>a|b</code> | c |\n| --- | --- |\n| 1 | 2 |</p>\n');
});

test('代码 span 内管道（数据行）：表格仍形成，但单元格在管道处被静默切分（P4 输入事实）', () => {
  const m = new Marked();
  const src = '| a | b |\n| --- | --- |\n| `1|2` | 3 |';
  const table = m.lexer(src).find((t) => t.type === 'table') as unknown as {
    rows: Array<Array<{ text: string }>>;
  };
  assert.ok(table, '数据行内的管道不阻止表格形成');
  // 数据行同样按未转义管道切分：'`1|2`' 被切成 '`1' 与 '2`'，且超出表头列数的
  // 第 3 个单元格 '3' 被静默丢弃（_splitCells 按 header 列数 splice）。
  assert.deepEqual(
    table.rows.map((r) => r.map((c) => c.text)),
    [['`1', '2`']]
  );
  assert.equal(
    m.parse(src),
    '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>`1</td>\n<td>2`</td>\n</tr>\n</tbody></table>\n'
  );
});

test('代码 span 无管道时表格正常（对照：破坏切分的只有未转义管道本身）', () => {
  const m = new Marked();
  const src = '| `a` | c |\n| --- | --- |\n| 1 | 2 |';
  const table = m.lexer(src).find((t) => t.type === 'table') as unknown as {
    header: Array<{ text: string }>;
  };
  assert.ok(table);
  assert.deepEqual(
    table.header.map((h) => h.text),
    ['`a`', 'c']
  );
  assert.match(m.parse(src), /<th><code>a<\/code><\/th>/);
});

// ===== 事实 7：emoji =====

test(':smile: 无扩展时为字面文本', () => {
  const m = new Marked();
  assert.equal(m.parse(':smile:'), '<p>:smile:</p>\n');
});
