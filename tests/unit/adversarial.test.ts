import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadingPositionMethods } from '../../src/editor/readingPositionMethods.ts';
import { EditingFileLayoutMethods } from '../../src/editor/editingFileLayoutMethods.ts';
import { defuseRenderBombs } from '../../src/editor/renderGuard.ts';
import { parseTabs, TABS_STORAGE_KEY } from '../../src/editor/tabStore.ts';
import { createRef, createStubElement, installLocalStorageStub } from '../helpers/dom.ts';

// 对抗性单测：纯函数层的敌意输入必须被容忍且不产生副作用扩散。

const P = ReadingPositionMethods.prototype;
const clean = EditingFileLayoutMethods.prototype._cleanOpenedMarkdown;

function makeReadCtx(previewTop = 0) {
  const preview = createStubElement();
  preview.scrollTop = previewTop;
  return {
    previewRef: createRef(preview),
    localFilePath: 'x.md',
    fileName: 'x.md',
    _readPosKey: P._readPosKey,
    _loadReadPosMap: P._loadReadPosMap,
    _saveReadPos: P._saveReadPos,
    _restoreReadPosSoon: P._restoreReadPosSoon
  };
}

test('read-pos：损坏形状（数组/标量/坏值）不致崩溃', () => {
  const restoreStorage = installLocalStorageStub();
  try {
    for (const poison of ['"[1,2,3]"', '"just text"', '123', 'null', '{"a":{"top":"abc"}}', '{"b":{"top":-9,"ts":1}}']) {
      localStorage.setItem('md-editor-read-pos-v1', poison);
      const ctx = makeReadCtx();
      assert.doesNotThrow(() => P._saveReadPos.call(ctx));
    }
    // 保存后必须是干净的可解析对象
    const raw = JSON.parse(localStorage.getItem('md-editor-read-pos-v1'));
    assert.equal(typeof raw, 'object');
  } finally {
    restoreStorage();
  }
});

test('read-pos：__proto__ 键不外泄到存储结构', () => {
  const restoreStorage = installLocalStorageStub();
  try {
    localStorage.setItem('md-editor-read-pos-v1', '{"__proto__":{"polluted":true},"keep.md":{"top":5,"ts":1}}');
    const ctx = makeReadCtx();
    ctx.previewRef.current.scrollTop = 10;
    P._saveReadPos.call(ctx);
    const map = JSON.parse(localStorage.getItem('md-editor-read-pos-v1'));
    assert.equal(Object.keys(map).includes('__proto__'), false, '__proto__ 不得作为实体键写回');
    assert.ok(map['keep.md'], '正常键保留');
    assert.equal(({}).polluted, undefined, 'Object 原型不得被污染');
  } finally {
    restoreStorage();
  }
});

test('_cleanOpenedMarkdown：病态输入在时限内完成（ReDoS 探针）', () => {
  const probes = [
    '<span data-comment-id=' + 'x'.repeat(120000),
    '<span data-comment-id=t>' .repeat(20000),
    '<sup data-comment-badge=' + 'a'.repeat(120000),
    '<span data-comment-id=' + ('t>'.repeat(5000)) + '</span>',
    '\u00A0'.repeat(300000)
  ];
  for (const probe of probes) {
    const t0 = Date.now();
    let out = '';
    assert.doesNotThrow(() => { out = clean(probe); });
    const cost = Date.now() - t0;
    assert.ok(cost < 2000, '清洗耗时 ' + cost + 'ms 超限（疑似 ReDoS），输入长度 ' + probe.length);
    assert.equal(typeof out, 'string');
  }
});

test('parseTabs：垃圾快照一律返回 null 且不抛出', () => {
  for (const garbage of [
    '', 'null', 'undefined', '"str"', '[]', '{}',
    '{"tabs":[]}', '{"activeId":"a","tabs":[]}',
    '{"activeId":"a","tabs":[{"id":"b"}]}',
    '{"activeId":"a","tabs":"not-array"}',
    '{ broken'
  ]) {
    assert.equal(parseTabs(garbage), null, '应拒绝: ' + garbage.slice(0, 30));
  }
  // 合法最小形状通过
  const ok = parseTabs(JSON.stringify({ activeId: 'a', tabs: [{ id: 'a', title: 't', content: '', fileName: 'f', filePath: '', comments: [], dirty: false, createdAt: 1 }] }));
  assert.ok(ok && ok.activeId === 'a');
});
test('渲染炸弹解除器：超深引用链与超深缩进降级为围栏，普通内容不动', () => {
  const deepQuote = Array.from({ length: 200 }, () => '>').join(' ') + ' 核心文本';
  const fenced = defuseRenderBombs(deepQuote);
  assert.ok(fenced.startsWith('\u0060\u0060\u0060'), '超深引用行应被围栏包裹');
  assert.ok(fenced.includes(deepQuote), '原文完整保留在围栏内');

  const shallow = '> 一层\n> > 两层\n> > > 三层正文';
  assert.equal(defuseRenderBombs(shallow), shallow, '合法浅层引用不得改动');

  const deepIndent = ' '.repeat(120) + '深缩进';
  assert.ok(defuseRenderBombs(deepIndent).startsWith('\u0060\u0060\u0060'), '超深缩进应被围栏包裹');

  const normal = '# 标题\n\n正文段落\n- 列表';
  assert.equal(defuseRenderBombs(normal), normal, '普通文档逐字不动');
});
