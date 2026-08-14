import { test, expect, openEditor, setSource } from './fixtures';
import { inflateRawSync } from 'zlib';

// M2 导出全链路（浏览器路径）：文件菜单 → 导出 → 下载拦截 → 结构化断言。
// 桌面端（Tauri）走 saveExportFile 对话框，由 Rust 测试与平台手测覆盖。

const EXPORT_SOURCE = [
  '---',
  'title: 导出测试',
  '---',
  '',
  '[TOC]',
  '',
  '# 一级标题',
  '',
  '正文 $x^2$ 与 ==重点== 与脚注[^1]。',
  '',
  '[^1]: 注释内容',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '- [x] 完成',
  ''
].join('\n');

async function exportViaMenu(page: import('@playwright/test').Page, label: RegExp) {
  await page.evaluate(() => {
    const sb = document.querySelector('.document-sidebar');
    if (sb) {
      sb.classList.remove('is-collapsed');
      sb.classList.add('is-mobile-open');
    }
    const tab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement | null;
    tab?.click();
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.locator('.sidebar-file-actions').getByRole('menuitem', { name: label }).click();
  return downloadPromise;
}

test('导出为 HTML：自包含结构断言（无脚本/无批注/变量冻结/新语法齐全）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, EXPORT_SOURCE);
  await expect(page.locator('.md-preview .katex')).toBeVisible();

  const download = await exportViaMenu(page, /导出 HTML/);
  const stream = await download.createReadStream();
  let html = '';
  for await (const chunk of stream) html += chunk.toString('utf8');

  expect(html).toMatch(/^<!DOCTYPE html>/i);
  expect(html).toMatch(/<meta charset="utf-8">/);
  // 导出标题 = 文件名基准（未命名文档回退「未命名-日期」）
  expect(html).toMatch(/<title>未命名-\d{4}-\d{2}-\d{2}<\/title>/);
  // 安全：无脚本、无事件属性
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son\w+=/i);
  // 批注剥离（DG4）：正文无 data-comment-* 属性残留
  // （注意冻结的 CSS 选择器里含 [data-comment-id]，属合法样式，只断言属性赋值形态）
  expect(html).not.toMatch(/data-comment-(id|badge)=/);
  // CSS 变量冻结：无 var(-- 残留
  expect(html).not.toMatch(/var\(--/);
  // 新语法结构齐全
  expect(html).toContain('class="katex"');
  expect(html).toContain('class="footnotes"');
  expect(html).toContain('class="toc"');
  expect(html).toContain('class="front-matter"');
  expect(html).toContain('task-list-item');
  expect(html).toContain('<table>');
  // 无相对资源 URL（自包含：图片要么 data:，要么缺失占位）
  expect(html).not.toMatch(/src="(?!data:)/);
  // 无海报品牌包装（正文无 longimg-* 类节点；CSS 选择器里的 .longimg-* 组合属合法样式）
  expect(html).not.toContain('class="longimg-');
});

test('导出为 PDF：触发系统打印（window.print 被调用）且先等预览就绪', async ({ page }) => {
  await openEditor(page);
  await page.addInitScript(() => {
    (window as any).__printCalled = false;
    window.print = () => { (window as any).__printCalled = true; };
  });
  await page.reload();
  await openEditor(page);
  await setSource(page, '```mermaid\ngraph TD;\n  A-->B;\n```');
  await expect(page.locator('.mermaid-rendered svg')).toBeVisible();

  await page.evaluate(() => {
    const sb = document.querySelector('.document-sidebar');
    if (sb) {
      sb.classList.remove('is-collapsed');
      sb.classList.add('is-mobile-open');
    }
    const tab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement | null;
    tab?.click();
  });
  await page.locator('.sidebar-file-actions').getByRole('menuitem', { name: /导出 PDF/ }).click();

  await expect.poll(() => page.evaluate(() => (window as any).__printCalled)).toBe(true);
  await expect(page.locator('.save-status')).toHaveText(/打印对话框/);
});

test('导出为 Word：docx ZIP 结构断言（PK 头 + 关键条目 + 公式图片）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, EXPORT_SOURCE);
  await expect(page.locator('.md-preview .katex')).toBeVisible();

  const download = await exportViaMenu(page, /导出 Word/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const buf = Buffer.concat(chunks);

  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.subarray(0, 2).toString()).toBe('PK');

  // 最小 ZIP 中心目录扫描：EOCD 签名 → 中心目录 → 条目名
  const names = zipEntryNames(buf);
  expect(names).toContain('[Content_Types].xml');
  expect(names).toContain('word/document.xml');
  // 公式/Mermaid 图片已嵌入（media 目录存在即说明有图片关系）
  expect(names.some((n) => n.startsWith('word/media/'))).toBe(true);
  // document.xml 含标题文本与表格
  const docXml = zipEntryText(buf, 'word/document.xml');
  expect(docXml).toContain('导出测试');
  expect(docXml).toContain('<w:tbl>');
});

// ── 最小 ZIP 读取（无依赖）：EOCD → 中心目录 → 条目名/条目内容 ──
function zipEntryNames(buf: Buffer): string[] {
  const eocd = findEocd(buf);
  if (!eocd) return [];
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];
  let p = dirOffset;
  const end = dirOffset + dirSize;
  while (p + 46 <= end && buf.readUInt32LE(p) === 0x02014b50) {
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names.length ? names : Array.from({ length: count }, (_, i) => 'entry-' + i);
}

function zipEntryText(buf: Buffer, entryName: string): string {
  const eocd = findEocd(buf);
  if (!eocd) return '';
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  let p = dirOffset;
  const end = dirOffset + dirSize;
  for (let i = 0; i < count && p + 46 <= end; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === entryName) {
      const method = buf.readUInt16LE(p + 10);
      const compSize = buf.readUInt32LE(p + 20);
      const localOffset = buf.readUInt32LE(p + 42);
      // 跳到本地文件头取数据（method 0=存储；8=deflate 用 Node 内置 zlib 解压）
      const lh = localOffset;
      const lnameLen = buf.readUInt16LE(lh + 26);
      const lextraLen = buf.readUInt16LE(lh + 28);
      const dataStart = lh + 30 + lnameLen + lextraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return data.toString('utf8');
      if (method === 8) {
        try {
          return inflateRawSync(data).toString('utf8');
        } catch {
          return '';
        }
      }
      return '';
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return '';
}

function findEocd(buf: Buffer): number | null {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return null;
}
