# 飞白 Inkwhite — 交接文档

> 用途：给后续优化/开发接手者。本文描述项目现状、架构、已验证的基线、环境陷阱、
> 已知遗留与建议的下一步。接手前请先读 `AGENTS.md`、`docs/CODING_GUIDELINES.md`、`docs/TESTING.md`。

- 项目：飞白 Inkwhite —— Tauri 2 桌面 Markdown 编辑器（Windows 为主，macOS 兼容）
- 远程：`github.com/Symon12138/Inkwhite`（Public / **MIT**，Copyright 2026 jishuai）
- 本地目录：`E:\Project\AI\workbuddy\inkwhite`（原 `mojian-markdown` 已改名；旧目录待删除）
- 版本：1.0.0 · 最近提交：`d71c633` · GitHub Release：`v1.0.0`（含 NSIS exe + MSI）

---

## 1. 功能现状（均已实现并通过测试）

| 模块 | 说明 | 关键文件 |
|---|---|---|
| Typora 风格菜单栏 | 文件/编辑/段落/格式/视图/主题/帮助；Alt+F/E/P/O/V/T/H 打开；**不显示快捷键** | `menubarMethods.ts`、`index.html` |
| 多文档标签页 | Ctrl+T/W/Tab 新建/关闭/切换；脏标记+关闭确认；重启恢复；标签栏含「飞白」书法品牌图 | `tabMethods.ts`、`tabStore.ts`、`desktopM4.css` |
| 右键菜单（四上下文） | 源码（编辑/段落/格式/插入）、预览（链接/图片/表格/选区）、侧边栏、标签页；视口翻转、Esc/外点/滚动关闭 | `contextMenuMethods.ts` + `contextMenu.css` |
| 源码工具栏格式按钮 | 标题/加粗/斜体/删除线/高亮/下划线/引用/列表/行内代码/链接 + 「更多格式 ⋯」（图片/表格/任务/代码块/分割线/上下标/脚注） | `index.html`、`editingFileLayoutMethods.ts` |
| 统一字体 | 选择字体后**源码+预览+搜索高亮层同步**（`--source-font` + `--read`）；默认源码回落等宽；支持导入字体（IndexedDB 持久化） | `fontMethods.ts`、`fontControls.css` |
| 字体/字号控件 | 状态栏右下角“字体 ▾ + 导入 + 源码 A−/A+ + 预览 A−/A+ + 字数”（源码/预览独立，旧数据自动迁移） | `index.html` footer、`viewMethods.ts`、`types.ts` |
| 侧边栏「文件」页签 | 工作区文件夹树（`选择文件夹…` 持久化）+ 当前文档所在目录 .md 列表；文件菜单“打开文件夹…”直达；列表上限 200 | `fileTreeMethods.ts`、`index.html` |
| 侧边栏「大纲」页签 | 标题跳转 | `navigationMethods.ts`、`viewMethods.ts` |
| 搜索替换 | Ctrl+F 按视图路由（源码/预览）、Ctrl+H 展开替换；大小写/全字/正则；镜像层高亮 | `searchReplaceMethods.ts`、`previewSearchMethods.ts` |
| 划线批注 | 马克笔/波浪线/直线/想法 + 批注面板，localStorage 持久化 | `commentMethods.ts` |
| 导出 | HTML / PDF（打印）/ Word（.docx）/ 长图 | `exportMethods.ts`、`wordExport.ts`、`longImageMethods.ts` |
| 本地文件双向同步 | autosave 写穿、外部修改自动重载、冲突状态 Ctrl+S 覆盖；授权持久化（`granted-paths.json`） | `localFileSyncMethods.ts`、`src-tauri/src/{commands,grants,file_watcher}.rs` |
| 阅读模式（查看型默认） | 启动即预览视图并**记忆上次视图模式**（editor/split/preview 持久化）；预览版心 Typora 式居中（820px，左右留白；全屏宽幅 1240px 不受限）；**阅读位置记忆**：按文件路径/草稿名存 localStorage（`md-editor-read-pos-v1`，保留最近 300 篇），打开文件/切标签自动回到上次位置 | `MarkdownEditorLogic.ts`、`readingPositionMethods.ts`、`viewMethods.ts`、`styles.css` |
| 沉浸式阅读 | 全屏/宽屏、五档纸色（墨黑/羊皮纸/米黄/清爽白/豆沙绿） | `viewMethods.ts`、`styles.css` |
| 外观 | 墨笺暗色主题、左上角「飞白」狂草书法印章（`images/feibai_kuangcao_jianfei_s.jpg`）、预览外链小角标（SVG mask） | `theme/tokens.css`、`desktopM4.css`、`styles.css` |
| 外链图片 | CSP `img-src` 放行 https/http（桌面端外链图片/徽标可显示）；`connect-src` 加 https | `src-tauri/tauri.conf.json` |
| 无 mac 符号 | 全局已清除 ⌘/⌃/⇧（菜单、上下文菜单、tooltip、示例文档、README） | 全仓 |

