// S0.1 收尾 + M1 接线：bodyText 锚文本隔离纯函数。
//
// 目的：批注锚定与预览搜索共用同一锚文本。两者当前都直接读 preview.textContent
// 计算字符偏移（commentMethods._applyHighlights / _offsetOf，以及
// previewSearchMethods 的命中定位），一旦正文里出现 Front Matter 卡片
// （.front-matter）、目录（.toc）、脚注区（.footnotes）、KaTeX 数学的 MathML
// 隐藏副本（.katex-mathml）或 Mermaid 渲染宿主（.mermaid-rendered，SVG 内部
// 自带 <style> 的 CSS 文本），textContent 的偏移即被污染，批注/搜索定位随之错位。
//
// bodyText(root) 以文档序遍历文本节点，跳过命中排除选择器的整棵子树，返回与
// 「预览可见正文」一致的锚文本（含批注 span[data-comment-id] 的文本）。
// 不采用「全文减去排除区文本」的字符串减法：正文里先出现与排除区相同文本时，
// 减法会删错位置（indexOf 命中到正文里的重复文本）。
//
// M1 接线（2026-08-12）：commentMethods 与 previewSearchMethods 已改用
// bodyText / bodyTextOffset / forEachBodyTextNode（本文件）作为锚文本与遍历基准，
// 两侧遍历语义完全一致（同一排除选择器、同一文档序）：
// - commentMethods._applyHighlights / _onPreviewSelect：bodyText(prev) 为锚文本；
//   _offsetOf 委托 bodyTextOffset；_wrapRange 用 forEachBodyTextNode 走锚文本序，
//   保证 [start, end) 区间与锚文本坐标对齐。
// - previewSearchMethods._updatePreviewSearchMatches / _previewMatchRanges：同上。
// 直接把 .md-preview 元素传给这些函数即可，无需适配层（文件末尾有编译期断言兜底）。
//
// 真实 DOM 对应关系（M1 接线时直接把 .md-preview 元素传给 bodyText 即可，
// 无需适配层；文件末尾有编译期断言兜底）：
// - nodeType     → Node.nodeType（1 = 元素，3 = 文本）
// - textContent  → Node.textContent（文本节点为自身内容；元素节点此字段被忽略，
//                  其正文由子节点递归得到）
// - childNodes   → Node.childNodes（文档序；数组与 NodeList 均可迭代）
// - matches      → Element.matches（文本节点没有该方法，走 nodeType === 3 分支）

/** bodyText 排除的节点选择器（真实 DOM 可直接用于 querySelectorAll） */
export const BODY_TEXT_EXCLUDE_SELECTOR =
  '.front-matter, .toc, .footnotes, .mermaid-rendered, .katex-mathml';

/** 与 Node.ELEMENT_NODE 一致 */
export const BODY_TEXT_NODE_ELEMENT = 1;

/** 与 Node.TEXT_NODE 一致 */
export const BODY_TEXT_NODE_TEXT = 3;

/** 可遍历节点的最小契约：真实 DOM Node 的轻量结构子集，单测可用普通对象构造 */
export interface BodyTextNodeLike {
  readonly nodeType: number;
  /** 文本节点为自身内容；元素节点忽略该字段（正文来自递归子节点） */
  readonly textContent: string | null;
  /** 子节点（文档序）；真实 DOM 传 Node.childNodes（NodeList 可迭代） */
  readonly childNodes?: ReadonlyArray<BodyTextNodeLike> | Iterable<BodyTextNodeLike>;
  /** 元素节点：Element.matches(selector)；文本节点无此方法 */
  matches?(selector: string): boolean;
}

// 编译期证明：真实 DOM 的 Element / Text 结构上满足 BodyTextNodeLike，
// M1 接线时可直接把 .md-preview 元素传给 bodyText，无需适配层。
const _elementSatisfiesBodyText: Element extends BodyTextNodeLike ? true : never = true;
const _textSatisfiesBodyText: Text extends BodyTextNodeLike ? true : never = true;

/**
 * 文档序遍历文本节点，跳过排除区子树——与 bodyText 完全一致的遍历语义。
 * visit 返回 false 可提前终止（forEachBodyTextNode 返回 false 表示被终止，
 * 否则返回 true）。批注 _wrapRange 与预览搜索 _previewMatchRanges 用它
 * 走「锚文本序」，保证区间坐标与 bodyText 对齐。
 */
export function forEachBodyTextNode(
  root: BodyTextNodeLike,
  visit: (node: BodyTextNodeLike) => boolean | void
): boolean {
  for (const child of root.childNodes ?? []) {
    if (child.nodeType === BODY_TEXT_NODE_TEXT) {
      if (visit(child) === false) return false;
    } else if (child.matches && child.matches(BODY_TEXT_EXCLUDE_SELECTOR)) {
      continue;
    } else if (!forEachBodyTextNode(child, visit)) {
      return false;
    }
  }
  return true;
}

/**
 * bodyText 坐标下的前缀长度：从 root 文档序累加文本节点（跳过排除区），
 * 到达 stopNode（须为文本节点）时加上夹取后的 stopOffset。
 * stopNode 不在锚文本遍历中（排除区内 / 非文本节点）时返回 -1。
 * 供批注划选定位（selection startContainer 的锚文本偏移）使用。
 */
export function bodyTextOffset(root: BodyTextNodeLike, stopNode: BodyTextNodeLike, stopOffset: number): number {
  let length = 0;
  let found = false;
  forEachBodyTextNode(root, (node) => {
    if (node === stopNode) {
      found = true;
      const len = node.textContent?.length ?? 0;
      length += Math.max(0, Math.min(stopOffset, len));
      return false;
    }
    length += node.textContent?.length ?? 0;
  });
  return found ? length : -1;
}

/**
 * 返回容器的锚文本：文档序拼接全部文本节点，命中排除选择器的子树整体跳过
 * （嵌套的排除区由外层剪枝，不重复计算）。空容器 / 无文本节点返回空串。
 */
export function bodyText(root: BodyTextNodeLike): string {
  let out = '';
  forEachBodyTextNode(root, (node) => {
    out += node.textContent ?? '';
  });
  return out;
}
