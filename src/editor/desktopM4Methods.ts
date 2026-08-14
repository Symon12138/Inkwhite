// @ts-nocheck
// M4 桌面细节：拖入 Markdown 打开（D）、窗口状态记忆（B24）、关闭确认（B24）、
// 最近文档（B17）、快速打开（B17）。
// 纯逻辑（统计/搜索排序）在 statsMethods / globalSearchComposer，本文件为接线。

import { tauriBridge } from './tauriBridge.ts';
import { computeStats, formatStats } from './statsMethods.ts';

export class DesktopM4Methods {
  // ===== 拖入打开（统一 drop dispatcher，M4 D） =====

  _initDesktopDrop() {
    if (this._dropBound) return;
    this._dropBound = true;
    const src = this.sourceRef.current, prev = this.previewRef.current;
    if (src) {
      src.addEventListener('dragover', (e) => e.preventDefault());
      src.addEventListener('drop', (e) => this._onDomDrop(e));
    }
    if (prev) {
      prev.addEventListener('dragover', (e) => e.preventDefault());
      prev.addEventListener('drop', (e) => this._onDomDrop(e));
    }
    if (tauriBridge) {
      // 桌面原生拖放（WebView2 路径列表，DOM drop 拿不到文件时兜底）
      tauriBridge.onDesktopDrop((paths) => this._onDesktopPaths(paths));
    }
  }

