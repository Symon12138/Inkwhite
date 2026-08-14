// M2-EXPORT-CORE：浏览器端全链路 E2E。
// HTML 导出（DG4/DG5/DG6/DG7/DG9 全断言）+ Word 导出（flatten → 光栅化 → docx，
// ZIP 条目结构化断言 + 产物落盘 artifact）。
// 导入方式：page.evaluate 动态 import('/src/editor/*.ts')——Vite dev 直接服务 src
// 模块（katexDecision.spec.ts 的 /node_modules 动态导入先例；src 模块同样可用）。
// 红测先行：本文件先写，跑一遍确认失败（模块不存在），再实现到全绿。

import { test, expect, openEditor, setSource } from './fixtures';
import { writeFileSync } from 'node:fs';

const ARTICLE = [
  '---',
  'title: 导出测试',
  'author: M2',
  '---',
  '',
  '[TOC]',
  '',
  '# 一级标题',
  '',
  '正文段落，含行内公式 $E=mc^2$，以及**加粗**与*斜体*。',
  '',
  '$$\\int_0^1 x^2\\,dx$$',
  '',
  '脚注引用[^1]',
  '',
  '[^1]: 脚注内容在这里。',
  '',
  '| 列A | 列B |',
  '| --- | --- |',
  '| 值1 | 值2 |',
  '',
  '- [x] 已完成任务',
  '- [ ] 待办任务',
  '',
  '```mermaid',
  'graph TD;',
  '  A-->B;',
  '```',
  '',
  '```mermaid',
  'this is not a diagram',
  '```',
  '',
  '<span data-comment-id="c1">被批注的文字</span><span data-comment-badge="c1">1</span>',
  '',
  '![外链图](https://example.com/pic.png)',
  '',
  '![相对图](images/pic.png)',
  '',
  '![数据图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==)',
  '',
  '<svg width="100" height="50"><script>alert(1)</script></svg>',
  '',
  '<svg width="100" height="50" onload="x()"><foreignObject><div>hi</div></foreignObject></svg>'
].join('\n');

// 等预览就绪（字体 + Mermaid 渲染 + 图片水合全部结算；viewMethods 的就绪原语）。
// 比 locator 超时更稳：全量并行跑时 Mermaid 渲染可能超过默认 5s。
async function awaitPreviewReady(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(async () => {
    const preview = document.querySelector('.md-preview');
    if (!preview) return false;
    const ready = (preview as { __awaitPreviewReady?: () => Promise<void> }).__awaitPreviewReady;
    if (typeof ready !== 'function') return false;
    await ready();
    return true;
  }, undefined, { timeout: 30_000 });
}

async function runHtmlExport(page: import('@playwright/test').Page, title: string) {
  return page.evaluate(
    async ({ exportTitle }) => {
      const exp = await import('/src/editor/exportMethods.ts');
      const preview = document.querySelector('.md-preview');
      if (preview && typeof (preview as { __awaitPreviewReady?: () => Promise<void> }).__awaitPreviewReady === 'function') {
        await (preview as { __awaitPreviewReady: () => Promise<void> }).__awaitPreviewReady();
      }
      const { html, warnings } = await exp.exportHtmlFromPreview(preview, { title: exportTitle, localImages: {} });
      // DG6 语义断言：foreignObject 只允许出现在 .mermaid-rendered（渲染器产物，
      // flowchart 的 htmlLabels 合法使用它——实测）；其余位置的 foreignObject 一律不允许
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const unsafeForeignObjects = Array.from(parsed.querySelectorAll('foreignObject'))
        .filter((fo) => !fo.closest('.mermaid-rendered')).length;
      // 应用壳断言限定在 body：<head> 的 CSS 可能带 `.longimg-poster .mermaid-rendered`
      // 这类复合选择器（共享样式表里与导出选择器共现），对导出物无害（无匹配节点）
      const bodyHtml = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
      return { html, warnings, unsafeForeignObjects, bodyHtml };
    },
    { exportTitle: title }
  );
}

