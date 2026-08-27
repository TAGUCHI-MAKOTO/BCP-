"use strict";

/*
 * BCP enhancements v1.3.134
 * - One master switch for all automatic BCP refreshes
 * - Weather-warning sort: severity (default) / newest
 */
(() => {
  const SETTINGS_KEY = "bcp2_settings";
  const WARNING_SORT_KEY = "bcp_warning_sort_v1";

  const DEFAULT_SETTINGS = {
    quakePeriodMinutes: 5,
    warningPeriodMinutes: 10,
    cyclonePeriodMinutes: 10,
    quakeNotifications: true,
    warningNotifications: true,
    cycloneNotifications: true,
    showAdvisory: false,
    autoUpdateEnabled: true,
  };

  let warningSortMode = "level";
  let warningObserver = null;
  let sortFrame = 0;

  function $(id){
    return document.getElementById(id);
  }

  function showToast(message){
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = String(message || "");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      if (toast) toast.textContent = "";
    }, 1800);
  }

  function injectStyles(){
    if ($("bcpEnhancementStyles")) return;
    const style = document.createElement("style");
    style.id = "bcpEnhancementStyles";
    style.textContent = `
      .bcpInlineHead.bcpEnhanceHead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .bcpEnhanceAuto {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        cursor: pointer;
        user-select: none;
        font-size: 12px;
        font-weight: 700;
      }
      .bcpEnhanceAuto input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .bcpEnhanceTrack {
        position: relative;
        width: 34px;
        height: 18px;
        border-radius: 999px;
        background: #6b7280;
        transition: background .15s ease;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.16);
      }
      .bcpEnhanceTrack::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform .15s ease;
        box-shadow: 0 1px 3px rgba(0,0,0,.35);
      }
      .bcpEnhanceAuto input:checked + .bcpEnhanceTrack {
        background: #16a34a;
      }
      .bcpEnhanceAuto input:checked + .bcpEnhanceTrack::after {
        transform: translateX(16px);
      }
      .bcpEnhanceAuto input:focus-visible + .bcpEnhanceTrack {
        outline: 2px solid currentColor;
        outline-offset: 2px;
      }
      .bcpEnhanceAuto input:disabled + .bcpEnhanceTrack {
        opacity: .55;
        cursor: wait;
      }
      .bcpEnhanceAutoState {
        min-width: 24px;
        text-align: left;
        font-variant-numeric: tabular-nums;
        opacity: .9;
      }
      .bcpEnhanceSortLine {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .bcpEnhanceSortLabel {
        font-size: 12px;
        font-weight: 700;
        opacity: .9;
      }
      .bcpEnhanceSortSelect {
        width: auto;
        min-width: 112px;
        max-width: 150px;
        height: 30px;
        padding: 3px 26px 3px 8px;
      }
    `;
    document.head.appendChild(style);
  }

  function renderAutoState(enabled, text){
    const toggle = $("bcpAutoUpdateToggle");
    const state = $("bcpAutoUpdateState");
    if (toggle) toggle.checked = !!enabled;
    if (state) state.textContent = text || (enabled ? "ON" : "OFF");
  }

  async function getSettings(){
    const data = await chrome.storage.local.get([SETTINGS_KEY]);
    return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
  }

  async function saveAutoUpdate(enabled){
    const toggle = $("bcpAutoUpdateToggle");
    if (toggle) toggle.disabled = true;
    renderAutoState(enabled, "保存中");

    try{
      // service_worker.js の saveSettings は通知設定も正規化するため、
      // 部分更新ではなく現在値を丸ごと送って既存設定を維持する。
      const current = await getSettings();
      const settings = { ...current, autoUpdateEnabled: !!enabled };
      const response = await chrome.runtime.sendMessage({
        type: "bcpWeather",
        cmd: "saveSettings",
        settings,
      });
      if (!response?.ok){
        throw new Error(response?.error || "設定保存に失敗しました");
      }
      renderAutoState(enabled);
      showToast(enabled ? "BCP自動更新：ON" : "BCP自動更新：OFF");
    }catch(error){
      const current = await getSettings().catch(() => DEFAULT_SETTINGS);
      renderAutoState(current.autoUpdateEnabled !== false, "ERR");
      showToast(`自動更新の切替失敗: ${String(error?.message || error)}`);
    }finally{
      if (toggle) toggle.disabled = false;
    }
  }

  function installAutoUpdateSwitch(){
    if ($("bcpAutoUpdateToggle")) return;
    const head = document.querySelector(".bcpInlineHead");
    if (!head) return;

    head.classList.add("bcpEnhanceHead");
    const label = document.createElement("label");
    label.className = "bcpEnhanceAuto";
    label.title = "BCPの地震・気象警報・台風の自動巡回をまとめてON/OFFします。OFFでも「今すぐ更新」は使用できます。";
    label.innerHTML = `
      <span>自動更新</span>
      <input id="bcpAutoUpdateToggle" type="checkbox" aria-label="BCP自動更新" />
      <span class="bcpEnhanceTrack" aria-hidden="true"></span>
      <span id="bcpAutoUpdateState" class="bcpEnhanceAutoState">ON</span>
    `;
    head.appendChild(label);

    const toggle = $("bcpAutoUpdateToggle");
    toggle?.addEventListener("change", () => {
      saveAutoUpdate(!!toggle.checked);
    });

    getSettings()
      .then((settings) => renderAutoState(settings.autoUpdateEnabled !== false))
      .catch(() => renderAutoState(true));
  }

  function warningLevel(card){
    for (let level = 5; level >= 2; level -= 1){
      if (card.classList.contains(`level${level}`)) return level;
    }
    const badge = String(card.querySelector(".bcpBadge")?.textContent || "");
    if (badge.includes("特別警報")) return 5;
    if (badge.includes("危険警報")) return 4;
    if (badge.includes("警報")) return 3;
    return 2;
  }

  function warningTime(card){
    const raw = String(card.querySelector(".m")?.textContent || "")
      .replace(/^発表\s*:\s*/, "")
      .trim();
    if (!raw) return 0;

    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;

    const match = raw.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
    if (!match) return 0;
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    ).getTime();
  }

  function warningLabel(card){
    const parent = String(card.querySelector(".warningAreaTitle")?.textContent || "");
    const area = String(card.querySelector(".t")?.textContent || "");
    return `${parent}\u0000${area}`;
  }

  function compareWarnings(a, b){
    const levelDiff = warningLevel(b) - warningLevel(a);
    const timeDiff = warningTime(b) - warningTime(a);
    if (warningSortMode === "newest"){
      return timeDiff || levelDiff || warningLabel(a).localeCompare(warningLabel(b), "ja");
    }
    return levelDiff || timeDiff || warningLabel(a).localeCompare(warningLabel(b), "ja");
  }

  function applyWarningSort(){
    const box = $("bcpWarningList");
    if (!box) return;

    const cards = Array.from(box.children)
      .filter((node) => node instanceof HTMLElement && node.matches(".bcpItem.weather"));
    if (cards.length < 2) return;

    const sorted = cards.slice().sort(compareWarnings);
    const unchanged = cards.every((card, index) => card === sorted[index]);
    if (unchanged) return;

    const empty = Array.from(box.children).find((node) =>
      node instanceof HTMLElement && node.classList.contains("bcpEmptyMsg")
    ) || null;

    for (const card of sorted){
      box.insertBefore(card, empty);
    }
  }

  function scheduleWarningSort(){
    if (sortFrame) return;
    sortFrame = requestAnimationFrame(() => {
      sortFrame = 0;
      applyWarningSort();
    });
  }

  async function loadWarningSortMode(){
    try{
      const data = await chrome.storage.local.get([WARNING_SORT_KEY]);
      warningSortMode = data[WARNING_SORT_KEY] === "newest" ? "newest" : "level";
    }catch(_){
      warningSortMode = "level";
    }
  }

  function installWarningSort(){
    if ($("bcpWarningSort")) return;
    const control = $("bcpControlWarning");
    if (!control) return;

    const line = document.createElement("div");
    line.className = "row bcpRow bcpEnhanceSortLine";
    line.innerHTML = `
      <span class="bcpEnhanceSortLabel">並び順</span>
      <select id="bcpWarningSort" class="in bcpEnhanceSortSelect" aria-label="気象警報の並び順">
        <option value="level">レベル順</option>
        <option value="newest">新着順</option>
      </select>
    `;

    const actionLine = control.querySelector(".bcpActionLine");
    control.insertBefore(line, actionLine || null);

    const select = $("bcpWarningSort");
    if (select){
      select.value = warningSortMode;
      select.addEventListener("change", () => {
        warningSortMode = select.value === "newest" ? "newest" : "level";
        chrome.storage.local.set({ [WARNING_SORT_KEY]: warningSortMode }).catch(() => {});
        scheduleWarningSort();
      });
    }

    const box = $("bcpWarningList");
    if (box && !warningObserver){
      warningObserver = new MutationObserver(() => scheduleWarningSort());
      warningObserver.observe(box, { childList: true });
    }
    scheduleWarningSort();
  }

  function wireStorageSync(){
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[SETTINGS_KEY]){
        const settings = { ...DEFAULT_SETTINGS, ...(changes[SETTINGS_KEY].newValue || {}) };
        renderAutoState(settings.autoUpdateEnabled !== false);
      }
      if (changes[WARNING_SORT_KEY]){
        warningSortMode = changes[WARNING_SORT_KEY].newValue === "newest" ? "newest" : "level";
        const select = $("bcpWarningSort");
        if (select) select.value = warningSortMode;
        scheduleWarningSort();
      }
    });
  }

  async function init(){
    injectStyles();
    await loadWarningSortMode();
    installAutoUpdateSwitch();
    installWarningSort();
    wireStorageSync();
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", () => init().catch(() => {}), { once: true });
  }else{
    init().catch(() => {});
  }
})();
