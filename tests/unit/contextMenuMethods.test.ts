import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextMenuMethods } from '../../src/editor/contextMenuMethods.ts';
import { createStubElement } from '../helpers/dom.ts';

// 右键菜单（contextMenuMethods.ts）的纯逻辑层：菜单结构、上下文命中、
// 视口翻转定位、表格转 Markdown、关闭清理。

// 手工上下文：以原型继承实现类（内部 helper 走原型链），再覆盖菜单构建/渲染
// 依赖的成员；未用到的按需补 stub。
function menuContext(overrides: Record<string, unknown> = {}) {
  const ctx = Object.create(ContextMenuMethods.prototype);
  Object.assign(ctx, {
    _tabs: [],
    addTab() {},
    closeTab() {},
    _renderTabBar() {},
    _persistTabs() {},
    _renderFileTree() {},
    _pickFolder() {},
    _openFileFromTree() {},
    _toggleDir() {},
    _copyText() {},
    ...overrides
  });
  return ctx;
}

// 让 target.closest(sel) 按选择器映射返回预置元素，模拟 DOM 命中。
function fakeClosestTarget(map: Record<string, unknown>) {
  return { closest: (sel: string) => (sel in map ? map[sel] : null) };
}

function fakeEl(attrs: Record<string, string> = {}, text = '') {
  return {
    getAttribute(name: string) { return attrs[name] ?? null; },
    textContent: text,
    title: attrs.title ?? ''
  };
}

function flatLabels(groups: unknown[]) {
  return (groups as { items: { type?: string; label?: string }[] }[])
    .flatMap((g) => g.items.filter((i) => i.type !== 'sep').map((i) => i.label));
}

// ===== 源码区菜单 =====

test('源码区菜单：编辑/段落/格式/插入 四分组、条目顺序与禁用态', () => {
  const ctx = menuContext();
  const groups = ContextMenuMethods.prototype._buildSourceMenu.call(ctx, {
    hasSelection: true, canUndo: true, canRedo: false
  }) as { group: string | null; items: { type?: string; label: string; disabled?: boolean }[] }[];

  assert.equal(groups.length, 4);
  assert.deepEqual(groups.map((g) => g.group), ['编辑', '段落', '格式', '插入']);

  const edit = groups[0].items;
  assert.deepEqual(
    edit.filter((i) => i.type !== 'sep').map((i) => i.label),
    ['撤销', '重做', '剪切', '复制', '粘贴', '全选', '查找替换…']
  );
  assert.equal(edit.find((i) => i.label === '撤销')!.disabled, false);
  assert.equal(edit.find((i) => i.label === '重做')!.disabled, true);
  assert.equal(edit.find((i) => i.label === '复制')!.disabled, false);

  const para = groups[1].items.filter((i) => i.type !== 'sep').map((i) => i.label);
  assert.deepEqual(para, ['标题 1', '标题 2', '标题 3', '无序列表', '有序列表', '引用', '代码块', '任务列表', '分割线']);

  const fmt = groups[2].items.filter((i) => i.type !== 'sep').map((i) => i.label);
  assert.deepEqual(fmt, ['加粗', '斜体', '删除线', '高亮', '下划线', '行内代码', '上标', '下标', '脚注']);

  const ins = groups[3].items.filter((i) => i.type !== 'sep').map((i) => i.label);
  assert.deepEqual(ins, ['链接', '图片…', '表格']);
});

test('源码区菜单：无选区时剪切/复制禁用、粘贴始终可用', () => {
  const groups = ContextMenuMethods.prototype._buildSourceMenu.call(menuContext(), {
    hasSelection: false, canUndo: false, canRedo: false
  }) as { items: { label: string; disabled?: boolean }[] }[];
  const edit = groups[0].items;
  assert.equal(edit.find((i) => i.label === '剪切')!.disabled, true);
  assert.equal(edit.find((i) => i.label === '复制')!.disabled, true);
  assert.equal(edit.find((i) => i.label === '粘贴')!.disabled, undefined);
});

// ===== 预览区菜单（上下文命中） =====

test('预览区右键链接：打开/新标签/复制地址与文字', () => {
  const link = fakeEl({ href: 'https://example.com/a' }, '示例');
  const groups = ContextMenuMethods.prototype._buildPreviewMenu.call(
    menuContext(), fakeClosestTarget({ 'a[href]': link, img: null, table: null }), false
  );
  assert.deepEqual(flatLabels(groups), ['打开链接', '在新标签页中打开', '复制链接地址', '复制链接文字', '全选']);
});

