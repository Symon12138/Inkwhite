import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadingPositionMethods } from '../../src/editor/readingPositionMethods.ts';
import { createRef, createStubElement, installLocalStorageStub } from '../helpers/dom.ts';

const KEY = 'md-editor-read-pos-v1';
const P = ReadingPositionMethods.prototype;

type Preview = ReturnType<typeof createStubElement> & { scrollTop: number };

function makeCtx(overrides: Record<string, unknown> = {}) {
  const preview = createStubElement() as Preview;
  preview.scrollTop = 0; // 桩元素默认无该字段，显式归零对齐真实容器
  const ctx = {
    previewRef: createRef<Preview>(preview),
    localFilePath: '',
    fileName: '未命名.md',
    // 内部互调的同类方法需绑到 ctx（与其它 mixin 测试同一约定）
    _readPosKey: P._readPosKey,
    _loadReadPosMap: P._loadReadPosMap,
    _saveReadPos: P._saveReadPos,
    _restoreReadPosSoon: P._restoreReadPosSoon,
    _awaitPreviewReady: () => Promise.resolve(),
    ...overrides,
  };
  return { ctx, preview };
}

function readMap(): Record<string, { top: number; ts: number }> {
  return JSON.parse(localStorage.getItem(KEY) || '{}');
}

test('滚动位置按文件路径保存（桌面端键）', () => {
  const restoreStorage = installLocalStorageStub();
  try {
    const { ctx, preview } = makeCtx({ localFilePath: 'C:/docs/a.md' });
    preview.scrollTop = 640;
    P._saveReadPos.call(ctx);
    const map = readMap();
    assert.equal(map['C:/docs/a.md'].top, 640);
    assert.ok(map['C:/docs/a.md'].ts > 0);
  } finally {
    restoreStorage();
  }
});

test('无路径草稿回退用 文件名 作键', () => {
  const restoreStorage = installLocalStorageStub();
  try {
    const { ctx, preview } = makeCtx({ fileName: '笔记.md' });
    preview.scrollTop = 320;
    P._saveReadPos.call(ctx);
    assert.equal(readMap()['draft:笔记.md'].top, 320);
  } finally {
    restoreStorage();
  }
});

test('只保留最近 300 篇（超出按时间裁剪）', () => {
  const restoreStorage = installLocalStorageStub();
  try {
    const seed: Record<string, { top: number; ts: number }> = {};
    for (let i = 0; i < 305; i++) seed['doc-' + i] = { top: i, ts: 1000 + i };
    localStorage.setItem(KEY, JSON.stringify(seed));
    const { ctx, preview } = makeCtx({ localFilePath: 'new-doc.md' });
    preview.scrollTop = 99;
    P._saveReadPos.call(ctx);
    const map = readMap();
    assert.equal(Object.keys(map).length, 300);
    assert.equal(map['new-doc.md'].top, 99);
    // 306 条裁到 300：最旧的 6 条（ts 最小的 doc-0..doc-5）被裁掉
    assert.equal(map['doc-0'], undefined);
    assert.equal(map['doc-5'], undefined);
    assert.equal(map['doc-6'].top, 6);
  } finally {
    restoreStorage();
  }
});

test('打标后恢复一次：写回 scrollTop 并消费 pending', async () => {
  const restoreStorage = installLocalStorageStub();
  try {
    localStorage.setItem(KEY, JSON.stringify({ 'C:/docs/a.md': { top: 888, ts: 1 } }));
    const { ctx, preview } = makeCtx({ localFilePath: 'C:/docs/a.md' });
    P._markReadPosRestore.call(ctx);
    assert.equal((ctx as Record<string, unknown>)._readPosPending, true);
    P._restoreReadPosSoon.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 888);
    // pending 已消费：再次渲染不重复干预
    preview.scrollTop = 0;
    P._restoreReadPosSoon.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 0);
  } finally {
    restoreStorage();
  }
});

test('顶部位置（top=0）不触发跳转；未打标不恢复', async () => {
  const restoreStorage = installLocalStorageStub();
  try {
    localStorage.setItem(KEY, JSON.stringify({ 'b.md': { top: 0, ts: 1 } }));
    const { ctx, preview } = makeCtx({ localFilePath: 'b.md' });
    P._markReadPosRestore.call(ctx);
    P._restoreReadPosSoon.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 0);

    // 未打标：即使有记录也不动
    localStorage.setItem(KEY, JSON.stringify({ 'b.md': { top: 500, ts: 2 } }));
    P._restoreReadPosSoon.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 0);
  } finally {
    restoreStorage();
  }
});

test('预览滚动事件经防抖写入存储', async () => {
  const restoreStorage = installLocalStorageStub();
  try {
    const { ctx, preview } = makeCtx({ localFilePath: 'debounce.md' });
    P._initReadingPosition.call(ctx);
    preview.scrollTop = 777;
    (preview as unknown as { dispatch(type: string): void }).dispatch('scroll');
    // 防抖窗口内未保存
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(readMap()['debounce.md'], undefined);
    // 防抖到期后保存
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(readMap()['debounce.md'].top, 777);
  } finally {
    restoreStorage();
  }
});
test('启动时草稿键未命中，路径就绪后按路径键补恢复', async () => {
  const restoreStorage = installLocalStorageStub();
  try {
    localStorage.setItem(KEY, JSON.stringify({ 'C:/docs/late.md': { top: 700, ts: 1 } }));
    const { ctx, preview } = makeCtx({ localFilePath: '' }); // 启动首渲：路径未挂上
    P._markReadPosRestore.call(ctx);
    P._restoreReadPosSoon.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 0); // 草稿键 miss

    // 路径就绪（attach 完成）→ 补恢复命中
    ctx.localFilePath = 'C:/docs/late.md';
    P._retryReadPosWithPath.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 700);

    // 已命中过：再次调用不重复干预
    preview.scrollTop = 5;
    P._retryReadPosWithPath.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 5);
  } finally {
    restoreStorage();
  }
});

test('打标会重置命中标志：切到新文档后仍可补恢复', async () => {
  const restoreStorage = installLocalStorageStub();
  try {
    localStorage.setItem(KEY, JSON.stringify({ 'a.md': { top: 100, ts: 1 }, 'b.md': { top: 200, ts: 2 } }));
    const { ctx, preview } = makeCtx({ localFilePath: 'a.md' });
    P._markReadPosRestore.call(ctx);
    P._restoreReadPosSoon.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 100); // a.md 命中，hit=true

    // 切到 b.md：重新打标（重置 hit）+ 路径变化后补恢复
    ctx.localFilePath = 'b.md';
    P._markReadPosRestore.call(ctx);
    assert.equal((ctx as Record<string, unknown>)._readPosHit, false);
    P._restoreReadPosSoon.call(ctx);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.scrollTop, 200);
  } finally {
    restoreStorage();
  }
});