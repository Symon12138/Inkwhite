// WP4（S0.1）：DOMPurify × KaTeX 净化决策实证。
// 只读理解 + E2E 固化；不改 src/，不提交 git。断言基于 2026-08-12 实测
// （katex 0.16.47 + dompurify 3.4.x，Chromium，Vite dev），全部经下方测试固化。
//
// ── 决策结论 ─────────────────────────────────────────────────────────────
// 默认 DOMPurify.sanitize() 会【移除】真实 KaTeX 输出中的 <semantics> 与
// <annotation encoding="application/x-tex">：两者位于 dompurify 的
// mathMlDisallowed 名单（dist/purify.es.mjs），不在默认 ALLOWED_TAGS 内；
// <math>/<mrow>/<msup>/<mi>/<mn> 等演示层元素默认保留。
//
// ── M1 决策（2026-08-12 定稿）────────────────────────────────────────────
// 预览管线（src/editor/viewMethods.ts 的 _renderPreview）已把 sanitize 配置改为
// ADD_TAGS: ['semantics', 'annotation']，语义标注在预览中【保留】——
// 无障碍、复制粘贴依赖它。本文件「决策固化」测试仍断言 DOMPurify【默认】移除
// （默认配置行为不变）；「ADD_TAGS 决策路径」测试验证保留配置逐字节一致；
// 末尾「端到端」测试断言真实预览管线【保留】semantics/annotation。
// 1. 若将来要回到「默认移除」，只需去掉 ADD_TAGS 并反转末尾端到端断言。
// 2. 错误态：throwOnError:false 时 KaTeX 产出 <span class="katex-error"
//    title="ParseError: ..." style="color:#cc0000">，DOMPurify 默认原样保留
//    （实测 sanitize 前后字符串完全一致），M1 可直接以 .katex-error 为错误态样式钩子。
// 3. 残留风险：本测试动态 import 的 katex.mjs 与应用打包版同源同版本；若 M1 后
//    升级 katex/dompurify，需重跑本 spec 确认断言仍成立。
// ─────────────────────────────────────────────────────────────────────────
import { test, expect, openEditor, setSource } from './fixtures';

// Vite dev server 从项目根服务 node_modules 下的 ESM 文件（实测可用；
// 若将来 Vite 收紧静态服务，可换 '/@fs/<绝对路径>' 形式）。
const KATEX_URL = '/node_modules/katex/dist/katex.mjs';
const DOMPURIFY_URL = '/node_modules/dompurify/dist/purify.es.mjs';

// 与 M1 计划一致的渲染选项：throwOnError:false（错误态降级）、trust:false（禁
// \href 等信任扩展）、output:'htmlAndMathml'（屏幕阅读器语义 + 视觉 HTML 双轨）。
const KATEX_OPTIONS = { throwOnError: false, trust: false, output: 'htmlAndMathml' };

test('KaTeX 浏览器构建可经 Vite dev 动态加载，renderToString 产出 katex/math 结构', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(
    async ({ katexUrl, options }) => {
      const katex = await import(katexUrl);
      const html = katex.renderToString('x^2', options);
      return { version: katex.version, html };
    },
    { katexUrl: KATEX_URL, options: KATEX_OPTIONS }
  );

  // 精确锁定依赖版本：package.json 中 katex 为直接依赖 0.16.47（精确锁定）
  expect(result.version).toBe('0.16.47');
  // 视觉层：<span class="katex"> 外层 + katex-html 轨道（KaTeX CSS 的挂载点）
  expect(result.html).toContain('<span class="katex">');
  expect(result.html).toContain('<span class="katex-html" aria-hidden="true">');
  // 语义层：MathML 双轨（决策的输入物）——<math> 与 <semantics>/<annotation> 都在
  expect(result.html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
  expect(result.html).toContain('<semantics>');
  expect(result.html).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
});

test('DOMPurify 默认清除 KaTeX 上下文中的 script 与事件属性（XSS 不进入预览）', async ({ page }) => {
  await openEditor(page);
  const sanitized = await page.evaluate(
    async ({ katexUrl, dompurifyUrl, options }) => {
      const katex = await import(katexUrl);
      const DOMPurify = (await import(dompurifyUrl)).default;
      const raw = katex.renderToString('x^2', options);
      // 在真实 KaTeX 输出上叠加 XSS 载荷，验证净化器在公式上下文中同样生效
      const payload = raw + '<script>window.__xss = 1</script><img src="x" onerror="window.__xss = 2">';
      return DOMPurify.sanitize(payload);
    },
    { katexUrl: KATEX_URL, dompurifyUrl: DOMPURIFY_URL, options: KATEX_OPTIONS }
  );

  expect(sanitized).not.toContain('<script');
  expect(sanitized).not.toMatch(/onerror/i);
  // img 本身保留（默认允许），但事件属性已被剥离
  expect(sanitized).toContain('<img src="x">');
  const xss = await page.evaluate(() => (window as any).__xss ?? 0);
  expect(xss).toBe(0);
});

