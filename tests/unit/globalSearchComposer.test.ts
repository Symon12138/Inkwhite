// M4-P7：跨文件搜索纯逻辑单测（结果分组/排序/过滤/截断/行展示）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupHits,
  filterHitsByQuery,
  truncateHits,
  formatHitLine,
  type SearchHitLike
} from '../../src/editor/globalSearchComposer.ts';

function hit(path: string, name: string, line: string, lineNumber: number): SearchHitLike {
  return { path, name, line, lineNumber };
}

test('groupHits 按路径分组并保持首次出现顺序，组内按行号排序', () => {
  const groups = groupHits([
    hit('C:\\b.md', 'b.md', '行2', 2),
    hit('C:\\a.md', 'a.md', '行1', 1),
    hit('C:\\b.md', 'b.md', '行1', 1)
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, 'b.md'); // 首次出现顺序
  assert.deepEqual(groups[0].hits.map((h) => h.lineNumber), [1, 2]);
  assert.equal(groups[1].name, 'a.md');
});

test('filterHitsByQuery 按文件名/路径过滤，空查询原样返回', () => {
  const hits = [
    hit('C:\\docs\\note.md', 'note.md', 'x', 1),
    hit('C:\\docs\\readme.md', 'readme.md', 'x', 1)
  ];
  assert.equal(filterHitsByQuery(hits, 'note').length, 1);
  assert.equal(filterHitsByQuery(hits, 'readme').length, 1);
  assert.equal(filterHitsByQuery(hits, '').length, 2);
  assert.equal(filterHitsByQuery(hits, '不存在').length, 0);
});

test('truncateHits 截断并标记', () => {
  const hits = [hit('a', 'a', '1', 1), hit('a', 'a', '2', 2), hit('a', 'a', '3', 3)];
  const r1 = truncateHits(hits, 5);
  assert.equal(r1.truncated, false);
  assert.equal(r1.hits.length, 3);
  const r2 = truncateHits(hits, 2);
  assert.equal(r2.truncated, true);
  assert.equal(r2.hits.length, 2);
});

test('formatHitLine 压缩空白并截断', () => {
  assert.equal(formatHitLine('  你好  世界  '), '你好 世界');
  assert.equal(formatHitLine('a'.repeat(100), 20).length, 20);
  assert.equal(formatHitLine('短行'), '短行');
});
