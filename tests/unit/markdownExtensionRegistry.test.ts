// M1-1：Markdown 扩展注册机制 + 单管线渲染入口的单元测试（node:test，零依赖）。
// 被测模块：src/editor/markdownExtensions/（markdownExtensionRegistry.ts 与 slugify.ts）。
//
// 覆盖：
//   1. 注册幂等——连续调用 registerMarkdownExtensions 只对 marked.use 执行一次；
//   2. transformTokens 按注册顺序聚合（后注册的变换看到先注册的输出）；
//   3. createParseContext 每次新建独立状态（脚注/任务计数不跨渲染共享）；
//   4. renderMarkdown 两次输出逐字节一致（单次 parse 状态隔离）；
//   5. 空扩展时 renderMarkdown 与 marked.parse 逐字节一致（与现渲染等价）；
//   6. outlineSlug：中英文/符号/重复/空标题，与 viewMethods._outlineSlug 抽取前行为一致。
//
// 隔离约定：每个测试先 resetMarkdownExtensionRegistry（清空注册/目标）再
// setMarkedTarget（注入本测试目标），不污染其他测试（注册状态是模块级单例，
// 与编辑器运行时一致）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import type { Token, TokenizerAndRendererExtension } from 'marked';
import {
  createParseContext,
  registerMarkdownExtensions,
  renderMarkdown,
  resetMarkdownExtensionRegistry,
  setMarkedTarget,
  transformTokens,
  RENDER_MARKDOWN_OPTIONS,
  type MarkdownExtensionModule,
  type MarkedTarget
} from '../../src/editor/markdownExtensions/markdownExtensionRegistry.ts';
import { outlineSlug } from '../../src/editor/markdownExtensions/slugify.ts';

function fakeTarget(overrides: Partial<MarkedTarget> = {}): MarkedTarget {
  return {
    use(..._args: unknown[]) { return this; },
    lexer: () => [] as Token[],
    parser: () => '',
    ...overrides
  };
}

// ===== 注册机制 =====

test('registerMarkdownExtensions 幂等：连续调用 use 只执行一次', () => {
  let useCalls = 0;
  const spy = fakeTarget({
    use(...args: unknown[]) { useCalls += 1; return args; }
  });
  resetMarkdownExtensionRegistry();
  setMarkedTarget(spy);

  const ext: TokenizerAndRendererExtension = {
    name: 'probe', level: 'inline',
    start: () => -1,
    tokenizer: () => undefined
  };
  const mod: MarkdownExtensionModule = { extensions: [ext] };
  registerMarkdownExtensions(mod);
  registerMarkdownExtensions(mod);
  registerMarkdownExtensions(mod);

  assert.equal(useCalls, 1, '重复注册不得重复 use');
});

test('没有可用 marked 目标时注册失败且不抛异常', () => {
  resetMarkdownExtensionRegistry();
  setMarkedTarget(null);
  const ok = registerMarkdownExtensions({ extensions: [] });
  assert.equal(ok, false);
});

test('transformTokens 按注册顺序聚合（后注册的变换看到先注册的输出）', () => {
  const order: string[] = [];
  const first: MarkdownExtensionModule = {
    extensions: [],
    transformTokens(tokens) {
      order.push('first');
      tokens.push({ type: 'space', raw: '' } as Token);
      return tokens;
    }
  };
  const second: MarkdownExtensionModule = {
    extensions: [],
    transformTokens(tokens) {
      order.push('second:' + tokens.filter((t) => t.type === 'space').length);
      return tokens;
    }
  };
  resetMarkdownExtensionRegistry();
  setMarkedTarget(fakeTarget());
  registerMarkdownExtensions(first, second);

  const out = transformTokens([], createParseContext());
  assert.deepEqual(order, ['first', 'second:1']);
  assert.equal(out.filter((t) => t.type === 'space').length, 1);
});

