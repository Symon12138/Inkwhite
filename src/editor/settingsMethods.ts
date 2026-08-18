// @ts-nocheck
// M2-SETTINGS：设置面板——JS 构建模态（仿 longImageMethods 弹窗模式），
// 不进 index.html 模板；纯逻辑与持久化语义在 settings.ts，本模块只负责
// 面板构建、控件接线与设置应用。入口按钮由 M2-UI 统一接线，
// 对外提供 openSettings() / closeSettings()。
//
// B19 语义（不丢稿硬约束）：autosave 设置只控制「写穿本地文件」。
//   viewMethods._autosave → _persist（localStorage 草稿，始终执行，保底）
//                         → _maybeWriteThroughLocalFile（写穿本地文件，受开关控制）。
//   本类以同名方法拦截 LocalFileSyncMethods 的写穿入口（SettingsMethods 在
//   applyPrototypeMethods 中排在 LocalFileSyncMethods 之后，覆盖生效）：
//   关闭自动保存后跳过自动写回；显式 Ctrl+S（onSave）直接写本地文件，不受影响。
import { LocalFileSyncMethods } from './localFileSyncMethods.ts';
import { loadSettings, sanitizeSettings, saveSettings } from './settings.ts';

const ORIGINAL_WRITE_THROUGH = LocalFileSyncMethods.prototype._maybeWriteThroughLocalFile;

const SETTINGS_LANG = 'zh-CN';

export class SettingsMethods {
  // ===== B19：自动保存语义门控 =====

  async _maybeWriteThroughLocalFile() {
    if (this.settings && this.settings.autosave === false) return;
    return ORIGINAL_WRITE_THROUGH.call(this);
  }

  // ===== 设置应用 =====

  _applySettings() {
    const settings = this.settings || loadSettings();
    this.settings = settings;
    const targets = [
      this.sourceRef && this.sourceRef.current,
      this.previewRef && this.previewRef.current
    ];
    for (const el of targets) {
      if (!el) continue;
      el.setAttribute('spellcheck', settings.spellcheck ? 'true' : 'false');
      el.setAttribute('lang', SETTINGS_LANG);
    }
  }

  _setSetting(key, value) {
    // 在当前设置之上合并（而不是在默认值之上）：单次改动不得冲掉其他已改字段。
    const current = this.settings || loadSettings();
    this.settings = sanitizeSettings({ ...current, [key]: value });
    saveSettings(this.settings);
    this._applySettings();
    this._syncSettingsPanel();
    if (key === 'autosave') {
      this._setStatus(this.settings.autosave
        ? '自动保存已开启'
        : '自动保存已关闭 · 草稿仍保存在浏览器 · 显式保存（Ctrl+S）仍写入本地文件');
    } else if (key === 'spellcheck') {
      this._setStatus('拼写检查已' + (this.settings.spellcheck ? '开启' : '关闭'));
    }
  }

  // ===== 面板开关 =====

  openSettings() {
    const overlay = this._buildSettingsModal();
    overlay.style.display = 'flex';
    this._syncSettingsPanel();
  }

  closeSettings() {
    if (this._settingsEl) this._settingsEl.style.display = 'none';
  }

  // ===== 面板骨架（JS 构建，仿 longImage 弹窗） =====

  _buildSettingsModal() {
    if (this._settingsEl) return this._settingsEl;
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    const modal = document.createElement('div');
    modal.className = 'settings-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', '设置');
    modal.append(this._buildSettingsHead(), this._buildSettingsBody());
    overlay.appendChild(modal);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.closeSettings(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this._settingsEl) return;
      if (this._settingsEl.style.display !== 'flex') return;
      e.preventDefault();
      this.closeSettings();
    });
    document.body.appendChild(overlay);
    this._settingsEl = overlay;
    return overlay;
  }

  _buildSettingsHead() {
    const head = document.createElement('div');
    head.className = 'settings-modal-head';
    const title = document.createElement('strong');
    title.className = 'settings-modal-title';
    title.textContent = '设置';
    const hint = document.createElement('p');
    hint.className = 'settings-modal-hint';
    hint.textContent = '更改即时保存并应用，刷新后保持。关闭自动保存后，草稿仍会保存在浏览器中（不丢稿）。';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'settings-modal-close';
    close.textContent = '×';
    close.title = '关闭（Esc）';
    close.setAttribute('aria-label', '关闭');
    close.addEventListener('click', () => this.closeSettings());
    head.append(title, hint, close);
    return head;
  }

  _buildSettingsBody() {
    const body = document.createElement('div');
    body.className = 'settings-body';
    body.append(
      this._buildToggleRow('spellcheck', '原生拼写检查',
        '开启后编辑区与预览使用浏览器原生拼写检查。'),
      this._buildToggleRow('autosave', '自动保存到本地文件',
        '关闭后不再自动写回已打开的本地文件；浏览器草稿始终自动保存（不丢稿），显式保存（Ctrl+S）仍写入本地文件。'),
      this._buildTextRow('exportPageMargin', '导出/打印页边距',
        '与打印页边距一致，导出与打印共用。示例：14mm 16mm'),
      this._buildRadioRow('printPaper', '打印纸色',
        '白纸：打印始终白底黑字（默认）；跟随预览：按预览纸色打印。', [
        { value: 'white', label: '白纸' },
        { value: 'follow-preview', label: '跟随预览' }
      ])
    );
    return body;
  }

  _buildRowText(label, hint) {
    const wrap = document.createElement('span');
    wrap.className = 'settings-row-text';
    const title = document.createElement('b');
    title.textContent = label;
    const sub = document.createElement('small');
    sub.textContent = hint;
    wrap.append(title, sub);
    return wrap;
  }

  _buildToggleRow(key, label, hint) {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'settings-check';
    input.dataset.settingsKey = key;
    input.addEventListener('change', () => this._setSetting(key, input.checked));
    row.append(this._buildRowText(label, hint), input);
    return row;
  }

  _buildTextRow(key, label, hint) {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'settings-text';
    input.dataset.settingsKey = key;
    input.spellcheck = false;
    input.addEventListener('change', () => this._setSetting(key, input.value));
    row.append(this._buildRowText(label, hint), input);
    return row;
  }

  _buildRadioRow(key, label, hint, options) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const group = document.createElement('div');
    group.className = 'settings-radios';
    options.forEach((option) => {
      const item = document.createElement('label');
      item.className = 'settings-radio';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'settings-' + key;
      input.value = option.value;
      input.dataset.settingsKey = key;
      input.addEventListener('change', () => {
        if (input.checked) this._setSetting(key, input.value);
      });
      const span = document.createElement('span');
      span.textContent = option.label;
      item.append(input, span);
      group.appendChild(item);
    });
    row.append(this._buildRowText(label, hint), group);
    return row;
  }

  _syncSettingsPanel() {
    if (!this._settingsEl) return;
    const settings = this.settings || loadSettings();
    this._settingsEl.querySelectorAll('[data-settings-key]').forEach((el) => {
      const value = settings[el.dataset.settingsKey];
      if (el.type === 'checkbox') el.checked = value === true;
      else if (el.type === 'radio') el.checked = el.value === String(value);
      else el.value = String(value);
    });
  }
}
