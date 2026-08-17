import type { FetchJsonResponse, TranslateResponse } from "../shared/messages";

type Cue = { start: number; end: number; text: string };

const OVERLAY_CLASS = "bt-sub-overlay";
const HOST_CLASS = "bt-sub-host";
const CAPTION_DOM_SELECTORS = [
  ".ytp-caption-segment",
  ".vjs-text-track-cue",
  ".plyr__captions",
  ".jw-text-track-container",
  ".shaka-text-container",
  ".mejs__captions-text",
].join(",");

const cache = new Map<string, string>();
const overlays = new WeakMap<HTMLVideoElement, HTMLElement>();
const hooked = new WeakSet<HTMLVideoElement>();
let running = false;
let targetLang = "zh-CN";
let observer: MutationObserver | null = null;
let tickTimer = 0;
let youtubeCues: Cue[] | null = null;
let youtubeId = "";
let youtubeLoading = "";

export function startSubtitles(lang: string): void {
  targetLang = lang || "zh-CN";
  if (running) return;
  running = true;
  document.documentElement.classList.add("bt-sub-active");
  scanVideos();
  void loadYoutubeCues();
  observer = new MutationObserver(() => {
    if (!running) return;
    scanVideos();
    if (youtubeVideoId() !== youtubeId) {
      youtubeCues = null;
      void loadYoutubeCues();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("fullscreenchange", onFullscreen);
  tickTimer = window.setInterval(() => {
    if (running) scanVideos();
  }, 1000);
}

export function stopSubtitles(): void {
  running = false;
  observer?.disconnect();
  observer = null;
  window.clearInterval(tickTimer);
  window.removeEventListener("fullscreenchange", onFullscreen);
  document.documentElement.classList.remove("bt-sub-active");
  document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((node) => node.remove());
  document.querySelectorAll(`.${HOST_CLASS}`).forEach((node) => {
    node.classList.remove(HOST_CLASS);
  });
  youtubeCues = null;
  youtubeId = "";
}

function onFullscreen(): void {
  if (!running) return;
  document.querySelectorAll(`.${OVERLAY_CLASS}`).forEach((node) => node.remove());
  scanVideos();
}

function scanVideos(): void {
  if (!running) return;
  document.querySelectorAll("video").forEach((video) => {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.ended && video.currentTime === 0) return;
    hookVideo(video);
    updateOverlay(video);
  });
}

function hookVideo(video: HTMLVideoElement): void {
  if (hooked.has(video)) return;
  hooked.add(video);
  video.addEventListener("timeupdate", () => updateOverlay(video));
  video.addEventListener("seeked", () => updateOverlay(video));
  video.addEventListener("loadedmetadata", () => {
    enableHiddenTracks(video);
    updateOverlay(video);
  });
  enableHiddenTracks(video);
  for (const track of video.textTracks) {
    track.addEventListener("cuechange", () => updateOverlay(video));
  }
}

function enableHiddenTracks(video: HTMLVideoElement): void {
  const tracks = [...video.textTracks].filter(
    (track) => track.kind === "subtitles" || track.kind === "captions",
  );
  if (!tracks.length) return;
  const hasLive = tracks.some((track) => track.mode === "showing" || track.mode === "hidden");
  if (hasLive) return;
  tracks[0].mode = "hidden";
}

function overlayHost(video: HTMLVideoElement): HTMLElement {
  const fs = document.fullscreenElement;
  if (fs instanceof HTMLElement && (fs === video || fs.contains(video))) return fs;
  return (
    video.closest<HTMLElement>(
      ".html5-video-player, .video-js, .plyr, .jwplayer, .shaka-video-container",
    ) ||
    video.parentElement ||
    document.body
  );
}

function ensureOverlay(video: HTMLVideoElement): HTMLElement {
  const host = overlayHost(video);
  host.classList.add(HOST_CLASS);
  let overlay = overlays.get(video);
  if (!overlay || !overlay.isConnected || overlay.parentElement !== host) {
    overlay?.remove();
    overlay = document.createElement("div");
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute("translate", "no");
    overlay.innerHTML =
      '<div class="bt-sub-origin"></div><div class="bt-sub-trans"></div>';
    host.append(overlay);
    overlays.set(video, overlay);
  }
  return overlay;
}

function updateOverlay(video: HTMLVideoElement): void {
  if (!running) return;
  const original = currentCaption(video);
  const overlay = ensureOverlay(video);
  const originEl = overlay.querySelector(".bt-sub-origin");
  const transEl = overlay.querySelector(".bt-sub-trans");
  if (!originEl || !transEl) return;

  if (!original) {
    if (!video.paused) {
      originEl.textContent = "";
      transEl.textContent = "";
      overlay.classList.remove("bt-sub-visible");
    }
    return;
  }

  overlay.classList.add("bt-sub-visible");
  originEl.textContent = original;
  prefetchCurrent(video.currentTime);
  const cached = cache.get(`${targetLang}\n${original}`);
  if (cached) {
    transEl.textContent = cached === original ? "" : cached;
    return;
  }
  void translateCaption(original).then((translated) => {
    if (!running) return;
    if (currentCaption(video) !== original) return;
    transEl.textContent = translated && translated !== original ? translated : "";
  });
}

function currentCaption(video: HTMLVideoElement): string {
  const fromYoutube = youtubeCaptionAt(video.currentTime);
  if (fromYoutube) return fromYoutube;
  const fromTrack = trackCaption(video);
  if (fromTrack) return fromTrack;
  return domCaption(video);
}

function trackCaption(video: HTMLVideoElement): string {
  const parts: string[] = [];
  for (const track of video.textTracks) {
    if (track.kind !== "subtitles" && track.kind !== "captions") continue;
    if (track.mode === "disabled") continue;
    const cues = track.activeCues;
    if (!cues) continue;
    for (const cue of cues) {
      if (cue instanceof VTTCue) parts.push(cleanCaption(cue.text));
    }
  }
  return uniqueJoin(parts);
}

function domCaption(video: HTMLVideoElement): string {
  const host = overlayHost(video);
  const nodes = host.querySelectorAll(CAPTION_DOM_SELECTORS);
  const parts = [...nodes]
    .map((node) => cleanCaption(node.textContent || ""))
    .filter(Boolean);
  return uniqueJoin(parts);
}

function youtubeCaptionAt(time: number): string {
  if (!youtubeCues?.length) return "";
  const active = youtubeCues.filter((cue) => time >= cue.start && time < cue.end);
  if (active.length) return active[active.length - 1].text;
  let recent = "";
  for (let i = youtubeCues.length - 1; i >= 0; i--) {
    const cue = youtubeCues[i];
    if (time >= cue.start && time - cue.end < 0.35) {
      recent = cue.text;
      break;
    }
  }
  return recent;
}

function youtubeVideoId(): string {
  const href = location.href;
  const fromWatch = href.match(/[?&]v=([\w-]{6,})/);
  if (fromWatch) return fromWatch[1];
  const fromPath = location.pathname.match(/\/(embed|shorts|live)\/([\w-]{6,})/);
  if (fromPath) return fromPath[2];
  const fromAmp = href.match(/\/amp\/s\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{6,})/);
  return fromAmp?.[1] ?? "";
}

async function loadYoutubeCues(): Promise<void> {
  const id = youtubeVideoId();
  if (!id || youtubeLoading === id) return;
  youtubeLoading = id;
  youtubeId = id;
  const fromPage = cuesFromPlayerResponse();
  if (fromPage.length) {
    youtubeCues = fromPage;
    prefetchNearby(0);
    return;
  }

  const langs = ["en", "en-US", "en-GB"];
  for (const lang of langs) {
    for (const extra of ["", "&kind=asr"]) {
      const url = `https://www.youtube.com/api/timedtext?v=${encodeURIComponent(id)}&lang=${lang}&fmt=json3${extra}`;
      const cues = parseJson3(await fetchJson(url));
      if (cues.length) {
        youtubeCues = cues;
        prefetchNearby(0);
        return;
      }
    }
  }
}

function cuesFromPlayerResponse(): Cue[] {
  const payload = playerResponseJson();
  if (!payload || typeof payload !== "object") return [];
  const tracks =
    (payload as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl?: string; languageCode?: string; kind?: string }> } } })
      .captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) return [];
  const preferred =
    tracks.find((track) => (track.languageCode || "").startsWith("en") && track.kind !== "asr") ||
    tracks.find((track) => (track.languageCode || "").startsWith("en")) ||
    tracks[0];
  if (!preferred?.baseUrl) return [];
  const absolute = preferred.baseUrl.startsWith("//")
    ? `https:${preferred.baseUrl}`
    : preferred.baseUrl;
  const url = absolute.includes("fmt=") ? absolute : `${absolute}&fmt=json3`;
  void fetchJson(url).then((json) => {
    const cues = parseJson3(json);
    if (cues.length) {
      youtubeCues = cues;
      prefetchNearby(0);
    }
  });
  return [];
}

