import { setIcon } from "obsidian";
import type { InkColor, Point, Stroke } from "../core";
import type { BoardCanvas } from "./canvas";

export type InkMode = "select" | "pen" | "line" | "rect" | "text" | "eraser";
type Pen = Extract<Stroke, { type: "pen" }>;
type Line = Extract<Stroke, { type: "line" }>;
type Rect = Extract<Stroke, { type: "rect" }>;
type Note = Extract<Stroke, { type: "text" }>;
type Box = [number, number, number, number];
interface Handle { get(): Point; set(p: Point): void; start?(): void; mid?: boolean; c?: SVGCircleElement; }
interface Mark { s: Stroke; el: HTMLElement | SVGElement; hit?: SVGElement; hs?: Handle[]; }

/** 画板上按这些键换工具。 */
export const MODE_KEYS: Record<string, InkMode> = { v: "select", p: "pen", l: "line", r: "rect", t: "text", e: "eraser" };
const TOOLS: [InkMode, string, string][] = [
  ["select", "mouse-pointer-2", "选择 V"],
  ["pen", "pencil", "画笔 P"],
  ["line", "spline", "直线 L（选中后拖中间的点弯成曲线）"],
  ["rect", "square", "矩形 R"],
  ["text", "type", "文字 T（也可以双击画板空白处）"],
  ["eraser", "eraser", "橡皮擦 E"],
];
const DRAW: InkMode[] = ["pen", "line", "rect", "text"];
const COLORS: [InkColor, string][] = [["ink", "墨"], ["rust", "赭"], ["blue", "靛"]];
const WIDTH = { pen: 2.6, line: 2.2, rect: 2 };
const END = ["pointerup", "pointercancel", "lostpointercapture"];

const newId = () => `m${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`;
const r1 = (v: number) => Math.round(v * 10) / 10;
const rp = (p: Point): Point => [r1(p[0]), r1(p[1])];
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** 松手后按 0.6px 容差抽稀笔迹的点。 */
function simplify(p: Point[], eps = 0.6): Point[] {
  if (p.length < 3) return p;
  let idx = 0, max = 0;
  for (let i = 1; i < p.length - 1; i++) { const d = segDist(p[i], p[0], p[p.length - 1]); if (d > max) { max = d; idx = i; } }
  return max > eps ? simplify(p.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(p.slice(idx), eps)) : [p[0], p[p.length - 1]];
}
function penPath(p: Point[]): string {
  if (p.length < 2) return p.length ? `M${p[0]} l0.1,0` : "";
  let d = `M${p[0]}`;
  for (let i = 1; i < p.length - 1; i++) d += ` Q${p[i]} ${mid(p[i], p[i + 1])}`;
  return `${d} L${p[p.length - 1]}`;
}
/** 直线的 m 是曲线正中间那一点（在线上）；二次曲线的控制点 = 2m − (a+b)/2。 */
function ctrl(s: Line & { m: Point }): Point {
  const h = mid(s.a, s.b);
  return [2 * s.m[0] - h[0], 2 * s.m[1] - h[1]];
}
function pts(s: Exclude<Stroke, { type: "text" }>): Point[] {
  if (s.type === "pen") return s.points;
  if (s.type === "rect") return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h], [s.x, s.y]];
  if (!s.m) return [s.a, s.b];
  const c = ctrl(s as Line & { m: Point }), out: Point[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    out.push([u * u * s.a[0] + 2 * u * t * c[0] + t * t * s.b[0], u * u * s.a[1] + 2 * u * t * c[1] + t * t * s.b[1]]);
  }
  return out;
}
function move(s: Stroke, dx: number, dy: number): void {
  const m = (p: Point): Point => [p[0] + dx, p[1] + dy];
  if (s.type === "pen") s.points = s.points.map(m);
  else if (s.type === "line") { s.a = m(s.a); s.b = m(s.b); if (s.m) s.m = m(s.m); }
  else { s.x += dx; s.y += dy; }
}
function round(s: Stroke): void {
  if (s.type === "pen") s.points = s.points.map(rp);
  else if (s.type === "line") { s.a = rp(s.a); s.b = rp(s.b); if (s.m) s.m = rp(s.m); }
  else { s.x = r1(s.x); s.y = r1(s.y); if (s.type === "rect") { s.w = r1(s.w); s.h = r1(s.h); } }
}
/** 按住 ⇧ 画直线：角度吸附到 15° 一档。 */
function snap(a: Point, p: Point, on: boolean): Point {
  if (!on) return p;
  const dx = p[0] - a[0], dy = p[1] - a[1], L = Math.hypot(dx, dy), step = Math.PI / 12;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return [a[0] + L * Math.cos(ang), a[1] + L * Math.sin(ang)];
}
/** 选中后的把手：直线两端加中间（拖中间弯成曲线，拖回中点附近变回直线），矩形四个角。 */
function handles(s: Stroke, z: number): Handle[] {
  if (s.type === "line") return [
    { get: () => s.a, set: (p) => { s.a = p; } },
    { get: () => s.b, set: (p) => { s.b = p; } },
    { get: () => s.m ?? mid(s.a, s.b), set: (p) => { const h = mid(s.a, s.b); s.m = Math.hypot(p[0] - h[0], p[1] - h[1]) < 6 / z ? null : p; }, mid: true },
  ];
  if (s.type === "rect") return ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).map(([i, j]) => {
    let o: Point = [0, 0];
    return {
      get: (): Point => [s.x + i * s.w, s.y + j * s.h],
      start: () => { o = [s.x + (1 - i) * s.w, s.y + (1 - j) * s.h]; },
      set: (p: Point) => { Object.assign(s, { x: Math.min(o[0], p[0]), y: Math.min(o[1], p[1]), w: Math.abs(p[0] - o[0]), h: Math.abs(p[1] - o[1]) }); },
    };
  });
  return [];
}
/** 指针捕获加上三种松手方式，只处理第一次。 */
function track(cap: Element, e: PointerEvent, mv: (ev: PointerEvent) => void, up: () => void): void {
  cap.setPointerCapture(e.pointerId);
  let ended = false;
  const m = (ev: Event) => mv(ev as PointerEvent);
  const u = () => {
    if (ended) return;
    ended = true;
    cap.removeEventListener("pointermove", m);
    END.forEach((k) => cap.removeEventListener(k, u));
    up();
  };
  cap.addEventListener("pointermove", m);
  END.forEach((k) => cap.addEventListener(k, u));
}

