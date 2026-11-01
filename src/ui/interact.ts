import type { BoardCanvas, Item } from "./canvas";
import { pose, settle, tilter } from "./card";

const MIN_ZOOM = 0.35, MAX_ZOOM = 1.6;

/**
 * 卡片上的指针：
 * - 按住拖动：挪位置，选中的几张一起动；
 * - 没动就松手：单击选中，⇧ 加选；⌘ / Ctrl 单击在右侧分栏打开原笔记；
 * - 双击：翻面。
 */
export function bindCard(c: BoardCanvas, it: Item): void {
  const el = it.el;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    c.root.focus({ preventScroll: true });
    const add = e.shiftKey;
    // 按下就选中，不等松手：点下去的那一刻就要看到选中环。
    // 已经选中的卡要等松手再处理：可能是要拖着整组走，也可能是 ⇧ 单击取消选中。
    const wasSel = el.hasClass("is-sel");
    if (!wasSel) c.select(it, add);
    el.addClass("is-press");
    const group = el.hasClass("is-sel") ? c.selected() : [it];
    if (!group.includes(it)) group.push(it);
    const start = group.map((g) => [g.node.x, g.node.y]);
    const tilt = tilter(el);
    let moved = false, lastX = e.clientX;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const z = c.view.zoom, dx = (ev.clientX - e.clientX) / z, dy = (ev.clientY - e.clientY) / z;
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
      if (!moved) { moved = true; el.removeClass("is-press"); group.forEach((g) => g.el.addClass("is-drag")); }
      group.forEach((g, i) => { g.node.x = start[i][0] + dx; g.node.y = start[i][1] + dy; pose(g.el, g.node, 0); });
      tilt(ev.clientX - lastX);
      lastX = ev.clientX;
    };
    // 松手可能以三种方式到达：pointerup、pointercancel、指针捕获被收回（lostpointercapture）。
    // 漏掉后两种的话，卡会卡在「拖着」的状态，下一次保存还会把半截的坐标写进笔记。只处理第一次。
    let ended = false;
    const up = () => {
      if (ended) return;
      ended = true;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("lostpointercapture", up);
      el.removeClass("is-press");
      if (moved) {
        group.forEach((g) => {
          g.node.x = Math.round(g.node.x);
          g.node.y = Math.round(g.node.y);
          g.el.removeClass("is-drag");
          settle(g.el);
        });
        c.host.changed();
      } else if (e.metaKey || e.ctrlKey) {
        if (!it.node.missing) c.host.open(it.node.file, true);
      } else if (wasSel) {
        // 点的是已经选中的卡：⇧ 单击取消它；普通单击收成只选它一张。
        if (add) c.select(it, true);
        else c.select(it, false);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  });
  el.addEventListener("dblclick", (e) => { e.stopPropagation(); void c.flip(it); });
  el.addEventListener("mouseover", (e) => { if (!it.node.missing) c.host.hover(e, it.node.file, el); });
}

/** 画板空白处：拖动平移，单击取消选中；⌘ / Ctrl + 滚轮（含触控板双指捏合）缩放，普通滚轮平移。 */
export function bindViewport(c: BoardCanvas): void {
  const vp = c.vp;
  c.root.tabIndex = 0;
  vp.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    c.root.focus({ preventScroll: true });
    const v = c.view, s = { x: v.x, y: v.y };
    let moved = false;
    vp.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      vp.addClass("is-pan");
      v.x = s.x + dx;
      v.y = s.y + dy;
      c.applyView();
    };
    let ended = false;
    const up = () => {
      if (ended) return;
      ended = true;
      vp.removeEventListener("pointermove", move);
      vp.removeEventListener("pointerup", up);
      vp.removeEventListener("pointercancel", up);
      vp.removeEventListener("lostpointercapture", up);
      vp.removeClass("is-pan");
      if (moved) c.host.viewChanged();
      else c.clearSel();
    };
    vp.addEventListener("pointermove", move);
    vp.addEventListener("pointerup", up);
    vp.addEventListener("pointercancel", up);
    vp.addEventListener("lostpointercapture", up);
  });
  let t = 0;
  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    const v = c.view;
    if (e.ctrlKey || e.metaKey) {
      const r = vp.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const wx = (px - v.x) / v.zoom, wy = (py - v.y) / v.zoom;
      v.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.0025)));
      v.x = px - wx * v.zoom;
      v.y = py - wy * v.zoom;
    } else {
      v.x -= e.deltaX;
      v.y -= e.deltaY;
    }
    c.applyView();
    window.clearTimeout(t);
    t = window.setTimeout(() => c.host.viewChanged(), 300);
  }, { passive: false });
}
