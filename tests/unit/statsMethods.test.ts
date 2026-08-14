// M4-F：四项统计口径单测（B22）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, countChars, countLines, countParagraphs, computeStats, formatStats } from '../../src/editor/statsMethods.ts';

test('字数：CJK 逐字 + 英文单词', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('你好世界'), 4);
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('你好 hello 世界'), 5);
  assert.equal(countWords('abc123'), 1);
  assert.equal(countWords('中文english混排'), 4 + 1);
});

test('字符数：非空白字符', () => {
  assert.equal(countChars(''), 0);
  assert.equal(countChars('你好 世界'), 4);
  assert.equal(countChars('a b\nc'), 3);
  assert.equal(countChars('  \n\t '), 0);
});

test('行数：空文档 0，普通换行计数', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\nb\n'), 3);
});

test('段落数：按空行分隔的非空块', () => {
  assert.equal(countParagraphs(''), 0);
  assert.equal(countParagraphs('   '), 0);
  assert.equal(countParagraphs('一段'), 1);
  assert.equal(countParagraphs('一段\n\n二段'), 2);
  assert.equal(countParagraphs('一段\n续行\n\n二段'), 2);
  assert.equal(countParagraphs('\n\n一段\n\n\n二段\n\n'), 2);
});

test('computeStats 组合与 formatStats 格式', () => {
  const stats = computeStats('你好 world\n\n第二段');
  assert.deepEqual(stats, { words: 6, chars: 10, lines: 3, paragraphs: 2 });
  assert.equal(formatStats(stats), '6 字 · 10 字符 · 3 行 · 2 段');
});
