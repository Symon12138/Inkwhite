// M5：标签存储纯逻辑单测。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDocId,
  nextUntitledTitle,
  serializeTabs,
  parseTabs,
  migrateLegacyToTabs,
  activeTabOf,
  MAX_TABS,
  type PersistedTab
} from '../../src/editor/tabStore.ts';

function tab(id: string, title = id + '.md'): PersistedTab {
  return { id, title, content: '', fileName: title, filePath: '', comments: [], dirty: false, createdAt: 1 };
}

test('createDocId 唯一且稳定格式', () => {
  const a = createDocId();
  const b = createDocId();
  assert.notEqual(a, b);
  assert.match(a, /^doc-/);
});

test('nextUntitledTitle 依次递增', () => {
  assert.equal(nextUntitledTitle([]), '未命名.md');
  assert.equal(nextUntitledTitle(['未命名.md']), '未命名-2.md');
  assert.equal(nextUntitledTitle(['未命名.md', '未命名-2.md']), '未命名-3.md');
  assert.equal(nextUntitledTitle(['a.md']), '未命名.md');
});

test('序列化往返与上限截断', () => {
  const tabs = Array.from({ length: MAX_TABS + 5 }, (_, i) => tab('t' + i));
  const raw = serializeTabs('t0', tabs);
  const parsed = parseTabs(raw);
  assert.equal(parsed?.tabs.length, MAX_TABS);
  assert.equal(parsed?.activeId, 't0');
});

test('parseTabs 拒绝坏数据', () => {
  assert.equal(parseTabs(null), null);
  assert.equal(parseTabs('not json'), null);
  assert.equal(parseTabs('{"tabs":[]}'), null); // 无 activeId
  assert.equal(parseTabs('{"activeId":"x","tabs":[]}'), null); // active 不存在
  assert.equal(parseTabs('{"activeId":"a","tabs":[' + JSON.stringify(tab('a')) + ']}')?.tabs.length, 1);
});

test('migrateLegacyToTabs：单文档旧数据迁移；空数据不迁移', () => {
  const migrated = migrateLegacyToTabs({ content: '# 旧文档', fileName: 'old.md', comments: [{ id: 1 }] });
  assert.ok(migrated);
  assert.equal(migrated!.tabs.length, 1);
  assert.equal(migrated!.tabs[0].content, '# 旧文档');
  assert.equal(migrated!.tabs[0].fileName, 'old.md');
  assert.deepEqual(migrated!.tabs[0].comments, [{ id: 1 }]);
  assert.equal(activeTabOf(migrated)?.id, migrated!.activeId);
  assert.equal(migrateLegacyToTabs(null), null);
  assert.equal(migrateLegacyToTabs({ content: '' }), null);
});

test('activeTabOf 返回活动标签', () => {
  const snapshot = { activeId: 'b', tabs: [tab('a'), tab('b')] };
  assert.equal(activeTabOf(snapshot)?.id, 'b');
  assert.equal(activeTabOf(null), null);
});
