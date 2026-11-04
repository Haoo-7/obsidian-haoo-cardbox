/** 卡纸和文件夹共用的一套颜色；卡片上色和文件夹换色用的是同一组。 */
export interface Swatch {
  id: string;
  name: string;
  /** #rrggbb：JSON Canvas 也认这个写法，导出 .canvas 时不用换算。 */
  hex: string;
}

export const SWATCHES: Swatch[] = [
  { id: "graphite", name: "石墨", hex: "#3a3b3f" },
  { id: "mist", name: "雾白", hex: "#e9eaee" },
  { id: "oat", name: "燕麦", hex: "#e4d8c4" },
  { id: "sage", name: "鼠尾草", hex: "#a9b8a2" },
  { id: "slate", name: "雾蓝", hex: "#8fa3b8" },
  { id: "clay", name: "陶土", hex: "#c08a72" },
  { id: "plum", name: "梅子", hex: "#6e5a72" },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** 卡片颜色只认 #rrggbb；别的写法读作没上色，不去猜。 */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/**
 * 这个底色上该用浅字还是深字。
 * 按相对亮度（WCAG 的算法）判断：黑白字对比度相等的地方在亮度 0.18 附近，取它当界线。
 */
export function inkOf(hex: string): "light" | "dark" {
  if (!isHexColor(hex)) return "dark";
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? "dark" : "light";
}

/** 写进笔记时统一成小写，免得 #A9B8A2 和 #a9b8a2 看着像两种颜色。 */
export function normalizeHex(hex: string): string {
  return hex.toLowerCase();
}
