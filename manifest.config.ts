import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Bilingual Translate",
  version: "0.1.5",
  description: "双语对照阅读网页正文，自动跳过代码块（含 Ed snippet）。",
  action: {
    default_title: "点击开启/关闭翻译",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      css: ["src/content/style.css"],
      run_at: "document_idle",
      all_frames: true,
      match_about_blank: true,
      // Chrome 96+: inject into srcdoc / opaque origin iframes (Ed lessons).
      // @ts-expect-error CRXJS types omit this MV3 field
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
});
