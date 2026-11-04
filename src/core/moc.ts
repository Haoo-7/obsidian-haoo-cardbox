import type { BoardData, BoardEdge, BoardNode } from "./types";

interface Neighbor {
  node: BoardNode;
  edge: BoardEdge;
}

function byPosition(a: BoardNode, b: BoardNode): number {
  return a.y - b.y || a.x - b.x;
}

/** 连线先生成广度优先树，再按树的先序生成体现摆位的 MOC 正文。 */
export function buildMoc(data: BoardData, linkOf: (path: string) => string): string {
  const nodes = data.nodes.filter((node) => !node.missing).sort(byPosition);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map(nodes.map((node) => [node.id, [] as Neighbor[]]));
  const edges = data.edges.filter((edge) => byId.has(edge.fromNode) && byId.has(edge.toNode));
  for (const edge of edges) {
    neighbors.get(edge.fromNode)!.push({ node: byId.get(edge.toNode)!, edge });
    neighbors.get(edge.toNode)!.push({ node: byId.get(edge.fromNode)!, edge });
  }
  for (const list of neighbors.values()) {
    list.sort((a, b) => byPosition(a.node, b.node));
  }

  const visited = new Set<string>();
  const groups: string[] = [];
  for (const root of nodes) {
    if (visited.has(root.id)) continue;
    const members = new Set([root.id]);
    const treeEdges = new Set<BoardEdge>();
    const children = new Map<string, Neighbor[]>();
    visited.add(root.id);
    let layer = [root];
    while (layer.length > 0) {
      const next: BoardNode[] = [];
      // 按整层摆位决定首次经过的父卡片，避免连线的存储顺序左右 MOC 骨架。
      for (const node of layer.sort(byPosition)) {
        for (const neighbor of neighbors.get(node.id)!) {
          if (visited.has(neighbor.node.id)) continue;
          visited.add(neighbor.node.id);
          members.add(neighbor.node.id);
          treeEdges.add(neighbor.edge);
          const list = children.get(node.id) ?? [];
          list.push(neighbor);
          children.set(node.id, list);
          next.push(neighbor.node);
        }
      }
      layer = next;
    }

    const lines: string[] = [];
    const stack: Array<{ node: BoardNode; depth: number; edge?: BoardEdge }> = [
      { node: root, depth: 0 },
    ];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const label = current.edge?.label ? `—${current.edge.label}→ ` : "";
      lines.push(`${"  ".repeat(current.depth)}- ${label}${linkOf(current.node.file)}`);
      const list = children.get(current.node.id) ?? [];
      for (let index = list.length - 1; index >= 0; index--) {
        stack.push({ ...list[index], depth: current.depth + 1 });
      }
    }
    for (const edge of edges) {
      if (!members.has(edge.fromNode) || treeEdges.has(edge) || !edge.label) continue;
      lines.push(`- ${linkOf(byId.get(edge.fromNode)!.file)} —${edge.label}→ ${linkOf(byId.get(edge.toNode)!.file)}`);
    }
    groups.push(lines.join("\n"));
  }
  return groups.join("\n\n");
}