## 2. 测试基线（最近全绿）

- 前端单测：`npm test`（node:test，`tests/unit/`，含 contextMenu/fontMethods/fileTreeMethods 等）
- Rust 单测：`npm run test:rust`（`src-tauri/src/*_tests.rs`，含授权/安全/文件监听等）
- E2E：`npm run test:e2e`（Playwright，`tests/e2e/`，**148 个**，含右键菜单/字体同步/格式工具栏/目录守卫等）
- 全量门禁：`npm run check`（代码体积 ≤800 行/函数 ≤140 行 + tsc + 单测 + cargo + 构建）

## 3. 架构速览

- **前端**：Vite + TypeScript + React（DC runtime 模板）。业务按特性拆分模块（`src/editor/*Methods.ts`），
  `MarkdownEditorLogic.ts` 只做装配（refs、生命周期、renderVals 绑定、`applyPrototypeMethods` 混入）。
- **CSS**：`theme/tokens.css`（唯一 token 源）＋ `src/editor/{shell,styles,desktopM4,documentSidebar,contextMenu,fontControls,longImage,insertPaste}.css`。
- **桌面**：`src-tauri/src/`（commands/grant 授权模型/lib/asset_file/file_watcher/search_open），
  IPC 命令 + 权限清单（granted-paths.json，授权=用户手势）。
- **模板**：UI 骨架在 `index.html`（x-dc 模板）；标签栏/右键菜单/设置面板等由 JS 构建注入。

## 4. 环境与陷阱（重要）

- **cargo/Rust（Windows gnu）**：
  ```powershell
  $env:RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-gnu'
  $env:PATH='C:\Users\Administrator\scoop\apps\mingw\current\bin;'+$env:PATH
  ```
- **`.cargo/config.toml`**：已内置 `--exclude-libs,ALL` 修复 windows-gnu 测试 cdylib 导出溢出（"export ordinal too large"）——**不要删**，否则 cargo test 会挂。
- **`WebView2Loader.dll`**（已根治）：曾需手工把 DLL 拷到 `target/release/`（tauri-build 资源校验会 panic）。
  现已作为正式资源入库 `src-tauri/resources/WebView2Loader.dll`（微软允许再分发），`tauri.conf.json`
  resources 指向它——任何机器 clone 后直接构建，无需任何手工拷贝。
- **npm 全局缓存**：`npm install` 在默认缓存路径（`E:\environment\nodejs\node_cache`）可能被 OS 拒绝，
  用 `npm install --cache <项目内路径>` 规避。
- **代理**：Clash 127.0.0.1:7890 可能故障；git 推送失败时用 `git -c http.proxy= push` 直连。
- **发布**：`npm run tauri:build` 后 `npm run release`（自动读版本→打 tag→建/更新 GitHub Release→传 exe+msi）。

## 5. 已知遗留 / 建议的下一步（按优先级）

1. **Windows 实机手测 49 项**（`docs/PLATFORM_TEST.md` 未完成）——重点验证：右键菜单（剪贴板粘贴/复制）、
   侧边栏目录浏览、外链图片、文件关联打开。E2E 只覆盖浏览器路径，桌面路径需实机。
