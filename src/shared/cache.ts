const CACHE_KEY = "bt-cache";
const MAX_ENTRIES = 800;

type CacheStore = Record<string, string>;

async function readCache(): Promise<CacheStore> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const value = stored[CACHE_KEY];
  return value && typeof value === "object" ? (value as CacheStore) : {};
}

export async function hashKey(text: string, lang: string): Promise<string> {
  const data = new TextEncoder().encode(`${lang}\0${text}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function cacheGetMany(
  keys: string[],
): Promise<Map<string, string>> {
  const store = await readCache();
  const found = new Map<string, string>();
  for (const key of keys) {
    const value = store[key];
    if (typeof value === "string") found.set(key, value);
  }
  return found;
}

export async function cacheSetMany(
  entries: Record<string, string>,
): Promise<void> {
  const store = await readCache();
  Object.assign(store, entries);
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
      delete store[key];
    }
  }
  await chrome.storage.local.set({ [CACHE_KEY]: store });
}
