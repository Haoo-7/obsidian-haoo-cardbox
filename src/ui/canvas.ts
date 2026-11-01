import { packDrop, removeNodes } from "../core";
import type { BoardData, BoardNode, Point, VaultNote } from "../core";
import { CARD_H, CARD_W, fillExcerpt, makeCard, pose } from "./card";
import { bindCard, bindViewport } from "./interact";
import { Ink } from "./ink";
import { Links } from "./links";

/** 画板要从视图拿的东西。画板本身不碰文件，只改 data 并通知视图。 */
export interface CanvasHost {
  note(path: string): VaultNote | undefined;
  excerpt(path: string): Promise<string>;
  open(path: string, split: boolean): void;
  hover(e: MouseEvent, path: string, target: HTMLElement): void;
  /** 卡片、连线、标注变了：进撤销历史、写回笔记。 */
  changed(): void;
  /** 只是平移缩放：写回笔记，但不进撤销历史。 */
  viewChanged(): void;
}

/** sig：画这张卡时用的笔记内容，用来判断要不要重画。 */
export interface Item { node: BoardNode; el: HTMLElement; sig?: string; }

/** 缩小到这个比例以下，卡片只显示纸色和标题前 4 个字。 */
const TINY = 0.55;

export class BoardCanvas {
  readonly root: HTMLElement;
  readonly vp: HTMLElement;
  readonly content: HTMLElement;
  readonly items = new Map<string, Item>();
  data!: BoardData;
  readonly links: Links;
  readonly ink: Ink;
  private zoomLabel: HTMLElement;

  constructor(parent: HTMLElement, readonly host: CanvasHost) {
    this.root = parent.createDiv({ cls: "sk-board" });
    this.vp = this.root.createDiv({ cls: "sk-viewport" });
    this.content = this.vp.createDiv({ cls: "sk-content" });
    this.zoomLabel = this.root.createDiv({ cls: "sk-zoom" });
    this.links = new Links(this);
    this.ink = new Ink(this);
    bindViewport(this);
  }

  /** 整块重画：第一次打开、撤销、外部改了笔记时调用。 */
  load(data: BoardData): void {
    this.data = data;
    this.items.forEach((it) => it.el.remove());
    this.items.clear();
    data.nodes.forEach((n) => this.mountNode(n));
    this.links.load();
    this.ink.load();
    this.applyView();
  }

  /**
   * 笔记的标题、类型、领域变了：只重画内容真的变了的那几张，位置和选中不动。
   * 不能全部重画：正在被点、被拖的那张卡如果在这时被换掉，这一下单击或双击就丢了。
   */
  refreshNotes(): void {
    this.items.forEach((it) => {
      if (this.sigOf(it.node) === it.sig) return;
      const sel = it.el.hasClass("is-sel");
      it.el.remove();
      this.renderNode(it);
      if (sel) it.el.addClass("is-sel");
    });
  }

  // 先把新元素挂到 it 上再绑事件：事件里用的是 it.el，重画后要指向新的那张。
  private sigOf(node: BoardNode): string {
    return JSON.stringify(node.missing ? null : this.host.note(node.file) ?? null);
  }

  private renderNode(it: Item): void {
    const { node } = it;
    it.sig = this.sigOf(node);
    it.el = makeCard(node.missing ? undefined : this.host.note(node.file), node.file);
    it.el.addClass("on-board");
    if (node.flipped) it.el.addClass("is-flip");
    pose(it.el, node, 0);
    this.content.appendChild(it.el);
    bindCard(this, it);
    this.links.ports(it);
    // 存档里本来就翻着面的卡，打开画板时也要把背面的正文开头读出来。
    if (node.flipped && !node.missing) {
      const el = it.el;
      void this.host.excerpt(node.file).then((t) => fillExcerpt(el, t));
    }
  }

  private mountNode(node: BoardNode): Item {
    const it = { node } as Item;
    this.items.set(node.id, it);
    this.renderNode(it);
    return it;
  }

  has(path: string): boolean {
    return this.data.nodes.some((n) => n.file === path);
  }

  /** 把几篇笔记放上画板：落在 at（画板坐标）处，多张时每行 4 张排成一小块。 */
  addFiles(paths: string[], at: Point): Item[] {
    const fresh = paths.filter((p) => !this.has(p));
    const added = packDrop(fresh, at, { w: CARD_W, h: CARD_H }).map(({ file, x, y }) => {
      const node: BoardNode = { id: newId(), type: "file", file, x, y, width: CARD_W, height: CARD_H };
      this.data.nodes.push(node);
      return this.mountNode(node);
    });
    if (added.length) this.host.changed();
    return added;
  }

  selected(): Item[] {
    return [...this.items.values()].filter((it) => it.el.hasClass("is-sel"));
  }
  select(it: Item, add: boolean): void {
    if (!add) this.items.forEach((o) => o !== it && o.el.removeClass("is-sel"));
    it.el.toggleClass("is-sel", add ? !it.el.hasClass("is-sel") : true);
    if (!add) { this.links.clearSel(); this.ink.clearSel(); }
    else this.links.render();
  }
  clearSel(): void {
    this.items.forEach((o) => o.el.removeClass("is-sel"));
    this.links.clearSel();
    this.ink.clearSel();
  }

  /** 把选中的卡从画板上拿下来（不删原笔记），连着它们的线一起删；选中的连线、标注也删。一次按键只记一步历史。 */
  removeSelected(): boolean {
    const ids = this.selected().map((it) => it.node.id);
    const lines = this.links.dropSelected(), marks = this.ink.dropSelected();
    if (!ids.length && !lines && !marks) return false;
    if (ids.length) {
      const next = removeNodes(this.data, ids);
      this.data.nodes = next.nodes;
      this.data.edges = next.edges;
      ids.forEach((id) => { this.items.get(id)!.el.remove(); this.items.delete(id); });
      this.links.load(); // 拿下的卡连着的线一起没了
    }
    this.host.changed();
    return true;
  }

  async flip(it: Item): Promise<void> {
    it.node.flipped = !it.node.flipped;
    if (!it.node.flipped) delete it.node.flipped;
    it.el.toggleClass("is-flip", !!it.node.flipped);
    if (it.node.flipped && !it.node.missing) fillExcerpt(it.el, await this.host.excerpt(it.node.file));
    this.host.changed();
  }

  // ── 视口 ──
  get view() { return this.data.viewport; }
  toWorld(cx: number, cy: number): Point {
    const r = this.vp.getBoundingClientRect(), v = this.view;
    return [(cx - r.left - v.x) / v.zoom, (cy - r.top - v.y) / v.zoom];
  }
  /** 画板可见区域正中间，新放上来的卡默认落在这里。 */
  center(): Point {
    const r = this.vp.getBoundingClientRect();
    const [x, y] = this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return [x - CARD_W / 2, y - CARD_H / 2];
  }
  applyView(): void {
    const v = this.view;
    for (const n of [this.vp, this.content]) {
      n.style.setProperty("--vx", `${v.x}px`);
      n.style.setProperty("--vy", `${v.y}px`);
      n.style.setProperty("--z", String(v.zoom));
    }
    this.root.toggleClass("is-tiny", v.zoom < TINY);
    this.zoomLabel.setText(`${Math.round(v.zoom * 100)}%`);
    this.ink.zoomed();
  }
}

const newId = () => `n${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
