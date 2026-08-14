// Vite waits for these editor-only styles before evaluating this module, so the
// mounted editor is styled on its first frame.
import './editor/styles.css';
import './editor/documentSidebar.css';
import './editor/shell.css';
import './editor/insertPaste.css';
import './editor/desktopM4.css';
// 必须排在最后：长图海报抄一份预览排版规则，靠加载顺序覆盖同特异度的 .md-preview
import './editor/longImage.css';

// 编辑器是桌面端唯一页面（不再有落地页/hash 路由），激活编辑器壳层标记：
// 1) shell.css 的 html:has(body.editor-active) / body.editor-active 锁死页面级滚动，
//    追加到 body 的弹层/提示元素不会撑出第二根滚动条；
// 2) tokens.css 的 body.editor-active[data-theme='light'] 亮色覆盖恢复生效。
document.body.classList.add('editor-active');

import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { marked } from 'marked';
import { createMarkdownEditorComponent } from './editor/MarkdownEditorLogic';
import { registerMarkdownExtensions } from './editor/markdownExtensions/markdownExtensionRegistry';
import { mathExtension } from './editor/markdownExtensions/mathExtension';
import { inlineSyntaxExtension } from './editor/markdownExtensions/inlineSyntaxExtension';
import { footnoteExtension } from './editor/markdownExtensions/footnoteExtension';
import { tocExtension } from './editor/markdownExtensions/tocExtension';
import { frontMatterExtension } from './editor/markdownExtensions/frontMatterExtension';
import { taskExtension } from './editor/markdownExtensions/taskExtension';

window.React = React;
window.ReactDOM = ReactDOM;
window.marked = marked;
// M1：Markdown 扩展注册的唯一合法位置（模块作用域里 window.marked 的唯一注入点）。
// registerMarkdownExtensions 幂等（重复调用不重复 use）；M1-2..M1-6 各自填充对应
// stub 文件即可，此处与注册契约不再变更。注册顺序 = transformTokens 聚合顺序。
registerMarkdownExtensions(
  mathExtension,
  inlineSyntaxExtension,
  footnoteExtension,
  tocExtension,
  frontMatterExtension,
  taskExtension
);
window.createMarkdownEditorComponent = createMarkdownEditorComponent;

// The bundled DC runtime is generated JavaScript without declaration files.
// @ts-expect-error generated runtime module
await import('./dc-runtime.js');
