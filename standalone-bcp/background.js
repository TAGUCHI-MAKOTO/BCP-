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

// v1.0.6: ブラウザ起動直後に期限超過アラームが先に発火しても、
// 初回取り込みが終わるまではOS通知を出さない。
const BCP_STARTUP_SESSION_KEY_V106 = "bcp_startup_session_v106";
const BCP_STARTUP_QUIET_FALLBACK_MS_V106 = 60 * 1000;
let bcpStartupQuietUntilV106 = Date.now() + BCP_STARTUP_QUIET_FALLBACK_MS_V106;

const bcpStartupQuietGateV106 = (async () => {
  try{
    const data = await chrome.storage.session.get([BCP_STARTUP_SESSION_KEY_V106]);
    if (data[BCP_STARTUP_SESSION_KEY_V106]){
      bcpStartupQuietUntilV106 = 0;
      return false;
    }
    await chrome.storage.session.set({ [BCP_STARTUP_SESSION_KEY_V106]: true });
    return true;
  }catch(_){
    return true;
  }
})();

async function bcpShouldSuppressOsNotificationV106(){
  await bcpStartupQuietGateV106.catch(() => {});
  return suppressOsNotifications || Date.now() < bcpStartupQuietUntilV106;
}

function bcpEndStartupQuietV106(){
  bcpStartupQuietUntilV106 = 0;
}

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

async function syncActionBadge(_attention){
  // v1.0.11: Edgeツールバーの「!」バッジは廃止。
  // 未確認の重要事象はサイドパネル内の🚨で知らせる。
  try{
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "警報お知らせくん" });
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
  if (await bcpShouldSuppressOsNotificationV106()) return;

  const id = `bcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try{
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icon48.png",
      title: String(title || "警報お知らせくん"),
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
    // 通知を開いただけでは未読解除しない。該当BCP Tabを開いた時に解除する。
    chrome.notifications.clear(notificationId);
  }catch(_){ }
});
async function collectQuakes(){
  const response = await fetch(JMA_QUAKE_LIST_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reports = await response.json();
  if (!Array.isArray(reports)) throw new Error("地震情報が一覧形式ではありません");

  const now = Date.now();
  const grouped = new Map();

  for (const report of reports){
    if (!report || typeof report !== "object") continue;
    const eventTime = String(report.at || "").trim();
    const eventAt = parseJmaDateMs(eventTime);
    if (!isWithin(eventAt, DISPLAY_WINDOW_MS, now)) continue;

    const eventId = String(report.eid || `${eventTime}|${report.anm || ""}`).trim();
    if (!eventId) continue;

    const reportTime = String(report.rdt || "").trim();
    const reportAt = parseJmaDateMs(reportTime);
    const jsonName = String(report.json || "").trim();
    const jsonDetailId = (jsonName.match(/^(\d{14})(?:_|\.)/) || [])[1] || "";
    const detailId = String(report.ctt || jsonDetailId || "").trim();

    const entry = {
      eventId,
      detailId,
      eventTime,
      eventAt,
      reportTime,
      reportAt: Number.isFinite(reportAt) ? reportAt : 0,
      epicenter: String(report.anm || "").trim(),
      magnitude: String(report.mag ?? "").trim(),
      maxIntensityRaw: String(report.maxi || "").trim()
    };

    if (!grouped.has(eventId)) grouped.set(eventId, []);
    grouped.get(eventId).push(entry);
  }

  const items = [];
  for (const [eventId, entries] of grouped){
    entries.sort((a,b) => (b.reportAt || 0) - (a.reportAt || 0));
    const firstNonEmpty = (key) => {
      const hit = entries.find((x) => String(x?.[key] ?? "").trim());
      return hit ? String(hit[key]).trim() : "";
    };

    const latest = entries[0];
    const eventTime = firstNonEmpty("eventTime");
    const epicenter = firstNonEmpty("epicenter");
    const magnitude = firstNonEmpty("magnitude");
    const maxIntensityRaw = firstNonEmpty("maxIntensityRaw");
    const reportTime = firstNonEmpty("reportTime");
    const eventAt = parseJmaDateMs(eventTime);
    if (!Number.isFinite(eventAt) || !epicenter || !magnitude || !maxIntensityRaw) continue;

    const maxIntensity = formatIntensity(maxIntensityRaw);
    const score = intensityScore(maxIntensity);
    const detailEntry = entries.find((x) => x.detailId && x.epicenter && x.magnitude && x.maxIntensityRaw)
      || entries.find((x) => x.detailId)
      || latest;
    const detailId = String(detailEntry?.detailId || eventId).trim();

    items.push({
      id: `jmaquake:${eventId}`,
      eventId,
      detailId,
      eventTime,
      epicenter,
      magnitude,
      maxIntensity,
      intensityScore: score,
      reportTime,
      link: `https://www.data.jma.go.jp/multi/quake/quake_detail.html?eventID=${encodeURIComponent(detailId)}&lang=jp`,
      eventAt,
      sortAt: eventAt || latest?.reportAt || 0
    });
  }

  items.sort((a,b) => (b.sortAt || 0) - (a.sortAt || 0));
  return { items, sourceUrl: JMA_QUAKE_LIST_URL, parsedCount: reports.length };
}

