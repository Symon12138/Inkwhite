import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedAnnotations, extractAnnotations } from '../../src/editor/annotationFile.ts';

test('无批注时不嵌入注释块', () => {
  const out = embedAnnotations('# 标题\n正文', []);
  assert.equal(out, '# 标题\n正文');
  assert.ok(!out.includes('inkwhite-annotations'));
});

test('有批注时在末尾嵌入 HTML 注释', () => {
  const ann = [{ id: 'a1', quote: 'hello', occ: 0, type: 'marker', note: '想法', ts: 123 }];
  const out = embedAnnotations('# 标题\n正文', ann);
  assert.ok(out.includes('inkwhite-annotations:'));
  assert.ok(out.trim().endsWith('-->'));
  // 原内容保留在前
  assert.ok(out.startsWith('# 标题\n正文'));
});

test('提取：含注释的文件可还原批注与干净内容', () => {
  const ann = [{ id: 'a1', quote: 'hello', occ: 0, type: 'marker', note: '测试', ts: 1 }, { id: 'a2', quote: '世界', occ: 0, type: 'idea', note: '中文', ts: 2 }];
  const content = '# 标题\n正文';
  const embedded = embedAnnotations(content, ann);
  const extracted = extractAnnotations(embedded);
  assert.equal(extracted.content, content);
  assert.deepEqual(extracted.annotations, ann);
});

test('提取：无注释时返回原内容与 null', () => {
  const r = extractAnnotations('# 标题\n正文');
  assert.equal(r.content, '# 标题\n正文');
  assert.equal(r.annotations, null);
});

test('提取：损坏的 base64 / JSON 不抛出，返回原内容', () => {
  const bad = '# 标题\n<!-- inkwhite-annotations: not-base64! -->';
  const r = extractAnnotations(bad);
  assert.equal(r.annotations, null);
  // 损坏块应被移除还是保留？ 设计：损坏块移除，内容为干净部分
  assert.ok(!r.content.includes('inkwhite-annotations'));
});

test('重复嵌入：已含注释的文件再次嵌入应替换而非追加', () => {
  const a1 = [{ id: 'a1', quote: 'q1', occ: 0, type: 'marker', note: 'n1', ts: 1 }];
  const a2 = [{ id: 'a1', quote: 'q1', occ: 0, type: 'marker', note: 'n2', ts: 2 }];
  const content = '# 标题';
  const first = embedAnnotations(content, a1);
  const second = embedAnnotations(first, a2);
  // 只应有一个注释块
  const count = (second.match(/inkwhite-annotations/g) || []).length;
  assert.equal(count, 1);
  assert.deepEqual(extractAnnotations(second).annotations, a2);
});

test('清空批注时移除注释块', () => {
  const ann = [{ id: 'a1', quote: 'q', occ: 0, type: 'marker', note: 'n', ts: 1 }];
  const embedded = embedAnnotations('# 标题', ann);
  const cleaned = embedAnnotations(embedded, []);
  assert.equal(cleaned, '# 标题');
});

test('中文与特殊字符往返', () => {
  const ann = [{ id: 'a1', quote: '“中文”', occ: 0, type: 'idea', note: '备注：😊 特殊\n换行', ts: 1 }];
  const content = '# 标题';
  const embedded = embedAnnotations(content, ann);
  const r = extractAnnotations(embedded);
  assert.deepEqual(r.annotations, ann);
});