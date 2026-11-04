import assert from "node:assert/strict";
import { test } from "node:test";
import { SWATCHES, inkOf, isHexColor, normalizeHex } from "../src/core";

test("卡纸颜色各有唯一的名字和 #rrggbb 色值", () => {
  const ids = new Set(SWATCHES.map((s) => s.id));
  assert.equal(ids.size, SWATCHES.length);
  for (const s of SWATCHES) {
    assert.ok(s.name.length > 0, s.id);
    assert.ok(isHexColor(s.hex), s.id);
  }
});

test("浅底用深字，深底用浅字", () => {
  for (const hex of ["#e9eaee", "#e4d8c4", "#a9b8a2", "#8fa3b8", "#c08a72", "#ffffff"]) {
    assert.equal(inkOf(hex), "dark", hex);
  }
  for (const hex of ["#3a3b3f", "#6e5a72", "#24303f", "#000000"]) {
    assert.equal(inkOf(hex), "light", hex);
  }
});

test("只认六位十六进制的 #rrggbb", () => {
  assert.equal(isHexColor("#a9b8a2"), true);
  assert.equal(isHexColor("#A9B8A2"), true);
  for (const value of ["#abc", "a9b8a2", "#a9b8a", "#a9b8a22", "#a9b8ag", "", 42, null, undefined, {}, ["#a9b8a2"]]) {
    assert.equal(isHexColor(value), false, String(value));
  }
});

test("写进笔记前统一成小写，读不懂的颜色按深字处理", () => {
  assert.equal(normalizeHex("#A9B8A2"), "#a9b8a2");
  assert.equal(inkOf("不是颜色"), "dark");
});