function quakeMessage(item){
  return [
    `発生: ${item.eventTime || "不明"}`,
    `震央: ${item.epicenter || "不明"}`,
    `マグニチュード: M${item.magnitude || "不明"}`,
    `最大震度: ${item.maxIntensity || "不明"}`
  ].join("\n");
}

async function refreshQuakes(){
  try{
    const result = await collectQuakes();
    const data = await chrome.storage.local.get([STORE.quakeLevels, STORE.quakeInitialized]);
    const levels = { ...(data[STORE.quakeLevels] || {}) };
    const initialized = !!data[STORE.quakeInitialized];
    const settings = await getSettings();
    const now = Date.now();

    for (const item of result.items){
      const score = Number(item.intensityScore || 0);
      const previous = Number(levels[item.id]?.score ?? levels[item.id] ?? 0);
      const isNewRelevantQuake = initialized && score >= NOTIFY_MIN_INTENSITY && previous < score;
      if (isNewRelevantQuake){
        await addAttention("quake");
        if (settings.quakeNotifications){
          await notify(`地震情報: ${item.maxIntensity}`, quakeMessage(item), item.link);
        }
      }
      levels[item.id] = { score: Math.max(previous, score), at: now };
    }

    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const id of Object.keys(levels)){
      if (Number(levels[id]?.at || 0) < cutoff) delete levels[id];
    }

    await chrome.storage.local.set({
      [STORE.quakes]: { items: result.items, updatedAt: now, sourceUrl: result.sourceUrl },
      [STORE.quakeLevels]: levels,
      [STORE.quakeInitialized]: true
    });
    await setError("quake", "");
    return { ok: true, count: result.items.length };
  }catch(error){
    const message = `気象庁地震情報の取得失敗: ${String(error?.message || error)}`;
    await setError("quake", message);
    return { ok: false, error: message };
  }
}
function warningIsActive(status){
  const text = String(status || "").trim();
  if (!text) return true;
  return !(text.includes("解除") || text.includes("発表警報・注意報はなし") || text === "なし");
}

function warningDetailUrl(areaCode){
  if (!areaCode) return JMA_WARNING_PAGE_URL;
  return `${JMA_WARNING_PAGE_URL}#area_type=class10s&area_code=${encodeURIComponent(areaCode)}`;
}

