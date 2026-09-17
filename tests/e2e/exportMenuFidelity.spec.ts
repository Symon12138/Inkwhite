import { test, expect, openEditor, setSource, clickMenubarItem } from './fixtures';
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

const ARTICLE = ['# 飞白导出样例', '', '正文 **加粗** *斜体* <u>下划线</u> ~~删除~~ ==高亮== H~2~O x^2^。', '', '> 引用段落', '', '- 一级列表', '  - 二级列表', '', '| 项目 | 说明 |', '|---|---|', '| 字体 | 与预览一致 |', '', '~~~js', 'const message = "Hello 飞白";', '~~~', '', '[外链](https://example.com)', '', '$E=mc^2$', '', '~~~mermaid', 'graph TD; A[编辑]-->B[导出];', '~~~'].join(String.fromCharCode(10));

test('实际菜单导出 HTML、Word、PDF 样例并校验内容和样式', async ({ page, context }, info) => {
  await openEditor(page);
  await setSource(page, ARTICLE);
  await page.locator('.font-select').selectOption('songti');
  await page.getByRole('button', { name: '放大正文字号', exact: true }).click();
  await clickMenubarItem(page, 'view', '预览视图');
  await page.locator('.md-preview').evaluate(el => el.__awaitPreviewReady());
  const bodySize = await page.locator('.md-preview p').first().evaluate(el => getComputedStyle(el).fontSize);
  const htmlDownload = page.waitForEvent('download');
  await clickMenubarItem(page, 'file', '导出 HTML');
  const htmlPath = info.outputPath('飞白导出样例.html');
  await (await htmlDownload).saveAs(htmlPath);
  const reopened = await context.newPage();
  await reopened.setContent(readFileSync(htmlPath, 'utf8'));
  await expect(reopened.locator('.md-preview h1')).toHaveText('飞白导出样例');
  await expect(reopened.locator('.md-preview p').first()).toHaveCSS('font-size', bodySize);
  await expect(reopened.locator('.md-preview u')).toHaveText('下划线');
  await expect(reopened.locator('.code-copy-btn')).toHaveCount(0);
  await reopened.close();
  const wordDownload = page.waitForEvent('download');
  await clickMenubarItem(page, 'file', '导出 Word');
  const wordPath = info.outputPath('飞白导出样例.docx');
  await (await wordDownload).saveAs(wordPath);
  const zip = await JSZip.loadAsync(readFileSync(wordPath));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('下划线');
  expect(xml).toContain('w:u');
  expect(xml).toContain('w:strike');
  expect(xml).toContain('w:sz w:val="' + Math.round(parseFloat(bodySize) * 1.5) + '"');
  expect(xml).toContain('Songti SC');
  expect(xml).not.toContain('w:pStyle w:val="Title"');
  expect(xml).not.toContain('复制');
  const media = Object.values(zip.files).filter(file => file.name.startsWith('word/media/') && file.name.endsWith('.png'));
  expect(media).toHaveLength(2);
  for (let index = 0; index < media.length; index++) {
    const bytes = await media[index].async('nodebuffer');
    writeFileSync(info.outputPath('Word内嵌图片-' + (index + 1) + '.png'), bytes);
    const ink = await page.evaluate(async base64 => {
      const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 180 && pixels[i + 3] > 128) ink++;
      return ink;
    }, bytes.toString('base64'));
    expect(ink, '实际 docx 包内图片不可空白').toBeGreaterThan(100);
  }
  await clickMenubarItem(page, 'theme', '设置');
  await page.getByRole('radio', { name: '跟随预览' }).check();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.print = () => { document.body.dataset.printInvoked = 'true'; }; });
  await clickMenubarItem(page, 'file', '导出 PDF');
  await expect(page.locator('body')).toHaveAttribute('data-print-invoked', 'true');
  await page.pdf({ path: info.outputPath('飞白导出样例.pdf'), format: 'A4', printBackground: true });
});
