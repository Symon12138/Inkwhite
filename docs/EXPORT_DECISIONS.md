# 导出（Export）决策固化：DG4–DG9（WP8b / S0.3）

> 日期：2026-08-12 · 范围：自包含 HTML 导出 + Word 导出（M2）的前置决策。
> DG1–DG3 属更早工作包，不在本文件范围。每条记录：决策 / 理由 / 验收方式 / M2 落点。
> 前置约定（WP8b 已固化于 `src/editor/exportComposer.ts`）：导出组装是**纯字符串纯函数**，
> 不碰 DOM、不抓字体、不清洗 URL——清洗、冻结、内联全部是 M2 消费方在传入前的职责。

---

## DG4 · 批注默认不导出

**决策**：导出物默认**剥离全部批注标记**（`[data-comment-badge]` 移除、`[data-comment-id]` 拆开保留原文）；与长图默认行为一致（长图 `longImageMarks=false` 时走 `_stripPosterMarks`）。是否提供「含批注导出」开关留待 M2 按用户反馈决定，默认关闭。

**理由**：
- 批注是阅读态私货，分享/交付物应呈现干净正文（长图已有同样取舍，产品一致性）；
- 剥离逻辑已有成熟实现与行为基线：`longImageMethods.ts` 的 `_stripPosterMarks`（DOM 形态：删 badge、`replaceWith(...childNodes)` 拆 span）；
- 导出侧是纯字符串管线，剥离必须在**扁平化阶段（DOM 克隆）**做，不能在字符串里用正则做（正则拆 span 易碎）。

**验收方式**：
- 单测：扁平化函数（M2 的 `flattenDocument()`）对含 `data-comment-badge`/`data-comment-id` 的 DOM 输入，输出无 badge、无包裹 span、原文文本完整；
- E2E：划线段落 + 导出 → 导出物中无 `data-comment-` 属性，文字内容仍在。

**M2 落点**：新建 `src/editor/exportMethods.ts`（导出管线 DOM 阶段）时，把 `_stripPosterMarks` 从 `longImageMethods.ts` 提取为共享纯函数（如 `stripCommentMarks(node)`），两处复用；`longImageMethods.ts` 改为调用共享实现（改一处即可，行为不变）。

---

## DG5 · 远程图片：内联失败保留原 URL + 提示

**决策**：扁平化阶段对远程图片逐个 `fetch → data URL`；**失败（网络错误/非图片响应/超时）时保留原 URL 原文不动**，并在导出完成后给出提示（toast/状态条：`N 张图片未能内联，导出文件需联网或会缺图`）。已内联成功的照常替换。

**理由**：
- 硬失败（拒绝导出）在弱网/离线场景不可接受——本仓库 E2E 夹具本来就屏蔽外网，说明离线是常态；
- 静默丢弃会让正文缺图且用户不知情；保留 URL 至少让 HTML 出口在联网打开时可用；
- 消费方责任边界：`composeExportHtml` 原样透传 bodyHtml（单测已锁定「不引入、不清洗相对 URL」），所以「保留原 URL」在 composer 层是零成本默认行为，提示与统计才是 M2 的活。

**验收方式**：
- 单测：`inlineImages(html)` 注入 fetch 失败 stub → 输出仍含原 `src`，返回 `{ failed: [url] }` 列表；
- E2E：给正文塞一个外网图（现有 fixture 自动拦截外网请求，天然制造失败）+ 一个 data URL 图，导出后断言原 URL 保留、data URL 图保留、失败提示出现。

**M2 落点**：`exportMethods.ts` 内 `inlineRemoteImages(dom, { signal })`（配合 DG8 的 AbortController）；提示 UI 复用现有状态条/toast 模式。

---

## DG6 · SVG 默认禁脚本型（净化或拒绝）

**决策**：导出管线沿用 DOMPurify 净化（与预览同款管线，`viewMethods.ts` 现行调用），**输出前对每个 `<svg>` 做兜底检查：含 `<script>`、事件属性、`<foreignObject>`（可内嵌 HTML 的逃逸口）即拒绝该 SVG 节点**——替换为占位文本（同 DG9 的「图表渲染失败」形态）。净化通过者放行。

**理由**：
- 预览侧净化已证明有效（`security.spec.ts`/`katexDecision.spec.ts` 固化：`<script>`/`onerror` 被剥），导出物是「离开应用」的文件，风险面比预览更大（打开方无我们的净化器）；
- `foreignObject` 在 DOMPurify 默认配置下会被处理，但「导出物里出现它」本身可疑（Mermaid/KaTeX 输出不含），宁可拒绝不冒险；
- 拒绝而非剥离：剥离后的 SVG 可能残缺变形，占位文本更诚实。

**验收方式**：
- E2E：构造含 `<svg><script>`、`<svg onload>`、`<svg><foreignObject>` 的正文 → 导出物无 script/事件属性/foreignObject，对应节点为占位文本；
- 单测：`sanitizeForExport(html)` 对三类恶意 SVG 输入的输出断言。

