// @ts-nocheck
// 本地文件双向同步：
//   编辑器 → 本地：autosave 时把内容写穿回打开的本地文件（需要 readwrite 权限）。
//   本地 → 编辑器：通过 Tauri notify crate 的原生文件监听（onFileChanged 事件），
//     外部改动后自动重载；若编辑器还有未写回的改动则进入冲突状态，
//     暂停写回，等用户 Ctrl+S 显式覆盖。
// 句柄经 IndexedDB 持久化（见 fileHandleStore），刷新页面或从最近列表重开时自动恢复关联。
import { tauriBridge } from './tauriBridge.ts';
import { createTauriFileHandle } from './tauriFileHandle.ts';
import {
  loadFileHandle,
  saveFileHandle
} from './fileHandleStore.ts';

export class LocalFileSyncMethods {
  async _attachLocalFile(handle, { requestWrite = false } = {}) {
    this.fileHandle = handle;
    this._localFileConflict = false;
    if (requestWrite && handle.requestPermission) {
      try { await handle.requestPermission({ mode: 'readwrite' }); } catch {}
    }
    await this._updateLocalFileBaseline();
    this.localFilePath = await this._resolveLocalFilePath(handle);
    this._syncFileNameTooltip();
    if (this.fileName && this.fileName !== '未命名.md') saveFileHandle(this.fileName, handle);
    this._startLocalFileWatcher();
  }


  async _updateLocalFileBaseline(file = null) {
    try {
      const current = file || await this.fileHandle.getFile();
      this._localFileModifiedAt = current.lastModified;
    } catch {}
  }


  _startLocalFileWatcher() {
    this._stopLocalFileWatcher();
    if (!this.fileHandle || !this.fileHandle.getFile) return;
    if (!tauriBridge || !this.fileHandle.desktopPath) return;
    // 使用 Tauri 原生文件监听（notify crate），替代原来的 2 秒轮询。
    const watchPath = this.fileHandle.desktopPath;
    this._fileChangedCb = (path) => {
      if (path === watchPath) this._checkLocalFileChange();
    };
    tauriBridge.onFileChanged(this._fileChangedCb);
    // 窗口获得焦点时也检查一次（补充：覆盖监听可能遗漏的边角场景）
    this._fileWatchFocus = () => this._checkLocalFileChange();
    window.addEventListener('focus', this._fileWatchFocus);
    // 通知 Rust 端启动原生 watcher（notify crate）。
    // 失败（reject）时降级为低频 mtime 轮询兜底：网络盘/OneDrive/长路径下
    // notify 可能不可用，若静默吞掉错误，本地 → 编辑器的同步会彻底失效。
    tauriBridge.watchFile(watchPath).catch(() => {
      // 监听启动期间文件可能已被关闭/卸载（句柄被清空）：此时放弃兜底，
      // 避免事后新建无人清理的 interval。
      if (!this.fileHandle || !this.fileHandle.desktopPath) return;
      this._startWatchFallbackPolling();
    });
  }

  // 原生 watcher 启动失败时的轮询兜底：每 5 秒检查一次文件 mtime。
  // 仅当 watchFile invoke reject 时启用；停止监听时一并清理。
  _startWatchFallbackPolling() {
    // 双保险：句柄已 detach 时直接放弃，防止竞态下残留无人清理的 interval。
    if (!this.fileHandle || !this.fileHandle.desktopPath) return;
    if (this._watchFallbackTimer) return;
    this._watchFallbackTimer = setInterval(() => {
      this._checkLocalFileChange();
    }, 5000);
  }


