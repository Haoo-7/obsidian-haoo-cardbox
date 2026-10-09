// 卡片墙视图（ItemView）：从 vault 收集笔记、构建分组、渲染拟物卡片，
// 并通过 metadataCache / vault 事件在增删改笔记时自动刷新。
import { debounce, ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { buildCardWall, normalizeTag, type CardGroup, type NoteCard } from "./cards";
import type SkeuoPlugin from "./main";

export const VIEW_TYPE_SKEUO_CARDS = "skeuomorphic-card-wall";

export class CardWallView extends ItemView {
	private plugin: SkeuoPlugin;
	/** 视图是否已关闭；关闭后异步渲染应中止。 */
	private destroyed = false;

	constructor(leaf: WorkspaceLeaf, plugin: SkeuoPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SKEUO_CARDS;
	}

	getDisplayText(): string {
		return "卡片盒笔记墙";
	}

	getIcon(): string {
		return "layers";
	}

	async onOpen(): Promise<void> {
		this.destroyed = false;

		// 笔记内容/frontmatter 变化时刷新（编辑时高频，交给防抖）。
		const scheduleRefresh = debounce(() => void this.render(), 400, false);
		// 结构变化（新建/删除/改名/索引完成）需要更即时地响应。
		const structuralRefresh = debounce(() => void this.render(), 150, false);

		this.registerEvent(this.app.metadataCache.on("changed", scheduleRefresh));
		this.registerEvent(this.app.metadataCache.on("resolved", structuralRefresh));
		this.registerEvent(this.app.vault.on("create", structuralRefresh));
		this.registerEvent(this.app.vault.on("delete", structuralRefresh));
		this.registerEvent(this.app.vault.on("rename", structuralRefresh));
		this.registerEvent(this.app.vault.on("modify", scheduleRefresh));

		await this.render();
	}

	async onClose(): Promise<void> {
		this.destroyed = true;
	}

	/** 供插件在设置变化时主动重绘。 */
	requestRefresh(): void {
		if (!this.destroyed) void this.render();
	}

	/** 收集当前 vault 中所有 Markdown 笔记，转成纯逻辑所需的 NoteCard 数据。 */
	private async collectNotes(): Promise<NoteCard[]> {
		const files = this.app.vault.getMarkdownFiles();
		const notes: NoteCard[] = [];
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const content = await this.app.vault.cachedRead(file);

			const tagSet = new Set<string>();
			if (cache?.tags) {
				for (const t of cache.tags) tagSet.add(normalizeTag(t.tag));
			}
			const fmTags = cache?.frontmatter?.tags;
			if (Array.isArray(fmTags)) {
				for (const t of fmTags) tagSet.add(normalizeTag(String(t)));
			} else if (fmTags !== undefined && fmTags !== null) {
				tagSet.add(normalizeTag(String(fmTags)));
			}

			notes.push({
				path: file.path,
				basename: file.basename,
				tags: [...tagSet].filter(Boolean),
				frontmatter: (cache?.frontmatter as Record<string, unknown>) ?? {},
				content,
			});
		}
		return notes;
	}

	/** 渲染整面卡片墙。 */
	async render(): Promise<void> {
		if (this.destroyed) return;
		const { containerEl } = this;

		const notes = await this.collectNotes();
		if (this.destroyed) return; // 异步读取期间可能已关闭

		const groups = buildCardWall(notes, this.plugin.settings);

		containerEl.empty();
		containerEl.addClass("skw-container");
		this.renderHeader(containerEl, groups);

		if (groups.length === 0) {
			containerEl.createDiv({
				cls: "skw-empty",
				text: "没有符合条件的卡片。请在设置中调整「卡片来源」，或给笔记打上对应标签。",
			});
			return;
		}

		for (const group of groups) {
			this.renderSection(containerEl, group);
		}
	}

	private renderHeader(containerEl: HTMLElement, groups: CardGroup[]): void {
		const header = containerEl.createDiv({ cls: "skw-header" });
		header.createEl("h1", { text: "卡片盒笔记墙", cls: "skw-title" });
		const total = groups.reduce((sum, g) => sum + g.cards.length, 0);
		const domains = groups.filter((g) => g.key !== (this.plugin.settings.ungroupedLabel.trim() || "未归类")).length;
		header.createEl("p", {
			text: `共 ${total} 张卡片 · ${domains} 个领域`,
			cls: "skw-subtitle",
		});
	}

	private renderSection(containerEl: HTMLElement, group: CardGroup): void {
		const section = containerEl.createDiv({ cls: "skw-section" });
		const title = section.createDiv({ cls: "skw-section-title" });
		title.createSpan({ text: group.key, cls: "skw-section-name" });
		title.createSpan({ text: String(group.cards.length), cls: "skw-section-count" });

		const grid = section.createDiv({ cls: "skw-grid" });
		for (const entry of group.cards) {
			this.renderCard(grid, entry.note, entry.excerpt, entry.tilt);
		}
	}

	private renderCard(grid: HTMLElement, note: NoteCard, excerpt: string, tilt: number): void {
		const card = grid.createDiv({ cls: "skw-card", attr: { "data-path": note.path, "aria-label": note.basename } });
		// 稳定倾斜角通过 CSS 变量传入（见 styles.css）。
		card.style.setProperty("--tilt", `${tilt}deg`);

		card.createDiv({ cls: "skw-card-title", text: note.basename });
		card.createDiv({ cls: "skw-card-excerpt", text: excerpt || "（暂无正文）" });
		card.createDiv({ cls: "skw-card-path", text: note.path });

		const open = () => this.openNote(note.path);
		card.addEventListener("click", open);
		card.setAttribute("tabindex", "0"); // 键盘可达性
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				open();
			}
		});
	}

	private openNote(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (!(file instanceof TFile)) return;
		void this.app.workspace.getLeaf(true).openFile(file);
	}
}
