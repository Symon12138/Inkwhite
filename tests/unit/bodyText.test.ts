// S0.1 收尾：bodyText 锚文本隔离单测（node:test，零依赖、无 DOM）。
// 被测模块：src/editor/bodyText.ts。
// 节点构造器与真实 DOM 的对应关系见被测文件头注释：
//   text()  ↔ Text 节点；el() ↔ Element 节点（matches 按 class 列表判断）；
//   preview() ↔ .md-preview 容器；无 class 的 span 代表批注 span[data-comment-id]
//   （不命中排除选择器，其文本必须保留）。
// 本文件只刻画纯函数行为，不涉及接线（M1 才接线进 commentMethods /
// previewSearchMethods）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyText,
  bodyTextOffset,
  forEachBodyTextNode,
  BODY_TEXT_EXCLUDE_SELECTOR,
  BODY_TEXT_NODE_ELEMENT,
  BODY_TEXT_NODE_TEXT,
  type BodyTextNodeLike
} from '../../src/editor/bodyText.ts';

// ===== 轻量节点构造器（tests/helpers/dom.ts 的 stub 风格，就地最小实现）=====

function text(value: string): BodyTextNodeLike {
  return { nodeType: BODY_TEXT_NODE_TEXT, textContent: value };
}

function el(className: string | null, children: BodyTextNodeLike[]): BodyTextNodeLike {
  return {
    nodeType: BODY_TEXT_NODE_ELEMENT,
    textContent: null,
    childNodes: children,
    // 与 Element.matches 语义一致：class 列表里任一 class 命中选择器列表即匹配。
    matches(selector: string) {
      if (!className) return false;
      const own = className.split(/\s+/);
      return selector.split(',').some((part) => {
        const cls = part.trim().replace(/^\./, '');
        return cls !== '' && own.includes(cls);
      });
    }
  };
}

function preview(children: BodyTextNodeLike[]): BodyTextNodeLike {
  return el('md-preview', children);
}

// ===== 排除区与正文 =====

test('排除 .front-matter/.toc/.footnotes 后，正文保持文档序（含批注 span 文本）', () => {
  const root = preview([
    el('front-matter', [el('h2', [text('front matter 卡片')])]),
    el('h1', [text('正文标题')]),
    el('p', [
      text('批注前'),
      el('span', [text('被批注的句子')]), // 真实 DOM：span[data-comment-id]
      text('批注后')
    ]),
    el('toc', [el('ul', [el('li', [text('目录项一')]), el('li', [text('目录项二')])])]),
    el('footnotes', [el('ol', [el('li', [text('脚注一')]), el('li', [text('脚注二')])])]),
    el('p', [text('结尾段')])
  ]);
  const out = bodyText(root);
  assert.equal(out, '正文标题批注前被批注的句子批注后结尾段');
  assert.doesNotMatch(out, /front matter|目录项|脚注/);
});

test('Mermaid 渲染宿主整棵排除：SVG 内 <style> 的 CSS 文本与图内标签都不进入锚文本', () => {
  const root = preview([
    el('mermaid-rendered is-loading', [
      el('svg', [
        el('style', [text('.node rect { fill: #f0a838; } .label { font-family: monospace; }')]),
        el('g', [text('开始节点'), text('结束节点')])
      ])
    ]),
    el('p', [text('正文')])
  ]);
  const out = bodyText(root);
  assert.equal(out, '正文');
  assert.doesNotMatch(out, /fill|font-family|节点/);
});

test('.katex-mathml 不重复计数公式文本：锚文本只保留 katex-html 侧的一次出现', () => {
  const root = preview([
    el('p', [
      text('公式 '),
      el('katex', [
        el('katex-mathml', [el('annotation', [text('E=mc^2')])]),
        el('katex-html', [text('E=mc²')])
      ]),
      text(' 结束')
    ])
  ]);
  const out = bodyText(root);
  assert.equal(out, '公式 E=mc² 结束');
  assert.equal(out.split('E=mc').length - 1, 1, '公式文本应恰好出现一次');
  assert.doesNotMatch(out, /E=mc\^2/, 'mathml 注解（TeX 源码）不应进入锚文本');
});

