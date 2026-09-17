import { test, expect, openEditor } from './fixtures';

for (const size of [16, 24]) {
  test('窄屏换行菜单保持在视口内：' + size + 'px', async ({ page }) => {
    await openEditor(page);
    await page.locator('[data-menubar-trigger="theme"]').click();
    await page.getByRole('menuitem', { name: '设置…', exact: true }).click();
    await page.getByRole('combobox', { name: '界面字号' }).selectOption(String(size));
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 480, height: 600 });
    for (const key of ['file', 'edit', 'para', 'format', 'view', 'theme', 'help']) {
      await page.locator('[data-menubar-trigger="' + key + '"]').click();
      const menu = page.locator('[data-menubar="' + key + '"] .menubar-menu');
      await expect.poll(() => menu.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      })).toBe(true);
      const last = menu.getByRole('menuitem').last();
      await last.scrollIntoViewIfNeeded();
      expect(await last.evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 960, height: 600 });
    await page.locator('[data-menubar-trigger="help"]').click();
    await page.setViewportSize({ width: 480, height: 400 });
    const menu = page.getByRole('menu', { name: '帮助菜单' });
    await expect.poll(() => menu.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    })).toBe(true);
  });
}

test('界面字号即时应用、正文隔离、刷新保持与恢复默认', async ({ page }) => {
  await openEditor(page);
  const source = page.locator('.md-source');
  const preview = page.locator('.md-preview');
  const sourceSize = await source.evaluate(el => getComputedStyle(el).fontSize);
  const previewSize = await preview.evaluate(el => getComputedStyle(el).fontSize);
  await page.locator('[data-menubar-trigger="theme"]').click();
  await page.getByRole('menuitem', { name: '设置…', exact: true }).click();
  const select = page.getByRole('combobox', { name: '界面字号' });
  await expect(select).toHaveValue('16');
  await select.selectOption('24');
  await expect(page.locator('.menubar-trigger').first()).toHaveCSS('font-size', '24px');
  await expect(source).toHaveCSS('font-size', sourceSize);
  await expect(preview).toHaveCSS('font-size', previewSize);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.menubar-trigger').first()).toHaveCSS('font-size', '24px');
  await page.setViewportSize({ width: 760, height: 600 });
  await page.locator('[data-menubar-trigger="file"]').click();
  const last = page.getByRole('menuitem', { name: '导出 Word…', exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveCSS('font-size', '24px');
  expect(await last.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
  await page.keyboard.press('Escape');
  await preview.click({ button: 'right' });
  await expect(page.locator('.context-menu-item').first()).toHaveCSS('font-size', '24px');
  await page.keyboard.press('Escape');
  await page.locator('[data-menubar-trigger="theme"]').click();
  await page.getByRole('menuitem', { name: '设置…', exact: true }).click();
  await expect(select).toHaveValue('24');
  await page.getByRole('button', { name: '恢复默认界面字号' }).click();
  await expect(select).toHaveValue('16');
  await expect(page.locator('.menubar-trigger').first()).toHaveCSS('font-size', '16px');
});
