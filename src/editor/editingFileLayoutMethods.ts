// @ts-nocheck
import { tauriBridge } from './tauriBridge.ts';
import { createTauriFileHandle } from './tauriFileHandle.ts';
import { exportHtmlFromPreview } from './exportMethods.ts';
import { flattenForWord, renderWordImages } from './flattenDocument.ts';
import { buildDocx } from './wordExport.ts';
import { extractExportCss } from './exportComposer.ts';
import { resolveCssVariables } from './exportMethods.ts';
import { inlineFontFaces } from './shareExportUtils.ts';

/**
 * 线性扫描剥离「批注 span」（开标签含 data-comment-id，保留内部内容）。
 * 对抗测试发现的 ReDoS 修复：懒惰正则在大量未闭合 <span> 时每个起点都
 * 扫到串尾（O(n²)），48 万字符即可冻结 UI 秒级；本扫描器严格 O(n)。
 * 语义与原正则一致：未闭合的候选 span 原样保留。
 */
function stripCommentSpansLinear(value) {
  const OPEN = '<span';
  const CLOSE = '</span>';
  let out = '';
  let i = 0;
  for (;;) {
    const start = value.indexOf(OPEN, i);
    if (start === -1) { out += value.slice(i); return out; }
    const gt = value.indexOf('>', start);
    if (gt === -1) { out += value.slice(i); return out; }
    const openTag = value.slice(start, gt);
    const isCommentSpan = /^<span[\s>]/i.test(openTag) && /\bdata-comment-id=/.test(openTag);
    if (!isCommentSpan) { i = start + OPEN.length; continue; }
    const close = value.indexOf(CLOSE, gt);
    if (close === -1) { out += value.slice(i); return out; } // 未闭合：原样保留（与原正则一致）
    out += value.slice(i, start) + value.slice(gt + 1, close);
    i = close + CLOSE.length;
  }
}

export class EditingFileLayoutMethods {
  _captureEditingState() {
    const src = this.sourceRef.current;
    if (!src) return null;
    return {
      value: src.value,
      selectionStart: src.selectionStart,
      selectionEnd: src.selectionEnd,
      scrollTop: src.scrollTop,
      scrollLeft: src.scrollLeft
    };
  }


  _resetEditingHistory() {
    const initial = this._captureEditingState();
    this._editingHistory = initial ? [initial] : [];
    this._editingHistoryIndex = initial ? 0 : -1;
    this._lastHistoryInputType = '';
    this._lastHistoryInputAt = 0;
    this._syncEditingHistoryButtons();
  }


  _syncCurrentEditingState() {
    const current = this._editingHistory?.[this._editingHistoryIndex];
    const actual = this._captureEditingState();
    if (!current || !actual || current.value !== actual.value) return;
    if (current.selectionStart !== actual.selectionStart || current.selectionEnd !== actual.selectionEnd) {
      this._lastHistoryInputType = '';
    }
    this._editingHistory[this._editingHistoryIndex] = actual;
  }


  _recordEditingHistory(inputType = '', forceNewEntry = false) {
    const next = this._captureEditingState();
    if (!next) return;
    if (!Array.isArray(this._editingHistory) || this._editingHistoryIndex < 0) {
      this._resetEditingHistory();
      return;
    }
    const current = this._editingHistory[this._editingHistoryIndex];
    if (current && current.value === next.value) return;
    const now = Date.now();
    const coalesce = !forceNewEntry
      && inputType
      && inputType === this._lastHistoryInputType
      && now - this._lastHistoryInputAt < 800
      && this._editingHistoryIndex === this._editingHistory.length - 1
      && this._editingHistoryIndex > 0;
    this._editingHistory.splice(this._editingHistoryIndex + 1);
    if (coalesce) {
      this._editingHistory[this._editingHistoryIndex] = next;
    } else {
      this._editingHistory.push(next);
      this._editingHistoryIndex += 1;
    }
    if (this._editingHistory.length > 200) {
      this._editingHistory.shift();
      this._editingHistoryIndex -= 1;
    }
    this._lastHistoryInputType = inputType;
    this._lastHistoryInputAt = now;
    this._syncEditingHistoryButtons();
  }


