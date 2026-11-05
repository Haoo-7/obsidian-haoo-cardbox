import { App, TFile } from "obsidian";
import { domainsOf, isBoardNote, noteTypeOf } from "../core";
import type { VaultNote } from "../core";

/** frontmatter 里的值转成一行文字：字符串、数字、布尔直接用，数组按项拼起来，对象不认识。 */
const str = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim() || undefined;
  if (Array.isArray(v)) {
    const parts = (v as unknown[]).map(str).filter((s): s is string => !!s);
    return parts.length ? parts.join(", ") : undefined;
  }
  return undefined;
};

/** 用 metadataCache 拼出整个库的笔记快照：标题、类型、领域、日期、作者、来源。不读正文，所以很快。 */
export function snapshot(app: App, prefix: string): Map<string, VaultNote> {
  const out = new Map<string, VaultNote>();
  for (const f of app.vault.getMarkdownFiles()) {
    const cache = app.metadataCache.getFileCache(f);
    const fm = cache?.frontmatter;
    const tags: string[] = [];
    const ft: unknown = fm?.tags;
    if (Array.isArray(ft)) {
      for (const t of ft as unknown[]) if (typeof t === "string" || typeof t === "number") tags.push(String(t));
    } else if (typeof ft === "string") tags.push(...ft.split(/[,\s]+/));
    cache?.tags?.forEach((t) => tags.push(t.tag));
    out.set(f.path, {
      path: f.path,
      title: f.basename,
      type: noteTypeOf(fm?.type),
      domains: domainsOf(tags, prefix),
      date: str(fm?.date),
      author: str(fm?.author),
      source: str(fm?.source)?.replace(/^\[\[|\]\]$/g, ""),
      isBoard: isBoardNote(fm),
    });
  }
  return out;
}

/** 卡片背面的正文开头：去掉 frontmatter、标题行、Markdown 记号，取前 90 个字。 */
export async function excerptOf(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return "";
  const raw = await app.vault.cachedRead(f);
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\^[^\]]*\]:?/g, "") // 脚注记号
    .replace(/^#+ .*$|^\s*[-*>]+\s*|^\s*\d+\.\s*|[#*`_=|]|%%[\s\S]*?%%/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}
