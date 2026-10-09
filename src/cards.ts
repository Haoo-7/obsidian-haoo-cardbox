// 卡片筛选、分组与文本处理的纯逻辑。
//
// 本文件刻意不 import 任何 Obsidian API，所有函数只依赖普通数据结构，
// 因此可以在单元测试中脱离 Obsidian 独立运行。

/** 卡片来源类型：按标签、按文件夹、或按 frontmatter 字段筛选，三选一。 */
export type SourceKind = "tag" | "folder" | "frontmatter";

/** 分组方式：按标签分组，或按 frontmatter 字段（如 category）分组。 */
export type GroupMode = "tag" | "frontmatter";

/** 纯函数所需的配置子集。插件的完整设置（PluginSettings）会满足此结构。 */
export interface CardSettings {
	/** 数据源类型。 */
	sourceKind: SourceKind;
	/** 当 sourceKind = "tag" 时使用的标签（如 "card"，不含 #）。 */
	sourceTag: string;
	/** 当 sourceKind = "folder" 时使用的文件夹路径（如 "Literature"）。 */
	sourceFolder: string;
	/** 当 sourceKind = "frontmatter" 时的字段名（该字段非空即视为卡片）。 */
	sourceField: string;
	/** 可选：sourceField 需等于该值才算卡片；留空表示只要字段存在即可。 */
	sourceValue: string;
	/** 分组方式。 */
	groupMode: GroupMode;
	/** 当 groupMode = "frontmatter" 时用于分组的字段名（默认 category）。 */
	groupField: string;
	/** 当 groupMode = "tag" 时可选的标签命名空间前缀（如 "domain"）；留空表示用全部标签分组。 */
	tagNamespace: string;
	/** 卡片摘要长度（正文前 N 个字符）。 */
	excerptLength: number;
	/** 无匹配分组时使用的分区标题。 */
	ungroupedLabel: string;
}

/** 一张候选笔记卡片所需的最小数据（由视图层从 Obsidian 中抽取后传入）。 */
export interface NoteCard {
	/** vault 内相对路径，如 "Literature/Foo.md"。 */
	path: string;
	/** 文件名（不含扩展名），用于卡片标题。 */
	basename: string;
	/** 归一化后的标签集合（不含 # 前缀）。 */
	tags: string[];
	/** frontmatter 原始对象。 */
	frontmatter: Record<string, unknown>;
	/** 笔记正文（可能仍包含 frontmatter，摘要函数会自行剥离）。 */
	content: string;
}

/** 分组后单张卡片的渲染数据。 */
export interface CardEntry {
	note: NoteCard;
	/** 处理好的正文摘要。 */
	excerpt: string;
	/** 稳定的倾斜角度（单位：度，可正可负）。 */
	tilt: number;
}

/** 一个分组（领域分区）。 */
export interface CardGroup {
	/** 分区标题（分组键）。 */
	key: string;
	/** 该分组下的卡片。 */
	cards: CardEntry[];
}

/** 去掉标签首尾空白与前导的 #。 */
export function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#/, "").trim();
}

/** 把 frontmatter 值统一成字符串数组（支持单值或数组）。 */
function asStringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v));
	if (value === undefined || value === null) return [];
	return [String(value)];
}

/** 去重且保持首次出现顺序。 */
function dedupe(items: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const it of items) {
		if (!seen.has(it)) {
			seen.add(it);
			out.push(it);
		}
	}
	return out;
}

/** 判断一条笔记是否命中当前数据源设置。 */
export function matchesSource(note: NoteCard, s: CardSettings): boolean {
	switch (s.sourceKind) {
		case "tag": {
			const want = normalizeTag(s.sourceTag).toLowerCase();
			if (!want) return false;
			return note.tags.some((t) => t.toLowerCase() === want);
		}
		case "folder": {
			const folder = s.sourceFolder.trim().replace(/\/+$/, "");
			if (!folder) return false;
			// 匹配该文件夹及其所有子目录下的笔记。
			return note.path === folder || note.path.startsWith(folder + "/");
		}
		case "frontmatter": {
			const field = s.sourceField.trim();
			if (!field) return false;
			const value = note.frontmatter[field];
			if (value === undefined || value === null || value === false || value === "") return false;
			const want = s.sourceValue.trim();
			if (!want) return true; // 字段存在且非空即算卡片
			return asStringList(value).map((v) => v.trim()).includes(want);
		}
		default:
			return false;
	}
}

/**
 * 返回一条笔记归属的分组键列表。命中多个（如多标签/多分类）时，
 * 卡片会出现在每个分组里。无命中时回退到 ungroupedLabel。
 */