  _stopLocalFileWatcher() {
    // 先捕获路径：_detachLocalFile() 会先调本方法再清空 fileHandle，必须在此处留存。
    const path = this.fileHandle?.desktopPath;
    if (this._fileChangedCb && tauriBridge) {
      tauriBridge.offFileChanged(this._fileChangedCb);
      this._fileChangedCb = null;
    }
    if (this._fileWatchFocus) {
      window.removeEventListener('focus', this._fileWatchFocus);
      this._fileWatchFocus = null;
    }
    // 清理轮询兜底定时器（原生 watcher 失败时才存在）。
    if (this._watchFallbackTimer) {
      clearInterval(this._watchFallbackTimer);
      this._watchFallbackTimer = null;
    }
    // 通知 Rust 端停止原生 watcher；失败静默。
    if (tauriBridge && path) tauriBridge.unwatchFile(path).catch(() => {});
  }


  _detachLocalFile() {
    this._stopLocalFileWatcher();
    this.fileHandle = null;
    this.localFilePath = null;
    this._localFileConflict = false;
    this._localFileModifiedAt = 0;
    this._syncFileNameTooltip();
  }

  // ===== 本地路径展示（Tauri 桌面端句柄自带真实绝对路径） =====

  async _resolveLocalFilePath(handle) {
    if (!handle) return null;
    if (handle.desktopPath) return handle.desktopPath;
    return null;
  }


  _syncFileNameTooltip() {
    const el = this.fileNameRef?.current;
    if (el) el.title = this.localFilePath || this.fileName || '';
  }


  async _checkLocalFileChange() {
    const handle = this.fileHandle;
    if (!handle || !handle.getFile || this._localWriteBusy) return;
    // Tauri 原生监听已经通知了变更，这里读取最新内容判断是否需要重载。
    try {
      if (handle.queryPermission && await handle.queryPermission({ mode: 'read' }) !== 'granted') return;
      const file = await handle.getFile();
      if (!(file.lastModified > (this._localFileModifiedAt || 0))) return;
      const text = this._cleanOpenedMarkdown(await file.text());
      const src = this.sourceRef.current;
      if (!src) return;
      if (text === src.value) {
        this._localFileModifiedAt = file.lastModified;
        this._localFileConflict = false;
        return;
      }
      if (this.dirty) {
        this._localFileConflict = true;
        this._setStatus('本地文件已被其他程序修改 · Ctrl+S 保存将覆盖对方改动');
        return;
      }
      this._reloadFromLocalFile(text, file);
    } catch {
      // 句柄失效（文件被移动/删除）时静默停表，编辑器内容不受影响。
      this._stopLocalFileWatcher();
    }
  }


  _reloadFromLocalFile(text, file) {
    const src = this.sourceRef.current;
    if (!src) return;
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    src.value = text;
    src.scrollTop = scrollTop;
    src.scrollLeft = scrollLeft;
    this._localFileModifiedAt = file.lastModified;
    this._localFileConflict = false;
    this._resetEditingHistory();
    this._renderComments();
    this._renderPreview();
    this._updateCount();
    this._setDirty(false);
    this._persist();
    this._setStatus('本地文件已更新 · 已重新加载 ' + (this.fileName || ''));
  }