  _syncEditingHistoryButtons() {
    const canUndo = this._editingHistoryIndex > 0;
    const canRedo = Array.isArray(this._editingHistory)
      && this._editingHistoryIndex >= 0
      && this._editingHistoryIndex < this._editingHistory.length - 1;
    if (this.undoButtonRef?.current) this.undoButtonRef.current.disabled = !canUndo;
    if (this.redoButtonRef?.current) this.redoButtonRef.current.disabled = !canRedo;
  }


  _applyEditingHistory(index) {
    const state = this._editingHistory?.[index];
    const src = this.sourceRef.current;
    if (!state || !src) return;
    this._editingHistoryIndex = index;
    src.value = state.value;
    this._restoreSourceView(
      src,
      state.selectionStart,
      state.selectionEnd,
      state.scrollTop,
      state.scrollLeft
    );
    this._lastHistoryInputType = '';
    this._renderPreview();
    this._touch();
    this._syncEditingHistoryButtons();
  }


  undoEdit() {
    if (this._editingHistoryIndex > 0) {
      this._applyEditingHistory(this._editingHistoryIndex - 1);
    }
  }


  redoEdit() {
    if (this._editingHistoryIndex < (this._editingHistory?.length || 0) - 1) {
      this._applyEditingHistory(this._editingHistoryIndex + 1);
    }
  }


  _restoreSourceView(src, selectionStart, selectionEnd, scrollTop, scrollLeft) {
    src.selectionStart = selectionStart;
    src.selectionEnd = selectionEnd;
    src.focus({ preventScroll: true });
    src.scrollTop = scrollTop;
    src.scrollLeft = scrollLeft;
  }


  _wrapSel(before, after, placeholder) {
    const src = this.sourceRef.current;
    if (!src) return;
    this._syncCurrentEditingState();
    const s = src.selectionStart, e = src.selectionEnd, val = src.value;
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    const sel = val.slice(s, e) || placeholder || '';
    src.value = val.slice(0, s) + before + sel + after + val.slice(e);
    this._restoreSourceView(
      src,
      s + before.length,
      s + before.length + sel.length,
      scrollTop,
      scrollLeft
    );
    this._recordEditingHistory('', true);
    this._renderPreview();
    this._touch();
  }


  _linePrefix(prefix) {
    const src = this.sourceRef.current;
    if (!src) return;
    this._syncCurrentEditingState();
    const val = src.value;
    let s = src.selectionStart, e = src.selectionEnd;
    let ls = val.lastIndexOf('\n', s - 1) + 1;
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    const block = val.slice(ls, e);
    const replaced = block.split('\n').map((l) => prefix + l).join('\n');
    src.value = val.slice(0, ls) + replaced + val.slice(e);
    this._restoreSourceView(src, ls, ls + replaced.length, scrollTop, scrollLeft);
    this._recordEditingHistory('', true);
    this._renderPreview();
    this._touch();
  }


  // ===== 工具栏「更多格式」浮层与插入方法 =====

  // 拿到实时存在的 .more-tools-wrap。DC 模板重渲染会生成新节点，导致
  // moreToolsRef.current 指向已脱离文档的旧节点——此时回退到 DOM 查询，
  // 并顺手刷新 ref，保证点击 ⋯ 总是作用于界面上那一个菜单。
  _moreToolsWrap() {
    const ref = this.moreToolsRef && this.moreToolsRef.current;
    if (ref && ref.isConnected) return ref;
    const live = (typeof document !== 'undefined') && document.querySelector('.more-tools-wrap');
    if (live && this.moreToolsRef) this.moreToolsRef.current = live;
    return live || null;
  }