async function collectWarnings(){
  const [warningResponse, areaResponse] = await Promise.all([
    fetch(JMA_WARNING_MAP_URL, { cache: "no-store" }),
    fetch(JMA_AREA_URL, { cache: "force-cache" })
  ]);
  if (!warningResponse.ok) throw new Error(`警報 HTTP ${warningResponse.status}`);
  if (!areaResponse.ok) throw new Error(`地域情報 HTTP ${areaResponse.status}`);

  const warningJson = await warningResponse.json();
  const areaJson = await areaResponse.json();
  const reports = Array.isArray(warningJson)
    ? warningJson
    : (Array.isArray(warningJson?.reports) ? warningJson.reports : [warningJson]);

  const class10Areas = areaJson?.class10s || {};
  const officeAreas = areaJson?.offices || {};
  const dictionaries = [class10Areas, officeAreas, areaJson?.class15s || {}, areaJson?.class20s || {}];
  const areaName = (code) => {
    for (const dict of dictionaries){
      if (dict?.[code]?.name) return dict[code].name;
    }
    return code;
  };

  const areas = new Map();
  for (const report of reports.filter(Boolean)){
    const reportDatetime = report.reportDatetime || report.controlDatetime || "";
    const class10Items = report?.warning?.class10Items || report?.class10Items || [];

    for (const area of Array.isArray(class10Items) ? class10Items : []){
      const areaCode = String(area?.areaCode || area?.code || "").trim();
      if (!areaCode) continue;
      const state = areas.get(areaCode) || { warnings: new Map(), reportDatetime: "" };

      for (const kind of Array.isArray(area?.kinds) ? area.kinds : []){
        const code = String(kind?.code || "").padStart(2, "0");
        const info = JMA_WARNING_INFO[code];
        if (!info || !warningIsActive(kind?.status)) continue;

        const current = state.warnings.get(info.phenomenon);
        if (!current || Number(current.level || 0) < info.level){
          state.warnings.set(info.phenomenon, {
            code,
            name: info.name,
            phenomenon: info.phenomenon,
            level: info.level,
            status: String(kind?.status || "")
          });
        }
      }

      if (reportDatetime && (!state.reportDatetime || Date.parse(reportDatetime) >= Date.parse(state.reportDatetime))){
        state.reportDatetime = reportDatetime;
      }
      areas.set(areaCode, state);
    }
  }

  const items = [];
  for (const [areaCode, state] of areas){
    const warnings = [...state.warnings.values()].sort((a,b) => b.level - a.level || a.code.localeCompare(b.code));
    if (!warnings.length) continue;

    const parentAreaCode = String(class10Areas?.[areaCode]?.parent || "").trim();
    const parentAreaName = String(officeAreas?.[parentAreaCode]?.name || "").trim();
    items.push({
      id: areaCode,
      areaCode,
      areaName: areaName(areaCode),
      parentAreaCode,
      parentAreaName,
      areaTitle: parentAreaName ? `${parentAreaName}の警報・注意報` : "",
      reportDatetime: state.reportDatetime,
      warnings,
      maxLevel: Math.max(...warnings.map((warning) => warning.level)),
      detailUrl: warningDetailUrl(areaCode)
    });
  }

  items.sort((a,b) =>
    b.maxLevel - a.maxLevel ||
    (Date.parse(b.reportDatetime || 0) - Date.parse(a.reportDatetime || 0)) ||
    (a.parentAreaName || "").localeCompare(b.parentAreaName || "", "ja") ||
    a.areaName.localeCompare(b.areaName, "ja")
  );

  return { items, sourceUrl: JMA_WARNING_MAP_URL, reportCount: reports.length };
}

async function refreshWarnings(){
  try{
    const result = await collectWarnings();
    const data = await chrome.storage.local.get([STORE.warningState, STORE.warningInitialized]);
    const oldState = data[STORE.warningState] || {};
    const initialized = !!data[STORE.warningInitialized];
    const settings = await getSettings();
    const newState = {};

    for (const item of result.items){
      for (const warning of item.warnings || []){
        const key = `${item.areaCode}:${warning.phenomenon}`;
        const previousLevel = Number(oldState[key] || 0);
        newState[key] = warning.level;

        const isNewOrEscalated = initialized && previousLevel < warning.level;
        if (isNewOrEscalated){
          await addAttention("warning");
          if (settings.warningNotifications && warning.level >= 3){
            const location = [item.parentAreaName, item.areaName]
              .filter((name, index, values) => name && values.indexOf(name) === index)
              .join("・");
            await notify(`気象警報: ${location || item.areaCode}`, warning.name, item.detailUrl || JMA_WARNING_PAGE_URL);
          }
        }
      }
    }

    await chrome.storage.local.set({
      [STORE.warnings]: {
        items: result.items,
        updatedAt: Date.now(),
        sourceUrl: result.sourceUrl,
        reportCount: result.reportCount
      },
      [STORE.warningState]: newState,
      [STORE.warningInitialized]: true
    });
    await setError("warning", "");
    return { ok: true, count: result.items.length };
  }catch(error){
    const message = `気象庁警報情報の取得失敗: ${String(error?.message || error)}`;
    await setError("warning", message);
    return { ok: false, error: message };
  }
}
function cycloneDateMs(value){
  const match = String(value || "").trim().match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return NaN;
  return Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]) - 9, Number(match[5]), Number(match[6] || 0)
  );
}

