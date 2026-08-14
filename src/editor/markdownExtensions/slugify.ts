// M1-1 定稿：标题 slug 纯函数（自 viewMethods._outlineSlug 抽取，行为逐字节一致，
// 由 tests/unit/markdownExtensionRegistry.test.ts 的 outlineSlug 用例固化）。
// 大纲渲染（viewMethods._renderOutline）与 TOC 扩展（M1-5）共用。

/**
 * 生成大纲锚点 id：文本归一（小写、剥离非字母/数字/空白/_- 的符号、空白转连字符、
 * 去首尾连字符），空结果回退 'section-N'；统一加 'outline-' 前缀，重复标题递增后缀。
 * used 集合用于去重（调用方维护，跨标题累积）。
 */
export function outlineSlug(text: string | null | undefined, index: number, used: Set<string>): string {
  const base = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section-' + (index + 1);
  let value = 'outline-' + base;
  let suffix = 2;
  while (used.has(value)) value = 'outline-' + base + '-' + suffix++;
  used.add(value);
  return value;
}
