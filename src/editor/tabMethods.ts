// @ts-nocheck
// M5：多文档标签页接线。
// 模型：单个编辑器实例 + 标签栏；切换标签时快照/恢复实例状态（内容、历史、
// 批注、文件句柄、dirty）。标签数据持久化到 localStorage（md-editor-tabs-v1），
// 旧单文档数据（md-editor-warm-v1）自动迁移。

import { tauriBridge } from './tauriBridge.ts';
import { createTauriFileHandle } from './tauriFileHandle.ts';
import {
  TABS_STORAGE_KEY,
  MAX_TABS,
  createDocId,
  nextUntitledTitle,
  serializeTabs,
  parseTabs,
  migrateLegacyToTabs,
  activeTabOf
} from './tabStore.ts';
import { loadEditorState } from './storage.ts';

export class TabMethods {
  // ===== 初始化 =====

  _initTabs() {
    if (this._tabsReady) return;
    this._tabsReady = true;
    this._tabs = [];
    this._activeTabId = null;
    // 关闭/刷新前强制快照并持久化（不依赖 600ms 自动保存窗口）
    window.addEventListener('beforeunload', () => {
      this._snapshotActiveTab();
      this._persistTabs();
    });
    this._buildTabBar();
    // 恢复：优先标签快照；否则迁移旧单文档；否则当前文档作为首个标签
    const raw = this._loadTabsRaw();
    const snapshot = parseTabs(raw) || migrateLegacyToTabs(loadEditorState());
    if (snapshot && snapshot.tabs.length) {
      this._tabs = snapshot.tabs;
      this._activeTabId = snapshot.activeId;
      const active = activeTabOf(snapshot);
      if (active) this._loadTabIntoEditor(active);
      this._renderTabBar();
      // 迁移完成：清掉旧键，写入新结构
      if (!parseTabs(raw)) {
        try { localStorage.removeItem('md-editor-warm-v1'); } catch {}
        this._persistTabs();
      }
    } else {
      this._registerCurrentAsTab();
    }
  }

