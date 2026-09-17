// Word-specific, editable OOXML subset; not a general CSS layout engine.
import { AlignmentType, LineRuleType, ShadingType, UnderlineType,
  type IParagraphOptions, type IRunOptions } from 'docx';

const CAPTURE_PROPERTIES = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'color',
  'background-color', 'text-decoration-line', 'vertical-align', 'text-align',
  'line-height', 'margin-top', 'margin-bottom', 'margin-left', 'padding-left'
];

/** Call on an untouched clone before flattening. Never read computed styles of a detached tree. */
export function captureWordStyles(source: Element, clone: Element): void {
  const view = source.ownerDocument.defaultView;
  if (!view) return;
  const originals = [source, ...Array.from(source.querySelectorAll('*'))];
  const copies = [clone, ...Array.from(clone.querySelectorAll('*'))];
  originals.forEach((original, index) => {
    // 公式和 SVG 自带布局；将缩放后的计算字号写回其内部会二次缩放或裁字。
    if (original.closest('.katex, .katex-display, .mermaid-rendered')) return;
    const target = copies[index] as HTMLElement | undefined;
    if (!target?.style) return;
    const computed = view.getComputedStyle(original);
    for (const property of CAPTURE_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });
}

function declarations(el: Element): Record<string, string> {
  const values: Record<string, string> = {};
  for (const declaration of (el.getAttribute('style') || '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) values[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim();
  }
  return values;
}

function cssPixels(value: string | undefined): number | undefined {
  if (!value || !/^(?:\d*\.)?\d+(?:px|pt)$/.test(value)) return undefined;
  const number = parseFloat(value) * (value.endsWith('pt') ? 4 / 3 : 1);
  return Number.isFinite(number) ? number : undefined;
}

function cssColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return value.slice(1).split('').map(c => c + c).join('').toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(value);
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) < 1)) return undefined;
  return rgb.slice(1, 4).map(v => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function wordRunStyle(el: Element, inherited: IRunOptions = {}): IRunOptions {
  const tag = (el.tagName || '').toUpperCase();
  const css = declarations(el);
  const result = { ...inherited };
  if (['STRONG', 'B', 'TH'].includes(tag)) result.bold = true;
  if (['EM', 'I'].includes(tag)) result.italics = true;
  if (['CODE', 'PRE', 'KBD', 'SAMP'].includes(tag)) result.font = 'Consolas';
  if (tag === 'U') result.underline = { type: UnderlineType.SINGLE };
  if (['DEL', 'S', 'STRIKE'].includes(tag)) result.strike = true;
  if (tag === 'MARK') result.shading = { type: ShadingType.CLEAR, fill: 'FFFF00' };
  if (tag === 'SUP') { result.superScript = true; result.subScript = false; }
  if (tag === 'SUB') { result.subScript = true; result.superScript = false; }
  const family = css['font-family']?.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (family) result.font = { ascii: family, hAnsi: family, eastAsia: family, cs: family };
  const px = cssPixels(css['font-size']);
  if (px && px > 0) { result.size = Math.max(1, Math.round(px * 1.5)); result.sizeComplexScript = result.size; }
  if (css['font-weight']) result.bold = css['font-weight'] === 'bold' || Number(css['font-weight']) >= 600;
  if (css['font-style']) result.italics = /italic|oblique/.test(css['font-style']);
  const color = cssColor(css.color);
  if (color) result.color = color;
  const fill = cssColor(css['background-color']);
  if (fill) result.shading = { type: ShadingType.CLEAR, fill };
  // CSS decorations propagate through descendants even when their computed value is "none".
  const decoration = css['text-decoration-line'] || css['text-decoration'] || '';
  if (decoration.includes('underline')) result.underline = { type: UnderlineType.SINGLE };
  if (decoration.includes('line-through')) result.strike = true;
  if (css['vertical-align'] === 'super') { result.superScript = true; result.subScript = false; }
  if (css['vertical-align'] === 'sub') { result.subScript = true; result.superScript = false; }
  return result;
}

export function wordParagraphStyle(el: Element): IParagraphOptions {
  const css = declarations(el);
  const alignment = { left: AlignmentType.LEFT, right: AlignmentType.RIGHT, center: AlignmentType.CENTER,
    justify: AlignmentType.JUSTIFIED, start: AlignmentType.START, end: AlignmentType.END }[css['text-align']];
  const before = cssPixels(css['margin-top']);
  const after = cssPixels(css['margin-bottom']);
  const line = cssPixels(css['line-height']);
  const quote = (el.tagName || '').toUpperCase() === 'BLOCKQUOTE';
  return {
    alignment,
    spacing: {
      before: before === undefined ? undefined : Math.round(before * 15),
      after: after === undefined ? undefined : Math.round(after * 15),
      line: line ? Math.round(line * 15) : undefined,
      lineRule: line ? LineRuleType.AT_LEAST : undefined
    },
    indent: quote ? { left: Math.round(((cssPixels(css['padding-left']) || 16) + (cssPixels(css['margin-left']) || 0)) * 15) } : undefined
  };
}
