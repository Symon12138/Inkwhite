// Tauri 文件句柄：实现 File System Access API 句柄的最小接口，
// 底层经 tauriBridge 走 Tauri 后端 Rust fs 命令。
// 与 localFileSyncMethods 的既有同步逻辑完全兼容，同时补上浏览器做不到的部分：
// 真实绝对路径、授权一次永久有效（IndexedDB 只存 {desktopPath, name} 纯标记）。
// 替代 desktopFileHandle.ts，接口形状完全一致。

import { tauriBridge } from './tauriBridge.ts';

// ===== 类型定义 =====

/** FSA-like 文件对象（懒读正文，变更检查只看 lastModified）。 */
export interface TauriFile {
  name: string;
  lastModified: number;
  text(): Promise<string>;
}

/** FSA-like 可写流（缓冲写入，close 时一次性写盘）。 */
export interface TauriWritable {
  write(content: string): Promise<void>;
  close(): Promise<void>;
}

/** FSA-like 文件句柄接口。 */
export interface TauriFileHandle {
  kind: 'file';
  name: string;
  /** 真实绝对路径（Tauri 后端授权后可直接读写）。 */
  desktopPath: string;
  getFile(): Promise<TauriFile>;
  createWritable(): Promise<TauriWritable>;
  queryPermission(): Promise<'granted'>;
  requestPermission(): Promise<'granted'>;
}

// ===== 句柄工厂 =====

/**
 * 创建 Tauri 文件句柄。
 * @param desktopPath 文件绝对路径
 * @param name 文件名（显示用）
 */
export function createTauriFileHandle(
  desktopPath: string,
  name: string
): TauriFileHandle {
  return {
    kind: 'file' as const,
    name,
    desktopPath,

    async getFile(): Promise<TauriFile> {
      const bridge = tauriBridge;
      if (!bridge) throw new Error('Tauri 环境不可用');
      const stat = await bridge.statFile(desktopPath);
      if (!stat) throw new Error('文件不存在: ' + desktopPath);
      return {
        name,
        lastModified: stat.lastModified,
        async text(): Promise<string> {
          const data = await bridge.readFile(desktopPath);
          if (!data) throw new Error('文件不可读: ' + desktopPath);
          return data.content;
        },
      };
    },

    async createWritable(): Promise<TauriWritable> {
      const bridge = tauriBridge;
      if (!bridge) throw new Error('Tauri 环境不可用');
      // 缓冲模式：write 只暂存内容，close 时一次性写盘。
      let buffer = '';
      return {
        async write(content: string): Promise<void> {
          buffer = content;
        },
        async close(): Promise<void> {
          await bridge.writeFile(desktopPath, buffer);
        },
      };
    },

    async queryPermission(): Promise<'granted'> {
      // Tauri 后端的授权检查在 Rust 端完成，句柄层面始终返回 granted
      return 'granted' as const;
    },

    async requestPermission(): Promise<'granted'> {
      return 'granted' as const;
    },
  };
}

// ===== IndexedDB 持久化适配 =====

/**
 * 从句柄对象中提取 desktopPath 标记（用于 IndexedDB 序列化）。
 * 非桌面端句柄（FSA FileSystemFileHandle）不包含此字段，返回空字符串。
 */
function storedDesktopPath(value: unknown): string {
  const marker = value as { desktopPath?: unknown } | null;
  return marker && typeof marker.desktopPath === 'string' ? marker.desktopPath : '';
}

/**
 * 将句柄序列化为可结构化克隆的纯标记。
 * 桌面端句柄不可克隆，存 { desktopPath, name } 纯标记；浏览器句柄直接透传。
 */
export function toStorable(handle: unknown): unknown {
  const path = storedDesktopPath(handle);
  if (!path) return handle;
  return {
    desktopPath: path,
    name: (handle as { name?: string }).name || '',
  };
}

/**
 * 从 IndexedDB 存储中恢复句柄。
 * 桌面端标记重建为 TauriFileHandle；浏览器句柄直接透传。
 * 如果 Tauri 环境不可用（如开发时纯浏览器预览），返回 null。
 */
export function fromStorable(stored: unknown): unknown {
  const path = storedDesktopPath(stored);
  if (!path) return stored;
  if (!tauriBridge) return null;
  return createTauriFileHandle(path, (stored as { name?: string }).name || '');
}
