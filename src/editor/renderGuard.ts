// @ts-nocheck
// 渲染防线（对抗验证产物）：
//  1. defuseRenderBombs —— 超深引用链/缩进嵌套会让 Chromium 构建超深 DOM 时
//     崩溃（实测渲染进程 abort，200 层引用即可复现）。合法文档远达不到该深度；
//     命中行降级为围栏代码块原样展示——内容可见、结构安全。
//  2. RENDER_GUARD —— DOMPurify 配置：预览为只读内容，form/base/noscript 无
//     合法用途且是钓鱼/mXSS 载体，显式禁绝（DOMPurify 默认放行 form）；
//     semantics/annotation 供 KaTeX MathML 使用（见 katexDecision.spec.ts）。

export const RENDER_GUARD = {
  ADD_TAGS: ['semantics', 'annotation'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'noscript'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'ontoggle', 'onmouseover', 'formaction']
};

export function defuseRenderBombs(md) {
  return md.split('\n').map((line) => {
    if (/^(>\s*){31,}>/.test(line) || /^ {96,}\S/.test(line)) {
      return '\u0060\u0060\u0060\n' + line + '\n\u0060\u0060\u0060';
    }
    return line;
  }).join('\n');
}
