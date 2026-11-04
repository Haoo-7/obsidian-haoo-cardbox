import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOARD_VERSION, BoardParseError, emptyBoard, isBoardNote,
  newBoardNote, parseBoardNote, serializeBoardNote,
} from "../src/core";
import type { BoardData, ParsedBoardNote } from "../src/core";

function block(json: string): string {
  return `%%\n\`\`\`skeuo-board\n${json}\n\`\`\`\n%%`;
}

function withData(data: unknown): string {
  return block(JSON.stringify(data));
}

function populatedBoard(): BoardData {
  return {
    version: BOARD_VERSION,
    nodes: [{ id: "a", type: "file", file: "韩德让.md", x: -20, y: 30, width: 168, height: 112, flipped: true }],
    edges: [{ id: "e", fromNode: "a", toNode: "a", label: "研究" }],
    strokes: [{ id: "s", type: "pen", color: "ink", points: [[1, 2], [3, 4]] }],
    viewport: { x: 20, y: 30, zoom: 0.8 },
  };
}

test("空画板的版本、数组和视口符合约定，并且每份独立", () => {
  const first = emptyBoard();
  const second = emptyBoard();
  const expected: BoardData = {
    version: BOARD_VERSION, nodes: [], edges: [], strokes: [], viewport: { x: 0, y: 0, zoom: 1 },
  };
  assert.deepEqual(first, expected);
  first.viewport.x = 10;
  first.nodes.push(populatedBoard().nodes[0]);
  assert.deepEqual(second.viewport, { x: 0, y: 0, zoom: 1 });
  assert.deepEqual(second.nodes, []);
});

test("画板笔记识别 frontmatter 中 truthy 的画板标记", () => {
  for (const value of [1, true, "1", [], {}]) {
    assert.equal(isBoardNote({ "skeuo-board": value, aliases: ["研究"] }), true);
  }
});

test("没有画板标记或标记为 falsy 时不是画板笔记", () => {
  assert.equal(isBoardNote(undefined), false);
  assert.equal(isBoardNote({}), false);
  for (const value of [0, false, "", null, undefined]) {
    assert.equal(isBoardNote({ "skeuo-board": value }), false);
  }
});

test("继承的属性不算画板笔记自身的 frontmatter 标记", () => {
  const frontmatter: Record<string, unknown> = {};
  Object.setPrototypeOf(frontmatter, { "skeuo-board": 1 });
  assert.equal(isBoardNote(frontmatter), false);
});

test("手写区包含 Markdown、中文、空行和其他 frontmatter 键时逐字不变", () => {
  const head = "---\nskeuo-board: 1\naliases: [契丹]\ntags:\n  - 历史\n---\n"
    + "# 契丹婚姻制度\n\n**手写区**  \n\n- [[韩德让]]\n> 不可替换的中文。\n\n";
  const tail = "\n\n## 手写补充\n末尾保留两个空格  \n";
  const text = head + "<!-- skeuo:moc -->\n旧的 MOC 正文\n<!-- /skeuo:moc -->\n\n"
    + withData(populatedBoard()) + tail;
  const parsed = parseBoardNote(text);
  assert.equal(parsed.head, head);
  assert.equal(parsed.tail, tail);
  const written = serializeBoardNote(parsed, "- [[新卡片]]");
  assert.ok(written.startsWith(head));
  assert.ok(written.endsWith(tail));
  assert.ok(!written.includes("旧的 MOC 正文"));
  assert.deepEqual(parseBoardNote(written), parsed);
});

test("没有 MOC 标记的画板笔记读写后 data、head、tail 都相同", () => {
  const head = "---\nskeuo-board: 1\n---\n# 研究\n\n手写区。\n\n";
  const tail = "\n\n尾部中文。\r\n";
  const parsed = parseBoardNote(head + withData(populatedBoard()) + tail);
  assert.equal(parsed.head, head);
  assert.equal(parsed.tail, tail);
  assert.deepEqual(parsed.data, populatedBoard());
  assert.deepEqual(parseBoardNote(serializeBoardNote(parsed, "- [[韩德让]]")), parsed);
});

