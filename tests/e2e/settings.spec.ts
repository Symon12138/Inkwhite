import { test, expect, openEditor, setSource } from './fixtures';

const SETTINGS_KEY = 'md-editor-settings-v1';
const DRAFT_KEY = 'md-editor-warm-v1';

// M2-SETTINGS：面板入口按钮由 M2-UI 统一接线；E2E 经 MarkdownEditorLogic 在
// 源码 textarea 上暴露的 `_mdEditor` 钩子调用组件方法驱动面板。
// 用 expect.poll 重试：页面若被外部因素整页重载（Vite 文件监听触发 full-reload），
// 重新引导完成后钩子会重新挂上、面板可重新打开，测试不受瞬时重载影响。
async function openSettingsPanel(page: import('@playwright/test').Page) {
  await expect.poll(async () => {
    const opened = await page.evaluate(() => {
      const source = document.querySelector('.md-source') as (HTMLTextAreaElement & { _mdEditor?: unknown }) | null;
      const editor = source?._mdEditor as { openSettings?: () => void } | undefined;
      if (!editor?.openSettings) return false;
      editor.openSettings();
      const overlay = document.querySelector('.settings-overlay') as HTMLElement | null;
      return !!overlay && overlay.style.display === 'flex';
    });
    return opened;
  }, { timeout: 15_000 }).toBe(true);
}

async function closeSettingsPanel(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const source = document.querySelector('.md-source') as (HTMLTextAreaElement & { _mdEditor?: unknown }) | null;
    const editor = source?._mdEditor as { closeSettings?: () => void } | undefined;
    editor?.closeSettings();
  });
  await expect(page.locator('.settings-overlay')).toBeHidden();
}

test('默认设置：拼写检查开启（B21），textarea 与预览的 spellcheck 属性为 true', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('.md-source')).toHaveAttribute('spellcheck', 'true');
  await expect(page.locator('.md-preview')).toHaveAttribute('spellcheck', 'true');
});

test('打开面板→修改全部设置→刷新后保持', async ({ page }) => {
  await openEditor(page);
  await openSettingsPanel(page);

  await page.locator('[data-settings-key="spellcheck"]').uncheck();
  await page.locator('[data-settings-key="autosave"]').uncheck();
  await page.locator('[data-settings-key="exportPageMargin"]').fill('18mm 20mm');
  await page.locator('[data-settings-key="exportPageMargin"]').press('Tab'); // 提交 change
  await page.getByRole('radio', { name: '跟随预览' }).check();

  // 变更即写 localStorage
  await page.waitForFunction(([key]) => {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const s = JSON.parse(raw);
    return s.spellcheck === false && s.autosave === false
      && s.exportPageMargin === '18mm 20mm' && s.printPaper === 'follow-preview';
  }, [SETTINGS_KEY]);

  // 应用即时生效
  await expect(page.locator('.md-source')).toHaveAttribute('spellcheck', 'false');

  await page.reload();
  // 刷新后保持：属性与面板状态都按设置恢复
  await expect(page.locator('.md-source')).toHaveAttribute('spellcheck', 'false');

  await openSettingsPanel(page);
  await expect(page.locator('[data-settings-key="spellcheck"]')).not.toBeChecked();
  await expect(page.locator('[data-settings-key="autosave"]')).not.toBeChecked();
  await expect(page.locator('[data-settings-key="exportPageMargin"]')).toHaveValue('18mm 20mm');
  await expect(page.getByRole('radio', { name: '跟随预览' })).toBeChecked();
});

test('关闭自动保存后编辑→刷新→草稿仍在（B19 不丢稿）', async ({ page }) => {
  await openEditor(page);
  await openSettingsPanel(page);
  await page.locator('[data-settings-key="autosave"]').uncheck();
  await expect(page.locator('[data-settings-key="autosave"]')).not.toBeChecked();
  await closeSettingsPanel(page);

  const content = '# 不丢稿\n\n自动保存关闭后，草稿仍要活着。';
  await setSource(page, content);

  // localStorage 草稿保底：_persist 不受 autosave 设置影响（自动保存 600ms 防抖）
  await page.waitForFunction(([key, text]) => {
    const raw = localStorage.getItem(key);
    return !!raw && JSON.parse(raw).content.includes(text);
  }, [DRAFT_KEY, '自动保存关闭后']);

  await page.reload();
  await expect(page.locator('.md-source')).toHaveValue(content);

  // 设置本身也保持关闭
  await openSettingsPanel(page);
  await expect(page.locator('[data-settings-key="autosave"]')).not.toBeChecked();
});

test('Esc 与遮罩点击都能关闭面板', async ({ page }) => {
  await openEditor(page);
  await openSettingsPanel(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('.settings-overlay')).toBeHidden();

  await openSettingsPanel(page);
  // 点击遮罩（模态面板之外）关闭
  await page.locator('.settings-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.settings-overlay')).toBeHidden();
});
