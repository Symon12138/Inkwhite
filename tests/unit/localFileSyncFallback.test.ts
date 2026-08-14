// 轮询兜底 timer 的生命周期单测。
// 测试环境默认 tauriBridge 为 null（非 Tauri 环境），`_startLocalFileWatcher` 会提前返回，
// 无法触达 watchFile 失败路径。这里先伪造 Tauri 窗口再动态导入生产模块，
// 使模块级 tauriBridge 为真值，并把 watchFile 桩成 reject，
// 从而端到端覆盖"原生监听失败 → 轮询兜底"分支及其清理。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRef, createSourceStub } from '../helpers/dom.ts';

// 先伪造 Tauri 环境（isTauri() 需要 window.__TAURI_INTERNALS__），再动态导入。
const fakeWindow = {
  __TAURI_INTERNALS__: {},
  addEventListener() {},
  removeEventListener() {}
};
(globalThis as Record<string, unknown>).window = fakeWindow;

const { LocalFileSyncMethods } = await import('../../src/editor/localFileSyncMethods.ts');
const { tauriBridge } = await import('../../src/editor/tauriBridge.ts');
assert.ok(tauriBridge, '伪造 Tauri 窗口后 tauriBridge 应为真值');

// 把 Tauri 桥桩成"原生监听恒失败"，确定性地触发轮询兜底。
const bridge = tauriBridge as {
  watchFile: (path: string) => Promise<void>;
  unwatchFile: (path: string) => Promise<void>;
  onFileChanged: (cb: (path: string) => void) => void;
  offFileChanged: (cb: (path: string) => void) => void;
};
bridge.onFileChanged = () => {};
bridge.offFileChanged = () => {};
bridge.unwatchFile = async () => {};
bridge.watchFile = async () => {
  throw new Error('watch unsupported (test stub)');
};

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createFakeHandle(content = '内容', lastModified = 1000) {
  return {
    name: 'note.md',
    kind: 'file',
    desktopPath: 'C:/notes/note.md',
    async getFile() {
      return { name: 'note.md', lastModified, text: async () => content };
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; }
  };
}

function createFallbackEditor() {
  const editor = Object.create(LocalFileSyncMethods.prototype);
  return Object.assign(editor, {
    fileHandle: createFakeHandle(),
    fileName: 'note.md',
    dirty: false,
    sourceRef: createRef(createSourceStub('内容')),
    _localFileModifiedAt: 1000,
    _localWriteBusy: false,
    _localFileConflict: false,
    // 兜底 timer 只测生命周期；轮询触发后的内容比对由既有用例覆盖。
    _checkLocalFileChange: async () => {},
    _cleanOpenedMarkdown: (text: string) => String(text),
    _setStatus() {},
    _setDirty() {},
    _persist() {},
    _renderPreview() {},
    _renderComments() {},
    _updateCount() {},
    _resetEditingHistory() {}
  });
}

test('watchFile reject 时建立轮询兜底 timer', async () => {
  const editor = createFallbackEditor();
  editor._startLocalFileWatcher();
  await flushMicrotasks();
  assert.ok(editor._watchFallbackTimer, 'watchFile 失败后应建立兜底 timer');
  editor._stopLocalFileWatcher();
});

test('stop 清理兜底 timer', async () => {
  const editor = createFallbackEditor();
  editor._startLocalFileWatcher();
  await flushMicrotasks();
  assert.ok(editor._watchFallbackTimer);
  editor._stopLocalFileWatcher();
  assert.equal(editor._watchFallbackTimer, null);
});

test('detach 后无残留兜底 timer', async () => {
  const editor = createFallbackEditor();
  editor._startLocalFileWatcher();
  await flushMicrotasks();
  assert.ok(editor._watchFallbackTimer);
  editor._detachLocalFile();
  assert.equal(editor._watchFallbackTimer, null);
  assert.equal(editor.fileHandle, null);
});

test('重复启动兜底只保留一个 timer', async () => {
  const editor = createFallbackEditor();
  editor._startLocalFileWatcher();
  await flushMicrotasks();
  const first = editor._watchFallbackTimer;
  assert.ok(first);
  editor._startWatchFallbackPolling();
  assert.equal(editor._watchFallbackTimer, first, '守卫应复用已有 timer，不叠加');
  editor._stopLocalFileWatcher();
});

test('watchFile 失败但句柄已被 detach 时不启动兜底', async () => {
  const editor = createFallbackEditor();
  editor._startLocalFileWatcher();
  editor._detachLocalFile(); // 在 reject settle 之前卸载句柄，模拟"打开后立即关闭"
  await flushMicrotasks();
  assert.ok(!editor._watchFallbackTimer, '句柄已清空时不应残留兜底 timer');
});
