// Tauri API 封装层：替代 Electron preload.cjs 的 window.mojianDesktop。
// 接口形状与原 MojianDesktopApi 对齐，让前端改动最小（editingFileLayoutMethods 只换调用入口）。
// 新增 onFileChanged / listDirectory / offFileChanged 支持 Tauri 原生文件监听和文件树。
//
// 使用方式：
//   import { tauriBridge } from './tauriBridge';
//   if (tauriBridge) { tauriBridge.onMenu(cb); }

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ===== 类型定义（与 Rust 端 serde 序列化结构一一对应）=====

/** 打开文件对话框返回的文件信息。 */
export interface PickedFile {
  path: string;
  name: string;
  content: string;
  lastModified: number;
}

/** 另存为对话框返回的文件信息。 */
export interface SavedFile {
  path: string;
  name: string;
  lastModified: number;
}

/** 读取文件返回的内容。 */
export interface FileContent {
  content: string;
  lastModified: number;
}

/** 文件元数据。 */
export interface FileMeta {
  lastModified: number;
}

/** 本地图片资产。 */
export interface AssetData {
  dataUrl: string;
}

/** 目录条目。 */
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** 保存的图片资产（saveAssetFile 返回）。 */
export interface AssetSaved {
  name: string;
  path: string;
}

/** 选择的图片文件（pickImage 返回）。 */
export interface PickedImage {
  path: string;
  name: string;
  dataUrl: string;
}

// ===== TauriBridge 接口 =====

export interface TauriBridgeApi {
  openMarkdownFile(): Promise<PickedFile | null>;
  saveMarkdownFileAs(suggestedName: string, content: string): Promise<SavedFile | null>;
  /** 导出文件保存（HTML/PDF/DOCX）：文本 content 与二进制 binaryBase64 二选一。 */
  saveExportFile(
    suggestedName: string,
    content: string,
    binaryBase64?: string
  ): Promise<SavedFile | null>;
  /** 图片资产保存到当前文档目录（M3）；未命名文档由前端先弹另存为。 */
  saveAssetFile(docPath: string, requestedName: string, base64: string): Promise<AssetSaved | null>;
  /** 图片文件选择对话框（M3 B10）。 */
  pickImage(): Promise<PickedImage | null>;
  /** 跨文件搜索（M4 P7）：根目录须已授权。 */
  searchMarkdownFiles(root: string, needle: string, caseSensitive: boolean): Promise<{
    hits: Array<{ path: string; name: string; line: string; lineNumber: number }>;
    scannedFiles: number;
    truncated: boolean;
  }>;
  /** 拖入 Markdown 打开（M4 D，校验型）。 */
  openDroppedFile(path: string): Promise<PickedFile | null>;
  /** 拖入图片读取为 data URL（M4 D）。 */
  readDroppedImage(path: string): Promise<PickedImage | null>;
  /** 外链经系统浏览器打开（M4 B23，仅 http/https）。 */
  openExternal(url: string): Promise<void>;
  /** 关闭确认：前端确认后放行窗口关闭（M4 B24）。 */
  setCloseAllowed(): Promise<void>;
  /** 关闭请求事件（dirty 时由 Rust 拦截后发出）。 */
  onCloseRequested(cb: () => void): void;
  /** 桌面原生拖放：drop 时回调路径数组（M3 P5 / M4 D）。 */
  onDesktopDrop(cb: (paths: string[]) => void): void;
  offDesktopDrop(cb: (paths: string[]) => void): void;
  readFile(path: string): Promise<FileContent | null>;
  writeFile(path: string, content: string): Promise<FileMeta>;
  statFile(path: string): Promise<FileMeta | null>;
  readAsset(docPath: string, src: string): Promise<AssetData | null>;
  /** 解析本地图片为 asset 协议 URL（性能优于 data URL，P1-3）；失败回落到 readAsset */
  getAssetPath(docPath: string, src: string): Promise<string | null>;
  consumePendingOpen(): Promise<PickedFile | null>;
  listDirectory(path: string): Promise<DirEntry[]>;
  pickDirectory(): Promise<string | null>;
  watchFile(path: string): Promise<void>;
  unwatchFile(path: string): Promise<void>;
  onMenu(cb: (action: string) => void): void;
  onOpenPath(cb: (file: PickedFile) => void): void;
  onFileChanged(cb: (path: string) => void): void;
  offFileChanged(cb: (path: string) => void): void;
}

