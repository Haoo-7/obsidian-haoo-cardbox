// 插件设置：类型定义与默认值。
import type { CardSettings } from "./cards";

/** 插件完整设置。当前与纯逻辑所需的 CardSettings 字段一致。 */
export interface PluginSettings extends CardSettings {}

/** 默认设置：按 #card 标签筛选，按 frontmatter 的 category 字段分组。 */
export const DEFAULT_SETTINGS: PluginSettings = {
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
};

/** 从存储数据加载设置，缺失字段用默认值补齐（前向兼容新增设置项）。 */
export function normalizeSettings(loaded: unknown): PluginSettings {
	const data = (loaded ?? {}) as Partial<PluginSettings>;
	return {
		...DEFAULT_SETTINGS,
		...data,
		// 数值单独兜底，避免存了非法值。
		excerptLength: clampInt(data.excerptLength, 10, 1000, DEFAULT_SETTINGS.excerptLength),
	};
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, Math.round(n)));
}
