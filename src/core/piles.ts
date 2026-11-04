import type { NoteType, Pile, VaultNote } from "./types";

/** 兼容闪念笔记的旧名称，无法识别的值统一归入未分类。 */
export function noteTypeOf(fmType: unknown): NoteType {
  if (typeof fmType !== "string") return "uncategorized";
  switch (fmType.trim().toLowerCase()) {
    case "literature":
      return "literature";
    case "permanent":
      return "permanent";
    case "fleeting":
    case "flash":
    case "闪念":
      return "fleeting";
    default:
      return "uncategorized";
  }
}

/** 领域前缀忽略大小写，领域名称保留用户写法与首次出现的顺序。 */
export function domainsOf(tags: string[], prefix = "domain/"): string[] {
  const domains = new Set<string>();
  const normalizedPrefix = prefix.toLowerCase();
  for (const tag of tags) {
    const bare = tag.replace(/^#/u, "");
    if (!bare.toLowerCase().startsWith(normalizedPrefix)) continue;
    const domain = bare.slice(prefix.length);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

/** 一张卡片可以属于多个领域，但在同一卡堆只出现一次。 */
export function buildPiles(notes: VaultNote[]): Pile[] {
  const piles = new Map<string, Pile>();
  for (const note of notes) {
    if (note.isBoard) continue;
    for (const domain of new Set(note.domains)) {
      let pile = piles.get(domain);
      if (!pile) {
        pile = { name: domain, count: 0, cards: [] };
        piles.set(domain, pile);
      }
      pile.cards.push(note);
      pile.count++;
    }
  }
  for (const pile of piles.values()) {
    pile.cards.sort((a, b) => a.title.localeCompare(b.title, "zh"));
  }
  return [...piles.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"),
  );
}

/** 只拆分约定的日期与笔记类型前缀，其他标题完整保留。 */
export function splitTitle(title: string): { prefix: string; title: string } {
  const match = title.match(/^(\d{8}_[^_]+_)(.+)$/u);
  return match
    ? { prefix: match[1].slice(0, -1).replace(/_/gu, " · "), title: match[2] }
    : { prefix: "", title };
}
