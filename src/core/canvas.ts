import type { BoardData } from "./types";

/** 只输出 JSON Canvas 字段，让原生画板可以读取仍然存在的卡片和连线。 */
export function toJsonCanvas(data: BoardData): { nodes: unknown[]; edges: unknown[] } {
  const present = data.nodes.filter((node) => !node.missing);
  const ids = new Set(present.map((node) => node.id));
  return {
    nodes: present.map((node) => ({
      id: node.id,
      type: "file",
      file: node.file,
      x: Math.round(node.x),
      y: Math.round(node.y),
      width: Math.round(node.width),
      height: Math.round(node.height),
    })),
    edges: data.edges
      .filter((edge) => ids.has(edge.fromNode) && ids.has(edge.toNode))
      .map((edge) => ({
        id: edge.id,
        fromNode: edge.fromNode,
        toNode: edge.toNode,
        ...(edge.label !== undefined ? { label: edge.label } : {}),
      })),
  };
}
