// 起動直後の初回BCP巡回だけOS通知を抑止し、🚨の注意表示だけ残す。
// 通常のアラーム巡回・手動更新では従来どおり通知する。
importScripts("service_worker.js");

const BCP_STARTUP_REFRESH_NAMES = [
  "bcpWeatherRefreshQuakes",
  "bcpWeatherRefreshWarnings",
  "bcpWeatherRefreshCyclones",
];

let bcpStartupSuppressDepth = 0;
let bcpStartupPending = new Set();

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
