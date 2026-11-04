import { Menu, Notice, TextFileView, WorkspaceLeaf, normalizePath } from "obsidian";
import { BoardParseError, buildMoc, History, parseBoardNote, relink, serializeBoardNote, toJsonCanvas } from "../core";
import type { BoardData, BoardNode, ParsedBoardNote } from "../core";
import { BoardCanvas } from "../ui/canvas";
import type { Item } from "../ui/canvas";
import { MODE_KEYS } from "../ui/ink";
import { openCardPalette } from "../ui/palette";
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
      menu: (e, it) => this.cardMenu(e, it),
      relink: (node) => this.pickRelink(node),
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
    const moc = buildMoc(this.parsed.data, (p) => this.plugin.linkOf(p, this.file?.path ?? ""));
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

  /**
   * 库里的笔记改名、删除了：改这块画板的数据，撤销历史里的快照一起改。返回 false 表示这块画板没读出来，没改。
   * 只改 nodes，连线、标注、视口原样不动。
   */
  applyEdit(fn: (d: BoardData) => BoardData): boolean {
    if (!this.parsed) return false;
    const d = this.parsed.data, before = JSON.stringify(d.nodes);
    const next = fn(d);
    if (JSON.stringify(next.nodes) === before) return true;
    d.nodes = next.nodes;
    this.history.rewrite((doc) => ({ ...(doc as object), nodes: fn(doc as BoardData).nodes }));
    this.canvas.load(d);
    this.requestSave();
    this.shelf.refreshOn();
    return true;
  }

  // ── 卡片的右键菜单、缺失卡片重新指向 ──
  private cardMenu(e: MouseEvent, it: Item): void {
    const c = this.canvas, n = it.node;
    if (!it.el.hasClass("is-sel")) c.select(it, false);
    const count = c.selected().length;
    const m = new Menu();
    if (n.missing) {
      m.addItem((i) => i.setTitle("重新指向一篇笔记…").setIcon("link").onClick(() => this.pickRelink(n)));
    } else {
      m.addItem((i) => i.setTitle("在右侧打开原笔记").setIcon("separator-vertical").onClick(() => c.host.open(n.file, true)));
      m.addItem((i) => i.setTitle(n.flipped ? "翻回正面" : "翻到背面").setIcon("flip-horizontal-2").onClick(() => void c.flip(it)));
      m.addItem((i) => i.setTitle("卡片颜色…").setIcon("palette").onClick(() => {
        openCardPalette(c.root, it.el, n.color ?? null, (hex) => { c.tint(hex); });
      }));
    }
    m.addSeparator();
    m.addItem((i) => i.setTitle(count > 1 ? `从画板上拿下 ${count} 张卡` : "从画板上拿下").setIcon("x").onClick(() => c.removeSelected()));
    m.showAtMouseEvent(e);
  }
  /** 缺失卡片换成另一篇笔记：卡片标识不变，连线都还在。 */
  private pickRelink(node: BoardNode): void {
    this.plugin.pick("把这张卡重新指向哪篇笔记", (n) => !this.canvas.has(n.path), (n) => {
      if (!this.parsed) return;
      this.parsed.data.nodes = relink(this.parsed.data, node.id, n.path).nodes;
      this.canvas.load(this.parsed.data);
      this.canvas.host.changed();
    });
  }

  // ── 导出：同一文件夹下一份 .canvas，卡片和连线照原样，笔迹和缺失卡片不带 ──
  async exportCanvas(): Promise<void> {
    if (!this.parsed || !this.file) return;
    const d = this.parsed.data, out = toJsonCanvas(d);
    const dir = this.file.parent?.path ?? "/";
    const at = (n: string) => normalizePath(`${dir === "/" ? "" : dir + "/"}${n}.canvas`);
    let name = this.file.basename, i = 1;
    while (this.app.vault.getAbstractFileByPath(at(name))) name = `${this.file.basename} ${++i}`;
    const f = await this.app.vault.create(at(name), JSON.stringify(out, null, "\t"));
    await this.app.workspace.getLeaf("tab").openFile(f);
    const lost = [d.strokes.length && `${d.strokes.length} 条标注`, d.nodes.length - out.nodes.length && `${d.nodes.length - out.nodes.length} 张缺失卡片`].filter(Boolean);
    new Notice(`导出了「${name}.canvas」${lost.length ? `。原生画板不支持，没带上 ${lost.join("和 ")}` : ""}`);
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
      else if (this.canvas.ink.mode !== "select") this.canvas.ink.setMode("select");
      else this.canvas.clearSel();
    } else if (!mod && !e.altKey && MODE_KEYS[e.key.toLowerCase()]) {
      // V 选择、P 画笔、L 直线、R 矩形、T 文字、E 橡皮擦。
      this.canvas.ink.setMode(MODE_KEYS[e.key.toLowerCase()]);
    }
  }

  onPaneMenu(menu: Menu, source: string): void {
    menu.addItem((i) => i.setTitle("用 Markdown 打开").setIcon("file-text").onClick(() => void this.openAsMarkdown()));
    if (this.parsed) menu.addItem((i) => i.setTitle("导出为 .canvas").setIcon("layout-dashboard").onClick(() => void this.exportCanvas()));
    super.onPaneMenu(menu, source);
  }

  private async openAsMarkdown(): Promise<void> {
    if (!this.file) return;
    this.plugin.markdownOnce.add(this.file.path);
    await this.leaf.setViewState({ type: "markdown", state: { file: this.file.path }, popstate: true } as never);
  }
}
