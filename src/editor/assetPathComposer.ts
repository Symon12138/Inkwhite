// M3-INSERT：图片资产策略的纯逻辑（文件名规范化/校验、去重、payload 检查、
// 插入策略决策、Markdown 引用组装）。node 可跑、无 DOM，单测见
// tests/unit/assetPathComposer.test.ts；与浏览器/编辑器/Tauri 的接线由消费方
// （轮 2：saveAssetFile → Rust save_asset_file）完成。
//
// 与 Rust 侧的安全不变量逐条对齐（S0.2）：basename 白名单、magic-byte（Rust 侧）、
// SVG 拒绝、去重、父目录 canonicalize（Rust 侧）。本模块只做 TS 侧镜像与策略决策，
// 落盘前的最终裁决在 Rust（save_asset_file），TS 校验失败时根本不发起调用。

/** 允许落盘的图片扩展名白名单（大小写不敏感；与 Rust 侧一致，且明确排除 svg）。 */
export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'];

/** 文件名长度上限（含扩展名），与规格一致。 */
export const MAX_ASSET_NAME_LENGTH = 200;

/** 图片 payload 默认大小上限（10 MB），与规格一致。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Windows 保留设备名（大小写不敏感）。按 Windows 语义匹配「第一个点之前」的段：
// CON.png 与 CON.foo.png 都无法在 Windows 创建，故一并拒绝。
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

// 非法字符在错误信息中的展示形式（与逐字检查列表一致）。
const ILLEGAL_CHARS = '<>:"|?*';

const BASE64_RE = /^[A-Za-z0-9+/=]+$/;
const DATA_URL_BASE64_MARKER = ';base64,';

/**
 * 校验图片文件名。拒绝时返回错误信息字符串；通过时返回规范化 basename
 * （剥掉任何路径前缀后取末段，防 `dir/name.png` 混入——调用方只能把返回值
 * 交给 dedupeAssetName / saveAssetFile，绝不可直接使用原始输入）。
 * 规格草稿写过「null=通过」，按定稿子弹「通过：返回 basename」实现：
 * 错误信息与规范化名都是字符串，调用方以「返回值是否等于某条已知错误文案」
 * 以外的简单方式判断时请以非空即视为通过（错误文案均为中文提示）。
 *
 * 检查顺序：控制字符 → `..`（对原始输入，防 `dir/../x.png` 逃逸）→
 * 剥路径前缀取末段 → 空 → 超长 → 非法字符 → 尾部点/空格 →
 * Windows 保留设备名 → 图片扩展名白名单。
 */
export function validateAssetName(name: string): string | null {
  const raw = String(name ?? '');
  if (/[\u0000-\u001F]/.test(raw)) return '文件名包含控制字符';
  if (raw.includes('..')) return '文件名不能包含 ".."';
  const basename = raw.split(/[\\/]/).pop() || '';
  if (basename === '') return '文件名不能为空';
  if (basename.length > MAX_ASSET_NAME_LENGTH) return '文件名不能超过 200 个字符';
  if (new RegExp('[' + ILLEGAL_CHARS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ']').test(basename)) {
    return '文件名包含非法字符（< > : " | ? *）';
  }
  if (basename.endsWith('.') || basename.endsWith(' ')) return '文件名不能以点（.）或空格结尾';
  if (WINDOWS_RESERVED.has(basename.split('.')[0].toUpperCase())) return '文件名是 Windows 保留设备名';
  const dot = basename.lastIndexOf('.');
  const ext = dot > 0 ? basename.slice(dot + 1).toLowerCase() : '';
  if (!IMAGE_EXTENSIONS.includes(ext)) {
    return '不支持的图片格式（仅支持 png/jpg/jpeg/gif/webp/bmp/avif/ico）';
  }
  return basename;
}

/**
 * 在同目录已有名字（文件/目录）集合中去重：冲突时依次试 `name-1`、`name-2`……
 * 保留扩展名（`photo.png` → `photo-1.png`）；默认大小写不敏感比较（Windows 语义）。
 * 输入应为 validateAssetName 的返回值。
 */
