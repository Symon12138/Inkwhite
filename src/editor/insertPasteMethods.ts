// @ts-nocheck
// M3 接线：粘贴分流、图片插入、表格工具栏、复制为 HTML。
// 纯逻辑在 pasteMethods / clipboardMethods / assetPathComposer / tableEditComposer，
// 本文件只做事件接线与编辑器状态操作。

import { tauriBridge } from './tauriBridge.ts';
import { buildPasteResult } from './pasteMethods.ts';
import { buildClipboardItem, sanitizeClipboardHtml, copyMarkdownSelection } from './clipboardMethods.ts';
import {
  validateAssetName,
  dedupeAssetName,
  checkImagePayload,
  resolveInsertStrategy,
  buildImageMarkdown
} from './assetPathComposer.ts';
import { editTable, collectTableRanges, type TableEditOp } from './tableEditComposer.ts';

export class InsertPasteMethods {
  // ===== 粘贴 =====

  _onSourcePaste(event) {
    const src = this.sourceRef.current;
    if (!src) return;
    const dt = event.clipboardData;
    if (!dt) return;
    const imageFiles = Array.from(dt.files || []).filter((f) => f.type.startsWith('image/'));
    const result = buildPasteResult({
      types: Array.from(dt.types || []),
      hasImageFiles: imageFiles.length > 0,
      html: dt.getData('text/html') || null,
      text: dt.getData('text/plain') || null
    }, imageFiles);
    if (result.kind === 'image') {
      event.preventDefault();
      this._insertImageFiles(result.imageFiles || []);
      return;
    }
    if (result.kind === 'html' && result.markdown) {
      event.preventDefault();
      this._insertMarkdownAtCursor(result.markdown);
      return;
    }
    // plain：走浏览器默认插入
  }

  _insertMarkdownAtCursor(markdown) {
    const src = this.sourceRef.current;
    if (!src || !markdown) return;
    this._syncCurrentEditingState();
    const s = src.selectionStart, e = src.selectionEnd;
    const val = src.value;
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    src.value = val.slice(0, s) + markdown + val.slice(e);
    const cursor = s + markdown.length;
    this._restoreSourceView(src, cursor, cursor, scrollTop, scrollLeft);
    this._recordEditingHistory('insertText');
    this._renderPreview();
    this._touch();
  }

  // ===== 图片插入（粘贴 / 拖入 / 文件选择共用） =====

  _insertImageFiles(files) {
    if (!files || !files.length) return;
    // 逐个读取并插入（策略一致：桌面端落盘，浏览器端内联）
    files.forEach((file) => this._insertImageFile(file));
  }

  async _insertImageFile(file) {
    let dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
    if (!dataUrl) {
      this._setStatus('图片读取失败 · ' + file.name);
      return;
    }
    // P1-4：大图自动压缩（>1.5MB 或边长>1920 时转 webp/限宽，失败回落原图）
    dataUrl = await this._compressDataUrlIfNeeded(dataUrl, file.name);
    const payload = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
    const payloadError = checkImagePayload(payload);
    if (payloadError) {
      this._setStatus('图片插入失败 · ' + payloadError);
      return;
    }
    await this._insertImagePayload(dataUrl, file.name);
  }

