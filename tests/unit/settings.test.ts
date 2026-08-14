import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  mergeSettings,
  sanitizeSettings,
  saveSettings
} from '../../src/editor/settings.ts';
import { SettingsMethods } from '../../src/editor/settingsMethods.ts';
import { createRef, createSourceStub, createStubElement, installLocalStorageStub } from '../helpers/dom.ts';

// ===== settings.ts：默认合并 / 非法回退 / 读写往返 / 刷新保持 =====

test('未保存任何设置时返回默认值', () => {
  const restore = installLocalStorageStub();
  try {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  } finally {
    restore();
  }
});

test('saveSettings → loadSettings 读写往返保持全部字段', () => {
  const restore = installLocalStorageStub();
  try {
    const settings = {
      spellcheck: false,
      autosave: false,
      exportPageMargin: '18mm 22mm',
      printPaper: 'follow-preview' as const
    };
    saveSettings(settings);
    assert.deepEqual(loadSettings(), settings);
    // 「刷新保持」：raw 落盘内容与设置一致，等价于刷新后重新读取
    const raw = localStorage.getItem(SETTINGS_KEY);
    assert.ok(raw);
    assert.deepEqual(JSON.parse(raw!), settings);
  } finally {
    restore();
  }
});

test('loadSettings 容忍损坏 JSON，回退默认', () => {
  const restore = installLocalStorageStub({ [SETTINGS_KEY]: '{oops' });
  try {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  } finally {
    restore();
  }
});

test('mergeSettings 与默认合并：只覆盖提供的字段，其余保持默认', () => {
  const merged = mergeSettings({ autosave: false });
  assert.equal(merged.autosave, false);
  assert.equal(merged.spellcheck, DEFAULT_SETTINGS.spellcheck);
  assert.equal(merged.exportPageMargin, DEFAULT_SETTINGS.exportPageMargin);
  assert.equal(merged.printPaper, DEFAULT_SETTINGS.printPaper);
});

test('非法值回退：布尔非布尔、printPaper 枚举外、页边距无数字 → 各自回默认', () => {
  const merged = mergeSettings({
    spellcheck: 'yes',
    autosave: 1,
    exportPageMargin: 'abc',
    printPaper: 'pink'
  });
  assert.deepEqual(merged, DEFAULT_SETTINGS);
});

test('部分非法不影响其余合法字段', () => {
  const merged = mergeSettings({
    spellcheck: false,
    autosave: 'nope',
    exportPageMargin: '12mm',
    printPaper: 'follow-preview'
  });
  assert.deepEqual(merged, {
    spellcheck: false,
    autosave: true,
    exportPageMargin: '12mm',
    printPaper: 'follow-preview'
  });
});

test('mergeSettings(null / 非对象) 整体回退默认', () => {
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings('x'), DEFAULT_SETTINGS);
});

test('页边距校验：数字/单位组合通过，空串与纯字母被拒', () => {
  assert.equal(sanitizeSettings({ exportPageMargin: '0' }).exportPageMargin, '0');
  assert.equal(sanitizeSettings({ exportPageMargin: '1in 0.75in' }).exportPageMargin, '1in 0.75in');
  assert.equal(sanitizeSettings({ exportPageMargin: '10% 5%' }).exportPageMargin, '10% 5%');
  assert.equal(sanitizeSettings({ exportPageMargin: ' 14mm 16mm ' }).exportPageMargin, '14mm 16mm');
  assert.equal(sanitizeSettings({ exportPageMargin: '' }).exportPageMargin, DEFAULT_SETTINGS.exportPageMargin);
  assert.equal(sanitizeSettings({ exportPageMargin: '   ' }).exportPageMargin, DEFAULT_SETTINGS.exportPageMargin);
  assert.equal(sanitizeSettings({ exportPageMargin: 'abc' }).exportPageMargin, DEFAULT_SETTINGS.exportPageMargin);
  assert.equal(sanitizeSettings({ exportPageMargin: 123 }).exportPageMargin, DEFAULT_SETTINGS.exportPageMargin);
});

// ===== settingsMethods.ts：autosave 语义边界（B19 不丢稿） =====

// File System Access API 文件句柄替身（与 localFileSyncMethods.test.ts 同形）。
function createFakeHandle(content = '', lastModified = 1000) {
  const state = { content, lastModified, written: [] as string[], permission: 'granted' };
  return {
    state,
    name: 'note.md',
    kind: 'file',
    async getFile() {
      const snapshot = state.content;
      return { name: 'note.md', lastModified: state.lastModified, text: async () => snapshot };
    },
    async createWritable() {
      let buffer = '';
      return {
        async write(data: string) { buffer = data; },
        async close() {
          state.content = buffer;
          state.lastModified += 1;
          state.written.push(buffer);
        }
      };
    },
    async queryPermission() { return state.permission; },
    async requestPermission() { return state.permission; }
  };
}

