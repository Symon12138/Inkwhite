// M1-6：任务列表扩展（禁用态 renderer 基础）的单元测试（node:test，零依赖）。
// 被测模块：src/editor/markdownExtensions/taskExtension.ts。
//
// 覆盖（M1 交付物）：
//   1. 任务项 <li> 加 task-list-item 类，checkbox 为禁用态并带 data-task-idx 稳定序号；
//   2. 嵌套列表序号按深度优先 token 序递增；
//   3. ctx.taskCounts 计数（checked/unchecked，[X] 大写按实测计 checked）；
//   4. fenced code 内 - [x] 不渲染 checkbox、不计数（负例）；
//   5. 普通列表无 task-list-item 类，且与默认 marked 输出逐字节一致（等价性回归）；
//   6. 有序任务 1. [x] 同样处理；
//   7. 松散任务项段落结构保持默认，仅加类与序号；
//   8. 两次渲染一致：data-task-idx 重置、tokens 深等（无模块级可变状态）。
//
// 隔离约定（同 markdownExtensionRegistry.test.ts）：每个测试先
// resetMarkdownExtensionRegistry + setMarkedTarget(new Marked(...)) 再
// registerMarkdownExtensions(taskExtension)，不污染其他测试。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import {
  createParseContext,
  registerMarkdownExtensions,
  renderMarkdown,
  resetMarkdownExtensionRegistry,
  setMarkedTarget,
  transformTokens,
  RENDER_MARKDOWN_OPTIONS,
  type MarkedTarget
} from '../../src/editor/markdownExtensions/markdownExtensionRegistry.ts';
import { taskExtension } from '../../src/editor/markdownExtensions/taskExtension.ts';

/** 每个测试的独立渲染管线：新 Marked 实例 + 只注册任务扩展。 */
function freshPipeline(): Marked {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions(taskExtension);
  return m;
}

// ===== 1. 结构：类名 / disabled / data-task-idx 序号 =====

test('任务项：li 带 task-list-item 类，checkbox 可交互且 data-task-idx 按 token 序', () => {
  freshPipeline();
  const { html } = renderMarkdown('- [x] done\n- [ ] todo');
  assert.ok(
    html.includes('<li class="task-list-item"><input type="checkbox" checked="" data-task-idx="0"> done</li>'),
    '已勾选项：类 + checked + 可交互 + idx=0，与默认结构仅差类/属性'
  );
  assert.ok(
    html.includes('<li class="task-list-item"><input type="checkbox" data-task-idx="1"> todo</li>'),
    '未勾选项：类 + 可交互 + idx=1'
  );
  assert.ok(
    html.indexOf('data-task-idx="0"') < html.indexOf('data-task-idx="1"'),
    '序号按 token 序递增出现'
  );
});

test('嵌套列表：序号按深度优先 token 序分配（外 0 → 内 1 → 外 2）', () => {
  freshPipeline();
  const { html } = renderMarkdown('- [x] a\n  - [ ] b\n- [x] c');
  const idx0 = html.indexOf('data-task-idx="0"');
  const idx1 = html.indexOf('data-task-idx="1"');
  const idx2 = html.indexOf('data-task-idx="2"');
  assert.ok(idx0 >= 0 && idx1 >= 0 && idx2 >= 0, '三个任务项都应有序号');
  assert.ok(idx0 < idx1 && idx1 < idx2, '深度优先序：a(0) < b(1) < c(2)');
  assert.equal((html.match(/task-list-item/g) ?? []).length, 3, '嵌套任务项全部加类');
});

test('松散任务项：段落结构保持默认，仅加类与序号', () => {
  freshPipeline();
  const { html } = renderMarkdown('- [x] a\n\n  cont');
  assert.ok(
    html.includes(
      '<li class="task-list-item"><input type="checkbox" checked="" data-task-idx="0"> <p>a</p>\n<p>cont</p>\n</li>'
    ),
    '松散项 = 类 + 可交互 checkbox + 默认段落结构'
  );
});

// ===== 2. taskCounts 计数（transformTokens 直测） =====

