// @ts-nocheck
// M4-P7：跨文件搜索面板（挂在文件树侧栏：根目录内搜索）。
// 搜索执行走 Rust search_markdown_files（spawn_blocking + 上限 + junction 防逃逸）；
// 本文件只做 UI 与结果渲染。浏览器端（tauriBridge=null）提示需桌面端。

import { tauriBridge } from './tauriBridge.ts';
import { groupHits, formatHitLine } from './globalSearchComposer.ts';

export class GlobalSearchMethods {
  _initGlobalSearch() {
    // 文件树侧栏渲染时注入搜索框（_renderFileTree 之后调用）
  }

  _ensureSearchBox(list) {
    if (this._searchBoxEl) return this._searchBoxEl;
    const box = document.createElement('div');
    box.className = 'global-search-box';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'global-search-input';
    input.placeholder = '在文件夹中搜索…';
    const result = document.createElement('div');
    result.className = 'global-search-results';
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this._runSearch(input.value, result), 350);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        this._runSearch(input.value, result);
      }
    });
    box.append(input, result);
    list.prepend(box);
    this._searchBoxEl = box;
    this._searchInputEl = input;
    this._searchResultEl = result;
    return box;
  }

  async _runSearch(query, resultEl) {
    const needle = (query || '').trim();
    resultEl.innerHTML = '';
    if (!needle) return;
    if (!tauriBridge || !tauriBridge.searchMarkdownFiles) {
      const tip = document.createElement('div');
      tip.className = 'global-search-tip';
      tip.textContent = '跨文件搜索需要桌面端环境';
      resultEl.appendChild(tip);
      return;
    }
    if (!this.fileTreeRoot) {
      const tip = document.createElement('div');
      tip.className = 'global-search-tip';
      tip.textContent = '请先选择文件夹';
      resultEl.appendChild(tip);
      return;
    }
    resultEl.appendChild(this._tip('正在搜索…'));
    try {
      const result = await tauriBridge.searchMarkdownFiles(this.fileTreeRoot, needle, false);
      resultEl.innerHTML = '';
      if (!result.hits.length) {
        resultEl.appendChild(this._tip('没有匹配的内容'));
        return;
      }
      const meta = document.createElement('div');
      meta.className = 'global-search-meta';
      meta.textContent = result.hits.length + ' 处命中' + (result.truncated ? '（已达上限）' : '') + ' · ' + result.scannedFiles + ' 个文件';
      resultEl.appendChild(meta);
      for (const group of groupHits(result.hits)) {
        const fileRow = document.createElement('div');
        fileRow.className = 'global-search-file';
        fileRow.textContent = group.name;
        fileRow.title = group.path;
        resultEl.appendChild(fileRow);
        for (const hit of group.hits) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'global-search-hit';
          row.innerHTML = '<span class="gs-line">' + hit.lineNumber + '</span>'
            + '<span class="gs-text">' + this._escapeHtml(formatHitLine(hit.line)) + '</span>';
          row.addEventListener('click', async () => {
            const data = await tauriBridge.readFile(hit.path);
            if (data) {
              await this._openDesktopFile({ path: hit.path, name: hit.name, content: data.content, lastModified: data.lastModified });
              this.closeDocumentSidebar();
            }
          });
          resultEl.appendChild(row);
        }
      }
    } catch (error) {
      resultEl.innerHTML = '';
      resultEl.appendChild(this._tip('搜索失败 · ' + ((error && error.message) || error)));
    }
  }

  _tip(text) {
    const div = document.createElement('div');
    div.className = 'global-search-tip';
    div.textContent = text;
    return div;
  }

  _escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