test('createParseContext 每次新建独立状态（脚注/任务计数不跨渲染共享）', () => {
  const a = createParseContext();
  const b = createParseContext();
  a.footnotes.set('1', '注一');
  a.footnoteOrder.push('1');
  a.taskCounts.checked = 3;
  a.taskCounts.unchecked = 1;

  assert.equal(a.footnotes.get('1'), '注一');
  assert.equal(b.footnotes.size, 0, '脚注集合不得共享');
  assert.deepEqual(b.footnoteOrder, []);
  assert.deepEqual(b.taskCounts, { checked: 0, unchecked: 0 });
  assert.notEqual(a.footnotes, b.footnotes);
});

// ===== 单管线渲染 =====

test('空扩展时 renderMarkdown 与 marked.parse 逐字节一致（同实例同选项）', () => {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions();

  const src = '# 标题\n\n段落 **粗体** 与 `代码`。\n\n- a\n- b\n\n| 1 | 2 |\n| --- | --- |\n| 3 | 4 |\n\n> 引用\n\n---';
  const { html } = renderMarkdown(src);
  assert.equal(html, m.parse(src));
});

test('renderMarkdown 两次输出逐字节一致（单次 parse 状态隔离）', () => {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  // 有状态的变换：每次 parse 往 ctx 累积脚注（若 ctx 跨渲染共享，第二次会带上第一次的残留）
  const stateful: MarkdownExtensionModule = {
    extensions: [],
    transformTokens(tokens, ctx) {
      ctx.footnotes.set(String(ctx.footnoteOrder.length + 1), '注' + (ctx.footnoteOrder.length + 1));
      ctx.footnoteOrder.push(...ctx.footnotes.keys());
      return tokens; // 只收集不注入：输出与输入 token 一致
    }
  };
  registerMarkdownExtensions(stateful);

  const src = '# 标题\n\n正文[^1]。';
  const a = renderMarkdown(src);
  const b = renderMarkdown(src);
  assert.equal(a.html, b.html);
  assert.equal(a.tokens.length, b.tokens.length);
});

test('renderMarkdown 返回 tokens 供消费方缓存（_lastTokens 前提）', () => {
  const m = new Marked(RENDER_MARKDOWN_OPTIONS);
  resetMarkdownExtensionRegistry();
  setMarkedTarget(m as unknown as MarkedTarget);
  registerMarkdownExtensions();

  const { tokens } = renderMarkdown('# H\n\n- a\n- b');
  assert.ok(Array.isArray(tokens));
  assert.ok(tokens.some((t) => t.type === 'heading'));
  assert.ok(tokens.some((t) => t.type === 'list'));
});

// ===== outlineSlug（自 viewMethods._outlineSlug 抽取，行为必须一致） =====

test('outlineSlug：中英文/符号/空白归一与 section 兜底', () => {
  const used = new Set<string>();
  assert.equal(outlineSlug('我的 标题', 0, used), 'outline-我的-标题');
  assert.equal(outlineSlug('Hello, World! 2.0', 1, used), 'outline-hello-world-20');
  assert.equal(outlineSlug('C++ & JS', 2, used), 'outline-c-js');
  assert.equal(outlineSlug('A-B_c', 3, used), 'outline-a-b_c');
  assert.equal(outlineSlug('  前面有空格  ', 4, used), 'outline-前面有空格');
  assert.equal(outlineSlug('', 4, used), 'outline-section-5');
  assert.equal(outlineSlug(null, 0, used), 'outline-section-1');
  assert.equal(outlineSlug(undefined, 9, used), 'outline-section-10');
});

test('outlineSlug：重复标题递增后缀并登记 used 集合', () => {
  const used = new Set<string>();
  assert.equal(outlineSlug('标题', 0, used), 'outline-标题');
  assert.equal(outlineSlug('标题', 1, used), 'outline-标题-2');
  assert.equal(outlineSlug('标题', 2, used), 'outline-标题-3');
  assert.ok(used.has('outline-标题'));
  assert.ok(used.has('outline-标题-2'));
  assert.ok(used.has('outline-标题-3'));
});

test('outlineSlug：纯符号标题退化为 section 兜底（符号全被剥离）', () => {
  const used = new Set<string>();
  assert.equal(outlineSlug('!!! ???', 0, used), 'outline-section-1');
  assert.equal(outlineSlug('---', 1, used), 'outline-section-2');
});
