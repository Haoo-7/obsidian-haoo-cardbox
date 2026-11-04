import { TAbstractFile, TFile, TFolder } from "obsidian";
import { buildMoc, isBoardNote, markMissing, parseBoardNote, relink, renameFile, serializeBoardNote } from "../core";
import type { BoardData } from "../core";
import type HaooCardbox from "../main";
import { BoardView, VIEW_TYPE } from "./view";

/** 画板上的卡怎么跟着库里的一次改动走。nodes 以外的字段原样不动。 */
type Op =
  | { kind: "rename"; from: string; to: string; folder: boolean }
  | { kind: "delete"; path: string; folder: boolean }
  | { kind: "create"; path: string };

const under = (path: string, dir: string) => path.startsWith(`${dir}/`);

function step(d: BoardData, op: Op): BoardData {
  if (op.kind === "rename") {
    if (!op.folder) return restore(renameFile(d, op.from, op.to), op.to);
    let out = d;
    for (const n of d.nodes) if (under(n.file, op.from)) out = renameFile(out, n.file, op.to + n.file.slice(op.from.length));
    return out;
  }
  if (op.kind === "delete") {
    if (!op.folder) return markMissing(d, op.path);
    let out = d;
    for (const n of d.nodes) if (under(n.file, op.path)) out = markMissing(out, n.file);
    return out;
  }
  return restore(d, op.path);
}
/** 一篇笔记又出现在缺失卡片原来的路径上（撤销删除、同步回来）：卡片恢复正常。 */
function restore(d: BoardData, path: string): BoardData {
  let out = d;
  for (const n of d.nodes) if (n.missing && n.file === path) out = relink(out, n.id, path);
  return out;
}
/** 只有提到这些路径的画板才值得读出来解析。路径按数据块里的 JSON 写法比较。 */
function mentions(text: string, op: Op): boolean {
  const p = op.kind === "rename" ? op.from : op.path;
  return text.includes(JSON.stringify(p).slice(1, -1));
}

/**
 * 改名、删除跟随：数据块里存的是路径不是 wikilink，Obsidian 不会替我们改，所以每次库里有笔记改名、删除，
 * 都把所有画板笔记里指向它的卡改过来。改名：卡片换成新路径，连线不变。删除：卡片标成缺失，连线保留。
 * 打开着的画板直接改视图里的数据（连撤销历史一起改），没打开的画板改笔记原文。
 * 事件先攒一下再一起处理：改名文件夹时，Obsidian 会给里面每篇笔记各发一次事件。
 */
export class Follow {
  private ops: Op[] = [];
  private timer = 0;

  constructor(private plugin: HaooCardbox) {}

  rename(f: TAbstractFile, from: string): void {
    if (f instanceof TFolder || f.path.endsWith(".md")) this.push({ kind: "rename", from, to: f.path, folder: f instanceof TFolder });
  }
  delete(f: TAbstractFile): void {
    if (f instanceof TFolder || f.path.endsWith(".md")) this.push({ kind: "delete", path: f.path, folder: f instanceof TFolder });
  }
  create(f: TAbstractFile): void {
    if (f instanceof TFile && f.extension === "md") this.push({ kind: "create", path: f.path });
  }

  private push(op: Op): void {
    this.ops.push(op);
    window.clearTimeout(this.timer);
    // 等 Obsidian 先把别的笔记里的链接改完、元数据缓存更新完，再动画板。
    this.timer = window.setTimeout(() => void this.flush(), 500);
  }

  private async flush(): Promise<void> {
    const ops = this.ops;
    this.ops = [];
    if (!ops.length) return;
    const apply = (d: BoardData) => ops.reduce(step, d);
    const { app } = this.plugin;
    const open = new Set<string>();
    for (const l of app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const v = l.view as BoardView;
      if (v.file && v.applyEdit(apply)) open.add(v.file.path);
    }
    for (const f of app.vault.getMarkdownFiles()) {
      if (open.has(f.path) || !isBoardNote(app.metadataCache.getFileCache(f)?.frontmatter)) continue;
      const text = await app.vault.cachedRead(f);
      if (!ops.some((op) => mentions(text, op))) continue;
      await app.vault.process(f, (raw) => {
        try {
          const parsed = parseBoardNote(raw);
          const before = JSON.stringify(parsed.data.nodes);
          parsed.data = apply(parsed.data);
          if (JSON.stringify(parsed.data.nodes) === before) return raw;
          return serializeBoardNote(parsed, buildMoc(parsed.data, (p) => this.plugin.linkOf(p, f.path)));
        } catch {
          return raw; // 读坏了的画板原样留着，打开时会提示
        }
      });
    }
  }
}