export function groupKeys(note: NoteCard, s: CardSettings): string[] {
	let keys: string[];
	if (s.groupMode === "frontmatter") {
		const field = s.groupField.trim();
		keys = field ? asStringList(note.frontmatter[field]) : [];
	} else {
		const ns = normalizeTag(s.tagNamespace).toLowerCase();
		const sourceTag = normalizeTag(s.sourceTag).toLowerCase();
		keys = note.tags.filter((t) => {
			const lt = t.toLowerCase();
			if (lt === sourceTag) return false; // 排除数据源标签本身，避免聚成一大组
			if (ns && !lt.startsWith(ns)) return false; // 若设定了命名空间则只取该前缀下的标签
			return true;
		});
	}
	keys = dedupe(keys.map((k) => String(k).trim()).filter(Boolean));
	return keys.length ? keys : [s.ungroupedLabel.trim() || "未归类"];
}

/** 剥离开头的 YAML frontmatter（--- ... ---）。 */
export function stripFrontmatter(content: string): string {
	const m = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
	return m ? content.slice(m[0].length) : content;
}

/** 轻量地剥离常见 Markdown 记号，让摘要更接近纯文本。 */
export function stripMarkdown(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ") // 代码块
		.replace(/`[^`]*`/g, " ") // 行内代码
		.replace(/%%[\s\S]*?%%/g, " ") // Obsidian 注释
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片（先去，避免被链接规则吞掉）
		.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, p1, p2) => (p2 || p1)) // wiki 链接取显示文本
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // 普通链接取文本
		.replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题 #
		.replace(/^\s{0,3}>+\s?/gm, "") // 引用
		.replace(/^\s*[-*+]\s+/gm, "") // 无序列表
		.replace(/^\s*\d+\.\s+/gm, "") // 有序列表
		.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1") // 粗体/斜体
		.replace(/~{2}([^~]+)~{2}/g, "$1") // 删除线
		.replace(/==([^=]+)==/g, "$1"); // 高亮
}

/** 生成正文摘要：剥离 frontmatter 与 Markdown、压缩空白、按长度截断并加省略号。 */
export function makeExcerpt(content: string, maxLength: number): string {
	if (maxLength <= 0) return "";
	const collapsed = stripMarkdown(stripFrontmatter(content)).replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) return collapsed;
	// 尽量在单词边界截断（对中文而言 \b 不生效，直接按字符截断即可）。
	const cut = collapsed.slice(0, maxLength);
	const lastSpace = cut.lastIndexOf(" ");
	const trimmed = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
	return trimmed.replace(/[\s.,;:!?，。；：！？、]+$/, "") + "…";
}

/** 计算字符串的哈希（djb2 变体），用于生成稳定的伪随机值。 */
export function hashCode(str: string): number {
	let h = 5381;
	for (let i = 0; i < str.length; i++) {
		h = (h * 33) ^ str.charCodeAt(i);
	}
	return h >>> 0; // 转为无符号
}

/**
 * 依据路径生成一个稳定且伪随机的倾斜角度，落在 [-maxTilt, maxTilt] 内。
 * 同一文件每次刷新角度一致，避免刷新时卡片跳动。
 */
export function tiltFor(path: string, maxTilt = 1.6): number {
	const frac = (hashCode(path) % 1000) / 1000; // [0, 1)
	const angle = (frac * 2 - 1) * maxTilt; // [-maxTilt, maxTilt)
	return Math.round(angle * 100) / 100; // 保留两位小数
}

/**
 * 把一批笔记整理成「按领域分组的卡片墙」。
 * 流程：筛选数据源 → 计算摘要与倾斜 → 按分组键归入各分区 → 稳定排序。
 */
export function buildCardWall(notes: NoteCard[], s: CardSettings): CardGroup[] {
	const map = new Map<string, CardEntry[]>();
	for (const note of notes) {
		if (!matchesSource(note, s)) continue;
		const entry: CardEntry = {
			note,
			excerpt: makeExcerpt(note.content, s.excerptLength),
			tilt: tiltFor(note.path),
		};
		for (const key of groupKeys(note, s)) {
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(entry);
		}
	}
	const groups: CardGroup[] = [...map.entries()].map(([key, cards]) => ({ key, cards }));
	// 分区标题排序：未归类放最后，其余按中文本地排序。
	const ungrouped = s.ungroupedLabel.trim() || "未归类";
	groups.sort((a, b) => {
		if (a.key === b.key) return 0;
		if (a.key === ungrouped) return 1;
		if (b.key === ungrouped) return -1;
		return a.key.localeCompare(b.key, "zh");
	});
	for (const g of groups) {
		g.cards.sort((a, b) => a.note.basename.localeCompare(b.note.basename, "zh"));
	}
	return groups;
}
