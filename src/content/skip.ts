import { looksLikeCode, shouldSkipText } from "../shared/codeHeuristics";
import { EDSTEM_SKIP_SELECTORS, isEdStemHost } from "../sites/edstem";

export { looksLikeCode, shouldSkipText };

const SKIP_TAGS = new Set([
  "PRE",
  "CODE",
  "KBD",
  "SAMP",
  "TEXTAREA",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "SVG",
  "MATH",
  "CANVAS",
  "VIDEO",
  "AUDIO",
  "IFRAME",
  "INPUT",
  "SELECT",
  "BUTTON",
  "SNIPPET",
]);

const BASE_SKIP_SELECTORS = [
  "pre",
  "code",
  "kbd",
  "samp",
  "textarea",
  "snippet",
  ".hljs",
  ".chroma",
  ".prettyprint",
  ".CodeMirror",
  ".cm-editor",
  ".cm-content",
  ".monaco-editor",
  ".ace_editor",
  "pre[class*='language-']",
  "code[class*='language-']",
  ".bt-translation",
  ".bt-sub-overlay",
  ".ytp-caption-window-container",
  ".vjs-text-track-display",
  ".plyr__captions",
  ".jw-text-track-container",
  ".shaka-text-container",
];

const CHROME_SKIP_SELECTORS = [
  "nav",
  '[role="banner"]',
  '[role="navigation"]',
  ".skip-link",
  ".skip",
  ".sr-only",
  ".visually-hidden",
  ".visuallyhidden",
  '[aria-hidden="true"]',
  "a[href='#main']",
  "a[href='#content']",
  "a[href='#main-content']",
  "a[href='#skip']",
];

const COPY_BUTTON_SELECTOR = [
  "button[aria-label*='copy' i]",
  "button[title*='copy' i]",
  "[class*='copy-button' i]",
  "[class*='copyButton']",
  "[class*='CopyButton']",
].join(",");

function codeSkipSelector(): string {
  return BASE_SKIP_SELECTORS.join(",");
}

function chromeSkipSelector(): string {
  const extra = isEdStemHost() ? EDSTEM_SKIP_SELECTORS : [];
  return [...CHROME_SKIP_SELECTORS, ...extra].join(",");
}

function isMonospace(fontFamily: string): boolean {
  return /mono|consolas|menlo|courier|fira|source code|jetbrains|cascadia|ui-monospace/i.test(
    fontFamily,
  );
}

function findCopyControl(root: Element): Element | null {
  return root.querySelector(COPY_BUTTON_SELECTOR);
}

function isPreformatted(style: CSSStyleDeclaration): boolean {
  return /^(pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace);
}

function isPageSection(node: HTMLElement): boolean {
  const tag = node.tagName;
  return (
    tag === "MAIN" ||
    tag === "ARTICLE" ||
    tag === "SECTION" ||
    tag === "BODY" ||
    tag === "HTML" ||
    node.getAttribute("role") === "main"
  );
}

function proseBlocks(node: HTMLElement): Element[] {
  return [
    ...node.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, paragraph, blockquote"),
  ].filter((block) => {
    const value = (block.textContent || "").replace(/\s+/g, " ").trim();
    return value.length > 40 && !looksLikeCode(value);
  });
}

function isCodeBox(node: HTMLElement): boolean {
  if (isPageSection(node)) return false;
  const text = (node.innerText || "").trim();
  if (!text || text.length > 12000) return false;
  if (
    node.matches(
      "pre, code, snippet, textarea, .hljs, .CodeMirror, .cm-editor, .monaco-editor, .ace_editor",
    )
  ) {
    return true;
  }

  // A lesson slide with both explanation and code is not a code box.
  if (proseBlocks(node).length >= 2) return false;

  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const codeLines = lines.filter((line) => looksLikeCode(line) || /[;{}]\s*$/.test(line));
  if (codeLines.length >= 3 && codeLines.length / Math.max(lines.length, 1) >= 0.6) {
    return true;
  }
  if (text.length <= 500 && looksLikeCode(text)) return true;

  let style: CSSStyleDeclaration | null = null;
  try {
    style = getComputedStyle(node);
  } catch {
    style = null;
  }
  const mono = style ? isMonospace(style.fontFamily) : false;
  const pre = style ? isPreformatted(style) : false;
  if ((mono || pre) && /[;{}=]/.test(text) && proseBlocks(node).length === 0) return true;
  if (pre && codeLines.length >= 2) return true;

  if (!findCopyControl(node)) return false;
  if (proseBlocks(node).length >= 1) return false;
  if (mono || pre) return true;
  return /[{};=]/.test(text);
}