test('HTML 导出：自包含文档全断言（DG4/DG5/DG6/DG7/DG9 + 结构保留）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, ARTICLE);
  await awaitPreviewReady(page);
  await expect(page.locator('.md-preview .katex').first()).toBeVisible();
  await expect(page.locator('.md-preview .mermaid-rendered svg').first()).toBeVisible();
  await expect(page.locator('.md-preview .mermaid-rendered.has-error')).toBeVisible();

  const { html, warnings, unsafeForeignObjects, bodyHtml } = await runHtmlExport(page, '导出测试');

  // ── 文档骨架
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(html).toMatch(/<html lang="zh-CN">/);
  expect(html).toContain('<title>导出测试</title>');
  expect(html).toContain('<meta charset="utf-8">');

  // ── 安全：无 script / 事件属性 / SVG 逃逸（DG6 兜底 + 预览净化基线）
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son\w+\s*=/i);
  // foreignObject 只允许存在于 .mermaid-rendered（渲染器产物）；其余一律不允许
  expect(unsafeForeignObjects).toBe(0);
  // 应用壳不进导出（限定 body：head 的共享样式表复合选择器不构成内容）
  expect(bodyHtml).not.toContain('app-header');
  expect(bodyHtml).not.toContain('longimg-');

  // ── DG4：批注默认剥离（body 层；head 的共享样式表可能带 [data-comment-id] 选择器）
  expect(bodyHtml).not.toContain('data-comment-');
  expect(bodyHtml).toContain('被批注的文字');

  // ── CSS 变量已冻结：无 var(-- 残留，字面值块存在
  expect(html).not.toContain('var(--');
  expect(html).toContain('--fs-xl:');

  // ── DG7 Path A（POC 实测：katex woff2 全量 259KB < 1MB 阈值）：woff2 内联为 data URL
  expect(html).toContain('data:font/woff2;base64,');
  expect(warnings.every((w) => !w.includes('字体'))).toBe(true);

  // ── DG5：远程图失败保留原 URL + 提示；相对图占位；data URL 图保留
  expect(html).toContain('https://example.com/pic.png');
  expect(html).toContain('图片未能载入');
  expect(html).not.toContain('src="images/');
  expect(html).toContain('iVBORw0KGgo');
  expect(warnings.some((w) => w.includes('未能内联'))).toBe(true);

  // ── DG9：失败 Mermaid 占位 + 附录原文；好图保留
  expect(html).toContain('图表渲染失败');
  expect(html).toContain('Mermaid 渲染失败');
  expect(html).not.toContain('has-error"');
  expect(html).toContain('mermaid-rendered');
  expect(html).toContain('<svg');

  // ── 新语法结构齐全：KaTeX / 脚注 / TOC / 前置元数据 / 任务列表 / 表格
  expect(html).toContain('class="katex"');
  expect(html).toContain('class="footnotes"');
  expect(html).toContain('class="toc"');
  expect(html).toContain('class="front-matter"');
  expect(html).toContain('task-list-item');
  expect(html).toContain('<table>');
  expect(html).toContain('脚注内容在这里');
  expect(html).toContain('已完成任务');
});

