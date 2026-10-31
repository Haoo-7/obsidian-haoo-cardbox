import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyBoard, markMissing, packDrop, relink, removeNodes, renameFile } from "../src/core";
import type { BoardData, Point } from "../src/core";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function board(): BoardData {
  return freeze({
    ...emptyBoard(),
    nodes: [
      { id: "a", type: "file", file: "共同.md", x: 0, y: 0, width: 168, height: 112 },
      { id: "b", type: "file", file: "共同.md", x: 200, y: 0, width: 168, height: 112 },
      { id: "c", type: "file", file: "保留.md", x: 400, y: 0, width: 168, height: 112, flipped: true },
      { id: "d", type: "file", file: "缺失.md", x: 0, y: 200, width: 168, height: 112, missing: true },
    ],
    edges: [
      { id: "ab", fromNode: "a", toNode: "b", label: "依据" },
      { id: "bc", fromNode: "b", toNode: "c" },
      { id: "cd", fromNode: "c", toNode: "d" },
      { id: "ac", fromNode: "a", toNode: "c" },
    ],
    strokes: [{ id: "s", type: "pen", color: "ink", points: [[0, 0], [10, 10]] }],
    custom: { keep: true },
  });
}

test("笔记改名会更新所有匹配路径的卡片，不修改输入", () => {
  const data = board();
  const before = structuredClone(data);
  const updated = renameFile(data, "共同.md", "目录/新名.md");
  assert.notStrictEqual(updated, data);
  assert.deepEqual(updated.nodes.map((node) => node.file), ["目录/新名.md", "目录/新名.md", "保留.md", "缺失.md"]);
  assert.deepEqual(updated.edges, data.edges);
  assert.deepEqual(updated.strokes, data.strokes);
  assert.deepEqual(updated.custom, { keep: true });
  assert.deepEqual(data, before);
});

test("笔记删除后所有对应卡片标记缺失，连线和输入完整保留", () => {
  const data = board();
  const before = structuredClone(data);
  const updated = markMissing(data, "共同.md");
  assert.notStrictEqual(updated, data);
  assert.deepEqual(updated.nodes.map((node) => node.missing), [true, true, undefined, true]);
  assert.deepEqual(updated.edges, data.edges);
  assert.deepEqual(updated.strokes, data.strokes);
  assert.deepEqual(data, before);
});

test("缺失卡片重新指向笔记后去掉 missing，保留标识和连线且不修改输入", () => {
  const data = board();
  const before = structuredClone(data);
  const updated = relink(data, "d", "重新找到.md");
  assert.notStrictEqual(updated, data);
  assert.deepEqual(updated.nodes[3], {
    id: "d", type: "file", file: "重新找到.md", x: 0, y: 200, width: 168, height: 112,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(updated.nodes[3], "missing"), false);
  assert.deepEqual(updated.nodes.slice(0, 3), data.nodes.slice(0, 3));
  assert.deepEqual(updated.edges, data.edges);
  assert.deepEqual(data, before);
});

test("移除卡片同时移除两端相关连线，保留其他内容且不修改输入", () => {
  const data = board();
  const before = structuredClone(data);
  const ids = freeze(["b", "d", "b"]);
  const updated = removeNodes(data, ids);
  assert.notStrictEqual(updated, data);
  assert.deepEqual(updated.nodes, [data.nodes[0], data.nodes[2]]);
  assert.deepEqual(updated.edges, [{ id: "ac", fromNode: "a", toNode: "c" }]);
  assert.deepEqual(updated.strokes, data.strokes);
  assert.deepEqual(updated.viewport, data.viewport);
  assert.deepEqual(updated.custom, data.custom);
  assert.deepEqual(data, before);
  assert.deepEqual(ids, ["b", "d", "b"]);
});

test("不存在的路径或卡片标识不改变内容，仍返回新的画板对象", () => {
  const data = board();
  for (const updated of [
    renameFile(data, "不存在.md", "新.md"),
    markMissing(data, "不存在.md"),
    relink(data, "不存在", "新.md"),
    removeNodes(data, ["不存在"]),
    removeNodes(data, []),
  ]) {
    assert.notStrictEqual(updated, data);
    assert.deepEqual(updated, data);
  }
});

test("从卡堆拖放默认每行四张，第一张左上角是落点", () => {
  assert.deepEqual(packDrop(["a", "b", "c", "d", "e", "f", "g", "h", "i"], [10, 20]), [
    { file: "a", x: 10, y: 20 }, { file: "b", x: 192, y: 20 },
    { file: "c", x: 374, y: 20 }, { file: "d", x: 556, y: 20 },
    { file: "e", x: 10, y: 146 }, { file: "f", x: 192, y: 146 },
    { file: "g", x: 374, y: 146 }, { file: "h", x: 556, y: 146 },
    { file: "i", x: 10, y: 272 },
  ]);
});

test("从卡堆拖放接受自定义尺寸、间距和每行张数，不修改参数", () => {
  const paths = freeze(["a", "b", "c"]);
  const at: Point = freeze([-10.5, -20.5]);
  const size = freeze({ w: 100, h: 80 });
  const gap = freeze({ x: 5, y: 7 });
  assert.deepEqual(packDrop(paths, at, size, gap, 2), [
    { file: "a", x: -10.5, y: -20.5 },
    { file: "b", x: 94.5, y: -20.5 },
    { file: "c", x: -10.5, y: 66.5 },
  ]);
  assert.deepEqual(paths, ["a", "b", "c"]);
  assert.deepEqual(at, [-10.5, -20.5]);
  assert.deepEqual(size, { w: 100, h: 80 });
  assert.deepEqual(gap, { x: 5, y: 7 });
});

test("从卡堆拖放空选择得到空数组，单列时沿 y 连续摆位", () => {
  assert.deepEqual(packDrop([], [0, 0]), []);
  assert.deepEqual(packDrop(["a", "b"], [0, 0], undefined, undefined, 1), [
    { file: "a", x: 0, y: 0 }, { file: "b", x: 0, y: 126 },
  ]);
});

test("从卡堆拖放拒绝非正整数的每行张数，避免产生无效坐标", () => {
  for (const perRow of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(() => packDrop(["a"], [0, 0], undefined, undefined, perRow), RangeError);
  }
});
