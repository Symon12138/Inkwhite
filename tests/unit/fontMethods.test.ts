import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FontMethods } from '../../src/editor/fontMethods.ts';

// 字体链路：选择一种字体后源码编辑区与预览同时应用（--source-font + --read）。

function fontContext() {
  const ctx = Object.create(FontMethods.prototype);
  const props = new Map<string, string>();
  const style = {
    setProperty(k: string, v: string) { props.set(k, String(v)); },
    removeProperty(k: string) { props.delete(k); }
  };
  ctx._props = props;
  ctx._style = style;
  return ctx;
}

function withDocument(ctx: ReturnType<typeof fontContext>, fn: () => void) {
  const prevDoc = (globalThis as unknown as { document: unknown }).document;
  (globalThis as unknown as { document: unknown }).document = {
    body: { style: ctx._style }
  };
  try { fn(); } finally { (globalThis as unknown as { document: unknown }).document = prevDoc; }
}

test('选择宋体：--source-font 与 --read/纸色字体三变量一起写入（源码+预览同步）', () => {
  const ctx = fontContext();
  ctx.fontFamily = 'songti';
  withDocument(ctx, () => {
    FontMethods.prototype._applyFontFamily.call(ctx);
  });
  const family = "'Songti SC', 'SimSun', 'NSimSun', '宋体', serif";
  assert.equal(ctx._props.get('--source-font'), family);
  assert.equal(ctx._props.get('--read'), family);
  assert.equal(ctx._props.get('--paper-font-body'), family);
  assert.equal(ctx._props.get('--paper-font-heading'), family);
});

test('等宽选项：--source-font 与 --read 同为等宽栈（可切回对齐排版）', () => {
  const ctx = fontContext();
  ctx.fontFamily = 'mono';
  withDocument(ctx, () => {
    FontMethods.prototype._applyFontFamily.call(ctx);
  });
  assert.match(ctx._props.get('--source-font')!, /monospace/);
  assert.match(ctx._props.get('--read')!, /monospace/);
});

test('默认/清空字体：同时移除 --source-font 与 --read（源码回落等宽）', () => {
  const ctx = fontContext();
  ctx.fontFamily = '';
  withDocument(ctx, () => {
    FontMethods.prototype._applyFontFamily.call(ctx);
  });
  assert.equal(ctx._props.has('--source-font'), false);
  assert.equal(ctx._props.has('--read'), false);
  assert.equal(ctx._props.has('--paper-font-body'), false);
});

test('默认值字符串 default：同样只清空不写新值', () => {
  const ctx = fontContext();
  ctx.fontFamily = 'default';
  withDocument(ctx, () => {
    FontMethods.prototype._applyFontFamily.call(ctx);
  });
  assert.equal(ctx._props.has('--source-font'), false);
  assert.equal(ctx._props.has('--read'), false);
});

test('导入字体：--source-font 与 --read 使用导入字体栈', () => {
  const ctx = fontContext();
  ctx.fontFamily = 'imported:MyFont';
  withDocument(ctx, () => {
    FontMethods.prototype._applyFontFamily.call(ctx);
  });
  assert.equal(ctx._props.get('--source-font'), "'MyFont', serif");
  assert.equal(ctx._props.get('--read'), "'MyFont', serif");
});
