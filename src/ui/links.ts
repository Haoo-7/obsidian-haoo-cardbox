import type { BoardEdge, BoardNode } from "../core";
import { CARD_H as H, CARD_W as W } from "./card";
import type { BoardCanvas, Item } from "./canvas";

type P = [number, number];
interface E { edge: BoardEdge; g: SVGGElement; line: SVGPathElement; hit: SVGPathElement; lab: HTMLElement; m: P; sel: boolean; }
const newId = () => `e${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;

/** 曲线从两张卡相对的那两条边的中点出发，沿边的法线方向弯出去。 */
function side(n: BoardNode, px: number, py: number): { p: P; n: P } {
  const ax = n.x + W / 2, ay = n.y + H / 2, dx = px - ax, dy = py - ay;
  if (Math.abs(dx) / W >= Math.abs(dy) / H) { const k = Math.sign(dx) || 1; return { p: [ax + (k * W) / 2, ay], n: [k, 0] }; }
  const k = Math.sign(dy) || 1;
  return { p: [ax, ay + (k * H) / 2], n: [0, k] };
}
function geo(a: BoardNode, b: BoardNode): { d: string; m: P } {
  const s = side(a, b.x + W / 2, b.y + H / 2), e = side(b, a.x + W / 2, a.y + H / 2);
  const L = Math.max(24, Math.hypot(e.p[0] - s.p[0], e.p[1] - s.p[1]) * 0.42);
  const c1: P = [s.p[0] + s.n[0] * L, s.p[1] + s.n[1] * L], c2: P = [e.p[0] + e.n[0] * L, e.p[1] + e.n[1] * L];
  const m: P = [(s.p[0] + 3 * c1[0] + 3 * c2[0] + e.p[0]) / 8, (s.p[1] + 3 * c1[1] + 3 * c2[1] + e.p[1]) / 8];
  return { d: `M${s.p} C${c1} ${c2} ${e.p}`, m };
}

/**
 * 连线：两张卡之间一条无方向的柔和曲线，可以带一个短标签。
 * 悬停卡片时四边出现接点，从接点（或按住 ⌥ 从卡面）拖到另一张卡上松手就连上；
 * 单击连线选中，Delete 删；双击写标签。连线层在卡片下面，随画板一起平移缩放。
 */
export class Links {
  private svg: SVGSVGElement;
  private labels: HTMLElement;
  private list: E[] = [];

  constructor(private c: BoardCanvas) {
    this.svg = c.content.createSvg("svg", { cls: "sk-l-svg", attr: { width: 20000, height: 20000, viewBox: "-10000 -10000 20000 20000" } });
    this.labels = c.content.createDiv({ cls: "sk-l-labels" });
    c.content.prepend(this.svg, this.labels);
  }

  load(): void {
    this.list.forEach((e) => this.unmount(e));
    this.list = this.c.data.edges.map((edge) => this.mount(edge));
    this.render();
  }

  private mount(edge: BoardEdge): E {
    const g = this.svg.createSvg("g", { cls: "sk-l-edge" });
    const line = g.createSvg("path", { cls: "sk-l-line" });
    const hit = g.createSvg("path", { cls: "sk-l-hit" });
    const lab = this.labels.createDiv({ cls: "sk-l-lab" });
    const e: E = { edge, g, line, hit, lab, m: [0, 0], sel: false };
    for (const n of [hit, lab] as Element[]) {
      n.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); this.c.root.focus({ preventScroll: true }); });
      n.addEventListener("click", (ev) => { ev.stopPropagation(); this.pick(e, (ev as MouseEvent).shiftKey); });
      n.addEventListener("dblclick", (ev) => { ev.stopPropagation(); this.edit(e); });
    }
    return e;
  }
  private unmount(e: E): void { e.g.remove(); e.lab.remove(); }

  /** 卡片挪动、选中变化时重画：选中一张卡时，它的连线一起变色。 */
  render(): void {
    for (const e of this.list) {
      const A = this.c.items.get(e.edge.fromNode), B = this.c.items.get(e.edge.toNode);
      const ok = !!(A && B);
      e.g.style.display = ok ? "" : "none";
      e.lab.toggle(ok && !!e.edge.label);
      if (!A || !B) continue;
      const { d, m } = geo(A.node, B.node);
      e.m = m;
      e.line.setAttribute("d", d);
      e.hit.setAttribute("d", d);
      e.lab.setText(e.edge.label ?? "");
      Object.assign(e.lab.style, { left: `${m[0]}px`, top: `${m[1]}px` });
      const hot = A.el.hasClass("is-sel") || B.el.hasClass("is-sel");
      for (const n of [e.g, e.lab] as Element[]) { n.toggleClass("is-hot", hot); n.toggleClass("is-sel", e.sel); }
    }
  }

  private pick(e: E, add: boolean): void {
    if (!add) { this.c.items.forEach((o) => o.el.removeClass("is-sel")); this.list.forEach((o) => (o.sel = false)); this.c.ink.clearSel(); }
    e.sel = add ? !e.sel : true;
    this.render();
  }
  clearSel(): void { this.list.forEach((o) => (o.sel = false)); this.render(); }

  /** 删掉选中的连线，只改 data，不通知视图：和卡片一起删时由画板统一记一次历史。 */
  dropSelected(): boolean {
    const gone = this.list.filter((e) => e.sel);
    if (!gone.length) return false;
    const ids = new Set(gone.map((e) => e.edge.id));
    this.c.data.edges = this.c.data.edges.filter((x) => !ids.has(x.id));
    gone.forEach((e) => this.unmount(e));
    this.list = this.list.filter((e) => !e.sel);
    return true;
  }

  /** 每张画板卡的四个接点。 */
  ports(it: Item): void {
    for (const s of ["t", "r", "b", "l"]) {
      const p = it.el.createEl("i", { cls: `sk-l-port sk-l-port-${s}` });
      p.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        ev.preventDefault();
        this.c.root.focus({ preventScroll: true });
        this.start(it, ev);
      });
    }
  }

  /** 拖一条新连线：虚线跟着指针，经过的卡片亮一圈，松手在卡片上就连上。 */
  start(A: Item, e: PointerEvent): void {
    const cap = e.target as HTMLElement, tmp = this.svg.createSvg("path", { cls: "sk-l-tmp" });
    this.c.root.addClass("is-linking");
    let target: Item | null = null, ended = false;
    cap.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const [x, y] = this.c.toWorld(ev.clientX, ev.clientY), s = side(A.node, x, y);
      const L = Math.max(24, Math.hypot(x - s.p[0], y - s.p[1]) * 0.42);
      tmp.setAttribute("d", `M${s.p} C${s.p[0] + s.n[0] * L},${s.p[1] + s.n[1] * L} ${x},${y} ${x},${y}`);
      const hitEl = document.elementsFromPoint(ev.clientX, ev.clientY).map((n) => n.closest(".sk-card.on-board")).find((n) => n && n !== A.el);
      const t = hitEl ? [...this.c.items.values()].find((it) => it.el === hitEl) ?? null : null;
      if (t !== target) { target?.el.removeClass("is-target"); target = t; target?.el.addClass("is-target"); }
    };
    const up = () => {
      if (ended) return;
      ended = true;
      ["pointermove", "pointerup", "pointercancel", "lostpointercapture"].forEach((k) => cap.removeEventListener(k, k === "pointermove" ? (move as EventListener) : up));
      tmp.remove();
      this.c.root.removeClass("is-linking");
      if (target) { target.el.removeClass("is-target"); this.connect(A, target); }
    };
    cap.addEventListener("pointermove", move);
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((k) => cap.addEventListener(k, up));
  }

  private connect(A: Item, B: Item): void {
    const a = A.node.id, b = B.node.id;
    if (a === b || this.c.data.edges.some((x) => (x.fromNode === a && x.toNode === b) || (x.fromNode === b && x.toNode === a))) return;
    const edge: BoardEdge = { id: newId(), fromNode: a, toNode: b };
    this.c.data.edges.push(edge);
    const e = this.mount(edge);
    this.list.push(e);
    this.render();
    this.c.host.changed();
    // 新连线从起点画出来。
    const len = e.line.getTotalLength(), st = e.line.style;
    Object.assign(st, { strokeDasharray: `${len}`, strokeDashoffset: `${len}` });
    e.line.getBoundingClientRect();
    Object.assign(st, { transition: "stroke-dashoffset 380ms cubic-bezier(.3,.7,.2,1)", strokeDashoffset: "0" });
    window.setTimeout(() => (st.cssText = ""), 420);
  }

  /** 双击连线：在中点写一个短标签，回车确定，Esc 取消，清空就是去掉标签。 */
  private edit(e: E): void {
    const inp = this.labels.createEl("input", { cls: "sk-l-edit", attr: { maxlength: "12", placeholder: "关系" } });
    inp.value = e.edge.label ?? "";
    Object.assign(inp.style, { left: `${e.m[0]}px`, top: `${e.m[1]}px` });
    e.lab.style.visibility = "hidden";
    inp.focus();
    inp.select();
    let done = false;
    const fin = (ok: boolean) => {
      if (done) return;
      done = true;
      if (ok) {
        const v = inp.value.trim();
        if (v) e.edge.label = v; else delete e.edge.label;
        this.c.host.changed();
      }
      inp.remove();
      e.lab.style.visibility = "";
      this.render();
      this.c.root.focus({ preventScroll: true });
    };
    inp.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Enter" && !ev.isComposing) fin(true); if (ev.key === "Escape") fin(false); });
    inp.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    inp.addEventListener("blur", () => fin(true));
  }
}
