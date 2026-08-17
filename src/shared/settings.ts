export type Settings = {
  targetLang: string;
  enabledHosts: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  targetLang: "zh-CN",
  enabledHosts: [],
};

const STORAGE_KEY = "bt-settings";

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    enabledHosts: Array.isArray(value?.enabledHosts)
      ? value.enabledHosts
      : DEFAULT_SETTINGS.enabledHosts,
  };
}

export async function setSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...patch,
    enabledHosts: patch.enabledHosts ?? current.enabledHosts,
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

export function hostEnabled(settings: Settings, hostname: string): boolean {
  return settings.enabledHosts.includes(hostname);
}

export async function setHostEnabled(
  hostname: string,
  enabled: boolean,
): Promise<Settings> {
  const settings = await getSettings();
  const hosts = new Set(settings.enabledHosts);
  if (enabled) hosts.add(hostname);
  else hosts.delete(hostname);
  return setSettings({ enabledHosts: [...hosts] });
}
