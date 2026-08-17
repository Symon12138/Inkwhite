// @ts-nocheck

// 字体选择与导入（ui-ux-pro-max 设计系统：类型尺度与字体选择）。
// - 选择器控制正文阅读字体（--read 变量）：预览正文 + 标题跟随；
//   源码编辑区保持等宽（--mono，Markdown 对齐依赖）。
// - 导入：ttf/otf/woff/woff2 → FontFace API 注册 → IndexedDB 持久化，
//   重启自动恢复；导出（HTML/Word/长图）仍走系统字体栈（既有决策）。

const FONT_DB = 'inkwhite-fonts';
const FONT_STORE = 'fonts';

const SYSTEM_FONTS = [
  { id: 'default', label: '默认 · 楷体', family: '' },
  { id: 'kaiti', label: '楷体', family: "'Kaiti SC', 'STKaiti', 'KaiTi', '楷体', serif" },
  { id: 'songti', label: '宋体', family: "'Songti SC', 'SimSun', 'NSimSun', '宋体', serif" },
  { id: 'heiti', label: '黑体', family: "'Heiti SC', 'Microsoft YaHei', 'PingFang SC', '黑体', sans-serif" },
  { id: 'yahei', label: '微软雅黑', family: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { id: 'serif', label: '衬线', family: "'Times New Roman', 'Songti SC', serif" },
  { id: 'sans', label: '无衬线', family: "Inter, 'Noto Sans SC', sans-serif" },
  { id: 'mono', label: '等宽', family: "'Cascadia Code', Consolas, 'Courier New', monospace" }
];

export class FontMethods {
  // ===== 选择器构建 =====

  // 获取或创建字体选择器（DC 模板不含 select，由 JS 注入到 fontSelectSlotRef 槽位，
  // 规避 DC 对 menu 内 label/select 的事件绑定缺陷）
  _ensureFontSelect() {
    const slot = this.fontSelectSlotRef && this.fontSelectSlotRef.current;
    if (!slot) return null;
    let sel = slot.querySelector('select.font-select');
    if (!sel) {
      sel = document.createElement('select');
      sel.className = 'font-select menubar-font';
      sel.setAttribute('aria-label', '选择字体');
      sel.title = '选择编辑与预览字体';
      sel.__fontChangeBound = true;
      sel.addEventListener('change', () => this._onFontSelectChanged());
      slot.appendChild(sel);
    }
    if (this.fontSelectRef) this.fontSelectRef.current = sel;
    return sel;
  }

  _buildFontSelect() {
    const sel = this._ensureFontSelect();
    if (!sel) return;
    sel.innerHTML = '';
    for (const f of SYSTEM_FONTS) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      if (f.family) opt.style.fontFamily = f.family;
      sel.appendChild(opt);
    }
    const imported = this._importedFonts || [];
    if (imported.length) {
      const group = document.createElement('optgroup');
      group.label = '已导入';
      imported.forEach((f) => {
        const opt = document.createElement('option');
        opt.value = 'imported:' + f.family;
        opt.textContent = f.family;
        opt.style.fontFamily = `'${f.family}', serif`;
        group.appendChild(opt);
      });
      sel.appendChild(group);
    }
    const current = this.fontFamily || 'default';
    const known = SYSTEM_FONTS.some((f) => f.id === current)
      || (imported.some((f) => 'imported:' + f.family === current));
    sel.value = known ? current : 'default';
    // 原生 change 监听（兼容 DC 模板对嵌套 select 的 onChange 绑定失效场景）
    if (!sel.__fontChangeBound) {
      sel.__fontChangeBound = true;
      sel.addEventListener('change', () => this._onFontSelectChanged());
    }
  }


  _onFontSelectChanged() {
    const sel = this.fontSelectRef && this.fontSelectRef.current;
    if (!sel) return;
    const value = sel.value;
    this.fontFamily = value;
    this._applyFontFamily();
    this._persist();
    const label = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : value;
    this._setStatus('字体已切换为「' + label + '」');
  }


  _applyFontFamily() {
    const root = document.body.style;
    const value = this.fontFamily;
    if (!value || value === 'default') {
      root.removeProperty('--read');
      root.removeProperty('--paper-font-body');
      root.removeProperty('--paper-font-heading');
      return;
    }
    const sys = SYSTEM_FONTS.find((f) => f.id === value);
    const family = sys ? sys.family : this._importedFamily(value);
    if (family) {
      // --paper-font-body/heading 在 :root 声明处即解析为 var(--read) 的字面量，
      // 仅改 --read 不生效；三个变量一起覆盖（标题跟随正文）。
      root.setProperty('--read', family);
      root.setProperty('--paper-font-body', family);
      root.setProperty('--paper-font-heading', family);
    }
  }


  _importedFamily(value) {
    if (!value.startsWith('imported:')) return '';
    const name = value.slice('imported:'.length);
    return `'${name}', serif`;
  }


  // ===== 导入（FontFace + IndexedDB 持久化） =====

  _importFont() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.woff,.woff2,application/font-ttf,application/font-woff,application/font-woff2,font/ttf,font/otf,font/woff,font/woff2';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      this._loadFontFile(file);
    });
    document.body.appendChild(input);
    input.click();
  }


  async _loadFontFile(file) {
    try {
      const buffer = await file.arrayBuffer();
      const family = file.name.replace(/\.[^.]+$/, '');
      const face = new FontFace(family, buffer);
      await face.load();
      document.fonts.add(face);
      this._importedFonts = this._importedFonts || [];
      if (!this._importedFonts.some((f) => f.family === family)) {
        this._importedFonts.push({ family, buffer });
      }
      await this._saveImportedFont(family, buffer);
      this.fontFamily = 'imported:' + family;
      this._buildFontSelect();
      this._applyFontFamily();
      this._persist();
      this._setStatus('已导入字体「' + family + '」并应用');
    } catch (e) {
      this._setStatus('字体导入失败：' + (e instanceof Error ? e.message : String(e)));
    }
  }


  // ===== IndexedDB 持久化 =====

  _openFontDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('indexedDB 不可用')); return; }
      const req = indexedDB.open(FONT_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FONT_STORE)) db.createObjectStore(FONT_STORE, { keyPath: 'family' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }


  async _saveImportedFont(family, buffer) {
    try {
      const db = await this._openFontDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(FONT_STORE, 'readwrite');
        tx.objectStore(FONT_STORE).put({ family, buffer });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (e) {
      console.error('[font] 持久化失败', e);
    }
  }


  async _restoreImportedFonts() {
    try {
      const db = await this._openFontDb();
      const rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(FONT_STORE, 'readonly');
        const req = tx.objectStore(FONT_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      this._importedFonts = [];
      for (const row of rows) {
        try {
          const face = new FontFace(row.family, row.buffer);
          await face.load();
          document.fonts.add(face);
          this._importedFonts.push({ family: row.family, buffer: row.buffer });
        } catch (e) {
          console.warn('[font] 恢复失败：' + row.family, e);
        }
      }
    } catch (e) {
      this._importedFonts = this._importedFonts || [];
    }
    this._buildFontSelect();
    this._applyFontFamily();
  }
}
