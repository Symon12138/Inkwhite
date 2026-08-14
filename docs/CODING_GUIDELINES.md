# Coding Guidelines

This project keeps editor behavior grouped by feature. New code should go into the smallest module that owns the behavior instead of expanding the main controller or `index.html`.

## Module Boundaries

- `src/editor/MarkdownEditorLogic.ts`: component factory, refs, lifecycle wiring, and template bindings only.
- `src/editor/viewMethods.ts`: preview rendering, outline, view mode, theme, font, status, and editor counts.
- `src/editor/navigationMethods.ts`: source-preview anchoring, scrolling, and highlight flash behavior.
- `src/editor/commentMethods.ts`: selection toolbar, annotations, comment panel rendering, and copy helpers.
- `src/editor/longImageMethods.ts`: the "save as long image" modal, poster composition, and SVG/canvas rasterization. `src/editor/longImageComposer.ts`: its pure logic (width presets, scale/tile planning, CSS extraction) — keep new logic testable there rather than in the DOM-facing module.
- `src/editor/editingFileLayoutMethods.ts`: Markdown formatting commands, local file operations, and resizable layout handles.
- `src/editor/localFileSyncMethods.ts`: bidirectional sync with the opened local file (write-through autosave, external-change watcher, conflict handling). `src/editor/fileHandleStore.ts`: IndexedDB persistence of file handles (Tauri 桌面端句柄以路径标记存储，重启后自动恢复关联).
- `src/editor/styles.css`: editor UI CSS.
- `src/editor/tauriBridge.ts`: Tauri 桥接层，桌面端文件对话框、读写、原生文件监听与应用菜单事件。
- `src/editor/markdownExtensions/`: Markdown 语法扩展（M1 起）。每个扩展一个模块文件，导出符合 `MarkdownExtensionModule` 契约的对象（`extensions` + 可选 `transformTokens`，契约定稿见 `markdownExtensionRegistry.ts` 头部注释）；注册与渲染统一走 `registerMarkdownExtensions()` / `renderMarkdown()` 单管线（`_renderPreview` 与单测共用）。本目录只放扩展对象模块，不混入组件/DOM 逻辑；新语法样式一律预置在 `styles.css`（`.md-preview` 作用域内），扩展文件只产出结构、不得改 `styles.css`。

## Rules For New Work

- Keep files under 800 lines. If a change would push a file past that, split by feature before merging.
- Keep functions and methods under 140 lines. Treat 80 lines as the normal target; split earlier when a function mixes UI creation, data fetching, parsing, and state mutation.
- Prefer feature-local modules over generic utility modules until behavior is reused in at least two places.
- Keep DOM-manipulation helpers near the feature that owns the DOM they mutate.
- Keep `MarkdownEditorLogic.ts` as orchestration only; avoid adding business logic there.
- For behavior changes, write the failing test first — see `docs/TESTING.md` for the two-layer harness (unit tests in `tests/unit/`, Playwright E2E in `tests/e2e/`) and templates.
- Run `npm run check` before committing; add `npm run test:e2e` (or `npm run check:full`) when user-visible behavior changed.

## Community Baseline

The structure follows the React guidance that projects commonly group related JS, CSS, and tests by feature or route, while TypeScript/Vite checks remain part of the normal build loop. If linting is added later, prefer ESLint flat config with `typescript-eslint` recommended rules.