test('taskCounts：checked/unchecked 计数，大写 [X] 按实测计 checked', () => {
  const m = freshPipeline();
  const src = '- [x] a\n- [ ] b\n- [X] c';
  const ctx = createParseContext();
  transformTokens(m.lexer(src), ctx);
  assert.deepEqual(ctx.taskCounts, { checked: 2, unchecked: 1 }, '[X] 大写与 [x] 同为 checked');
});

test('taskCounts：嵌套列表与引内任务都计数', () => {
  const m = freshPipeline();
  const ctx = createParseContext();
  transformTokens(m.lexer('- [x] a\n  - [ ] b\n\n> - [x] q'), ctx);
  assert.deepEqual(ctx.taskCounts, { checked: 2, unchecked: 1 });
});

test('计数不消费：item.raw 仍保留 [x]（M4 交互偏移基础）', () => {
  const m = freshPipeline();
  const ctx = createParseContext();
  const tokens = m.lexer('- [x] done\n- [ ] todo');
  transformTokens(tokens, ctx);
  const list = tokens.find((t) => t.type === 'list') as { items: Array<{ raw: string }> };
  assert.match(list.items[0].raw, /\[x\]/);
  assert.match(list.items[1].raw, /\[ \]/);
});

// ===== 3. 负例与普通列表 =====

test('fenced code 内的 - [x] 不渲染 checkbox、不计数', () => {
  freshPipeline();
  const src = '```\n- [x] not a task\n```';
  const { html } = renderMarkdown(src);
  assert.doesNotMatch(html, /<input/, '代码块内不得产出 checkbox');
  assert.doesNotMatch(html, /task-list-item/, '代码块内不得加任务类');
  const ctx = createParseContext();
  transformTokens(new Marked(RENDER_MARKDOWN_OPTIONS).lexer(src), ctx);
  assert.deepEqual(ctx.taskCounts, { checked: 0, unchecked: 0 }, '代码块内容不参与计数');
});

test('普通列表无 task-list-item 类，且与默认 marked 输出逐字节一致', () => {
  const pristine = new Marked(RENDER_MARKDOWN_OPTIONS);
  freshPipeline();
  const src = [
    '- a',
    '- b',
    '',
    '1. x',
    '2. y',
    '',
    '3. p',
    '4. q',
    '',
    '- loose a',
    '',
    '- loose b',
    '',
    '- n',
    '  - n1',
    '    - n2',
    '- m',
    '  1. m1',
    '',
    '> quote',
    '> - q1'
  ].join('\n');
  const { html } = renderMarkdown(src);
  assert.doesNotMatch(html, /task-list-item/, '普通列表不得加类');
  assert.equal(html, pristine.parse(src), '普通列表（ul/ol/start≠1/松散/嵌套/引内）与默认渲染逐字节一致');
});

// ===== 4. 有序任务 =====

test('有序任务 1. [x] 同样处理（ol + 类 + 序号）', () => {
  freshPipeline();
  const { html } = renderMarkdown('1. [x] 有序完成\n2. [ ] 有序待办');
  assert.ok(
    html.includes('<ol>\n<li class="task-list-item"><input type="checkbox" checked="" data-task-idx="0"> 有序完成</li>\n<li class="task-list-item"><input type="checkbox" data-task-idx="1"> 有序待办</li>\n</ol>\n'),
    '有序任务输出结构'
  );
});

// ===== 5. 状态隔离 =====

test('两次渲染一致：data-task-idx 从 0 重置，html 与 tokens 均逐字节一致', () => {
  freshPipeline();
  const src = '- [x] a\n- [ ] b\n- [x] c';
  const first = renderMarkdown(src);
  const second = renderMarkdown(src);
  assert.equal(first.html, second.html, '两次渲染 html 逐字节一致');
  assert.ok(first.html.includes('data-task-idx="0"'), '第二次渲染序号仍从 0 开始（无模块级残留）');
  assert.deepEqual(first.tokens, second.tokens, '两次渲染 tokens 深等（含 taskIndex 重置）');
});

