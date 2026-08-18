// @ts-nocheck
// 上下文感知右键菜单（参考 Typora / Obsidian）：
// - 源码区：编辑 / 段落 / 格式 / 插入 四分组，直接复用既有格式命令；
// - 预览区：按命中元素区分 链接 / 图片 / 表格 / 选区 / 默认；
// - 侧边栏：文件树节点（文件 / 目录 / 根 / 空白）；
// - 标签页：新建 / 关闭 / 关闭其他 / 关闭右侧 / 复制路径。
// 菜单容器在 body 上惰性创建一次；Esc / 外部点击 / 滚动关闭；
// 位置按视口翻转（_clampMenuPosition，单测固化）。

import { tauriBridge } from './tauriBridge.ts';

export class ContextMenuMethods {
  // ===== 初始化：把 contextmenu 事件接到四个区域 =====

  _initContextMenus() {
    if (this._contextMenuReady) return;
    this._contextMenuReady = true;
    const src = this.sourceRef && this.sourceRef.current;
    const preview = this.previewRef && this.previewRef.current;
    const tabHost = this.tabBarRef && this.tabBarRef.current;
    const docList = this.documentListRef && this.documentListRef.current;
    if (src) src.addEventListener('contextmenu', (e) => this._onSourceContextMenu(e));
    if (preview) preview.addEventListener('contextmenu', (e) => this._onPreviewContextMenu(e));
    if (tabHost) tabHost.addEventListener('contextmenu', (e) => this._onTabContextMenu(e));
    if (docList) docList.addEventListener('contextmenu', (e) => this._onSidebarContextMenu(e));
  }

  // ===== 菜单容器与开合 =====

  _ensureContextMenuEl() {
    if (this._ctxMenuEl) return this._ctxMenuEl;
    const el = document.createElement('div');
    el.className = 'context-menu';
    el.setAttribute('role', 'menu');
    document.body.appendChild(el);
    this._ctxMenuEl = el;
    return el;
  }

  // groups: [{ group: string|null, items: [{ label, shortcut?, action?, disabled?, type? }] }]
  _openContextMenu(groups, x, y) {
    const el = this._ensureContextMenuEl();
    el.innerHTML = '';
    groups.forEach((group, gi) => {
      if (gi > 0) el.appendChild(this._menuSeparator());
      if (group.group) {
        const label = document.createElement('div');
        label.className = 'context-menu-group-label';
        label.textContent = group.group;
        el.appendChild(label);
      }
      group.items.forEach((it) => {
        if (it.type === 'sep') {
          el.appendChild(this._menuSeparator());
          return;
        }
        el.appendChild(this._menuItem(it));
      });
    });
    el.classList.add('is-open');
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = el.offsetWidth || 200, h = el.offsetHeight || 0;
    const pos = this._clampMenuPosition(x, y, w, h, vw, vh);
    el.style.left = pos.left + 'px';
    el.style.top = pos.top + 'px';
    if (!this._ctxDocH) {
      this._ctxDocH = (e) => {
        if (el.contains(e.target)) return;
        this._closeContextMenu();
      };
      document.addEventListener('mousedown', this._ctxDocH);
      this._ctxKeyH = (e) => {
        if (e.key === 'Escape') this._closeContextMenu();
      };
      document.addEventListener('keydown', this._ctxKeyH);
      // 底层内容滚动即收起；菜单自身（max-height 溢出滚动）不算外部滚动。
      this._ctxScrollH = (e) => {
        const t = e.target;
        if (this._ctxMenuEl && t && this._ctxMenuEl.contains(t)) return;
        this._closeContextMenu();
      };
      window.addEventListener('scroll', this._ctxScrollH, true);
    }
  }

  _closeContextMenu() {
    const el = this._ctxMenuEl;
    if (el) {
      el.classList.remove('is-open');
      el.innerHTML = '';
    }
    if (this._ctxDocH) {
      document.removeEventListener('mousedown', this._ctxDocH);
      this._ctxDocH = null;
    }
    if (this._ctxKeyH) {
      document.removeEventListener('keydown', this._ctxKeyH);
      this._ctxKeyH = null;
    }
    if (this._ctxScrollH) {
      window.removeEventListener('scroll', this._ctxScrollH, true);
      this._ctxScrollH = null;
    }
  }

