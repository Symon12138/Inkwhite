// M1-6 实现：任务列表扩展（禁用态 renderer 基础，交互是 M4）。
//
// 能力（M1 交付）：
//   - list renderer 覆写：task 项 <li> 加 task-list-item 类，其余与默认输出
//     逐字节等价（普通/有序/start≠1/松散/嵌套列表由单测等价断言回归）；
//   - checkbox renderer 覆写：<input type="checkbox" disabled data-task-idx="N">
//     （checked 加 checked 属性），N 为本次 parse 的稳定序号（按 token 序）；
//   - transformTokens：深度优先遍历 tokens 树（含嵌套列表/引用），统计
//     ctx.taskCounts（checked/unchecked；[X] 大写由 lexer 实测计 checked），
//     本期只计数不消费；同时把稳定序号挂到 checkbox token 的私有字段上
//     （renderer 无 ctx 访问权，只能读 token；序号计数器挂 ctx 私有键，
//     每次 renderMarkdown 新建 ctx，两次渲染互不串扰——无模块级可变状态）。
//
// 机制事实（probe 实证，marked@18.0.5）：
//   - parser 的块级分发只查 extensions.renderers[token.type]；list_item 由
//     list renderer 内部直接调用 this.listitem(item) 渲染，注册名为
//     'list_item' 的扩展 renderer 永远不会被分发到，只能整体覆写 'list'；
//   - 覆写 'list' 时用 this.parser.parse(item.tokens) 渲染项内容（与默认
//     listitem 相同），嵌套列表/引内列表经递归分发再次命中本 renderer；
//   - checkbox 是 inline token，扩展 renderer 正常接管（probe 实证）。
//
// 样式（.task-list-item / li:has(> input[type="checkbox"]) / 禁用态置灰）
// 已由 styles.css 预置，本模块只产出结构，不得改 styles.css。
//
// 契约（定稿，见 markdownExtensionRegistry.ts 头部注释，不得更改）：
//   MarkdownExtensionModule = {
//     extensions: TokenizerAndRendererExtension[];            // marked.use 扩展
//     transformTokens?: (tokens, ctx) => tokens;              // 可选 token 变换
//   };
// 保持命名导出 taskExtension 不变（editorEntry 已按此名注册）。

import type { Token, Tokens } from 'marked';
import type { MarkdownExtensionModule, MarkdownParseContext } from './markdownExtensionRegistry';

/** checkbox token 上挂的私有字段：本次 parse 稳定序号（renderer 读取，M4 交互基础） */
interface TaskCheckbox extends Tokens.Checkbox {
  taskIndex?: number;
}

/** 序号计数器挂 ctx 私有键（键名避开契约字段与其他扩展即可） */
const TASK_INDEX_KEY = 'taskIndex';

function isTaskCheckbox(token: Token): token is TaskCheckbox {
  return token.type === 'checkbox';
}

/** list renderer 覆写：与默认输出逐字节一致，仅 task 项在 <li> 加类。 */
function renderList(
  this: { parser: { parse(tokens: Token[]): string } },
  token: Tokens.Generic
): string {
  if (token.type !== 'list') return '';
  const list = token as Tokens.List;
  let body = '';
  for (const item of list.items) {
    const cls = item.task ? ' class="task-list-item"' : '';
    body += '<li' + cls + '>' + this.parser.parse(item.tokens) + '</li>\n';
  }
  const type = list.ordered ? 'ol' : 'ul';
  const startAttr = list.ordered && list.start !== 1 ? ' start="' + list.start + '"' : '';
  return '<' + type + startAttr + '>\n' + body + '</' + type + '>\n';
}

/** checkbox renderer 覆写：可交互 + 稳定序号（M4 交付完整交互：点击由接线层改源码）。 */
function renderCheckbox(token: Tokens.Generic): string {
  if (token.type !== 'checkbox') return '';
  const checkbox = token as TaskCheckbox;
  const checked = checkbox.checked ? ' checked=""' : '';
  return '<input type="checkbox"' + checked + ' data-task-idx="' + (checkbox.taskIndex ?? 0) + '"> ';
}

/** 深度优先遍历 tokens 树（含嵌套列表/引用），计数并分配稳定序号。 */
function countTasks(tokens: Token[], ctx: MarkdownParseContext): void {
  for (const token of tokens) {
    if (token.type === 'list') {
      const list = token as Tokens.List;
      for (const item of list.items) {
        if (item.task) {
          const checkbox = item.tokens.find(isTaskCheckbox);
          if (checkbox) {
            const index = (ctx[TASK_INDEX_KEY] as number | undefined) ?? 0;
            checkbox.taskIndex = index;
            ctx[TASK_INDEX_KEY] = index + 1;
          }
          if (item.checked) ctx.taskCounts.checked += 1;
          else ctx.taskCounts.unchecked += 1;
        }
        countTasks(item.tokens, ctx);
      }
    } else if ('tokens' in token && token.tokens) {
      countTasks(token.tokens, ctx);
    }
  }
}

export const taskExtension: MarkdownExtensionModule = {
  extensions: [
    { name: 'list', renderer: renderList },
    { name: 'checkbox', renderer: renderCheckbox }
  ],
  transformTokens(tokens, ctx) {
    countTasks(tokens, ctx);
    return tokens;
  }
};