// ===== 环境检测 =====

/** 检测是否运行在 Tauri 环境中。 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * 启动防黑屏：窗口配置为 visible:false 隐藏启动，前端完成首次渲染并等字体
 * 就绪（或超时上限）后再显示，用户看到的第一帧就是完整界面而非黑屏/白屏。
 * Rust 侧另有 5s 兜底强显，前端异常也不会永远无窗。
 */
export async function showMainWindowWhenReady(maxWaitMs = 1200): Promise<void> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, maxWaitMs)),
    ]);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await win.show();
    await win.setFocus();
  } catch {
    // 非 Tauri 环境或 API 失败：忽略（Rust 兜底会显示窗口）
  }
}

// ===== 事件监听管理 =====

// menu / open-path 监听器（单实例，后注册替换先注册）
let menuUnlisten: UnlistenFn | null = null;
let openPathUnlisten: UnlistenFn | null = null;

// file-changed 监听器（多实例，用 Set 管理）
const fileChangedCallbacks = new Set<(path: string) => void>();
let fileChangedUnlisten: UnlistenFn | null = null;
let fileChangedInitializing = false;

// 桌面拖放监听器（多实例，用 Set 管理；M3 P5 / M4 D）
const desktopDropCallbacks = new Set<(paths: string[]) => void>();
let desktopDropUnlisten: UnlistenFn | null = null;
let desktopDropInitializing = false;

// 关闭请求监听器（多实例）
const closeRequestedCallbacks = new Set<() => void>();
let closeRequestedUnlisten: UnlistenFn | null = null;
let closeRequestedInitializing = false;

/** 确保 mojian:close-requested 事件有一个全局监听器。 */
function ensureCloseRequestedListener(): void {
  if (closeRequestedUnlisten !== null || closeRequestedInitializing) return;
  closeRequestedInitializing = true;
  listen<unknown>('mojian:close-requested', () => {
    closeRequestedCallbacks.forEach((cb) => {
      try {
        cb();
      } catch {
        // 单个回调出错不影响其他回调
      }
    });
  })
    .then((un) => {
      closeRequestedUnlisten = un;
    })
    .catch(() => {})
    .finally(() => {
      closeRequestedInitializing = false;
    });
}

/** 确保 webview 级拖放事件有一个全局监听器（Tauri onDragDropEvent）。 */
function ensureDesktopDropListener(): void {
  if (desktopDropUnlisten !== null || desktopDropInitializing) return;
  desktopDropInitializing = true;
  import('@tauri-apps/api/webview')
    .then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type !== 'drop') return;
        desktopDropCallbacks.forEach((cb) => {
          try {
            cb(payload.paths);
          } catch {
            // 单个回调出错不影响其他回调
          }
        });
      })
    )
    .then((un) => {
      desktopDropUnlisten = un;
    })
    .catch(() => {})
    .finally(() => {
      desktopDropInitializing = false;
    });
}

/** 确保 mojian:file-changed 事件有一个全局监听器。 */
function ensureFileChangedListener(): void {
  if (fileChangedUnlisten !== null || fileChangedInitializing) return;
  fileChangedInitializing = true;
  listen<string>('mojian:file-changed', (event) => {
    fileChangedCallbacks.forEach((cb) => {
      try {
        cb(event.payload);
      } catch {
        // 单个回调出错不影响其他回调
      }
    });
  })
    .then((un) => {
      fileChangedUnlisten = un;
    })
    .catch(() => {})
    .finally(() => {
      fileChangedInitializing = false;
    });
}

// ===== TauriBridge 实现 =====

/**
 * Tauri 桥接对象。在 Tauri 环境中可用，否则为 null。
 * 前端代码通过 `if (tauriBridge)` 判断是否在桌面端。
 */
