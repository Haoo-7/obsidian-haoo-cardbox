import type { Pile } from "../core";
import { CARD_H, CARD_W, makeCard, pose, tilter } from "./card";
import type { Shelf } from "./shelf";

type Pose = { x: number; y: number; r: number; s: number };
export interface FolderEls { el: HTMLElement; cards: HTMLElement; }
interface Fly { path: string; el: HTMLElement; home: Pose; out: Pose; order: number; t?: number; }

/** 收在文件夹里时的缩放：宽不超过文件夹，竖着不露出前片。 */
const SP = Math.min(0.68, 100 / CARD_W, 104 / CARD_H);
const T_RISE = 200, T_FLY = 480, CX = 196, CY = 146;

/** 文件夹里露出上沿的那三张（文件夹坐标）。 */
export const peekPose = (i: number): Pose => ({ x: 14 + i * 30, y: 12 - i * 3, r: [-5, 1.5, 6][i], s: SP });
/** 悬停文件夹时，露出的三张往上抽出一截、错开角度。 */
export const liftPose = (i: number): Pose => ({ x: 14 + i * 30 + [-10, 0, 10][i], y: 12 - i * 3 - [26, 38, 30][i], r: [-9, 2, 10][i], s: SP });
const hiddenPose = (): Pose => ({ x: 20, y: Math.min(50, 136 - SP * CARD_H), r: 0, s: SP * 0.97 });
/** 抽出来的中转位置：越过前片上沿、排成一把小扇子，横向只在本文件夹宽度内展开。 */
const above = (c: Fly): Pose => { const k = (c.order % 5) - 2; return { x: c.home.x + k * 16, y: -60, r: k * 3, s: 0.8 }; };
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const hash = (s: string) => [...s].reduce((a, ch) => (a * 31 + ch.codePointAt(0)!) >>> 0, 17);

/**
 * 打开的一个卡堆。两段动画，图层不会错乱：
 * 抽出时卡片先在文件夹里（后片和前片之间）竖直抽出，越过前片上沿以后才换到最上面的浮层，再飞到散开的位置；
 * 收回时反过来，先飞回文件夹上方，换回文件夹里，再竖直插回去。
 */
export class Spread {
  private cards: Fly[] = [];
  private more: HTMLElement | null = null;
  private closing = false;

  constructor(private shelf: Shelf, readonly pile: Pile, private folder: FolderEls) {}

  /** lifted：点下去时鼠标还停在文件夹上，露出的三张正处在抽出一截的样子，从那里接着飞。 */
  open(lifted: boolean): void {
    const { w, h } = this.shelf.area();
    const cols = Math.max(2, Math.floor((w - 40) / CX)), rows = Math.max(1, Math.floor((h - 32) / CY));
    // 格子里随机空出一成，留出空当；同一个卡堆每次散开的样子一样。
    const r = rng(hash(this.pile.name));
    const cells = [...Array(cols * rows).keys()];
    const nEmpty = Math.max(1, Math.round(cells.length * 0.12));
    const empty = new Set(cells.slice().sort(() => r() - 0.5).slice(0, nEmpty));
    const used = cells.filter((c) => !empty.has(c));
    const shift = [...Array(rows)].map(() => (r() - 0.5) * 16);
    const gx = (w - cols * CX) / 2, gy = Math.max(16, (h - rows * CY) / 2);
    const cell = (c: number) => ({ x: gx + (c % cols) * CX + (CX - CARD_W) / 2, y: gy + Math.floor(c / cols) * CY + (CY - CARD_H) / 2 });

    const list = this.pile.cards.slice(0, used.length);
    this.cards = list.map((note, i) => {
      const el = makeCard(note, note.path, this.pile.name);
      el.addClass("sk-fly");
      const p = cell(used[i]), row = Math.floor(used[i] / cols);
      const c: Fly = {
        path: note.path, el, order: i,
        home: i < 3 ? peekPose(i) : hiddenPose(),
        out: { x: p.x + shift[row] + (r() - 0.5) * 18, y: p.y + (r() - 0.5) * 12, r: (r() - 0.5) * 7, s: 1 },
      };
      this.folder.cards.appendChild(el);
      pose(el, i < 3 && lifted ? liftPose(i) : c.home, 0);
      this.bindDrag(c);
      return c;
    });
    this.refreshOn();
    // 露出的三张最后插进去，压在其余卡片上面。
    this.cards.slice(0, 3).forEach((c) => this.folder.cards.appendChild(c.el));
    this.cards.forEach((c) => this.fly(c, c.order * 18));

    const rest = this.pile.cards.length - list.length;
    if (rest > 0) {
      const p = cell([...empty].pop()!);
      this.more = this.shelf.layer.createDiv({ cls: "sk-more", text: `还有 ${rest} 张 · 搜索` });
      Object.assign(this.more.style, { left: `${p.x}px`, top: `${p.y}px` });
      this.more.onclick = () => this.shelf.host.more(this.pile);
      window.setTimeout(() => this.more?.addClass("is-on"), 0);
    }
  }

