// M1-3 E2E：脚注扩展（[^id] 引用 + [^id]: 定义 + 文末脚注区）在真实预览中的表现。
// 与 tests/unit/footnoteExtension.test.ts 的逐字节断言互补：这里验证
// setSource → 预览 DOM 的整条用户链路（单管线渲染 + DOMPurify 净化后结构仍在）。

import { test, expect, openEditor, setSource } from './fixtures';

test('脚注：引用上标 + 文末脚注区 + 回链锚点', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '正文[^1]。\n\n[^1]: 注释内容');

  // 引用 → <sup class="footnote-ref">，锚点 id = fnref-<id>-<序号>
  await expect(page.locator('.md-preview sup.footnote-ref')).toHaveText('1');
  await expect(page.locator('.md-preview .footnote-ref a')).toHaveAttribute('id', 'fnref-1-1');
  await expect(page.locator('.md-preview .footnote-ref a')).toHaveAttribute('href', '#fn-1');
  // 脚注区在文末（.md-preview 的最后一个块），条目 id = fn-<id>
  const section = page.locator('.md-preview > section.footnotes');
  await expect(section).toBeAttached();
  await expect(page.locator('.md-preview > section.footnotes:last-child')).toBeAttached();
  await expect(section.locator('ol > li')).toContainText('注释内容');
  await expect(section.locator('li')).toHaveAttribute('id', 'fn-1');
  // 回链 href 指向引用锚点
  await expect(section.locator('.footnote-backref')).toHaveAttribute('href', '#fnref-1-1');
});

test('重复引用：共用条目 + 独立回链 fnref-<id>-<序号>', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '前[^1]中[^1]后[^1]\n\n[^1]: 同一注释');

  await expect(page.locator('.md-preview sup.footnote-ref')).toHaveCount(3);
  await expect(page.locator('.md-preview .footnote-ref a#fnref-1-1')).toHaveCount(1);
  await expect(page.locator('.md-preview .footnote-ref a#fnref-1-2')).toHaveCount(1);
  await expect(page.locator('.md-preview .footnote-ref a#fnref-1-3')).toHaveCount(1);
  // 共用一条目，三条回链
  await expect(page.locator('.md-preview .footnotes li')).toHaveCount(1);
  await expect(page.locator('.md-preview .footnote-backref')).toHaveCount(3);
  await expect(page.locator('.md-preview .footnote-backref[href="#fnref-1-1"]')).toHaveCount(1);
  await expect(page.locator('.md-preview .footnote-backref[href="#fnref-1-2"]')).toHaveCount(1);
  await expect(page.locator('.md-preview .footnote-backref[href="#fnref-1-3"]')).toHaveCount(1);
});

test('[^1](url) 仍为普通链接，不触发脚注', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '见[^1](https://example.com)');

  await expect(page.locator('.md-preview a[href="https://example.com"]')).toHaveText('^1');
  await expect(page.locator('.md-preview sup.footnote-ref')).toHaveCount(0);
  await expect(page.locator('.md-preview section.footnotes')).toHaveCount(0);
});

test('未定义引用保持字面文本', async ({ page }) => {
  await openEditor(page);
  await setSource(page, 'x[^1] y');

  await expect(page.locator('.md-preview p')).toHaveText('x[^1] y');
  await expect(page.locator('.md-preview section.footnotes')).toHaveCount(0);
});

test('代码围栏内 [^id]: 与 [^id] 不触发；围栏外正常', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '```\n[^1]: 围栏内\n[^1]\n```\n\n正文[^1]\n\n[^1]: 真定义');

  await expect(page.locator('.md-preview pre code')).toContainText('[^1]: 围栏内');
  await expect(page.locator('.md-preview sup.footnote-ref')).toHaveCount(1);
  await expect(page.locator('.md-preview section.footnotes')).toContainText('真定义');
});

test('多行定义与定义体内的列表按 Markdown 渲染', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '[^l]: 列表脚注\n    - a\n    - b\n\n正文[^l]');

  await expect(page.locator('.md-preview .footnotes ul li')).toHaveText(['a', 'b']);
  await expect(page.locator('.md-preview .footnotes > ol > li')).toContainText('列表脚注');
});
