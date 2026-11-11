import { test, expect, openEditor } from './fixtures';

// 回归：框架换皮（Inter + DeepSeek 蓝）不影响阅读纸面的楷体与纸色。
test('框架 UI 用 Inter、强调为 DeepSeek 蓝，阅读区仍用楷体纸面', async ({ page }) => {
  await openEditor(page);
  const r = await page.evaluate(() => {
    const cs = (s: string) => getComputedStyle(document.querySelector(s)!);
    return {
      shellFont: cs('.menubar-trigger').fontFamily,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      paperFont: cs('.md-preview').fontFamily,
      paperAccent: getComputedStyle(document.documentElement).getPropertyValue('--paper-accent').trim()
    };
  });
  expect(r.shellFont).toContain('Inter');
  expect(r.accent).toBe('#4d92fe');
  expect(r.paperFont).toContain('Canger');
  expect(r.paperAccent).toBe('#4d92fe');
});
