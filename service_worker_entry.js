// 起動直後の初回BCP巡回だけOS通知を抑止し、🚨の注意表示だけ残す。
// 通常のアラーム巡回・手動更新では従来どおり通知する。
importScripts("service_worker.js");

const BCP_STARTUP_REFRESH_NAMES = [
  "bcpWeatherRefreshQuakes",
  "bcpWeatherRefreshWarnings",
  "bcpWeatherRefreshCyclones",
];

const BCP_AUTO_SETTINGS_KEY = "bcp2_settings";
const BCP_AUTO_ALARM_NAMES = [
  "bcp_refresh",
  "bcp2_quake",
  "bcp2_warning",
  "bcp2_cyclone",
];

const BCP_TAB_UNREAD_KEY = "bcp_tab_unread_v1";
const BCP_TAB_DATA_KEYS = {
  quake: "bcp2_quakes",
  warning: "bcp2_warnings",
  cyclone: "bcp2_cyclones",
};

let bcpStartupSuppressDepth = 0;
let bcpStartupPending = new Set();
let bcpTabUnreadQueue = Promise.resolve();

async function bcpAutoUpdateEnabled(){
  try{
    const data = await chrome.storage.local.get([BCP_AUTO_SETTINGS_KEY]);
    return data[BCP_AUTO_SETTINGS_KEY]?.autoUpdateEnabled !== false;
  }catch(_){
    return true;
  }
}

async function bcpClearAutoRefreshAlarms(){
  await Promise.allSettled(
    BCP_AUTO_ALARM_NAMES.map((name) => chrome.alarms.clear(name))
  );
}

// service_worker.js の既存アラーム設定を包み、マスターSWがOFFなら3種の巡回を作成しない。
if (typeof bcpWeatherSetupAlarms === "function"){
  const bcpWeatherSetupAlarmsOriginal = bcpWeatherSetupAlarms;
  bcpWeatherSetupAlarms = async function(...args){
    if (!(await bcpAutoUpdateEnabled())){
      await bcpClearAutoRefreshAlarms();
      return;
    }
    return bcpWeatherSetupAlarmsOriginal.apply(this, args);
  };
}

async function bcpStartupAttentionOnly(){
  try{
    const key = "bcp_attention_v1";
    const data = await chrome.storage.local.get([key]);
    const attention = data[key] || { count: 0, lastAt: 0 };
    await chrome.storage.local.set({
      [key]: {
        count: Math.max(1, (Number(attention.count) || 0) + 1),
        lastAt: Date.now(),
      },
    });
  }catch(_){ }
}

const bcpNotifyOriginal = bcpNotify;
bcpNotify = async function(title, message, url){
  if (bcpStartupSuppressDepth > 0){
    await bcpStartupAttentionOnly();
    return;
  }
  return bcpNotifyOriginal(title, message, url);
};

function bcpWrapStartupRefresh(name){
  const original = globalThis[name];
  if (typeof original !== "function") return;

  globalThis[name] = async function(...args){
    const suppress = bcpStartupPending.delete(name);

    // 自動更新OFF時は、起動・更新直後の自動取得そのものを行わない。
    // 手動の「今すぐ更新」は startupPending を消費した後なので従来どおり実行できる。
    if (suppress && !(await bcpAutoUpdateEnabled())){
      return { ok: true, skipped: true, reason: "auto-update-off" };
    }

    if (suppress) bcpStartupSuppressDepth += 1;
    try{
      return await original.apply(this, args);
    }finally{
      if (suppress) bcpStartupSuppressDepth = Math.max(0, bcpStartupSuppressDepth - 1);
    }
  };
}

for (const name of BCP_STARTUP_REFRESH_NAMES){
  bcpWrapStartupRefresh(name);
}

function bcpArmStartupNotificationSuppression(){
  bcpStartupPending = new Set(BCP_STARTUP_REFRESH_NAMES);
}

// ブラウザ起動時に取り込んだ「ブラウザ停止中の新着」はOS通知せず、🚨のみ点滅させる。
chrome.runtime.onStartup?.addListener(() => {
  bcpArmStartupNotificationSuppression();
});

// 拡張機能の更新・再読み込み直後も同じ初回取り込み扱いにして通知ラッシュを防ぐ。
chrome.runtime.onInstalled.addListener(() => {
  bcpArmStartupNotificationSuppression();
});

