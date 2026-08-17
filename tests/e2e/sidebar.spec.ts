import { test, expect, openEditor, setSource, clickMenubarItem } from './fixtures';

// Typora 风格左侧边栏：文件 | 大纲 两页签；大纲在编辑视图可用；分屏滚动双向同步。

test('侧边栏默认收起；文件树按钮展开并切到文件页签', async ({ page }) => {
  await openEditor(page);

  await expect(page.locator('.document-sidebar')).toHaveClass(/is-collapsed/);

  await clickMenubarItem(page, 'view', '文件树');
  await expect(page.locator('.document-sidebar')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('.sidebar-tab[data-sidebar-tab="files"]')).toHaveClass(/is-active/);
  await expect(page.locator('.sidebar-panel[data-sidebar-panel="files"]')).toHaveClass(/is-active/);
});

test('大纲在编辑视图可用：展开侧边栏、列表就位、点击跳转源码行', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 标题一\n\n内容段落\n\n## 子标题二\n\n更多内容');

  // 切到编辑视图（预览隐藏）
  await clickMenubarItem(page, 'view', '编辑视图');
  await expect(page.locator('.md-preview')).toBeHidden();

  // 点「大纲」菜单 → 侧边栏展开 + 大纲页签激活 + 列表有内容
  await clickMenubarItem(page, 'view', '大纲');
  await expect(page.locator('.document-sidebar')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('.sidebar-tab[data-sidebar-tab="outline"]')).toHaveClass(/is-active/);
  const items = page.locator('.outline-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveText('标题一');
  await expect(items.nth(1)).toHaveText('子标题二');

  // 点击大纲条目 → 源码选中标题行（编辑视图下跳源码）
  await items.nth(1).click();
  const sel = await page.locator('.md-source').evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    return { start: ta.selectionStart, text: ta.value.slice(ta.selectionStart, ta.selectionEnd) };
  });
  expect(sel.text).toContain('子标题二');
  expect(sel.start).toBeGreaterThan(0);
});

test('分屏滚动同步：滚源码预览跟随，滚预览源码跟随', async ({ page }) => {
  await openEditor(page);
  const longBody = Array.from({ length: 60 }, (_, i) => `段落 ${i + 1}：这是一段足够长的正文，用来撑高两侧滚动区域。`).join('\n\n');
  await setSource(page, `# 长文标题\n\n${longBody}`);

  const src = page.locator('.md-source');
  const prev = page.locator('.md-preview');
  // 等两侧都真正可滚动
  await expect
    .poll(async () => {
      const s = await src.evaluate((el) => (el as HTMLTextAreaElement).scrollHeight - el.clientHeight);
      const p = await prev.evaluate((el) => el.scrollHeight - el.clientHeight);
      return s > 200 && p > 200;
    })
    .toBe(true);

  // 滚源码到中部 → 预览跟随（比例相近）
  await src.evaluate((el) => { (el as HTMLTextAreaElement).scrollTop = 1200; });
  await expect
    .poll(() => prev.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(100);
  const prevAfter = await prev.evaluate((el) => el.scrollTop);
  // 等待防回环窗口（120ms）过期：同步刚写完 preview，紧接着滚 preview
  // 会被当作回写事件忽略，需等窗口过去（真实用户操作间隔远超此值）
  await page.waitForTimeout(250);

  // 滚预览回顶部 → 源码跟随
  await prev.evaluate((el) => { el.scrollTop = 0; });
  await expect
    .poll(() => src.evaluate((el) => (el as HTMLTextAreaElement).scrollTop))
    .toBe(0);
  // 等待防回环窗口（80ms）过期，避免下一次同步被吞
  await page.waitForTimeout(200);

  // 再滚预览到中部 → 源码跟随（反向同步）
  await prev.evaluate((el, top) => { el.scrollTop = top; }, prevAfter);
  await expect
    .poll(() => src.evaluate((el) => (el as HTMLTextAreaElement).scrollTop))
    .toBeGreaterThan(100);
});

test('收起按钮关闭侧边栏', async ({ page }) => {
  await openEditor(page);

  await clickMenubarItem(page, 'view', '文件树');
  await expect(page.locator('.document-sidebar')).not.toHaveClass(/is-collapsed/);

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.locator('.document-sidebar')).toHaveClass(/is-collapsed/);
});