test('Word 导出：flatten → 光栅化 → docx（PK + ZIP 条目 + 媒体）', async ({ page }, testInfo) => {
  await openEditor(page);
  await setSource(page, [
    '# Word 导出标题',
    '',
    '正文段落，含行内公式 $a^2+b^2=c^2$。',
    '',
    '$$E = mc^2$$',
    '',
    '```mermaid',
    'graph TD;',
    '  A-->B;',
    '```',
    '',
    '| 列A | 列B |',
    '| --- | --- |',
    '| x | y |',
    '',
    '```ts',
    'const n: number = 42;',
    '```',
    '',
    '- 列表项一',
    '- 列表项二'
  ].join('\n'));
  await awaitPreviewReady(page);
  await expect(page.locator('.md-preview .katex').first()).toBeVisible();
  await expect(page.locator('.md-preview .mermaid-rendered svg').first()).toBeVisible();

  const result = await page.evaluate(
    async ({ exportTitle }) => {
      // ZIP 条目扫描（EOCD + 中央目录，零依赖，~40 行；与 node 单测同构）
      const zipNames = (bytes: Uint8Array): string[] => {
        const names: string[] = [];
        let eocd = -1;
        for (let i = bytes.length - 22; i >= 0; i--) {
          if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
            eocd = i;
            break;
          }
        }
        if (eocd < 0) return names;
        const view = new DataView(bytes.buffer);
        const count = view.getUint16(eocd + 10, true);
        let pos = view.getUint32(eocd + 16, true);
        for (let i = 0; i < count; i++) {
          const nameLen = view.getUint16(pos + 28, true);
          const extraLen = view.getUint16(pos + 30, true);
          const commentLen = view.getUint16(pos + 32, true);
          let name = '';
          for (let j = 0; j < nameLen; j++) name += String.fromCharCode(bytes[pos + 46 + j]);
          names.push(name);
          pos += 46 + nameLen + extraLen + commentLen;
        }
        return names;
      };
      const toBase64 = (bytes: Uint8Array): string => {
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(binary);
      };
      const exp = await import('/src/editor/exportMethods.ts');
      const flat = await import('/src/editor/flattenDocument.ts');
      const share = await import('/src/editor/shareExportUtils.ts');
      const word = await import('/src/editor/wordExport.ts');
      const composer = await import('/src/editor/exportComposer.ts');
      const preview = document.querySelector('.md-preview');
      if (preview && typeof (preview as { __awaitPreviewReady?: () => Promise<void> }).__awaitPreviewReady === 'function') {
        await (preview as { __awaitPreviewReady: () => Promise<void> }).__awaitPreviewReady();
      }
      const clone = preview.cloneNode(true);
      const { root, images } = flat.flattenForWord(clone);
      const sheets = document.styleSheets;
      const computed = getComputedStyle(document.body);
      const css = exp.freezeCssVariables(sheets, (n: string) => computed.getPropertyValue(n).trim())
        + '\n' + composer.extractExportCss(sheets);
      const fontsCss = await share.inlineFontFaces(sheets);
      await flat.renderWordImages(images, { css, fontsCss, fontSizePx: parseFloat(computed.fontSize) });
      const buffer = await word.buildDocx({ title: exportTitle, flattenedRoot: root, images });
      const bytes = new Uint8Array(buffer);
      return {
        zipMagic: [bytes[0], bytes[1]],
        byteLength: bytes.length,
        names: zipNames(bytes),
        images: images.map((im: { key: string; dataUrl: string; widthPx: number; heightPx: number; failed: boolean }) => ({
          key: im.key,
          dataUrlHead: im.dataUrl.slice(0, 22),
          widthPx: im.widthPx,
          heightPx: im.heightPx,
          failed: im.failed
        })),
        base64: toBase64(bytes)
      };
    },
    { exportTitle: 'Word 导出测试' }
  );

  // ── ZIP 结构硬证据
  expect(result.zipMagic).toEqual([0x50, 0x4b]);
  expect(result.byteLength).toBeGreaterThan(2000);
  for (const required of ['[Content_Types].xml', 'word/document.xml', 'word/_rels/document.xml.rels', '_rels/.rels']) {
    expect(result.names).toContain(required);
  }
  const media = result.names.filter((n: string) => n.startsWith('word/media/'));
  expect(media.length).toBeGreaterThanOrEqual(2);

  // ── 真实 KaTeX/Mermaid 光栅：3 个占位全部渲染成功
  expect(result.images.length).toBe(3);
  for (const image of result.images) {
    expect(image.failed).toBe(false);
    expect(image.dataUrlHead).toBe('data:image/png;base64,');
    expect(image.widthPx).toBeGreaterThan(0);
    expect(image.heightPx).toBeGreaterThan(0);
  }

  // ── 产物落盘 artifact（test-results 下，已 gitignore），供 WPS/Word 人工复核
  const artifact = testInfo.outputPath('htmlExport-word.docx');
  writeFileSync(artifact, Buffer.from(result.base64, 'base64'));
  console.log('[htmlExport] Word 产物落盘：' + artifact + '（' + result.byteLength + ' 字节，PK ✓，media ' + media.length + ' 张）');
});

test('HTML 导出安全兜底：恶意 SVG（script/onload/foreignObject）不出现在导出物', async ({ page }) => {
  await openEditor(page);
  await setSource(page, [
    '<svg width="100" height="50"><script>window.__xss = 1</script></svg>',
    '',
    '<svg width="100" height="50" onload="window.__xss = 2"><foreignObject><div onclick="window.__xss = 3">hi</div></foreignObject></svg>',
    '',
    '正文保留'
  ].join('\n'));

  const { html } = await runHtmlExport(page, '安全测试');

  expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/\son\w+\s*=/i);
  expect(html).not.toMatch(/foreignObject/i);
  expect(html).toContain('正文保留');
});