// ---- BCPサブタブ別の新着判定 v1.3.135 ----
// 既存の🚨注意表示とは別キーで管理するため、BCP画面を開いた時点では消えず、
// 地震／気象警報／台風の該当サブタブを押したときだけ既読になる。
function bcpTabQuakeId(item){
  return String(
    item?.id ||
    item?.eventId ||
    `${item?.eventTime || ""}|${item?.epicenter || ""}`
  );
}

function bcpTabHasNewQuake(oldData, newData){
  if (!oldData?.updatedAt) return false;
  const oldItems = Array.isArray(oldData?.items) ? oldData.items : [];
  const newItems = Array.isArray(newData?.items) ? newData.items : [];
  const oldMap = new Map(
    oldItems.map((item) => [bcpTabQuakeId(item), Number(item?.intensityScore || 0)])
  );

  return newItems.some((item) => {
    const score = Number(item?.intensityScore || 0);
    if (score < 3) return false;
    const id = bcpTabQuakeId(item);
    return !oldMap.has(id) || score > Number(oldMap.get(id) || 0);
  });
}

function bcpTabWarningKey(item, warning){
  const area = String(item?.areaCode || item?.id || item?.areaName || "");
  const phenomenon = String(
    warning?.phenomenon || warning?.code || warning?.name || ""
  );
  return `${area}:${phenomenon}`;
}

function bcpTabHasNewWarning(oldData, newData){
  if (!oldData?.updatedAt) return false;
  const oldMap = new Map();
  for (const item of (Array.isArray(oldData?.items) ? oldData.items : [])){
    for (const warning of (Array.isArray(item?.warnings) ? item.warnings : [])){
      oldMap.set(bcpTabWarningKey(item, warning), Number(warning?.level || 0));
    }
  }

  for (const item of (Array.isArray(newData?.items) ? newData.items : [])){
    for (const warning of (Array.isArray(item?.warnings) ? item.warnings : [])){
      const key = bcpTabWarningKey(item, warning);
      const level = Number(warning?.level || 0);
      if (!oldMap.has(key) || level > Number(oldMap.get(key) || 0)) return true;
    }
  }
  return false;
}

function bcpTabCycloneId(item){
  return String(item?.id || item?.number || item?.slotId || item?.displayName || "");
}

function bcpTabCycloneStamp(item){
  return String(item?.reportDateTime || item?.targetDateTime || "");
}

function bcpTabHasNewCyclone(oldData, newData){
  if (!oldData?.updatedAt) return false;
  const oldMap = new Map(
    (Array.isArray(oldData?.items) ? oldData.items : [])
      .map((item) => [bcpTabCycloneId(item), item])
  );

  return (Array.isArray(newData?.items) ? newData.items : []).some((item) => {
    const oldItem = oldMap.get(bcpTabCycloneId(item));
    if (!oldItem) return true;
    return (
      bcpTabCycloneStamp(item) !== bcpTabCycloneStamp(oldItem) ||
      Number(item?.intensityLevel || 0) !== Number(oldItem?.intensityLevel || 0) ||
      !!item?.ended !== !!oldItem?.ended
    );
  });
}

async function bcpMarkTabUnread(kind){
  if (!["quake", "warning", "cyclone"].includes(kind)) return;
  const data = await chrome.storage.local.get([BCP_TAB_UNREAD_KEY]);
  const raw = data[BCP_TAB_UNREAD_KEY] || {};
  await chrome.storage.local.set({
    [BCP_TAB_UNREAD_KEY]: {
      quake: raw.quake === true || kind === "quake",
      warning: raw.warning === true || kind === "warning",
      cyclone: raw.cyclone === true || kind === "cyclone",
      lastAt: Date.now(),
    },
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  const detected = [];
  const quakeChange = changes[BCP_TAB_DATA_KEYS.quake];
  if (quakeChange && bcpTabHasNewQuake(quakeChange.oldValue, quakeChange.newValue)){
    detected.push("quake");
  }

  const warningChange = changes[BCP_TAB_DATA_KEYS.warning];
  if (warningChange && bcpTabHasNewWarning(warningChange.oldValue, warningChange.newValue)){
    detected.push("warning");
  }

  const cycloneChange = changes[BCP_TAB_DATA_KEYS.cyclone];
  if (cycloneChange && bcpTabHasNewCyclone(cycloneChange.oldValue, cycloneChange.newValue)){
    detected.push("cyclone");
  }

  if (!detected.length) return;
  bcpTabUnreadQueue = bcpTabUnreadQueue
    .then(async () => {
      for (const kind of detected) await bcpMarkTabUnread(kind);
    })
    .catch(() => {});
});
