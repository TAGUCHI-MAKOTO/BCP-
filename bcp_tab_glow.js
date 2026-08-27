"use strict";

/*
 * BCP category unread glow v1.3.135
 * - Glow only the BCP sub-tab that has unread updates.
 * - Clicking that sub-tab clears only its own unread state.
 */
(() => {
  const STORE_KEY = "bcp_tab_unread_v1";
  const TAB_IDS = {
    quake: "bcpSubJma",
    warning: "bcpSubWarning",
    cyclone: "bcpSubCyclone",
  };

  function normalize(value){
    const raw = value && typeof value === "object" ? value : {};
    return {
      quake: raw.quake === true,
      warning: raw.warning === true,
      cyclone: raw.cyclone === true,
      lastAt: Number(raw.lastAt || 0),
    };
  }

  function injectStyles(){
    if (document.getElementById("bcpTabGlowStyles")) return;
    const style = document.createElement("style");
    style.id = "bcpTabGlowStyles";
    style.textContent = `
      .bcpSubTab.bcpHasNew {
        border-color: #facc15 !important;
        box-shadow:
          0 0 0 1px rgba(250,204,21,.75) inset,
          0 0 8px rgba(250,204,21,.75),
          0 0 16px rgba(245,158,11,.38);
        animation: bcpMainTabGlow 1.35s ease-in-out infinite;
      }
      .bcpSubTab.on.bcpHasNew {
        border-color: #facc15 !important;
      }
      @keyframes bcpMainTabGlow {
        0%, 100% {
          box-shadow:
            0 0 0 1px rgba(250,204,21,.55) inset,
            0 0 5px rgba(250,204,21,.45),
            0 0 10px rgba(245,158,11,.20);
        }
        50% {
          box-shadow:
            0 0 0 1px rgba(253,224,71,.95) inset,
            0 0 11px rgba(253,224,71,.95),
            0 0 22px rgba(245,158,11,.58);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .bcpSubTab.bcpHasNew {
          animation: none;
          box-shadow:
            0 0 0 1px rgba(250,204,21,.85) inset,
            0 0 10px rgba(250,204,21,.8);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function render(value){
    const unread = normalize(value);
    for (const [kind, tabId] of Object.entries(TAB_IDS)){
      document.getElementById(tabId)?.classList.toggle("bcpHasNew", unread[kind]);
    }
  }

  async function load(){
    const data = await chrome.storage.local.get([STORE_KEY]);
    render(data[STORE_KEY]);
  }

  async function clearCategory(kind){
    if (!TAB_IDS[kind]) return;
    const data = await chrome.storage.local.get([STORE_KEY]);
    const current = normalize(data[STORE_KEY]);
    if (!current[kind]) return;

    const next = {
      ...current,
      [kind]: false,
    };
    const anyUnread = next.quake || next.warning || next.cyclone;
    if (!anyUnread) next.lastAt = 0;
    await chrome.storage.local.set({ [STORE_KEY]: next });
  }

  function wireTabs(){
    for (const [kind, tabId] of Object.entries(TAB_IDS)){
      const tab = document.getElementById(tabId);
      if (!tab) continue;
      tab.addEventListener("click", () => {
        clearCategory(kind).catch(() => {});
      });
    }
  }

  function wireStorage(){
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes[STORE_KEY]) return;
      render(changes[STORE_KEY].newValue);
    });
  }

  function init(){
    injectStyles();
    wireTabs();
    wireStorage();
    load().catch(() => {});
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }else{
    init();
  }
})();
