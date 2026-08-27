"use strict";

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
  if (!["quake", "warning", "cyclone"].includes(kind)) return;
  const data = await chrome.storage.local.get([STORE.attention]);
  const current = bcpNormalizeAttentionV104(data[STORE.attention]);
  const next = bcpNormalizeAttentionV104({
    ...current,
    [kind]: true,
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
