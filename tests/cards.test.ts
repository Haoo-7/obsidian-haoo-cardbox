// 纯函数单元测试：不依赖 Obsidian，用 node:test 运行。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	buildCardWall,
	groupKeys,
	makeExcerpt,
	matchesSource,
	normalizeTag,
	stripFrontmatter,
	stripMarkdown,
	tiltFor,
	type CardSettings,
	type NoteCard,
} from "../src/cards";

/** 覆盖默认配置，便于各用例只改关心的字段。 */
function settings(overrides: Partial<CardSettings> = {}): CardSettings {
	return {
		sourceKind: "tag",
		sourceTag: "card",
		sourceFolder: "",
		sourceField: "",
		sourceValue: "",
		groupMode: "frontmatter",
		groupField: "category",
		tagNamespace: "",
		excerptLength: 120,
		ungroupedLabel: "未归类",
		...overrides,
	};
}

function note(overrides: Partial<NoteCard> = {}): NoteCard {
	return {
		path: "Literature/Note.md",
		basename: "Note",
		tags: ["card"],
		frontmatter: {},
		content: "# 标题\n正文内容。",
		...overrides,
	};
}

describe("normalizeTag", () => {
	it("去掉前导 # 和空白", () => {
		assert.equal(normalizeTag("#card"), "card");
		assert.equal(normalizeTag("  #domain/psych "), "domain/psych");
	});
});

describe("matchesSource", () => {
	it("按标签匹配（忽略大小写、可带 #）", () => {
		const s = settings({ sourceKind: "tag", sourceTag: "Card" });
		assert.equal(matchesSource(note({ tags: ["card", "foo"] }), s), true);
		assert.equal(matchesSource(note({ tags: ["foo"] }), s), false);
	});

	it("按文件夹匹配，含子目录", () => {
		const s = settings({ sourceKind: "folder", sourceFolder: "Literature" });
		assert.equal(matchesSource(note({ path: "Literature/A.md" }), s), true);
		assert.equal(matchesSource(note({ path: "Literature/Sub/B.md" }), s), true);
		assert.equal(matchesSource(note({ path: "Other/A.md" }), s), false);
	});

	it("按 frontmatter 字段：仅存在即命中", () => {
		const s = settings({ sourceKind: "frontmatter", sourceField: "type" });
		assert.equal(matchesSource(note({ frontmatter: { type: "literature" } }), s), true);
		assert.equal(matchesSource(note({ frontmatter: { type: "" } }), s), false);
		assert.equal(matchesSource(note({ frontmatter: {} }), s), false);
	});

	it("按 frontmatter 字段：需等于指定值", () => {
		const s = settings({ sourceKind: "frontmatter", sourceField: "type", sourceValue: "literature" });
		assert.equal(matchesSource(note({ frontmatter: { type: "literature" } }), s), true);
		assert.equal(matchesSource(note({ frontmatter: { type: "concept" } }), s), false);
	});
});

describe("groupKeys", () => {
	it("按 frontmatter 单值分组", () => {
		const s = settings({ groupMode: "frontmatter", groupField: "category" });
		assert.deepEqual(groupKeys(note({ frontmatter: { category: "心理学" } }), s), ["心理学"]);
	});

	it("按 frontmatter 列表分组：一卡可入多组", () => {
		const s = settings({ groupMode: "frontmatter", groupField: "category" });
		assert.deepEqual(groupKeys(note({ frontmatter: { category: ["A", "B"] } }), s), ["A", "B"]);
	});

	it("命中不到分组时回退未归类", () => {
		const s = settings({ groupMode: "frontmatter", groupField: "category", ungroupedLabel: "杂项" });
		assert.deepEqual(groupKeys(note({ frontmatter: {} }), s), ["杂项"]);
	});

	it("按标签分组：排除来源标签本身", () => {
		const s = settings({ groupMode: "tag", sourceTag: "card" });
		const n = note({ tags: ["card", "psychology", "method"] });
		assert.deepEqual(groupKeys(n, s), ["psychology", "method"]);
	});

	it("按标签分组：命名空间前缀过滤", () => {
		const s = settings({ groupMode: "tag", sourceTag: "card", tagNamespace: "domain" });
		const n = note({ tags: ["card", "domain/psych", "domain/arts", "misc"] });
		assert.deepEqual(groupKeys(n, s), ["domain/psych", "domain/arts"]);
	});
});