2. ✅ **CI 首次实跑**——已补齐 `.github/workflows/ci.yml`（2026-08-21，见下方 §6）：`windows-latest` 单作业串行 `check-code-size` → `tsc` → `npm test` → `cargo test`（含 WebView2Loader.dll 自动回补）→ `vite build` → `playwright chromium`，失败自动上传 `playwright-report`。
3. ~~**API key 轮换**~~ ✅ 已确认无需处理（2026-08-21 核实：本项目不接入外部模型 API，未配置相关 key，历史记录中的 key 已失效/无关联服务，风险可关闭）。
4. **.md 资源管理器图标**——桌面端关联文件无专属图标（当前 Tauri schema 不支持 fileAssociations 级 icon），
   需自定义 NSIS 钩子写 `DefaultIcon` 注册表。
5. ✅ **草书品牌字体打包**——已完成（2026-08-21）：下载 OFL 授权草书字体「柳建毛草」（Google Fonts，
   `fonts-src/liujian-maocao/` 含 OFL.txt），`npm run font:brand`（`scripts/subset-brand-font.mjs`）
   裁「飞白」二字得 1.2KB woff2（`public/fonts/brand/feibai-brand.woff2`），`tokens.css` @font-face
   'Feibai Brand'，`tabMethods.ts` 品牌 JPG → 矢量文字（任何机器都显示），.gitignore 加 OFL 例外。
6. **仓库体积**——exe 已入库（`release/`，历史会累积），后续建议改走 GitHub Releases 托管、仓库内只留
   MSI/EXE 下载入口或移出。
7. **文档**——`docs/DESIGN_SPEC.md` / `DESKTOP_ROADMAP.md` 可能过时，可对照本节功能表更新；
   曾提到的 `overview.md` 当前不存在。
8. **可选打磨**——~~源码/预览独立字号（用户此前未选）~~ ✅ 已完成（2026-08-21：`types.ts`/`MarkdownEditorLogic.ts`/`viewMethods.ts`/`index.html` 独立 `previewFontSize`，状态栏“源码/预览”双控件，沉浸式工具栏跟随预览字号，旧数据自动迁移）；~~主题菜单纸色与预览工具栏纸色点重复（可去重）~~ ✅ 已完成（2026-08-21：主题菜单仅保留“切换 亮色/暗黑 + 设置…” ，纸色改由预览工具栏 `paperPicker` 圆点唯一入口）；顶部是否进一步精简（待定）。

## 6. 常用命令

```bash
npm run dev              # Vite 前端 127.0.0.1:1420
npm run tauri:dev        # 桌面开发
npm run check            # 门禁：体积+tsc+单测+cargo+构建
npm run check:full       # 全量门禁：check + E2E
npm run test:e2e         # Playwright（首跑 npx playwright install chromium）
npm run tauri:build      # 出安装包（NSIS/MSI）
npm run release          # 发布 GitHub Release（读 tauri.conf 版本，传 exe+msi）
```

> CI：推送到 `main`/`master` 自动触发 `.github/workflows/ci.yml`（见 §5-2），本地可用 `npm run check:full` 完整自检后推送。

---

*生成：2026-08-19 · 更新：2026-08-21 补齐 CI（.github/workflows/ci.yml）· 交接时最近提交 `d71c633` · Release v1.0.0 已发布。*

*更新：2026-08-21 加固轮——① `scripts/check-code-size.js` 门禁盲区修复：INCLUDED 纳入 `.rs`、IGNORED_DIRS 纳入 `target`（此前 commands.rs 886 行超限未被发现）；② `commands.rs` 886→548 行，资产读取拆到 `src-tauri/src/local_assets.rs`（361 行，含 9 个安全测试，58 个 Rust 测试全过）；③ 新功能补单测（独立字号 clamp/迁移、搜索开关记忆、批注筛选），前端 451 测试全过。*

