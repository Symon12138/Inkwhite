// M3-TABLE：表格编辑纯逻辑单测（tableEditComposer.ts）。
// token 定位示例用 marked.lexer（独立实例）拿 table token 的 raw 偏移。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { editTable, collectTableRanges, type TableRange } from '../../src/editor/tableEditComposer.ts';

const BASIC = [
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '| 3 | 4 |'
].join('\n');

function rangeOf(markdown: string, at = 0): TableRange {
  const m = new Marked({ gfm: true, breaks: true });
  const tokens = m.lexer(markdown);
  const ranges = collectTableRanges(tokens);
  assert.ok(ranges.length > at, '应找到表格 token');
  return ranges[at];
}

// ===== 插入行 =====

test('insertRow below：在第二数据行下插入，格式与源一致', () => {
  const md = BASIC;
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertRow', at: 'below', rowIndex: 1 });
  assert.equal(out, [
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '| 3 | 4 |'
  ].join('\n'));
});

test('insertRow above：第一数据行上方插入', () => {
  const md = BASIC;
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertRow', at: 'above', rowIndex: 0 });
  assert.equal(out, [
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 1 | 2 |',
    '| 3 | 4 |'
  ].join('\n'));
});

test('insertRow 含转义管道：单元格 \\| 不切分，复制后保留', () => {
  const md = ['| a\\|b | c |', '| --- | --- |', '| 1 | 2 |'].join('\n');
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertRow', at: 'below', rowIndex: 0 });
  assert.equal(out, [
    '| a\\|b | c |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 1 | 2 |'
  ].join('\n'));
});

test('insertRow 无空格紧凑风格保持', () => {
  const md = ['|a|b|', '|-|-|', '|1|2|'].join('\n');
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertRow', at: 'below', rowIndex: 0 });
  assert.equal(out, ['|a|b|', '|-|-|', '|1|2|', '|1|2|'].join('\n'));
});

test('insertRow 行索引越界返回原样', () => {
  const md = BASIC;
  const r = rangeOf(md);
  assert.equal(editTable(md, r, { type: 'insertRow', at: 'below', rowIndex: 99 }), md);
});

// ===== 删除行 =====

test('deleteRow 中间行', () => {
  const md = BASIC;
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'deleteRow', rowIndex: 0 });
  assert.equal(out, ['| a | b |', '| --- | --- |', '| 3 | 4 |'].join('\n'));
});

test('deleteRow 最后一行 → 整表删除（返回空块）', () => {
  const md = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'deleteRow', rowIndex: 0 });
  // 表格区间替换为空：剩余源码 = 空（文档只有表格时）
  assert.equal(out, '');
});

test('deleteRow 越界返回原样', () => {
  const md = BASIC;
  const r = rangeOf(md);
  assert.equal(editTable(md, r, { type: 'deleteRow', rowIndex: 5 }), md);
});

// ===== 插入列 =====

test('insertColumn right：每行与分隔行同步加空单元格', () => {
  const md = BASIC;
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertColumn', at: 'right', colIndex: 1 });
  assert.equal(out, [
    '| a | b |  |',
    '| --- | --- | --- |',
    '| 1 | 2 |  |',
    '| 3 | 4 |  |'
  ].join('\n'));
});

test('insertColumn left：表头前插入', () => {
  const md = BASIC;
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertColumn', at: 'left', colIndex: 0 });
  assert.equal(out, [
    '|  | a | b |',
    '| --- | --- | --- |',
    '|  | 1 | 2 |',
    '|  | 3 | 4 |'
  ].join('\n'));
});

test('insertColumn 含 \\| 行：按未转义管道切分后插入', () => {
  const md = ['| a\\|b | c |', '| --- | --- |', '| 1 | 2 |'].join('\n');
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertColumn', at: 'right', colIndex: 1 });
  assert.equal(out, [
    '| a\\|b | c |  |',
    '| --- | --- | --- |',
    '| 1 | 2 |  |'
  ].join('\n'));
});

test('insertColumn 列索引越界钳制到边界', () => {
  const md = BASIC;
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'insertColumn', at: 'right', colIndex: 9 });
  assert.ok(out.startsWith('| a | b |  |'));
});