  async _compressDataUrlIfNeeded(dataUrl, fileName) {
    try {
      const payload = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      const bytes = Math.floor(payload.replace(/=+$/, '').length * 3 / 4);
      // 阈值：1.5MB 或超长边 1920px 时触发压缩（截图常见 3-5MB）
      if (bytes < 1.5 * 1024 * 1024) return dataUrl;
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('load failed'));
        image.src = dataUrl;
      });
      const maxEdge = 1920;
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      if (scale >= 1 && bytes < 4 * 1024 * 1024) return dataUrl;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // 优先 webp（更小），不支持回落 jpeg
      let out = '';
      try { out = canvas.toDataURL('image/webp', 0.85); } catch {}
      if (!out || out === 'data:,') out = canvas.toDataURL('image/jpeg', 0.85);
      if (!out || out.length >= dataUrl.length) return dataUrl;
      this._setStatus(`图片已压缩 · ${fileName} ${(bytes/1024/1024).toFixed(1)}MB → ${(out.length*3/4/1024/1024).toFixed(1)}MB`);
      return out;
    } catch {
      return dataUrl;
    }
  }

  // 统一入口：dataUrl + 建议名 → 策略（save/inline/prompt-save）→ 插入引用
  async _insertImagePayload(dataUrl, suggestedName) {
    const baseName = validateAssetName(suggestedName || 'image.png');
    const name = typeof baseName === 'string' ? baseName : 'image.png';
    const strategy = resolveInsertStrategy({
      hasDocPath: !!this.localFilePath,
      tauriAvailable: !!tauriBridge
    });

    let src = dataUrl;
    if (strategy === 'prompt-save') {
      this._setStatus('请先保存文档，再插入图片');
      const saved = await this.onSaveAs();
      if (!saved) return;
    }
    if (strategy === 'save' && tauriBridge) {
      const payload = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      const saved = await tauriBridge.saveAssetFile(this.localFilePath, name, payload);
      if (!saved) {
        this._setStatus('图片保存失败');
        return;
      }
      src = saved.name; // 相对文档目录的引用
    }
    this._insertMarkdownAtCursor(buildImageMarkdown({ src, alt: name.replace(/\.[a-z0-9]+$/i, '') }));
  }

  async onInsertImage() {
    if (tauriBridge && tauriBridge.pickImage) {
      const picked = await tauriBridge.pickImage();
      if (!picked) return;
      await this._insertImagePayload(picked.dataUrl, picked.name);
      return;
    }
    // 浏览器端：隐藏文件选择
    if (!this._imageInputEl) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,image/x-icon';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.value = '';
        this._insertImageFiles(files);
      });
      document.body.appendChild(input);
      this._imageInputEl = input;
    }
    this._imageInputEl.click();
  }

  // ===== 任务勾选交互（P8 完整交付） =====

  _initTaskToggle() {
    const prev = this.previewRef.current;
    if (!prev || this._taskToggleBound) return;
    this._taskToggleBound = true;
    prev.addEventListener('click', (e) => {
      const input = e.target && e.target.closest ? e.target.closest('input[data-task-idx]') : null;
      if (!input || !prev.contains(input)) return;
      e.preventDefault();
      this._toggleTask(parseInt(input.getAttribute('data-task-idx') || '0', 10));
    });
  }

  // 按 data-task-idx（= token 遍历序）定位任务项，只改目标 [ ]/[x]。
  _toggleTask(taskIndex) {
    const src = this.sourceRef.current;
    if (!src) return;
    const tokens = this._lastTokens || [];
    const target = this._findTaskTarget(tokens, taskIndex);
    if (!target) {
      this._setStatus('任务状态更新失败 · 源码已变化，请重试');
      return;
    }
    const { start, end, raw } = target;
    // 防御复核：偏移处必须是任务标记
    if (src.value.slice(start, end) !== raw) {
      this._setStatus('任务状态更新失败 · 源码已变化，请重试');
      return;
    }
    const replacement = raw.startsWith('[x]') || raw.startsWith('[X]') ? '[ ]' : '[x]';
    this._syncCurrentEditingState();
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    src.value = src.value.slice(0, start) + replacement + src.value.slice(end);
    this._restoreSourceView(src, src.selectionStart, src.selectionEnd, scrollTop, scrollLeft);
    // 与格式化命令一致：每次点击独立撤销条目（forceNewEntry，防 800ms 内合并）
    this._recordEditingHistory('', true);
    this._renderPreview();
    this._touch();
  }

  // 深度优先遍历 token 树（与 taskExtension.countTasks 同序），找第 taskIndex 个
  // 任务 checkbox 的源码区间。嵌套列表的 item.raw 是源码绝对切片：外层 item.raw
  // 已含内层文本，若用「游标顺移」会被外层推进过头——子级改为从父级起点搜索。
  _findTaskTarget(tokens, taskIndex) {
    const source = this.sourceRef.current?.value || '';
    let seen = -1;

    const indexOfRaw = (raw, from) => {
      if (!raw) return -1;
      const pos = source.indexOf(raw, from);
      return pos >= 0 ? pos : source.indexOf(raw);
    };

    const visit = (list, from) => {
      for (const token of list) {
        if (token.type === 'list') {
          for (const item of token.items) {
            const pos = indexOfRaw(item.raw, from);
            if (item.task) {
              seen += 1;
              if (seen === taskIndex) {
                const marker = /\[[ xX]\]/;
                const match = item.raw ? marker.exec(item.raw) : null;
                if (match && pos >= 0) {
                  return { start: pos + match.index, end: pos + match.index + match[0].length, raw: match[0] };
                }
              }
            }
            const nested = visit(item.tokens, pos >= 0 ? pos : from);
            if (nested) return nested;
            if (pos >= 0) from = pos + item.raw.length;
          }
        } else if (token.tokens && token.tokens.length) {
          const nested = visit(token.tokens, from);
          if (nested) return nested;
        }
      }
      return null;
    };
    return visit(tokens, 0);
  }

  // ===== 表格工具栏 =====

  _initTableToolbar() {
    const prev = this.previewRef.current;
    if (!prev || this._tableToolbarBound) return;
    this._tableToolbarBound = true;
    prev.addEventListener('click', (e) => {
      const table = e.target && e.target.closest ? e.target.closest('table') : null;
      if (!table || !prev.contains(table)) return;
      const tables = Array.from(prev.querySelectorAll('table'));
      const index = tables.indexOf(table);
      if (index < 0) return;
      this._showTableToolbar(table, index, e);
    });
    document.addEventListener('mousedown', (e) => {
      const bar = this._tableToolbarEl;
      if (bar && !bar.contains(e.target)) this._hideTableToolbar();
    });
  }

  _buildTableToolbar() {
    if (this._tableToolbarEl) return this._tableToolbarEl;
    const bar = document.createElement('div');
    bar.className = 'table-toolbar';
    bar.setAttribute('role', 'toolbar');
    const buttons = [
      ['row-above', '↑行', '上方插入行'],
      ['row-below', '↓行', '下方插入行'],
      ['col-left', '←列', '左侧插入列'],
      ['col-right', '→列', '右侧插入列'],
      ['del-row', '删行', '删除当前行'],
      ['del-col', '删列', '删除当前列'],
      ['align-left', '左对齐', '列左对齐'],
      ['align-center', '居中', '列居中'],
      ['align-right', '右对齐', '列右对齐']
    ];
    buttons.forEach(([action, label, title]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'table-toolbar-btn';
      btn.textContent = label;
      btn.title = title;
      btn.dataset.action = action;
      btn.addEventListener('click', () => this._applyTableAction(action));
      bar.appendChild(btn);
    });
    document.body.appendChild(bar);
    this._tableToolbarEl = bar;
    return bar;
  }

  _showTableToolbar(table, tableIndex, event) {
    const bar = this._buildTableToolbar();
    this._tableTarget = { table, tableIndex, rowIndex: 0, colIndex: 0 };
    // 记录点击的单元格行列（用于行/列/对齐定位）
    const cell = event.target && event.target.closest ? event.target.closest('td,th') : null;
    if (cell) {
      const row = cell.closest('tr');
      this._tableTarget.rowIndex = row ? Array.from(row.parentNode.children).indexOf(row) : 0;
      this._tableTarget.colIndex = Array.from(cell.parentNode.children).indexOf(cell);
    }
    bar.style.display = 'flex';
    const rect = table.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    bar.style.left = Math.max(8, rect.left + rect.width / 2 - barRect.width / 2) + 'px';
    bar.style.top = Math.max(8, rect.top - barRect.height - 6) + 'px';
  }

  _hideTableToolbar() {
    if (this._tableToolbarEl) this._tableToolbarEl.style.display = 'none';
    this._tableTarget = null;
  }

  async _applyTableAction(action) {
    const target = this._tableTarget;
    if (!target) return;
    const src = this.sourceRef.current;
    if (!src) return;
    // 用与预览同源的 tokens（_lastTokens）定位表格源码区间
    const ranges = collectTableRanges(this._lastTokens || []);
    const range = ranges[target.tableIndex];
    if (!range) {
      this._hideTableToolbar();
      return;
    }
    const dataRowIndex = Math.max(0, target.rowIndex - (this._tableHasDelimiter(target.table) ? 2 : 1));
    const op = this._tableOpFor(action, target.colIndex, dataRowIndex);
    if (!op) {
      this._hideTableToolbar();
      return;
    }
    const next = editTable(src.value, range, op);
    if (next === src.value) {
      this._hideTableToolbar();
      return;
    }
    this._syncCurrentEditingState();
    const scrollTop = src.scrollTop, scrollLeft = src.scrollLeft;
    src.value = next;
    this._restoreSourceView(src, src.selectionStart, src.selectionEnd, scrollTop, scrollLeft);
    this._recordEditingHistory('tableEdit');
    this._renderPreview();
    this._touch();
    // 表格被编辑，工具栏目标失效（_renderPreview 已刷新 _lastTokens）
    this._hideTableToolbar();
  }

  _tableHasDelimiter(table) {
    const firstRow = table.querySelector('tr');
    if (!firstRow) return false;
    const second = firstRow.nextElementSibling;
    if (!second) return false;
    return Array.from(second.children).every((c) => /^:?-{1,}:?$/.test(c.textContent.trim()));
  }

  _tableOpFor(action, colIndex, rowIndex) {
    switch (action) {
      case 'row-above': return { type: 'insertRow', at: 'above', rowIndex };
      case 'row-below': return { type: 'insertRow', at: 'below', rowIndex };
      case 'del-row': return { type: 'deleteRow', rowIndex };
      case 'col-left': return { type: 'insertColumn', at: 'left', colIndex };
      case 'col-right': return { type: 'insertColumn', at: 'right', colIndex };
      case 'del-col': return { type: 'deleteColumn', colIndex };
      case 'align-left': return { type: 'setAlign', colIndex, align: 'left' };
      case 'align-center': return { type: 'setAlign', colIndex, align: 'center' };
      case 'align-right': return { type: 'setAlign', colIndex, align: 'right' };
      default: return null;
    }
  }

  // ===== 复制为 HTML（B11） =====

  async copyHtmlSelection() {
    const prev = this.previewRef.current;
    const selection = window.getSelection && window.getSelection();
    if (!prev || !selection || selection.isCollapsed) {
      this._setStatus('请先在预览中选中文字');
      return;
    }
    try {
      const clone = selection.getRangeAt(0).cloneContents();
      if (!clone || !clone.textContent) {
        this._setStatus('请先在预览中选中文字');
        return;
      }
      const container = document.createElement('div');
      container.appendChild(clone);
      const html = sanitizeClipboardHtml(container.innerHTML);
      const text = copyMarkdownSelection(selection.toString());
      await navigator.clipboard.write([buildClipboardItem({ html, text })]);
      this._setStatus('已复制为 HTML');
    } catch (error) {
      this._setStatus('复制失败 · ' + ((error && error.message) || error));
    }
  }
}
