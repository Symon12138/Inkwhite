import { test, expect, openEditor, setSource } from './fixtures';

// S0.3 预览就绪原语（WP8a）：_awaitPreviewReady() = Promise.all([
//   document.fonts.ready, Mermaid 渲染在途计数, 本地图片水合在途计数 ])。
// 钩子挂在 .md-preview 元素上（__awaitPreviewReady），不新增 window 全局；
// 未来导出流程（M2 长图）在组件内部直接调用 this._awaitPreviewReady()。
//
// 关键竞态：setSource 之后不等待任何 DOM，立即调用就绪等待——
// 就绪原语必须等到 Mermaid 渲染完成（无 .is-loading 且 svg 就位）才返回。

test('setSource 含 Mermaid 块后立即就绪等待：返回时无 is-loading 且 svg 就位', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '```mermaid\ngraph TD;\n  A-->B;\n```');

  // 竞态：不轮询 DOM。在就绪等待调用前与返回后各取一次 DOM 状态，
  // 证明"调用时确实还在渲染"且"返回时已渲染完成"。
  const state = await page.locator('.md-preview').evaluate(async (el) => {
    const loadingCount = () => el.querySelectorAll('.mermaid-rendered.is-loading').length;
    const svgCount = () => el.querySelectorAll('.mermaid-rendered svg').length;
    const errorCount = () => el.querySelectorAll('.mermaid-rendered.has-error').length;
    const before = { loading: loadingCount(), svg: svgCount(), errors: errorCount() };
    await el.__awaitPreviewReady();
    return {
      before,
      after: { loading: loadingCount(), svg: svgCount(), errors: errorCount() }
    };
  });

  // 竞态成立：调用就绪等待时 Mermaid 确实还在加载（冷加载 mermaid 模块）
  expect(state.before.loading).toBeGreaterThan(0);
  expect(state.before.svg).toBe(0);

  // 等待返回时渲染已完成：无 loading、无错误、svg 就位
  expect(state.after.loading).toBe(0);
  expect(state.after.errors).toBe(0);
  expect(state.after.svg).toBeGreaterThan(0);
});

test('含本地路径图片时就绪等待不被图片阻塞，img src 非空', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '# 图片水合',
    '',
    '![本地图片](images/cover.png)',
    '![内联图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)'
  ].join('\n'));

  // 注：图片水合（_hydrateLocalImages 把相对路径换成磁盘 data URL）只在
  // Tauri 桌面端生效——浏览器 E2E 环境 tauriBridge 为 null，水合分支不执行，
  // 图片保持原 src。此用例覆盖的是：就绪等待在存在图片时不被挂起，
  // 且 img 的 src 始终非空（Tauri 侧水合完成路径由 pendingTracker 单测覆盖）。
  const srcs = await page.locator('.md-preview').evaluate(async (el) => {
    await el.__awaitPreviewReady();
    return Array.from(el.querySelectorAll('img')).map((img) => img.getAttribute('src'));
  });
  expect(srcs.length).toBe(2);
  expect(srcs.every((src) => !!src)).toBe(true);
});

test('重复调用就绪等待幂等：第二次调用立即返回且状态不变', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '# 幂等\n\n```mermaid\ngraph TD;\n  A-->B;\n```');
  const state = await page.locator('.md-preview').evaluate(async (el) => {
    await el.__awaitPreviewReady();
    const first = el.querySelectorAll('.mermaid-rendered svg').length;
    await el.__awaitPreviewReady();
    return {
      first,
      second: el.querySelectorAll('.mermaid-rendered svg').length,
      loading: el.querySelectorAll('.mermaid-rendered.is-loading').length
    };
  });
  expect(state.first).toBeGreaterThan(0);
  expect(state.second).toBe(state.first);
  expect(state.loading).toBe(0);
});