test("没有数据块的普通笔记以全文作为手写区并使用空画板", () => {
  const text = "# 研究\n\n手写区";
  assert.deepEqual(parseBoardNote(text), { head: text, data: emptyBoard(), tail: "" });
});

test("只有 MOC 没有数据块时丢掉旧 MOC 正文", () => {
  assert.deepEqual(parseBoardNote("# 研究\n<!-- skeuo:moc -->\n旧内容\n<!-- /skeuo:moc -->"), {
    head: "# 研究\n", data: emptyBoard(), tail: "",
  });
});

test("坏 JSON 抛出带中文说明的 BoardParseError", () => {
  assert.throws(() => parseBoardNote(block('{"version":1,')), {
    name: "BoardParseError", message: /JSON.*损坏/u,
  });
  assert.throws(() => parseBoardNote(block("{坏 JSON}")), BoardParseError);
});

test("未来版本抛出 BoardParseError，不回退成空画板", () => {
  assert.throws(() => parseBoardNote(withData({ version: BOARD_VERSION + 1 })), {
    name: "BoardParseError", message: /版本.*高于/u,
  });
});

test("缺少数组和视口时补默认值", () => {
  assert.deepEqual(parseBoardNote(withData({ version: 1 })).data, emptyBoard());
});

test("没有版本号的旧画板使用当前版本", () => {
  assert.deepEqual(parseBoardNote(withData({})).data, emptyBoard());
});

test("早于当前版本的画板保留原版本号", () => {
  const parsed = parseBoardNote(withData({ version: 0 }));
  assert.deepEqual(parsed.data, { ...emptyBoard(), version: 0 });
  assert.deepEqual(parseBoardNote(serializeBoardNote(parsed, "")).data, parsed.data);
});

test("老笔迹没有 type 时作为 pen，未知颜色作为 ink", () => {
  const data = parseBoardNote(withData({
    version: 1,
    strokes: [{ id: "old", color: "未知颜色", points: [[10, 20], [30, 40]] }],
  })).data;
  assert.deepEqual(data.strokes, [
    { id: "old", type: "pen", color: "ink", points: [[10, 20], [30, 40]] },
  ]);
});

test("四种笔迹的字段和已知颜色能够完整读写", () => {
  const data: BoardData = {
    ...emptyBoard(),
    strokes: [
      { id: "pen", type: "pen", color: "ink", points: [[1, 2]] },
      { id: "line", type: "line", color: "rust", a: [1, 2], b: [3, 4], m: null },
      { id: "curve", type: "line", color: "blue", a: [1, 2], b: [3, 4], m: [2, 6] },
      { id: "rect", type: "rect", color: "ink", x: 1, y: 2, w: 3, h: 4 },
      { id: "text", type: "text", color: "blue", x: 1, y: 2, text: "第一行\n第二行" },
    ],
  };
  const parsed = parseBoardNote(withData(data));
  assert.deepEqual(parsed.data, data);
  assert.deepEqual(parseBoardNote(serializeBoardNote(parsed, "")).data, data);
});

test("每种笔迹的未知或缺省颜色都回退为 ink", () => {
  const data = parseBoardNote(withData({
    strokes: [
      { id: "p", points: [], color: null },
      { id: "l", type: "line", a: [0, 0], b: [1, 1], m: null, color: "red" },
      { id: "r", type: "rect", x: 0, y: 0, w: 1, h: 1 },
      { id: "t", type: "text", x: 0, y: 0, text: "文字", color: 1 },
    ],
  })).data;
  assert.deepEqual(data.strokes.map((stroke) => stroke.color), ["ink", "ink", "ink", "ink"]);
});

test("未知顶层字段在解析和再次写回时保留", () => {
  const data = { ...populatedBoard(), custom: { nested: ["中文", 1] }, flag: false };
  const parsed = parseBoardNote(withData(data));
  const output = serializeBoardNote(parsed, "");
  assert.deepEqual(parsed.data, data);
  assert.deepEqual(parseBoardNote(output).data, data);
  assert.ok(output.includes('"custom":{"nested":["中文",1]}'));
});