// ===== 删除列 =====

test('deleteColumn 含对齐的分隔行同步删除', () => {
  const md = ['| a | b | c |', '| :--- | ---: | :---: |', '| 1 | 2 | 3 |'].join('\n');
  const r = rangeOf(md);
  const out = editTable(md, r, { type: 'deleteColumn', colIndex: 1 });
  assert.equal(out, ['| a | c |', '| :--- | :---: |', '| 1 | 3 |'].join('\n'));
});

test('deleteColumn 越界返回原样', () => {
  const md = BASIC;
  const r = rangeOf(md);
  assert.equal(editTable(md, r, { type: 'deleteColumn', colIndex: 5 }), md);
});

// ===== 改对齐 =====

test('setAlign 三种对齐修改分隔行', () => {
  const md = BASIC;
  const r = rangeOf(md);
  assert.equal(
    editTable(md, r, { type: 'setAlign', colIndex: 0, align: 'center' }),
    ['| a | b |', '| :---: | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n')
  );
  assert.equal(
    editTable(md, r, { type: 'setAlign', colIndex: 1, align: 'right' }),
    ['| a | b |', '| --- | ---: |', '| 1 | 2 |', '| 3 | 4 |'].join('\n')
  );
});

test('setAlign 无分隔行的表原样返回（不可改对齐）', () => {
  const md = ['| a | b |', '| 1 | 2 |'].join('\n');
  const m = new Marked({ gfm: true, breaks: true });
  const tokens = m.lexer(md);
  const ranges = collectTableRanges(tokens);
  if (!ranges.length) return; // 无分隔行不是 GFM 表格，lexer 不会产出 table token
  assert.equal(editTable(md, ranges[0], { type: 'setAlign', colIndex: 0, align: 'center' }), md);
});

test('setAlign 列越界返回原样', () => {
  const md = BASIC;
  const r = rangeOf(md);
  assert.equal(editTable(md, r, { type: 'setAlign', colIndex: 9, align: 'left' }), md);
});

// ===== token 定位与误判防护 =====

test('代码块/脚注/Front Matter 内的 | 不产生 table token，编辑只命中真实表格', () => {
  const md = [
    '---',
    'title: a|b',
    '---',
    '',
    '```text',
    '| 代码里的表 |',
    '```',
    '',
    '[^1]: 注释 a|b',
    '',
    '正文[^1]',
    '',
    BASIC
  ].join('\n');
  const m = new Marked({ gfm: true, breaks: true });
  const tokens = m.lexer(md);
  const ranges = collectTableRanges(tokens);
  assert.equal(ranges.length, 1, '只有真实表格产生 table token');
  const out = editTable(md, ranges[0], { type: 'insertRow', at: 'below', rowIndex: 1 });
  // 非表格区域逐字节不变，表格区域已插入一行
  assert.ok(out.includes('| 代码里的表 |'));
  assert.ok(out.includes('title: a|b'));
  assert.ok(out.includes('[^1]: 注释 a|b'));
  assert.ok(out.includes('| 3 | 4 |\n| 3 | 4 |'));
});

test('collectTableRanges 偏移与源码 slice 对应', () => {
  const md = '开头段落\n\n' + BASIC + '\n\n结尾';
  const m = new Marked({ gfm: true, breaks: true });
  const tokens = m.lexer(md);
  const ranges = collectTableRanges(tokens);
  assert.equal(ranges.length, 1);
  const slice = md.slice(ranges[0].start, ranges[0].end);
  assert.equal(slice, BASIC);
});

test('无效区间/越界 range 返回原样（幂等）', () => {
  const md = BASIC;
  assert.equal(editTable(md, { start: -1, end: 5 }, { type: 'insertRow', at: 'below', rowIndex: 0 }), md);
  assert.equal(editTable(md, { start: 10, end: 9999 }, { type: 'insertRow', at: 'below', rowIndex: 0 }), md);
  assert.equal(editTable(md, { start: 8, end: 8 }, { type: 'insertRow', at: 'below', rowIndex: 0 }), md);
});
