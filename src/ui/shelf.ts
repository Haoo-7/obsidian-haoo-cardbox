import { Menu } from "obsidian";
import type { Pile } from "../core";
import { makeCard, pose } from "./card";
import { Spread, liftPose, peekPose } from "./spread";
import type { FolderEls } from "./spread";

export interface Swatch { id: string; name: string; c: string; ink: "light" | "dark"; }
/** 文件夹的颜色：前片、后片、名字的深浅都从这一个颜色推出来。ink 是名字用深字还是浅字。 */
export const SWATCHES: Swatch[] = [
  { id: "graphite", name: "石墨", c: "#3a3b3f", ink: "light" },
  { id: "mist", name: "雾白", c: "#e9eaee", ink: "dark" },
  { id: "oat", name: "燕麦", c: "#e4d8c4", ink: "dark" },
  { id: "sage", name: "鼠尾草", c: "#a9b8a2", ink: "dark" },
  { id: "slate", name: "雾蓝", c: "#8fa3b8", ink: "dark" },
  { id: "clay", name: "陶土", c: "#c08a72", ink: "dark" },
  { id: "plum", name: "梅子", c: "#6e5a72", ink: "light" },
];

export interface ShelfHost {
  piles(): Pile[];
  onBoard(path: string): boolean;
  /** 从卡堆拖上画板；x、y 是领头那张卡左上角的屏幕坐标。 */
  drop(paths: string[], x: number, y: number): void;
  /** 一堆卡散开时放不下，点「还有 N 张 · 搜索」。 */
  more(pile: Pile): void;
  color(pile: string): Swatch;
  setColor(pile: string, id: string | null): void;
  setDefaultColor(id: string): void;
}

interface Folder extends FolderEls { pile: Pile; back: HTMLElement; front: HTMLElement; peeks: HTMLElement[]; }

/** 卡堆栏：画板下面一排文件夹，一个领域一个；悬停露出三张，点开后卡片飞出散开在画板上方。 */
export class Shelf {
  readonly layer: HTMLElement;
  private bar: HTMLElement;
  private strip: HTMLElement;
  private scrim: HTMLElement;
  private folders: Folder[] = [];
  private spread: Spread | null = null;
  private sig = "";
  private dirty = false;

