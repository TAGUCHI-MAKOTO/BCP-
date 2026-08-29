"use strict";

/* BCP category unread glow v1.3.138
 * update = yellow / alert = red / alert wins until viewed.
 */
(() => {
  const STORE_KEY = "bcp_tab_unread_v1";
  const TAB_IDS = {
    quake: "bcpSubJma",
    warning: "bcpSubWarning",
    cyclone: "bcpSubCyclone",
  };

  function levelOf(value){
    if (value === true) return 2;
    if (value === "alert" || value === "red" || Number(value) >= 2) return 2;
    if (value === "update" || value === "yellow" || Number(value) === 1) return 1;
    return 0;
  }

  function valueOf(level){
    return Number(level) >= 2 ? "alert" : Number(level) === 1 ? "update" : false;
  }

  function normalize(value){
    const raw = value && typeof value === "object" ? value : {};
    return {
      quake: levelOf(raw.quake),
      warning: levelOf(raw.warning),
      cyclone: levelOf(raw.cyclone),
      lastAt: Number(raw.lastAt || 0),
    };
  }

  function injectStyles(){
    if (document.getElementById("bcpTabGlowStyles")) return;
    const style = document.createElement("style");
    style.id = "bcpTabGlowStyles";
    style.textContent = `
      .bcpSubTab.bcpHasUpdate {
        border-color:#facc15 !important;
        box-shadow:0 0 0 1px rgba(250,204,21,.75) inset,0 0 8px rgba(250,204,21,.75),0 0 16px rgba(245,158,11,.38);
        animation:bcpMainTabGlowYellow 1.35s ease-in-out infinite;
      }
      .bcpSubTab.bcpHasAlert {
        border-color:#ef4444 !important;
        box-shadow:0 0 0 1px rgba(239,68,68,.82) inset,0 0 9px rgba(239,68,68,.82),0 0 19px rgba(220,38,38,.48);
        animation:bcpMainTabGlowRed 1.05s ease-in-out infinite;
      }
      .bcpSubTab.on.bcpHasUpdate{border-color:#facc15 !important}
      .bcpSubTab.on.bcpHasAlert{border-color:#ef4444 !important}
      @keyframes bcpMainTabGlowYellow{
        0%,100%{box-shadow:0 0 0 1px rgba(250,204,21,.55) inset,0 0 5px rgba(250,204,21,.45),0 0 10px rgba(245,158,11,.20)}
        50%{box-shadow:0 0 0 1px rgba(253,224,71,.95) inset,0 0 11px rgba(253,224,71,.95),0 0 22px rgba(245,158,11,.58)}
      }
      @keyframes bcpMainTabGlowRed{
        0%,100%{box-shadow:0 0 0 1px rgba(239,68,68,.62) inset,0 0 6px rgba(239,68,68,.52),0 0 12px rgba(220,38,38,.24)}
        50%{box-shadow:0 0 0 1px rgba(248,113,113,.98) inset,0 0 13px rgba(248,113,113,.98),0 0 25px rgba(220,38,38,.66)}
      }
      @media (prefers-reduced-motion:reduce){
        .bcpSubTab.bcpHasUpdate{animation:none;box-shadow:0 0 0 1px rgba(250,204,21,.85) inset,0 0 10px rgba(250,204,21,.8)}
        .bcpSubTab.bcpHasAlert{animation:none;box-shadow:0 0 0 1px rgba(239,68,68,.9) inset,0 0 11px rgba(239,68,68,.9)}
      }
    `;
    document.head.appendChild(style);
  }

  function render(value){
    const unread = normalize(value);
    for (const [kind, tabId] of Object.entries(TAB_IDS)){
      const tab = document.getElementById(tabId);
      if (!tab) continue;
      tab.classList.toggle("bcpHasUpdate", unread[kind] === 1);
      tab.classList.toggle("bcpHasAlert", unread[kind] >= 2);
      tab.classList.remove("bcpHasNew");
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
    current[kind] = 0;
    const next = {
      quake: valueOf(current.quake),
      warning: valueOf(current.warning),
      cyclone: valueOf(current.cyclone),
      lastAt: (current.quake || current.warning || current.cyclone) ? current.lastAt : 0,
    };
    await chrome.storage.local.set({ [STORE_KEY]: next });
  }

  function init(){
    injectStyles();
    for (const [kind, tabId] of Object.entries(TAB_IDS)){
      document.getElementById(tabId)?.addEventListener("click", () => clearCategory(kind).catch(() => {}));
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORE_KEY]) render(changes[STORE_KEY].newValue);
    });
    load().catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true });
  else init();
})();
