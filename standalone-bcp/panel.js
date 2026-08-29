"use strict";

const STORE = {
  settings: "bcp2_settings",
  quakes: "bcp2_quakes",
  warnings: "bcp2_warnings",
  cyclones: "bcp2_cyclones",
  errors: "bcp2_errors",
  attention: "bcp_attention_v1",
  view: "bcp2_view",
  warningSort: "bcp_warning_sort_v1"
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

const $ = (id) => document.getElementById(id);
let activeSource = "jma";
let controlsDirty = false;
let controlsHydrated = false;
let warningSortMode = "level";
let lastWarningData = { items: [] };
let lastWarningError = null;

function patrolLevel(value){
  if (value===true) return 2;
  if (value==="alert"||value==="red"||Number(value)>=2) return 2;
  if (value==="update"||value==="yellow"||Number(value)===1) return 1;
  return 0;
}

function renderPatrolLamp(attention){
  const raw=attention&&typeof attention==="object"?attention:{};
  const hasRed=[raw.quake,raw.warning,raw.cyclone].some((value)=>patrolLevel(value)>=2);
  const lamp=$("bcpPatrolLamp");
  if (!lamp) return;
  lamp.classList.toggle("isAlert",hasRed);
  lamp.setAttribute("aria-label",hasRed?"未確認の重要BCP情報あり":"未確認の重要BCP情報なし");
  lamp.title=hasRed?"重要な未確認情報があります":"重要な未確認情報はありません";
}

function formatDate(value){
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("ja-JP");
}

function toast(message){
  const el = $("toast");
  if (!el) return;
  el.textContent = String(message || "");
  el.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove("show"), 1700);
}

function openUrl(url){
  if (!url) return;
  chrome.tabs.create({ url }).catch(() => {});
}