export const tauriBridge: TauriBridgeApi | null = isTauri()
  ? {
      async openMarkdownFile(): Promise<PickedFile | null> {
        return invoke<PickedFile | null>('open_file');
      },

      async saveMarkdownFileAs(
        suggestedName: string,
        content: string
      ): Promise<SavedFile | null> {
        return invoke<SavedFile | null>('save_file_as', { suggestedName, content });
      },

      async saveExportFile(
        suggestedName: string,
        content: string,
        binaryBase64?: string
      ): Promise<SavedFile | null> {
        // binaryBase64 为空时不下发该键：Rust 侧 Option<String> 才能解到 None
        const args: Record<string, unknown> = { suggestedName, content };
        if (binaryBase64 !== undefined) args.binaryBase64 = binaryBase64;
        return invoke<SavedFile | null>('save_export_file', args);
      },

      async saveAssetFile(
        docPath: string,
        requestedName: string,
        base64: string
      ): Promise<AssetSaved | null> {
        return invoke<AssetSaved | null>('save_asset_file', { docPath, requestedName, base64 });
      },

      async pickImage(): Promise<PickedImage | null> {
        return invoke<PickedImage | null>('pick_image');
      },

      async searchMarkdownFiles(root: string, needle: string, caseSensitive: boolean) {
        return invoke('search_markdown_files', { root, needle, caseSensitive });
      },

      async openDroppedFile(path: string): Promise<PickedFile | null> {
        return invoke<PickedFile | null>('open_dropped_file', { path });
      },

      async readDroppedImage(path: string): Promise<PickedImage | null> {
        return invoke<PickedImage | null>('read_dropped_image', { path });
      },

      async openExternal(url: string): Promise<void> {
        await invoke('open_external', { url });
      },

      async setCloseAllowed(): Promise<void> {
        await invoke('set_close_allowed');
      },

      onCloseRequested(cb: () => void): void {
        closeRequestedCallbacks.add(cb);
        ensureCloseRequestedListener();
      },

      onDesktopDrop(cb: (paths: string[]) => void): void {
        desktopDropCallbacks.add(cb);
        ensureDesktopDropListener();
      },

      offDesktopDrop(cb: (paths: string[]) => void): void {
        desktopDropCallbacks.delete(cb);
      },

      async readFile(path: string): Promise<FileContent | null> {
        return invoke<FileContent | null>('read_file', { path });
      },

      async writeFile(path: string, content: string): Promise<FileMeta> {
        return invoke<FileMeta>('write_file', { path, content });
      },

      async statFile(path: string): Promise<FileMeta | null> {
        return invoke<FileMeta | null>('stat_file', { path });
      },

      async readAsset(docPath: string, src: string): Promise<AssetData | null> {
        return invoke<AssetData | null>('read_asset', { docPath, src });
      },

      async getAssetPath(docPath: string, src: string): Promise<string | null> {
        return invoke<string | null>('get_asset_path', { docPath, src });
      },

      async consumePendingOpen(): Promise<PickedFile | null> {
        return invoke<PickedFile | null>('consume_pending_open');
      },

      async listDirectory(path: string): Promise<DirEntry[]> {
        return invoke<DirEntry[]>('list_directory', { path });
      },

      async pickDirectory(): Promise<string | null> {
        return invoke<string | null>('pick_directory');
      },

      async watchFile(path: string): Promise<void> {
        await invoke<void>('watch_file', { path });
      },

      async unwatchFile(path: string): Promise<void> {
        await invoke<void>('unwatch_file', { path });
      },

      onMenu(cb: (action: string) => void): void {
        if (menuUnlisten) {
          menuUnlisten();
          menuUnlisten = null;
        }
        listen<string>('mojian:menu', (event) => cb(event.payload))
          .then((un) => {
            menuUnlisten = un;
          })
          .catch(() => {});
      },

      onOpenPath(cb: (file: PickedFile) => void): void {
        if (openPathUnlisten) {
          openPathUnlisten();
          openPathUnlisten = null;
        }
        listen<PickedFile>('mojian:open-path', (event) => cb(event.payload))
          .then((un) => {
            openPathUnlisten = un;
          })
          .catch(() => {});
      },

      onFileChanged(cb: (path: string) => void): void {
        fileChangedCallbacks.add(cb);
        ensureFileChangedListener();
      },

      offFileChanged(cb: (path: string) => void): void {
        fileChangedCallbacks.delete(cb);
      },
    }
  : null;