function cycloneIntensityLevel(classPart){
  const text = [classPart?.intensityAndTyphoonClass, classPart?.typhoonClassName].filter(Boolean).join(" ");
  if (/温帯低気圧|消滅/.test(text) || classPart?.typhoonClass === "LOW") return 1;
  if (text.includes("猛烈")) return 5;
  if (text.includes("非常に強い")) return 4;
  if (text.includes("強い")) return 3;
  if (/台風/.test(text) || ["TY", "STS", "TS"].includes(classPart?.typhoonClass)) return 2;
  return 1;
}

function cycloneDisplayName(report){
  const number = String(report?.number || "").trim();
  const name = String(report?.name || "").trim();
  if (/^\d{4}$/.test(number)){
    return `台風第${Number(number.slice(-2))}号${name ? ` ${name}` : ""}`;
  }
  if (number || name){
    return `${report?.meteorologicalInfos?.[0]?.classPart?.typhoonClassName || "熱帯低気圧"}${number ? ` ${number}` : ""}${name ? ` ${name}` : ""}`;
  }
  return report?.meteorologicalInfos?.[0]?.classPart?.typhoonClassName || "台風情報";
}

function cycloneForecast(info){
  const classPart = info?.classPart || {};
  const centerPart = info?.centerPart || {};
  const windPart = info?.windPart || {};
  return {
    dateTime: String(info?.dateTime || ""),
    className: String(classPart.typhoonClassName || ""),
    intensity: String(classPart.intensityAndTyphoonClass || classPart.typhoonClassName || ""),
    pressure: String(centerPart.pressure || ""),
    maxWindMS: String(windPart.windSpeedMS || ""),
    direction: String(centerPart.direction || ""),
    speedKmH: String(centerPart.speedKmH || "")
  };
}

function cycloneItem(report, slotId){
  const current = report?.meteorologicalInfos?.[0];
  if (!current) return null;

  const classPart = current.classPart || {};
  const centerPart = current.centerPart || {};
  const windPart = current.windPart || {};
  const statusText = [classPart.typhoonClassName, classPart.intensityAndTyphoonClass, report?.remark].filter(Boolean).join(" ");
  const ended = classPart.typhoonClass === "LOW" || /温帯低気圧|消滅/.test(statusText);
  const number = String(report?.number || "").trim();

  return {
    id: `${number || `slot-${slotId}`}`,
    slotId,
    number,
    name: String(report?.name || ""),
    displayName: cycloneDisplayName(report),
    reportDateTime: String(report?.reportDateTime || ""),
    targetDateTime: String(report?.targetDateTime || current.dateTime || ""),
    className: String(classPart.typhoonClassName || ""),
    areaClass: String(classPart.areaClass || ""),
    intensity: String(classPart.intensityAndTyphoonClass || classPart.typhoonClassName || ""),
    intensityLevel: cycloneIntensityLevel(classPart),
    ended,
    pressure: String(centerPart.pressure || ""),
    direction: String(centerPart.direction || ""),
    speedKmH: String(centerPart.speedKmH || ""),
    maxWindMS: String(windPart.windSpeedMS || ""),
    gustWindMS: String(windPart.windGustSpeedMS || ""),
    forecasts: (Array.isArray(report?.meteorologicalInfos) ? report.meteorologicalInfos.slice(1) : []).map(cycloneForecast),
    detailUrl: `https://www.data.jma.go.jp/multi/cyclone/cyclone_detail.html?id=${slotId}&lang=jp`
  };
}

