import { test, expect, openEditor, clickMenubarItem } from './fixtures';
import { ViewMethods } from '../../src/editor/viewMethods.ts';

// 回归：帮助 → 关于 必须显示版本信息，而不是设置面板。
test('帮助 → 关于 显示版本与许可，且不是设置面板', async ({ page }) => {
  await openEditor(page);
  await clickMenubarItem(page, 'help', '关于 飞白 Inkwhite');
  const dialog = page.locator('[role=dialog]').first();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-label', '关于 飞白 Inkwhite');
  const body = await dialog.innerText();
  expect(body).toContain('飞白');
  expect(body).toMatch(/1\.2\.5/);
  expect(body).toContain('MIT');
  expect(body).not.toContain('界面字号');
});

// 纯逻辑回归：错误类消息 5 秒内不得被自动保存覆盖；普通消息不受影响。
test('状态栏消息优先级：错误受保护、普通消息不保护', () => {
  const el = { textContent: '' };
  const ctx: any = {
    saveStatusRef: { current: el },
    sourceRef: { current: {} },
    _persist: () => {},
    _setStatus: ViewMethods.prototype._setStatus,
    _autosave: ViewMethods.prototype._autosave
  };
  const set = ctx._setStatus.bind(ctx);

  set('PDF 导出失败 · 磁盘不可写');
  ctx._autosave();
  expect(el.textContent).toContain('PDF 导出失败');

  // 保护期过后自动保存可恢复
  ctx._statusProtectedUntil = 0;
  ctx._autosave();
  expect(el.textContent).toContain('已自动保存草稿');
});
