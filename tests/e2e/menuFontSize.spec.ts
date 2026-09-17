import { test, expect, openEditor } from './fixtures';

test('菜单字号即时应用、正文隔离、刷新保持与恢复默认', async ({ page }) => {
  await openEditor(page);
  const source = page.locator('.md-source');
  const preview = page.locator('.md-preview');
  const sourceSize = await source.evaluate(el => getComputedStyle(el).fontSize);
  const previewSize = await preview.evaluate(el => getComputedStyle(el).fontSize);
  await page.locator('[data-menubar-trigger="theme"]').click();
  await page.getByRole('menuitem', { name: '设置…', exact: true }).click();
  const select = page.getByRole('combobox', { name: '菜单字号' });
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
  await page.getByRole('button', { name: '恢复默认菜单字号' }).click();
  await expect(select).toHaveValue('16');
  await expect(page.locator('.menubar-trigger').first()).toHaveCSS('font-size', '16px');
});