/**
 * 标注：画板上不属于卡片的东西，有笔迹、直线（可以弯成曲线）、矩形、文字。
 * 都在卡片之上、不贴在卡片上，卡片挪走它们留在原处。数据直接就是 data.strokes 里的对象，
 * 这里只另外记着它们的元素，所以撤销、保存都不用另外处理。
 * 选择模式下单击选中（⇧ / ⌘ 加选）、拖动挪位置、Delete 删、点颜色改色；双击文字改字，双击空白处新建文字。
 */
export class Ink {
  mode: InkMode = "select";
  private color: InkColor = "ink";
  private marks: Mark[] = [];
  private sel = new Set<Mark>();
  private byEl = new WeakMap<Element, Mark>();
  private svg: SVGSVGElement;
  private ui: SVGSVGElement;
  private texts: HTMLElement;
  private pad: HTMLElement;
  private ring: HTMLElement;
  private btns = new Map<InkMode, HTMLElement>();
  private dots: HTMLElement;

  constructor(private c: BoardCanvas) {
    const layer = (cls: string) => c.content.createSvg("svg", { cls, attr: { width: 20000, height: 20000, viewBox: "-10000 -10000 20000 20000" } });
    this.svg = layer("sk-i-svg");
    this.texts = c.content.createDiv({ cls: "sk-i-texts" });
    this.ui = layer("sk-i-ui");
    // 画图时接住指针的一层放在视口里：滚轮照样冒泡到视口去平移缩放。
    this.pad = c.vp.createDiv({ cls: "sk-i-pad" });
    this.ring = this.pad.createDiv({ cls: "sk-i-ring" });

    const bar = c.root.createDiv({ cls: "sk-i-bar", attr: { role: "toolbar", "aria-label": "画板工具" } });
    for (const [m, icon, title] of TOOLS) {
      const b = bar.createEl("button", { cls: "sk-i-tool clickable-icon", attr: { type: "button", "aria-label": title } });
      setIcon(b, icon);
      b.addEventListener("click", () => { this.setMode(m); c.root.focus({ preventScroll: true }); });
      this.btns.set(m, b);
    }
    bar.createSpan({ cls: "sk-i-sep" });
    this.dots = bar.createSpan({ cls: "sk-i-dots" });
    for (const [id, name] of COLORS) {
      const d = this.dots.createEl("button", { cls: "sk-i-dot", attr: { type: "button", "aria-label": name, "data-c": id } });
      d.addEventListener("click", () => { this.setColor(id); c.root.focus({ preventScroll: true }); });
    }
    bar.addEventListener("pointerdown", (e) => e.stopPropagation());
    bar.addEventListener("dblclick", (e) => e.stopPropagation());

    this.bindPad();
    this.bindSelect();
    this.setMode("select");
  }

