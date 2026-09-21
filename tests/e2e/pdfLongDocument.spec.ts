import { test, expect, openEditor, setSource, clickMenubarItem } from './fixtures';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// 长文回归：曾因「一次性光栅化整篇」申请超高画布而卡死数分钟无响应，
// 现按带渲染。这里断言长文能在合理时间内产出合法多页 PDF，防止退回旧实现。
// 200 节足以触发旧实现的一次性超高画布卡死；再多会明显拉长全量套件时间。
const SECTIONS = 120;

function pageStats(buffer: Buffer) {
  const text = buffer.toString('latin1');
  const count = Number(/\/Count (\d+)/.exec(text)![1]);
  const marker = /<< \/Type \/XObject \/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*\/Length (\d+) >>\nstream\n/g;
  let match: RegExpExecArray | null;
  const pages: Array<{ width: number; height: number; dark: number }> = [];
  while ((match = marker.exec(text))) {
    const start = match.index + match[0].length;
    const rgb = inflateSync(buffer.subarray(start, start + Number(match[3])));
    let dark = 0;
    for (let offset = 0; offset < rgb.length; offset += 3) {
      if (rgb[offset] < 128 && rgb[offset + 1] < 128 && rgb[offset + 2] < 128) dark += 1;
    }
    pages.push({ width: Number(match[1]), height: Number(match[2]), dark });
  }
  return { count, pages };
}

test('导出 PDF：长文在合理时间内完成，多页且每页有内容', async ({ page }, info) => {
  await openEditor(page);
  const doc = Array.from({ length: SECTIONS }, (_, i) =>
    '## 第 ' + (i + 1) + ' 节' + String.fromCharCode(10) + String.fromCharCode(10) + '第 ' + (i + 1) + ' 段正文，用于验证长文分页导出不会卡死。'
  ).join(String.fromCharCode(10) + String.fromCharCode(10));
  await setSource(page, doc);
  await page.locator('.md-preview').evaluate((el) => el.__awaitPreviewReady());
  const started = Date.now();
  const download = page.waitForEvent('download');
  await clickMenubarItem(page, 'file', '导出 PDF');
  const path = info.outputPath('长文导出.pdf');
  await (await download).saveAs(path);
  const elapsed = Date.now() - started;
  const buffer = readFileSync(path);
  const stats = pageStats(buffer);
  console.log('LONG ' + JSON.stringify({ sections: SECTIONS, seconds: Math.round(elapsed / 1000), pages: stats.count, kb: Math.round(buffer.length / 1024), minDark: Math.min(...stats.pages.map((p) => p.dark)), width: stats.pages[0].width }));
  expect(stats.count).toBeGreaterThan(3);
  expect(stats.pages).toHaveLength(stats.count);
  for (const pageStat of stats.pages) expect(pageStat.dark).toBeGreaterThan(100);
  // 卡死时这一步根本走不到。并发跑全量时耗时会波动，这里只做宽松兜底，
  // 真正的回归信号是「能完成 + 页数与内容正确」（旧实现是数分钟无响应）。
  expect(elapsed).toBeLessThan(240000);
});
