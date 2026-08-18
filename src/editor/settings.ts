// M2-SETTINGS：编辑器设置——纯逻辑模块（无 DOM 依赖），单测见 tests/unit/settings.test.ts。
// 面板构建与接线在 settingsMethods.ts；入口按钮由 M2-UI 统一接线。
//
// 语义决策（B19 硬约束：关闭自动保存不静默丢稿）：
//   - autosave 只控制「写穿本地文件」（localFileSyncMethods 的自动写回）；
//   - localStorage 草稿（EDITOR_STORAGE_KEY，经 _persist 保存）始终保存，作为保底；
//   - 显式保存（Ctrl+S，onSave）直接写本地文件，不经 autosave 开关。
export const SETTINGS_KEY = 'md-editor-settings-v1';

export type PrintPaper = 'follow-preview' | 'white';

export interface EditorSettings {
  /** 原生拼写检查（B21）：默认开；应用为 textarea/preview 的 spellcheck 与 lang 属性 */
  spellcheck: boolean;
  /** 自动保存（B19）：只控制写穿本地文件；localStorage 草稿始终保存 */
  autosave: boolean;
  /** 导出/打印页边距，与 print CSS 的 @page margin 一致（默认 14mm 16mm） */
  exportPageMargin: string;
  /** 打印纸色：'white'（默认，DG1：打印白纸黑字）| 'follow-preview'（跟随预览纸色） */
  printPaper: PrintPaper;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  spellcheck: true,
  autosave: true,
  exportPageMargin: '14mm 16mm',
  printPaper: 'white'
};

const PRINT_PAPERS: readonly PrintPaper[] = ['follow-preview', 'white'];
const MARGIN_MAX_LENGTH = 40;
// 页边距宽松校验：须包含数字或百分号（拒绝空串、纯字母等明显非法值）。
const MARGIN_HAS_NUMBER = /[\d%]/;

function sanitizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizePrintPaper(value: unknown): PrintPaper {
  return PRINT_PAPERS.includes(value as PrintPaper)
    ? (value as PrintPaper)
    : DEFAULT_SETTINGS.printPaper;
}

function sanitizeMargin(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.exportPageMargin;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MARGIN_MAX_LENGTH) return DEFAULT_SETTINGS.exportPageMargin;
  if (!MARGIN_HAS_NUMBER.test(trimmed)) return DEFAULT_SETTINGS.exportPageMargin;
  return trimmed;
}

/** 把任意输入消毒成一份完整合法的设置；单个字段非法时回退该字段默认值。 */
export function sanitizeSettings(raw: unknown): EditorSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const source = raw as Record<string, unknown>;
  return {
    spellcheck: sanitizeBoolean(source.spellcheck, DEFAULT_SETTINGS.spellcheck),
    autosave: sanitizeBoolean(source.autosave, DEFAULT_SETTINGS.autosave),
    exportPageMargin: sanitizeMargin(source.exportPageMargin),
    printPaper: sanitizePrintPaper(source.printPaper)
  };
}

/** 在默认值之上合并部分设置（非法字段回退默认），返回完整设置。 */
export function mergeSettings(partial: unknown): EditorSettings {
  if (!partial || typeof partial !== 'object') return { ...DEFAULT_SETTINGS };
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...(partial as Record<string, unknown>) });
}

/** 读取已保存的设置；无记录/损坏 JSON/非法值时回退默认（刷新后保持靠 saveSettings 写入）。 */
export function loadSettings(): EditorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 写入设置；localStorage 不可用（隐私模式等）时静默，设置仅本次会话生效。 */
export function saveSettings(settings: EditorSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 与 storage.ts 的 saveEditorState 同策略：受限环境下静默降级。
  }
}
