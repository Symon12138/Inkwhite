// @ts-nocheck
// 批注随文件存储（方案一）：文件末尾 HTML 注释内嵌
// 格式：<!-- inkwhite-annotations: <base64 JSON> -->
// base64 为 annotations 数组的 UTF-8 JSON 编码，单行置于文件末尾
// 打开时提取并剥离注释块，保存时按当前批注重建或移除块。
//
// 设计约束：
// - 注释块仅在文件末尾时识别，文档中间同形文本不受影响（避免误伤代码块内示例）
// - 空批注不产生注释块，清空批注时移除旧块
// - 损坏的块容错移除，不抛出

export const ANNOTATION_MARKER = 'inkwhite-annotations:';

function encodeAnnotations(annotations) {
  if (!annotations || annotations.length === 0) return null;
  try {
    const json = JSON.stringify(annotations);
    // btoa 仅支持 Latin1，用 encodeURIComponent 转码以支持中文/Emoji
    return btoa(unescape(encodeURIComponent(json)));
  } catch {
    return null;
  }
}

function decodeAnnotations(b64) {
  try {
    const json = decodeURIComponent(escape(atob(b64)));
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return null;
    return arr;
  } catch {
    return null;
  }
}

// 匹配文件末尾的注释块，捕获载荷（\S+ 以容错损坏的块，解码失败时仍剥离）
const ANNOTATION_RE = /\n*<!--[\s]*inkwhite-annotations:[\s]*(\S+)[\s]*-->[\s]*$/;

export function extractAnnotations(content) {
  const text = String(content || '');
  const m = text.match(ANNOTATION_RE);
  if (!m) return { content: text, annotations: null };
  const b64 = m[1];
  const annotations = decodeAnnotations(b64);
  const clean = text.slice(0, m.index).replace(/\s*$/, '');
  return { content: clean, annotations };
}

export function embedAnnotations(content, annotations) {
  const text = String(content || '');
  // 先剥离已有的块，避免重复累积
  const base = extractAnnotations(text).content;
  const clean = base.replace(/\s*$/, '');
  // 空批注：返回干净内容
  if (!annotations || annotations.length === 0) return clean;
  const b64 = encodeAnnotations(annotations);
  if (!b64) return clean;
  const block = '<!-- ' + ANNOTATION_MARKER + ' ' + b64 + ' -->';
  if (!clean) return block + '\n';
  return clean + '\n\n' + block + '\n';
}

// 兼容别名（与测试命名对齐）
export function serializeAnnotations(annotations) {
  return encodeAnnotations(annotations);
}
