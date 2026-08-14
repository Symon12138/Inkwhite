// WP8b（S0.3）：Word 导出 spike —— html-to-docx vs docx 的浏览器/Vite 可行性实测。
// 只读理解 + E2E 固化；不改 src/，不提交 git。结论与选型文档见 docs/WORD_SPIKE.md。
// 断言基于 2026-08-12 实测（html-to-docx@1.8.0 + docx@9.7.1，Node 24 + Chromium + Vite dev）。
//
// ── 实测结论预览 ─────────────────────────────────────────────────────────
// 1. html-to-docx@1.8.0：module 字段指向 dist/html-to-docx.esm.js，但该 ESM 构建
//    顶部 import fs/path/http/https/zlib/crypto/punycode 等 Node 内建模块，
//    浏览器（含 Vite dev）无法解析 → 浏览器构建不可用。Node 侧转换正常
//    （本文件用例 2 实测：Buffer 20KB、PK 魔数、[Content_Types].xml 等条目齐全，
//    含 data URL 图片内联）。
// 2. docx@9.7.1：dist/index.mjs 是 rolldown 全内联 ESM（零裸导入、自带 Buffer
//    兼容层），浏览器可用（本文件用例 4 实测：Packer.toArrayBuffer 产出 PK 魔数
//    ZIP，[Content_Types].xml / word/document.xml / word/media/ 条目齐全，
//    表格与 data URL 图片正常进包）。
// ─────────────────────────────────────────────────────────────────────────
import { test, expect, openEditor } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Vite dev server 从项目根服务 node_modules 下的 ESM 文件（katexDecision.spec.ts
// 实测可用）。html-to-docx 的实际 ESM 入口是 module 字段指向的 html-to-docx.esm.js
// （main 是 UMD），docx 的入口是 exports 映射的 index.mjs。
const HTML_TO_DOCX_URL = '/node_modules/html-to-docx/dist/html-to-docx.esm.js';
const DOCX_URL = '/node_modules/docx/dist/index.mjs';

// 1×1 透明 PNG（最小合法图片，验证图片进包路径）
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = 'data:image/png;base64,' + TINY_PNG_BASE64;

// 供浏览器侧 page.evaluate 使用的工具函数（ZIP 中央目录文件名不压缩，可直接在
// 字节里搜 ASCII；大数组按块转字符串，避免 fromCharCode 参数上限）
function latin1FromNode(buf: Buffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}

test('依赖版本锁定：html-to-docx 1.8.0、docx 9.7.1（与 package.json 一致）', () => {
  const rootPkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  expect(rootPkg.dependencies['html-to-docx']).toBe('1.8.0');
  expect(rootPkg.dependencies['docx']).toBe('9.7.1');
  const htmlToDocxPkg = JSON.parse(readFileSync(path.join(process.cwd(), 'node_modules/html-to-docx/package.json'), 'utf8'));
  const docxPkg = JSON.parse(readFileSync(path.join(process.cwd(), 'node_modules/docx/package.json'), 'utf8'));
  expect(htmlToDocxPkg.version).toBe('1.8.0');
  expect(docxPkg.version).toBe('9.7.1');
});

test('html-to-docx 在 Node 侧可用：标题/段落/表格/图片(data URL) 转换出合法 docx（ZIP 头 + 包内条目）', async ({}, testInfo) => {
  // 裸导入走 package.json main（UMD），default 即转换函数（2026-08-12 实测形状）
  const mod = (await import('html-to-docx')) as { default: (html: string) => Promise<unknown> };
  const sampleHtml =
    '<h1>Spike 标题</h1>' +
    '<p>段落一：Word 导出可行性验证。</p>' +
    '<table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>' +
    '<img src="' + TINY_PNG_DATA_URL + '" alt="tiny" />';
  const buf = (await mod.default(sampleHtml)) as Buffer;

  // 返回 Buffer 且以 ZIP 魔数 PK 开头
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.length).toBeGreaterThan(1000);
  const bytes = new Uint8Array(buf);
  expect(bytes[0]).toBe(0x50); // 'P'
  expect(bytes[1]).toBe(0x4b); // 'K'
  const latin = latin1FromNode(buf);
  expect(latin).toContain('[Content_Types].xml');
  expect(latin).toContain('word/document.xml');
  // data URL 图片已作为 media 进包（html-to-docx 自带 image-to-base64 内联路径）
  expect(latin).toContain('word/media/');

  // 落盘 artifact（test-results 下，已 gitignore），供 WPS/Word 打开手测与复核
  const artifact = testInfo.outputPath('spike-docx-node-html-to-docx.docx');
  writeFileSync(artifact, buf);
  console.log('[wordSpike] Node 侧 html-to-docx 生成的 docx 落盘：' + artifact + '（' + buf.length + ' 字节，ZIP 头 PK ✓）');
});

