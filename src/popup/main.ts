import type { Settings } from "../shared/settings";

const enabledInput = document.querySelector<HTMLInputElement>("#enabled")!;
const langSelect = document.querySelector<HTMLSelectElement>("#lang")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function showStatus(text: string, isError = false): void {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

async function loadSettings(): Promise<Settings> {
  return (await chrome.runtime.sendMessage({
    type: "GET_SETTINGS",
  })) as Settings;
}

async function refresh(): Promise<void> {
  try {
    const settings = await loadSettings();
    langSelect.value = settings.targetLang || "zh-CN";

    const tab = await activeTab();
    const hostname = hostFromUrl(tab?.url);
    if (!tab?.id || !hostname || !tab.url || !/^https?:/.test(tab.url)) {
      enabledInput.checked = false;
      enabledInput.disabled = true;
      showStatus("请先打开一个普通网页（http/https）。", true);
      return;
    }

    enabledInput.disabled = false;
    enabledInput.checked = settings.enabledHosts.includes(hostname);
    showStatus(
      enabledInput.checked
        ? `已在 ${hostname} 开启。代码块会保持原文。`
        : "打开后只翻译正文，代码块不翻译。",
    );
  } catch (error) {
    showStatus(
      `扩展后台未启动：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
}

enabledInput.addEventListener("change", async () => {
  const tab = await activeTab();
  const hostname = hostFromUrl(tab?.url);
  const wantEnabled = enabledInput.checked;
  if (!tab?.id || !hostname) {
    enabledInput.checked = false;
    showStatus("找不到当前标签页。", true);
    return;
  }

  try {
    const settings = await loadSettings();
    const hosts = new Set(settings.enabledHosts);
    if (wantEnabled) hosts.add(hostname);
    else hosts.delete(hostname);
    await chrome.runtime.sendMessage({
      type: "SET_SETTINGS",
      settings: { enabledHosts: [...hosts] },
    });
    showStatus(
      wantEnabled
        ? `已在 ${hostname} 开启。若没有译文，请刷新页面后再打开一次。`
        : "已关闭翻译。",
    );
    if (tab.id) {
      chrome.runtime.sendMessage({ type: "INJECT_TAB", tabId: tab.id });
    }
  } catch (error) {
    enabledInput.checked = !wantEnabled;
    showStatus(
      `无法保存设置：${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  }
});

langSelect.addEventListener("change", async () => {
  await chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    settings: { targetLang: langSelect.value },
  });
  showStatus("已更新目标语言。");
});

void refresh();
