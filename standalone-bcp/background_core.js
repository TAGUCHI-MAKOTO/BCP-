"use strict";

const STORE = {
  settings: "bcp2_settings",
  quakes: "bcp2_quakes",
  warnings: "bcp2_warnings",
  cyclones: "bcp2_cyclones",
  quakeLevels: "bcp2_quake_levels",
  warningState: "bcp2_warning_state",
  cycloneState: "bcp2_cyclone_state",
  quakeInitialized: "bcp2_quake_initialized",
  warningInitialized: "bcp2_warning_initialized",
  cycloneInitialized: "bcp2_cyclone_initialized",
  errors: "bcp2_errors",
  attention: "bcp_attention_v1",
  view: "bcp2_view",
  notifLinks: "bcp2_notif_links"
};

const DEFAULTS = {
  quakePeriodMinutes: 5,
  warningPeriodMinutes: 10,
  cyclonePeriodMinutes: 10,
  quakeNotifications: true,
  warningNotifications: true,
  cycloneNotifications: true,
  showAdvisory: false,
  autoUpdateEnabled: true
};

const JMA_QUAKE_URL = "https://www.data.jma.go.jp/multi/quake/index.html?lang=jp";
const JMA_QUAKE_LIST_URL = "https://www.jma.go.jp/bosai/quake/data/list.json";
const JMA_WARNING_MAP_URL = "https://www.jma.go.jp/bosai/warning/data/r8/map.json";
const JMA_AREA_URL = "https://www.jma.go.jp/bosai/common/const/area.json";
const JMA_WARNING_PAGE_URL = "https://www.jma.go.jp/bosai/warning/";
const JMA_CYCLONE_DATA_ROOT = "https://www.data.jma.go.jp/multi/data/VPTW60";
const JMA_CYCLONE_PAGE_URL = "https://www.data.jma.go.jp/multi/cyclone/index.html?lang=jp";
const JMA_CYCLONE_SLOT_IDS = [60, 61, 62, 63, 64, 65];
const DISPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const NOTIFY_MIN_INTENSITY = 3;

const JMA_WARNING_INFO = {
  "02": { name: "暴風雪警報", phenomenon: "暴風雪", level: 3 },
  "03": { name: "レベル3大雨警報", phenomenon: "大雨", level: 3 },
  "04": { name: "レベル3氾濫警報", phenomenon: "氾濫", level: 3 },
  "05": { name: "暴風警報", phenomenon: "暴風", level: 3 },
  "06": { name: "大雪警報", phenomenon: "大雪", level: 3 },
  "07": { name: "波浪警報", phenomenon: "波浪", level: 3 },
  "08": { name: "レベル3高潮警報", phenomenon: "高潮", level: 3 },
  "09": { name: "レベル3土砂災害警報", phenomenon: "土砂災害", level: 3 },
  "10": { name: "レベル2大雨注意報", phenomenon: "大雨", level: 2 },
  "12": { name: "大雪注意報", phenomenon: "大雪", level: 2 },
  "13": { name: "風雪注意報", phenomenon: "暴風雪", level: 2 },
  "14": { name: "雷注意報", phenomenon: "雷", level: 2 },
  "15": { name: "強風注意報", phenomenon: "暴風", level: 2 },
  "16": { name: "波浪注意報", phenomenon: "波浪", level: 2 },
  "17": { name: "融雪注意報", phenomenon: "融雪", level: 2 },
  "18": { name: "レベル2氾濫注意報", phenomenon: "氾濫", level: 2 },
  "19": { name: "レベル2高潮注意報", phenomenon: "高潮", level: 2 },
  "20": { name: "濃霧注意報", phenomenon: "濃霧", level: 2 },
  "21": { name: "乾燥注意報", phenomenon: "乾燥", level: 2 },
  "22": { name: "なだれ注意報", phenomenon: "なだれ", level: 2 },
  "23": { name: "低温注意報", phenomenon: "低温", level: 2 },
  "24": { name: "霜注意報", phenomenon: "霜", level: 2 },
  "25": { name: "着氷注意報", phenomenon: "着氷", level: 2 },
  "26": { name: "着雪注意報", phenomenon: "着雪", level: 2 },
  "27": { name: "その他の注意報", phenomenon: "その他", level: 2 },
  "29": { name: "レベル2土砂災害注意報", phenomenon: "土砂災害", level: 2 },
  "32": { name: "暴風雪特別警報", phenomenon: "暴風雪", level: 5 },
  "33": { name: "レベル5大雨特別警報", phenomenon: "大雨", level: 5 },
  "34": { name: "レベル5氾濫特別警報", phenomenon: "氾濫", level: 5 },
  "35": { name: "暴風特別警報", phenomenon: "暴風", level: 5 },
  "36": { name: "大雪特別警報", phenomenon: "大雪", level: 5 },
  "37": { name: "波浪特別警報", phenomenon: "波浪", level: 5 },
  "38": { name: "レベル5高潮特別警報", phenomenon: "高潮", level: 5 },
  "39": { name: "レベル5土砂災害特別警報", phenomenon: "土砂災害", level: 5 },
  "42": { name: "暴風雪危険警報", phenomenon: "暴風雪", level: 4 },
  "43": { name: "レベル4大雨危険警報", phenomenon: "大雨", level: 4 },
  "44": { name: "レベル4氾濫危険警報", phenomenon: "氾濫", level: 4 },
  "45": { name: "暴風危険警報", phenomenon: "暴風", level: 4 },
  "46": { name: "大雪危険警報", phenomenon: "大雪", level: 4 },
  "47": { name: "波浪危険警報", phenomenon: "波浪", level: 4 },
  "48": { name: "レベル4高潮危険警報", phenomenon: "高潮", level: 4 },
  "49": { name: "レベル4土砂災害危険警報", phenomenon: "土砂災害", level: 4 }
};