async function collectCyclones(){
  const responses = await Promise.all(JMA_CYCLONE_SLOT_IDS.map(async (slotId) => {
    try{
      const response = await fetch(`${JMA_CYCLONE_DATA_ROOT}/${slotId}_jp.json`, { cache: "no-store" });
      if (response.status === 404) return { slotId, reachable: true, report: null };
      if (!response.ok) return { slotId, reachable: true, report: null, error: `HTTP ${response.status}` };
      return { slotId, reachable: true, report: await response.json() };
    }catch(error){
      return { slotId, reachable: false, report: null, error: String(error?.message || error) };
    }
  }));

  if (!responses.some((result) => result.reachable)) throw new Error("台風情報の配信元へ接続できません");
  if (responses.every((result) => !result.report) && responses.some((result) => result.error)){
    throw new Error(responses.find((result) => result.error)?.error || "取得失敗");
  }

  const now = Date.now();
  const items = responses
    .filter((result) => result.report)
    .filter((result) => {
      const reportAt = cycloneDateMs(result.report.reportDateTime);
      return !Number.isFinite(reportAt) || now <= reportAt + DISPLAY_WINDOW_MS;
    })
    .map((result) => cycloneItem(result.report, result.slotId))
    .filter(Boolean)
    .sort((a,b) =>
      Number(a.ended) - Number(b.ended) ||
      Number(b.intensityLevel || 0) - Number(a.intensityLevel || 0) ||
      cycloneDateMs(b.targetDateTime) - cycloneDateMs(a.targetDateTime)
    );

  return { items, sourceUrl: JMA_CYCLONE_PAGE_URL, checkedSlots: JMA_CYCLONE_SLOT_IDS.length };
}

async function refreshCyclones(){
  try{
    const result = await collectCyclones();
    const data = await chrome.storage.local.get([STORE.cycloneState, STORE.cycloneInitialized]);
    const oldState = data[STORE.cycloneState] || {};
    const initialized = !!data[STORE.cycloneInitialized];
    const settings = await getSettings();
    const now = Date.now();
    const newState = { ...oldState };

    for (const item of result.items){
      const previous = oldState[item.id];
      const currentLevel = Number(item.intensityLevel || 1);

      const reportStamp = String(item.reportDateTime || item.targetDateTime || "");
      const previousStamp = String(previous?.reportStamp || "");
      const previousLevel = Number(previous?.intensityLevel || 0);
      const stateChanged = initialized && (
        !previous ||
        reportStamp !== previousStamp ||
        currentLevel !== previousLevel ||
        !!item.ended !== !!previous?.ended
      );

      if (stateChanged){
        await addAttention("cyclone");
      }

      if (initialized && settings.cycloneNotifications && !item.ended){
        if (!previous){
          await notify(`台風情報: ${item.displayName}`, item.intensity || item.className || "台風が発生しました", item.detailUrl);
        }else if (currentLevel > previousLevel){
          await notify(`台風の勢力上昇: ${item.displayName}`, item.intensity || item.className || "勢力が強まりました", item.detailUrl);
        }
      }

      newState[item.id] = {
        intensityLevel: currentLevel,
        ended: !!item.ended,
        reportStamp,
        at: now
      };
    }

    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const id of Object.keys(newState)){
      if (Number(newState[id]?.at || 0) < cutoff) delete newState[id];
    }

    await chrome.storage.local.set({
      [STORE.cyclones]: {
        items: result.items,
        updatedAt: now,
        sourceUrl: result.sourceUrl,
        checkedSlots: result.checkedSlots
      },
      [STORE.cycloneState]: newState,
      [STORE.cycloneInitialized]: true
    });
    await setError("cyclone", "");
    return { ok: true, count: result.items.length };
  }catch(error){
    const message = `気象庁台風情報の取得失敗: ${String(error?.message || error)}`;
    await setError("cyclone", message);
    return { ok: false, error: message };
  }
}
"use strict";

function bcpAttentionLevel(value){
  if (value === true) return 2;
  if (value === "alert" || value === "red" || Number(value) >= 2) return 2;
  if (value === "update" || value === "yellow" || Number(value) === 1) return 1;
  return 0;
}
function bcpAttentionValue(level){
  return Number(level) >= 2 ? "alert" : Number(level) === 1 ? "update" : false;
}
function bcpNormalizeAttentionV111(attention){
  const raw=attention&&typeof attention==="object"?attention:{};
  const q=bcpAttentionLevel(raw.quake),w=bcpAttentionLevel(raw.warning),c=bcpAttentionLevel(raw.cyclone);
  const count=[q,w,c].filter((v)=>v>0).length;
  return {count,lastAt:count?Number(raw.lastAt||0):0,quake:bcpAttentionValue(q),warning:bcpAttentionValue(w),cyclone:bcpAttentionValue(c)};
}

