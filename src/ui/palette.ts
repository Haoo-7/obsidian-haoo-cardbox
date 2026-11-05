import { setTooltip } from "obsidian";
import { SWATCHES, normalizeHex } from "../core";

/**
 * 卡片颜色：右键卡片后在指针旁边弹出的一条色卡，七种卡纸加「跟类型」。
 * 点一下上色，点外面、按 Esc、滚轮缩放画板都会收起来。
 */
let dispose: (() => void) | null = null;

export function closeCardPalette(): void {
  dispose?.();
}

export function openCardPalette(
  root: HTMLElement,
  anchor: HTMLElement,
  current: string | null,
  pick: (hex: string | null) => void,
): void {
  dispose?.();
  const box = root.createDiv({ cls: "sk-palette", attr: { role: "dialog", "aria-label": "卡片颜色" } });
  const now = current ? normalizeHex(current) : null;

  const auto = box.createEl("button", { cls: "sk-palette-auto", text: "跟类型", attr: { type: "button" } });
  auto.toggleClass("is-active", now === null);
  setTooltip(auto, "用笔记类型本来的纸色");
  auto.addEventListener("click", () => { pick(null); close(); });

  box.createSpan({ cls: "sk-palette-sep" });

  const dots: HTMLElement[] = [];
  for (const s of SWATCHES) {
    const b = box.createEl("button", { cls: "sk-palette-dot", attr: { type: "button" } });
    b.style.setProperty("--c", s.hex);
    b.toggleClass("is-active", now === s.hex);
    setTooltip(b, s.name);
    b.addEventListener("click", () => { pick(s.hex); close(); });
    dots.push(b);
  }

  // 贴着卡片下沿居中弹出来；下面放不下就翻到卡片上面。先量大小再定位，免得被画板边缘裁掉。
  box.addClass("is-measuring");
  const r = root.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const w = box.offsetWidth, h = box.offsetHeight;
  const left = Math.max(8, Math.min(a.left - r.left + (a.width - w) / 2, r.width - w - 8));
  const under = a.bottom - r.top + 8 + h <= r.height - 8;
  const top = under ? a.bottom - r.top + 8 : a.top - r.top - h - 8;
  box.style.left = `${left}px`;
  box.style.top = `${Math.max(8, top)}px`;
  box.removeClass("is-measuring");

  // 画板可能开在独立的弹出窗口里：监听和计时都跟着它自己的 document / window 走。
  const doc = box.doc, win = box.win;
  const close = () => {
    off();
    root.focus({ preventScroll: true });
  };
  const off = () => {
    box.remove();
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", key, true);
    root.removeEventListener("wheel", wheel);
    if (dispose === off) dispose = null;
  };
  const outside = (e: PointerEvent) => { if (!box.contains(e.target as Node)) off(); };
  const key = (e: KeyboardEvent) => {
    if (!box.contains(e.target as Node)) return;
    e.stopPropagation(); // 别让画板把 Delete、V、P 这些当成命令
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  };
  const wheel = () => off();
  dispose = off;
  // 打开它的那一下还在冒泡，等一等再听外面。
  win.setTimeout(() => {
    doc.addEventListener("pointerdown", outside, true);
    doc.addEventListener("keydown", key, true);
    root.addEventListener("wheel", wheel, { passive: true });
  }, 0);

  (now === null ? auto : dots.find((d) => d.hasClass("is-active")) ?? auto).focus({ preventScroll: true });
}
