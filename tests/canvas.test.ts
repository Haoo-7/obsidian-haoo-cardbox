import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyBoard, toJsonCanvas } from "../src/core";
import type { BoardData, BoardNode } from "../src/core";

function card(id: string): BoardNode {
  return { id, type: "file", file: `${id}.md`, x: 10.6, y: -18.6, width: 168.4, height: 112.7 };
}

test("JSON Canvas 卡片只含标准字段，坐标与尺寸四舍五入为整数", () => {
  const data: BoardData = {
    ...emptyBoard(),
    nodes: [{ ...card("a"), flipped: true, missing: false }],
    custom: "不导出",
  };
  assert.deepEqual(toJsonCanvas(data), {
    nodes: [{ id: "a", type: "file", file: "a.md", x: 11, y: -19, width: 168, height: 113 }],
    edges: [],
  });
});

test("JSON Canvas 连线包含标准字段和可选标签，空标签原样保留", () => {
  const data: BoardData = {
    ...emptyBoard(),
    nodes: [card("a"), card("b")],
    edges: [
      { id: "ab", fromNode: "a", toNode: "b", label: "依据" },
      { id: "ba", fromNode: "b", toNode: "a" },
      { id: "empty", fromNode: "a", toNode: "b", label: "" },
    ],
  };
  assert.deepEqual(toJsonCanvas(data).edges, [
    { id: "ab", fromNode: "a", toNode: "b", label: "依据" },
    { id: "ba", fromNode: "b", toNode: "a" },
    { id: "empty", fromNode: "a", toNode: "b", label: "" },
  ]);
});

test("JSON Canvas 跳过缺失卡片以及任一端缺失或不存在的连线", () => {
  const data: BoardData = {
    ...emptyBoard(),
    nodes: [card("a"), { ...card("m"), missing: true }, card("b")],
    edges: [
      { id: "am", fromNode: "a", toNode: "m" },
      { id: "mb", fromNode: "m", toNode: "b" },
      { id: "absent", fromNode: "不存在", toNode: "a" },
      { id: "ab", fromNode: "a", toNode: "b" },
    ],
  };
  const canvas = toJsonCanvas(data);
  assert.equal(canvas.nodes.length, 2);
  assert.deepEqual(canvas.edges, [{ id: "ab", fromNode: "a", toNode: "b" }]);
  assert.deepEqual(canvas.nodes, toJsonCanvas({ ...emptyBoard(), nodes: [card("a"), card("b")] }).nodes);
});

test("JSON Canvas 不含笔迹、视口和版本字段", () => {
  const data: BoardData = {
    ...emptyBoard(),
    strokes: [
      { id: "s", type: "pen", color: "ink", points: [[1, 2]] },
      { id: "t", type: "text", color: "blue", x: 0, y: 0, text: "中文" },
    ],
    viewport: { x: 10, y: 20, zoom: 0.5 },
  };
  assert.deepEqual(toJsonCanvas(data), { nodes: [], edges: [] });
});

test("JSON Canvas 输出与输入独立，不修改原画板", () => {
  const data: BoardData = {
    ...emptyBoard(),
    nodes: [card("a"), card("b")],
    edges: [{ id: "ab", fromNode: "a", toNode: "b", label: "依据" }],
  };
  const before = structuredClone(data);
  const canvas = toJsonCanvas(data);
  (canvas.nodes[0] as { x: number }).x = 999;
  (canvas.edges[0] as { label: string }).label = "外部修改";
  assert.deepEqual(data, before);
});

test("空画板能够导出空 JSON Canvas", () => {
  assert.deepEqual(toJsonCanvas(emptyBoard()), { nodes: [], edges: [] });
});