test('预览区右键图片：复制图片/地址/浏览器打开', () => {
  const img = fakeEl({ src: 'https://example.com/p.png' });
  const groups = ContextMenuMethods.prototype._buildPreviewMenu.call(
    menuContext(), fakeClosestTarget({ 'a[href]': null, img, table: null }), false
  );
  assert.deepEqual(flatLabels(groups), ['复制图片', '复制图片地址', '在浏览器中打开图片', '全选']);
});

test('预览区右键表格：复制表格/复制为 Markdown', () => {
  const table = { querySelectorAll: () => [] };
  const groups = ContextMenuMethods.prototype._buildPreviewMenu.call(
    menuContext(), fakeClosestTarget({ 'a[href]': null, img: null, table }), false
  );
  assert.deepEqual(flatLabels(groups), ['复制表格', '复制表格为 Markdown', '全选']);
});

test('预览区右键有选区：划线/写想法菜单', () => {
  const groups = ContextMenuMethods.prototype._buildPreviewMenu.call(
    menuContext(), fakeClosestTarget({}), true
  );
  assert.deepEqual(flatLabels(groups), ['复制', '复制为 HTML', '马克笔', '波浪线', '直线', '写想法']);
});

test('预览区右键默认：无选区禁用复制/复制为 HTML，含全选', () => {
  const groups = ContextMenuMethods.prototype._buildPreviewMenu.call(
    menuContext(), fakeClosestTarget({}), false
  ) as { items: { label: string; disabled?: boolean }[] }[];
  assert.deepEqual(flatLabels(groups), ['复制', '复制为 HTML', '全选']);
  assert.equal(groups[0].items.find((i) => i.label === '复制')!.disabled, true);
  assert.equal(groups[0].items.find((i) => i.label === '复制为 HTML')!.disabled, true);
  assert.equal(groups[0].items.find((i) => i.label === '全选')!.disabled, undefined);
});

// ===== 标签页菜单 =====

test('标签页菜单：基本操作 + 有路径时复制文件路径', () => {
  const ctx = menuContext({ _tabs: [{ id: 't1', title: 'a.md', filePath: 'C:\\docs\\a.md', dirty: false }] });
  const groups = ContextMenuMethods.prototype._buildTabMenu.call(ctx, 't1');
  assert.deepEqual(flatLabels(groups), ['新建标签页', '关闭标签页', '关闭其他标签页', '关闭右侧标签页', '复制文件路径']);
});

test('标签页菜单：无路径时不出现复制文件路径', () => {
  const ctx = menuContext({ _tabs: [{ id: 't1', title: 'a.md', filePath: '', dirty: false }] });
  const groups = ContextMenuMethods.prototype._buildTabMenu.call(ctx, 't1');
  assert.deepEqual(flatLabels(groups), ['新建标签页', '关闭标签页', '关闭其他标签页', '关闭右侧标签页']);
});

// ===== 侧边栏菜单 =====

test('侧边栏文件节点：打开/复制路径/刷新', () => {
  const file = fakeEl({ title: 'C:\\docs\\a.md' }, 'a.md');
  const groups = ContextMenuMethods.prototype._buildSidebarMenu.call(
    menuContext(), fakeClosestTarget({ '.file-tree-file': file, '.file-tree-dir': null, '.file-tree-root': null })
  );
  assert.deepEqual(flatLabels(groups), ['打开', '复制路径', '刷新']);
});

test('侧边栏目录节点：已展开时显示「收起」', () => {
  const dir = fakeEl({ title: 'C:\\docs\\sub' }, 'sub');
  (dir as { classList?: unknown }).classList = { contains: () => true };
  const groups = ContextMenuMethods.prototype._buildSidebarMenu.call(
    menuContext(), fakeClosestTarget({ '.file-tree-file': null, '.file-tree-dir': dir, '.file-tree-root': null })
  );
  assert.deepEqual(flatLabels(groups), ['收起', '复制路径', '刷新']);
});

test('侧边栏空白处：选择文件夹/刷新', () => {
  const groups = ContextMenuMethods.prototype._buildSidebarMenu.call(menuContext(), fakeClosestTarget({}));
  assert.deepEqual(flatLabels(groups), ['选择文件夹…', '刷新']);
});