  /** 文件夹在视图里的位置：换图层时用它把同一个屏幕位置换算过去。 */
  private offset() {
    const a = this.folder.el.getBoundingClientRect(), b = this.shelf.root.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top };
  }

  private fly(c: Fly, delay: number): void {
    pose(c.el, above(c), T_RISE, delay);
    c.t = window.setTimeout(() => {
      const o = this.offset(), a = above(c);
      this.shelf.layer.appendChild(c.el);
      pose(c.el, { ...a, x: a.x + o.x, y: a.y + o.y }, 0);
      void c.el.offsetWidth;
      c.el.addClass("is-out");
      pose(c.el, c.out, T_FLY, 0);
    }, delay + T_RISE);
  }

  close(done: () => void): void {
    this.closing = true;
    const n = this.cards.length;
    this.cards.forEach((c) => {
      window.clearTimeout(c.t);
      const delay = (n - c.order) * 10, a = above(c);
      c.el.removeClass("is-sel");
      if (c.el.parentElement === this.folder.cards) { pose(c.el, c.home, T_RISE, delay); return; }
      const o = this.offset();
      pose(c.el, { ...a, x: a.x + o.x, y: a.y + o.y }, T_FLY * 0.8, delay);
      c.t = window.setTimeout(() => {
        this.folder.cards.appendChild(c.el);
        c.el.removeClass("is-out");
        pose(c.el, a, 0);
        void c.el.offsetWidth;
        pose(c.el, c.home, T_RISE, 0);
      }, delay + T_FLY * 0.8);
    });
    this.more?.remove();
    window.setTimeout(() => { this.cards.forEach((c) => c.el.remove()); done(); }, n * 10 + T_FLY * 0.8 + T_RISE + 60);
  }

  /** 已经在画板上的卡：纸面压暗、影子收平，拖不动。 */
  refreshOn(): void {
    this.cards.forEach((c) => c.el.toggleClass("is-on", this.shelf.host.onBoard(c.path)));
  }

  /**
   * 散开的卡：按下就选中（⇧/⌘ 加选），按住拖走；选中了几张就一起带走。
   * 松手时指针在画板上就落下，不在就飞回原位。拖着的时候压暗层淡下去，好找落点。
   */
  private bindDrag(c: Fly): void {
    const el = c.el;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.closing || !el.hasClass("is-out") || el.hasClass("is-on")) return;
      e.stopPropagation();
      e.preventDefault();
      const add = e.shiftKey || e.metaKey;
      const wasSel = el.hasClass("is-sel");
      if (!wasSel && !add) this.cards.forEach((o) => o.el.removeClass("is-sel"));
      if (!wasSel) el.addClass("is-sel");
      const group = [c, ...this.cards.filter((o) => o !== c && o.el.hasClass("is-sel") && !o.el.hasClass("is-on"))];
      const root = this.shelf.root.getBoundingClientRect();
      const grab = { x: e.clientX - root.left - c.out.x, y: e.clientY - root.top - c.out.y };
      const tilt = tilter(el);
      let moved = false, lastX = e.clientX, ended = false;
      el.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
        if (!moved) { moved = true; this.shelf.dragging(true); group.forEach((g) => g.el.addClass("is-drag")); }
        group.forEach((g, i) => pose(g.el, { x: ev.clientX - root.left - grab.x + i * 10, y: ev.clientY - root.top - grab.y + i * 8, r: 0, s: 1 }, 0));
        tilt(ev.clientX - lastX);
        lastX = ev.clientX;
      };
      const up = (ev: PointerEvent) => {
        if (ended) return;
        ended = true;
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.removeEventListener("lostpointercapture", up);
        this.shelf.dragging(false);
        if (!moved) {
          if (wasSel && add) el.removeClass("is-sel");
          else if (wasSel) { this.cards.forEach((o) => o !== c && o.el.removeClass("is-sel")); }
          return;
        }
        group.forEach((g) => { g.el.removeClass("is-drag", "is-sel"); g.el.style.setProperty("--tilt", "0deg"); });
        if (ev.type === "pointerup" && this.shelf.overBoard(ev.clientX, ev.clientY)) {
          this.shelf.host.drop(group.map((g) => g.path), ev.clientX - grab.x, ev.clientY - grab.y);
          group.forEach((g) => { pose(g.el, g.out, 0); g.el.addClass("is-pop"); window.setTimeout(() => g.el.removeClass("is-pop"), 300); });
          this.refreshOn();
        } else group.forEach((g) => pose(g.el, g.out, 320));
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
    });
  }
}
