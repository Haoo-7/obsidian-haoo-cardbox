import { PluginSettingTab, Setting, requireApiVersion } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type HaooCardbox from "../main";
import { SWATCHES } from "../core";

const PREFIX_DESC = "带这个前缀的标签就是领域，一个领域一个卡堆。比如前缀是 domain/，标签 #domain/辽宋夏金元 就进「辽宋夏金元」那一堆。";
const FOLDER_COLOR_DESC = "没有单独换过颜色的文件夹都用这种。跟着主题：浅色主题雾白，深色主题石墨。";

/**
 * 设置页：领域标签的前缀、文件夹的颜色。
 * Obsidian 1.13 起走声明式的 getSettingDefinitions()，设置项才能被设置搜索找到；
 * 1.13 以前仍然走命令式的 display()，所以两个实现要一起改。
 */
export class SettingsTab extends PluginSettingTab {
  constructor(private plugin: HaooCardbox) {
    super(plugin.app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;
    const n = Object.keys(s.folderColors).length;
    return [
      {
        name: "领域标签的前缀",
        desc: PREFIX_DESC,
        control: { type: "text", key: "domainPrefix", placeholder: "例如 domain/" },
      },
      {
        type: "group",
        heading: "文件夹",
        items: [
          {
            name: "默认颜色",
            desc: FOLDER_COLOR_DESC,
            control: {
              type: "dropdown",
              key: "folderColor",
              options: { "": "跟着主题", ...Object.fromEntries(SWATCHES.map((w) => [w.id, w.name])) },
            },
          },
          {
            name: "单独换过颜色的文件夹",
            desc: this.dedicatedDesc(n),
            // 按钮不是声明式控件：这里渲染实际按钮，点完再让设置页重画一次。
            render: (setting) => {
              setting.addButton((b) => b
                .setButtonText("都改回默认")
                .setDisabled(!n)
                .onClick(async () => {
                  await this.plugin.setDefaultColor(s.folderColor, false);
                  if (requireApiVersion("1.13.0")) this.update();
                }));
            },
          },
        ],
      },
    ];
  }

  /**
   * 声明式控件只认 key，不会调用插件的方法。把两个键接到原来的 setPrefix / setDefaultColor 上，
   * 保存设置、重算卡堆、重画卡堆栏这些副作用才不会丢。
   */
  getControlValue(key: string): unknown {
    if (key === "folderColor") return this.plugin.settings.folderColor ?? "";
    if (requireApiVersion("1.13.0")) return super.getControlValue(key);
    return undefined;
  }
  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "domainPrefix" && typeof value === "string") return this.plugin.setPrefix(value);
    if (key === "folderColor" && typeof value === "string") return this.plugin.setDefaultColor(value || null, true);
    if (requireApiVersion("1.13.0")) return super.setControlValue(key, value);
  }

  // Obsidian 1.13 起 settings 页由 getSettingDefinitions() 渲染，不再调用 display()；
  // 但 minAppVersion 还是 1.5.0，旧版本只能靠命令式的 display()。
  display(): void {
    this.renderLegacy();
  }

  private renderLegacy(): void {
    const { containerEl: el, plugin } = this;
    const s = plugin.settings;
    el.empty();

    new Setting(el)
      .setName("领域标签的前缀")
      .setDesc(PREFIX_DESC)
      .addText((t) => t.setPlaceholder("例如 domain/").setValue(s.domainPrefix).onChange((v) => void plugin.setPrefix(v)));

    new Setting(el).setName("文件夹").setHeading();

    new Setting(el)
      .setName("默认颜色")
      .setDesc(FOLDER_COLOR_DESC)
      .addDropdown((d) => {
        d.addOption("", "跟着主题");
        SWATCHES.forEach((w) => {
          d.addOption(w.id, w.name);
        });
        d.setValue(s.folderColor ?? "").onChange((v) => void plugin.setDefaultColor(v || null, true));
      });

    const n = Object.keys(s.folderColors).length;
    new Setting(el)
      .setName("单独换过颜色的文件夹")
      .setDesc(this.dedicatedDesc(n))
      .addButton((b) => b.setButtonText("都改回默认").setDisabled(!n).onClick(async () => {
        await plugin.setDefaultColor(s.folderColor, false);
        this.renderLegacy();
      }));
  }

  private dedicatedDesc(n: number): string {
    return n ? `${n} 个文件夹单独换过颜色。在卡堆栏里右键文件夹可以换色。` : "还没有。在卡堆栏里右键文件夹可以换色。";
  }
}
