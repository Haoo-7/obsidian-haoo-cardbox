// 构建：把 src/main.ts 打包成 dist/main.js，并把 manifest.json、styles.css、versions.json 复制进 dist/，
// dist 目录就能直接链接或拷贝到库的 .obsidian/plugins/skeuomorphic-cards/。
import esbuild from "esbuild";
import process from "process";
import { copyFileSync, mkdirSync } from "node:fs";

const prod = process.argv[2] === "production";
mkdirSync("dist", { recursive: true });

const assets = ["manifest.json", "styles.css", "versions.json"];
const copyAssets = () => assets.forEach((f) => copyFileSync(f, `dist/${f}`));

// 开发时 styles.css 改了也要复制过去。
const copyOnRebuild = {
  name: "copy-assets",
  setup(build) {
    build.onEnd(() => copyAssets());
  },
};

const options = {
  banner: { js: "/* 由 esbuild 生成，源码见 src/ */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  minify: prod,
  platform: "node",
  plugins: [copyOnRebuild],
};

if (prod) {
  await esbuild.build(options);
  console.log("生产构建完成，产物在 dist/。");
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("监听中：src/ 有变化就重新打包到 dist/。");
}
