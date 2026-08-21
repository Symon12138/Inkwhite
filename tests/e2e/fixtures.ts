import { test as base, expect, type Page } from '@playwright/test';

// 屏蔽对外部域名的请求（Google Fonts 等），保证 E2E 离线可复现、不受网络波动影响。
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(
      (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
      (route) => route.abort()
    );
    await use(page);
  }
});

export { expect };

// 直达编辑器并等待首屏初始化完成。
export async function openEditor(page: Page) {
  await page.goto('/#editor');
  // 查看型默认：首屏即预览视图；编辑类用例统一切到分屏（走真实菜单路径）
  await expect(page.locator('.md-preview h1').first()).toBeVisible();
  await clickMenubarItem(page, 'view', '分屏视图');
  await expect(page.locator('.md-source')).toBeVisible();
}

export async function setSource(page: Page, markdown: string) {
  await page.locator('.md-source').fill(markdown);
}

export async function selectInSource(page: Page, text: string) {
  await page.locator('.md-source').evaluate((el, target) => {
    const source = el as HTMLTextAreaElement;
    const start = source.value.indexOf(target);
    if (start < 0) throw new Error('source does not contain: ' + target);
    source.focus();
    source.setSelectionRange(start, start + target.length);
  }, text);
}

// 打开菜单栏菜单；若该菜单已打开则跳过（toggleMenubar 是开关语义）。
export async function openMenubar(page: Page, key: string) {
  const opened = await page.locator('[data-menubar="' + key + '"]').evaluate((el) => el.classList.contains('is-open'));
  if (!opened) {
    await page.locator('[data-menubar-trigger="' + key + '"]').click();
    await page.waitForTimeout(120);
  }
}

// 打开菜单并点击菜单项（按文本匹配）。
export async function clickMenubarItem(page: Page, key: string, label: RegExp | string) {
  await openMenubar(page, key);
  await page.locator('[data-menubar="' + key + '"] .menubar-menu').getByRole('menuitem', { name: label }).click();
  await page.waitForTimeout(120);
}

// 展开侧边栏「文件」页签。
export async function openSidebarFiles(page: Page) {
  await page.evaluate(() => {
    const sb = document.querySelector('.document-sidebar') as HTMLElement | null;
    if (sb) { sb.classList.remove('is-collapsed'); sb.classList.add('is-mobile-open'); }
    const tab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement | null;
    tab?.click();
  });
}