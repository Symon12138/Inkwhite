// M3-PASTE: clipboard helpers (B11).
// Copy Markdown: native Ctrl+C already copies plain source text.
// This module adds "copy rendered HTML" (safe, static HTML).

export interface ClipboardPayloadDescription {
  mimeTypes: string[];
  htmlSafe: boolean;
  textLength: number;
}

export function describeClipboardPayload(payload: { html: string; text: string }): ClipboardPayloadDescription {
  return {
    mimeTypes: ['text/html', 'text/plain'],
    htmlSafe: isSafeHtml(payload.html),
    textLength: payload.text.length
  };
}

export function isSafeHtml(html: string): boolean {
  return !/<script[\s>]/i.test(html)
    && !/\son\w+\s*=/i.test(html)
    && !/(javascript|vbscript):/i.test(html);
}

export function sanitizeClipboardHtml(html: string): string {
  let out = String(html ?? '');
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/(href|src)\s*=\s*"(javascript|vbscript|data):/gi, (_, attr) => attr + '=""');
  return out;
}

export function copyMarkdownSelection(text: string): string {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

export function buildClipboardItem(payload: { html: string; text: string }): ClipboardItem {
  return new ClipboardItem({
    'text/html': new Blob([payload.html], { type: 'text/html' }),
    'text/plain': new Blob([payload.text], { type: 'text/plain' })
  });
}
