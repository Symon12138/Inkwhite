import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FileTreeMethods } from '../../src/editor/fileTreeMethods.ts';

// tauriBridge 在测试环境为 null（无 window.__TAURI_INTERNALS__），
// 因此只测可脱离桥接的纯逻辑：路径显示名、展开状态、根目录持久化。

type AnyTree = FileTreeMethods & Record<string, any>;

function createTree(): AnyTree {
  const tree = new FileTreeMethods() as AnyTree;
  tree.fileTreeRoot = null;
  tree._treeExpanded = new Set<string>();
  return tree;
}

test('_displayName 提取路径末尾段（posix / windows / 尾部斜杠 / 空）', () => {
  const tree = createTree();

  assert.equal(tree._displayName('/a/b/c.md'), 'c.md');
  assert.equal(tree._displayName('C:\\Users\\me\\notes\\a.md'), 'a.md');
  assert.equal(tree._displayName('/a/b/'), 'b');
  assert.equal(tree._displayName('C:\\Users\\me\\'), 'me');
  assert.equal(tree._displayName('C:\\'), 'C:\\');
  assert.equal(tree._displayName('/'), '/');
  assert.equal(tree._displayName(''), '');
  assert.equal(tree._displayName(null), '');
});

test('_toggleDir 展开时加入集合并渲染子节点，收起时移除并跳过渲染', async () => {
  const tree = createTree();
  const renderCalls: string[] = [];
  tree._renderTreeChildren = async (wrap: unknown, dirPath: string) => {
    renderCalls.push(dirPath);
  };
  // 展开分支会 document.createElement 子节点容器，提供最小 DOM stub
  const createdTags: string[] = [];
  (globalThis as { document?: unknown }).document = {
    createElement(tag: string) {
      createdTags.push(tag);
      return { className: '', classList: { add() {}, remove() {}, contains() { return false; } } };
    }
  };
  try {
    const row = {
      classList: {
        added: new Set<string>(),
        removed: new Set<string>(),
        add(name: string) { this.added.add(name); },
        remove(name: string) { this.removed.add(name); },
        contains() { return false; }
      },
      nextElementSibling: null,
      after() {}
    };

    await tree._toggleDir({ path: '/root/sub' }, row);
    assert.equal(tree._treeExpanded.has('/root/sub'), true);
    assert.equal(row.classList.added.has('is-expanded'), true);
    assert.deepEqual(renderCalls, ['/root/sub']);
    assert.deepEqual(createdTags, ['div'], '展开时应创建子节点容器');

    await tree._toggleDir({ path: '/root/sub' }, row);
    assert.equal(tree._treeExpanded.has('/root/sub'), false);
    assert.equal(row.classList.removed.has('is-expanded'), true);
    assert.deepEqual(renderCalls, ['/root/sub'], '收起时不应重新渲染子节点');
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

test('_toggleDir 收起时移除相邻的子节点容器', async () => {
  const tree = createTree();
  tree._treeExpanded.add('/root/sub');
  const removed: unknown[] = [];
  const row = {
    classList: {
      add() {},
      remove(name: string) {},
      contains(name: string) { return name === 'is-expanded'; }
    },
    nextElementSibling: {
      classList: { contains(name: string) { return name === 'file-tree-children'; } },
      remove() { removed.push(this); }
    },
    after() {}
  };

  await tree._toggleDir({ path: '/root/sub' }, row);
  assert.equal(tree._treeExpanded.has('/root/sub'), false);
  assert.equal(removed.length, 1, '展开过的子节点容器应被移除');
});

test('根目录持久化到 localStorage 并可恢复', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); }
  };
  try {
    const tree = createTree();
    tree._saveFileTreeRoot('C:\\Users\\me\\notes');
    assert.equal(tree._loadFileTreeRoot(), 'C:\\Users\\me\\notes');
    assert.equal(store.size, 1);

    tree._saveFileTreeRoot('/home/me/docs');
    assert.equal(tree._loadFileTreeRoot(), '/home/me/docs');
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('_resetTreeExpanded 清空展开状态，_initTreeExpanded 惰性初始化', () => {
  const tree = createTree();
  tree._treeExpanded.add('/a');
  tree._treeExpanded.add('/b');

  tree._resetTreeExpanded();
  assert.equal(tree._treeExpanded.size, 0);

  delete tree._treeExpanded;
  tree._initTreeExpanded();
  assert.ok(tree._treeExpanded instanceof Set, '缺失时应创建展开状态集合');
});

test('_dirOf 提取父目录，盘符根补反斜杠', () => {
  const tree = createTree();
  assert.equal(tree._dirOf('C:\\docs\\a.md'), 'C:\\docs');
  assert.equal(tree._dirOf('C:\\a.md'), 'C:\\', '盘符根应补反斜杠');
  assert.equal(tree._dirOf('/home/me/a.md'), '/home/me');
  assert.equal(tree._dirOf(''), '');
});

test('_renderCurrentDirFiles：侧边栏折叠或非文件页签时不渲染（不碰列表）', async () => {
  const tree = createTree();
  // 折叠态侧边栏：is-collapsed=true → 守卫应提前返回
  const collapsed = {
    classList: { contains: (c: string) => c === 'is-collapsed' },
    querySelector: () => null
  };
  tree.documentSidebarRef = { current: collapsed };
  tree.documentListRef = { current: { innerHTML: 'ORIGINAL' } };
  await tree._renderCurrentDirFiles();
  assert.equal((tree.documentListRef.current as { innerHTML: string }).innerHTML, 'ORIGINAL', '折叠时应提前返回，不清空列表');

  // 非折叠但停在非文件页签（outline 激活）
  const outlineActive = {
    classList: { contains: () => false },
    querySelector: (sel: string) => (sel === '[data-sidebar-panel="files"]'
      ? { classList: { contains: (c: string) => c === 'is-active' ? false : true } }
      : null)
  };
  tree.documentSidebarRef = { current: outlineActive };
  tree.documentListRef = { current: { innerHTML: 'ORIGINAL' } };
  await tree._renderCurrentDirFiles();
  assert.equal((tree.documentListRef.current as { innerHTML: string }).innerHTML, 'ORIGINAL', '大纲页签时应提前返回');
});