test('决策固化：默认净化移除真实 KaTeX 输出的 semantics/annotation，演示层结构保留', async ({ page }) => {
  await openEditor(page);
  const sanitized = await page.evaluate(
    async ({ katexUrl, dompurifyUrl, options }) => {
      const katex = await import(katexUrl);
      const DOMPurify = (await import(dompurifyUrl)).default;
      const raw = katex.renderToString('x^2', options);
      // 与 src/editor/viewMethods.ts 同款默认调用：DOMPurify.sanitize(html)
      return DOMPurify.sanitize(raw);
    },
    { katexUrl: KATEX_URL, dompurifyUrl: DOMPURIFY_URL, options: KATEX_OPTIONS }
  );

  // ── 结论：默认【移除】（DOMPurify 默认配置行为，与 M1 后预览管线无关）。
  // M1 已把预览管线配置为 ADD_TAGS: ['semantics','annotation']，见末尾端到端用例 ──
  expect(sanitized).not.toContain('<semantics');
  expect(sanitized).not.toContain('<annotation');

  // 保留侧（M1 渲染依赖这些结构存活）：
  expect(sanitized).toContain('<span class="katex">');
  expect(sanitized).toContain('<span class="katex-html" aria-hidden="true">');
  expect(sanitized).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
  // 演示层 MathML（mrow/msup/mi/mn）完整保留
  expect(sanitized).toContain('<mrow><msup><mi>x</mi><mn>2</mn></msup></mrow>');
  // KaTeX CSS 依赖的内联 style 与 class 默认保留
  expect(sanitized).toContain('style="height:0.8141em;"');
  expect(sanitized).toContain('class="mord mathnormal"');

  // 降级细节：<annotation> 移除时其 TeX 文本被提升为 <math> 内的裸文本
  // （若 M1 不加 ADD_TAGS，须接受此表现——语义标注丢失，演示层不受影响）
  expect(sanitized).toContain('</mrow>x^2</math>');
});

test('M1 决策路径验证：ADD_TAGS: [semantics, annotation] 可完整保留语义标注', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(
    async ({ katexUrl, dompurifyUrl, options }) => {
      const katex = await import(katexUrl);
      const DOMPurify = (await import(dompurifyUrl)).default;
      const raw = katex.renderToString('x^2', options);
      const sanitized = DOMPurify.sanitize(raw, { ADD_TAGS: ['semantics', 'annotation'] });
      return { raw, sanitized };
    },
    { katexUrl: KATEX_URL, dompurifyUrl: DOMPURIFY_URL, options: KATEX_OPTIONS }
  );

  // ADD_TAGS 后与原始输出逐字节一致：semantics/annotation/encoding 全部保留
  expect(result.sanitized).toBe(result.raw);
  expect(result.sanitized).toContain('<semantics>');
  expect(result.sanitized).toContain('<annotation encoding="application/x-tex">x^2</annotation>');
  // 且不引入任何额外结构（无脚本、无事件属性）
  expect(result.sanitized).not.toContain('<script');
  expect(result.sanitized).not.toMatch(/onerror/i);
});

test('KATEX 错误行为：throwOnError:false 不抛异常、产出 .katex-error 且净化后原样保留', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(
    async ({ katexUrl, dompurifyUrl }) => {
      const katex = await import(katexUrl);
      const DOMPurify = (await import(dompurifyUrl)).default;
      let errorHtml = '';
      let threw = false;
      let throwMsg = '';
      try {
        errorHtml = katex.renderToString('\\begin{invalid}', { throwOnError: false });
      } catch (e) {
        threw = true;
        throwMsg = e instanceof Error ? e.message : String(e);
      }
      return { errorHtml, sanitized: DOMPurify.sanitize(errorHtml), threw, throwMsg };
    },
    { katexUrl: KATEX_URL, dompurifyUrl: DOMPURIFY_URL }
  );

  // 不抛异常（M1 渲染循环可安全调用）
  expect(result.threw).toBe(false);
  expect(result.throwMsg).toBe('');
  // 错误态结构：.katex-error span + 错误信息 title + errorColor 内联样式
  expect(result.errorHtml).toContain('<span class="katex-error"');
  expect(result.errorHtml).toContain('KaTeX parse error: No such environment: invalid');
  expect(result.errorHtml).toContain('style="color:#cc0000"');
  // 净化前后完全一致：M1 错误态样式钩子不会被 DOMPurify 破坏
  expect(result.sanitized).toBe(result.errorHtml);
});

test('端到端：真实 KaTeX 输出经编辑器预览管线，semantics/annotation 保留（M1 决策）', async ({ page }) => {
  await openEditor(page);
  // 在页面上下文生成真实 KaTeX 输出，再走真实输入链路
  const katexHtml = await page.evaluate(
    async ({ katexUrl, options }) => {
      const katex = await import(katexUrl);
      return katex.renderToString('x^2', options);
    },
    { katexUrl: KATEX_URL, options: KATEX_OPTIONS }
  );
  await setSource(page, katexHtml);

  // 预览中 .katex 容器存活（渲染结构未被破坏）
  await expect(page.locator('.md-preview .katex')).toBeVisible();
  const previewHtml = await page.locator('.md-preview').evaluate((el) => el.innerHTML);
  // M1 决策：预览管线 DOMPurify 已配置 ADD_TAGS: ['semantics','annotation']，
  // 语义标注（无障碍 / 复制粘贴）在预览中完整保留——与 S0.1 的默认移除相反。
  expect(previewHtml).toMatch(/<semantics/i);
  expect(previewHtml).toMatch(/<annotation encoding="application\/x-tex">x\^2<\/annotation>/i);
  expect(previewHtml).toContain('<span class="katex">');
  expect(previewHtml).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
});