// 旧refresh内の addAttention(kind) はここでは表示状態を直接変えない。
// 保存データ差分を下のlistenerで分類し、明示severity付き呼び出しだけ反映する。
addAttention=async function(kind,severity){
  if (!["quake","warning","cyclone"].includes(kind)) return;
  const incoming=bcpAttentionLevel(severity);
  if (!incoming) return;
  const data=await chrome.storage.local.get([STORE.attention]);
  const current=bcpNormalizeAttentionV111(data[STORE.attention]);
  const merged=Math.max(bcpAttentionLevel(current[kind]),incoming);
  const next=bcpNormalizeAttentionV111({...current,[kind]:bcpAttentionValue(merged),lastAt:Date.now()});
  next.lastAt=Date.now();
  await chrome.storage.local.set({[STORE.attention]:next});
  await syncActionBadge(next);
};

clearAttention=async function(kind){
  let category=["quake","warning","cyclone"].includes(kind)?kind:"";
  if (!category){
    const data=await chrome.storage.local.get([STORE.view]);
    category=data[STORE.view]==="warning"?"warning":data[STORE.view]==="cyclone"?"cyclone":"quake";
  }
  const data=await chrome.storage.local.get([STORE.attention]);
  const current=bcpNormalizeAttentionV111(data[STORE.attention]);
  const next=bcpNormalizeAttentionV111({...current,[category]:false});
  if (next.count>0) next.lastAt=current.lastAt||Date.now();
  await chrome.storage.local.set({[STORE.attention]:next});
  await syncActionBadge(next);
};

function bcpStandaloneQuakeId(item){return String(item?.id||item?.eventId||`${item?.eventTime||""}|${item?.epicenter||""}`)}
function bcpStandaloneQuakeSig(item){return JSON.stringify([item?.eventTime||"",item?.epicenter||"",item?.magnitude||"",item?.maxIntensity||"",item?.reportTime||""])}
function bcpStandaloneQuakeSeverity(oldData,newData){
  if (!oldData?.updatedAt) return 0;
  const oldMap=new Map((Array.isArray(oldData?.items)?oldData.items:[]).map((item)=>[bcpStandaloneQuakeId(item),item]));
  let severity=0;
  for (const item of (Array.isArray(newData?.items)?newData.items:[])){
    const score=Number(item?.intensityScore||0); if (score<3) continue;
    const oldItem=oldMap.get(bcpStandaloneQuakeId(item));
    if (!oldItem) return 2;
    if (score>Number(oldItem?.intensityScore||0)) return 2;
    if (bcpStandaloneQuakeSig(item)!==bcpStandaloneQuakeSig(oldItem)) severity=Math.max(severity,1);
  }
  return severity;
}
function bcpStandaloneWarningKey(item,warning){return `${String(item?.areaCode||item?.id||item?.areaName||"")}:${String(warning?.phenomenon||warning?.code||warning?.name||"")}`}
function bcpStandaloneWarningMap(data){
  const map=new Map();
  for (const item of (Array.isArray(data?.items)?data.items:[])){
    for (const warning of (Array.isArray(item?.warnings)?item.warnings:[])){
      map.set(bcpStandaloneWarningKey(item,warning),{
        level:Number(warning?.level||0),code:String(warning?.code||""),name:String(warning?.name||""),
        status:String(warning?.status||""),reportDatetime:String(item?.reportDatetime||"")
      });
    }
  }
  return map;
}
function bcpStandaloneWarningSeverity(oldData,newData){
  if (!oldData?.updatedAt) return 0;
  const oldMap=bcpStandaloneWarningMap(oldData),newMap=bcpStandaloneWarningMap(newData); let severity=0;
  for (const [key,current] of newMap){
    const previous=oldMap.get(key);
    if (!previous){
      // テンメモ準拠: 新規の警報以上は赤、新規注意報は黄色。
      if (Number(current.level||0)>=3) return 2;
      severity=Math.max(severity,1);
      continue;
    }
    if (current.level>previous.level) return 2;
    if (current.level!==previous.level||current.code!==previous.code||current.name!==previous.name||current.status!==previous.status||current.reportDatetime!==previous.reportDatetime) severity=Math.max(severity,1);
  }
  for (const key of oldMap.keys()) if (!newMap.has(key)) severity=Math.max(severity,1);
  return severity;
}
function bcpStandaloneCycloneId(item){return String(item?.id||item?.number||item?.slotId||item?.displayName||"")}
function bcpStandaloneCycloneSig(item){return JSON.stringify([
  item?.reportDateTime||"",item?.targetDateTime||"",Number(item?.intensityLevel||0),!!item?.ended,item?.pressure||"",
  item?.direction||"",item?.speedKmH||"",item?.maxWindMS||"",item?.gustWindMS||"",Array.isArray(item?.forecasts)?item.forecasts:[]
])}
function bcpStandaloneCycloneSeverity(oldData,newData){
  if (!oldData?.updatedAt) return 0;
  const oldMap=new Map((Array.isArray(oldData?.items)?oldData.items:[]).map((item)=>[bcpStandaloneCycloneId(item),item])); let severity=0;
  for (const item of (Array.isArray(newData?.items)?newData.items:[])){
    const oldItem=oldMap.get(bcpStandaloneCycloneId(item));
    if (!oldItem) return 2;
    if (Number(item?.intensityLevel||0)>Number(oldItem?.intensityLevel||0)) return 2;
    if (bcpStandaloneCycloneSig(item)!==bcpStandaloneCycloneSig(oldItem)) severity=Math.max(severity,1);
  }
  return severity;
}

