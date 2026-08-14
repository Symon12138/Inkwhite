import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommentMethods } from '../../src/editor/commentMethods.ts';

function createEditor() {
  const editor = Object.create(CommentMethods.prototype);
  editor.comments = [];
  return editor;
}

test('_commentText 附带贴入的回复', () => {
  const editor = createEditor();

  const text = editor._commentText(
    { type: 'idea', quote: '原文片段', note: '如何衡量这个效率？', reply: '从另一本书里找到的答案' },
    0
  );

  assert.match(text, /我的想法：如何衡量这个效率？/);
  assert.match(text, /找到的回答：从另一本书里找到的答案/);
});

test('_commentText 没有回复时不输出回答行', () => {
  const editor = createEditor();

  const text = editor._commentText({ type: 'idea', quote: '原文片段', note: '想法' }, 0);

  assert.doesNotMatch(text, /找到的回答/);
});

test('_fullWithComments 输出贴入的回复', () => {
  const editor = createEditor();
  editor.sourceRef = { current: { value: '正文内容' } };
  editor.fileName = 'note.md';
  editor.comments = [
    { type: 'idea', quote: '原文片段', note: '如何衡量这个效率？', reply: '从另一本书里找到的答案' }
  ];

  const out = editor._fullWithComments();

  assert.match(out, /找到的回答/);
  assert.match(out, /从另一本书里找到的答案/);
});

test('_applyCommentsPanelWidth 按窗口夹取宽度并同步面板与分栏变量', () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { innerWidth: 1400 }, configurable: true });
  try {
    const aside = { style: {} as Record<string, string> };
    const vars: Record<string, string> = {};
    const split = { style: { setProperty: (k: string, v: string) => { vars[k] = v; } } };
    const editor = Object.create(CommentMethods.prototype);
    Object.assign(editor, {
      commentsRef: { current: aside }, splitRef: { current: split },
      panelOpen: true, commentsPanelWidth: 340
    });

    editor._applyCommentsPanelWidth(500);
    assert.equal(editor.commentsPanelWidth, 500);
    assert.equal(aside.style.width, '500px');
    assert.equal(vars['--active-side-panel-width'], '500px', '开启时同步分栏宽度变量');

    editor._applyCommentsPanelWidth(100);
    assert.equal(editor.commentsPanelWidth, 280, '不小于下限 280');

    editor._applyCommentsPanelWidth(2000);
    assert.equal(editor.commentsPanelWidth, 760, '不超过 min(760, 窗口 60%)');
  } finally {
    if (prev) Object.defineProperty(globalThis, 'window', prev);
    else delete (globalThis as Record<string, unknown>).window;
  }
});

test('批注面板收起时不写分栏宽度变量', () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { innerWidth: 1400 }, configurable: true });
  try {
    const aside = { style: {} as Record<string, string> };
    let wroteVar = false;
    const split = { style: { setProperty: () => { wroteVar = true; } } };
    const editor = Object.create(CommentMethods.prototype);
    Object.assign(editor, {
      commentsRef: { current: aside }, splitRef: { current: split },
      panelOpen: false, commentsPanelWidth: 340
    });

    editor._applyCommentsPanelWidth(420);
    assert.equal(aside.style.width, '420px', '仍更新面板自身宽度');
    assert.equal(wroteVar, false, '面板未开启时不改分栏变量');
  } finally {
    if (prev) Object.defineProperty(globalThis, 'window', prev);
    else delete (globalThis as Record<string, unknown>).window;
  }
});
