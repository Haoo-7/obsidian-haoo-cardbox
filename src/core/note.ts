import { BOARD_VERSION, emptyBoard } from "./types";
import type { BoardData, BoardEdge, BoardNode, ParsedBoardNote, Point, Stroke, Viewport } from "./types";

const MOC_START = "<!-- skeuo:moc -->";
const MOC_END = "<!-- /skeuo:moc -->";
const DATA_BLOCK =
  /^[ \t]*%%[ \t]*\r?\n[ \t]*```skeuo-board[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*\r?\n[ \t]*%%[ \t]*(?=\r?$)/m;

/** 解析失败时阻止写回，避免坏存档被空画板覆盖。 */
export class BoardParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardParseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasNumbers(value: Record<string, unknown>, ...fields: string[]): boolean {
  return fields.every((field) => isNumber(value[field]));
}

function isPoint(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(isNumber);
}

function isViewport(value: unknown): value is Viewport {
  return isRecord(value) && hasNumbers(value, "x", "y", "zoom");
}

function isNode(value: unknown): value is BoardNode {
  return isRecord(value)
    && typeof value.id === "string"
    && value.type === "file"
    && typeof value.file === "string"
    && hasNumbers(value, "x", "y", "width", "height")
    && (value.flipped === undefined || typeof value.flipped === "boolean")
    && (value.missing === undefined || typeof value.missing === "boolean");
}

function isEdge(value: unknown): value is BoardEdge {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.fromNode === "string"
    && typeof value.toNode === "string"
    && (value.label === undefined || typeof value.label === "string");
}

function isStroke(value: unknown): value is Stroke {
  if (!isRecord(value) || typeof value.id !== "string"
    || !["ink", "rust", "blue"].includes(String(value.color))) return false;
  switch (value.type) {
    case "pen":
      return Array.isArray(value.points) && value.points.every(isPoint);
    case "line":
      return isPoint(value.a) && isPoint(value.b) && (value.m === null || isPoint(value.m));
    case "rect":
      return hasNumbers(value, "x", "y", "w", "h");
    case "text":
      return hasNumbers(value, "x", "y") && typeof value.text === "string";
    default:
      return false;
  }
}

function readArray<T>(
  value: unknown,
  field: string,
  validate: (item: unknown) => item is T,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(validate)) {
    throw new BoardParseError(`画板数据的 ${field} 字段格式损坏。`);
  }
  return value;
}

function readStrokes(value: unknown): Stroke[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new BoardParseError("画板数据的 strokes 字段必须是数组。");
  }
  return value.map((item: unknown, index: number) => {
    if (!isRecord(item)) {
      throw new BoardParseError(`画板数据的第 ${index + 1} 条笔迹格式损坏。`);
    }
    const stroke = {
      ...item,
      type: item.type === undefined ? "pen" : item.type,
      color: item.color === "rust" || item.color === "blue" ? item.color : "ink",
    };
    if (!isStroke(stroke)) {
      throw new BoardParseError(`画板数据的第 ${index + 1} 条笔迹类型或坐标损坏。`);
    }
    return stroke;
  });
}

function readData(json: string): BoardData {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BoardParseError("画板数据块的 JSON 格式损坏，无法读取。");
  }
  if (!isRecord(raw)) {
    throw new BoardParseError("画板数据块必须是 JSON 对象。");
  }
  const version = raw.version === undefined ? BOARD_VERSION : raw.version;
  if (typeof version === "number" && version > BOARD_VERSION) {
    throw new BoardParseError(`画板数据版本 ${version} 高于当前支持的版本 ${BOARD_VERSION}。`);
  }
  if (!isNumber(version)) {
    throw new BoardParseError("画板数据的 version 字段必须是数字。");
  }
  const viewport = raw.viewport === undefined ? emptyBoard().viewport : raw.viewport;
  if (!isViewport(viewport)) {
    throw new BoardParseError("画板数据的 viewport 字段格式损坏。");
  }
  return {
    ...raw,
    version,
    nodes: readArray(raw.nodes, "nodes", isNode),
    edges: readArray(raw.edges, "edges", isEdge),
    strokes: readStrokes(raw.strokes),
    viewport,
  };
}

/** 只认 frontmatter 自身的画板标记，避免把继承属性误认成笔记内容。 */
export function isBoardNote(frontmatter: Record<string, unknown> | undefined): boolean {
  return frontmatter !== undefined
    && Object.prototype.hasOwnProperty.call(frontmatter, "skeuo-board")
    && Boolean(frontmatter["skeuo-board"]);
}

/** 手写区和尾部逐字保留，只有 MOC 正文会在写回时重新生成。 */
export function parseBoardNote(text: string): ParsedBoardNote {
  const block = DATA_BLOCK.exec(text);
  const beforeData = block ? text.slice(0, block.index) : text;
  const mocStart = beforeData.indexOf(MOC_START);
  return {
    head: mocStart < 0 ? beforeData : beforeData.slice(0, mocStart),
    data: block ? readData(block[1]) : emptyBoard(),
    tail: block ? text.slice(block.index + block[0].length) : "",
  };
}

/** 仅替换自动生成的部分，固定格式使重复保存产生相同字节。 */
export function serializeBoardNote(parsed: ParsedBoardNote, mocBody: string): string {
  const head = parsed.head.endsWith("\n") ? parsed.head : `${parsed.head}\n`;
  const block = `%%\n\`\`\`skeuo-board\n${JSON.stringify(parsed.data)}\n\`\`\`\n%%`;
  return `${head}${MOC_START}\n${mocBody}\n${MOC_END}\n\n${block}${parsed.tail}`;
}

/** 新画板笔记只包含画板标记、标题和可再次解析的空画板。 */
export function newBoardNote(title: string): string {
  return serializeBoardNote({
    head: `---\nskeuo-board: 1\n---\n# ${title}\n\n`,
    data: emptyBoard(),
    tail: "",
  }, "");
}