chrome.storage.onChanged.addListener((changes,area)=>{
  if (area!=="local") return;
  const detected=[];
  if (changes[STORE.quakes]){
    const s=bcpStandaloneQuakeSeverity(changes[STORE.quakes].oldValue,changes[STORE.quakes].newValue); if (s) detected.push(["quake",s]);
  }
  if (changes[STORE.warnings]){
    const s=bcpStandaloneWarningSeverity(changes[STORE.warnings].oldValue,changes[STORE.warnings].newValue); if (s) detected.push(["warning",s]);
  }
  if (changes[STORE.cyclones]){
    const s=bcpStandaloneCycloneSeverity(changes[STORE.cyclones].oldValue,changes[STORE.cyclones].newValue); if (s) detected.push(["cyclone",s]);
  }
  if (!detected.length) return;
  (async()=>{for (const [kind,severity] of detected) await addAttention(kind,severity)})().catch(()=>{});
});
async function setupAlarms(){
  const settings = await getSettings();
  const names = ["bcp2_quake", "bcp2_warning", "bcp2_cyclone"];

  if (settings.autoUpdateEnabled === false){
    await Promise.allSettled(names.map((name) => chrome.alarms.clear(name)));
    return;
  }

  const desired = {
    bcp2_quake: Math.max(1, Number(settings.quakePeriodMinutes) || 5),
    bcp2_warning: Math.max(1, Number(settings.warningPeriodMinutes) || 10),
    bcp2_cyclone: Math.max(1, Number(settings.cyclonePeriodMinutes) || 10)
  };

  for (const [name, periodInMinutes] of Object.entries(desired)){
    const current = await chrome.alarms.get(name).catch(() => null);
    const currentPeriod = Number(current?.periodInMinutes || 0);
    if (current && Math.abs(currentPeriod - periodInMinutes) < 0.001) continue;
    if (current) await chrome.alarms.clear(name);
    chrome.alarms.create(name, { periodInMinutes });
  }
}

async function initialize(){
  const keys = Object.values(STORE);
  const data = await chrome.storage.local.get(keys);
  const updates = {};

  if (!data[STORE.settings]) updates[STORE.settings] = DEFAULTS;
  if (!data[STORE.quakeLevels]) updates[STORE.quakeLevels] = {};
  if (!data[STORE.warningState]) updates[STORE.warningState] = {};
  if (!data[STORE.cycloneState]) updates[STORE.cycloneState] = {};
  if (data[STORE.quakeInitialized] == null) updates[STORE.quakeInitialized] = !!data[STORE.quakes]?.updatedAt;
  if (data[STORE.warningInitialized] == null) updates[STORE.warningInitialized] = !!data[STORE.warnings]?.updatedAt;
  if (data[STORE.cycloneInitialized] == null) updates[STORE.cycloneInitialized] = !!data[STORE.cyclones]?.updatedAt;
  if (!data[STORE.errors]) updates[STORE.errors] = {};
  if (!data[STORE.attention]) updates[STORE.attention] = { count: 0, lastAt: 0 };
  if (!data[STORE.notifLinks]) updates[STORE.notifLinks] = {};
  if (!["jma", "warning", "cyclone"].includes(data[STORE.view])) updates[STORE.view] = "jma";

  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  await setupAlarms();
  await syncActionBadgeFromStorage();
}

