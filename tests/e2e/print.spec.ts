import { test, expect, openEditor, setSource, clickMenubarItem } from './fixtures';
import type { Page } from '@playwright/test';

// S0.3 打印样式层（WP8a）：Playwright Chromium 与 WebView2 同渲染引擎，
// emulateMedia(print) + page.pdf() 可代理桌面端「打印 CSS」链路。
// 判定基准（DG1，2026-08-12）：打印默认白纸黑字——暗纸预览下打印时
// 强制白底黑字，Mermaid 暗色图反色输出。

// print 媒体下断言一组选择器的全部匹配元素都隐藏（display:none 或不可见）。
async function expectAllHiddenInPrint(page: Page, selector: string) {
  const displays = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).display)
  );
  expect(displays.length).toBeGreaterThan(0);
  expect(displays.every((d) => d === 'none')).toBe(true);
}

test('print 媒体：隐藏 app 壳层，只留 .md-preview 版心，表格恢复原生布局，Mermaid 不超宽', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '# 打印样式回归',
    '',
    '正文段落：打印样式层只输出`.md-preview`版心，壳层全部隐藏。',
    '',
    '| 列A | 列B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```mermaid',
    'graph TD;',
    '  A-->B;',
    '```'
  ].join('\n'));

  // 先等预览就绪（字体 + Mermaid 渲染完成）再切 print 媒体与出 PDF
  await page.locator('.md-preview').evaluate((el) => el.__awaitPreviewReady());
  await expect(page.locator('.mermaid-rendered svg')).toBeVisible();

  // 打开批注面板：验证打印时即使面板开着也被隐藏（!important 压过内联 style）
  await clickMenubarItem(page, 'view', '批注');
  await expect(page.locator('.comments-panel')).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  // 壳层全部隐藏：顶栏 / 底栏 / 源码窗格 / 分隔条 / 侧栏 / 批注面板 / 工具条 / 浮层
  await expectAllHiddenInPrint(page, '.app-header');
  await expectAllHiddenInPrint(page, '.app-footer');
  await expectAllHiddenInPrint(page, '.source-pane');
  await expectAllHiddenInPrint(page, '.editor-divider');
  await expectAllHiddenInPrint(page, '.document-sidebar');
  await expectAllHiddenInPrint(page, '.comments-panel');
  await expectAllHiddenInPrint(page, '.pane-toolbar');
  await expectAllHiddenInPrint(page, '.selection-toolbar');
  await expectAllHiddenInPrint(page, '.outline-list');

  // 版心保留且可见
  await expect(page.locator('.md-preview')).toBeVisible();
  await expect(page.locator('.md-preview h1')).toHaveText('打印样式回归');

  // 表格：display:block 横向滚动容器反转回原生 table 布局
  const tableDisplay = await page.locator('.md-preview table').evaluate((el) => getComputedStyle(el).display);
  expect(tableDisplay).toBe('table');

  // Mermaid：min-width:620px 解除后 svg 收缩进版心，不超宽
  const widths = await page.evaluate(() => {
    const svg = document.querySelector('.mermaid-rendered svg');
    const preview = document.querySelector('.md-preview');
    return {
      svg: svg.getBoundingClientRect().width,
      preview: preview.getBoundingClientRect().width,
      svgMinWidth: getComputedStyle(svg).minWidth
    };
  });
  expect(widths.svgMinWidth).toBe('0px');
  expect(widths.svg).toBeLessThanOrEqual(widths.preview + 1);
  expect(widths.svg).toBeGreaterThan(0);
});

test('DG1：暗纸预览下打印强制白底黑字，Mermaid 暗色图反色', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '# 白纸决策',
    '',
    '```mermaid',
    'graph TD;',
    '  A-->B;',
    '```'
  ].join('\n'));
  await page.locator('.md-preview').evaluate((el) => el.__awaitPreviewReady());

  // 切到墨黑纸（暗纸），再进 print 媒体
  await page.locator('.paper-picker .paper-dot[data-paper="ink"]').click();
  await page.emulateMedia({ media: 'print' });

  // 版心强制白底（DG1：打印默认白纸，不跟随屏幕纸色）
  const bg = await page.locator('.md-preview').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');

  // 暗纸下 Mermaid 以暗色主题渲染（浅字深底），打印时整体反色成白底深线
  const filter = await page.locator('.mermaid-rendered svg').evaluate((el) => getComputedStyle(el).filter);
  expect(filter).toContain('invert');
});

test('page.pdf()：非空、%PDF- 头、至少 1 页（Chromium 同引擎代理 WebView2 打印 CSS）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 打印正文\n\n这是一段用于 PDF 检索的正文。\n\n| A | B |\n|---|---|\n| 1 | 2 |\n');
  // 先就绪再出 PDF：确保字体与渲染完成，正文/表格进入版心
  await page.locator('.md-preview').evaluate((el) => el.__awaitPreviewReady());
  await page.emulateMedia({ media: 'print' });

  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.length).toBeGreaterThan(0);
  expect(pdf.subarray(0, 8).toString('latin1').startsWith('%PDF-')).toBe(true);
  // 页数：/Type /Page（排除 /Pages 根对象）。Chromium 页树对象通常不压缩；
  // 若未来压缩导致计数退化，此断言会红——届时改用手测（PLATFORM_TEST.md）。
  const text = pdf.toString('latin1');
  const pageCount = (text.match(/\/Type\s*\/Page(?![s])/g) || []).length;
  expect(pageCount).toBeGreaterThanOrEqual(1);
});