  async _maybeWriteThroughLocalFile() {
    const handle = this.fileHandle;
    if (!handle || !handle.createWritable || !this.dirty) return;
    if (this._localFileConflict || this._localWriteBusy) return;
    const src = this.sourceRef.current;
    if (!src) return;
    try {
      if (handle.queryPermission && await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return;
      const file = await handle.getFile();
      if (file.lastModified > (this._localFileModifiedAt || 0)) {
        // 外部改动还没合并进来，不能覆盖；等待检查完成，确保冲突状态先落定。
        await this._checkLocalFileChange();
        return;
      }
      this._localWriteBusy = true;
      const content = src.value;
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      await this._updateLocalFileBaseline();
      // 写盘期间用户可能又输入了新内容，只有内容仍一致时才算"已保存"。
      if (src.value === content) this._setDirty(false);
      const t = new Date();
      this._setStatus('已同步到本地文件 · '
        + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'));
    } catch {
      // 写回失败不打断编辑；保留脏标记，用户仍可 Ctrl+S 手动保存。
    } finally {
      this._localWriteBusy = false;
    }
  }

  // ===== 恢复持久化的句柄 =====

  async _restoreLocalFileLink() {
    if (this.fileHandle || !this.fileName || this.fileName === '未命名.md') return;
    const handle = await loadFileHandle(this.fileName);
    if (!handle || !handle.getFile) return;
    let permission = 'granted';
    try {
      if (handle.queryPermission) permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      return;
    }
    if (permission === 'granted') {
      await this._adoptRestoredHandle(handle);
      return;
    }
    if (permission !== 'prompt') return;
    // 浏览器重启后恢复读写授权需要一次用户手势：挂到下一次点击/按键上。
    this._setStatus('本地文件同步待恢复 · 点击页面任意位置恢复');
    const resume = async () => {
      window.removeEventListener('pointerdown', resume, true);
      window.removeEventListener('keydown', resume, true);
      try {
        if (await handle.requestPermission({ mode: 'readwrite' }) === 'granted') {
          await this._adoptRestoredHandle(handle);
        } else {
          this._setStatus('未授权访问本地文件 · 改动只保存在浏览器内');
        }
      } catch {}
    };
    window.addEventListener('pointerdown', resume, true);
    window.addEventListener('keydown', resume, true);
  }


  // 刷新页面后重新接上句柄：本地文件更新则重载，浏览器草稿更新则写回本地。
  async _adoptRestoredHandle(handle) {
    this.fileHandle = handle;
    this._localFileConflict = false;
    this.localFilePath = await this._resolveLocalFilePath(handle);
    this._syncFileNameTooltip();
    try {
      const file = await handle.getFile();
      const text = this._cleanOpenedMarkdown(await file.text());
      const src = this.sourceRef.current;
      this._localFileModifiedAt = file.lastModified;
      if (src && text !== src.value) {
        if (file.lastModified > (this._draftSavedAt || 0)) {
          this._reloadFromLocalFile(text, file);
        } else {
          this._setDirty(true);
          this._setStatus('浏览器草稿比本地文件新 · 正在同步到本地');
          await this._maybeWriteThroughLocalFile();
        }
      }
    } catch {}
    this._startLocalFileWatcher();
  }


  // 从最近文档列表打开时重新接上本地文件；本地文件是内容的最终来源。
  async _reattachLocalFileForDocument(doc) {
    this._detachLocalFile();
    if (!doc || !doc.fileName || doc.fileName === '未命名.md') return;
    let handle = await loadFileHandle(doc.fileName);
    // Tauri 桌面端 IndexedDB 随端口漂移，重启后句柄可能丢失；
    // 工作区记录了绝对路径，Tauri 后端的路径授权持久化在 app_data_dir，
    // 按路径重建句柄即可恢复双向同步。
    if ((!handle || !handle.getFile) && doc.localPath
      && typeof window !== 'undefined' && tauriBridge) {
      handle = createTauriFileHandle(doc.localPath, doc.fileName);
    }
    if (!handle || !handle.getFile) return;
    try {
      let permission = handle.queryPermission
        ? await handle.queryPermission({ mode: 'readwrite' })
        : 'granted';
      if (permission === 'prompt' && handle.requestPermission) {
        permission = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (permission !== 'granted') return;
      const file = await handle.getFile();
      const text = this._cleanOpenedMarkdown(await file.text());
      this.fileHandle = handle;
      this._localFileModifiedAt = file.lastModified;
      this.localFilePath = await this._resolveLocalFilePath(handle);
      this._syncFileNameTooltip();
      const src = this.sourceRef.current;
      if (src && text !== src.value) {
        src.value = text;
        this._resetEditingHistory();
        this._renderComments();
        this._renderPreview();
        this._updateCount();
        this._persist();
        this._setStatus('已关联本地文件并加载最新内容 · ' + doc.fileName);
      }
      this._startLocalFileWatcher();
    } catch {}
  }

}