  constructor(readonly root: HTMLElement, readonly host: ShelfHost) {
    this.scrim = root.createDiv({ cls: "sk-scrim" });
    this.bar = root.createDiv({ cls: "sk-shelf" });
    this.strip = this.bar.createDiv({ cls: "sk-strip" });
    this.layer = root.createDiv({ cls: "sk-layer" });
    this.scrim.addEventListener("pointerdown", () => this.close());
    // 卡堆多的时候横着排不下：竖着滚轮也能左右翻。
    this.strip.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      this.strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  /** 卡堆有变化才重画；正散开着一堆时先记下，收回去以后再画，免得把正在飞的卡换掉。 */
  render(): void {
    const piles = this.host.piles();
    const sig = JSON.stringify(piles.map((p) => [p.name, p.count, p.cards.slice(0, 3).map((c) => c.path + c.title + c.type)]));
    if (sig === this.sig) return;
    if (this.spread) { this.dirty = true; return; }
    this.sig = sig;
    this.strip.empty();
    this.folders = piles.map((p) => this.makeFolder(p));
    if (!piles.length) this.strip.createDiv({ cls: "sk-shelf-empty", text: "库里还没有带领域标签的笔记。" });
    this.paint();
  }

  private makeFolder(pile: Pile): Folder {
    // 不加 aria-label：Obsidian 会把它变成悬停提示，和文件夹上已经写着的名字、张数重复。
    const el = this.strip.createDiv({ cls: "sk-folder", attr: { role: "button", tabindex: "0" } });
    el.dataset.pile = pile.name;
    const back = el.createDiv({ cls: "sk-f-back" });
    const cards = el.createDiv({ cls: "sk-f-cards" });
    const front = el.createDiv({ cls: "sk-f-front" });
    const rim = front.createSvg("svg", { attr: { viewBox: "0 0 190 104", "aria-hidden": "true" } });
    rim.createSvg("path", { attr: { d: "M2 30 Q2 20 14 20 L96 20 Q107 20 113 11 L119 4 Q122 1.5 128 1.5 L176 1.5 Q188.5 1.5 188.5 14", fill: "none", stroke: "rgba(255,255,255,.28)", "stroke-width": "1" } });
    front.createSpan({ cls: "sk-f-name", text: pile.name });
    front.createSpan({ cls: "sk-f-count", text: `${pile.count} 张` });
    const peeks = pile.cards.slice(0, 3).map((n, i) => {
      const c = makeCard(n, n.path, pile.name);
      c.addClass("sk-peek");
      pose(c, peekPose(i), 0);
      cards.appendChild(c);
      return c;
    });
    const f: Folder = { pile, el, cards, back, front, peeks };
    el.addEventListener("mouseenter", () => { if (!el.hasClass("is-open")) peeks.forEach((c, i) => pose(c, liftPose(i), 260)); });
    el.addEventListener("mouseleave", () => peeks.forEach((c, i) => pose(c, peekPose(i), 260)));
    el.addEventListener("click", () => this.toggle(f));
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); this.colorMenu(pile.name, e); });
    return f;
  }

  private toggle(f: Folder): void {
    // 点文件夹时把焦点拉进画板视图，Esc 才收得回去。
    this.root.focus({ preventScroll: true });
    const same = this.spread?.pile.name === f.pile.name;
    this.close();
    if (same) return;
    this.folders.forEach((o) => o.el.toggleClass("is-dim", o !== f));
    f.el.addClass("is-open");
    this.root.addClass("sk-spread-open");
    const lifted = f.el.matches(":hover");
    f.peeks.forEach((c) => c.hide());
    this.spread = new Spread(this, f.pile, f);
    this.spread.open(lifted);
  }

  close(): void {
    const s = this.spread;
    if (!s) return;
    this.spread = null;
    const f = this.folders.find((o) => o.pile.name === s.pile.name);
    this.folders.forEach((o) => o.el.removeClass("is-dim"));
    this.root.removeClass("sk-spread-open");
    s.close(() => {
      f?.el.removeClass("is-open");
      f?.peeks.forEach((c, i) => { pose(c, peekPose(i), 0); c.show(); });
      if (this.dirty && !this.spread) { this.dirty = false; this.sig = ""; this.render(); }
    });
  }

  isOpen(): boolean { return !!this.spread; }
  refreshOn(): void { this.spread?.refreshOn(); }
  /** 拖着散开的卡时：压暗层和别的散开卡淡下去，露出画板好找落点。 */
  dragging(on: boolean): void { this.root.toggleClass("sk-dragging", on); }
  /** 散开的区域：卡堆栏以上的整块画板。 */
  area(): { w: number; h: number } { return { w: this.root.clientWidth, h: this.root.clientHeight - this.bar.offsetHeight }; }
  overBoard(x: number, y: number): boolean {
    const r = this.root.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y < this.bar.getBoundingClientRect().top;
  }

  paint(): void {
    this.folders.forEach((f) => {
      const s = this.host.color(f.pile.name);
      for (const n of [f.back, f.front]) { n.style.setProperty("--fc", s.c); n.dataset.ink = s.ink; }
    });
  }

  private colorMenu(name: string, e: MouseEvent): void {
    const m = new Menu(), cur = this.host.color(name);
    SWATCHES.forEach((s) => m.addItem((i) => i.setTitle(s.name).setChecked(s.id === cur.id).onClick(() => this.host.setColor(name, s.id))));
    m.addSeparator();
    m.addItem((i) => i.setTitle(`所有文件夹都用「${cur.name}」`).setIcon("palette").onClick(() => this.host.setDefaultColor(cur.id)));
    m.showAtMouseEvent(e);
  }
}
