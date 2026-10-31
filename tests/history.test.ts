import assert from "node:assert/strict";
import { test } from "node:test";
import { History } from "../src/core";

test("首次提交只记录撤销基准，不产生历史", () => {
  const history = new History();
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  history.commit({ title: "甲" });
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(), null);
});

test("相同 JSON 内容的重复提交不会产生可撤销历史", () => {
  const history = new History();
  history.commit({ cards: ["甲"] });
  history.commit({ cards: ["甲"] });
  assert.equal(history.canUndo, false);
});

test("撤销和重做按相反顺序返回历次内容，到头后返回 null", () => {
  const history = new History();
  history.commit({ title: "甲" });
  history.commit({ title: "乙" });
  history.commit({ title: "丙" });
  assert.equal(history.canUndo, true);
  assert.deepEqual(history.undo(), { title: "乙" });
  assert.deepEqual(history.undo(), { title: "甲" });
  assert.equal(history.undo(), null);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), { title: "乙" });
  assert.deepEqual(history.redo(), { title: "丙" });
  assert.equal(history.redo(), null);
  assert.equal(history.canRedo, false);
});

test("撤销后提交相同内容不再次进入历史，也不清空重做", () => {
  const history = new History();
  history.commit({ title: "甲" });
  history.commit({ title: "乙" });
  const previous = history.undo();
  history.commit(previous);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), { title: "乙" });
});

test("重做后提交相同内容不重复记录，当前基准已同步", () => {
  const history = new History();
  history.commit("甲");
  history.commit("乙");
  history.undo();
  history.commit(history.redo());
  assert.equal(history.undo(), "甲");
  assert.equal(history.undo(), null);
});

test("撤销后的新内容提交清空重做，新的撤销仍回到当前基准", () => {
  const history = new History();
  history.commit("甲");
  history.commit("乙");
  history.commit("丙");
  history.undo();
  history.commit("丁");
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), null);
  assert.equal(history.undo(), "乙");
  assert.equal(history.undo(), "甲");
});

test("撤销历史在提交时隔离调用方后来对对象的修改", () => {
  const history = new History();
  const doc = { cards: [{ title: "甲" }] };
  history.commit(doc);
  doc.cards[0].title = "乙";
  history.commit(doc);
  doc.cards[0].title = "丙";
  assert.deepEqual(history.undo(), { cards: [{ title: "甲" }] });
  assert.deepEqual(history.redo(), { cards: [{ title: "乙" }] });
});

test("撤销和重做返回深拷贝，修改返回值不会污染后续历史", () => {
  const history = new History();
  history.commit({ cards: [{ title: "甲" }] });
  history.commit({ cards: [{ title: "乙" }] });
  const undone = history.undo() as { cards: Array<{ title: string }> };
  undone.cards[0].title = "外部修改甲";
  const redone = history.redo() as { cards: Array<{ title: string }> };
  redone.cards[0].title = "外部修改乙";
  assert.deepEqual(history.undo(), { cards: [{ title: "甲" }] });
  assert.deepEqual(history.redo(), { cards: [{ title: "乙" }] });
});

test("reset 清空撤销和重做，把新内容作为独立基准", () => {
  const history = new History();
  history.commit({ title: "甲" });
  history.commit({ title: "乙" });
  history.commit({ title: "丙" });
  history.undo();
  const doc = { title: "新画板" };
  history.reset(doc);
  doc.title = "调用方修改";
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  history.commit({ title: "新内容" });
  assert.deepEqual(history.undo(), { title: "新画板" });
});

test("自定义上限只保留最近的撤销内容，并支持再次重做", () => {
  const history = new History(2);
  for (const value of [0, 1, 2, 3]) history.commit(value);
  assert.equal(history.undo(), 2);
  assert.equal(history.undo(), 1);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), 2);
  assert.equal(history.redo(), 3);
});

test("默认撤销上限为一百份，丢弃最老内容", () => {
  const history = new History();
  for (let value = 0; value <= 101; value++) history.commit(value);
  for (let expected = 100; expected >= 1; expected--) assert.equal(history.undo(), expected);
  assert.equal(history.undo(), null);
});

test("零上限允许更新当前内容，但不保留撤销或重做", () => {
  const history = new History(0);
  history.commit("甲");
  history.commit("乙");
  assert.equal(history.canUndo, false);
  assert.equal(history.undo(), null);
  assert.equal(history.canRedo, false);
});

test("JSON 基本值也可以作为撤销内容，null 可以作为基准", () => {
  const history = new History();
  history.commit(null);
  history.commit(false);
  history.commit(0);
  assert.equal(history.undo(), false);
  assert.equal(history.canUndo, true);
  assert.equal(history.undo(), null);
  assert.equal(history.canUndo, false);
  history.commit(null);
  assert.equal(history.canUndo, false);
  assert.equal(history.redo(), false);
});

test("无效撤销上限和无法序列化的内容被拒绝，已有历史不受影响", () => {
  for (const limit of [-1, 1.5, Infinity, NaN]) {
    assert.throws(() => new History(limit), RangeError);
  }
  const history = new History();
  history.commit("甲");
  history.commit("乙");
  assert.throws(() => history.commit(undefined), TypeError);
  assert.throws(() => history.reset(1n), TypeError);
  assert.equal(history.undo(), "甲");
  assert.equal(history.redo(), "乙");
});
