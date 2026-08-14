import { test, expect, openEditor, setSource } from './fixtures';

// M4 浏览器可测项：四项统计、最近文档列表、拖入 .md（浏览器路径）、跨文件搜索提示。
// 桌面专属（搜索执行/窗口状态/关闭确认/外链）由 Rust 测试与 PLATFORM_TEST.md 覆盖。

test('四项统计口径（B22）：字数/字符/行/段落', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '你好 world\n\n第二段');
  await expect(page.locator('.word-count')).toHaveText('6 字 · 10 字符 · 3 行 · 2 段');
});

test('最近文档：侧边栏入口打开浮层，空态与列表渲染（B17）', async ({ page }) => {
  await openEditor(page);
  const openRecent = async () => {
    await page.evaluate(() => {
      const sb = document.querySelector('.document-sidebar');
      if (sb) {
        sb.classList.remove('is-collapsed');
        sb.classList.add('is-mobile-open');
      }
      const tab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement | null;
      tab?.click();
    });
    await page.locator('.sidebar-file-actions').getByRole('menuitem', { name: '最近文档' }).click();
  };
  // 空态
  await openRecent();
  await expect(page.locator('.recent-menu .recent-empty')).toBeVisible();
  // 注入记录后重开（先关闭再打开）
  await page.evaluate(() => {
    localStorage.setItem('md-editor-recent-documents', JSON.stringify([
      { path: 'C:\\docs\\a.md', name: 'a.md', at: 1 },
      { path: 'C:\\docs\\b.md', name: 'b.md', at: 2 }
    ]));
  });
  await page.locator('.md-preview').click({ position: { x: 10, y: 10 } }); // 外部点击关闭
  await openRecent();
  await expect(page.locator('.recent-item')).toHaveCount(2);
  await expect(page.locator('.recent-item').first()).toHaveText('a.md');
});

test('浏览器端拖入 .md 打开内容（D 的浏览器路径）', async ({ page }) => {
  await openEditor(page);
  await setSource(page, '旧内容');

  await page.locator('.md-source').evaluate((el) => {
    const file = new File(['# 拖入的文档\n\n内容'], 'dragged.md', { type: 'text/markdown' });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('.md-source')).toHaveValue('# 拖入的文档\n\n内容');
  await expect(page.locator('.md-preview h1')).toHaveText('拖入的文档');
});

test('跨文件搜索：浏览器端给出桌面端提示（P7 接线）', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: '文件树' }).click();
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);
});

test('快速打开：浏览器端给出桌面端提示（B17）', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    const sb = document.querySelector('.document-sidebar');
    if (sb) {
      sb.classList.remove('is-collapsed');
      sb.classList.add('is-mobile-open');
    }
    const tab = document.querySelector('[data-sidebar-tab="files"]') as HTMLElement | null;
    tab?.click();
  });
  await page.locator('.sidebar-file-actions').getByRole('menuitem', { name: /快速打开/ }).click();
  await expect(page.locator('.save-status')).toHaveText(/桌面端环境/);
});