  toggleMoreTools(force) {
    const wrap = this._moreToolsWrap();
    if (!wrap) return;
    const menu = wrap.querySelector('.more-tools');
    const button = wrap.querySelector('.more-tools-toggle');
    if (!menu) return;
    const open = typeof force === 'boolean' ? force : !menu.classList.contains('is-open');
    menu.classList.toggle('is-open', open);
    if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && !this._moreToolsDocH) {
      this._moreToolsDocH = (e) => {
        const w = this._moreToolsWrap();
        if (w && w.contains(e.target)) return;
        this._closeMoreTools();
      };
      document.addEventListener('click', this._moreToolsDocH);
    } else if (!open && this._moreToolsDocH) {
      document.removeEventListener('click', this._moreToolsDocH);
      this._moreToolsDocH = null;
    }
  }


  _closeMoreTools() {
    const wrap = this._moreToolsWrap();
    if (wrap) {
      const menu = wrap.querySelector('.more-tools');
      const button = wrap.querySelector('.more-tools-toggle');
      if (menu) menu.classList.remove('is-open');
      if (button) button.setAttribute('aria-expanded', 'false');
    }
    if (this._moreToolsDocH) {
      document.removeEventListener('click', this._moreToolsDocH);
      this._moreToolsDocH = null;
    }
  }


  _insertTable() {
    const src = this.sourceRef.current;
    if (!src) return;
    this._syncCurrentEditingState();
    const s = src.selectionStart, e = src.selectionEnd;
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    const table = '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |';
    src.value = src.value.slice(0, s) + table + src.value.slice(e);
    this._restoreSourceView(src, s, s + table.length, scrollTop, scrollLeft);
    this._recordEditingHistory('', true);
    this._renderPreview();
    this._touch();
  }


  _insertHr() {
    const src = this.sourceRef.current;
    if (!src) return;
    this._syncCurrentEditingState();
    const s = src.selectionStart, e = src.selectionEnd;
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    const hr = '\n\n---\n\n';
    src.value = src.value.slice(0, s) + hr + src.value.slice(e);
    this._restoreSourceView(src, s + hr.length, s + hr.length, scrollTop, scrollLeft);
    this._recordEditingHistory('', true);
    this._renderPreview();
    this._touch();
  }


  _sourceKeydown(e) {
    const modifier = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (modifier && !e.altKey && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redoEdit();
      else this.undoEdit();
      return;
    }
    if (modifier && !e.altKey && key === 'y') {
      e.preventDefault();
      this.redoEdit();
      return;
    }
    if (e.key === 'Tab' && !modifier) {
      e.preventDefault();
      const src = this.sourceRef.current;
      this._syncCurrentEditingState();
      const s = src.selectionStart, en = src.selectionEnd;
      src.value = src.value.slice(0, s) + '  ' + src.value.slice(en);
      src.selectionStart = src.selectionEnd = s + 2;
      this._recordEditingHistory('', true);
      this._renderPreview();
      this._touch();
    }
  }

  // ===== file ops =====

  _cleanOpenedMarkdown(text) {
    let value = String(text || '');
    // 钉钉文档等导出源把空格全写成 U+00A0（不换行空格），整段无法断行；归一化为普通空格。
    value = value.replace(/\u00A0/g, ' ');
    value = value.replace(/<sup\b(?=[^>]*\bdata-comment-badge=)[^>]*>[\s\S]*?<\/sup>/gi, '');
    return stripCommentSpansLinear(value);
  }


  // ===== 桌面端（Tauri）文件能力：原生对话框 + 真实路径，句柄接入既有同步逻辑 =====

  _initDesktop() {
    if (!tauriBridge) return;
    // 宽屏下的 ⋯ 菜单由 CSS 按此标记隐藏。
    document.body.classList.add('is-desktop-app');
    tauriBridge.onMenu((action) => {
      if (action === 'new') this.onNew();
      else if (action === 'open') this.onOpen();
      else if (action === 'save') this.onSave();
      else if (action === 'save-as') this.onSaveAs();
    });
    // 双击关联的 .md 文件 / 菜单打开：后端读好内容推送过来。
    tauriBridge.onOpenPath((file) => { this._openDesktopFile(file); });
    tauriBridge.consumePendingOpen()
      .then((file) => { if (file) this._openDesktopFile(file); })
      .catch(() => {});
  }


  async _openDesktopFile(picked) {
    const src = this.sourceRef.current;
    if (!picked || !picked.path || !src) return;
    const text = this._cleanOpenedMarkdown(picked.content);
    this._setFileName(picked.name);
    src.value = text;
    this._resetEditingHistory();
    this.comments = [];
    await this._attachLocalFile(createTauriFileHandle(picked.path, picked.name));
    this._renderComments();
    if (typeof this._markReadPosRestore === 'function') this._markReadPosRestore(); // 打开新文件：标记恢复上次阅读位置
    this._renderPreview();
    this._setDirty(false);
    this._autosave();
    this._setStatus('已打开 · ' + picked.name);
    // M4（B17）：记录最近文档
    if (typeof this._trackRecent === 'function') this._trackRecent(picked);
    // M5：同步活动标签（标题/路径/内容/dirty）
    if (typeof this._syncActiveTabFromEditor === 'function') this._syncActiveTabFromEditor();
    // 侧边栏「文件」页签：刷新当前文件所在目录列表
    if (typeof this._renderCurrentDirFiles === 'function') this._renderCurrentDirFiles();
  }


  async onOpen() {
    if (tauriBridge) {
      const picked = await tauriBridge.openMarkdownFile();
      if (picked) await this._openDesktopFile(picked);
      return;
    }
    this._setStatus('打开本地文件需要桌面端环境');
  }


  async onSave() {
    const src = this.sourceRef.current;
    if (!src) return;
    if (this.fileHandle && this.fileHandle.createWritable) {
      try {
        const w = await this.fileHandle.createWritable();
        await w.write(src.value); await w.close();
        // 手动保存即用户显式决定以编辑器内容为准：更新基线并解除冲突状态。
        await this._updateLocalFileBaseline();
        this._localFileConflict = false;
        this._setDirty(false); this._autosave();
        this._setStatus('✓ 已保存到 ' + this.fileName);
      } catch (e) { this._setStatus('保存失败：' + (e.message || e)); }
      return;
    }
    // 还没有落盘目标：保存即另存为。
    await this.onSaveAs();
  }


  // 另存为：无视已关联的句柄，总是让用户挑一个新目标，保存后切换到新文件继续编辑。
  async onSaveAs() {
    const src = this.sourceRef.current;
    if (!src) return;
    const content = src.value;
    const suggested = this.fileName && this.fileName !== '未命名.md' ? this.fileName : 'document.md';
    if (tauriBridge) {
      const saved = await tauriBridge.saveMarkdownFileAs(suggested, content);
      if (!saved) return;
      this._setFileName(saved.name);
      await this._attachLocalFile(createTauriFileHandle(saved.path, saved.name));
      this._setDirty(false);
      this._autosave();
      this._setStatus('✓ 已保存到 ' + saved.name);
      return;
    }
    this._setStatus('另存为需要桌面端环境');
  }


  onNew() {
    if (this.dirty && !window.confirm('当前内容尚未保存，确定新建空白文档？')) return;
    if (this.viewMode === 'preview') this.setViewMode('editor');
    this.sourceRef.current.value = '';
    this._resetEditingHistory();
    this._detachLocalFile();
    this._setFileName('未命名.md');
    this.comments = [];
    this._renderComments();
    this._renderPreview();
    this._setDirty(false);
    this._autosave();
    this._setStatus('新建空白文档');
    this.sourceRef.current.focus();
  }

  // ===== divider drag =====

  _applyDocumentSidebarWidth(width) {
    const sidebar = this.documentSidebarRef.current;
    if (!sidebar) return;
    const max = Math.max(220, Math.min(460, window.innerWidth * 0.42));
    this.documentSidebarWidth = Math.round(Math.max(180, Math.min(max, width || 236)));
    if (!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches)) {
      sidebar.style.width = this.documentSidebarWidth + 'px';
      sidebar.style.flexBasis = this.documentSidebarWidth + 'px';
    }
  }


  _initDocumentSidebarResize() {
    const handle = this.documentSidebarResizeRef.current;
    if (!handle) return;
    try {
      const savedWidth = Number(localStorage.getItem('md-editor-document-sidebar-width'));
      if (savedWidth) this.documentSidebarWidth = savedWidth;
    } catch (e) {}
    this._applyDocumentSidebarWidth(this.documentSidebarWidth);
    let dragging = false;
    const move = (e) => {
      if (dragging) this._applyDocumentSidebarWidth(e.clientX);
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        localStorage.setItem('md-editor-document-sidebar-width', String(this.documentSidebarWidth));
      } catch (e) {}
    };
    handle.addEventListener('mousedown', (e) => {
      if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) return;
      dragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }


  _initDivider() {
    const div = this.dividerRef.current, split = this.splitRef.current;
    if (!div || !split) return;
    let dragging = false;
    const left = split.querySelector('.source-pane'), right = split.querySelector('.preview-pane');
    if (!left || !right) return;
    div.addEventListener('mousedown', (e) => { dragging = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = split.getBoundingClientRect();
      let ratio = (e.clientX - rect.left) / rect.width;
      ratio = Math.max(0.2, Math.min(0.8, ratio));
      left.style.flex = '1 1 ' + (ratio * 100) + '%';
      right.style.flex = '1 1 ' + ((1 - ratio) * 100) + '%';
    });
    window.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; });
  }

  // ===== M2 导出（HTML / PDF 打印 / Word）=====

  // 导出基准名：文件名去扩展名；未命名文档回退「未命名-日期」。
  _exportBaseName() {
    const raw = String(this.fileName || '未命名.md');
    const base = raw.replace(/\.(md|markdown|txt)$/i, '') || '未命名';
    if (base !== '未命名') return base;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return '未命名-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  _downloadBlob(blob, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // 桌面端本地图片水合缓存 → 相对路径 → data URL 映射（导出时复用，避免二次读盘）。
  _localImageMap() {
    const map = {};
    if (this._localImageCache && this.localFilePath) {
      for (const [key, dataUrl] of this._localImageCache) {
        const sep = key.indexOf('::');
        if (sep > 0) map[key.slice(sep + 2)] = dataUrl;
      }
    }
    return map;
  }

  async onExportHtml() {
    const prev = this.previewRef.current;
    if (!prev) return;
    this._setStatus('正在导出 HTML…');
    try {
      if (typeof this._awaitPreviewReady === 'function') await this._awaitPreviewReady();
      const { html, warnings } = await exportHtmlFromPreview(prev, {
        title: this._exportBaseName(),
        localImages: this._localImageMap()
      });
      const name = this._exportBaseName() + '.html';
      if (tauriBridge && tauriBridge.saveExportFile) {
        await tauriBridge.saveExportFile(name, html);
      } else {
        this._downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), name);
      }
      const warn = warnings.length ? ' · ' + warnings.join('；') : '';
      this._setStatus('✓ 已导出 HTML ' + name + warn);
    } catch (error) {
      this._setStatus('HTML 导出失败 · ' + ((error && error.message) || error));
    }
  }

  async onExportPdf() {
    const prev = this.previewRef.current;
    if (!prev) return;
    this._setStatus('正在准备打印…');
    try {
      if (typeof this._awaitPreviewReady === 'function') await this._awaitPreviewReady();
      // 系统打印对话框路径（用户已确认）：打印样式层由 styles.css 的 @media print 提供。
      window.print();
      this._setStatus('已打开打印对话框 · 选择「Microsoft Print to PDF」可保存为 PDF');
    } catch (error) {
      this._setStatus('打印失败 · ' + ((error && error.message) || error));
    }
  }

  async onExportWord() {
    const prev = this.previewRef.current;
    if (!prev) return;
    this._setStatus('正在导出 Word…');
    try {
      if (typeof this._awaitPreviewReady === 'function') await this._awaitPreviewReady();
      const clone = prev.cloneNode(true);
      const { root, images } = flattenForWord(clone);
      // KaTeX/Mermaid 光栅化需要布局样式与公式字体（与导出 CSS 同源，var() 落成字面值）。
      const sheets = document.styleSheets;
      const computed = getComputedStyle(document.body);
      const readVar = (name) => computed.getPropertyValue(name).trim();
      const css = resolveCssVariables(extractExportCss(sheets), readVar);
      const fontsCss = await inlineFontFaces(sheets, {
        filter: (face) => /font-family:\s*['"]?KaTeX_/i.test(face)
      });
      await renderWordImages(images, { css, fontsCss, fontSizePx: this.fontSize });
      const buffer = await buildDocx({ title: this._exportBaseName(), flattenedRoot: root, images });
      const name = this._exportBaseName() + '.docx';
      if (tauriBridge && tauriBridge.saveExportFile) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        await tauriBridge.saveExportFile(name, '', btoa(binary));
      } else {
        this._downloadBlob(new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }), name);
      }
      this._setStatus('✓ 已导出 Word ' + name);
    } catch (error) {
      this._setStatus('Word 导出失败 · ' + ((error && error.message) || error));
    }
  }
}