function playerResponseJson(): unknown {
  for (const script of document.scripts) {
    const source = script.textContent || "";
    const marker = source.indexOf("ytInitialPlayerResponse");
    if (marker < 0) continue;
    const brace = source.indexOf("{", marker);
    if (brace < 0) continue;
    try {
      return JSON.parse(sliceJsonObject(source, brace));
    } catch {
      continue;
    }
  }
  return undefined;
}

function sliceJsonObject(source: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced json");
}

function parseJson3(data: unknown): Cue[] {
  if (!data || typeof data !== "object" || !("events" in data)) return [];
  const events = (data as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> }).events;
  if (!Array.isArray(events)) return [];
  const cues: Cue[] = [];
  for (const event of events) {
    if (!event?.segs) continue;
    const text = cleanCaption(event.segs.map((seg) => seg.utf8 || "").join(""));
    if (!text) continue;
    const start = (event.tStartMs || 0) / 1000;
    const duration = (event.dDurationMs || 2500) / 1000;
    cues.push({ start, end: start + duration, text });
  }
  return cues;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "FETCH_JSON",
      url,
    })) as FetchJsonResponse | undefined;
    return response?.json;
  } catch {
    return undefined;
  }
}

async function translateCaption(text: string): Promise<string> {
  const key = `${targetLang}\n${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (isMostlyChinese(text)) {
    cache.set(key, text);
    return text;
  }
  try {
    const response = (await chrome.runtime.sendMessage({
      type: "TRANSLATE",
      texts: [text],
      targetLang,
    })) as TranslateResponse | undefined;
    const translated = (response?.translations?.[0] || "").trim();
    if (translated) cache.set(key, translated);
    return translated;
  } catch {
    return "";
  }
}

function prefetchNearby(index: number): void {
  if (!youtubeCues) return;
  const texts = youtubeCues
    .slice(Math.max(0, index), index + 6)
    .map((cue) => cue.text)
    .filter((text) => !cache.has(`${targetLang}\n${text}`) && !isMostlyChinese(text));
  if (!texts.length) return;
  void chrome.runtime
    .sendMessage({
      type: "TRANSLATE",
      texts,
      targetLang,
    })
    .then((response: TranslateResponse | undefined) => {
      texts.forEach((text, i) => {
        const translated = response?.translations?.[i];
        if (translated) cache.set(`${targetLang}\n${text}`, translated);
      });
    })
    .catch(() => undefined);
}

function prefetchCurrent(time: number): void {
  if (!youtubeCues?.length) return;
  const index = youtubeCues.findIndex((cue) => time >= cue.start && time < cue.end);
  prefetchNearby(index >= 0 ? index : 0);
}

function cleanCaption(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueJoin(parts: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    unique.push(part);
  }
  return unique.join(" ").trim();
}

function isMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const letters = (text.match(/[A-Za-z\u4e00-\u9fff]/g) || []).length;
  return letters > 0 && cjk / letters > 0.5;
}