function hasCodeCopyContainer(el: Element): boolean {
  let node: HTMLElement | null = el as HTMLElement;
  for (let depth = 0; depth < 8 && node && node !== document.body; depth++) {
    if (isPageSection(node)) return false;
    if (isCodeBox(node)) return true;
    node = node.parentElement;
  }
  return false;
}

function hasCodeLikeSiblings(el: Element): boolean {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (text.length > 80 && !looksLikeCode(text)) return false;
  if (!/[;{}=()]/.test(text) && text.length > 24) return false;

  const parent = el.parentElement;
  if (!parent || parent === document.body || isPageSection(parent)) return false;
  const kids = [...parent.children].filter((child) => {
    if (!(child instanceof HTMLElement)) return false;
    if (child.classList.contains("bt-translation")) return false;
    return (child.textContent || "").replace(/\s+/g, " ").trim().length >= 5;
  });
  if (kids.length < 3) return false;
  const codeish = kids.filter((child) =>
    looksLikeCode((child.textContent || "").replace(/\s+/g, " ").trim()),
  );
  return codeish.length >= 3 && codeish.length / kids.length >= 0.6;
}

export function isInsideSkipContainer(el: Element): boolean {
  if (el.closest(".bt-translation")) return true;
  if (el.tagName === "HTML" || el.tagName === "BODY") return false;
  if (SKIP_TAGS.has(el.tagName) && el.tagName !== "CODE") return true;
  if (el.closest(chromeSkipSelector())) return true;

  const closest = el.closest(codeSkipSelector());
  if (!closest || closest.tagName === "HTML" || closest.tagName === "BODY") {
    return hasCodeCopyContainer(el);
  }

  if (closest.tagName === "CODE") {
    if (closest.parentElement?.tagName === "PRE") return true;
    const codeText = (closest.textContent || "").trim();
    if (codeText.includes("\n") || looksLikeCode(codeText) || codeText.length > 80) {
      return true;
    }
    return false;
  }

  if (["PRE", "KBD", "SAMP", "TEXTAREA", "SNIPPET"].includes(closest.tagName)) {
    return true;
  }

  if (closest instanceof HTMLElement && !isCodeBox(closest)) {
    return hasCodeCopyContainer(el);
  }
  return true;
}

export function isVisuallyHidden(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden || el.getAttribute("aria-hidden") === "true") return true;
  let node: HTMLElement | null = el;
  for (let depth = 0; depth < 5 && node && node !== document.body; depth++) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
    if (style.opacity === "0") return true;
    const clip = `${style.clip} ${style.clipPath}`;
    if (/rect\(0|inset\(5/.test(clip) && node.offsetWidth <= 2) return true;
    if (
      (style.position === "absolute" || style.position === "fixed") &&
      (Number.parseFloat(style.left) < -40 || Number.parseFloat(style.top) < -40)
    ) {
      return true;
    }
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) return true;
    node = node.parentElement;
  }
  return false;
}

export function shouldSkipBlock(el: Element): boolean {
  if (el.classList.contains("bt-translation")) return true;
  if (el.classList.contains("bt-sub-overlay")) return true;
  if (el.id === "bt-hud" || el.id === "bt-toast") return true;
  if (
    el.hasAttribute("data-bt-id") &&
    el.nextElementSibling?.classList.contains("bt-translation")
  ) {
    return true;
  }
  if (isVisuallyHidden(el)) return true;
  if (isInsideSkipContainer(el)) return true;
  if (hasCodeCopyContainer(el)) return true;
  if (hasCodeLikeSiblings(el)) return true;
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (shouldSkipText(text)) return true;
  return false;
}

export function placeholderInlineCode(el: HTMLElement): {
  text: string;
  placeholders: string[];
} {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".bt-translation, #bt-hud").forEach((node) => node.remove());
  const placeholders: string[] = [];
  clone.querySelectorAll("code, kbd, samp").forEach((node) => {
    const index = placeholders.length;
    placeholders.push(node.textContent || "");
    node.replaceWith(`@@${index}@@`);
  });
  const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
  return { text, placeholders };
}

export function restorePlaceholders(
  translated: string,
  placeholders: string[],
): string {
  return translated.replace(/@@\s*(\d+)\s*@@/g, (_, index: string) => {
    return placeholders[Number(index)] ?? "";
  });
}
