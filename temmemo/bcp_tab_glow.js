"use strict";

/* BCP category unread glow v1.3.140
 * update = yellow / alert = red / alert wins until viewed.
 * Startup-important patrol lamp stays active until the matching category tab is acknowledged.
 */
(() => {
  const STORE_KEY = "bcp_tab_unread_v1";
  const STARTUP_ATTENTION_KEY = "bcp_startup_attention_v1";
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

  function normalizeStartup(value){
    const raw = value && typeof value === "object" ? value : {};
    const next = {
      quake: raw.quake === true,
      warning: raw.warning === true,
      cyclone: raw.cyclone === true,
      lastAt: Number(raw.lastAt || 0),
    };
    next.active = next.quake || next.warning || next.cyclone;
    return next;
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
      #btnBcp.bcpStartupAttention{
        border-color:rgba(239,68,68,.98) !important;
        box-shadow:0 0 0 2px rgba(239,68,68,.60);
        animation:bcpStartupPatrolBg .48s steps(2,end) infinite,bcpStartupPatrolPulse .48s ease-out infinite;
      }
      @keyframes bcpMainTabGlowYellow{
        0%,100%{box-shadow:0 0 0 1px rgba(250,204,21,.55) inset,0 0 5px rgba(250,204,21,.45),0 0 10px rgba(245,158,11,.20)}
        50%{box-shadow:0 0 0 1px rgba(253,224,71,.95) inset,0 0 11px rgba(253,224,71,.95),0 0 22px rgba(245,158,11,.58)}
      }
      @keyframes bcpMainTabGlowRed{
        0%,100%{box-shadow:0 0 0 1px rgba(239,68,68,.62) inset,0 0 6px rgba(239,68,68,.52),0 0 12px rgba(220,38,38,.24)}
        50%{box-shadow:0 0 0 1px rgba(248,113,113,.98) inset,0 0 13px rgba(248,113,113,.98),0 0 25px rgba(220,38,38,.66)}
      }
      @keyframes bcpStartupPatrolBg{
        0%,49%{background:rgba(239,68,68,.92)}
        50%,100%{background:var(--bg2)}
      }
      @keyframes bcpStartupPatrolPulse{
        0%{box-shadow:0 0 0 2px rgba(239,68,68,.72),0 0 0 0 rgba(239,68,68,.62)}
        100%{box-shadow:0 0 0 2px rgba(239,68,68,.40),0 0 0 10px rgba(239,68,68,0)}
      }
      @media (prefers-reduced-motion:reduce){
        .bcpSubTab.bcpHasUpdate{animation:none;box-shadow:0 0 0 1px rgba(250,204,21,.85) inset,0 0 10px rgba(250,204,21,.8)}
        .bcpSubTab.bcpHasAlert{animation:none;box-shadow:0 0 0 1px rgba(239,68,68,.9) inset,0 0 11px rgba(239,68,68,.9)}
        #btnBcp.bcpStartupAttention{animation:none;background:rgba(239,68,68,.92)}
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

  function renderStartupAttention(value){
    const startup = normalizeStartup(value);
    const button = document.getElementById("btnBcp");
    if (!button) return;
    button.classList.toggle("bcpStartupAttention", startup.active);
  }

  async function load(){
    const data = await chrome.storage.local.get([STORE_KEY, STARTUP_ATTENTION_KEY]);
    render(data[STORE_KEY]);
    renderStartupAttention(data[STARTUP_ATTENTION_KEY]);
  }

  async function clearCategory(kind){
    if (!TAB_IDS[kind]) return;
    const data = await chrome.storage.local.get([STORE_KEY, STARTUP_ATTENTION_KEY]);
    const current = normalize(data[STORE_KEY]);
    const startup = normalizeStartup(data[STARTUP_ATTENTION_KEY]);
    const changes = {};

    if (current[kind]){
      current[kind] = 0;
      changes[STORE_KEY] = {
        quake: valueOf(current.quake),
        warning: valueOf(current.warning),
        cyclone: valueOf(current.cyclone),
        lastAt: (current.quake || current.warning || current.cyclone) ? current.lastAt : 0,
      };
    }

    if (startup[kind]){
      startup[kind] = false;
      startup.active = startup.quake || startup.warning || startup.cyclone;
      changes[STARTUP_ATTENTION_KEY] = {
        quake: startup.quake,
        warning: startup.warning,
        cyclone: startup.cyclone,
        active: startup.active,
        lastAt: startup.active ? startup.lastAt : 0,
      };
    }

    if (Object.keys(changes).length) await chrome.storage.local.set(changes);
  }

  function init(){
    injectStyles();
    for (const [kind, tabId] of Object.entries(TAB_IDS)){
      document.getElementById(tabId)?.addEventListener("click", () => clearCategory(kind).catch(() => {}));
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[STORE_KEY]) render(changes[STORE_KEY].newValue);
      if (changes[STARTUP_ATTENTION_KEY]) renderStartupAttention(changes[STARTUP_ATTENTION_KEY].newValue);
    });
    load().catch(() => {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true });
  else init();
})();
