export type EditorTheme = 'dark' | 'light';

export type AnnotationType = 'marker' | 'wavy' | 'straight' | 'idea';

export interface Annotation {
  id: string;
  quote: string;
  occ: number;
  start?: number;
  type: AnnotationType;
  note: string;
  ts: number;
}

export type PaperTheme = 'ink' | 'parchment' | 'cream' | 'snow' | 'green';

export interface PersistedEditorState {
  content: string;
  fileName: string;
  fontSize: number;
  /** 预览字号（独立于源码字号）；缺省时回落到 fontSize，用于旧数据迁移 */
  previewFontSize?: number;
  /** 当前字体 id（含 imported: 前缀）；缺省为默认楷体 */
  fontFamily?: string;
  theme: EditorTheme;
  /** 暗色主题下的纸色；缺省为墨黑 */
  paperDark?: PaperTheme;
  /** 亮色主题下的纸色；缺省为羊皮纸 */
  paperLight?: PaperTheme;
  /** @deprecated 旧的单份纸色记忆，读取时迁移到 paperDark/paperLight */
  paper?: PaperTheme;
  /** 沉浸式阅读是否使用宽屏内容宽度 */
  immersiveWide?: boolean;
  /** 保存长图使用的宽度档位（见 longImageComposer 的 LONG_IMAGE_PRESETS） */
  longImageWidth?: string;
  /** 长图是否带上划线批注；缺省为带 */
  longImageMarks?: boolean;
  /** 打字机模式开关 */
  typewriterActive?: boolean;
  comments: Annotation[];
}

export interface EditorProps {
  theme?: EditorTheme;
  wrapSource?: boolean;
}
