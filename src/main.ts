import { FuzzySuggestModal, MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import type { VaultNote } from "./core";
import { newBoardNote } from "./core";
import { BoardView, VIEW_TYPE } from "./obsidian/view";
import { excerptOf, snapshot } from "./obsidian/vault";

interface Settings { domainPrefix: string; }
const DEFAULTS: Settings = { domainPrefix: "domain/" };

/**
 * 插件入口：注册画板视图；带 skeuo-board 的笔记默认用画板打开；维护整个库的笔记快照，给卡片和卡堆用。
 */
export default class SkeuomorphicCards extends Plugin {
  settings: Settings = DEFAULTS;
  notes = new Map<string, VaultNote>();
  /** 用户点了「用 Markdown 打开」的笔记：下一次打开它时不自动切成画板。 */
  markdownOnce = new Set<string>();
  private excerpts = new Map<string, string>();
  private rebuildTimer = 0;

  async onload() {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.registerView(VIEW_TYPE, (leaf) => new BoardView(leaf, this));

    this.app.workspace.onLayoutReady(() => {
      this.rebuild();
      this.app.workspace.getLeavesOfType("markdown").forEach((l) => this.maybeBoard(l.view as MarkdownView));
    });
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRebuild()));
    this.registerEvent(this.app.metadataCache.on("changed", (f, _data, cache) => {
      this.excerpts.delete(f.path);
      // 画板笔记每挪一次卡就保存一次，它自己不是卡片，不用为它重建整个库的快照。
      if (cache.frontmatter?.["skeuo-board"] && this.notes.get(f.path)?.isBoard) return;
      this.scheduleRebuild();
    }));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRebuild()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRebuild()));
    this.registerEvent(this.app.workspace.on("file-open", () => {
      const v = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (v) this.maybeBoard(v);
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file, _src, leaf) => {
      if (!(file instanceof TFile) || !this.notes.get(file.path)?.isBoard || leaf?.view instanceof BoardView) return;
      menu.addItem((i) => i.setTitle("用画板打开").setIcon("layout-dashboard").onClick(() => {
        void (leaf ?? this.app.workspace.getLeaf()).setViewState({ type: VIEW_TYPE, state: { file: file.path } });
      }));
    }));

    this.addRibbonIcon("layout-dashboard", "新建画板", () => void this.newBoard());
    this.addCommand({ id: "new-board", name: "新建画板", callback: () => void this.newBoard() });
    this.addCommand({
      id: "add-card",
      name: "把笔记放上画板",
      checkCallback: (checking) => {
        const v = this.app.workspace.getActiveViewOfType(BoardView);
        if (!v) return false;
        if (!checking) new AddCardModal(this, v).open();
        return true;
      },
    });
  }

  /** 带 skeuo-board 的笔记用 Markdown 打开时，自动换成画板视图。 */
  private maybeBoard(v: MarkdownView): void {
    const f = v.file;
    if (!f) return;
    if (this.markdownOnce.delete(f.path)) return;
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    if (!fm || !fm["skeuo-board"]) return;
    void v.leaf.setViewState({ type: VIEW_TYPE, state: { file: f.path } });
  }

  private scheduleRebuild(): void {
    window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 300);
  }
  private rebuild(): void {
    this.notes = snapshot(this.app, this.settings.domainPrefix);
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => (l.view as BoardView).notesChanged());
  }

  async excerpt(path: string): Promise<string> {
    if (!this.excerpts.has(path)) this.excerpts.set(path, await excerptOf(this.app, path));
    return this.excerpts.get(path)!;
  }

  /** 新建一块画板：放在当前笔记所在的文件夹（按 Obsidian「新笔记的存放位置」设置），名字不重复。 */
  async newBoard(): Promise<void> {
    const from = this.app.workspace.getActiveFile()?.path ?? "";
    const dir = this.app.fileManager.getNewFileParent(from).path;
    let name = "未命名画板", i = 1;
    const at = (n: string) => normalizePath(`${dir === "/" ? "" : dir + "/"}${n}.md`);
    while (this.app.vault.getAbstractFileByPath(at(name))) name = `未命名画板 ${++i}`;
    const f = await this.app.vault.create(at(name), newBoardNote(name));
    await this.app.workspace.getLeaf(true).setViewState({ type: VIEW_TYPE, state: { file: f.path }, active: true });
    new Notice(`新建了画板「${name}」`);
  }
}

/** 先用搜索把笔记放上画板；第 3 阶段卡堆栏做好以后，这条命令仍然保留，给知道名字的卡用。 */
class AddCardModal extends FuzzySuggestModal<VaultNote> {
  constructor(private plugin: SkeuomorphicCards, private view: BoardView) {
    super(plugin.app);
    this.setPlaceholder("搜索要放上画板的笔记");
  }
  getItems(): VaultNote[] {
    return [...this.plugin.notes.values()].filter((n) => n.domains.length && !n.isBoard && !this.view.canvas.has(n.path));
  }
  getItemText(n: VaultNote): string {
    return `${n.title}  ·  ${n.domains.join(" · ")}`;
  }
  onChooseItem(n: VaultNote): void {
    this.view.canvas.addFiles([n.path], this.view.canvas.center());
  }
}
