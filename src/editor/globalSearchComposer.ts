// M4-P7：跨文件搜索纯逻辑（结果分组/排序/上限），node 可单测。

export interface SearchHitLike {
  path: string;
  name: string;
  line: string;
  lineNumber: number;
}

export interface GroupedHits {
  path: string;
  name: string;
  hits: SearchHitLike[];
}

/** 按路径分组（保持首次出现顺序），组内按行号排序。 */
export function groupHits(hits: SearchHitLike[]): GroupedHits[] {
  const groups = new Map<string, GroupedHits>();
  for (const hit of hits) {
    let group = groups.get(hit.path);
    if (!group) {
      group = { path: hit.path, name: hit.name, hits: [] };
      groups.set(hit.path, group);
    }
    group.hits.push(hit);
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.hits.sort((a, b) => a.lineNumber - b.lineNumber);
  }
  return result;
}

/** 按文件名/路径关键词过滤命中（快速打开预筛用）。 */
export function filterHitsByQuery(hits: SearchHitLike[], query: string): SearchHitLike[] {
  const needle = (query || '').trim().toLowerCase();
  if (!needle) return hits;
  return hits.filter((hit) =>
    hit.name.toLowerCase().includes(needle) || hit.path.toLowerCase().includes(needle)
  );
}

/** 截断到上限并标记。 */
export function truncateHits(hits: SearchHitLike[], max: number): { hits: SearchHitLike[]; truncated: boolean } {
  if (hits.length <= max) return { hits, truncated: false };
  return { hits: hits.slice(0, max), truncated: true };
}

/** 命中行展示：裁到可视宽度（前后各保留上下文，超宽加省略号）。 */
export function formatHitLine(line: string, maxLength = 80): string {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength - 1) + '…';
}