function createSettingsEditor(handle: ReturnType<typeof createFakeHandle> | null, value: string, settings: unknown) {
  const editor = Object.create(SettingsMethods.prototype);
  return Object.assign(editor, {
    settings,
    fileHandle: handle,
    fileName: 'note.md',
    dirty: false,
    sourceRef: createRef(createSourceStub(value)),
    statuses: [] as string[],
    _localFileModifiedAt: 1000,
    _localWriteBusy: false,
    _localFileConflict: false,
    async _updateLocalFileBaseline() { if (handle) handle.state.lastModified += 1; },
    _setStatus(msg: string) { this.statuses.push(msg); },
    _setDirty(d: boolean) { this.dirty = d; }
  });
}

test('autosave=true（默认）：写穿本地文件照常执行', async () => {
  const handle = createFakeHandle('旧内容', 1000);
  const editor = createSettingsEditor(handle, '编辑后的内容', { ...DEFAULT_SETTINGS, autosave: true });
  editor.dirty = true;

  await editor._maybeWriteThroughLocalFile();

  assert.deepEqual(handle.state.written, ['编辑后的内容']);
  assert.equal(editor.dirty, false);
});

test('autosave=false：跳过写穿本地文件，脏标记保留（草稿由 _persist 保底，显式 ⌘S 仍可保存）', async () => {
  const handle = createFakeHandle('旧内容', 1000);
  const editor = createSettingsEditor(handle, '编辑后的内容', { ...DEFAULT_SETTINGS, autosave: false });
  editor.dirty = true;

  await editor._maybeWriteThroughLocalFile();

  assert.deepEqual(handle.state.written, []);
  assert.equal(editor.dirty, true);
});

test('settings 未初始化时按默认行为（autosave=true）写穿', async () => {
  const handle = createFakeHandle('旧内容', 1000);
  const editor = createSettingsEditor(handle, '编辑后的内容', undefined);
  editor.dirty = true;

  await editor._maybeWriteThroughLocalFile();

  assert.deepEqual(handle.state.written, ['编辑后的内容']);
});

// ===== settingsMethods.ts：设置应用与持久化 =====

test('_applySettings 按设置写入 textarea 与预览的 spellcheck/lang 属性', () => {
  const src = createStubElement();
  const prev = createStubElement();
  const context = {
    settings: { ...DEFAULT_SETTINGS, spellcheck: true },
    sourceRef: createRef(src),
    previewRef: createRef(prev)
  };

  SettingsMethods.prototype._applySettings.call(context);
  assert.equal(src.getAttribute('spellcheck'), 'true');
  assert.equal(prev.getAttribute('spellcheck'), 'true');
  assert.equal(src.getAttribute('lang'), 'zh-CN');

  context.settings = { ...context.settings, spellcheck: false };
  SettingsMethods.prototype._applySettings.call(context);
  assert.equal(src.getAttribute('spellcheck'), 'false');
  assert.equal(prev.getAttribute('spellcheck'), 'false');
});

test('_applySettings 缺省 settings 时从 localStorage 读取并缓存（刷新保持）', () => {
  const restore = installLocalStorageStub({ [SETTINGS_KEY]: JSON.stringify({ spellcheck: false }) });
  try {
    const src = createStubElement();
    const context = { sourceRef: createRef(src), previewRef: createRef(null) };

    SettingsMethods.prototype._applySettings.call(context);
    assert.equal(src.getAttribute('spellcheck'), 'false');
    // 缺省字段合并默认值
    assert.equal(context.settings.autosave, true);
    assert.equal(context.settings.exportPageMargin, DEFAULT_SETTINGS.exportPageMargin);
  } finally {
    restore();
  }
});

test('_setSetting 变更即写 localStorage 并应用，非法值不落库', () => {
  const restore = installLocalStorageStub();
  try {
    const src = createStubElement();
    const prev = createStubElement();
    const statuses: string[] = [];
    const context = Object.create(SettingsMethods.prototype);
    Object.assign(context, {
      settings: { ...DEFAULT_SETTINGS },
      sourceRef: createRef(src),
      previewRef: createRef(prev),
      _settingsEl: null,
      _setStatus(msg: string) { statuses.push(msg); }
    });

    SettingsMethods.prototype._setSetting.call(context, 'spellcheck', false);
    assert.equal(context.settings.spellcheck, false);
    assert.equal(src.getAttribute('spellcheck'), 'false');
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).spellcheck, false);
    assert.ok(statuses.some((msg) => msg.includes('拼写检查已关闭')));

    SettingsMethods.prototype._setSetting.call(context, 'autosave', false);
    assert.equal(context.settings.autosave, false);
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).autosave, false);
    assert.ok(statuses.some((msg) => msg.includes('自动保存已关闭')));
    // 后续改动不得冲掉前面已改的字段（合并基准是当前设置，不是默认值）
    assert.equal(context.settings.spellcheck, false);
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).spellcheck, false);

    // 非法值经消毒回退默认且不写入，同时保留其他已改字段
    SettingsMethods.prototype._setSetting.call(context, 'printPaper', 'pink');
    assert.equal(context.settings.printPaper, 'white');
    assert.equal(context.settings.autosave, false);
    assert.equal(context.settings.spellcheck, false);
    assert.equal(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).printPaper, 'white');
  } finally {
    restore();
  }
});
