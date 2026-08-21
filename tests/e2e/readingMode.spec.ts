import { test, expect, openEditor, setSource } from './fixtures';

// 阅读模式三件套：默认预览、视图记忆、阅读位置记忆 + 版心居中。

test('启动即预览视图（查看型默认），源码隐藏', async ({ page }) => {
  await page.goto('/#editor');
  const main = page.locator('.editor-main');
  await expect(main).toHaveClass(/preview-mode-active/);
  await expect(page.locator('.md-preview h1').first()).toBeVisible();
  await expect(page.locator('.md-source')).toBeHidden();
  // 启动防闪类已被 JS 接管移除（否则后续切换视图会被 boot 规则干扰）
  await expect(page.locator('body')).not.toHaveClass(/boot-preview|boot-editor/);
});

test('预览版心 Typora 式居中：内容有 820px 上限', async ({ page }) => {
  await page.goto('/#editor');
  const maxWidth = await page
    .locator('.md-preview h1')
    .first()
    .evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxWidth).toBe('820px');
});

test('视图模式记忆：切到编辑视图，刷新后仍是编辑视图', async ({ page }) => {
  await page.goto('/#editor');
  await page.locator('[data-menubar-trigger="view"]').click();
  await page.getByRole('menuitem', { name: '编辑视图' }).click();
  await expect(page.locator('.editor-main')).toHaveClass(/editor-mode-active/);

  // setViewMode 切换即持久化，无需输入触发
  await page.waitForFunction((key) => {
    const raw = localStorage.getItem(key);
    return !!raw && JSON.parse(raw).viewMode === 'editor';
  }, 'md-editor-warm-v1');

  await page.reload();
  await expect(page.locator('.editor-main')).toHaveClass(/editor-mode-active/);
});

test('阅读位置记忆：滚动后刷新回到原位', async ({ page }) => {
  await openEditor(page); // 分屏（编辑类路径），预览容器同样存在
  const paragraphs = Array.from({ length: 40 }, (_, i) => '第' + i + '段：内容足够长以撑起滚动高度。').join('\n\n');
  await setSource(page, '# 长文\n\n' + paragraphs);

  // 等自动保存把内容写入 warm 草稿（600ms 防抖）
  await page.waitForFunction((key) => {
    const raw = localStorage.getItem(key);
    return !!raw && JSON.parse(raw).content.includes('第39段');
  }, 'md-editor-warm-v1');

  // 滚动预览并等防抖写入阅读位置
  await page.locator('.md-preview').evaluate((el) => { el.scrollTop = 1200; });
  await page.waitForFunction((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const map = JSON.parse(raw);
    return Object.values(map).some((v) => v && v.top > 500);
  }, 'md-editor-read-pos-v1');

  await page.reload();
  await openEditor(page); // 回到分屏并等待首屏就绪
  await page.waitForFunction(() => {
    const el = document.querySelector('.md-preview');
    return !!el && el.scrollTop > 500;
  });
});