  _menuItem(it) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item';
    btn.setAttribute('role', 'menuitem');
    if (it.disabled) btn.classList.add('is-disabled');
    const label = document.createElement('span');
    label.className = 'context-menu-label';
    label.textContent = it.label;
    btn.appendChild(label);
    if (it.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'menu-shortcut';
      sc.textContent = it.shortcut;
      btn.appendChild(sc);
    }
    if (it.action && !it.disabled) {
      btn.addEventListener('click', () => {
        this._closeContextMenu();
        it.action();
      });
    }
    return btn;
  }

  _menuSeparator() {
    const sep = document.createElement('div');
    sep.className = 'context-menu-separator';
    sep.setAttribute('role', 'separator');
    return sep;
  }

  // 视口翻转定位：贴近右/下边缘时整体挪进视口，留 4px 边距。
  _clampMenuPosition(x, y, w, h, vw, vh) {
    const gap = 4;
    let left = Math.round(x);
    let top = Math.round(y);
    if (w > 0 && left + w > vw - gap) left = Math.max(gap, vw - w - gap);
    if (h > 0 && top + h > vh - gap) top = Math.max(gap, vh - h - gap);
    left = Math.max(gap, left);
    top = Math.max(gap, top);
    return { left, top };
  }

  // ===== 源码区菜单 =====

  _onSourceContextMenu(e) {
    const src = this.sourceRef.current;
    if (!src) return;
    e.preventDefault();
    // 记录右键时的选区：菜单按钮抢焦点前需要还原，剪切/复制才作用于选区。
    this._ctxSelStart = src.selectionStart;
    this._ctxSelEnd = src.selectionEnd;
    const opts = {
      hasSelection: src.selectionStart !== src.selectionEnd,
      canUndo: (this._editingHistoryIndex || 0) > 0,
      canRedo: (this._editingHistoryIndex || 0) < ((this._editingHistory && this._editingHistory.length) || 0) - 1
    };
    this._openContextMenu(this._buildSourceMenu(opts), e.clientX, e.clientY);
  }

  _buildSourceMenu(opts) {
    const o = opts || {};
    const hasSel = !!o.hasSelection;
    const canUndo = !!o.canUndo;
    const canRedo = !!o.canRedo;
    return [
      { group: '编辑', items: [
        { label: '撤销', shortcut: '⌘Z', disabled: !canUndo, action: () => this.undoEdit() },
        { label: '重做', shortcut: '⌘⇧Z', disabled: !canRedo, action: () => this.redoEdit() },
        { type: 'sep' },
        { label: '剪切', shortcut: '⌘X', disabled: !hasSel, action: () => this._cutSource() },
        { label: '复制', shortcut: '⌘C', disabled: !hasSel, action: () => this._copySource() },
        { label: '粘贴', shortcut: '⌘V', action: () => this._pasteSource() },
        { label: '全选', shortcut: '⌘A', action: () => this._selectAllSource() },
        { type: 'sep' },
        { label: '查找替换…', shortcut: '⌘F', action: () => this.toggleSearch() }
      ]},
      { group: '段落', items: [
        { label: '标题 1', shortcut: '⌘1', action: () => this._linePrefix('# ') },
        { label: '标题 2', shortcut: '⌘2', action: () => this._linePrefix('## ') },
        { label: '标题 3', shortcut: '⌘3', action: () => this._linePrefix('### ') },
        { type: 'sep' },
        { label: '无序列表', action: () => this._linePrefix('- ') },
        { label: '有序列表', action: () => this._linePrefix('1. ') },
        { label: '引用', action: () => this._linePrefix('> ') },
        { label: '代码块', action: () => this._wrapSel('```\n', '\n```', 'code') },
        { label: '任务列表', action: () => this._linePrefix('- [ ] ') },
        { type: 'sep' },
        { label: '分割线', action: () => this._insertHr() }
      ]},
      { group: '格式', items: [
        { label: '加粗', shortcut: '⌘B', action: () => this._wrapSel('**', '**', '粗体') },
        { label: '斜体', shortcut: '⌘I', action: () => this._wrapSel('*', '*', '斜体') },
        { label: '删除线', action: () => this._wrapSel('~~', '~~', '删除线') },
        { label: '高亮', action: () => this._wrapSel('==', '==', '高亮') },
        { label: '下划线', action: () => this._wrapSel('<u>', '</u>', '下划线') },
        { type: 'sep' },
        { label: '行内代码', action: () => this._wrapSel('`', '`', 'code') },
        { label: '上标', action: () => this._wrapSel('^', '^', '上标') },
        { label: '下标', action: () => this._wrapSel('~', '~', '下标') },
        { label: '脚注', action: () => this._wrapSel('[^', ']', '1') }
      ]},
      { group: '插入', items: [
        { label: '链接', action: () => this._wrapSel('[', '](https://)', '链接文字') },
        { label: '图片…', action: () => this.onInsertImage() },
        { label: '表格', action: () => this._insertTable() }
      ]}
    ];
  }

  _selectAllSource() {
    const src = this.sourceRef.current;
    if (!src) return;
    src.focus({ preventScroll: true });
    src.select();
  }

  _restoreSourceSelection() {
    const src = this.sourceRef.current;
    if (!src || typeof this._ctxSelStart !== 'number') return;
    src.focus({ preventScroll: true });
    src.selectionStart = this._ctxSelStart;
    src.selectionEnd = this._ctxSelEnd;
  }

  _cutSource() {
    this._restoreSourceSelection();
    try { document.execCommand('cut'); } catch (e) {}
  }

  _copySource() {
    this._restoreSourceSelection();
    try { document.execCommand('copy'); } catch (e) {}
  }

  _pasteSource() {
    this._restoreSourceSelection();
    const src = this.sourceRef.current;
    if (!src) return;
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText()
        .then((text) => this._insertTextAtSelection(text))
        .catch(() => { try { document.execCommand('paste'); } catch (e) {} });
    } else {
      try { document.execCommand('paste'); } catch (e) {}
    }
  }

  _insertTextAtSelection(text) {
    const src = this.sourceRef.current;
    if (!src || text == null) return;
    this._syncCurrentEditingState();
    const s = src.selectionStart, e = src.selectionEnd;
    const val = src.value;
    const next = val.slice(0, s) + text + val.slice(e);
    src.value = next;
    this._restoreSourceView(src, s + text.length, s + text.length, src.scrollTop, src.scrollLeft);
    this._recordEditingHistory('', true);
    this._renderPreview();
    this._touch();
  }

  // ===== 预览区菜单（上下文命中） =====

  _onPreviewContextMenu(e) {
    const prev = this.previewRef.current;
    if (!prev) return;
    e.preventDefault();
    if (this._hasPreviewSelection() && typeof this._onPreviewSelect === 'function') {
      // 刷新批注锚点（_pending），让 马克笔/写想法 直接可用；随后收起浮层条。
      this._onPreviewSelect();
      if (this.selBarRef && this.selBarRef.current) this.selBarRef.current.style.display = 'none';
    }
    const hasSelection = this._hasPreviewSelection();
    this._openContextMenu(this._buildPreviewMenu(e.target, hasSelection), e.clientX, e.clientY);
  }

  _hasPreviewSelection() {
    const prev = this.previewRef.current;
    if (!prev || typeof window === 'undefined') return false;
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    return prev.contains(sel.getRangeAt(0).commonAncestorContainer);
  }

  _detectPreviewTarget(target) {
    if (!target || typeof target.closest !== 'function') return {};
    return {
      link: target.closest('a[href]') || null,
      image: target.closest('img') || null,
      table: target.closest('table') || null
    };
  }

  _buildPreviewMenu(target, hasSelection) {
    const d = this._detectPreviewTarget(target);
    if (d.link) return this._linkMenu(d.link);
    if (d.image) return this._imageMenu(d.image);
    if (d.table) return this._tableMenu(d.table);
    if (hasSelection) return this._selectionMenu();
    return this._defaultPreviewMenu();
  }

  _linkMenu(linkEl) {
    const href = (linkEl && linkEl.getAttribute && linkEl.getAttribute('href')) || '';
    const text = (linkEl && linkEl.textContent) || '';
    const external = /^https?:\/\//i.test(href);
    const items = [
      { label: '打开链接', action: () => this._openPreviewLink({ target: linkEl, preventDefault: () => {} }) }
    ];
    if (external) {
      items.push({ label: '在新标签页中打开', action: () => window.open(href, '_blank', 'noopener,noreferrer') });
    }
    items.push({ type: 'sep' });
    items.push({ label: '复制链接地址', action: () => this._copyText(href, '已复制链接地址') });
    if (text) items.push({ label: '复制链接文字', action: () => this._copyText(text, '已复制链接文字') });
    items.push({ type: 'sep' });
    items.push({ label: '全选', action: () => this._selectAllPreview() });
    return [{ group: null, items }];
  }

  _imageMenu(imgEl) {
    const src = (imgEl && imgEl.getAttribute && imgEl.getAttribute('src')) || '';
    const external = /^https?:\/\//i.test(src);
    const items = [
      { label: '复制图片', action: () => this._copyImage(imgEl) },
      { label: '复制图片地址', action: () => this._copyText(src, '已复制图片地址') }
    ];
    if (external) {
      items.push({ label: '在浏览器中打开图片', action: () => this._openImageExternal(src) });
    }
    items.push({ type: 'sep' });
    items.push({ label: '全选', action: () => this._selectAllPreview() });
    return [{ group: null, items }];
  }

  _tableMenu(tableEl) {
    return [{ group: null, items: [
      { label: '复制表格', action: () => this._copyText(this._tableToText(tableEl), '已复制表格') },
      { label: '复制表格为 Markdown', action: () => this._copyText(this._tableToMarkdown(tableEl), '已复制为 Markdown') },
      { type: 'sep' },
      { label: '全选', action: () => this._selectAllPreview() }
    ]}];
  }

  _selectionMenu() {
    return [{ group: null, items: [
      { label: '复制', shortcut: '⌘C', action: () => this.copySel() },
      { label: '复制为 HTML', action: () => this.copyHtmlSelection() },
      { type: 'sep' },
      { label: '马克笔', action: () => this.markMarker() },
      { label: '波浪线', action: () => this.markWavy() },
      { label: '直线', action: () => this.markStraight() },
      { label: '写想法', action: () => this.writeIdea() }
    ]}];
  }

  _defaultPreviewMenu() {
    return [{ group: null, items: [
      { label: '复制', shortcut: '⌘C', disabled: true, action: () => this.copySel() },
      { label: '复制为 HTML', disabled: true, action: () => this.copyHtmlSelection() },
      { type: 'sep' },
      { label: '全选', action: () => this._selectAllPreview() }
    ]}];
  }

  _selectAllPreview() {
    const prev = this.previewRef.current;
    if (!prev) return;
    const range = document.createRange();
    range.selectNodeContents(prev);
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async _copyImage(imgEl) {
    const src = imgEl && imgEl.getAttribute && imgEl.getAttribute('src');
    if (!src) return;
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const type = blob.type || 'image/png';
      await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
      this._setStatus('已复制图片');
    } catch (e) {
      this._setStatus('复制图片失败 · 请尝试复制地址');
    }
  }

  _openImageExternal(src) {
    try {
      const url = new URL(src, window.location.href);
      if (tauriBridge && tauriBridge.openExternal && /^https?:$/.test(url.protocol)) {
        tauriBridge.openExternal(url.href).catch(() => this._setStatus('无法打开图片 · ' + src));
      } else {
        window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      this._setStatus('无法打开图片 · ' + src);
    }
  }

  // ===== 侧边栏菜单 =====

  _onSidebarContextMenu(e) {
    const list = this.documentListRef && this.documentListRef.current;
    if (!list || !list.contains(e.target)) return;
    e.preventDefault();
    this._openContextMenu(this._buildSidebarMenu(e.target), e.clientX, e.clientY);
  }

  _buildSidebarMenu(target) {
    const file = target && typeof target.closest === 'function' ? target.closest('.file-tree-file') : null;
    const dir = target && typeof target.closest === 'function' ? target.closest('.file-tree-dir') : null;
    const root = target && typeof target.closest === 'function' ? target.closest('.file-tree-root') : null;
    if (file) {
      const path = (file.getAttribute && file.getAttribute('title')) || '';
      return [{ group: null, items: [
        { label: '打开', action: () => this._openFileFromTree(path, file.textContent || '') },
        { label: '复制路径', action: () => this._copyText(path, '已复制文件路径') },
        { type: 'sep' },
        { label: '刷新', action: () => this._renderFileTree() }
      ]}];
    }
    if (dir) {
      const path = (dir.getAttribute && dir.getAttribute('title')) || '';
      const expanded = !!(dir.classList && dir.classList.contains('is-expanded'));
      return [{ group: null, items: [
        { label: expanded ? '收起' : '展开', action: () => this._toggleDirFromNode(dir) },
        { label: '复制路径', action: () => this._copyText(path, '已复制文件夹路径') },
        { type: 'sep' },
        { label: '刷新', action: () => this._renderFileTree() }
      ]}];
    }
    if (root) {
      return [{ group: null, items: [
        { label: '选择文件夹…', action: () => this._pickFolder() },
        { label: '刷新', action: () => this._renderFileTree() }
      ]}];
    }
    return [{ group: null, items: [
      { label: '选择文件夹…', action: () => this._pickFolder() },
      { label: '刷新', action: () => this._renderFileTree() }
    ]}];
  }

  _toggleDirFromNode(row) {
    const path = (row && row.getAttribute && row.getAttribute('title')) || '';
    if (!path) return;
    this._toggleDir({ path, name: '' }, row);
  }

  // ===== 标签页菜单 =====

  _onTabContextMenu(e) {
    const host = this.tabBarRef && this.tabBarRef.current;
    if (!host || !host.contains(e.target)) return;
    const tabItem = e.target && e.target.closest ? e.target.closest('.tab-item') : null;
    if (!tabItem) return; // 空白区域不弹菜单
    e.preventDefault();
    const id = tabItem.getAttribute('data-tab-id');
    if (!id) return;
    this._openContextMenu(this._buildTabMenu(id), e.clientX, e.clientY);
  }

  _buildTabMenu(tabId) {
    const tab = Array.isArray(this._tabs) ? this._tabs.find((t) => t.id === tabId) : null;
    const items = [
      { label: '新建标签页', shortcut: '⌃T', action: () => this.addTab() },
      { label: '关闭标签页', shortcut: '⌃W', action: () => this.closeTab(tabId) },
      { label: '关闭其他标签页', action: () => this._closeOtherTabs(tabId) },
      { label: '关闭右侧标签页', action: () => this._closeRightTabs(tabId) }
    ];
    if (tab && tab.filePath) {
      items.push({ type: 'sep' });
      items.push({ label: '复制文件路径', action: () => this._copyText(tab.filePath, '已复制文件路径') });
    }
    return [{ group: null, items }];
  }

  async _closeOtherTabs(id) {
    const tabs = Array.isArray(this._tabs) ? this._tabs : [];
    const others = tabs.filter((t) => t.id !== id);
    if (!others.length) return;
    if (others.some((t) => t.dirty) && !(await this._confirmCloseMany('关闭其他标签页', others.length))) return;
    this._tabs = [tabs.find((t) => t.id === id)];
    this._activeTabId = id;
    if (typeof this._renderTabBar === 'function') this._renderTabBar();
    if (typeof this._persistTabs === 'function') this._persistTabs();
  }

  async _closeRightTabs(id) {
    const tabs = Array.isArray(this._tabs) ? this._tabs : [];
    const index = tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const right = tabs.slice(index + 1);
    if (!right.length) return;
    if (right.some((t) => t.dirty) && !(await this._confirmCloseMany('关闭右侧标签页', right.length))) return;
    this._tabs = tabs.slice(0, index + 1);
    if (typeof this._renderTabBar === 'function') this._renderTabBar();
    if (typeof this._persistTabs === 'function') this._persistTabs();
  }

  _confirmCloseMany(title, count) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'close-confirm-overlay';
      const box = document.createElement('div');
      box.className = 'close-confirm-box';
      const heading = document.createElement('strong');
      heading.textContent = title;
      const hint = document.createElement('p');
      hint.textContent = '将关闭 ' + count + ' 个标签页' + (count > 1 ? '，其中包含未保存的改动' : '');
      const actions = document.createElement('div');
      actions.className = 'close-confirm-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'abtn';
      cancel.textContent = '取消';
      cancel.addEventListener('click', () => { overlay.remove(); resolve(false); });
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'abtn danger';
      confirmBtn.textContent = '关闭';
      confirmBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
      actions.append(cancel, confirmBtn);
      box.append(heading, hint, actions);
      overlay.appendChild(box);
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
      document.body.appendChild(overlay);
    });
  }

  // ===== 复制与表格转换 =====

  _copyText(text, status) {
    const done = () => this._setStatus(status || '已复制');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      } catch (e) {}
      done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  _tableToText(table) {
    if (!table || typeof table.querySelectorAll !== 'function') return '';
    return Array.from(table.querySelectorAll('tr'))
      .map((tr) => Array.from(tr.children || []).map((c) => (c.textContent || '').trim()).join('\t'))
      .join('\n');
  }

  // 预览表格 → Markdown 表格：按首行列数补齐、单元格内管道符转义。
  _tableToMarkdown(table) {
    if (!table || typeof table.querySelectorAll !== 'function') return '';
    const rows = Array.from(table.querySelectorAll('tr'));
    const grid = rows.map((tr) =>
      Array.from(tr.children || []).map((c) => (c.textContent || '').trim().replace(/\|/g, '\\|')));
    if (!grid.length) return '';
    const cols = Math.max.apply(null, grid.map((r) => r.length));
    const pad = (r) => {
      const a = r.slice(0, cols);
      while (a.length < cols) a.push('');
      return a;
    };
    const header = pad(grid[0]);
    const lines = ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |'];
    for (let i = 1; i < grid.length; i++) {
      lines.push('| ' + pad(grid[i]).join(' | ') + ' |');
    }
    return lines.join('\n');
  }
}
