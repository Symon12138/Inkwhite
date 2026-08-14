# Word 导出 Spike 结论（WP8b / S0.3）

> 日期：2026-08-12 · 环境：Node 24.15.0 / Chromium（Playwright）/ Vite dev（8.x）
> 实测载体：`tests/e2e/wordSpike.spec.ts`（4 用例全绿，含真实运行证据）+ 本文件。
> 相关决策见 [EXPORT_DECISIONS.md](./EXPORT_DECISIONS.md)（DG4–DG9）。

## 一句话结论

**选 `docx@9.7.1`（浏览器可用，ZIP 实测通过）；`html-to-docx@1.8.0` 仅 Node 可用（浏览器导入实测失败）。** M2 采用「扁平化 HTML 中间管线 + docx 编程式建文档」，不直接做 HTML→docx 文本转换。

## 实测证据（2026-08-12，全部来自真实运行，非推断）

| 用例 | 结果 | 关键输出 |
| --- | --- | --- |
| html-to-docx Node 侧转换（标题/段落/表格/图片 data URL） | ✅ | Buffer 26041 字节，头两字节 `80 75`（`PK`）；包内含 `[Content_Types].xml`、`word/document.xml`、`word/media/` |
| html-to-docx 浏览器导入（`/node_modules/html-to-docx/dist/html-to-docx.esm.js`） | ❌ | `The requested module '/node_modules/html-to-vdom/index.js?v=07233f03' does not provide an export named 'default'`（CJS 互操作断裂；其后还有 `fs`/`path`/`http`/`https`/`zlib`/`crypto`/`punycode` 等 Node 内建导入必然失败） |
| docx 浏览器构建最小文档（标题/段落/表格/`ImageRun` data URL 图片） | ✅ | `Packer.toArrayBuffer` 产出 9511 字节，头两字节 `PK`；`[Content_Types].xml`、`word/document.xml`、`word/media/*.png` 齐全 |
| 独立复核 | ✅ | Windows 原生 `Expand-Archive` 可解包浏览器生成的 docx；`document.xml` 含标题文本、`<w:tbl>` 表格、`<w:drawing>` 图片引用；`word/media/` 内 PNG 与输入 1×1 PNG 逐字节一致 |

产物 artifact（供 WPS/Word 人工复核）：
- `test-results/…/wordSpike-*/spike-docx-browser.docx`（docx 浏览器生成）
- `test-results/…/wordSpike-*/spike-docx-node-html-to-docx.docx`（html-to-docx Node 生成）

## 选型对比

| 维度 | html-to-docx@1.8.0 | docx@9.7.1 |
| --- | --- | --- |
| 定位 | HTML 字符串 → docx 的文本转换器 | 编程式构建 OOXML 文档（Paragraph/Table/ImageRun 等） |
| 浏览器可行性 | ❌ 实测失败：ESM 构建顶部 `import fs/path/http/https/zlib/crypto/punycode`，且 html-to-vdom CJS 互操作在 Vite 下断裂 | ✅ 实测通过：`dist/index.mjs` 为 rolldown 全内联 ESM（零裸导入，自带 Buffer 兼容层），Vite dev 动态 import 成功 |
| Node 可行性 | ✅ 实测通过（26KB 合法 docx） | ✅ 本身支持（toBuffer/toArrayBuffer/toBlob） |
| 图片 | ✅ data URL 图片自动内联进 `word/media/`（实测） | ✅ `ImageRun({ type, data, transformation })` 进 `word/media/`（实测） |
| 表格 | ✅ 原生 `<table>` 转换（实测进包） | ✅ `Table/TableRow/TableCell`（实测进包） |
| 样式语义 | 只转基本标签，页面 CSS 概念（变量、主题纸色）天然丢失 | 样式需编程式映射，但可控性强、可精确对应「扁平化中间格式」 |
| 体积 | ESM 构建 ~720KB；传递依赖重（jszip/xmlbuilder2/html-to-vdom/virtual-dom/lodash/image-size/image-to-base64 等） | `dist/index.mjs` ~1.08MB 单文件；依赖轻（jszip/hash.js/nanoid/xml） |

两个包均已按 `--save-exact` 锁入 `dependencies`（`html-to-docx: 1.8.0`、`docx: 9.7.1`），npm 实测合计新增 91 个包（含传递依赖，安装体积约 9MB）。**对应用产物体积的影响**：两者均未被 `src/` 静态引用，`vite build` 产物不含它们；M2 若在浏览器侧按需 `import('docx')`，会新增约 1.08MB（min）的动态 chunk，建议届时用 `import()` 拆分 + 体积监控复核（`scripts/check-bundle-size.js`）。

## 对 M2 的建议

1. **扁平化 HTML 中间管线（必选）**：导出流程统一为「预览 DOM → 扁平化单文档（剥离批注、内联图片、冻结 CSS 变量、净化）→ 中间格式」；Word 导出基于中间格式编程式构建，而不是把原始预览 HTML 直接丢给转换器。理由：
   - docx 没有 HTML→docx 转换器，任何 HTML 路径都要自己映射语义节点——不如一步到位自己建文档；
   - 扁平化中间格式同时服务 Word / 自包含 HTML / 未来 PDF 三条出口（`composeExportHtml` 已按此形态设计，见 `src/editor/exportComposer.ts`）；
   - 主题纸色、CSS 变量等页面概念在 Word 里不存在，必须在中间格式阶段落定。
2. **KaTeX / Mermaid 进 Word**：在扁平化阶段把 `.katex` 与 `.mermaid-rendered` 的 SVG 栅格化为 PNG（复用 `longImageMethods` 的 SVG→canvas 光栅化经验），以 `ImageRun` 进包；失败节点按 DG9 处理。SVG 直接进 docx 不是受支持的路径。
3. **体积控制**：浏览器侧 `import('docx')` 动态加载；导出是低频操作，可接受首屏不加载。若未来走 Tauri 侧 Node/原生路径，html-to-docx 可作备选（Node 实测可用），但两套渲染路径会翻倍维护成本，不推荐双轨。
4. **WPS 兼容性手测项（M2 必须做）**：
   - WPS 打开本文档引用的两份 spike artifact：中文标题、表格边框、图片尺寸、页边距；
   - `ImageRun` 的 `transformation` 用 CSS px 对应的 EMU 换算是否正确（1px ≈ 9525 EMU）；
   - 长文档（>100 页）在 WPS 中的打开速度与内存；
   - docx 重新另存为 .doc 再打开（兼容模式）；
   - 文件名含中文/特殊字符的保存链路。

## 剩余问题（M2 解决）

- KaTeX 字体在 Word 中无等价物：HTML 出口走 DG7（woff2 内联 POC 定体积）；Word 出口统一栅格化，无需字体内联。
- 远程图片内联失败路径（DG5）：docx 出口无「保留 URL」概念，失败图在 Word 中只能是占位文本。
- 大文档（DG8）：docx 出口的构建本身是同步内存操作，阈值/进度/取消主要作用于「扁平化+图片内联」阶段。
- 依赖版本升级后需重跑 `wordSpike.spec.ts`（同 katexDecision.spec.ts 的残留风险约定）。

## 失败记录（诚实声明）

- html-to-docx 的**浏览器**路径判定为不可用，已按实测错误如实记录（见上表），未伪造成功；其 Node 路径可用并有实测产物。
- 若未来仍希望浏览器用 html-to-docx，唯一出路是给其 ESM 构建补 Node 内建 polyfill 并修复 html-to-vdom 互操作——成本高于直接维护 docx 映射层，本 WP 明确不选。
