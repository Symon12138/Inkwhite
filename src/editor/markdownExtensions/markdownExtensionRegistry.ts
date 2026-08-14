// M1-1 定稿：Markdown 扩展注册机制 + 单管线渲染入口。
//
// ─────────────────────────────────────────────────────────────────────────
// 这是 M1-2..M1-6 扩展代理的契约（M1-1 定稿后不得再改，各 stub 由对应代理填充）。
// ─────────────────────────────────────────────────────────────────────────
// 每个扩展一个模块文件（src/editor/markdownExtensions/ 下与文件同名），导出
// 符合 MarkdownExtensionModule 的命名导出（见下方接口注释），例如：
//
//   import type { MarkdownExtensionModule } from './markdownExtensionRegistry';
//   export const mathExtension: MarkdownExtensionModule = {
//     extensions: [...],                    // marked.use() 的 tokenizer/renderer
//     transformTokens: (tokens, ctx) => {   // 可选；缺省 = 不做 token 变换
//       ...; return tokens;
//     }
//   };
//
// 生命周期（全应用只有一个注册点）：
//   1. editorEntry.ts 在 window.marked = marked 之后调用一次
//      registerMarkdownExtensions(mathExtension, inlineSyntaxExtension, ...)；
//      幂等：重复调用不会再次 marked.use()。
//   2. 每次预览渲染走 renderMarkdown(src) → { html, tokens }：
//      lexer → 按注册顺序聚合 transformTokens → parser。
//      _renderPreview 与单元测试共用该入口；浏览器默认目标为 window.marked，
//      单测可用 setMarkedTarget 注入替身。
//   3. MarkdownParseContext 每次 parse 新建：脚注收集/任务计数等单次渲染状态
//      都挂 ctx 上，两次渲染互不串扰。
//
// 约定：
//   - 扩展只做「token 结构」：tokenizer/renderer 产出标记类名（.katex/.footnotes/
//     .toc/.front-matter/.task-list-item 等）与结构，样式一律由 styles.css 预置
//     （M1-1 已写好），扩展文件不得改 styles.css。
//   - token 变换里新增的 block token 若想被 parser 渲染，需同步注册同名 renderer
//     （见 marked.use 的 extensions），或复用现有 token 类型（paragraph/html 等）。
//   - 扩展之间的顺序由 editorEntry 的注册顺序决定（transformTokens 依注册序聚合）；
//     M1 各扩展互不依赖，保持解耦。

import type { MarkedExtension, Token, TokenizerAndRendererExtension } from 'marked';

/** 单次 parse 内共享的扩展状态：每次 renderMarkdown 调用新建（渲染隔离）。 */
export interface MarkdownParseContext {
  /** 脚注收集：key = 脚注标识（如 '1' 或命名引用），value = 脚注文本 */
  footnotes: Map<string, string>;
  /** 脚注首次出现顺序（去重后的插入序），供脚注区注入排版 */
  footnoteOrder: string[];
  /** 任务列表勾选计数（GFM 任务统计用） */
  taskCounts: { checked: number; unchecked: number };
  /** 扩展可自行挂私有状态（键名避开以上字段与彼此冲突即可） */
  [key: string]: unknown;
}

/**
 * 扩展模块契约（M1 定稿）。每个扩展文件导出该形状的命名导出：
 * - extensions：传给 marked.use() 的 tokenizer/renderer 数组（可为空数组，
 *   例如纯 transformTokens 型扩展）；
 * - transformTokens：可选的 token 变换，parser 之前按注册顺序执行，返回
 *   （可原地修改的）顶层 tokens 数组；用于 tokenizer 难以表达的整树后处理
 *   （脚注收集与注入、TOC 生成、任务计数等）。ctx 为本次 parse 的上下文。
 */
export interface MarkdownExtensionModule {
  extensions: TokenizerAndRendererExtension[];
  transformTokens?: (tokens: Token[], ctx: MarkdownParseContext) => Token[];
}

