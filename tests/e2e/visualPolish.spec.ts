import { test, expect, openEditor, clickMenubarItem } from './fixtures';

test('复核：状态栏是 role=status，数值用等宽数字', async ({ page }) => {
  await openEditor(page);
  const status = page.locator('.save-status');
  await expect(status).toHaveAttribute('role', 'status');
  const numeric = await page.locator('.font-size-value, .word-count').evaluateAll(els =>
    els.map(el => getComputedStyle(el).fontVariantNumeric));
  expect(numeric.every(v => v.includes('tabular-nums'))).toBe(true);
});

test('复核：设置弹层有入场动效且尊重 reduced-motion', async ({ page }) => {
  await openEditor(page);
  await clickMenubarItem(page, 'theme', '设置…');
  const overlay = page.locator('.settings-overlay').first();
  await expect(overlay).toBeVisible();
  const anim = await overlay.evaluate(el => ({
    name: getComputedStyle(el).animationName,
    duration: getComputedStyle(el).animationDuration,
    modal: getComputedStyle(el.querySelector('.settings-modal')).animationName
  }));
  console.log('ANIM ' + JSON.stringify(anim));
  expect(anim.name).not.toBe('none');
  expect(anim.modal).not.toBe('none');
});

test('复核：reduced-motion 下弹层动效被关闭', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openEditor(page);
  await clickMenubarItem(page, 'theme', '设置…');
  const overlay = page.locator('.settings-overlay').first();
  const duration = await overlay.evaluate(el => getComputedStyle(el).animationDuration);
  console.log('REDUCED duration=' + duration);
  expect(parseFloat(duration)).toBeLessThan(0.01);
});