// ===== 定位与渲染 =====

test('菜单定位：普通位置原样、贴近右/下边缘翻转到视口内', () => {
  const ctx = menuContext();
  assert.deepEqual(ContextMenuMethods.prototype._clampMenuPosition.call(ctx, 50, 60, 200, 300, 1280, 800), { left: 50, top: 60 });
  assert.deepEqual(ContextMenuMethods.prototype._clampMenuPosition.call(ctx, 1250, 60, 200, 300, 1280, 800), { left: 1076, top: 60 });
  assert.deepEqual(ContextMenuMethods.prototype._clampMenuPosition.call(ctx, 50, 780, 200, 300, 1280, 800), { left: 50, top: 496 });
});

test('打开菜单：渲染条目（含分隔符）并挂 is-open', () => {
  const appended: unknown[] = [];
  const fakeDoc = {
    createElement: () => createStubElement(),
    body: { appendChild(child: unknown) { appended.push(child); } },
    addEventListener() {},
    removeEventListener() {}
  };
  const fakeWin = { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
  const prevDoc = (globalThis as unknown as { document: unknown }).document;
  const prevWin = (globalThis as unknown as { window: unknown }).window;
  (globalThis as unknown as { document: unknown }).document = fakeDoc;
  (globalThis as unknown as { window: unknown }).window = fakeWin;
  try {
    const ctx = menuContext();
    ContextMenuMethods.prototype._openContextMenu.call(ctx, [
      { group: null, items: [
        { label: '甲', action() {} },
        { type: 'sep' },
        { label: '乙', action() {} }
      ] }
    ], 40, 50);
    assert.equal(appended.length, 1);
    const el = appended[0] as { classList: { contains(name: string): boolean }; children: unknown[]; style: Record<string, string> };
    assert.equal(el.classList.contains('is-open'), true);
    // 甲 + 分隔符 + 乙 = 3 个子节点
    assert.equal(el.children.length, 3);
    assert.equal(el.style.left, '40px');
    assert.equal(el.style.top, '50px');
  } finally {
    (globalThis as unknown as { document: unknown }).document = prevDoc;
    (globalThis as unknown as { window: unknown }).window = prevWin;
  }
});

test('关闭菜单：移除打开态并清理文档级监听', () => {
  const el = createStubElement();
  el.classList.add('is-open');
  const removed: string[] = [];
  const fakeDoc = { removeEventListener(type: string) { removed.push(type); } };
  const fakeWin = { removeEventListener(type: string) { removed.push('w:' + type); } };
  const prevDoc = (globalThis as unknown as { document: unknown }).document;
  const prevWin = (globalThis as unknown as { window: unknown }).window;
  (globalThis as unknown as { document: unknown }).document = fakeDoc;
  (globalThis as unknown as { window: unknown }).window = fakeWin;
  try {
    const ctx = menuContext({ _ctxMenuEl: el, _ctxDocH: () => {}, _ctxKeyH: () => {}, _ctxScrollH: () => {} });
    ContextMenuMethods.prototype._closeContextMenu.call(ctx);
    assert.equal(el.classList.contains('is-open'), false);
    assert.equal(ctx._ctxDocH, null);
    assert.equal(ctx._ctxKeyH, null);
    assert.equal(ctx._ctxScrollH, null);
    assert.deepEqual(removed.sort(), ['keydown', 'mousedown', 'w:scroll']);
  } finally {
    (globalThis as unknown as { document: unknown }).document = prevDoc;
    (globalThis as unknown as { window: unknown }).window = prevWin;
  }
});

// ===== 表格转 Markdown =====

test('表格转 Markdown：管道符转义、缺列补空', () => {
  const cell = (text: string) => ({ textContent: text });
  const tr = (...cells: unknown[]) => ({ children: cells });
  const table = {
    querySelectorAll(sel: string) {
      if (sel === 'tr') {
        return [tr(cell('列 1'), cell('列 2')), tr(cell('a|b'), cell('c')), tr(cell('x'))];
      }
      return [];
    }
  };
  const md = ContextMenuMethods.prototype._tableToMarkdown.call(menuContext(), table);
  assert.equal(md, '| 列 1 | 列 2 |\n| --- | --- |\n| a\\|b | c |\n| x |  |');
});
