// 本地文件句柄持久化。File System Access API 的句柄可结构化克隆，
// 存进 IndexedDB 后，刷新页面或从最近文档列表重开时可以恢复与本地文件的关联。
// Tauri 桌面端句柄不可克隆，出入库时经 toStorable/fromStorable 转换为纯路径标记。
// 环境不支持（无 indexedDB、句柄不可克隆）时静默降级为不持久化。
import { fromStorable, toStorable } from './tauriFileHandle.ts';

const DB_NAME = 'mojian-local-files';
const DB_VERSION = 2;
const FILE_STORE = 'file-handles';

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  return openDatabase().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      try {
        const request = run(db.transaction(storeName, mode).objectStore(storeName));
        request.onsuccess = () => { db.close(); resolve(request.result as T); };
        request.onerror = () => { db.close(); resolve(null); };
      } catch {
        db.close();
        resolve(null);
      }
    });
  });
}

export async function saveFileHandle(fileName: string, handle: unknown): Promise<void> {
  if (!fileName) return;
  await withStore(FILE_STORE, 'readwrite', (store) => store.put(toStorable(handle), fileName));
}

export async function loadFileHandle(fileName: string): Promise<unknown> {
  if (!fileName) return null;
  const stored = await withStore(FILE_STORE, 'readonly', (store) => store.get(fileName));
  return fromStorable(stored);
}

export async function deleteFileHandle(fileName: string): Promise<void> {
  if (!fileName) return;
  await withStore(FILE_STORE, 'readwrite', (store) => store.delete(fileName));
}
