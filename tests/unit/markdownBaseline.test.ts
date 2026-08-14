// S0.1 Markdown 基线刻画测试（characterization tests）。
// 目的：把方案依赖的「当前 marked/DOMPurify 实际行为」固化为断言，
// 防止依赖升级或后续改动时静默偏离基线。全部应为绿。
// M1 各扩展的功能红测在对应功能实现前编写（红 → 绿 → 重构）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marked, Marked } from 'marked';

// ===== 任务列表（P8 定位基础）=====

test('任务列表 token 保留 task/checked 标志，且 item.raw 保留 [x]', () => {
  const tokens = marked.lexer('- [x] done\n- [ ] todo');
  const list = tokens.find((t) => t.type === 'list') as { items: Array<{ task: boolean; checked?: boolean; raw: string }> };
  assert.ok(list, '应产出 list token');
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].task, true);
  assert.equal(list.items[0].checked, true);
  assert.equal(list.items[1].task, true);
  assert.equal(list.items[1].checked, false);
  assert.match(list.items[0].raw, /\[x\]/);
  assert.match(list.items[1].raw, /\[ \]/);
});

test('marked 默认任务列表渲染为 disabled checkbox 且无 task-list-item class', () => {
  const html = marked.parse('- [x] done');
  assert.match(html, /disabled/);
  assert.doesNotMatch(html, /task-list-item/);
});

// ===== inline 扩展 start() 必要性（S0.1 关键实证）=====

test('inline 扩展缺 start() 时句中不触发，补 start() 后触发', () => {
  // 用独立 Marked 实例，避免全局 marked.use 累积污染其他基线断言。
  const isolated = new Marked();
  const noStartName = 'spikeNoStart' + Math.random().toString(36).slice(2);
  isolated.use({
    extensions: [{
      name: noStartName,
      level: 'inline',
      tokenizer(src: string) {
        const m = /^\$([^$\n]+)\$/.exec(src);
        if (m) return { type: noStartName, raw: m[0], text: m[1] };
        return undefined;
      },
      renderer(token: { text: string }) {
        return '<spike-no-start>' + token.text + '</spike-no-start>';
      }
    }]
  });
  const htmlNoStart = isolated.parse('a $x$ b');
  assert.doesNotMatch(htmlNoStart, /spike-no-start/, '缺 start() 时句中 $x$ 不应触发扩展');

  const withStartName = 'spikeWithStart' + Math.random().toString(36).slice(2);
  isolated.use({
    extensions: [{
      name: withStartName,
      level: 'inline',
      start(src: string) {
        const index = src.indexOf('$');
        return index < 0 ? undefined : index;
      },
      tokenizer(src: string) {
        const m = /^\$([^$\n]+)\$/.exec(src);
        if (m) return { type: withStartName, raw: m[0], text: m[1] };
        return undefined;
      },
      renderer(token: { text: string }) {
        return '<spike-with-start>' + token.text + '</spike-with-start>';
      }
    }]
  });
  const htmlWithStart = isolated.parse('a $x$ b');
  assert.match(htmlWithStart, /spike-with-start/, '有 start() 时句中 $x$ 应触发扩展');
});

// ===== 数学 / 转义基线（B02）=====

test('\\$ 转义渲染为字面 $，未实现公式前 $x$ 保持字面', () => {
  const html = marked.parse('价格 \\$5 与 $x$');
  assert.match(html, /价格 \$5/);
  assert.ok(html.includes('$x$'), '无公式扩展时应保持字面文本');
  assert.doesNotMatch(html, /katex/i);
});

// ===== 脚注基线（B03）=====

test('脚注语法当前被 marked 劫持为引用链接（M1 扩展必须同时拦截 def 与 reflink）', () => {
  const html = marked.parse('文[^1]\n\n[^1]: 注释');
  // 现状：`[^1]: 注释` 被当作链接定义，`[^1]` 变成指向"注释"的引用链接（百分号编码）。
  assert.match(html, /<a href="%E6%B3%A8%E9%87%8A">\^1<\/a>/);
});

