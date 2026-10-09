// 设置页 UI：数据源（标签/文件夹/frontmatter）、分组方式、摘要长度。
// 采用「条件显示」，只呈现与当前筛选/分组方式相关的字段。
import { App, PluginSettingTab, Setting } from "obsidian";
import type { GroupMode, SourceKind } from "./cards";
import type SkeuoPlugin from "./main";

/** 控制某一行设置的显示/隐藏。 */
function setVisible(setting: Setting, show: boolean): void {
	setting.settingEl.style.display = show ? "" : "none";
}

export class CardWallSettingTab extends PluginSettingTab {
	private plugin: SkeuoPlugin;
	/** 保存各设置行引用，便于切换显隐。 */
	private rows: Partial<Record<string, Setting>> = {};

	constructor(app: App, plugin: SkeuoPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.rows = {};

		containerEl.createEl("h2", { text: "拟物卡片盒笔记墙" });

		// —— 卡片来源 ——
		containerEl.createEl("h3", { text: "卡片来源" });

		this.rows.sourceKind = new Setting(containerEl)
			.setName("筛选方式")
			.setDesc("三选一：按标签、按文件夹、或按 frontmatter 字段挑选哪些笔记算作卡片。")
			.addDropdown((d) =>
				d
					.addOption("tag", "按标签")
					.addOption("folder", "按文件夹")
					.addOption("frontmatter", "按 frontmatter 字段")
					.setValue(this.plugin.settings.sourceKind)
					.onChange(async (value) => {
						this.plugin.settings.sourceKind = value as SourceKind;
						await this.commit();
					}),
			);

		this.rows.sourceTag = new Setting(containerEl)
			.setName("标签")
			.setDesc("卡片需带此标签，不含 #。例如 card 表示只收集 #card 笔记。")
			.addText((t) =>
				t
					.setPlaceholder("card")
					.setValue(this.plugin.settings.sourceTag)
					.onChange(async (value) => {
						this.plugin.settings.sourceTag = value;
						await this.commit();
					}),
			);

		this.rows.sourceFolder = new Setting(containerEl)
			.setName("文件夹路径")
			.setDesc("只收集该文件夹（含子文件夹）下的笔记。例如 Literature。")
			.addText((t) =>
				t
					.setPlaceholder("Literature")
					.setValue(this.plugin.settings.sourceFolder)
					.onChange(async (value) => {
						this.plugin.settings.sourceFolder = value;
						await this.commit();
					}),
			);

		this.rows.sourceField = new Setting(containerEl)
			.setName("frontmatter 字段")
			.setDesc("该字段存在且非空的笔记即为卡片。例如 type。")
			.addText((t) =>
				t
					.setPlaceholder("type")
					.setValue(this.plugin.settings.sourceField)
					.onChange(async (value) => {
						this.plugin.settings.sourceField = value;
						await this.commit();
					}),
			);

		this.rows.sourceValue = new Setting(containerEl)
			.setName("字段值（可选）")
			.setDesc("进一步限定：字段值需等于此处填写的值。留空表示只要字段存在即可。")
			.addText((t) =>
				t
					.setPlaceholder("literature")
					.setValue(this.plugin.settings.sourceValue)
					.onChange(async (value) => {
						this.plugin.settings.sourceValue = value;
						await this.commit();
					}),
			);

		// —— 领域分组 ——
		containerEl.createEl("h3", { text: "领域分组" });

		this.rows.groupMode = new Setting(containerEl)
			.setName("分组方式")
			.setDesc("按标签，或按 frontmatter 字段（如 category）把卡片分到不同领域。")
			.addDropdown((d) =>
				d
					.addOption("tag", "按标签")
					.addOption("frontmatter", "按 frontmatter 字段")
					.setValue(this.plugin.settings.groupMode)
					.onChange(async (value) => {
						this.plugin.settings.groupMode = value as GroupMode;
						await this.commit();
					}),
			);

		this.rows.groupField = new Setting(containerEl)
			.setName("分组字段")
			.setDesc("用作分组键的 frontmatter 字段名。其值可为单个标签或列表。")
			.addText((t) =>
				t
					.setPlaceholder("category")
					.setValue(this.plugin.settings.groupField)
					.onChange(async (value) => {
						this.plugin.settings.groupField = value;
						await this.commit();
					}),
			);

		this.rows.tagNamespace = new Setting(containerEl)
			.setName("标签命名空间（可选）")
			.setDesc("按标签分组时，只把带此前缀的标签当作领域。留空表示用全部标签（已排除来源标签）。")
			.addText((t) =>
				t
					.setPlaceholder("domain")
					.setValue(this.plugin.settings.tagNamespace)
					.onChange(async (value) => {
						this.plugin.settings.tagNamespace = value;
						await this.commit();
					}),
			);

		// —— 卡片外观 ——
		containerEl.createEl("h3", { text: "卡片" });

		this.rows.excerptLength = new Setting(containerEl)
			.setName("摘要长度")
			.setDesc("每张卡片显示正文前多少个字符。")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "10";
				t.inputEl.max = "1000";
				t.setPlaceholder("120")
					.setValue(String(this.plugin.settings.excerptLength))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						this.plugin.settings.excerptLength = Number.isFinite(n) ? Math.max(10, Math.min(1000, n)) : 120;
						await this.commit();
					});
			});

		this.rows.ungroupedLabel = new Setting(containerEl)
			.setName("未分组标题")
			.setDesc("卡片未命中任何分组时归入此分区。")
			.addText((t) =>
				t
					.setPlaceholder("未归类")
					.setValue(this.plugin.settings.ungroupedLabel)
					.onChange(async (value) => {
						this.plugin.settings.ungroupedLabel = value;
						await this.commit();
					}),
			);

		this.refresh();
	}

	/** 保存设置、刷新显隐、并重绘卡片墙。 */
	private async commit(): Promise<void> {
		await this.plugin.saveSettings();
		this.refresh();
		this.plugin.refreshViews();
	}

	/** 依当前设置切换各行的显示。 */
	private refresh(): void {
		const s = this.plugin.settings;
		setVisible(this.rows.sourceTag!, s.sourceKind === "tag");
		setVisible(this.rows.sourceFolder!, s.sourceKind === "folder");
		setVisible(this.rows.sourceField!, s.sourceKind === "frontmatter");
		setVisible(this.rows.sourceValue!, s.sourceKind === "frontmatter");
		setVisible(this.rows.groupField!, s.groupMode === "frontmatter");
		setVisible(this.rows.tagNamespace!, s.groupMode === "tag");
	}
}
