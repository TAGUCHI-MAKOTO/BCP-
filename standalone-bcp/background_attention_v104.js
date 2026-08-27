"use strict";

let bcpAttentionKindV104 = null;

function bcpNormalizeAttentionV104(attention){
  const raw = attention && typeof attention === "object" ? attention : {};
  const quake = raw.quake === true;
  const warning = raw.warning === true;
  const cyclone = raw.cyclone === true;
  const count = [quake, warning, cyclone].filter(Boolean).length;
  return {
    count,
    lastAt: count ? Number(raw.lastAt || 0) : 0,
    quake,
    warning,
    cyclone
  };
}

addAttention = async function(kind){
  const category = ["quake", "warning", "cyclone"].includes(kind)
    ? kind
    : bcpAttentionKindV104;
  if (!["quake", "warning", "cyclone"].includes(category)) return;

  const data = await chrome.storage.local.get([STORE.attention]);
  const current = bcpNormalizeAttentionV104(data[STORE.attention]);
  const next = bcpNormalizeAttentionV104({
    ...current,
    [category]: true,
    lastAt: Date.now()
  });
  next.lastAt = Date.now();
  await chrome.storage.local.set({ [STORE.attention]: next });
  await syncActionBadge(next);
};

clearAttention = async function(kind){
  let category = ["quake", "warning", "cyclone"].includes(kind) ? kind : "";
  if (!category){
    const data = await chrome.storage.local.get([STORE.view]);
    category = data[STORE.view] === "warning"
      ? "warning"
      : data[STORE.view] === "cyclone"
        ? "cyclone"
        : "quake";
  }

  const data = await chrome.storage.local.get([STORE.attention]);
  const current = bcpNormalizeAttentionV104(data[STORE.attention]);
  const next = bcpNormalizeAttentionV104({ ...current, [category]: false });
  if (next.count > 0) next.lastAt = current.lastAt || Date.now();
  await chrome.storage.local.set({ [STORE.attention]: next });
  await syncActionBadge(next);
};

function bcpWrapRefreshV104(name, kind){
  const original = globalThis[name];
  if (typeof original !== "function") return;
  globalThis[name] = async function(...args){
    const previous = bcpAttentionKindV104;
    bcpAttentionKindV104 = kind;
    try{
      return await original(...args);
    }finally{
      bcpAttentionKindV104 = previous;
    }
  };
}

bcpWrapRefreshV104("refreshQuakes", "quake");
bcpWrapRefreshV104("refreshWarnings", "warning");
bcpWrapRefreshV104("refreshCyclones", "cyclone");