describe("stripFrontmatter / stripMarkdown / makeExcerpt", () => {
	it("剥离 YAML frontmatter", () => {
		const src = "---\ntitle: x\ncategory: y\n---\n真正正文";
		assert.equal(stripFrontmatter(src), "真正正文");
	});

	it("剥离常见 Markdown 记号", () => {
		const out = stripMarkdown("## 标题\n这是一段 **粗体** 与 [链接](http://a) 及 `code`。");
		assert.ok(!out.includes("#"));
		assert.ok(!out.includes("**"));
		assert.ok(out.includes("链接"));
		assert.ok(!out.includes("code"));
	});

	it("压缩空白并生成摘要（保留标题文字，仅去掉 # 标记）", () => {
		const ex = makeExcerpt("# T\n\n第一行\n\n第二行", 100);
		assert.equal(ex, "T 第一行 第二行");
	});

	it("超长时按长度截断并加省略号", () => {
		const long = "字".repeat(200);
		const ex = makeExcerpt(long, 50);
		assert.equal(ex.length, 51); // 50 个字符 + 省略号
		assert.ok(ex.endsWith("…"));
	});

	it("maxLength<=0 返回空串", () => {
		assert.equal(makeExcerpt("abc", 0), "");
	});
});

describe("tiltFor", () => {
	it("确定且稳定：同一路径两次结果一致", () => {
		assert.equal(tiltFor("a/b.md"), tiltFor("a/b.md"));
	});

	it("落在 [-maxTilt, maxTilt] 区间内", () => {
		const paths = ["x.md", "Literature/A.md", "n/1.md", "note-9.md", "z.md"];
		for (const p of paths) {
			const t = tiltFor(p, 1.6);
			assert.ok(t >= -1.6 && t <= 1.6, `${p} -> ${t}`);
		}
	});
});

describe("buildCardWall", () => {
	it("筛选 + 分组 + 排序，且一卡入多组", () => {
		const s = settings({ sourceKind: "tag", sourceTag: "card", groupMode: "frontmatter", groupField: "category" });
		const notes = [
			note({ path: "1.md", basename: "B", frontmatter: { category: "心理学" }, content: "b正文" }),
			note({ path: "2.md", basename: "A", frontmatter: { category: "心理学" }, content: "a正文" }),
			note({ path: "3.md", basename: "C", frontmatter: { category: ["心理学", "方法"] }, content: "c正文" }),
			note({ path: "4.md", basename: "NotCard", tags: ["draft"], frontmatter: { category: "心理学" } }), // 非卡片，应被过滤
			note({ path: "5.md", basename: "E", frontmatter: {} }), // 未分组
		];
		const wall = buildCardWall(notes, s);
		const byKey = Object.fromEntries(wall.map((g) => [g.key, g.cards.map((c) => c.note.basename)]));

		assert.deepEqual(byKey["心理学"], ["A", "B", "C"]); // 组内按标题排序，NotCard 被过滤
		assert.deepEqual(byKey["方法"], ["C"]); // C 同时进入「方法」组
		assert.deepEqual(byKey["未归类"], ["E"]);
		// 「未归类」排在最后
		assert.equal(wall[wall.length - 1].key, "未归类");
	});

	it("摘要与倾斜被写入卡片条目", () => {
		const s = settings({ excerptLength: 5 });
		const wall = buildCardWall([note({ content: "abcdefghij" })], s);
		const card = wall[0].cards[0];
		assert.equal(card.excerpt, "abcde…");
		assert.equal(card.tilt, tiltFor(card.note.path));
	});
});