function el(tag, className="", text){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function addLink(card, label, url){
  const actions = el("div", "actions");
  const button = el("button", "link", label);
  button.type = "button";
  button.addEventListener("click", () => openUrl(url));
  actions.appendChild(button);
  card.appendChild(actions);
}

function addError(box, error){
  if (!error?.message) return;
  box.appendChild(el("div", "error", `⚠ ${error.message}`));
}

function addEmpty(box, message){
  if (!box.children.length) box.appendChild(el("div", "empty", message));
}

function renderQuakeCard(item){
  const score = Number(item.intensityScore || 0);
  const card = el("article", `card quake${score >= 3 ? " hit" : ""}`);
  card.appendChild(el("div", "badge", "気象庁・地震"));
  card.appendChild(el("div", "title", item.epicenter || "震央地名不明"));

  const grid = el("div", "grid");
  const rows = [
    ["地震検知日時", item.eventTime || "不明"],
    ["震央地名", item.epicenter || "不明"],
    ["マグニチュード", item.magnitude ? `M${item.magnitude}` : "不明"],
    ["最大震度", item.maxIntensity || "不明"]
  ];
  for (const [key, value] of rows){
    grid.appendChild(el("div", "k", key));
    grid.appendChild(el("div", "v", value));
  }
  card.appendChild(grid);

  if (item.reportTime) card.appendChild(el("div", "meta", `発表: ${item.reportTime}`));
  addLink(card, "気象庁で詳細を開く", item.link);
  return card;
}

function warningBadge(level){
  if (level >= 5) return "特別警報";
  if (level >= 4) return "危険警報";
  if (level >= 3) return "警報";
  return "注意報";
}

function renderWarningCard(item){
  const level = Math.max(2, Number(item.maxLevel || 2));
  const card = el("article", `card weather level${Math.min(5, level)}`);
  card.appendChild(el("div", "badge", warningBadge(level)));

  const areaTitle = item.areaTitle || (item.parentAreaName ? `${item.parentAreaName}の警報・注意報` : "");
  if (areaTitle) card.appendChild(el("div", "areaTitle", areaTitle));
  card.appendChild(el("div", `title${areaTitle ? " areaName" : ""}`, item.areaName || item.areaCode || "地域名不明"));

  const names = el("div", "warningNames");
  for (const warning of item.warnings || []){
    const warningLevel = Math.max(2, Number(warning.level || 2));
    const node = el(
      "div",
      `warningName level${Math.min(5, warningLevel)}`,
      warning.name || `気象情報（${warning.code || "不明"}）`
    );
    if (warning.status) node.title = warning.status;
    names.appendChild(node);
  }
  card.appendChild(names);

  if (item.reportDatetime) card.appendChild(el("div", "meta", `発表: ${formatDate(item.reportDatetime)}`));
  addLink(card, "気象庁で詳細を開く", item.detailUrl);
  return card;
}

function cycloneBadge(item){
  if (item?.ended) return item.intensity || item.className || "終了";
  if (Number(item?.intensityLevel || 0) >= 5) return "猛烈";
  if (Number(item?.intensityLevel || 0) >= 4) return "非常に強い";
  if (Number(item?.intensityLevel || 0) >= 3) return "強い";
  return item?.className || "台風";
}

function renderCycloneCard(item){
  const level = Math.max(1, Number(item.intensityLevel || 1));
  const ended = !!item.ended;
  const card = el("article", `card cyclone intensity${Math.min(5, level)}${ended ? " ended" : ""}`);
  card.appendChild(el("div", "badge", cycloneBadge(item)));
  card.appendChild(el("div", "title", item.displayName || item.name || "台風情報"));

  const movement = [item.direction || "不明", item.speedKmH ? `${item.speedKmH}km/h` : ""].filter(Boolean).join(" ");
  const grid = el("div", "grid");
  const rows = [
    ["実況日時", item.targetDateTime || "不明"],
    ["大きさ", item.areaClass || "－"],
    ["強さ／種類", item.intensity || item.className || "不明"],
    ["中心気圧", item.pressure ? `${item.pressure}hPa` : "不明"],
    ["最大風速", item.maxWindMS ? `${item.maxWindMS}m/s` : "不明"],
    ["最大瞬間風速", item.gustWindMS ? `${item.gustWindMS}m/s` : "不明"],
    ["進行", movement || "不明"]
  ];
  for (const [key, value] of rows){
    grid.appendChild(el("div", "k", key));
    grid.appendChild(el("div", "v", value));
  }
  card.appendChild(grid);

  const forecasts = Array.isArray(item.forecasts) ? item.forecasts : [];
  if (forecasts.length){
    const details = el("details", "forecasts");
    details.appendChild(el("summary", "", `今後の予報（${forecasts.length}件）`));
    for (const forecast of forecasts){
      const row = el("div", "forecast");
      row.appendChild(el("div", "forecastTime", forecast.dateTime || "日時不明"));
      const text = [
        forecast.intensity || forecast.className || "",
        forecast.pressure ? `${forecast.pressure}hPa` : "",
        forecast.maxWindMS ? `最大${forecast.maxWindMS}m/s` : "",
        forecast.direction || "",
        forecast.speedKmH ? `${forecast.speedKmH}km/h` : ""
      ].filter(Boolean).join(" ／ ");
      row.appendChild(el("div", "", text || "予報値なし"));
      details.appendChild(row);
    }
    card.appendChild(details);
  }

  if (item.reportDateTime) card.appendChild(el("div", "meta", `発表: ${item.reportDateTime}`));
  addLink(card, "気象庁で詳細を開く", item.detailUrl);
  return card;
}

function renderQuakes(data, error){
  const box = $("quakeList");
  box.innerHTML = "";
  addError(box, error);
  for (const item of Array.isArray(data?.items) ? data.items : []){
    box.appendChild(renderQuakeCard(item));
  }
  addEmpty(box, "直近24時間の地震情報はありません。");
}

function warningComparator(a, b){
  const levelDiff = Number(b.maxLevel || 0) - Number(a.maxLevel || 0);
  const timeDiff = Date.parse(b.reportDatetime || 0) - Date.parse(a.reportDatetime || 0);
  const labelDiff = `${a.parentAreaName || ""}\0${a.areaName || ""}`.localeCompare(
    `${b.parentAreaName || ""}\0${b.areaName || ""}`, "ja"
  );
  return warningSortMode === "newest"
    ? (timeDiff || levelDiff || labelDiff)
    : (levelDiff || timeDiff || labelDiff);
}

function renderWarnings(data, error){
  const box = $("warningList");
  box.innerHTML = "";
  addError(box, error);

  const showAdvisory = !!$("showAdvisory")?.checked;
  const items = (Array.isArray(data?.items) ? data.items : [])
    .map((item) => {
      const warnings = (item.warnings || []).filter((warning) => showAdvisory || Number(warning.level || 0) >= 3);
      return {
        ...item,
        warnings,
        maxLevel: warnings.length ? Math.max(...warnings.map((warning) => Number(warning.level || 0))) : 0
      };
    })
    .filter((item) => item.warnings.length)
    .sort(warningComparator);

  for (const item of items) box.appendChild(renderWarningCard(item));
  addEmpty(box, showAdvisory
    ? "現在、発表中の警報・注意報はありません。"
    : "現在、発表中の警報以上の情報はありません。"
  );
}

function renderCyclones(data, error){
  const box = $("cycloneList");
  box.innerHTML = "";
  addError(box, error);
  for (const item of Array.isArray(data?.items) ? data.items : []){
    box.appendChild(renderCycloneCard(item));
  }
  addEmpty(box, "現在、発表中の台風情報はありません。");
}

function applySource(){
  const map = {
    jma: ["tabQuake", "paneQuake"],
    warning: ["tabWarning", "paneWarning"],
    cyclone: ["tabCyclone", "paneCyclone"]
  };
  for (const [key, [tabId, paneId]] of Object.entries(map)){
    const active = key === activeSource;
    $(tabId)?.classList.toggle("on", active);
    $(tabId)?.setAttribute("aria-selected", String(active));
    if ($(paneId)) $(paneId).hidden = !active;
  }
}

function setSource(source, persist=true){
  activeSource = ["warning", "cyclone"].includes(source) ? source : "jma";
  applySource();
  if (persist) chrome.storage.local.set({ [STORE.view]: activeSource }).catch(() => {});
}

async function send(cmd, payload={}){
  try{
    return await chrome.runtime.sendMessage({ type: "bcpWeather", cmd, ...payload });
  }catch(error){
    return { ok: false, error: String(error?.message || error) };
  }
}

function setBusy(button, busy){
  if (!button) return;
  button.disabled = !!busy;
}

async function saveSettings(message="設定を保存しました"){
  const current = await chrome.storage.local.get([STORE.settings]);
  const previous = { ...DEFAULTS, ...(current[STORE.settings] || {}) };
  const settings = {
    ...previous,
    quakeNotifications: !!$("quakeNotify")?.checked,
    warningNotifications: !!$("warningNotify")?.checked,
    cycloneNotifications: !!$("cycloneNotify")?.checked,
    showAdvisory: !!$("showAdvisory")?.checked,
    quakePeriodMinutes: Math.max(1, Number($("quakePeriod")?.value) || DEFAULTS.quakePeriodMinutes),
    warningPeriodMinutes: Math.max(1, Number($("warningPeriod")?.value) || DEFAULTS.warningPeriodMinutes),
    cyclonePeriodMinutes: Math.max(1, Number($("cyclonePeriod")?.value) || DEFAULTS.cyclonePeriodMinutes),
    autoUpdateEnabled: $("bcpAutoUpdate")?.checked !== false
  };

  const result = await send("saveSettings", { settings });
  if (!result?.ok) throw new Error(result?.error || "設定保存に失敗しました");
  controlsDirty = false;
  toast(message);
  await loadAndRender({ hydrate: true });
}

async function changeAutoUpdate(){
  const toggle = $("bcpAutoUpdate");
  const state = $("bcpAutoState");
  if (!toggle) return;
  // 見た目は即座に確定させ、保存処理だけ裏で行う。
  if (state) state.textContent = toggle.checked ? "ON" : "OFF";
  toggle.disabled = true;
  try{
    const data = await chrome.storage.local.get([STORE.settings]);
    const settings = {
      ...DEFAULTS,
      ...(data[STORE.settings] || {}),
      autoUpdateEnabled: !!toggle.checked
    };
    const result = await send("saveSettings", { settings });
    if (!result?.ok) throw new Error(result?.error || "切替失敗");
    if (state) state.textContent = toggle.checked ? "ON" : "OFF";
  }catch(error){
    const data = await chrome.storage.local.get([STORE.settings]).catch(() => ({}));
    const enabled = data?.[STORE.settings]?.autoUpdateEnabled !== false;
    toggle.checked = enabled;
    if (state) state.textContent = "ERR";
    toast(`自動更新の切替失敗: ${String(error?.message || error)}`);
  }finally{
    toggle.disabled = false;
  }
}

async function refreshOne(kind, button){
  setBusy(button, true);
  try{
    const cmd = kind === "quake" ? "refreshQuake" : kind === "warning" ? "refreshWarning" : "refreshCyclone";
    const result = await send(cmd);
    if (!result?.ok) throw new Error(result?.error || "更新失敗");
    toast(`更新しました（${Number(result.count || 0)}件）`);
    await loadAndRender();
  }catch(error){
    toast(String(error?.message || error));
    await loadAndRender();
  }finally{
    setBusy(button, false);
  }
}

async function loadAndRender({ hydrate=false }={}){
  const data = await chrome.storage.local.get(Object.values(STORE));
  const settings = { ...DEFAULTS, ...(data[STORE.settings] || {}) };

  if (hydrate || !controlsHydrated || !controlsDirty){
    $("quakeNotify").checked = !!settings.quakeNotifications;
    $("warningNotify").checked = !!settings.warningNotifications;
    $("cycloneNotify").checked = !!settings.cycloneNotifications;
    $("showAdvisory").checked = !!settings.showAdvisory;
    $("quakePeriod").value = settings.quakePeriodMinutes;
    $("warningPeriod").value = settings.warningPeriodMinutes;
    $("cyclonePeriod").value = settings.cyclonePeriodMinutes;
    $("bcpAutoUpdate").checked = settings.autoUpdateEnabled !== false;
    $("bcpAutoState").textContent = settings.autoUpdateEnabled !== false ? "ON" : "OFF";
    controlsHydrated = true;
    if (hydrate) controlsDirty = false;
  }

  warningSortMode = data[STORE.warningSort] === "newest" ? "newest" : "level";
  $("warningSort").value = warningSortMode;

  if (["jma", "warning", "cyclone"].includes(data[STORE.view])) activeSource = data[STORE.view];
  applySource();

  const quakes = data[STORE.quakes] || { items: [] };
  const warnings = data[STORE.warnings] || { items: [] };
  const cyclones = data[STORE.cyclones] || { items: [] };
  const errors = data[STORE.errors] || {};
  lastWarningData = warnings;
  lastWarningError = errors.warning || null;

  $("quakeUpdated").textContent = quakes.updatedAt ? `最終更新: ${formatDate(quakes.updatedAt)}` : "";
  $("warningUpdated").textContent = warnings.updatedAt ? `最終更新: ${formatDate(warnings.updatedAt)}` : "";
  $("cycloneUpdated").textContent = cyclones.updatedAt ? `最終更新: ${formatDate(cyclones.updatedAt)}` : "";

  renderQuakes(quakes, errors.quake);
  renderWarnings(warnings, errors.warning);
  renderCyclones(cyclones, errors.cyclone);

  const attention = data[STORE.attention] || { count: 0 };
  renderPatrolLamp(attention);
}

function wire(){
  $("tabQuake").addEventListener("click", () => setSource("jma"));
  $("tabWarning").addEventListener("click", () => setSource("warning"));
  $("tabCyclone").addEventListener("click", () => setSource("cyclone"));

  for (const id of [
    "quakeNotify","warningNotify","cycloneNotify","showAdvisory",
    "quakePeriod","warningPeriod","cyclonePeriod"
  ]){
    $(id).addEventListener("input", () => { controlsDirty = true; });
    $(id).addEventListener("change", () => { controlsDirty = true; });
  }

  $("showAdvisory").addEventListener("change", () => {
    renderWarnings(lastWarningData, lastWarningError);
  });

  $("warningSort").addEventListener("change", async () => {
    warningSortMode = $("warningSort").value === "newest" ? "newest" : "level";
    await chrome.storage.local.set({ [STORE.warningSort]: warningSortMode });
    renderWarnings(lastWarningData, lastWarningError);
  });

  $("bcpAutoUpdate").addEventListener("change", changeAutoUpdate);

  $("quakeSave").addEventListener("click", () => saveSettings().catch((e) => toast(e.message)));
  $("warningSave").addEventListener("click", () => saveSettings().catch((e) => toast(e.message)));
  $("cycloneSave").addEventListener("click", () => saveSettings().catch((e) => toast(e.message)));

  $("quakeRefresh").addEventListener("click", () => refreshOne("quake", $("quakeRefresh")));
  $("warningRefresh").addEventListener("click", () => refreshOne("warning", $("warningRefresh")));
  $("cycloneRefresh").addEventListener("click", () => refreshOne("cyclone", $("cycloneRefresh")));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (
      changes[STORE.quakes] || changes[STORE.warnings] || changes[STORE.cyclones] ||
      changes[STORE.errors] || changes[STORE.attention] || changes[STORE.warningSort]
    ){
      loadAndRender().catch(() => {});
    }

    if (changes[STORE.settings] && !controlsDirty){
      loadAndRender({ hydrate: true }).catch(() => {});
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  wire();
  await loadAndRender({ hydrate: true });
  // v1.0.11: 起動時も未読は各Tabを確認した時だけカテゴリ単位で解除する。
  // 赤Tabが1つでも未確認なら、パネル上部の🚨を点滅させる。
});
"use strict";
(()=>{
  const ATTENTION_KEY="bcp_attention_v1";
  const CATEGORY_TABS={quake:"tabQuake",warning:"tabWarning",cyclone:"tabCyclone"};
  function levelOf(value){
    if (value===true) return 2;
    if (value==="alert"||value==="red"||Number(value)>=2) return 2;
    if (value==="update"||value==="yellow"||Number(value)===1) return 1;
    return 0;
  }
  function normalize(attention){
    const raw=attention&&typeof attention==="object"?attention:{};
    return {quake:levelOf(raw.quake),warning:levelOf(raw.warning),cyclone:levelOf(raw.cyclone)};
  }
  function render(attention){
    const levels=normalize(attention);
    for (const [kind,tabId] of Object.entries(CATEGORY_TABS)){
      const tab=document.getElementById(tabId); if (!tab) continue;
      tab.classList.toggle("hasNewUpdate",levels[kind]===1);
      tab.classList.toggle("hasNewAlert",levels[kind]>=2);
      tab.classList.remove("hasNew");
    }
  }
  async function load(){const data=await chrome.storage.local.get([ATTENTION_KEY]);render(data[ATTENTION_KEY])}
  async function clearCategory(kind){
    if (!CATEGORY_TABS[kind]) return;
    const data=await chrome.storage.local.get([ATTENTION_KEY]);
    const raw=data[ATTENTION_KEY]&&typeof data[ATTENTION_KEY]==="object"?data[ATTENTION_KEY]:{};
    const levels=normalize(raw); levels[kind]=0;
    const count=Object.values(levels).filter((v)=>v>0).length;
    await chrome.storage.local.set({[ATTENTION_KEY]:{
      ...raw,
      quake:levels.quake>=2?"alert":levels.quake===1?"update":false,
      warning:levels.warning>=2?"alert":levels.warning===1?"update":false,
      cyclone:levels.cyclone>=2?"alert":levels.cyclone===1?"update":false,
      count,lastAt:count?Number(raw.lastAt||Date.now()):0
    }});
  }
  document.addEventListener("DOMContentLoaded",()=>{
    load().catch(()=>{});
    for (const [kind,tabId] of Object.entries(CATEGORY_TABS)) document.getElementById(tabId)?.addEventListener("click",()=>clearCategory(kind).catch(()=>{}));
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if (area==="local"&&changes[ATTENTION_KEY]) render(changes[ATTENTION_KEY].newValue)});
})();
