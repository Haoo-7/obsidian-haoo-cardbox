import { inkOf, splitTitle } from "../core";
import type { VaultNote } from "../core";

/** 卡片尺寸。画板坐标、拖放排布、导出 .canvas 都用这一个值。 */
export const CARD_W = 168;
export const CARD_H = 112;

const dot = (d?: string) => (d || "").replace(/-/g, ".");

/**
 * 卡片：画板和卡堆共用同一个组件。外层 .sk-card 管位置（--x --y --r --s），内层 .sk-in 管翻面、拿起和倾斜，
 * 两者分开是因为拖动时位置每帧都在变，而翻面和拿起要走 CSS 过渡。
 * note 为空时画成缺失卡片：原笔记被删了，只剩虚线框和原来的文件名。
 */
export function makeCard(note: VaultNote | undefined, path: string, ctx?: string, color?: string): HTMLElement {
  const title = note?.title ?? path.split("/").pop()!.replace(/\.md$/, "");
  const n = createDiv({ cls: "sk-card" });
  n.dataset.path = path;
  n.dataset.type = note?.type ?? "uncategorized";
  if (!note) n.addClass("is-miss");
  // 用户上过色的卡：纸色换成他挑的那一种，字色按底色深浅来。缺失卡片不上色。
  if (note && color) paintTint(n, color);

  const inner = n.createDiv({ cls: "sk-in" });
  const front = inner.createDiv({ cls: "sk-side sk-front" });
  const others = note ? note.domains.filter((d) => d !== ctx) : [];
  const tag = note ? (others.length ? others : note.domains).slice(0, 2).join(" · ") : "原笔记已删除";
  front.createSpan({ cls: "sk-tag", text: tag });
  const shown = splitTitle(title).title;
  front.createEl("h3", { cls: "sk-title", text: shown });
  front.createSpan({ cls: "sk-date", text: dot(note?.date) });
  // 缩小态只显示标题前 4 个字；开头的书名号、引号不算。
  front.createSpan({ cls: "sk-tiny", text: [...shown.replace(/^[《「『“"（(]+/u, "")].slice(0, 4).join("") });

  const back = inner.createDiv({ cls: "sk-side sk-back" });
  back.createEl("p", { cls: "sk-ex", text: note?.excerpt || "" });
  const rows = back.createDiv({ cls: "sk-rows" });
  for (const [k, v] of [["来源", note?.source || "未记来源"], ["作者", note?.author || "未记作者"], ["日期", dot(note?.date)]]) {
    const r = rows.createDiv();
    r.createSpan({ text: k });
    r.appendText(v);
  }
  return n;
}

/**
 * 上色：只换纸色，字色看底色深浅；null 回到笔记类型本来的纸色。
 * 卡片元素每次重画都是新造的，所以颜色直接写在行内样式上，不用另外记状态。
 */
export function paintTint(el: HTMLElement, hex: string | null): void {
  if (!hex) {
    el.removeClass("is-tint");
    delete el.dataset.ink;
    el.style.removeProperty("--face");
    return;
  }
  el.addClass("is-tint");
  el.dataset.ink = inkOf(hex);
  el.style.setProperty("--face", hex);
}

/** 翻到背面时才去读正文开头：一块画板上几十张卡，没必要一打开就全读。 */
export function fillExcerpt(n: HTMLElement, text: string): void {
  const ex = n.querySelector(".sk-ex");
  if (ex) ex.textContent = text || "（这篇笔记还没有正文）";
}

/** 摆位置。s 是缩放，x/y 是缩放后卡片左上角所在的位置。 */
export function pose(n: HTMLElement, p: { x: number; y: number; r?: number; s?: number }, dur = 260, delay = 0): void {
  const s = p.s ?? 1;
  const st = n.style;
  st.setProperty("--x", `${p.x - (CARD_W * (1 - s)) / 2}px`);
  st.setProperty("--y", `${p.y - (CARD_H * (1 - s)) / 2}px`);
  st.setProperty("--r", `${p.r ?? 0}deg`);
  st.setProperty("--s", String(s));
  st.setProperty("--dur", `${dur}ms`);
  st.setProperty("--d", `${delay}ms`);
}

/** 拖动时的倾斜：跟着横向速度走，最多 3°，平滑一下免得抖。 */
export function tilter(n: HTMLElement): (dx: number) => void {
  let t = 0;
  return (dx) => {
    t = t * 0.8 + Math.max(-3, Math.min(3, dx * 0.35)) * 0.2;
    n.style.setProperty("--tilt", `${t.toFixed(2)}deg`);
  };
}

/** 放下时把倾斜归零。重置值收在常量里：它是动画状态，不是主题样式。 */
const TILT_ZERO = "0deg";
export function resetTilt(n: HTMLElement): void {
  n.style.setProperty("--tilt", TILT_ZERO);
}

/** 放下时的落定：一次 140ms 的回弹。 */
export function settle(n: HTMLElement): void {
  n.removeClass("is-settle");
  void n.offsetWidth;
  n.addClass("is-settle");
  resetTilt(n);
  window.setTimeout(() => n.removeClass("is-settle"), 200);
}
