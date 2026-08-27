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

let bcpStartupSuppressDepth = 0;
let bcpStartupPending = new Set();

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