test('未知 class 不影响：排除列表是封闭的，其余元素文本全部保留', () => {
  const root = preview([
    el('sidebar', [text('侧栏文本')]),
    el('katex-html', [text('公式渲染结果')]),
    el('div', [text('普通段落')])
  ]);
  assert.equal(bodyText(root), '侧栏文本公式渲染结果普通段落');
});

test('嵌套排除区：外层命中即整棵剪枝，内层排除区不重复计算', () => {
  const root = preview([
    el('footnotes', [
      el('katex-mathml', [el('annotation', [text('x^2')])]),
      el('li', [text('脚注正文')])
    ]),
    el('p', [text('正文')])
  ]);
  const out = bodyText(root);
  assert.equal(out, '正文');
  assert.doesNotMatch(out, /x\^2|脚注正文/);
});

test('空容器与「只有排除区」的容器都返回空串', () => {
  assert.equal(
    bodyText({ nodeType: BODY_TEXT_NODE_ELEMENT, textContent: null, childNodes: [] }),
    ''
  );
  assert.equal(bodyText(preview([el('toc', [text('只有目录')])])), '');
});

test('排除选择器恒定覆盖五个目标 class（防改漏）', () => {
  const classes = BODY_TEXT_EXCLUDE_SELECTOR
    .split(',')
    .map((s) => s.trim().replace(/^\./, ''))
    .sort();
  assert.deepEqual(classes, ['footnotes', 'front-matter', 'katex-mathml', 'mermaid-rendered', 'toc']);
});

// ===== M1 接线辅助：forEachBodyTextNode / bodyTextOffset（锚定与搜索两侧共用） =====

test('forEachBodyTextNode：文档序遍历 + 排除区剪枝 + 提前终止', () => {
  const root = preview([
    el('p', [text('A')]),
    el('footnotes', [text('脚注')]),
    el('p', [text('B'), el('span', [text('C')])])
  ]);
  const seen: string[] = [];
  const finished = forEachBodyTextNode(root, (node) => {
    seen.push(node.textContent ?? '');
  });
  assert.equal(finished, true, '未提前终止时返回 true');
  assert.deepEqual(seen, ['A', 'B', 'C'], '排除区子树被剪枝，批注 span 文本保留');

  const early: string[] = [];
  const stopped = forEachBodyTextNode(root, (node) => {
    early.push(node.textContent ?? '');
    return false; // 第一个文本节点后终止
  });
  assert.equal(stopped, false, '访问者返回 false 时提前终止并向上传播');
  assert.deepEqual(early, ['A']);
});

test('forEachBodyTextNode 与 bodyText 输出一致（同一遍历语义）', () => {
  const root = preview([
    el('front-matter', [text('卡片')]),
    el('h1', [text('标题')]),
    el('toc', [text('目录')]),
    el('p', [text('正文'), el('katex', [el('katex-mathml', [text('x^2')]), el('katex-html', [text('x²')])])])
  ]);
  const seen: string[] = [];
  forEachBodyTextNode(root, (node) => seen.push(node.textContent ?? ''));
  assert.equal(seen.join(''), bodyText(root));
});

test('bodyTextOffset：文本节点偏移、夹取与排除区跳过', () => {
  const foot = el('footnotes', [text('脚注文本')]);
  const target = text('目标句子');
  const root = preview([foot, el('p', [text('前缀'), target, text('后缀')])]);
  assert.equal(bodyTextOffset(root, target, 0), 2, '前缀 2 字符，脚注区被跳过');
  assert.equal(bodyTextOffset(root, target, 2), 4);
  assert.equal(bodyTextOffset(root, target, 999), 6, '越界偏移夹取到节点长度');
  assert.equal(bodyTextOffset(root, foot, 0), -1, '排除区内的节点不可达（锚文本外）');
  assert.equal(bodyTextOffset(root, text('不存在'), 0), -1, '不在遍历中的节点返回 -1');
});
