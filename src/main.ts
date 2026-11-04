import { App, FuzzySuggestModal, MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import type { Pile, Swatch, VaultNote } from "./core";
import { SWATCHES, buildPiles, newBoardNote } from "./core";
import { Follow } from "./obsidian/follow";
import { SettingsTab } from "./obsidian/settings";
import { BoardView, VIEW_TYPE } from "./obsidian/view";
import { excerptOf, snapshot } from "./obsidian/vault";

export interface Settings {
  domainPrefix: string;
  /** 所有文件夹的默认颜色；null = 跟着主题（浅色雾白，深色石墨）。 */
  folderColor: string | null;
  /** 单独换过色的文件夹：卡堆名 → 颜色。 */
  folderColors: Record<string, string>;
}
const DEFAULTS: Settings = { domainPrefix: "domain/", folderColor: null, folderColors: {} };

/**
 * 插件入口：注册画板视图；带 skeuo-board 的笔记默认用画板打开；维护整个库的笔记快照，给卡片和卡堆用。
 */
export default class HaooCardbox extends Plugin {
  settings: Settings = DEFAULTS;
  notes = new Map<string, VaultNote>();
  /** 用户点了「用 Markdown 打开」的笔记：下一次打开它时不自动切成画板。 */
  markdownOnce = new Set<string>();
  private excerpts = new Map<string, string>();
  private pileCache: Pile[] | null = null;
  private rebuildTimer = 0;
  private follow = new Follow(this);

  async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    this.settings = { ...DEFAULTS, ...saved, folderColors: { ...saved?.folderColors } };
    this.registerView(VIEW_TYPE, (leaf) => new BoardView(leaf, this));
    // 悬停卡片预览原笔记：和别处一样，按住 ⌘ / Ctrl 悬停才弹出，可以在「页面预览」的设置里改。
    this.registerHoverLinkSource(VIEW_TYPE, { display: "Haoo Cardbox", defaultMod: true });
    this.addSettingTab(new SettingsTab(this));

    this.app.workspace.onLayoutReady(() => {
      this.rebuild();
      this.app.workspace.getLeavesOfType("markdown").forEach((l) => this.maybeBoard(l.view as MarkdownView));
      // 启动时 Obsidian 会给每篇笔记各发一次 create，等布局好了再听。
      this.registerEvent(this.app.vault.on("create", (f) => this.follow.create(f)));
    });
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRebuild()));
    this.registerEvent(this.app.metadataCache.on("changed", (f, _data, cache) => {
      this.excerpts.delete(f.path);
      // 画板笔记每挪一次卡就保存一次，它自己不是卡片，不用为它重建整个库的快照。
      if (cache.frontmatter?.["skeuo-board"] && this.notes.get(f.path)?.isBoard) return;
      this.scheduleRebuild();
    }));
    this.registerEvent(this.app.vault.on("delete", (f) => { this.excerpts.delete(f.path); this.follow.delete(f); this.scheduleRebuild(); }));
    this.registerEvent(this.app.vault.on("rename", (f, from) => { this.excerpts.delete(from); this.follow.rename(f, from); this.scheduleRebuild(); }));
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

    // 换主题时，跟着主题走的文件夹颜色要换一遍。
    this.registerEvent(this.app.workspace.on("css-change", () => this.repaint()));

    this.addRibbonIcon("layout-dashboard", "新建画板", () => void this.newBoard());
    this.addCommand({ id: "new-board", name: "新建画板", callback: () => void this.newBoard() });
    this.addCommand({
      id: "add-card",
      name: "把笔记放上画板",
      checkCallback: (checking) => {
        const v = this.app.workspace.getActiveViewOfType(BoardView);
        if (!v) return false;
        if (!checking) this.addCard(v);
        return true;
      },
    });
    this.addCommand({
      id: "export-canvas",
      name: "把画板导出为 .canvas",
      checkCallback: (checking) => {
        const v = this.app.workspace.getActiveViewOfType(BoardView);
        if (!v?.canvas.root.isShown()) return false;
        if (!checking) void v.exportCanvas();
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

  /** 设置里改了领域前缀：卡堆整个重算。 */
  async setPrefix(v: string): Promise<void> {
    this.settings.domainPrefix = v.trim().replace(/^#/, "") || DEFAULTS.domainPrefix;
    await this.saveData(this.settings);
    this.scheduleRebuild();
  }

  scheduleRebuild(): void {
    window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 300);
  }
  private rebuild(): void {
    this.notes = snapshot(this.app, this.settings.domainPrefix);
    this.pileCache = null;
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => (l.view as BoardView).notesChanged());
  }

  piles(): Pile[] {
    return (this.pileCache ??= buildPiles([...this.notes.values()]));
  }

  swatch(pile: string): Swatch {
    const dark = document.body.hasClass("theme-dark");
    const id = this.settings.folderColors[pile] ?? this.settings.folderColor ?? (dark ? "graphite" : "mist");
    return SWATCHES.find((s) => s.id === id) ?? SWATCHES[1];
  }
  async setFolderColor(pile: string, id: string | null): Promise<void> {
    if (id) this.settings.folderColors[pile] = id;
    else delete this.settings.folderColors[pile];
    await this.saveData(this.settings);
    this.repaint();
  }
  /** 所有文件夹统一换成这种颜色（null = 跟着主题）。keep：设置页里只改默认，不动单独换过的。 */
  async setDefaultColor(id: string | null, keep = false): Promise<void> {
    this.settings.folderColor = id;
    if (!keep) this.settings.folderColors = {};
    await this.saveData(this.settings);
    this.repaint();
  }
  private repaint(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => (l.view as BoardView).shelf?.paint());
  }

  /** 卡片：带领域标签、本身不是画板的笔记。 */
  cards(): VaultNote[] {
    return [...this.notes.values()].filter((n) => n.domains.length && !n.isBoard);
  }
  /** 搜一篇笔记：放上画板、给缺失卡片重新指向都用它。 */
  pick(placeholder: string, ok: (n: VaultNote) => boolean, choose: (n: VaultNote) => void, from = this.cards()): void {
    new NotePicker(this.app, placeholder, from.filter(ok), choose).open();
  }
  addCard(v: BoardView, pile?: Pile): void {
    const from = pile ? pile.cards.filter((n) => !n.isBoard) : this.cards();
    this.pick(pile ? `在「${pile.name}」里搜索` : "搜索要放上画板的笔记", (n) => !v.canvas.has(n.path), (n) => v.canvas.addFiles([n.path], v.canvas.center()), from);
  }
  /** 一堆卡太多、散开放不下时：在这一堆里搜，选中的放到画板正中间。 */
  pickFrom(view: BoardView, pile: Pile): void {
    this.addCard(view, pile);
  }

  /** MOC 正文里的链接，按用户在 Obsidian 里的链接格式设置生成。 */
  linkOf(path: string, from: string): string {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) return this.app.fileManager.generateMarkdownLink(f, from);
    return `[[${path.replace(/\.md$/, "")}]]`;
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

/** 按标题和领域搜一篇笔记。 */
class NotePicker extends FuzzySuggestModal<VaultNote> {
  constructor(app: App, placeholder: string, private items: VaultNote[], private choose: (n: VaultNote) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): VaultNote[] {
    return this.items;
  }
  getItemText(n: VaultNote): string {
    return `${n.title}  ·  ${n.domains.join(" · ")}`;
  }
  onChooseItem(n: VaultNote): void {
    this.choose(n);
  }
}