test('html-to-docx 浏览器导入失败：ESM 构建依赖 Node 内建模块（记录实测错误，不假装成功）', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(
    async ({ url }) => {
      try {
        const mod = await import(url);
        return { ok: true, hasDefault: typeof (mod as { default?: unknown }).default };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    },
    { url: HTML_TO_DOCX_URL }
  );

  // 实测（2026-08-12，Vite dev）：导入在解析 `import fs from "fs"` 等内建模块时
  // 失败。这是结构性问题（esm.js 顶部 import fs/path/http/https/zlib/crypto/punycode），
  // 不是路径写错——Node 侧同一文件可正常加载（见用例 2）。
  console.log('[wordSpike] html-to-docx 浏览器导入失败，错误：' + String(result.message).slice(0, 400));
  expect(result.ok).toBe(false);
  expect(String(result.message).length).toBeGreaterThan(0);
});

test('docx 在浏览器可用：最小文档（标题/段落/表格/图片 data URL）生成合法 docx（ZIP 头 + 条目断言）', async ({ page }, testInfo) => {
  await openEditor(page);
  const result = await page.evaluate(
    async ({ url, pngBase64 }) => {
      const latin1 = (bytes: Uint8Array): string => {
        let s = '';
        for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return s;
      };
      const bytesToBase64 = (bytes: Uint8Array): string => {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      };
      const docx = await import(url);
      const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, ImageRun } = docx;
      const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: 'Spike 标题', heading: HeadingLevel.HEADING_1 }),
              new Paragraph('段落一：浏览器内生成 Word 文档的可行性验证。'),
              new Table({
                rows: [
                  new TableRow({ children: [new TableCell({ children: [new Paragraph('A1')] }), new TableCell({ children: [new Paragraph('B1')] })] }),
                  new TableRow({ children: [new TableCell({ children: [new Paragraph('A2')] }), new TableCell({ children: [new Paragraph('B2')] })] })
                ]
              }),
              new Paragraph({
                children: [new ImageRun({ type: 'png', data: pngBytes, transformation: { width: 8, height: 8 } })]
              })
            ]
          }
        ]
      });
      const buffer = await Packer.toArrayBuffer(doc);
      const bytes = new Uint8Array(buffer);
      const latin = latin1(bytes);
      return {
        zipMagic: [bytes[0], bytes[1]],
        byteLength: bytes.length,
        hasContentTypes: latin.includes('[Content_Types].xml'),
        hasDocumentXml: latin.includes('word/document.xml'),
        hasMedia: latin.includes('word/media/'),
        base64: bytesToBase64(bytes)
      };
    },
    { url: DOCX_URL, pngBase64: TINY_PNG_BASE64 }
  );

  // ZIP 魔数 PK + 体积合理
  expect(result.zipMagic).toEqual([0x50, 0x4b]);
  expect(result.byteLength).toBeGreaterThan(1000);
  // 最小文档的三个关键条目都在包里
  expect(result.hasContentTypes).toBe(true);
  expect(result.hasDocumentXml).toBe(true);
  expect(result.hasMedia).toBe(true);

  // 落盘 artifact（test-results 下，已 gitignore），供 WPS/Word 打开手测与复核
  const artifact = testInfo.outputPath('spike-docx-browser.docx');
  writeFileSync(artifact, Buffer.from(result.base64, 'base64'));
  console.log('[wordSpike] 浏览器生成的 docx 落盘：' + artifact + '（' + result.byteLength + ' 字节，ZIP 头 PK ✓）');
});
