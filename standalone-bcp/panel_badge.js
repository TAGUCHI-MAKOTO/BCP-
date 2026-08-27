"use strict";
(() => {
  const ATTENTION_KEY = "bcp_attention_v1";
  const CATEGORY_TABS = {
    quake: "tabQuake",
    warning: "tabWarning",
    cyclone: "tabCyclone"
  };

  function normalize(attention){
    const raw = attention && typeof attention === "object" ? attention : {};
    return {
      quake: raw.quake === true,
      warning: raw.warning === true,
      cyclone: raw.cyclone === true
    };
  }

  function render(attention){
    const flags = normalize(attention);
    for (const [kind, tabId] of Object.entries(CATEGORY_TABS)){
      document.getElementById(tabId)?.classList.toggle("hasNew", flags[kind]);
    }
  }

  async function load(){
    const data = await chrome.storage.local.get([ATTENTION_KEY]);
    render(data[ATTENTION_KEY]);
  }

  async function clearCategory(kind){
    if (!CATEGORY_TABS[kind]) return;
    const data = await chrome.storage.local.get([ATTENTION_KEY]);
    const raw = data[ATTENTION_KEY] && typeof data[ATTENTION_KEY] === "object"
      ? data[ATTENTION_KEY]
      : {};
    const flags = normalize(raw);
    flags[kind] = false;
    const count = Object.values(flags).filter(Boolean).length;
    await chrome.storage.local.set({
      [ATTENTION_KEY]: {
        ...raw,
        ...flags,
        count,
        lastAt: count ? Number(raw.lastAt || Date.now()) : 0
      }
    });
  }

  function wireTab(kind, tabId){
    const tab = document.getElementById(tabId);
    if (!tab) return;
    tab.addEventListener("click", () => {
      clearCategory(kind).catch(() => {});
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    load().catch(() => {});
    for (const [kind, tabId] of Object.entries(CATEGORY_TABS)) wireTab(kind, tabId);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[ATTENTION_KEY]) return;
    render(changes[ATTENTION_KEY].newValue);
  });
})();
