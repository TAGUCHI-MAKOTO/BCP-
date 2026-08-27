"use strict";
(() => {
  const ATTENTION_KEY = "bcp_attention_v1";

  async function acknowledgeVisible(){
    if (document.visibilityState !== "visible") return;
    try{
      await chrome.runtime.sendMessage({ type: "bcpWeather", cmd: "ackAttention" });
    }catch(_){ }
    try{
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({ title: "BCPアラート" });
    }catch(_){ }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") acknowledgeVisible();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[ATTENTION_KEY]) return;
    if (Number(changes[ATTENTION_KEY].newValue?.count || 0) > 0){
      acknowledgeVisible();
    }
  });
})();