export function dedupeAssetName(dirNames: string[], name: string, caseInsensitive = true): string {
  const exists = (candidate: string) => dirNames.some((existing) =>
    caseInsensitive ? existing.toLowerCase() === candidate.toLowerCase() : existing === candidate
  );
  if (!exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let index = 1;
  let candidate = base + '-' + index + ext;
  while (exists(candidate)) {
    index += 1;
    candidate = base + '-' + index + ext;
  }
  return candidate;
}

/**
 * 估算 base64 解码后的字节数。接受裸 base64 或 `data:image/...;base64,...` 两种形态；
 * 对合法 base64（4 字符 ≈ 3 字节）结果精确，超限判定以此为准。
 */
export function estimateImageSize(base64: string): number {
  const input = String(base64 ?? '');
  const markerIndex = input.indexOf(DATA_URL_BASE64_MARKER);
  const payload = markerIndex >= 0
    ? input.slice(markerIndex + DATA_URL_BASE64_MARKER.length)
    : input;
  return Math.floor(payload.replace(/=+$/, '').length * 3 / 4);
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

/**
 * 检查图片 payload：空 / 非 base64（裸形态或 data URL 载荷不匹配
 * `^[A-Za-z0-9+/=]+$`，或以 `data:` 开头但不是 `;base64,` 形态）→ 错误信息；
 * 通过 → null。超限返回明确错误而非截断——大 data URL 不静默击穿草稿保存。
 * MIME/魔数级别的裁决（SVG 拒绝、magic-byte）在 validateAssetName 与 Rust 侧。
 */
export function checkImagePayload(
  base64: string,
  options: { maxBytes?: number } = {}
): string | null {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const input = String(base64 ?? '');
  if (input.trim() === '') return '图片数据为空';
  let payload = input;
  if (input.startsWith('data:')) {
    const markerIndex = input.indexOf(DATA_URL_BASE64_MARKER);
    if (markerIndex < 0) return '图片数据格式不正确（仅支持裸 base64 或 data:image/...;base64,...）';
    payload = input.slice(markerIndex + DATA_URL_BASE64_MARKER.length);
  }
  if (payload.trim() === '') return '图片数据为空';
  if (!BASE64_RE.test(payload)) return '图片数据不是有效的 base64';
  const bytes = estimateImageSize(payload);
  if (bytes > maxBytes) return '图片超过大小限制（上限 ' + formatByteSize(maxBytes) + '）';
  return null;
}

/** 图片插入策略：save（落盘）/ inline（data URL 直接引用）/ prompt-save（先弹另存为）。 */
export type InsertStrategy = 'save' | 'inline' | 'prompt-save';

export interface InsertStrategyInput {
  /** 是否已打开本地文档（有 docPath）。浏览器端恒为 false。 */
  hasDocPath: boolean;
  /** 是否运行在 Tauri 桌面端（tauriBridge !== null）。E2E 环境为 false。 */
  tauriAvailable: boolean;
}

/**
 * 纯决策：浏览器端（无 saveAssetFile 可用）→ 'inline'；
 * 桌面端已打开本地文档 → 'save'；桌面端未命名文档 → 'prompt-save'（接线层先弹另存为）。
 */
export function resolveInsertStrategy(input: InsertStrategyInput): InsertStrategy {
  if (!input.tauriAvailable) return 'inline';
  return input.hasDocPath ? 'save' : 'prompt-save';
}

export interface ImageMarkdownInput {
  src: string;
  alt?: string;
}

/**
 * 组装 `![alt](src)`。alt 转义 `[` `]` 与换行（换行折叠为空格）；
 * src 含空格或括号时用尖括号包裹（CommonMark 目标形式，避免 `)` 被当作
 * 链接终点——src 预期来自 validateAssetName（已拒绝 `<>`）或 data URL
 * （base64 字母表无 `<>`），故尖括号包裹安全。
 */
export function buildImageMarkdown(input: ImageMarkdownInput): string {
  const altText = String(input.alt ?? '')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/[\r\n]+/g, ' ');
  const src = String(input.src);
  const srcText = /[\s()]/.test(src) ? '<' + src + '>' : src;
  return '![' + altText + '](' + srcText + ')';
}
