import { Menu, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { BoardParseError, buildMoc, History, parseBoardNote, serializeBoardNote } from "../core";
import type { ParsedBoardNote } from "../core";
import { BoardCanvas } from "../ui/canvas";
import { Shelf } from "../ui/shelf";
import type SkeuomorphicCards from "../main";

export const VIEW_TYPE = "skeuo-board";

/**
 * 画板视图。Obsidian 负责读盘、写盘、外部改动时重载；这里只管「笔记全文 ⇄ 画板」的来回。
 * 撤销历史只记卡片、连线、标注，不记视口：平移缩放不该被 ⌘Z 撤回去。
 */
export class BoardView extends TextFileView {
  canvas!: BoardCanvas;
  shelf!: Shelf;
  private parsed: ParsedBoardNote | null = null;
  private broken: string | null = null;
  private history = new History();

  constructor(leaf: WorkspaceLeaf, readonly plugin: SkeuomorphicCards) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file?.basename ?? "画板"; }
  getIcon() { return "layout-dashboard"; }

  async onOpen() {
    this.contentEl.addClass("sk-view");
    this.contentEl.tabIndex = -1; // 能接住焦点，Esc 才能收起散开的卡堆
    this.canvas = new BoardCanvas(this.contentEl, {
      note: (p) => this.plugin.notes.get(p),
      excerpt: (p) => this.plugin.excerpt(p),
      open: (p, split) => void this.app.workspace.openLinkText(p, this.file?.path ?? "", split ? "split" : false),
      hover: (e, p, el) => this.app.workspace.trigger("hover-link", { event: e, source: VIEW_TYPE, hoverParent: this, targetEl: el, linktext: p, sourcePath: this.file?.path ?? "" }),
      changed: () => { this.history.commit(this.doc()); this.requestSave(); this.shelf.refreshOn(); },
      viewChanged: () => this.requestSave(),
    });
    this.shelf = new Shelf(this.contentEl, {
      piles: () => this.plugin.piles(),
      onBoard: (p) => !!this.parsed && this.canvas.has(p),
      drop: (paths, x, y) => this.canvas.addFiles(paths, this.canvas.toWorld(x, y)),
      more: (pile) => this.plugin.pickFrom(this, pile),
      color: (pile) => this.plugin.swatch(pile),
      setColor: (pile, id) => this.plugin.setFolderColor(pile, id),
      setDefaultColor: (id) => this.plugin.setDefaultColor(id),
    });
    this.canvas.root.addEventListener("keydown", (e) => this.onKey(e));
    this.contentEl.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.shelf.isOpen()) { e.stopPropagation(); this.shelf.close(); } });
  }

  // ── 读写 ──
  getViewData(): string {
    // 读坏了的笔记原样写回，绝不用空画板覆盖用户的数据。
    if (!this.parsed) return this.data;
    const moc = buildMoc(this.parsed.data, (p) => this.linkOf(p));
    return serializeBoardNote(this.parsed, moc);
  }

  setViewData(data: string, clear: boolean): void {
    this.data = data;
    try {
      this.parsed = parseBoardNote(data);
      this.broken = null;
    } catch (e) {
      this.parsed = null;
      this.broken = e instanceof BoardParseError ? e.message : String(e);
    }
    this.render();
    if (this.parsed && (clear || !this.history.canUndo)) this.history.reset(this.doc());
  }

  clear(): void {
    this.parsed = null;
    this.history = new History();
  }

  private doc() {
    const d = this.parsed!.data;
    return { nodes: d.nodes, edges: d.edges, strokes: d.strokes };
  }

  private render(): void {
    this.contentEl.querySelector(".sk-broken")?.remove();
    if (!this.parsed) {
      this.canvas.root.hide();
      const box = this.contentEl.createDiv({ cls: "sk-broken" });
      box.createEl("p", { text: "这块画板的数据读不出来，所以没有打开，也不会改动这篇笔记。" });
      box.createEl("p", { cls: "sk-broken-why", text: this.broken ?? "" });
      const b = box.createEl("button", { text: "用 Markdown 打开" });
      b.onclick = () => void this.openAsMarkdown();
      return;
    }
    this.canvas.root.show();
    this.canvas.load(this.parsed.data);
    this.shelf.render();
    this.shelf.refreshOn();
  }

  /** 库里的笔记变了（标题、类型、领域）：卡面跟着刷新。 */
  notesChanged(): void {
    if (this.parsed) this.canvas.refreshNotes();
    this.shelf.render();
  }

  private linkOf(path: string): string {
    const f = this.app.vault.getAbstractFileByPath(path);
    const from = this.file?.path ?? "";
    if (f instanceof TFile) return this.app.fileManager.generateMarkdownLink(f, from);
    return `[[${path.replace(/\.md$/, "")}]]`;
  }

  // ── 撤销 ──
  private restore(doc: unknown): void {
    if (!doc || !this.parsed) return;
    Object.assign(this.parsed.data, doc as object);
    this.canvas.load(this.parsed.data);
    this.requestSave();
    this.shelf.refreshOn();
  }
  undo() { this.restore(this.history.undo()); }
  redo() { this.restore(this.history.redo()); }

  // ── 键盘：只在画板获得焦点、且焦点不在输入框里时响应 ──
  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, [contenteditable=true], [contenteditable=plaintext-only]")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (this.canvas.removeSelected()) e.preventDefault();
    } else if (e.key === "Escape") {
      if (this.shelf.isOpen()) this.shelf.close();
      else this.canvas.clearSel();
    }
  }

  onPaneMenu(menu: Menu, source: string): void {
    menu.addItem((i) => i.setTitle("用 Markdown 打开").setIcon("file-text").onClick(() => void this.openAsMarkdown()));
    super.onPaneMenu(menu, source);
  }

  private async openAsMarkdown(): Promise<void> {
    if (!this.file) return;
    this.plugin.markdownOnce.add(this.file.path);
    await this.leaf.setViewState({ type: "markdown", state: { file: this.file.path }, popstate: true } as never);
  }
}
