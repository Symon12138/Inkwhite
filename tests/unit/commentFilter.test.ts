import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommentMethods } from '../../src/editor/commentMethods.ts';

test('批注筛选：默认 all，切换后按类型过滤并保留原始索引', () => {
  const ctx = {
    _renderComments() {},
    comments: [
      { id: 'a', type: 'marker', quote: 'q1', note: '', ts: 1 },
      { id: 'b', type: 'idea', quote: 'q2', note: '', ts: 2 },
      { id: 'c', type: 'marker', quote: 'q3', note: '', ts: 3 }
    ]
  };

  assert.equal(CommentMethods.prototype._ensureCommentFilter.call(ctx), 'all');

  CommentMethods.prototype._setCommentFilter.call(ctx, 'marker');
  assert.equal(ctx._commentFilter, 'marker');
  assert.equal(CommentMethods.prototype._ensureCommentFilter.call(ctx), 'marker');

  // 过滤逻辑与 _renderComments 内一致
  const filter = CommentMethods.prototype._ensureCommentFilter.call(ctx);
  const filtered = filter === 'all' ? ctx.comments : ctx.comments.filter((c) => c.type === filter);
  assert.deepEqual(filtered.map((c) => c.id), ['a', 'c']);
  assert.deepEqual(filtered.map((c) => ctx.comments.indexOf(c)), [0, 2]);
});

test('批注筛选空态：该类型无批注时 filtered 为空数组', () => {
  const ctx = {
    _renderComments() {}, comments: [{ id: 'a', type: 'idea', quote: 'q', note: '', ts: 1 }] };
  CommentMethods.prototype._setCommentFilter.call(ctx, 'wavy');
  const filter = CommentMethods.prototype._ensureCommentFilter.call(ctx);
  const filtered = ctx.comments.filter((c) => c.type === filter);
  assert.equal(filtered.length, 0);
});