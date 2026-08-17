import type {
  ContentMessage,
  PageState,
  TabEnabledResponse,
  TranslateResponse,
} from "../shared/messages";
import type { Settings } from "../shared/settings";
import {
  placeholderInlineCode,
  restorePlaceholders,
  shouldSkipBlock,
  shouldSkipText,
} from "./skip";
import { startSubtitles, stopSubtitles } from "./subtitles";

const w = window as Window & { __BT_LOADED__?: boolean };
if (!w.__BT_LOADED__) {
  w.__BT_LOADED__ = true;
  boot();
}

function boot(): void {
  const BLOCK_SELECTOR = [
    "p",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "figcaption",
    "td",
    "th",
    "dd",
    "dt",
    "paragraph",
  ].join(",");

  const MIN_CHARS = 8;
  const TRANSLATION_CLASS = "bt-translation";
  const HUD_ID = "bt-hud";

  let enabled = false;
  let targetLang = "zh-CN";
  let nextId = 1;
  let lastError = "";
  let translatedCount = 0;
  let observer: MutationObserver | null = null;
  let queued = new WeakSet<HTMLElement>();
  let scanTimer = 0;
  const visibleBatch: HTMLElement[] = [];
  let flushTimer = 0;

  function isMostlyTargetLang(text: string, lang: string): boolean {
    if (!lang.toLowerCase().startsWith("zh")) return false;
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const letters = (text.match(/[A-Za-z\u4e00-\u9fff]/g) || []).length;
    return letters > 0 && cjk / letters > 0.5;
  }

  let hudTimer = 0;

  function showHud(text: string, autoHideMs = 2000): void {
    let hud = document.getElementById(HUD_ID);
    if (!hud) {
      hud = document.createElement("div");
      hud.id = HUD_ID;
      (document.body || document.documentElement).append(hud);
    }
    hud.textContent = text;
    window.clearTimeout(hudTimer);
    hudTimer = window.setTimeout(hideHud, autoHideMs);
  }

  function hideHud(): void {
    window.clearTimeout(hudTimer);
    document.getElementById(HUD_ID)?.remove();
    document.getElementById("bt-toast")?.remove();
  }

  function collectCandidates(): HTMLElement[] {
    if (!document.body) return [];
    const found = new Set<HTMLElement>();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
          if (text.length < 2) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || parent.id === HUD_ID) return NodeFilter.FILTER_REJECT;
          if (parent.closest(`#${HUD_ID}, .${TRANSLATION_CLASS}`)) {
            return NodeFilter.FILTER_REJECT;
          }
          if (shouldSkipBlock(parent)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );

    let current: Node | null;
    while ((current = walker.nextNode())) {
      const parent = current.parentElement;
      if (!parent) continue;
      let block = parent.closest(BLOCK_SELECTOR) as HTMLElement | null;
      if (!block) {
        if (parent.tagName === "SPAN" || parent.tagName === "A") continue;
        block = parent;
      }
      if (block.id === HUD_ID || block.classList.contains(TRANSLATION_CLASS)) {
        continue;
      }
      if (shouldSkipBlock(block)) continue;
      const text = (block.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length < MIN_CHARS) continue;
      found.add(block);
    }

    document.querySelectorAll("*").forEach((el) => {
      if (el instanceof HTMLElement && el.shadowRoot) {
        collectFromShadow(el.shadowRoot).forEach((node) => found.add(node));
      }
    });

    return [...found].filter(
      (el) => ![...found].some((other) => other !== el && el.contains(other)),
    );
  }

  function collectFromShadow(root: ShadowRoot): HTMLElement[] {
    const items: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>("*").forEach((el) => {
      if (shouldSkipBlock(el)) return;
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (text.length >= MIN_CHARS) items.push(el);
    });
    return items.filter(
      (el) => !items.some((other) => other !== el && el.contains(other)),
    );
  }

  type Prepared = {
    el: HTMLElement;
    id: string;
    text: string;
    placeholders: string[];
  };

  function queueVisible(el: HTMLElement): void {
    if (queued.has(el) || el.dataset.btId) return;
    queued.add(el);
    visibleBatch.push(el);
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      void flushVisible();
    }, 40);
  }

  function prepare(el: HTMLElement): Prepared | null {
    if (!enabled || !el.isConnected) return null;
    if (el.dataset.btId) return null;
    if (shouldSkipBlock(el)) return null;
    if (shouldSkipText((el.textContent || "").replace(/\s+/g, " ").trim())) {
      return null;
    }
    const { text, placeholders } = placeholderInlineCode(el);
    if (text.length < MIN_CHARS) return null;
    if (shouldSkipText(text)) return null;
    if (isMostlyTargetLang(text, targetLang)) return null;
    const id = String(nextId++);
    el.dataset.btId = id;
    return { el, id, text, placeholders };
  }

  async function flushVisible(): Promise<void> {
    const batch = visibleBatch.splice(0);
    const prepared = batch
      .map(prepare)
      .filter((item): item is Prepared => item !== null);
    if (!prepared.length) return;

    const texts = prepared.map((item) => item.text);
    const translations = await requestTranslations(texts);
    if (!enabled) return;
    if (!translations) {
      prepared.forEach((item) => delete item.el.dataset.btId);
      return;
    }

    prepared.forEach((item, index) => {
      if (!item.el.isConnected) return;
      const raw = translations[index];
      if (!raw) {
        delete item.el.dataset.btId;
        return;
      }
      const translated = restorePlaceholders(raw, item.placeholders).trim();
      if (!translated || translated === item.text) return;
      insertTranslation(item.el, item.id, translated);
      translatedCount += 1;
    });
  }

  async function requestTranslations(
    texts: string[],
  ): Promise<string[] | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = (await chrome.runtime.sendMessage({
          type: "TRANSLATE",
          texts,
          targetLang,
        })) as TranslateResponse | undefined;
        if (response?.translations?.length) return response.translations;
      } catch {
        // Service worker may be waking up; retry once.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    return null;
  }

  function insertTranslation(
    el: HTMLElement,
    id: string,
    translated: string,
  ): void {
    if (
      el.parentElement?.querySelector(
        `.${TRANSLATION_CLASS}[data-bt-for="${id}"]`,
      )
    ) {
      return;
    }
    const node = document.createElement("div");
    node.className = TRANSLATION_CLASS;
    node.dataset.btFor = id;
    node.setAttribute("translate", "no");
    node.textContent = translated;

    const heading = /^H[1-6]$/.test(el.tagName);
    const computed = getComputedStyle(el);
    const sourceSize = Number.parseFloat(computed.fontSize);
    if (heading || (Number.isFinite(sourceSize) && sourceSize >= 20)) {
      node.style.fontSize = `${Math.round(sourceSize * 0.85)}px`;
      node.style.fontWeight = computed.fontWeight === "400" ? "600" : computed.fontWeight;
    }

    if (
      heading ||
      el.tagName === "LI" ||
      el.tagName === "TD" ||
      el.tagName === "TH"
    ) {
      el.append(node);
    } else {
      el.after(node);
    }
  }

  function scan(): void {
    if (!enabled) return;
    const candidates = collectCandidates();
    candidates.forEach(queueVisible);
  }

  function scheduleScan(): void {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 250);
  }

  function startObservers(): void {
    stopObservers(false);
    scan();
    observer = new MutationObserver((mutations) => {
      if (!enabled) return;
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length) {
          const addedTranslation = [...mutation.addedNodes].some(
            (node) =>
              node instanceof HTMLElement &&
              (node.id === HUD_ID ||
                node.classList.contains(TRANSLATION_CLASS) ||
                Boolean(node.closest(`#${HUD_ID}, .${TRANSLATION_CLASS}`))),
          );
          if (addedTranslation) continue;
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function stopObservers(clearQueued = true): void {
    observer?.disconnect();
    observer = null;
    window.clearTimeout(scanTimer);
    window.clearTimeout(flushTimer);
    visibleBatch.splice(0);
    if (clearQueued) queued = new WeakSet<HTMLElement>();
  }

  function removeTranslations(): void {
    document
      .querySelectorAll(`.${TRANSLATION_CLASS}`)
      .forEach((node) => node.remove());
    document.querySelectorAll<HTMLElement>("[data-bt-id]").forEach((el) => {
      delete el.dataset.btId;
    });
    queued = new WeakSet<HTMLElement>();
    translatedCount = 0;
  }

  async function loadSettings(): Promise<Settings> {
    return (await chrome.runtime.sendMessage({
      type: "GET_SETTINGS",
    })) as Settings;
  }

  async function tabIsEnabled(settings: Settings): Promise<boolean> {
    if (settings.enabledHosts.includes(location.hostname)) return true;
    try {
      const reply = (await chrome.runtime.sendMessage({
        type: "TAB_ENABLED",
      })) as TabEnabledResponse;
      return Boolean(reply?.enabled);
    } catch {
      return false;
    }
  }

  function pageState(): PageState {
    return {
      enabled,
      hostname: location.hostname,
      error: lastError || undefined,
    };
  }

  async function enable(): Promise<PageState> {
    enabled = true;
    showHud("已开启", 2000);
    startObservers();
    startSubtitles(targetLang);
    return pageState();
  }

  function disable(): PageState {
    enabled = false;
    stopObservers();
    stopSubtitles();
    removeTranslations();
    hideHud();
    return pageState();
  }

  async function applySettings(settings: Settings): Promise<void> {
    targetLang = settings.targetLang || "zh-CN";
    if (await tabIsEnabled(settings)) await enable();
    else disable();
  }

  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender, sendResponse) => {
      if (message.type === "SET_ENABLED") {
        sendResponse(
          message.enabled
            ? { enabled: true, hostname: location.hostname }
            : disable(),
        );
        if (message.enabled) void enable();
        return false;
      }
      if (message.type === "GET_PAGE_STATE") {
        sendResponse(pageState());
      }
      return undefined;
    },
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["bt-settings"]) return;
    void loadSettings().then(async (settings) => {
      const langChanged = settings.targetLang !== targetLang;
      targetLang = settings.targetLang || "zh-CN";
      if (!(await tabIsEnabled(settings))) {
        disable();
        return;
      }
      if (langChanged) {
        removeTranslations();
        stopSubtitles();
      }
      void enable();
    });
  });

  void loadSettings()
    .then(applySettings)
    .catch(() => undefined);
}
