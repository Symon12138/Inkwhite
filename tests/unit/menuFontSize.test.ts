import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, saveSettings, loadSettings } from '../../src/editor/settings.ts';
import { installLocalStorageStub } from '../helpers/dom.ts';

test('菜单字号：旧设置默认16，整数12–24合法，非法回退，保存后恢复', () => {
  assert.equal(sanitizeSettings({}).menuFontSizePx, 16);
  for (const value of [12, 16, 20, 24]) {
    assert.equal(sanitizeSettings({ menuFontSizePx: value }).menuFontSizePx, value);
  }
  for (const value of [null, '20', 11, 25, 16.5, NaN, Infinity]) {
    assert.equal(sanitizeSettings({ menuFontSizePx: value }).menuFontSizePx, 16);
  }
  const restore = installLocalStorageStub();
  try {
    saveSettings(sanitizeSettings({ menuFontSizePx: 22, autosave: false }));
    assert.equal(loadSettings().menuFontSizePx, 22);
    assert.equal(loadSettings().autosave, false);
  } finally { restore(); }
});