**M2 落点**：`exportMethods.ts` 的净化步骤（DOMPurify 配置 + SVG 兜底检查函数 `assertSafeSvg(node)`）；与 DG9 共用占位文本工厂。

---

## DG7 · KaTeX 字体：内联 woff2 data URL 或声明降级（POC 实测体积后再定）

**决策**：**本 WP 不拍死**，先做 POC 测体积，按判据二选一：
- 路径 A（体积 ≤ 1MB）：`@font-face` 里的 woff2 以 data URL 内联进导出 CSS（复用 `longImageMethods._inlineFontFace` 的内联思路 + 项目已有的 `subset-font` 经验做子集化）；
- 路径 B（体积 > 1MB 或子集化失败）：不内联，导出 CSS 声明**系统字体降级栈**（`font-family: KaTeX_Main, "Times New Roman", serif`），并在导出完成提示「公式字体未内联，系统字体渲染，观感可能有差」。

**判据（POC 实测项）**：katex 0.16.47 全量 woff2（`node_modules/katex/dist/fonts/*.woff2`）合计体积；按实际文档字形子集化后体积；子集化工具链（subset-font，已在 devDeps）产出质量。

**理由**：
- katex 字体总量数 MB 级，全量内联会让每个导出 HTML 都背几 MB 成本，与「轻量分享物」的产品定位冲突；
- 但裸声明降级在无网络环境必现字体差异，公式多时观感损失明显——所以必须用 POC 数字说话，不能拍脑袋。

**验收方式**：
- POC 脚本（M2 起手做，一天内）：统计全量体积 + 对含 10 个公式的文档做字形子集化并统计 → 结论附在本文件下方「POC 记录」区；
- 路径 A 验收：导出 HTML 内 `@font-face` 的 src 全部为 `data:font/woff2;base64,`，离线打开公式渲染与预览一致；
- 路径 B 验收：导出 HTML 无 `data:font`，`font-family` 含降级栈，提示文案出现。

**M2 落点**：`fontsCss` 参数由消费方在调用 `composeExportHtml` 前准备好（composer 只做拼接，单测已锁定顺序与透传）；内联实现参考 `longImageMethods._inlineFontFace`（读其实现抽取，不复制）。

---

## DG8 · 大文档：阈值告警 + 进度 + AbortController

**决策**：导出前估算成本（正文 HTML 字节数 + 远程图片张数），超阈值（暂定：正文 > 5MB，或远程图 > 50 张）先弹确认/提示「文档较大，导出可能需要较长时间」；导出过程中（图片内联循环）显示进度（`已内联 N/M`）；全程支持取消——扁平化 + 图片内联接受 `AbortSignal`，取消后不落盘、不提示成功。

**理由**：
- 图片内联是网络 I/O 主导的耗时阶段，无进度无取消 = 大文档导出像死机（长图功能已有「超长降档」先例，用户体验一致性）；
- 阈值与进度都发生在**管线阶段**（扁平化/内联），composer 本身是纯函数毫秒级，不需要也不应该感知这些；
- 取消必须真取消（AbortController 中断 fetch 循环），不能只是关弹窗。

**验收方式**：
- 单测：`inlineRemoteImages(dom, { signal })` 在中途 abort 时停止剩余 fetch、不抛未捕获异常；
- E2E：构造超阈值文档（注入大量假图 URL）→ 告警出现 → 点取消 → 无导出物产生、无成功提示。

**M2 落点**：`exportMethods.ts` 的 `runExport(plan, { signal, onProgress })`；阈值常量放该模块顶部并注释依据；进度 UI 复用现有状态条模式。

---

## DG9 · Mermaid 失败：导出 `.has-error` 节点为「图表渲染失败」文本

**决策**：扁平化阶段扫描 `.mermaid-rendered.has-error`（含 `is-loading` 卡死态兜底），替换为占位文本节点：`图表渲染失败（原代码块内容见附录）`——同段原文代码块保留在文末附录，不丢信息。

**理由**：
- 预览侧错误态已有明确钩子（`.mermaid-rendered.has-error`，见 `diagramMethods.ts` 与 `styles.css`），导出必须与预览一致：预览里是错误，导出物里不能是空白或残图；
- 直接把错误 SVG 带进导出会扩散「坏图」；纯删除会丢用户想看的原始代码——占位 + 附录是信息无损的最小方案；
- Word 出口同理：该节点输出为一段普通文本（顺带解决「坏 SVG 栅格化」问题）。

**验收方式**：
- 单测：`flattenDocument()` 对 `.has-error` 节点的输出断言（占位文本存在、原文代码块进附录）；
- E2E：注入渲染失败的 mermaid 源码（`diagramMethods` 的错误态）→ 导出 → 导出物含「图表渲染失败」文本、不含 `.has-error` 节点。

**M2 落点**：`exportMethods.ts` 扁平化步骤内的 `replaceFailedDiagrams(dom)`；占位文本工厂与 DG6 共用；附录由扁平化器统一生成。

---

## POC 记录区

（DG7 的体积 POC 结论、DG5 的真实失败率样本等，M2 实测后追加在此处，保持本文件为唯一决策档案。）