/** renderMarkdown 依赖的 marked 表面：真实 Marked 实例与测试替身都满足。 */
export interface MarkedTarget {
  use(...args: unknown[]): unknown;
  lexer(src: string, options?: unknown): Token[];
  parser(tokens: Token[], options?: unknown): string;
}

/** 与 MarkdownEditorLogic._init 的 setOptions({ gfm: true, breaks: true }) 一致 */
export const RENDER_MARKDOWN_OPTIONS = { gfm: true, breaks: true } as const;

let markedTarget: MarkedTarget | null = null;
let installed = false;
const registered: MarkdownExtensionModule[] = [];

function currentTarget(): MarkedTarget | null {
  if (markedTarget) return markedTarget;
  if (typeof window !== 'undefined' && (window as { marked?: unknown }).marked) {
    return (window as unknown as { marked: MarkedTarget }).marked;
  }
  return null;
}

/** 测试注入：设置渲染目标（null 恢复为默认 window.marked）。 */
export function setMarkedTarget(target: MarkedTarget | null): void {
  markedTarget = target;
}

/** 测试复位：清空注册的扩展与安装标记（仅测试使用）。 */
export function resetMarkdownExtensionRegistry(): void {
  registered.length = 0;
  installed = false;
  markedTarget = null;
}

/**
 * 注册扩展模块（editorEntry 调用一次；幂等——重复调用不会再次 marked.use）。
 * 没有可用 marked 目标时返回 false 且不抛异常（库未就绪时静默跳过）。
 */
export function registerMarkdownExtensions(...modules: MarkdownExtensionModule[]): boolean {
  const target = currentTarget();
  if (!target) return false;
  for (const module of modules) {
    if (!registered.includes(module)) registered.push(module);
  }
  if (installed) return true;
  const extensions = registered.flatMap((m) => m.extensions ?? []);
  if (extensions.length) target.use({ extensions } as MarkedExtension);
  installed = true;
  return true;
}

/** 新建单次 parse 的上下文（脚注/任务计数隔离）。 */
export function createParseContext(): MarkdownParseContext {
  return {
    footnotes: new Map(),
    footnoteOrder: [],
    taskCounts: { checked: 0, unchecked: 0 }
  };
}

/** 按注册顺序聚合各扩展的 token 变换（前一个的输出是后一个的输入）。 */
export function transformTokens(tokens: Token[], ctx: MarkdownParseContext): Token[] {
  for (const module of registered) {
    if (module.transformTokens) tokens = module.transformTokens(tokens, ctx);
  }
  return tokens;
}

/**
 * 单管线渲染入口：lexer → transformTokens → parser。
 * 与旧 marked.parse 输出逐字节等价（空扩展时，见 tests/unit/markdownSinglePipeline
 * 与 markdownExtensionRegistry 的等价测试）；tokens 一并返回供消费方缓存
 * （_renderPreview 缓存到 _lastTokens，P4/P8 使用）。目标不可用（库未加载）时抛错，
 * 调用方（_renderPreview）已先做 window.marked 守卫。
 */
export function renderMarkdown(src: string): { html: string; tokens: Token[] } {
  const target = currentTarget();
  if (!target) throw new Error('renderMarkdown: marked target unavailable');
  const ctx = createParseContext();
  // M1-4 实测修正：不显式传 options，让 marked 实例回落到 this.defaults。
  // 实例的 lexer/parser 是 lexer(src, opts ?? this.defaults)，显式传
  // RENDER_MARKDOWN_OPTIONS 会直接 new Lexer(opts)，把 use() 注册的扩展
  // （挂在 defaults.extensions 上）整个丢掉（probe-plumbing.mjs 路径 B 实测）。
  // 单测与 _renderPreview 的实例都以 RENDER_MARKDOWN_OPTIONS 为 defaults
  // （new Marked(RENDER_MARKDOWN_OPTIONS) / _init setOptions），行为不变；
  // 等价性测试（空扩展时与 marked.parse 逐字节一致）仍成立。
  let tokens = target.lexer(src);
  tokens = transformTokens(tokens, ctx);
  const html = target.parser(tokens);
  return { html, tokens };
}