  _onDomDrop(event) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    const docs = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
    if (images.length) this._insertImageFiles(images);
    if (docs.length) this._openDroppedFiles(docs);
  }

  async _openDroppedFiles(files) {
    for (const file of files) {
      if (tauriBridge && file.path) {
        const picked = await tauriBridge.openDroppedFile(file.path);
        if (picked) await this._openDesktopFile(picked);
      } else {
        // 浏览器端：FileReader 直接读内容打开
        const text = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => resolve('');
          reader.readAsText(file);
        });
        if (text) this._openDroppedText(text, file.name);
      }
    }
  }

  _openDroppedText(text, name) {
    const src = this.sourceRef.current;
    if (!src) return;
    this._syncCurrentEditingState();
    src.value = text;
    this._setFileName(name);
    this._resetEditingHistory();
    this._renderPreview();
    this._updateCount();
    this._setStatus('已打开 ' + name + '（浏览器草稿模式）');
  }

  async _onDesktopPaths(paths) {
    for (const path of paths) {
      const lower = path.toLowerCase();
      if (/\.(md|markdown|txt)$/.test(lower)) {
        const picked = await tauriBridge.openDroppedFile(path);
        if (picked) await this._openDesktopFile(picked);
      } else if (/\.(png|jpe?g|gif|webp|bmp|avif|ico)$/.test(lower)) {
        const img = await tauriBridge.readDroppedImage(path);
        if (img) await this._insertImagePayload(img.dataUrl, img.name);
      } else {
        this._setStatus('不支持的拖入文件 · ' + path.split(/[\\/]/).pop());
      }
    }
  }

  // ===== 窗口状态记忆（B24，按平台分级：Tauri 桌面生效） =====

  _initWindowState() {
    if (!tauriBridge || this._windowStateBound) return;
    this._windowStateBound = true;
    this._restoreWindowState();
    // resize/move 去抖保存
    const save = () => {
      clearTimeout(this._windowStateT);
      this._windowStateT = setTimeout(() => this._persistWindowState(), 400);
    };
    window.addEventListener('resize', save);
    window.addEventListener('move', save);
  }

  _persistWindowState() {
    try {
      localStorage.setItem('md-editor-window-state', JSON.stringify({
        w: window.outerWidth,
        h: window.outerHeight,
        x: window.screenX,
        y: window.screenY
      }));
    } catch { /* 存储不可用时静默 */ }
  }

  async _restoreWindowState() {
    try {
      const raw = localStorage.getItem('md-editor-window-state');
      if (!raw) return;
      const state = JSON.parse(raw);
      if (typeof state.w !== 'number' || typeof state.h !== 'number') return;
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (typeof state.x === 'number' && typeof state.y === 'number') {
        await win.setPosition({ x: state.x, y: state.y });
      }
      await win.setSize({ width: Math.max(960, state.w), height: Math.max(600, state.h) });
    } catch { /* 恢复失败不阻塞启动 */ }
  }

  // ===== 关闭确认（B24） =====

  _initCloseGuard() {
    if (!tauriBridge || this._closeGuardBound) return;
    this._closeGuardBound = true;
    tauriBridge.onCloseRequested(() => this._handleCloseRequested());
  }

  _handleCloseRequested() {
    if (!this.dirty) {
      // 干净状态直接放行
      tauriBridge.setCloseAllowed().then(async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        getCurrentWindow().close();
      });
      return;
    }
    // dirty：弹出确认（window.confirm 在 WebView2 可用性不定，用自定义模态）
    this._showCloseConfirm();
  }

  _showCloseConfirm() {
    if (this._closeConfirmEl) {
      this._closeConfirmEl.style.display = 'flex';
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'close-confirm-overlay';
    const box = document.createElement('div');
    box.className = 'close-confirm-box';
    const title = document.createElement('strong');
    title.textContent = '有未保存的改动';
    const hint = document.createElement('p');
    hint.textContent = '关闭窗口将丢失自上次保存以来的修改。';
    const actions = document.createElement('div');
    actions.className = 'close-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'abtn';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => { overlay.style.display = 'none'; });
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'abtn danger';
    discard.textContent = '不保存关闭';
    discard.addEventListener('click', async () => {
      overlay.style.display = 'none';
      await tauriBridge.setCloseAllowed();
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      getCurrentWindow().close();
    });
    actions.append(cancel, discard);
    box.append(title, hint, actions);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.body.appendChild(overlay);
    this._closeConfirmEl = overlay;
  }

  // ===== 最近文档（B17） =====

  _recentKey() { return 'md-editor-recent-documents'; }

  _loadRecent() {
    try {
      const raw = localStorage.getItem(this._recentKey());
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.slice(0, 10) : [];
    } catch { return []; }
  }

  _rememberRecent(path, name) {
    if (!path) return;
    const list = this._loadRecent().filter((item) => item.path !== path);
    list.unshift({ path, name, at: Date.now() });
    try {
      localStorage.setItem(this._recentKey(), JSON.stringify(list.slice(0, 10)));
    } catch { /* 静默 */ }
  }

  toggleRecentMenu() {
    if (!this._recentEl) this._buildRecentMenu();
    const el = this._recentEl;
    if (el.style.display === 'block') { el.style.display = 'none'; return; }
    const list = this._loadRecent();
    const body = el.querySelector('.recent-list');
    body.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'recent-empty';
      empty.textContent = '还没有打开过本地文档';
      body.appendChild(empty);
    } else {
      list.forEach((item) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recent-item';
        btn.title = item.path;
        btn.textContent = item.name;
        btn.addEventListener('click', async () => {
          el.style.display = 'none';
          if (tauriBridge) {
            const data = await tauriBridge.readFile(item.path);
            if (data) await this._openDesktopFile({ path: item.path, name: item.name, content: data.content, lastModified: data.lastModified });
            else this._setStatus('最近文档不可读（可能已被移动或删除）');
          }
        });
        body.appendChild(btn);
      });
    }
    el.style.display = 'block';
    const btn = this.recentMenuAnchorRef && this.recentMenuAnchorRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      el.style.left = rect.left + 'px';
      el.style.top = rect.bottom + 4 + 'px';
    } else {
      el.style.left = '8px';
      el.style.top = '120px';
    }
  }

  _buildRecentMenu() {
    const el = document.createElement('div');
    el.className = 'recent-menu';
    const body = document.createElement('div');
    body.className = 'recent-list';
    el.appendChild(body);
    document.body.appendChild(el);
    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('mousedown', (e) => {
        if (el.style.display === 'block' && !el.contains(e.target)) {
          el.style.display = 'none';
        }
      });
    }, 0);
    this._recentEl = el;
  }

  // 打开本地文件后记录最近文档（由 _openDesktopFile 接线）
  _trackRecent(picked) {
    this._rememberRecent(picked.path, picked.name);
  }

  // ===== 快速打开（B17） =====

  onQuickOpen() {
    if (!tauriBridge) {
      this._setStatus('快速打开需要桌面端环境');
      return;
    }
    if (this._quickOpenEl) {
      this._quickOpenEl.style.display = 'flex';
      this._quickOpenInput.focus();
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'quick-open-overlay';
    const box = document.createElement('div');
    box.className = 'quick-open-box';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'quick-open-input';
    input.placeholder = '输入文件名关键词…';
    const hint = document.createElement('div');
    hint.className = 'quick-open-hint';
    hint.textContent = '在当前文件树根目录内搜索（Enter 打开第一个匹配）';
    box.append(input, hint);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        overlay.style.display = 'none';
        await this.quickOpen(input.value);
      } else if (e.key === 'Escape') {
        overlay.style.display = 'none';
      }
    });
    document.body.appendChild(overlay);
    this._quickOpenEl = overlay;
    this._quickOpenInput = input;
    input.focus();
  }

  async quickOpen(nameQuery) {
    if (!tauriBridge) {
      this._setStatus('快速打开需要桌面端环境');
      return;
    }
    const root = this.fileTreeRoot;
    if (!root) {
      this._setStatus('请先选择文件夹（文件树）');
      return;
    }
    const needle = (nameQuery || '').trim().toLowerCase();
    if (!needle) {
      this._setStatus('请输入文件名关键词');
      return;
    }
    const matches = await this._collectMatchingFiles(root, needle, 0, 50);
    if (!matches.length) {
      this._setStatus('没有匹配的文件');
      return;
    }
    // 打开第一个精确匹配（无扩展名匹配优先）
    const exact = matches.find((m) => m.name.toLowerCase() === needle || m.name.toLowerCase() === needle + '.md');
    const target = exact || matches[0];
    const data = await tauriBridge.readFile(target.path);
    if (data) await this._openDesktopFile({ path: target.path, name: target.name, content: data.content, lastModified: data.lastModified });
  }

  async _collectMatchingFiles(dir, needle, depth, limit) {
    if (depth > 6) return [];
    let out = [];
    try {
      const entries = await tauriBridge.listDirectory(dir);
      for (const entry of entries) {
        if (out.length >= limit) break;
        if (entry.isDir) {
          out = out.concat(await this._collectMatchingFiles(entry.path, needle, depth + 1, limit - out.length));
        } else if (/\.(md|markdown|txt)$/i.test(entry.name) && entry.name.toLowerCase().includes(needle)) {
          out.push(entry);
        }
      }
    } catch { /* 目录不可读跳过 */ }
    return out;
  }
}
