export const EDSTEM_HOST_RE = /(^|\.)edstem\.org$/i;

export const EDSTEM_SKIP_SELECTORS = [
  "snippet",
  ".monaco-editor",
  ".cm-editor",
  ".ace_editor",
  '[role="banner"]',
  "[class*='topbar' i]",
  "[class*='top-bar' i]",
  "[class*='appbar' i]",
  "[class*='app-bar' i]",
  "[class*='site-header' i]",
  "[class*='global-header' i]",
];

export function isEdStemHost(hostname = location.hostname): boolean {
  return EDSTEM_HOST_RE.test(hostname);
}
