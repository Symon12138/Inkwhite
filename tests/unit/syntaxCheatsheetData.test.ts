import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNTAX_CATEGORIES, SYNTAX_ENTRIES, filterEntries, getCategories, getEntriesByCategory, findEntry } from '../../src/editor/syntaxCheatsheetData.ts';

test('语法数据：分类与条目数量合理', () => {
  assert.ok(SYNTAX_CATEGORIES.length >= 8, '至少 8 个分类');
  assert.ok(SYNTAX_ENTRIES.length >= 25, '至少 25 条语法，实际 ' + SYNTAX_ENTRIES.length);
  // 每个条目必填
  for (const e of SYNTAX_ENTRIES) {
    assert.ok(e.id, 'id missing: ' + e.title);
    assert.ok(e.title, 'title missing: ' + e.id);
    assert.ok(e.category, 'category missing: ' + e.id);
    assert.ok(e.syntax, 'syntax missing: ' + e.id);
    assert.ok(e.insertText, 'insertText missing: ' + e.id);
  }
});

test('getCategories 返回副本，不污染原数组', () => {
  const a = getCategories();
  const b = getCategories();
  assert.notEqual(a, b);
  assert.equal(a.length, SYNTAX_CATEGORIES.length);
});

test('getEntriesByCategory 按分类过滤', () => {
  const headers = getEntriesByCategory('headers');
  assert.ok(headers.length >= 1);
  assert.ok(headers.every((e) => e.category === 'headers'));
  const empty = getEntriesByCategory('不存在的分类');
  assert.equal(empty.length, 0);
});

test('findEntry 精确查找', () => {
  assert.ok(findEntry('bold'));
  assert.equal(findEntry('bold')?.title, '粗体');
  assert.equal(findEntry('不存在'), undefined);
});

test('filterEntries 空查询返回全部', () => {
  assert.equal(filterEntries('', SYNTAX_ENTRIES).length, SYNTAX_ENTRIES.length);
  assert.equal(filterEntries('  ', SYNTAX_ENTRIES).length, SYNTAX_ENTRIES.length);
});

test('filterEntries 按标题/描述/语法过滤（大小写不敏感）', () => {
  assert.ok(filterEntries('粗体', SYNTAX_ENTRIES).some((e) => e.id === 'bold'));
  assert.ok(filterEntries('BOLD', SYNTAX_ENTRIES).some((e) => e.id === 'bold') || filterEntries('粗体', SYNTAX_ENTRIES).length > 0);
  assert.ok(filterEntries('表格', SYNTAX_ENTRIES).length >= 1);
  assert.ok(filterEntries('```', SYNTAX_ENTRIES).some((e) => e.category === 'code'));
  assert.equal(filterEntries('绝对不存在的词xyz123', SYNTAX_ENTRIES).length, 0);
});

test('关键语法条目存在', () => {
  for (const id of ['h-hash', 'bold', 'ul', 'quote', 'inline-code', 'fenced-code', 'link-inline', 'image', 'table', 'hr', 'footnote', 'toc', 'math-inline', 'task', 'emoji', 'frontmatter']) {
    assert.ok(findEntry(id), '关键条目缺失: ' + id);
  }
});
