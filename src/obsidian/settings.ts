import { PluginSettingTab, Setting } from "obsidian";
import type HaooCardbox from "../main";
import { SWATCHES } from "../core";

/** 设置页：领域标签的前缀、文件夹的颜色。 */
export class SettingsTab extends PluginSettingTab {
  constructor(private plugin: HaooCardbox) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl: el, plugin } = this;
    const s = plugin.settings;
    el.empty();

    new Setting(el)
      .setName("领域标签的前缀")
      .setDesc("带这个前缀的标签就是领域，一个领域一个卡堆。比如前缀是 domain/，标签 #domain/辽宋夏金元 就进「辽宋夏金元」那一堆。")
      .addText((t) => t.setPlaceholder("domain/").setValue(s.domainPrefix).onChange((v) => void plugin.setPrefix(v)));

    new Setting(el).setName("文件夹").setHeading();

    new Setting(el)
      .setName("默认颜色")
      .setDesc("没有单独换过颜色的文件夹都用这种。跟着主题：浅色主题雾白，深色主题石墨。")
      .addDropdown((d) => {
        d.addOption("", "跟着主题");
        SWATCHES.forEach((w) => d.addOption(w.id, w.name));
        d.setValue(s.folderColor ?? "").onChange((v) => void plugin.setDefaultColor(v || null, true));
      });

    const n = Object.keys(s.folderColors).length;
    new Setting(el)
      .setName("单独换过颜色的文件夹")
      .setDesc(n ? `${n} 个文件夹单独换过颜色。在卡堆栏里右键文件夹可以换色。` : "还没有。在卡堆栏里右键文件夹可以换色。")
      .addButton((b) => b.setButtonText("都改回默认").setDisabled(!n).onClick(async () => {
        await plugin.setDefaultColor(s.folderColor, false);
        this.display();
      }));
  }
}
