import type { BoardData, Point } from "./types";

/** 笔记改名时保留卡片标识，使现有连线继续有效。 */
export function renameFile(data: BoardData, oldPath: string, newPath: string): BoardData {
  return {
    ...data,
    nodes: data.nodes.map((node) => node.file === oldPath ? { ...node, file: newPath } : node),
  };
}

/** 笔记删除后保留卡片和连线，等待用户重新指向或移除。 */
export function markMissing(data: BoardData, path: string): BoardData {
  return {
    ...data,
    nodes: data.nodes.map((node) => node.file === path ? { ...node, missing: true } : node),
  };
}

/** 缺失卡片重新指向笔记时移除缺失标记，连线仍沿用卡片标识。 */
export function relink(data: BoardData, nodeId: string, newPath: string): BoardData {
  return {
    ...data,
    nodes: data.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      const { missing: _missing, ...rest } = node;
      return { ...rest, file: newPath };
    }),
  };
}

/** 用户移除卡片时同步移除相连的连线，避免留下悬空端点。 */
export function removeNodes(data: BoardData, ids: string[]): BoardData {
  const removed = new Set(ids);
  return {
    ...data,
    nodes: data.nodes.filter((node) => !removed.has(node.id)),
    edges: data.edges.filter((edge) => !removed.has(edge.fromNode) && !removed.has(edge.toNode)),
  };
}

/** 从卡堆拖入多张卡片时保留选择顺序，并从落点开始紧凑摆位。 */
export function packDrop(
  paths: string[],
  at: Point,
  size = { w: 168, h: 112 },
  gap = { x: 14, y: 14 },
  perRow = 4,
): Array<{ file: string; x: number; y: number }> {
  if (!Number.isInteger(perRow) || perRow < 1) {
    throw new RangeError("每行卡片数必须是正整数。");
  }
  return paths.map((file, index) => ({
    file,
    x: at[0] + (index % perRow) * (size.w + gap.x),
    y: at[1] + Math.floor(index / perRow) * (size.h + gap.y),
  }));
}