  _loadTabsRaw() {
    try {
      return localStorage.getItem(TABS_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  _registerCurrentAsTab() {
    const src = this.sourceRef.current;
    const id = createDocId();
    this._tabs = [{
      id,
      title: this.fileName || '未命名.md',
      content: src ? src.value : '',
      fileName: this.fileName || '未命名.md',
      filePath: this.localFilePath || '',
      comments: Array.isArray(this.comments) ? this.comments.slice() : [],
      dirty: !!this.dirty,
      createdAt: Date.now()
    }];
    this._activeTabId = id;
    this._renderTabBar();
    this._persistTabs();
  }

  // ===== 标签栏 DOM =====

  _buildTabBar() {
    const host = this.tabBarRef && this.tabBarRef.current;
    if (!host || this._tabBarEl) return;
    const bar = document.createElement('div');
    bar.className = 'tab-bar';
    bar.setAttribute('role', 'tablist');
    // 品牌并入标签栏（原 54px header 已删除，压缩顶部垂直空间）
    const brand = document.createElement('span');
    brand.className = 'tab-bar-brand';
    brand.setAttribute('aria-hidden', 'true');
    const dot = document.createElement('span');
    dot.className = 'brand-dot';
    brand.appendChild(dot);
    brand.appendChild(document.createTextNode('飞白'));
    bar.appendChild(brand);
    const list = document.createElement('div');
    list.className = 'tab-list';
    bar.appendChild(list);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tab-add';
    add.title = '新建标签页（Ctrl+T）';
    add.setAttribute('aria-label', '新建标签页');
    add.textContent = '+';
    add.addEventListener('click', () => this.addTab());
    bar.appendChild(add);
    host.appendChild(bar);
    this._tabBarEl = bar;
    this._tabListEl = list;
  }

  _renderTabBar() {
    if (!this._tabListEl) return;
    this._tabListEl.innerHTML = '';
    this._tabs.forEach((tab, index) => {
      const item = document.createElement('div');
      item.className = 'tab-item' + (tab.id === this._activeTabId ? ' is-active' : '');
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', tab.id === this._activeTabId ? 'true' : 'false');
      item.dataset.tabId = tab.id;
      item.title = tab.filePath || tab.title;
      const dot = document.createElement('span');
      dot.className = 'tab-dirty' + (tab.dirty ? ' is-dirty' : '');
      dot.textContent = tab.dirty ? '●' : '';
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tab.title;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.setAttribute('aria-label', '关闭标签页');
      close.textContent = '×';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });
      item.append(dot, label, close);
      item.addEventListener('click', () => this.switchTab(tab.id));
      item.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.closeTab(tab.id);
        }
      });
      this._tabListEl.appendChild(item);
    });
    // 更新标题（活动标签）
    const active = this._activeTab();
    if (active) {
      document.title = active.title + ' · 飞白';
    }
  }

  _activeTab() {
    return this._tabs.find((t) => t.id === this._activeTabId) ?? null;
  }

  // ===== 标签操作 =====

  addTab() {
    const src = this.sourceRef.current;
    if (!src) return;
    // 当前标签快照先行
    this._snapshotActiveTab();
    const id = createDocId();
    const title = nextUntitledTitle(this._tabs.map((t) => t.title));
    this._tabs.push({
      id,
      title,
      content: '',
      fileName: title,
      filePath: '',
      comments: [],
      dirty: false,
      createdAt: Date.now()
    });
    this._activeTabId = id;
    this._loadTabIntoEditor(this._tabs[this._tabs.length - 1]);
    this._renderTabBar();
    this._persistTabs();
    this._setStatus('新建标签页 · ' + title);
  }

  switchTab(id) {
    if (id === this._activeTabId) return;
    const target = this._tabs.find((t) => t.id === id);
    if (!target) return;
    this._snapshotActiveTab();
    this._activeTabId = id;
    this._loadTabIntoEditor(target);
    this._renderTabBar();
    this._persistTabs();
  }

  async closeTab(id) {
    const index = this._tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const tab = this._tabs[index];
    if (tab.dirty && tab.id === this._activeTabId) {
      const ok = await this._confirmCloseTab(tab);
      if (!ok) return;
    }
    this._tabs.splice(index, 1);
    if (this._activeTabId === id) {
      // 切换到邻居；无剩余标签时回到空文档
      const neighbor = this._tabs[Math.min(index, this._tabs.length - 1)] ?? null;
      if (neighbor) {
        this._activeTabId = neighbor.id;
        this._loadTabIntoEditor(neighbor);
      } else {
        this._activeTabId = null;
        this._resetToEmptyDoc();
      }
    }
    this._renderTabBar();
    this._persistTabs();
  }

  // 关闭 dirty 标签确认（非活动标签 dirty 关闭也确认；活动标签关闭走此路径）
  async _confirmCloseTab(tab) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'close-confirm-overlay';
      const box = document.createElement('div');
      box.className = 'close-confirm-box';
      const title = document.createElement('strong');
      title.textContent = '关闭「' + tab.title + '」？';
      const hint = document.createElement('p');
      hint.textContent = '该标签页有未保存的改动，关闭将丢失。';
      const actions = document.createElement('div');
      actions.className = 'close-confirm-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'abtn';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => { overlay.remove(); resolve(false); });
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'abtn danger';
      discard.textContent = '不保存关闭';
      discard.addEventListener('click', () => { overlay.remove(); resolve(true); });
      actions.append(cancel, discard);
      box.append(title, hint, actions);
      overlay.appendChild(box);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
      document.body.appendChild(overlay);
    });
  }

  _resetToEmptyDoc() {
    const src = this.sourceRef.current;
    if (!src) return;
    this._syncCurrentEditingState();
    src.value = '';
    this.fileName = '未命名.md';
    this._setFileName('未命名.md');
    this.comments = [];
    this.localFilePath = null;
    this.dirty = false;
    this._resetEditingHistory();
    this._renderPreview();
    this._renderComments();
    this._updateCount();
    this._detachLocalFile();
  }

  // ===== 快照 / 恢复 =====

  // 把当前编辑器状态写回活动标签（除内容外还含历史/批注/文件/dirty）
  _snapshotActiveTab() {
    const tab = this._activeTab();
    const src = this.sourceRef.current;
    if (!tab || !src) return;
    tab.content = src.value;
    tab.title = this.fileName || tab.title;
    tab.fileName = this.fileName || tab.title;
    tab.filePath = this.localFilePath || '';
    tab.comments = Array.isArray(this.comments) ? this.comments.slice() : [];
    tab.dirty = !!this.dirty;
  }

  // 把标签状态载入编辑器
  _loadTabIntoEditor(tab) {
    const src = this.sourceRef.current;
    if (!src) return;
    this._stopLocalFileWatcher();
    this._syncCurrentEditingState();
    src.value = tab.content;
    this.fileName = tab.fileName || '未命名.md';
    this._setFileName(this.fileName);
    this.comments = Array.isArray(tab.comments) ? tab.comments.slice() : [];
    this.dirty = !!tab.dirty;
    this._setDirty(this.dirty);
    this._resetEditingHistory();
    this._renderPreview();
    this._renderComments();
    this._updateCount();
    // 文件句柄恢复：桌面端按路径重挂
    if (tab.filePath && tauriBridge) {
      createTauriFileHandle(tab.filePath, tab.fileName)
        .then((handle) => this._attachLocalFile(handle))
        .catch(() => {});
    } else {
      this._detachLocalFile();
    }
  }

  // 打开文档/保存后同步活动标签（由 _openDesktopFile / onSaveAs 等接线）
  _syncActiveTabFromEditor() {
    const tab = this._activeTab();
    if (!tab) return;
    const src = this.sourceRef.current;
    tab.content = src ? src.value : tab.content;
    tab.title = this.fileName || tab.title;
    tab.fileName = this.fileName || tab.title;
    tab.filePath = this.localFilePath || '';
    tab.comments = Array.isArray(this.comments) ? this.comments.slice() : [];
    tab.dirty = !!this.dirty;
    this._renderTabBar();
    this._persistTabs();
  }

  _persistTabs() {
    const raw = serializeTabs(this._activeTabId, this._tabs);
    if (raw) {
      try {
        localStorage.setItem(TABS_STORAGE_KEY, raw);
      } catch {
        // 存储满时丢弃最旧标签后重试一次
        if (this._tabs.length > 1) {
          this._tabs.shift();
          const retry = serializeTabs(this._activeTabId, this._tabs);
          if (retry) {
            try { localStorage.setItem(TABS_STORAGE_KEY, retry); } catch {}
          }
          this._renderTabBar();
        }
      }
    }
  }

  // ===== 快捷键（Ctrl+T 新标签 / Ctrl+W 关闭 / Ctrl+Tab 切换） =====

  _handleTabShortcut(e) {
    const modifier = e.metaKey || e.ctrlKey;
    if (!modifier || e.altKey) return false;
    const key = e.key.toLowerCase();
    if (key === 't') {
      e.preventDefault();
      this.addTab();
      return true;
    }
    if (key === 'w') {
      e.preventDefault();
      const active = this._activeTab();
      if (active) this.closeTab(active.id);
      return true;
    }
    if (key === 'tab') {
      e.preventDefault();
      if (this._tabs.length > 1) {
        const index = this._tabs.findIndex((t) => t.id === this._activeTabId);
        const next = this._tabs[(index + 1) % this._tabs.length];
        this.switchTab(next.id);
      }
      return true;
    }
    return false;
  }
}
