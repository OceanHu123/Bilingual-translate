import { cacheGetMany, cacheSetMany, hashKey } from "../shared/cache";
import type {
  BackgroundMessage,
  FetchJsonResponse,
  TabEnabledResponse,
  TranslateResponse,
} from "../shared/messages";
import { getSettings, setSettings } from "../shared/settings";
import { defaultTranslator } from "../shared/translator";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: "#1d4ed8" });
});

chrome.action.onClicked.addListener((tab) => {
  void toggleFromIcon(tab);
});

chrome.tabs.onActivated.addListener((info) => {
  void chrome.tabs.get(info.tabId).then(syncBadge).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.status === "complete" || change.url) void syncBadge(tab);
});

chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, sender, sendResponse) => {
    if (message.type === "INJECT_TAB") {
      sendResponse({ ok: true });
      void injectContent(message.tabId);
      return false;
    }

    if (message.type === "TAB_ENABLED") {
      void tabEnabled(sender).then(sendResponse);
      return true;
    }

    void handleMessage(message).then(sendResponse).catch((error: unknown) => {
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return true;
  },
);

async function toggleFromIcon(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;
  const url = tab.url || "";
  if (!/^https?:/i.test(url)) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({
      tabId: tab.id,
      title: "请在普通网页上使用（http/https）",
    });
    return;
  }

  const hostname = new URL(url).hostname;
  const settings = await getSettings();
  const enabled = !settings.enabledHosts.includes(hostname);
  const hosts = new Set(settings.enabledHosts);
  if (enabled) hosts.add(hostname);
  else hosts.delete(hostname);
  await setSettings({ enabledHosts: [...hosts] });
  await syncBadge(tab);
  await showToast(tab.id, enabled);
  void injectContent(tab.id);
}

async function syncBadge(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) return;
  let hostname = "";
  try {
    hostname = tab.url ? new URL(tab.url).hostname : "";
  } catch {
    hostname = "";
  }
  const settings = await getSettings();
  const enabled = Boolean(hostname && settings.enabledHosts.includes(hostname));
  await chrome.action.setBadgeText({ tabId: tab.id, text: enabled ? "ON" : "" });
  await chrome.action.setTitle({
    tabId: tab.id,
    title: enabled ? "翻译已开启，点击关闭" : "点击开启翻译",
  });
}

async function showToast(tabId: number, enabled: boolean): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func: (on) => {
        const id = "bt-toast";
        document.getElementById(id)?.remove();
        const el = document.createElement("div");
        el.id = id;
        el.textContent = on
          ? "Bilingual Translate 已开启"
          : "Bilingual Translate 已关闭";
        el.style.cssText = [
          "position:fixed",
          "right:12px",
          "bottom:12px",
          "z-index:2147483647",
          "background:#1d4ed8",
          "color:#fff",
          "padding:8px 12px",
          "border-radius:8px",
          "font:13px/1.4 sans-serif",
          "box-shadow:0 4px 16px rgba(0,0,0,.2)",
        ].join(";");
        (document.body || document.documentElement).append(el);
        window.setTimeout(() => {
          el.remove();
          document.getElementById("bt-hud")?.remove();
        }, 2000);
      },
      args: [enabled],
    });
  } catch {
    // Page cannot be scripted.
  }
}

async function tabEnabled(
  sender: chrome.runtime.MessageSender,
): Promise<TabEnabledResponse> {
  const url = sender.tab?.url || "";
  let hostname = "";
  try {
    hostname = url ? new URL(url).hostname : "";
  } catch {
    hostname = "";
  }
  const settings = await getSettings();
  return {
    enabled: Boolean(hostname && settings.enabledHosts.includes(hostname)),
    hostname,
  };
}

async function handleMessage(message: BackgroundMessage): Promise<unknown> {
  switch (message.type) {
    case "GET_SETTINGS":
      return getSettings();
    case "SET_SETTINGS":
      return setSettings(message.settings);
    case "TRANSLATE":
      return translateWithCache(message.texts, message.targetLang);
    case "FETCH_JSON":
      return fetchCaptionJson(message.url);
    default:
      return { error: "Unknown message" };
  }
}

async function injectContent(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js ?? [];
  const css = manifest.content_scripts?.[0]?.css ?? [];
  const top = { tabId, allFrames: false as const };
  try {
    if (css.length) {
      await chrome.scripting.insertCSS({ target: top, files: css });
    }
    if (files.length) {
      await chrome.scripting.executeScript({ target: top, files });
    }
  } catch {
    // Page may already have the content script, or injection is blocked.
  }
}

async function translateWithCache(
  texts: string[],
  targetLang: string,
): Promise<TranslateResponse> {
  const keys = await Promise.all(texts.map((text) => hashKey(text, targetLang)));
  const cached = await cacheGetMany(keys);
  const missing: { index: number; text: string; key: string }[] = [];
  const translations = new Array<string>(texts.length);

  texts.forEach((text, index) => {
    const hit = cached.get(keys[index]);
    if (hit) translations[index] = hit;
    else missing.push({ index, text, key: keys[index] });
  });

  if (missing.length) {
    const translated = await defaultTranslator.translate(
      missing.map((item) => item.text),
      targetLang,
    );
    const toStore: Record<string, string> = {};
    missing.forEach((item, i) => {
      const value = translated[i] ?? item.text;
      translations[item.index] = value;
      toStore[item.key] = value;
    });
    await cacheSetMany(toStore);
  }

  return { translations };
}

function isCaptionFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname;
    const youtube =
      host === "youtu.be" ||
      host.endsWith(".youtube.com") ||
      host === "youtube.com" ||
      host.endsWith(".youtube-nocookie.com") ||
      host === "youtube-nocookie.com";
    return youtube && parsed.pathname.includes("timedtext");
  } catch {
    return false;
  }
}

async function fetchCaptionJson(url: string): Promise<FetchJsonResponse> {
  if (!isCaptionFetchUrl(url)) return { error: "unsupported caption url" };
  const response = await fetch(url);
  if (!response.ok) return { error: `Caption HTTP ${response.status}` };
  return { json: await response.json() };
}