async function startupRefresh(){
  // initialize()中に期限超過アラームが割り込んでも通知しないよう、最初に静音化する。
  suppressOsNotifications = true;
  try{
    await initialize();
    const settings = await getSettings();
    if (settings.autoUpdateEnabled === false) return;
    await Promise.allSettled([refreshQuakes(), refreshWarnings(), refreshCyclones()]);
  }finally{
    suppressOsNotifications = false;
    bcpEndStartupQuietV106();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  startupRefresh().catch(() => {});
});

chrome.runtime.onStartup?.addListener(() => {
  startupRefresh().catch(() => {});
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const settings = await getSettings();
  if (settings.autoUpdateEnabled === false) return;

  if (alarm?.name === "bcp2_quake") refreshQuakes().catch(() => {});
  if (alarm?.name === "bcp2_warning") refreshWarnings().catch(() => {});
  if (alarm?.name === "bcp2_cyclone") refreshCyclones().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORE.attention]) return;
  syncActionBadge(changes[STORE.attention].newValue || { count: 0, lastAt: 0 }).catch(() => {});
});

// Service Workerが再起動した場合も、未確認状態をツールバーへ復元する。
syncActionBadgeFromStorage().catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "bcpWeather") return;

  (async () => {
    if (msg.cmd === "refreshQuake") return sendResponse(await refreshQuakes());
    if (msg.cmd === "refreshWarning") return sendResponse(await refreshWarnings());
    if (msg.cmd === "refreshCyclone") return sendResponse(await refreshCyclones());

    if (msg.cmd === "saveSettings"){
      const current = await getSettings();
      const requested = msg.settings || {};
      const settings = {
        ...current,
        ...requested,
        quakePeriodMinutes: Math.max(1, Number(requested.quakePeriodMinutes ?? current.quakePeriodMinutes) || 5),
        warningPeriodMinutes: Math.max(1, Number(requested.warningPeriodMinutes ?? current.warningPeriodMinutes) || 10),
        cyclonePeriodMinutes: Math.max(1, Number(requested.cyclonePeriodMinutes ?? current.cyclonePeriodMinutes) || 10),
        quakeNotifications: requested.quakeNotifications !== false,
        warningNotifications: requested.warningNotifications !== false,
        cycloneNotifications: requested.cycloneNotifications !== false,
        showAdvisory: !!requested.showAdvisory,
        autoUpdateEnabled: requested.autoUpdateEnabled !== false
      };
      await chrome.storage.local.set({ [STORE.settings]: settings });
      await setupAlarms();
      return sendResponse({ ok: true });
    }

    if (msg.cmd === "ackAttention"){
      await clearAttention();
      return sendResponse({ ok: true });
    }

    return sendResponse({ ok: false, error: "Unknown BCP weather command" });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });

  return true;
});

initialize().catch(() => {});

/* ===== v1.0.10: 起動時のTab未読を通常時と同じ赤/黄ルールで確実に反映 =====
 * startupRefresh前後の保存データを明示比較し、
 * 新規・強化 = alert(赤) / 同レベル更新 = update(黄) をカテゴリ別に保持する。
 * OS通知の起動時抑止は既存startupRefresh側のまま維持する。
 */
const bcpStandaloneStartupRefreshV110Original = startupRefresh;
startupRefresh = async function(...args){
  let before = {};
  try{
    before = await chrome.storage.local.get([STORE.quakes, STORE.warnings, STORE.cyclones]);
  }catch(_){ }

  const result = await bcpStandaloneStartupRefreshV110Original.apply(this, args);

  try{
    const after = await chrome.storage.local.get([STORE.quakes, STORE.warnings, STORE.cyclones]);
    const detected = [
      ["quake", bcpStandaloneQuakeSeverity(before[STORE.quakes], after[STORE.quakes])],
      ["warning", bcpStandaloneWarningSeverity(before[STORE.warnings], after[STORE.warnings])],
      ["cyclone", bcpStandaloneCycloneSeverity(before[STORE.cyclones], after[STORE.cyclones])],
    ];
    for (const [kind, severity] of detected){
      if (severity) await addAttention(kind, severity);
    }
  }catch(_){ }

  return result;
};
