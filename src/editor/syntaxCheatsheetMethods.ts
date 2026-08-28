// @ts-nocheck
// 语法大全浮层（帮助 → 语法大全）
// 展示分组的 Markdown 语法卡片，支持搜索与一键插入。
// 构建模式仿 settingsMethods/longImageMethods：JS 构建模态，CSS 在独立文件中。

import { SYNTAX_CATEGORIES, SYNTAX_ENTRIES, filterEntries } from './syntaxCheatsheetData.ts';
import { renderMarkdown } from './markdownExtensions/markdownExtensionRegistry.ts';
import DOMPurify from 'dompurify';
import { RENDER_GUARD } from './renderGuard.ts';

const ALL_CATEGORY = 'all';

export class SyntaxCheatsheetMethods {
  openSyntaxCheatsheet() {
    const overlay = this._buildSyntaxModal();
    overlay.style.display = 'flex';
    const input = overlay.querySelector('[data-syntax-search]');
    if (input) input.focus();
  }

  closeSyntaxCheatsheet() {
    if (this._syntaxEl) this._syntaxEl.style.display = 'none';
  }

  _escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _highlightText(text, query) {
    const q = (query || '').trim();
    if (!q) return this._escapeHtml(text);
    const esc = q.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(' + esc + ')', 'gi');
    return this._escapeHtml(text).replace(re, '<mark>$1</mark>');
  }

