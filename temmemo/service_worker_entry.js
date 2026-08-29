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
    // 起動直後の初回巡回ではOS通知を出さない。
    // 🚨は「起動時の新規重要事象」判定だけで点滅させる。
    return;
  }
  return bcpNotifyOriginal(title, message, url);
};

const BCP_STARTUP_KIND_BY_REFRESH = {
  bcpWeatherRefreshQuakes: "quake",
  bcpWeatherRefreshWarnings: "warning",
  bcpWeatherRefreshCyclones: "cyclone",
};

async function bcpStartupReadCategory(kind){
  const key = BCP_TAB_DATA_KEYS[kind];
  if (!key) return null;
  try{
    const data = await chrome.storage.local.get([key]);
    return data[key] || null;
  }catch(_){
    return null;
  }
}

function bcpStartupHasNewImportant(kind, before, after){
  // 初回インストールなど比較元が無い場合は、新規と断定せず🚨を出さない。
  if (!before?.updatedAt) return false;

  if (kind === "quake"){
    const oldIds = new Set(
      (Array.isArray(before?.items) ? before.items : []).map((item) => bcpTabQuakeId(item))
    );
    return (Array.isArray(after?.items) ? after.items : []).some((item) =>
      Number(item?.intensityScore || 0) >= 3 && !oldIds.has(bcpTabQuakeId(item))
    );
  }

  if (kind === "warning"){
    const oldMap = bcpTabWarningMap(before);
    const newMap = bcpTabWarningMap(after);
    for (const [key, current] of newMap){
      if (Number(current?.level || 0) < 3) continue;
      const previous = oldMap.get(key);
      // 新しい警報現象、または注意報から警報以上へ移行したもの。
      if (!previous || Number(previous?.level || 0) < 3) return true;
    }
    return false;
  }

  if (kind === "cyclone"){
    const oldIds = new Set(
      (Array.isArray(before?.items) ? before.items : []).map((item) => bcpTabCycloneId(item))
    );
    return (Array.isArray(after?.items) ? after.items : []).some((item) =>
      !item?.ended && !oldIds.has(bcpTabCycloneId(item))
    );
  }

  return false;
}

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

    const startupKind = suppress ? (BCP_STARTUP_KIND_BY_REFRESH[name] || "") : "";
    const before = startupKind ? await bcpStartupReadCategory(startupKind) : null;

    if (suppress) bcpStartupSuppressDepth += 1;
    try{
      const result = await original.apply(this, args);
      if (suppress && startupKind && result?.skipped !== true){
        const after = await bcpStartupReadCategory(startupKind);
        if (bcpStartupHasNewImportant(startupKind, before, after)){
          await bcpStartupAttentionOnly();
        }
      }
      return result;
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

// ブラウザ起動時の初回巡回はOS通知を抑止し、新規の重要事象だけ🚨を点滅させる。
chrome.runtime.onStartup?.addListener(() => {
  bcpArmStartupNotificationSuppression();
});

// 拡張機能の更新・再読み込み直後も同じ初回取り込み扱いにして通知ラッシュを防ぐ。
chrome.runtime.onInstalled.addListener(() => {
  bcpArmStartupNotificationSuppression();
});

// ---- BCPサブタブ別の未読重要度判定 v1.3.138 ----
function bcpTabSeverityLevel(value){
  if (value === true) return 2;
  if (value === "alert" || value === "red" || Number(value) >= 2) return 2;
  if (value === "update" || value === "yellow" || Number(value) === 1) return 1;
  return 0;
}
function bcpTabSeverityValue(level){
  return Number(level) >= 2 ? "alert" : Number(level) === 1 ? "update" : false;
}
function bcpTabQuakeId(item){
  return String(item?.id || item?.eventId || `${item?.eventTime || ""}|${item?.epicenter || ""}`);
}
function bcpTabQuakeSignature(item){
  return JSON.stringify([item?.eventTime||"",item?.epicenter||"",item?.magnitude||"",item?.maxIntensity||"",item?.reportTime||""]);
}
function bcpTabQuakeSeverity(oldData,newData){
  if (!oldData?.updatedAt) return 0;
  const oldMap = new Map((Array.isArray(oldData?.items)?oldData.items:[]).map((item)=>[bcpTabQuakeId(item),item]));
  let severity = 0;
  for (const item of (Array.isArray(newData?.items)?newData.items:[])){
    const score = Number(item?.intensityScore||0);
    if (score < 3) continue;
    const oldItem = oldMap.get(bcpTabQuakeId(item));
    if (!oldItem) return 2;
    const oldScore = Number(oldItem?.intensityScore||0);
    if (score > oldScore) return 2;
    if (bcpTabQuakeSignature(item) !== bcpTabQuakeSignature(oldItem)) severity = Math.max(severity,1);
  }
  return severity;
}
function bcpTabWarningKey(item,warning){
  return `${String(item?.areaCode||item?.id||item?.areaName||"")}:${String(warning?.phenomenon||warning?.code||warning?.name||"")}`;
}
function bcpTabWarningMap(data){
  const map = new Map();
  for (const item of (Array.isArray(data?.items)?data.items:[])){
    for (const warning of (Array.isArray(item?.warnings)?item.warnings:[])){
      map.set(bcpTabWarningKey(item,warning),{
        level:Number(warning?.level||0),code:String(warning?.code||""),name:String(warning?.name||""),
        status:String(warning?.status||""),reportDatetime:String(item?.reportDatetime||"")
      });
    }
  }
  return map;
}
function bcpTabWarningSeverity(oldData,newData){
  if (!oldData?.updatedAt) return 0;
  const oldMap=bcpTabWarningMap(oldData), newMap=bcpTabWarningMap(newData);
  let severity=0;
  for (const [key,current] of newMap){
    const previous=oldMap.get(key);
    if (!previous) return 2;
    if (current.level > previous.level) return 2;
    if (current.level!==previous.level || current.code!==previous.code || current.name!==previous.name || current.status!==previous.status || current.reportDatetime!==previous.reportDatetime){
      severity=Math.max(severity,1);
    }
  }
  for (const key of oldMap.keys()) if (!newMap.has(key)) severity=Math.max(severity,1);
  return severity;
}
function bcpTabCycloneId(item){
  return String(item?.id||item?.number||item?.slotId||item?.displayName||"");
}
function bcpTabCycloneSignature(item){
  return JSON.stringify([
    item?.reportDateTime||"",item?.targetDateTime||"",Number(item?.intensityLevel||0),!!item?.ended,
    item?.pressure||"",item?.direction||"",item?.speedKmH||"",item?.maxWindMS||"",item?.gustWindMS||"",
    Array.isArray(item?.forecasts)?item.forecasts:[]
  ]);
}
function bcpTabCycloneSeverity(oldData,newData){
  if (!oldData?.updatedAt) return 0;
  const oldMap=new Map((Array.isArray(oldData?.items)?oldData.items:[]).map((item)=>[bcpTabCycloneId(item),item]));
  let severity=0;
  for (const item of (Array.isArray(newData?.items)?newData.items:[])){
    const oldItem=oldMap.get(bcpTabCycloneId(item));
    if (!oldItem) return 2;
    if (Number(item?.intensityLevel||0)>Number(oldItem?.intensityLevel||0)) return 2;
    if (bcpTabCycloneSignature(item)!==bcpTabCycloneSignature(oldItem)) severity=Math.max(severity,1);
  }
  return severity;
}
async function bcpMarkTabUnread(kind,severity){
  if (!["quake","warning","cyclone"].includes(kind)) return;
  const incoming=bcpTabSeverityLevel(severity);
  if (!incoming) return;
  const data=await chrome.storage.local.get([BCP_TAB_UNREAD_KEY]);
  const raw=data[BCP_TAB_UNREAD_KEY]||{};
  const merged=Math.max(bcpTabSeverityLevel(raw[kind]),incoming);
  await chrome.storage.local.set({
    [BCP_TAB_UNREAD_KEY]:{
      quake:bcpTabSeverityValue(kind==="quake"?merged:bcpTabSeverityLevel(raw.quake)),
      warning:bcpTabSeverityValue(kind==="warning"?merged:bcpTabSeverityLevel(raw.warning)),
      cyclone:bcpTabSeverityValue(kind==="cyclone"?merged:bcpTabSeverityLevel(raw.cyclone)),
      lastAt:Date.now()
    }
  });
}
chrome.storage.onChanged.addListener((changes,area)=>{
  if (area!=="local") return;
  const detected=[];
  if (changes[BCP_TAB_DATA_KEYS.quake]){
    const s=bcpTabQuakeSeverity(changes[BCP_TAB_DATA_KEYS.quake].oldValue,changes[BCP_TAB_DATA_KEYS.quake].newValue);
    if (s) detected.push(["quake",s]);
  }
  if (changes[BCP_TAB_DATA_KEYS.warning]){
    const s=bcpTabWarningSeverity(changes[BCP_TAB_DATA_KEYS.warning].oldValue,changes[BCP_TAB_DATA_KEYS.warning].newValue);
    if (s) detected.push(["warning",s]);
  }
  if (changes[BCP_TAB_DATA_KEYS.cyclone]){
    const s=bcpTabCycloneSeverity(changes[BCP_TAB_DATA_KEYS.cyclone].oldValue,changes[BCP_TAB_DATA_KEYS.cyclone].newValue);
    if (s) detected.push(["cyclone",s]);
  }
  if (!detected.length) return;
  bcpTabUnreadQueue=bcpTabUnreadQueue.then(async()=>{
    for (const [kind,severity] of detected) await bcpMarkTabUnread(kind,severity);
  }).catch(()=>{});
});
