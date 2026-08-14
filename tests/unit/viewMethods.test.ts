import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewMethods } from '../../src/editor/viewMethods.ts';
import { createClassList, createRef, createStubElement } from '../helpers/dom.ts';

function createContext() {
  const title = createStubElement();
  const preview = createStubElement();
  return {
    context: {
      previewRef: createRef(preview),
      previewTitleRef: createRef(title),
      previewFullscreen: false
    },
    preview,
    title
  };
}

test('preview stays read-only in split, preview, and immersive layouts', () => {
  const { context, preview, title } = createContext();

  ViewMethods.prototype._syncPreviewEditable.call(context);
  assert.equal(preview.getAttribute('contenteditable'), 'false');
  assert.equal(title.textContent, '预览 · 仅阅读');

  context.previewFullscreen = true;
  ViewMethods.prototype._syncPreviewEditable.call(context);
  assert.equal(preview.getAttribute('contenteditable'), 'false');
  assert.equal(title.textContent, '预览 · 仅阅读');

  context.previewFullscreen = false;
  ViewMethods.prototype._syncPreviewEditable.call(context);
  assert.equal(preview.getAttribute('contenteditable'), 'false');
  assert.equal(title.textContent, '预览 · 仅阅读');
});

test('未选择纸色时：亮色主题默认清爽白，暗色主题默认墨黑，已保存的选择优先', () => {
  const context = { theme: 'light', paperLight: '', paperDark: '' };

  assert.equal(ViewMethods.prototype._resolvedPaper.call(context), 'snow');

  context.theme = 'dark';
  assert.equal(ViewMethods.prototype._resolvedPaper.call(context), 'ink');

  context.theme = 'light';
  context.paperLight = 'cream';
  assert.equal(ViewMethods.prototype._resolvedPaper.call(context), 'cream');
});

test('view modes map to editor-only, split, and preview-only layouts', () => {
  const classList = createClassList();
  const buttons = ['editor', 'split', 'preview'].map((mode) => ({
    dataset: { mode },
    pressed: '',
    setAttribute(name: string, value: string) { if (name === 'aria-pressed') this.pressed = value; }
  }));
  const context = {
    viewMode: 'split',
    splitRef: createRef({ classList }),
    viewModeSwitcherRef: createRef({ querySelectorAll: () => buttons })
  };

  ViewMethods.prototype._syncViewMode.call(context);
  assert.equal(classList.contains('editor-mode-active'), false);
  assert.equal(classList.contains('preview-mode-active'), false);
  assert.deepEqual(buttons.map((button) => button.pressed), ['false', 'true', 'false']);

  context.viewMode = 'editor';
  ViewMethods.prototype._syncViewMode.call(context);
  assert.equal(classList.contains('editor-mode-active'), true);

  context.viewMode = 'preview';
  ViewMethods.prototype._syncViewMode.call(context);
  assert.equal(classList.contains('preview-mode-active'), true);
});

test('未关联本地文件时不改写图片', () => {
  const img = { src: './a.png', getAttribute: () => './a.png' };
  const context = {
    localFilePath: null,
    _localImageCache: new Map<string, string>(),
    _hydrateLocalImages: ViewMethods.prototype._hydrateLocalImages
  };

  context._hydrateLocalImages({ querySelectorAll: () => [img] });

  assert.equal(img.src, './a.png');
});