let suppressOsNotifications = false;

function safeHttpUrl(value){
  try{
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  }catch(_){
    return "";
  }
}

function parseJmaDateMs(raw){
  const value = String(raw || "").trim();
  if (!value) return NaN;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const m = value.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h - 9, mi, 0, 0);
}

function isWithin(ms, windowMs, now=Date.now()){
  if (!Number.isFinite(ms)) return false;
  const age = now - ms;
  return age >= 0 && age <= windowMs;
}

function intensityScore(value){
  const s = String(value || "").replace(/最大|震度|\s/g, "");
  if (!s) return 0;
  if (/^7/.test(s)) return 7;
  if (/^6[+＋強]/.test(s)) return 6.5;
  if (/^6[-−弱]/.test(s)) return 6;
  if (/^5[+＋強]/.test(s)) return 5.5;
  if (/^5[-−弱]/.test(s)) return 5;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function formatIntensity(value){
  let s = String(value || "").trim();
  if (!s) return "不明";
  if (s.startsWith("震度")) return s;
  s = s.replace(/^最大震度/, "");
  const map = { "5-":"5弱", "5+":"5強", "6-":"6弱", "6+":"6強" };
  return `震度${map[s] || s}`;
}

async function getSettings(){
  const data = await chrome.storage.local.get([STORE.settings]);
  return { ...DEFAULTS, ...(data[STORE.settings] || {}) };
}

async function setError(kind, message){
  const data = await chrome.storage.local.get([STORE.errors]);
  const errors = { ...(data[STORE.errors] || {}) };
  errors[kind] = message ? { at: Date.now(), message: String(message) } : null;
  await chrome.storage.local.set({ [STORE.errors]: errors });
}

async function syncActionBadge(attention){
  const active = Number(attention?.count || 0) > 0;
  try{
    await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    await chrome.action.setBadgeText({ text: active ? "!" : "" });
    await chrome.action.setTitle({
      title: active ? "BCPアラート（新着あり）" : "BCPアラート"
    });
  }catch(_){ }
}

async function syncActionBadgeFromStorage(){
  try{
    const data = await chrome.storage.local.get([STORE.attention]);
    await syncActionBadge(data[STORE.attention] || { count: 0, lastAt: 0 });
  }catch(_){ }
}

async function addAttention(){
  const data = await chrome.storage.local.get([STORE.attention]);
  const current = data[STORE.attention] || { count: 0, lastAt: 0 };
  const next = {
    count: Math.max(1, (Number(current.count) || 0) + 1),
    lastAt: Date.now()
  };
  await chrome.storage.local.set({ [STORE.attention]: next });
  await syncActionBadge(next);
}

async function clearAttention(){
  const next = { count: 0, lastAt: 0 };
  await chrome.storage.local.set({ [STORE.attention]: next });
  await syncActionBadge(next);
}

async function notify(title, message, url){
  if (suppressOsNotifications) return;

  const id = `bcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try{
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icon48.png",
      title: String(title || "BCPアラート"),
      message: String(message || ""),
      priority: 2
    });

    const data = await chrome.storage.local.get([STORE.notifLinks]);
    const links = { ...(data[STORE.notifLinks] || {}) };
    links[id] = safeHttpUrl(url) || JMA_QUAKE_URL;
    const ids = Object.keys(links);
    if (ids.length > 200){
      for (const oldId of ids.slice(0, ids.length - 200)) delete links[oldId];
    }
    await chrome.storage.local.set({ [STORE.notifLinks]: links });
  }catch(_){ }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  try{
    const data = await chrome.storage.local.get([STORE.notifLinks]);
    const links = { ...(data[STORE.notifLinks] || {}) };
    const url = links[notificationId];
    if (url) chrome.tabs.create({ url });
    delete links[notificationId];
    await chrome.storage.local.set({ [STORE.notifLinks]: links });
    await clearAttention();
    chrome.notifications.clear(notificationId);
  }catch(_){ }
});