test('[^id](url) 渲染为普通链接，链接文本为 ^id（脚注扩展不得与其冲突）', () => {
  const html = marked.parse('[^1](https://example.com)');
  assert.match(html, /<a href="https:\/\/example\.com">\^1<\/a>/);
});

test('未定义的 [^1] 保持字面文本（无定义时不触发引用链接）', () => {
  const html = marked.parse('x[^1] y');
  assert.ok(html.includes('x[^1] y'));
});

test('自定义 inline/block 扩展带 start() 时优先于内置 reflink/def（S0.1 实证）', () => {
  const isolated = new Marked();
  const inlineName = 'fnProbe' + Math.random().toString(36).slice(2);
  isolated.use({
    extensions: [{
      name: inlineName,
      level: 'inline',
      start(src: string) {
        const index = src.indexOf('[^');
        return index < 0 ? undefined : index;
      },
      tokenizer(src: string) {
        const m = /^\[\^([^\]]+)\]/.exec(src);
        if (m) return { type: inlineName, raw: m[0], id: m[1] };
        return undefined;
      },
      renderer(token: { id: string }) {
        return '<fn>' + token.id + '</fn>';
      }
    }]
  });
  // 有定义时：自定义 inline 扩展赢过 reflink（否则会渲染成指向 def 的链接）
  assert.match(isolated.parse('use[^a]\n\n[^a]: def'), /<fn>a<\/fn>/);

  const blockName = 'fnBlockProbe' + Math.random().toString(36).slice(2);
  isolated.use({
    extensions: [{
      name: blockName,
      level: 'block',
      start(src: string) {
        return src.startsWith('[^') ? 0 : undefined;
      },
      tokenizer(src: string) {
        const m = /^\[\^([^\]]+)\]:\s*(.*)\n?/.exec(src);
        if (m) return { type: blockName, raw: m[0], id: m[1], body: m[2] };
        return undefined;
      },
      renderer(token: { id: string; body: string }) {
        return '<fn-def>' + token.id + ':' + token.body + '</fn-def>\n';
      }
    }]
  });
  // 定义行：自定义 block 扩展赢过内置 def tokenizer
  assert.match(isolated.parse('[^a]: def\n\nuse[^a]'), /<fn-def>a:def<\/fn-def>/);
});

// ===== [TOC] / Front Matter 基线（B05/B06）=====

test('[TOC] 当前渲染为段落文本（M1 需 block 扩展识别）', () => {
  const html = marked.parse('[TOC]\n\n# A');
  assert.match(html, /<p>\[TOC\]<\/p>/);
  assert.ok(html.includes('<h1>A</h1>'));
});

test('Front Matter 当前按 hr + 段落渲染（M1 需 block 扩展识别）', () => {
  const html = marked.parse('---\ntitle: x\n---\n\n# H');
  assert.match(html, /<hr>/);
  assert.ok(html.includes('<h1>H</h1>'));
});

// ===== 上标 / 高亮 / 删除线基线（B04）=====

test('上标/高亮语法当前为字面文本（M1 需 inline 扩展）', () => {
  const html = marked.parse('x^2^ 与 ==高亮==');
  assert.ok(html.includes('x^2^'));
  assert.ok(html.includes('==高亮=='));
});

test('~~删除线~~ 由 GFM 渲染为 del（下标扩展不得误吞 ~~）', () => {
  const html = marked.parse('a ~~b~~ c');
  assert.match(html, /<del>b<\/del>/);
});

// ===== DOMPurify 基线 =====
// 注：Node 无 DOM，DOMPurify 默认导出为工厂函数（DOMPurify.sanitize 不可用），
// 因此净化行为断言放在 tests/e2e/security.spec.ts（浏览器层）钉死。
