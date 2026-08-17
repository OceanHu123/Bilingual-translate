export type TranslateRequest = {
  type: "TRANSLATE";
  texts: string[];
  targetLang: string;
};

export type TranslateResponse = {
  translations: string[];
  error?: string;
};

export type GetSettingsRequest = { type: "GET_SETTINGS" };
export type SetSettingsRequest = {
  type: "SET_SETTINGS";
  settings: { targetLang?: string; enabledHosts?: string[] };
};

export type ToggleRequest = { type: "TOGGLE" };
export type EnableRequest = { type: "SET_ENABLED"; enabled: boolean };
export type GetPageStateRequest = { type: "GET_PAGE_STATE" };
export type InjectTabRequest = { type: "INJECT_TAB"; tabId: number };
export type PageState = {
  enabled: boolean;
  hostname: string;
  error?: string;
};

export type TabEnabledRequest = { type: "TAB_ENABLED" };
export type TabEnabledResponse = { enabled: boolean; hostname: string };

export type FetchJsonRequest = { type: "FETCH_JSON"; url: string };
export type FetchJsonResponse = { json?: unknown; error?: string };

export type BackgroundMessage =
  | TranslateRequest
  | GetSettingsRequest
  | SetSettingsRequest
  | InjectTabRequest
  | TabEnabledRequest
  | FetchJsonRequest;

export type ContentMessage = ToggleRequest | EnableRequest | GetPageStateRequest;
