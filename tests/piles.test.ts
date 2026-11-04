import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPiles, colorIndex, domainsOf, noteTypeOf, splitTitle } from "../src/core";
import type { VaultNote } from "../src/core";

function note(title: string, domains: string[], isBoard = false): VaultNote {
  return { path: `${title}.md`, title, type: "permanent", domains, isBoard };
}

test("笔记类型识别三种标准名称，忽略两端空格和大小写", () => {
  assert.equal(noteTypeOf(" Literature "), "literature");
  assert.equal(noteTypeOf("PERMANENT"), "permanent");
  assert.equal(noteTypeOf("\tFleeting\n"), "fleeting");
});

test("笔记类型兼容 flash 和闪念", () => {
  assert.equal(noteTypeOf(" FLASH "), "fleeting");
  assert.equal(noteTypeOf(" 闪念 "), "fleeting");
});

test("未知、空值和非字符串的笔记类型均为未分类", () => {
  for (const value of ["", " ", "文献", "unknown", null, undefined, false, 1, [], {}]) {
    assert.equal(noteTypeOf(value), "uncategorized");
  }
});

test("领域标签可以带井号，前缀比较忽略大小写", () => {
  assert.deepEqual(domainsOf(["#DOMAIN/辽史", "Domain/宋史", "other/元史"]), ["辽史", "宋史"]);
});

test("领域名称保留嵌套路径与大小写，去重并保留首次出现顺序", () => {
  assert.deepEqual(
    domainsOf(["domain/History/辽", "#domain/History/辽", "domain/history/辽", "domain/艺术", "domain/"]),
    ["History/辽", "history/辽", "艺术"],
  );
});

test("领域前缀支持自定义，没有领域时返回空数组", () => {
  assert.deepEqual(domainsOf(["#TOPIC/A/B", "topic/C", "domain/D"], "topic/"), ["A/B", "C"]);
  assert.deepEqual(domainsOf([]), []);
  assert.deepEqual(domainsOf(["domain/", "#domain/", "unrelated"]), []);
});

test("同一卡片的多个领域分别形成卡堆", () => {
  const card = note("契丹婚姻制度", ["历史", "社会"]);
  const piles = buildPiles([card]);
  assert.equal(piles.length, 2);
  for (const pile of piles) {
    assert.equal(pile.count, 1);
    assert.deepEqual(pile.cards, [card]);
  }
});

test("同一卡片重复的领域不会在卡堆内重复计数", () => {
  const card = note("韩德让", ["历史", "历史"]);
  assert.deepEqual(buildPiles([card]), [{ name: "历史", count: 1, cards: [card] }]);
});

test("卡堆内的卡片按中文标题排序", () => {
  const titles = ["中", "阿", "波"];
  const piles = buildPiles(titles.map((title) => note(title, ["历史"])));
  assert.deepEqual(piles[0].cards.map((card) => card.title), ["阿", "波", "中"]);
});

test("卡堆先按卡片数降序，同数时按中文领域名称排序", () => {
  const piles = buildPiles([
    note("甲", ["中", "波", "阿"]),
    note("乙", ["中"]),
  ]);
  assert.deepEqual(piles.map(({ name, count }) => ({ name, count })), [
    { name: "中", count: 2 },
    { name: "阿", count: 1 },
    { name: "波", count: 1 },
  ]);
});

test("归堆排除画板笔记和没有领域的笔记", () => {
  assert.deepEqual(buildPiles([note("画板", ["历史"], true), note("未归领域", [])]), []);
});

test("归堆不改变传入笔记或领域的顺序", () => {
  const notes = [note("中", ["波", "阿"]), note("阿", ["阿"])];
  const before = structuredClone(notes);
  buildPiles(notes);
  assert.deepEqual(notes, before);
});

test("卡片颜色与原型公式算出的已知标题结果相同", () => {
  // 期望值直接用原型公式预先计算，避免测试复写被测实现。
  for (const [title, expected] of [
    ["", 7],
    ["韩德让", 8],
    ["20260520_简述_谢缅诺夫《中世纪史》", 4],
    ["A😀𠮷", 5],
  ] as const) {
    assert.equal(colorIndex(title), expected);
  }
});

test("卡片标题拆出日期与笔记类型前缀，保留正文中的下划线", () => {
  assert.deepEqual(splitTitle("20260520_简述_谢缅诺夫《中世纪史》"), {
    prefix: "20260520 · 简述",
    title: "谢缅诺夫《中世纪史》",
  });
  assert.deepEqual(splitTitle("20260520_简述_标题_补充"), {
    prefix: "20260520 · 简述",
    title: "标题_补充",
  });
});

test("不符合完整前缀约定的卡片标题逐字保留", () => {
  for (const title of ["普通标题", "2026052_简述_标题", "20260520__标题", "20260520_简述_", ""]) {
    assert.deepEqual(splitTitle(title), { prefix: "", title });
  }
});