*更新：2026-08-21 阅读模式轮——① 启动默认预览视图 + 视图模式记忆（`types.ts` PersistedEditorState.viewMode，重启回到上次 editor/split/preview）；② 阅读位置记忆 `readingPositionMethods.ts`（按文件路径/草稿名存 `md-editor-read-pos-v1`，保留 300 篇；打开文件/切标签打标，预览就绪后恢复一次）；③ 预览版心 Typora 式居中（`.md-preview > *` max-width 820px 左右留白，全屏宽幅 1240px 与打印不受限）；前端单测 451→457；E2E 新增 readingMode.spec（默认预览/模式记忆/位置记忆/版心居中 4 例），`fixtures.openEditor` 统一切分屏适配新默认，`setViewMode` 切换即持久化（不依赖输入触发）。 随全量 E2E 揪出并修复一个真实 UI bug：**视图/主题/纸色/段落标题/撤销等菜单动作执行后下拉菜单不关闭**（悬在标签栏上方挡点击；`menuFile*` 系列本就关闭，其余 17 个叶子动作已统一补 `toggleMenubar('')`，`menuRecent` 因子菜单语义保留）；另修正三个陈旧用例（品牌字体文字断言、文件菜单「打开…」精确匹配、长图状态栏自动保存竞态），E2E **152/152 全绿**。 实机反馈修正：① 版心居中被 `.md-preview p/h1/ul…` 的 margin 简写压掉（优先级 0,1,1 > 0,1,0）致内容贴左——改用双类 `.md-preview.md-preview > *`（0,2,0）只覆盖水平 margin，实测左右留白对称（1440px 窗口各 310px）；② 纸色圆点 `.paper-dot` 16×22 + radius 50% 呈椭圆，改正圆 18×18。⚠️ 长行陷阱复发：styles.css 含 2283 字符压缩行，**禁止** read+write 整写该文件，补丁一律走脚本字面量替换。 启动闪烁修复（用户反馈「启动时闪烁几次」）：① 首帧布局直排——index.html 既有防闪脚本块按持久化 viewMode 打 `boot-preview/boot-editor` 类，CSS 直排首帧，`_init` 提前 `_syncViewMode()` 并摘除 boot 类；② 消除启动期预览双渲染——`_loadTabIntoEditor` 同内容接管（文件名+内容一致）跳过重渲染；③ 修悬空打标 bug——原 `_init` 尾部的 `_markReadPosRestore()` 在 `_initTabs` 消费之后才设，导致首次输入时预览跳回旧位置，已把打标移到首渲前；④ 路径键补恢复——启动首渲时 localFilePath 未挂上只能按草稿键找，`_attachLocalFile`/`_adoptRestoredHandle` 后调 `_retryReadPosWithPath()` 补一次（`_readPosHit` 每篇重置）。单测 459、E2E 152 全绿。 二轮（用户仍报闪烁）：插桩定位到打包环境特有三因——① WebView2 首帧白底：`tauri.conf.json` 窗口补 `backgroundColor: #14110d`（Tauri 2.11 支持），boot 脚本同步设 `<html>` 即时底色；② **阅读字体静默缺失**：cejk-subset.woff2 因授权不入库、本机 public/ 缺文件，URL 200 返回 index.html → OTS 解码失败 → 全文回退系统楷体，已用 `npm run font:subset` 从 fonts-src 本地重建（1.9MB），index.html 加双字体 preload 防换装闪，editor.spec 断言字体响应 wOF2 头防回归；③ 启动时间线插桩确认 dev 下已单渲染无跳变。注意：克隆仓库需 `npm run font:fetch && npm run font:subset` 才有阅读字体（授权限制不入库）。 三轮（用户报「黑屏一会」）：backgroundColor 治好白闪后暴露出「暗屏等待首渲」——改为标准隐藏启动模式：窗口 `visible:false`，前端 `_init` 完成首渲并等字体就绪（上限 1.2s）后经 `tauriBridge.showMainWindowWhenReady()` 显示窗口；Rust setup 另有 5s 兜底强显（前端异常也不会永远无窗）。用户看到的第一帧即... (line truncated to 2000 chars)

*更新：2026-08-21 P0-P2 完成 + 方向1-4 已提交（顶部折叠 `shell.css`、文档同步、搜索记忆）；方向5-7 已提交（代码复制 `viewMethods.ts`/`styles.css`、批注筛选 `commentMethods.ts`、孤儿检测 `fileTreeMethods.ts`）；方向8 品牌字体子集已完成（OFL 柳建毛草 → 1.2KB woff2 随包分发）；仅剩 .md 资源管理器 DefaultIcon 需 NSIS 钩子（`tauri.conf.json` fileAssociations 已就绪）。*