test("JSON 值或已知字段损坏时抛错，不静默丢弃内容", () => {
  for (const data of [
    null, [], 1, "画板",
    { version: "1" },
    { nodes: null }, { nodes: [{}] }, { edges: {} }, { edges: [null] },
    { strokes: null }, { strokes: [null] },
    { strokes: [{ id: "p", points: [[1]] }] },
    { strokes: [{ id: "p", type: "unknown", points: [] }] },
    { viewport: null }, { viewport: { x: 0, y: 0 } },
  ]) {
    assert.throws(() => parseBoardNote(withData(data)), BoardParseError);
  }
});

test("未组成完整数据块的 Markdown 代码围栏仍属于手写区", () => {
  for (const text of [
    "```skeuo-board\n{}\n```",
    "%%\n```skeuo-board\n{}\n```",
    "%%\n```skeuo-board\n{}",
  ]) {
    assert.deepEqual(parseBoardNote(text), { head: text, data: emptyBoard(), tail: "" });
  }
});

test("CRLF 手写区和尾部原样保留，数据块接受 CRLF", () => {
  const head = "---\r\nskeuo-board: 1\r\n---\r\n# 中文\r\n\r\n";
  const tail = "\r\n尾部\r\n";
  const parsed = parseBoardNote(head + withData(populatedBoard()).replace(/\n/gu, "\r\n") + tail);
  assert.equal(parsed.head, head);
  assert.equal(parsed.tail, tail);
  assert.deepEqual(parseBoardNote(serializeBoardNote(parsed, "")), parsed);
});

test("数据块各行允许水平空格，JSON 允许多行排版", () => {
  const text = withData(emptyBoard()).replaceAll("\n", "\n\t").replace("%%", "  %%  ");
  assert.deepEqual(parseBoardNote(text).data, emptyBoard());
  assert.deepEqual(parseBoardNote(block(JSON.stringify(populatedBoard(), null, 2))).data, populatedBoard());
});

test("数据块之后的 MOC 标记属于尾部，不影响手写区", () => {
  const head = "# 手写区\n";
  const tail = "\n<!-- skeuo:moc -->\n尾部内容\n";
  const parsed = parseBoardNote(head + withData(emptyBoard()) + tail);
  assert.equal(parsed.head, head);
  assert.equal(parsed.tail, tail);
});

test("写回补齐手写区末尾换行，并使用约定的 MOC 和数据块格式", () => {
  const parsed: ParsedBoardNote = { head: "# 中文", data: emptyBoard(), tail: "\n尾部" };
  assert.equal(
    serializeBoardNote(parsed, "- [[韩德让]]"),
    "# 中文\n<!-- skeuo:moc -->\n- [[韩德让]]\n<!-- /skeuo:moc -->\n\n"
      + withData(emptyBoard()) + "\n尾部",
  );
  assert.equal(parsed.head, "# 中文");
});

test("空 MOC 正文在两个标记之间只留一个空行", () => {
  const output = serializeBoardNote({ head: "# 研究\n", data: emptyBoard(), tail: "" }, "");
  assert.ok(output.includes("<!-- skeuo:moc -->\n\n<!-- /skeuo:moc -->"));
});

test("同一份画板笔记连续写回的字节完全相同", () => {
  const parsed = { head: "# 研究\n\n", data: populatedBoard(), tail: "\n尾部\n" };
  const once = serializeBoardNote(parsed, "- [[韩德让]]");
  assert.equal(serializeBoardNote(parsed, "- [[韩德让]]"), once);
  assert.equal(serializeBoardNote(parseBoardNote(once), "- [[韩德让]]"), once);
});

test("新画板笔记只有画板标记、指定标题、空 MOC 和空画板", () => {
  const text = newBoardNote("契丹婚姻制度与萧韩关系");
  assert.equal(text, "---\nskeuo-board: 1\n---\n# 契丹婚姻制度与萧韩关系\n\n"
    + "<!-- skeuo:moc -->\n\n<!-- /skeuo:moc -->\n\n" + withData(emptyBoard()));
  assert.deepEqual(parseBoardNote(text).data, emptyBoard());
});
