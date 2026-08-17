import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    emptyOutDir: true,
    outDir: dist,
    lib: {
      entry: resolve(root, "src/background/index.ts"),
      name: "btBackground",
      formats: ["iife"],
      fileName: () => "background.js",
    },
  },
});

await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: dist,
    lib: {
      entry: resolve(root, "src/content/index.ts"),
      name: "btContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});

mkdirSync(resolve(dist, "icons"), { recursive: true });
cpSync(resolve(root, "public/icons"), resolve(dist, "icons"), { recursive: true });
cpSync(resolve(root, "src/content/style.css"), resolve(dist, "content.css"));

writeFileSync(
  resolve(dist, "manifest.json"),
  `${JSON.stringify(
    {
      manifest_version: 3,
      name: "Bilingual Translate",
      version: "0.1.14",
      description: "双语对照阅读网页正文并翻译视频字幕，自动跳过代码块（含 Ed snippet）。",
      action: {
        default_title: "点击开启/关闭翻译",
      },
      background: {
        service_worker: "background.js",
      },
      content_scripts: [
        {
          matches: ["<all_urls>"],
          js: ["content.js"],
          css: ["content.css"],
          run_at: "document_idle",
          all_frames: true,
          match_about_blank: true,
          match_origin_as_fallback: true,
        },
      ],
      permissions: ["storage", "tabs", "scripting"],
      host_permissions: [
        "https://translate.googleapis.com/*",
        "http://*/*",
        "https://*/*",
      ],
      icons: {
        16: "icons/icon16.png",
        48: "icons/icon48.png",
        128: "icons/icon128.png",
      },
    },
    null,
    2,
  )}\n`,
);

console.log("built", dist);
