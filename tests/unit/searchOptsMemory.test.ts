import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SearchReplaceMethods } from '../../src/editor/searchReplaceMethods.ts';

const KEY = 'md-editor-search-opts';

test('搜索开关切换后写入 localStorage，重开时恢复', () => {
  const store = new Map<string, string>();
  const globalAny = globalThis as Record<string, unknown>;
  globalAny.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, v)
  };

  const ctx = {
    _syncSearchOptionButton: SearchReplaceMethods.prototype._syncSearchOptionButton,
    _saveSearchOpts: SearchReplaceMethods.prototype._saveSearchOpts,
    _updateSearchMatches() {},
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchCaseRef: createRefStub(),
    searchWordRef: createRefStub(),
    searchRegexRef: createRefStub()
  };
  function createRefStub() {
    return { current: { classList: { toggle() {} }, setAttribute() {} } };
  }

  SearchReplaceMethods.prototype.toggleSearchCase.call(ctx);
  SearchReplaceMethods.prototype.toggleSearchRegex.call(ctx);
  assert.equal(ctx.searchCaseSensitive, true);
  assert.equal(ctx.searchRegex, true);
  assert.deepEqual(JSON.parse(store.get(KEY)!), { c: true, w: false, r: true });

  // 新实例：模拟重启后恢复
  const ctx2 = {
    _syncSearchOptionButton: SearchReplaceMethods.prototype._syncSearchOptionButton,
    _saveSearchOpts: SearchReplaceMethods.prototype._saveSearchOpts,
    searchCaseSensitive: false,
    searchWholeWord: false,
    searchRegex: false,
    searchCaseRef: createRefStub(),
    searchWordRef: createRefStub(),
    searchRegexRef: createRefStub()
  };
  SearchReplaceMethods.prototype._loadSearchOpts.call(ctx2);
  assert.equal(ctx2.searchCaseSensitive, true);
  assert.equal(ctx2.searchWholeWord, false);
  assert.equal(ctx2.searchRegex, true);

  delete globalAny.localStorage;
});