  _buildSyntaxModal() {
    if (this._syntaxEl) return this._syntaxEl;
    const overlay = document.createElement('div');
    overlay.className = 'syntax-cheatsheet-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '语法大全');
    const modal = document.createElement('div');
    modal.className = 'syntax-cheatsheet-modal';
    modal.append(this._buildSyntaxHead(), this._buildSyntaxBody());
    overlay.appendChild(modal);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.closeSyntaxCheatsheet(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this._syntaxEl) return;
      if (this._syntaxEl.style.display !== 'flex') return;
      e.preventDefault();
      this.closeSyntaxCheatsheet();
    });
    document.body.appendChild(overlay);
    this._syntaxEl = overlay;
    this._syntaxCategory = ALL_CATEGORY;
    this._syntaxQuery = '';
    this._renderSyntaxGrid();
    return overlay;
  }

  _buildSyntaxHead() {
    const head = document.createElement('div');
    head.className = 'syntax-cheatsheet-head';
    const title = document.createElement('div');
    title.className = 'syntax-cheatsheet-title';
    const h = document.createElement('strong');
    h.textContent = '语法大全';
    const sub = document.createElement('p');
    sub.textContent = '点击卡片一键插入到光标处 · 支持搜索与分类筛选';
    title.append(h, sub);
    const searchWrap = document.createElement('label');
    searchWrap.className = 'syntax-cheatsheet-search';
    searchWrap.setAttribute('aria-label', '搜索语法');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = '搜索 标题/分类/语法…';
    input.setAttribute('data-syntax-search', 'true');
    input.addEventListener('input', () => {
      this._syntaxQuery = input.value;
      this._renderSyntaxGrid();
    });
    searchWrap.appendChild(input);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'syntax-cheatsheet-close';
    close.textContent = '×';
    close.title = '关闭（Esc）';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => this.closeSyntaxCheatsheet());
    head.append(title, searchWrap, close);
    return head;
  }

  _buildSyntaxBody() {
    const body = document.createElement('div');
    body.className = 'syntax-cheatsheet-body';
    const nav = document.createElement('nav');
    nav.className = 'syntax-cheatsheet-nav';
    nav.setAttribute('aria-label', '语法分类');
    const allBtn = this._buildCategoryButton('all', '全部', SYNTAX_ENTRIES.length);
    allBtn.classList.add('is-active');
    allBtn.setAttribute('aria-pressed', 'true');
    nav.appendChild(allBtn);
    SYNTAX_CATEGORIES.forEach((cat) => {
      const count = SYNTAX_ENTRIES.filter((e) => e.category === cat.id).length;
      if (count === 0) return;
      nav.appendChild(this._buildCategoryButton(cat.id, cat.label, count));
    });
    const grid = document.createElement('div');
    grid.className = 'syntax-cheatsheet-grid';
    grid.setAttribute('data-syntax-grid', 'true');
    body.append(nav, grid);
    return body;
  }

  _buildCategoryButton(id, label, count) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'syntax-category-btn';
    btn.dataset.category = id;
    btn.textContent = label + ' ' + count;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      this._syntaxCategory = id;
      const nav = this._syntaxEl && this._syntaxEl.querySelector('.syntax-cheatsheet-nav');
      if (nav) {
        nav.querySelectorAll('.syntax-category-btn').forEach((b) => {
          const active = b.dataset.category === id;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
      this._renderSyntaxGrid();
    });
    return btn;
  }

  _getFilteredEntries() {
    let entries = SYNTAX_ENTRIES;
    if (this._syntaxCategory && this._syntaxCategory !== ALL_CATEGORY) {
      entries = entries.filter((e) => e.category === this._syntaxCategory);
    }
    if (this._syntaxQuery) {
      entries = filterEntries(this._syntaxQuery, entries);
    }
    return entries;
  }

  _renderSyntaxGrid() {
    if (!this._syntaxEl) return;
    const grid = this._syntaxEl.querySelector('[data-syntax-grid]');
    if (!grid) return;
    const entries = this._getFilteredEntries();
    grid.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'syntax-cheatsheet-empty';
      empty.textContent = '没有匹配的语法';
      grid.appendChild(empty);
      return;
    }
    entries.forEach((entry) => grid.appendChild(this._buildSyntaxCard(entry)));
  }

  _buildSyntaxCard(entry) {
    const card = document.createElement('article');
    card.className = 'syntax-card';
    card.dataset.entryId = entry.id;
    const head = document.createElement('div');
    head.className = 'syntax-card-head';
    const title = document.createElement('strong');
    title.className = 'syntax-card-title';
    title.innerHTML = this._highlightText(entry.title, this._syntaxQuery);
    const badge = document.createElement('span');
    badge.className = 'syntax-card-badge';
    const cat = SYNTAX_CATEGORIES.find((c) => c.id === entry.category);
    badge.textContent = cat ? cat.label : entry.category;
    head.append(title, badge);
    const desc = document.createElement('p');
    desc.className = 'syntax-card-desc';
    desc.innerHTML = this._highlightText(entry.description, this._syntaxQuery);
    const syntaxWrap = document.createElement('div');
    syntaxWrap.className = 'syntax-card-syntax-wrap';
    const pre = document.createElement('pre');
    pre.className = 'syntax-card-syntax';
    const code = document.createElement('code');
    code.innerHTML = this._highlightText(entry.syntax, this._syntaxQuery);
    pre.appendChild(code);
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'syntax-card-copy';
    copyBtn.textContent = '复制';
    copyBtn.title = '复制语法';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._copySyntax(entry);
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = '复制'; }, 1200);
    });
    syntaxWrap.append(pre, copyBtn);
    const preview = document.createElement('div');
    preview.className = 'syntax-card-preview';
    const previewLabel = document.createElement('span');
    previewLabel.className = 'syntax-card-preview-label';
    previewLabel.textContent = '效果预览';
    const previewBody = document.createElement('div');
    previewBody.className = 'syntax-card-preview-body md-preview';
    previewBody.innerHTML = this._renderPreviewForCard(entry);
    preview.append(previewLabel, previewBody);
    const actions = document.createElement('div');
    actions.className = 'syntax-card-actions';
    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'syntax-card-insert';
    insertBtn.textContent = '插入';
    insertBtn.title = '插入到光标处';
    insertBtn.addEventListener('click', () => this._insertSyntax(entry));
    actions.appendChild(insertBtn);
    if (entry.tip) {
      const tip = document.createElement('small');
      tip.className = 'syntax-card-tip';
      tip.textContent = entry.tip;
      actions.appendChild(tip);
    }
    card.addEventListener('click', () => this._insertSyntax(entry));
    card.append(head, desc, syntaxWrap, preview, actions);
    return card;
  }

  _renderPreviewForCard(entry) {
    const md = entry.syntax;
    try {
      if (typeof renderMarkdown === 'function') {
        const result = renderMarkdown(md);
        const html = result && result.html ? result.html : result;
        if (typeof html === 'string') return DOMPurify.sanitize(html, RENDER_GUARD);
      }
    } catch {}
    const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<pre>' + esc + '</pre>';
  }

  _copySyntax(entry) {
    const text = entry.syntax;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
        return;
      }
    } catch {}
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }

  _insertSyntax(entry) {
    const ta = this.sourceRef && this.sourceRef.current;
    if (!ta) return;
    const text = entry.insertText || entry.syntax;
    const placeholder = entry.placeholder || '';
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const selected = ta.value.slice(start, end);
    let inserted = text;
    let selStart = start;
    let selEnd = start + text.length;
    if (selected && placeholder && text.includes(placeholder)) {
      inserted = text.replace(placeholder, selected);
      selStart = start;
      selEnd = start + inserted.length;
    } else if (placeholder) {
      const idx = text.indexOf(placeholder);
      if (idx !== -1) {
        selStart = start + idx;
        selEnd = selStart + placeholder.length;
      }
    }
    ta.value = before + inserted + after;
    ta.focus();
    try { ta.setSelectionRange(selStart, selEnd); } catch {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof this._setStatus === 'function') this._setStatus('已插入：' + entry.title);
    // 预览模式下插入后自动切到分屏，方便查看效果（阅读型用户默认在预览）
    if (this.viewMode === 'preview' && typeof this.setViewMode === 'function') this.setViewMode('split');
    this.closeSyntaxCheatsheet();
  }
}