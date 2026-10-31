import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMoc, emptyBoard } from "../src/core";
import type { BoardData, BoardEdge, BoardNode } from "../src/core";

function card(id: string, x: number, y: number, missing = false): BoardNode {
  return { id, type: "file", file: `${id}.md`, x, y, width: 168, height: 112, missing };
}

function link(fromNode: string, toNode: string, label?: string): BoardEdge {
  return { id: `${fromNode}-${toNode}`, fromNode, toNode, ...(label === undefined ? {} : { label }) };
}

function board(nodes: BoardNode[], edges: BoardEdge[] = []): BoardData {
  return { ...emptyBoard(), nodes, edges };
}

const linkOf = (path: string): string => `[[${path.slice(0, -3)}]]`;

test("空画板生成空 MOC 正文", () => {
  assert.equal(buildMoc(emptyBoard(), linkOf), "");
});

test("单张卡片直接采用适配层返回的完整链接，末尾没有换行", () => {
  const paths: string[] = [];
  assert.equal(buildMoc(board([card("A", 0, 0)]), (path) => {
    paths.push(path);
    return "[[目录/A|显示标题]]";
  }), "- [[目录/A|显示标题]]");
  assert.deepEqual(paths, ["A.md"]);
});

test("连通组按最靠上卡片的 y 再 x 排序，组间留一个空行", () => {
  const data = board([
    card("C", 5, 30), card("A2", 30, 20), card("B", 20, 0), card("A", 10, 0),
  ], [link("A2", "A")]);
  assert.equal(buildMoc(data, linkOf), "- [[A]]\n  - [[A2]]\n\n- [[B]]\n\n- [[C]]");
});

test("相同摆位的独立卡片按原存储顺序稳定输出", () => {
  assert.equal(buildMoc(board([card("B", 0, 0), card("A", 0, 0)]), linkOf), "- [[B]]\n\n- [[A]]");
});

test("组内同层邻居按 y 再 x 摆位，输出采用树的先序与两空格缩进", () => {
  const data = board([
    card("D", 0, 30), card("C", 20, 10), card("A", 0, 0), card("B", 10, 10),
  ], [link("A", "C"), link("B", "D"), link("A", "B")]);
  assert.equal(buildMoc(data, linkOf), "- [[A]]\n  - [[B]]\n    - [[D]]\n  - [[C]]");
});

test("广度优先保证直接相连的卡片不会被较长路径收为更深子卡片", () => {
  const data = board([
    card("A", 0, 0), card("B", 0, 10), card("C", 0, 20), card("D", 0, 30),
  ], [link("A", "B"), link("B", "D"), link("D", "C"), link("A", "C")]);
  assert.equal(buildMoc(data, linkOf), "- [[A]]\n  - [[B]]\n    - [[D]]\n  - [[C]]");
});

test("整层卡片按摆位遍历，首次经过共同邻居的卡片成为父卡片", () => {
  const data = board([
    card("A", 0, 0), card("B", 0, 10), card("C", 10, 10),
    card("D", 0, 40), card("E", 0, 20), card("F", 0, 50),
  ], [link("A", "B"), link("A", "C"), link("B", "D"), link("C", "E"), link("D", "F"), link("E", "F")]);
  assert.equal(buildMoc(data, linkOf),
    "- [[A]]\n  - [[B]]\n    - [[D]]\n  - [[C]]\n    - [[E]]\n      - [[F]]");
});

test("画板连线没有方向，树上的标签写在子卡片链接之前", () => {
  const data = board([card("A", 0, 0), card("B", 0, 10)], [link("B", "A", "反驳")]);
  assert.equal(buildMoc(data, linkOf), "- [[A]]\n  - —反驳→ [[B]]");
});

test("成环且带标签的非树连线按原存储方向补在组尾", () => {
  const data = board([
    card("A", 0, 0), card("B", 0, 10), card("C", 0, 20), card("D", 0, 30),
  ], [link("B", "C", "补证"), link("A", "C"), link("A", "B", "依据")]);
  assert.equal(buildMoc(data, linkOf),
    "- [[A]]\n  - —依据→ [[B]]\n  - [[C]]\n- [[B]] —补证→ [[C]]\n\n- [[D]]");
});

test("不带标签的成环连线不额外输出，平行连线保留额外标签", () => {
  const data = board([
    card("A", 0, 0), card("B", 0, 10), card("C", 0, 20),
  ], [link("A", "B"), link("A", "C"), link("B", "C", ""), { ...link("B", "A", "补证"), id: "extra" }]);
  assert.equal(buildMoc(data, linkOf), "- [[A]]\n  - [[B]]\n  - [[C]]\n- [[B]] —补证→ [[A]]");
});

test("缺失卡片与相连连线被跳过，不能再连接原本分离的组", () => {
  const data = board([
    card("A", 0, 0), card("M", 0, -10, true), card("B", 0, 10),
  ], [link("A", "M", "依据"), link("M", "B", "反驳"), link("A", "不存在", "悬空")]);
  assert.equal(buildMoc(data, linkOf), "- [[A]]\n\n- [[B]]");
  assert.equal(buildMoc(board([card("M", 0, 0, true)]), linkOf), "");
});

test("MOC 正文的生成不改变画板卡片和连线的存储顺序或内容", () => {
  const data = board([card("B", 0, 10), card("A", 0, 0)], [link("B", "A", "依据")]);
  const before = structuredClone(data);
  buildMoc(data, linkOf);
  assert.deepEqual(data, before);
});
