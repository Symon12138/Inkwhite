// 样式表遍历原语：从 longImageComposer.ts 的私有 forEachStyleRule 抽取而来。
// 长图海报抽取（extractPosterCss）与 HTML 导出抽取（extractExportCss）需要同一份
// 「只收普通样式规则」语义，抽成共享模块避免两处实现漂移。
//
// 迁移说明：longImageComposer.ts 当前仍持有私有副本——WP8b 约束「不改既有模块」，
// 因此本模块先服务导出侧；待 M1/M2 允许改动时，删除其私有副本改为 import 本模块，
// 行为不变（遍历逻辑逐行一致，已有单测 longImageComposer.test.ts 可回归验证）。

export type StyleRuleVisitor = (rule: { selectorText: string; style: CSSStyleDeclaration }) => void;

// 只收普通样式规则：@media 一律跳过（自包含导出不需要响应式断点；@media print
// 也随之排除——打印样式属于宿主页面，不进导出物），@keyframes / @font-face 同理
// （字体面由消费方经 fontsCss 单独注入）。
export function forEachStyleRule(
  sheets: ArrayLike<CSSStyleSheet> | null | undefined,
  visit: StyleRuleVisitor
): void {
  for (const sheet of Array.from(sheets || [])) {
    let rules: ArrayLike<CSSRule> | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨源样式表读 cssRules 会抛，跳过即可
    }
    for (const rule of Array.from(rules || [])) {
      const candidate = rule as unknown as { selectorText?: string; style?: CSSStyleDeclaration };
      if (candidate.selectorText && candidate.style) {
        visit({ selectorText: candidate.selectorText, style: candidate.style });
      }
    }
  }
}
