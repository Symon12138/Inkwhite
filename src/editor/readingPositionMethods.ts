// @ts-nocheck
// 阅读位置记忆（查看型场景）：按文档路径记住预览滚动位置，
// 重新打开/切回标签时恢复到上次读到的位置。
// 存储于 localStorage（md-editor-read-pos-v1），按时间戳裁剪只保留最近 N 篇。

const READ_POS_KEY = 'md-editor-read-pos-v1';
const SAVE_DEBOUNCE = 400;

export class ReadingPositionMethods {
  _initReadingPosition() {
    const prev = this.previewRef && this.previewRef.current;
    if (!prev || this._readPosBound) return;
    this._readPosBound = true;
    let timer = null;
    prev.addEventListener('scroll', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => this._saveReadPos(), SAVE_DEBOUNCE);
    }, { passive: true });
  }

  // 键：桌面端用文件路径；浏览器草稿用 文件名 区分
  _readPosKey() {
    return this.localFilePath || ('draft:' + (this.fileName || '未命名.md'));
  }

  _loadReadPosMap() {
    try {
      const raw = JSON.parse(localStorage.getItem('md-editor-read-pos-v1') || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch { return {}; }
  }

  _saveReadPos() {
    const prev = this.previewRef && this.previewRef.current;
    if (!prev) return;
    try {
      const map = this._loadReadPosMap();
      map[this._readPosKey()] = { top: Math.max(0, prev.scrollTop || 0), ts: Date.now() };
      // 裁剪：只保留最近 300 篇
      const entries = Object.entries(map).sort((a, b) => b[1].ts - a[1].ts);
      const trimmed = {};
      for (const [k, v] of entries.slice(0, 300)) trimmed[k] = v;
      localStorage.setItem('md-editor-read-pos-v1', JSON.stringify(trimmed));
    } catch {}
  }

  // 打开/切标签时打标；_renderPreview 完成后消费一次，避免编辑重渲染时乱跳
  _markReadPosRestore() {
    this._readPosPending = true;
  }

  _restoreReadPosSoon() {
    if (!this._readPosPending) return;
    this._readPosPending = false;
    const key = this._readPosKey();
    const go = () => {
      const entry = this._loadReadPosMap()[key];
      const prev = this.previewRef && this.previewRef.current;
      if (entry && prev && entry.top > 0) prev.scrollTop = entry.top;
    };
    // 图片水合/Mermaid 完成后再定位，避免高度不足定位不准
    const ready = typeof this._awaitPreviewReady === 'function'
      ? this._awaitPreviewReady()
      : Promise.resolve();
    ready.then(go).catch(go);
  }
}
