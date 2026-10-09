// 插件入口：注册视图、ribbon 图标、命令与设置页；负责设置的加载/保存与视图联动刷新。
import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, normalizeSettings, type PluginSettings } from "./settings";
import { CardWallSettingTab } from "./settings-tab";
import { CardWallView, VIEW_TYPE_SKEUO_CARDS } from "./view";

export default class SkeuoPlugin extends Plugin {
	settings: PluginSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		// 注册自定义视图：卡片墙。
		this.registerView(VIEW_TYPE_SKEUO_CARDS, (leaf) => new CardWallView(leaf, this));

		// ribbon 图标：一键打开卡片墙。
		this.addRibbonIcon("layers", "打开卡片盒笔记墙", () => {
			void this.activateView();
		});

		// 命令面板：打开卡片墙。
		this.addCommand({
			id: "open-card-wall",
			name: "打开卡片盒笔记墙",
			callback: () => {
				void this.activateView();
			},
		});

		// vault 加载完成后，刷新之前打开的视图，避免重启后视图空白。
		this.app.workspace.onLayoutReady(() => {
			this.refreshViews();
		});

		this.addSettingTab(new CardWallSettingTab(this.app, this));
	}

	onunload(): void {
		// 关闭所有卡片墙视图，清理 workspace 遗留状态。
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SKEUO_CARDS);
	}

	/** 激活（或创建）卡片墙视图，优先复用已存在的 leaf。 */
	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_SKEUO_CARDS)[0];
		if (!leaf) {
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_SKEUO_CARDS, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	/** 让所有已打开的卡片墙视图重新读取设置并重绘（设置页调用）。 */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SKEUO_CARDS)) {
			(leaf.view as CardWallView)?.requestRefresh?.();
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
