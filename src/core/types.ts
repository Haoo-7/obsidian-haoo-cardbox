/** 画板笔记目前能够读写的数据版本。 */
export const BOARD_VERSION = 1;

/** 笔记类型只决定卡片的归类，不改变笔记本身。 */
export type NoteType = "literature" | "permanent" | "fleeting" | "uncategorized";

/** 适配层用 metadataCache 拼出来的一篇笔记。 */
export interface VaultNote {
  path: string;
  title: string;
  type: NoteType;
  domains: string[];
  date?: string;
  author?: string;
  source?: string;
  excerpt?: string;
  isBoard?: boolean;
}

/** 同一领域的卡堆，可以与其他卡堆共享卡片。 */
export interface Pile {
  name: string;
  count: number;
  cards: VaultNote[];
}

/** 卡片沿用 JSON Canvas 的字段，额外保留翻面和缺失状态。 */
export interface BoardNode {
  id: string;
  type: "file";
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  flipped?: boolean;
  missing?: boolean;
}

/** 连线沿用 JSON Canvas 的字段，但在画板上没有方向。 */
export interface BoardEdge {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
}

/** 笔迹和拖放共用画板坐标。 */
export type Point = [number, number];

/** 存颜色名字，让笔迹可以跟随主题变化。 */
export type InkColor = "ink" | "rust" | "blue";

/** 四种笔迹共享标识与颜色，并分别保留自身的几何数据。 */
export type Stroke =
  | { id: string; type: "pen"; color: InkColor; points: Point[] }
  | { id: string; type: "line"; color: InkColor; a: Point; b: Point; m: Point | null }
  | { id: string; type: "rect"; color: InkColor; x: number; y: number; w: number; h: number }
  | { id: string; type: "text"; color: InkColor; x: number; y: number; text: string };

/** 视口独立于卡片摆位，方便适配层决定是否记入撤销历史。 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** 顶层扩展字段随存档保留，避免旧插件写回时丢失额外数据。 */
export interface BoardData {
  version: number;
  nodes: BoardNode[];
  edges: BoardEdge[];
  strokes: Stroke[];
  viewport: Viewport;
  [extra: string]: unknown;
}

/** 手写区和数据块之后的文字与画板数据分开保存。 */
export interface ParsedBoardNote {
  head: string;
  data: BoardData;
  tail: string;
}

/** 每次创建独立的空画板，避免多块画板共享可变数组。 */
export function emptyBoard(): BoardData {
  return {
    version: BOARD_VERSION,
    nodes: [],
    edges: [],
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
