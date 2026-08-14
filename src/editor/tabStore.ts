// M5：多文档标签页纯逻辑（docId 生成、序列化、旧单文档数据迁移）。
// 状态快照/恢复由 tabMethods（接线层）负责；本文件只做可单测的纯函数。

export const TABS_STORAGE_KEY = 'md-editor-tabs-v1';
export const MAX_TABS = 20;

export interface TabMeta {
  id: string;
  title: string;
  /** 本地文件路径（未命名文档为空串） */
  filePath: string;
  createdAt: number;
}

export interface PersistedTab {
  id: string;
  title: string;
  content: string;
  fileName: string;
  filePath: string;
  comments: unknown[];
  dirty: boolean;
  createdAt: number;
}

export interface TabsSnapshot {
  activeId: string;
  tabs: PersistedTab[];
}

export function createDocId(): string {
  return 'doc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** 未命名文档标题：首个「未命名.md」，后续「未命名-2.md」…… */
export function nextUntitledTitle(existing: string[]): string {
  const taken = new Set(existing);
  if (!taken.has('未命名.md')) return '未命名.md';
  let index = 2;
  while (taken.has('未命名-' + index + '.md')) index += 1;
  return '未命名-' + index + '.md';
}

/** 新标签默认内容（与编辑器初始样例一致的空文档由接线层决定；这里提供空内容）。 */
export function emptyTabContent(): string {
  return '';
}

export function serializeTabs(activeId: string, tabs: PersistedTab[]): string | null {
  const capped = tabs.slice(0, MAX_TABS);
  try {
    return JSON.stringify({ activeId, tabs: capped } satisfies TabsSnapshot);
  } catch {
    return null;
  }
}

export function parseTabs(raw: string | null): TabsSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TabsSnapshot;
    if (!parsed || !Array.isArray(parsed.tabs) || typeof parsed.activeId !== 'string') return null;
    if (!parsed.tabs.some((t) => t.id === parsed.activeId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 旧单文档数据（md-editor-warm-v1 的 PersistedEditorState 形状）迁移为标签快照。
 * content/fileName/comments 取自已持久化状态；dirty 为 false（已持久化）。
 */
export function migrateLegacyToTabs(legacy: {
  content?: unknown;
  fileName?: unknown;
  comments?: unknown;
} | null): TabsSnapshot | null {
  if (!legacy) return null;
  const content = typeof legacy.content === 'string' ? legacy.content : '';
  if (!content) return null;
  const id = createDocId();
  return {
    activeId: id,
    tabs: [{
      id,
      title: typeof legacy.fileName === 'string' && legacy.fileName ? legacy.fileName : '未命名.md',
      content,
      fileName: typeof legacy.fileName === 'string' && legacy.fileName ? legacy.fileName : '未命名.md',
      filePath: '',
      comments: Array.isArray(legacy.comments) ? legacy.comments : [],
      dirty: false,
      createdAt: Date.now()
    }]
  };
}

/** 从快照取活动标签；空快照返回 null。 */
export function activeTabOf(snapshot: TabsSnapshot | null): PersistedTab | null {
  if (!snapshot) return null;
  return snapshot.tabs.find((t) => t.id === snapshot.activeId) ?? null;
}
