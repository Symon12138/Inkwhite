import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewMethods } from '../../src/editor/viewMethods.ts';
import { SearchReplaceMethods } from '../../src/editor/searchReplaceMethods.ts';
import { CommentMethods } from '../../src/editor/commentMethods.ts';
import { createRef, createStubElement } from '../helpers/dom.ts';

function fontContext() {
  const preview = createStubElement();
  const source = createStubElement();
  return {
    context: {
      _applyFont: ViewMethods.prototype._applyFont,
      _persist() {},
      _setStatus() {},
      fontSize: 16,
      previewFontSize: 16,
      previewRef: createRef(preview),
      sourceRef: createRef(source),
      fontSizeRef: createRef(createStubElement()),
      previewFontSizeRef: createRef(createStubElement()),
      fullscreenFontSizeRef: createRef(createStubElement())
    },
    preview,
    source
  };
}

test('源码与预览字号独立：_setSourceFont 只改源码，_setPreviewFont 只改预览', () => {
  const { context, preview, source } = fontContext();

  ViewMethods.prototype._setSourceFont.call(context, 20);
  assert.equal(context.fontSize, 20);
  assert.equal(context.previewFontSize, 16);
  assert.equal(source.style.fontSize, '20px');
  assert.equal(preview.style.fontSize, '16px');

  ViewMethods.prototype._setPreviewFont.call(context, 22);
  assert.equal(context.fontSize, 20);
  assert.equal(context.previewFontSize, 22);
  assert.equal(source.style.fontSize, '20px');
  assert.equal(preview.style.fontSize, '22px');
});

test('字号 clamp 到 12–28，_setFont 同步双端（兼容旧行为）', () => {
  const { context } = fontContext();

  ViewMethods.prototype._setFont.call(context, 5);
  assert.equal(context.fontSize, 12);
  assert.equal(context.previewFontSize, 12);

  ViewMethods.prototype._setFont.call(context, 99);
  assert.equal(context.fontSize, 28);
  assert.equal(context.previewFontSize, 28);

  ViewMethods.prototype._setSourceFont.call(context, 3);
  assert.equal(context.fontSize, 12);
});

test('previewFontSize 缺失时 _applyFont 回落到 fontSize（旧数据迁移）', () => {
  const { context, preview, source } = fontContext();
  delete context.previewFontSize;
  context.fontSize = 18;

  ViewMethods.prototype._applyFont.call(context);
  assert.equal(source.style.fontSize, '18px');
  assert.equal(preview.style.fontSize, '18px');
});