  // ── 工具和颜色 ──
  setMode(m: InkMode): void {
    this.mode = m;
    this.c.root.dataset.ink = m;
    this.btns.forEach((b, id) => b.toggleClass("is-active", id === m));
    if (m !== "select") this.c.clearSel();
    this.ring.hide();
    this.paintDots();
  }
  /** 画图的四样工具、或者选中了标注时，工具条右边出现三种颜色；选中时点颜色就是改色。 */
  private setColor(id: InkColor): void {
    this.color = id;
    if (this.sel.size) {
      this.sel.forEach((M) => { M.s.color = id; this.refresh(M); });
      this.c.host.changed();
    }
    this.paintDots();
  }
  /** 选中了标注时圈出它们的颜色（颜色不一样就都不圈），否则圈出接下来要画的颜色。 */
  private paintDots(): void {
    this.c.root.toggleClass("sk-i-colors", DRAW.includes(this.mode) || this.sel.size > 0);
    const used = new Set([...this.sel].map((M) => M.s.color));
    const on = this.sel.size ? (used.size === 1 ? [...used][0] : null) : this.color;
    this.dots.querySelectorAll<HTMLElement>(".sk-i-dot").forEach((d) => d.toggleClass("is-active", d.dataset.c === on));
  }

  // ── 挂到页面、按数据重画 ──
  /** 打开、撤销、外部改了笔记：按 data.strokes 整个重画。 */
  load(): void {
    this.marks.forEach((M) => this.unmount(M));
    this.sel.clear();
    this.marks = this.c.data.strokes.map((s) => this.mount(s));
    this.draw();
  }
  private mount(s: Stroke): Mark {
    let M: Mark;
    if (s.type === "text") M = { s, el: this.texts.createDiv({ cls: "sk-i-text" }) };
    else {
      const tag = s.type === "rect" ? "rect" : "path";
      const el = this.svg.createSvg(tag, { cls: "sk-i-stroke", attr: { "stroke-width": WIDTH[s.type], ...(tag === "rect" ? { rx: 6 } : {}) } });
      // 再叠一条看不见的粗线，选中时好点。
      M = { s, el, hit: this.svg.createSvg(tag, { cls: "sk-i-hit", attr: tag === "rect" ? { rx: 6 } : {} }) };
      this.byEl.set(M.hit!, M);
    }
    this.byEl.set(M.el, M);
    this.refresh(M);
    return M;
  }
  private unmount(M: Mark): void { M.el.remove(); M.hit?.remove(); }
  private refresh(M: Mark): void {
    const s = M.s;
    M.el.dataset.c = s.color;
    if (s.type === "text") {
      const el = M.el as HTMLElement;
      if (!el.isContentEditable) el.setText(s.text);
      Object.assign(el.style, { left: `${s.x}px`, top: `${s.y}px` });
      return;
    }
    const attrs: Record<string, string> = s.type === "rect"
      ? { x: `${s.x}`, y: `${s.y}`, width: `${s.w}`, height: `${s.h}` }
      : { d: s.type === "pen" ? penPath(s.points) : s.m ? `M${s.a} Q${ctrl(s as Line & { m: Point })} ${s.b}` : `M${s.a} L${s.b}` };
    for (const n of [M.el, M.hit!]) for (const k in attrs) n.setAttribute(k, attrs[k]);
  }
  private box(M: Mark): Box {
    const s = M.s;
    if (s.type === "text") { const el = M.el as HTMLElement; return [s.x, s.y, s.x + el.offsetWidth, s.y + el.offsetHeight]; }
    const p = pts(s), xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  /** 橡皮擦用：碰到线就算，文字碰到外框就算，矩形只算边框。 */
  private hits(w: Point, r: number): Mark[] {
    return this.marks.filter((M) => {
      const [x0, y0, x1, y1] = this.box(M);
      if (w[0] < x0 - r || w[0] > x1 + r || w[1] < y0 - r || w[1] > y1 + r) return false;
      if (M.s.type === "text") return true;
      const p = pts(M.s);
      if (p.length === 1) return Math.hypot(w[0] - p[0][0], w[1] - p[0][1]) <= r;
      for (let i = 1; i < p.length; i++) if (segDist(w, p[i - 1], p[i]) <= r) return true;
      return false;
    });
  }
  /** 从数据和页面上拿掉几条标注，不通知视图。fade：橡皮擦擦掉的淡出一下再消失。 */
  private drop(list: Mark[], fade = false): void {
    const gone = new Set(list.map((M) => M.s));
    this.c.data.strokes = this.c.data.strokes.filter((s) => !gone.has(s));
    this.marks = this.marks.filter((M) => !list.includes(M));
    list.forEach((M) => {
      this.sel.delete(M);
      if (!fade) return this.unmount(M);
      M.hit?.remove();
      M.el.addClass("is-gone");
      window.setTimeout(() => M.el.remove(), 140);
    });
  }
  private adopt(M: Mark): void {
    round(M.s);
    this.c.data.strokes.push(M.s);
    this.marks.push(M);
    this.refresh(M);
  }
  private W(e: PointerEvent | MouseEvent): Point { return this.c.toWorld(e.clientX, e.clientY); }

  // ── 画图的工具：盖在画板上的一层接住指针，滚轮照样平移缩放 ──
  private bindPad(): void {
    const pad = this.pad;
    pad.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this.c.root.focus({ preventScroll: true });
      if (this.mode === "pen") this.pen(e);
      else if (this.mode === "line") this.line(e);
      else if (this.mode === "rect") this.rect(e);
      else if (this.mode === "text") this.newText(this.W(e));
      else if (this.mode === "eraser") this.erase(e);
    });
    // 橡皮擦：指针处一个小圈，碰得到的标注先淡一点。
    pad.addEventListener("pointermove", (e) => {
      if (this.mode !== "eraser") return;
      const r = pad.getBoundingClientRect();
      this.ring.show();
      Object.assign(this.ring.style, { left: `${e.clientX - r.left}px`, top: `${e.clientY - r.top}px` });
      const near = new Set(e.buttons ? [] : this.hits(this.W(e), 9 / this.c.view.zoom));
      this.marks.forEach((M) => M.el.toggleClass("is-near", near.has(M)));
    });
    pad.addEventListener("pointerleave", () => { this.ring.hide(); this.marks.forEach((M) => M.el.removeClass("is-near")); });
  }

  /** 画笔：轻微平滑去掉手抖，松手补上最后一个点再抽稀。画完留在画笔，可以接着画。 */
  private pen(e: PointerEvent): void {
    const s: Pen = { id: newId(), type: "pen", color: this.color, points: [this.W(e)] };
    const M = this.mount(s);
    let sm = s.points[0], raw = sm;
    track(this.pad, e, (ev) => {
      const list = ev.getCoalescedEvents?.() ?? [];
      for (const q of list.length ? list : [ev]) {
        raw = this.W(q);
        sm = [sm[0] * 0.45 + raw[0] * 0.55, sm[1] * 0.45 + raw[1] * 0.55];
        const l = s.points[s.points.length - 1];
        if (Math.hypot(sm[0] - l[0], sm[1] - l[1]) > 1.2 / this.c.view.zoom) s.points.push(sm);
      }
      this.refresh(M);
    }, () => {
      const l = s.points[s.points.length - 1];
      if (Math.hypot(raw[0] - l[0], raw[1] - l[1]) > 0.5) s.points.push(raw);
      s.points = simplify(s.points);
      this.adopt(M);
      this.c.host.changed();
    });
  }
  /** 直线：按住 ⇧ 吸附到 15° 一档。 */
  private line(e: PointerEvent): void {
    const a = this.W(e), s: Line = { id: newId(), type: "line", color: this.color, a, b: a, m: null };
    const M = this.mount(s);
    track(this.pad, e, (ev) => { s.b = snap(a, this.W(ev), ev.shiftKey); this.refresh(M); },
      () => this.finish(M, Math.hypot(s.b[0] - a[0], s.b[1] - a[1]) > 6));
  }
  /** 矩形：只描边不填色，用来框出一组卡；按住 ⇧ 画正方形。 */
  private rect(e: PointerEvent): void {
    const a = this.W(e), s: Rect = { id: newId(), type: "rect", color: this.color, x: a[0], y: a[1], w: 0, h: 0 };
    const M = this.mount(s);
    track(this.pad, e, (ev) => {
      const p = this.W(ev);
      let w = p[0] - a[0], h = p[1] - a[1];
      if (ev.shiftKey) { const k = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * k; h = Math.sign(h || 1) * k; }
      Object.assign(s, { x: Math.min(a[0], a[0] + w), y: Math.min(a[1], a[1] + h), w: Math.abs(w), h: Math.abs(h) });
      this.refresh(M);
    }, () => this.finish(M, s.w > 6 && s.h > 6));
  }
  /** 直线、矩形画完：太小的当误触丢掉；否则回到选择并选中它，方便马上弯线、改大小。 */
  private finish(M: Mark, keep: boolean): void {
    if (!keep) return this.unmount(M);
    this.adopt(M);
    this.c.host.changed();
    this.setMode("select");
    this.select(M, false);
  }
  /** 橡皮擦：碰到哪条标注就擦掉整条。一次拖动只记一步历史。 */
  private erase(e: PointerEvent): void {
    let any = false;
    const rub = (ev: PointerEvent) => {
      const got = this.hits(this.W(ev), 9 / this.c.view.zoom);
      if (!got.length) return;
      this.drop(got, true);
      any = true;
    };
    rub(e);
    track(this.pad, e, rub, () => { if (any) this.c.host.changed(); });
  }

  // ── 文字：直接写在画板上，不是卡片。回车换行，Esc / ⌘↩ / 点别处结束；清空就删掉 ──
  private newText(w: Point): void {
    const s: Note = { id: newId(), type: "text", color: this.color, x: r1(w[0] - 4), y: r1(w[1] - 12), text: "" };
    const M = this.mount(s);
    this.setMode("select");
    this.edit(M, true);
  }
  private edit(M: Mark, isNew: boolean): void {
    const el = M.el as HTMLElement, s = M.s as Note, doc = el.doc;
    this.clearSel();
    el.contentEditable = "plaintext-only";
    el.addClass("is-editing");
    el.focus();
    const r = doc.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
    let done = false;
    const stop = (e: Event) => e.stopPropagation();
    const outside = (e: Event) => { if (!el.contains(e.target as Node)) fin(false); };
    const key = (e: KeyboardEvent) => {
      e.stopPropagation(); // 打字时不触发画板快捷键
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing)) { e.preventDefault(); fin(true); }
    };
    const fin = (refocus: boolean) => {
      if (done) return;
      done = true;
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("dblclick", stop);
      el.removeEventListener("keydown", key);
      el.removeEventListener("blur", onBlur);
      doc.removeEventListener("pointerdown", outside, true);
      el.contentEditable = "false";
      el.removeClass("is-editing");
      if (refocus) this.c.root.focus({ preventScroll: true });
      if (!el.isConnected) return; // 编辑途中画板被整个重画了
      const text = el.innerText.replace(/\s+$/, "");
      if (!text.trim()) {
        if (isNew) this.unmount(M);
        else { this.drop([M]); this.c.host.changed(); }
        return;
      }
      if (!isNew && text === s.text) return;
      s.text = text;
      if (isNew) this.adopt(M); else this.refresh(M);
      this.c.host.changed();
    };
    const onBlur = () => fin(false);
    el.addEventListener("pointerdown", stop);
    el.addEventListener("dblclick", stop);
    el.addEventListener("keydown", key);
    el.addEventListener("blur", onBlur);
    window.setTimeout(() => { if (!done) doc.addEventListener("pointerdown", outside, true); }, 0);
  }

  // ── 选择模式：点标注、拖着挪、双击改字、双击空白处新建文字 ──
  private markOf(t: EventTarget | null): Mark | undefined {
    const n = t instanceof Element ? (t.closest(".sk-i-text") ?? t) : null;
    return n ? this.byEl.get(n) : undefined;
  }
  private bindSelect(): void {
    const down = (e: PointerEvent) => {
      if (this.mode !== "select" || e.button !== 0) return;
      const M = this.markOf(e.target);
      if (!M || (M.el as HTMLElement).isContentEditable) return;
      e.stopPropagation();
      e.preventDefault();
      this.c.root.focus({ preventScroll: true });
      if (e.shiftKey || e.metaKey || e.ctrlKey) return this.select(M, true);
      if (!this.sel.has(M)) this.select(M, false);
      const group = [...this.sel];
      let last = this.W(e), moved = false;
      track(e.target as Element, e, (ev) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
        moved = true;
        const w = this.W(ev);
        group.forEach((g) => { move(g.s, w[0] - last[0], w[1] - last[1]); this.refresh(g); });
        last = w;
        this.draw();
      }, () => {
        if (!moved) return;
        group.forEach((g) => { round(g.s); this.refresh(g); });
        this.draw();
        this.c.host.changed();
      });
    };
    this.svg.addEventListener("pointerdown", down);
    this.texts.addEventListener("pointerdown", down);
    this.texts.addEventListener("dblclick", (e) => {
      const M = this.markOf(e.target);
      if (!M || this.mode !== "select" || (M.el as HTMLElement).isContentEditable) return;
      e.stopPropagation();
      this.edit(M, false);
    });
    this.c.vp.addEventListener("dblclick", (e) => {
      if (this.mode !== "select" || (e.target as Element).closest(".sk-card, .sk-l-lab, .sk-l-edit, .sk-i-text, .sk-i-hit, .sk-l-hit")) return;
      this.newText(this.W(e));
    });
  }

  /** add：⇧ / ⌘ 加选或取消；否则只选它一个，顺带清掉卡片和连线的选中。 */
  select(M: Mark, add: boolean): void {
    if (!add) this.c.clearSel();
    if (add && this.sel.has(M)) this.sel.delete(M);
    else this.sel.add(M);
    this.draw();
  }
  clearSel(): void {
    if (!this.sel.size) return;
    this.sel.clear();
    this.draw();
  }
  /** 删掉选中的标注，只改 data，不通知视图：和卡片、连线一起删时由画板统一记一次历史。 */
  dropSelected(): boolean {
    if (!this.sel.size) return false;
    this.drop([...this.sel]);
    this.draw();
    return true;
  }
  /** 缩放变了：外框和把手按屏幕大小重画。 */
  zoomed(): void { if (this.sel.size) this.draw(); }

  /** 选中的样子：笔迹和文字外面一圈虚线框；直线和矩形只显示把手。 */
  private draw(): void {
    this.ui.empty();
    const z = this.c.view.zoom;
    this.marks.forEach((M) => M.el.toggleClass("is-sel", this.sel.has(M)));
    this.sel.forEach((M) => {
      if (M.s.type === "pen" || M.s.type === "text") {
        const [x0, y0, x1, y1] = this.box(M), p = 5 / z;
        this.ui.createSvg("rect", { cls: "sk-i-box", attr: { x: x0 - p, y: y0 - p, width: x1 - x0 + 2 * p, height: y1 - y0 + 2 * p, rx: 4 / z } });
      }
      M.hs = handles(M.s, z);
      M.hs.forEach((h) => {
        h.c = this.ui.createSvg("circle", { cls: h.mid ? ["sk-i-handle", "is-mid"] : "sk-i-handle", attr: { r: 5 / z } });
        h.c.addEventListener("pointerdown", (e) => this.grab(e, M, h));
      });
      this.place(M);
    });
    this.paintDots();
  }
  private place(M: Mark): void {
    M.hs?.forEach((h) => { const p = h.get(); h.c?.setAttribute("cx", `${p[0]}`); h.c?.setAttribute("cy", `${p[1]}`); });
  }
  private grab(e: PointerEvent, M: Mark, h: Handle): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    h.start?.();
    track(e.currentTarget as Element, e, (ev) => { h.set(this.W(ev)); this.refresh(M); this.place(M); }, () => {
      round(M.s);
      this.refresh(M);
      this.draw();
      this.c.host.changed();
    });
  }
}
