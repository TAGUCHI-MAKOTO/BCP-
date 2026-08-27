chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});


const MAX_BYTES = 320 * 1024;
const FETCH_TIMEOUT_MS = 5500;

// tiny LRU-ish cache
const _labelCache = new Map(); // url -> label
function cacheSet(k, v){
  _labelCache.set(k, v);
  if (_labelCache.size > 240){
    const first = _labelCache.keys().next().value;
    _labelCache.delete(first);
  }
}

function safeHttpUrl(u){
  try{
    const url = new URL(String(u || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  }catch(_){
    return "";
  }
}

function decodeEntities(s){
  const t = String(s || "");
  const n = t.replace(/&#(\d+);/g, (_, d) => {
    const c = Number(d);
    return Number.isFinite(c) ? String.fromCodePoint(c) : _;
  }).replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
    const c = parseInt(h, 16);
    return Number.isFinite(c) ? String.fromCodePoint(c) : _;
  });

  return n
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function pickMeta(html){
  const s = String(html || "");

  const pick = (reList) => {
    for (const re of reList){
      const m = s.match(re);
      if (m && m[1]) return decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    }
    return "";
  };

  const title = pick([
    /<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ]);

  const desc = pick([
    /<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i
  ]);

  return { title, desc };
}

function cleanLabelByHost(url, title, desc){
  let host = "";
  try{ host = new URL(url).hostname.toLowerCase(); }catch(_){}

  let t = (title || "").trim();
  let d = (desc || "").trim();

  const stripSuffix = (s, suff) => s.endsWith(suff) ? s.slice(0, -suff.length).trim() : s;
  const stripSepSuffix = (s, site) => {
    s = s.replace(new RegExp("\\s*[\\-|\\|·•]\\s*" + site.replace(/[.*+?^${}()|[\]\\]/g,"\\$&") + "\\s*$","i"), "").trim();
    return s;
  };

  // YouTube: show video title
  if (host === "www.youtube.com" || host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")){
    t = stripSuffix(t, " - YouTube");
    t = stripSuffix(t, " - YouTube Music");
    t = stripSepSuffix(t, "YouTube");
  }

  // Teams: try to use description if title is generic
  if (host === "teams.microsoft.com"){
    const generic = !t || /^microsoft teams$/i.test(t) || (/microsoft teams/i.test(t) && t.length <= 26);
    if (generic && d){
      const s = d.split(/\r?\n/)[0].trim();
      if (s && !/sign in/i.test(s) && !/download/i.test(s)) return s;
    }
    t = stripSepSuffix(t, "Microsoft Teams");
  }

  if (host.endsWith(".sharepoint.com")){
    t = stripSepSuffix(t, "SharePoint");
  }

  if (!t && d){
    const s = d.split(/\r?\n/)[0].trim();
    if (s && s.length >= 3) t = s;
  }

  return (t || "").replace(/\s+/g, " ").trim();
}

async function fetchHtmlSnippet(url){
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort("timeout"), FETCH_TIMEOUT_MS);

  try{
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      credentials: "include",
      headers: { "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
    });

    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader){
      const txt = await res.text();
      return txt.slice(0, MAX_BYTES);
    }

    const chunks = [];
    let total = 0;
    while (true){
      const { value, done } = await reader.read();
      if (done) break;
      if (value){
        total += value.byteLength;
        chunks.push(value);
        if (total >= MAX_BYTES) break;
      }
    }
    try{ reader.cancel(); }catch(_){}

    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks){
      buf.set(c, off);
      off += c.byteLength;
      if (off >= total) break;
    }
    return new TextDecoder("utf-8", { fatal:false }).decode(buf);
  }finally{
    clearTimeout(tm);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "fetchTitle") return;

  const url = safeHttpUrl(msg.url);
  if (!url){
    sendResponse({ title: "" });
    return;
  }

  const hit = _labelCache.get(url);
  if (hit){
    sendResponse({ title: hit });
    return;
  }

  (async () => {
    try{
      const html = await fetchHtmlSnippet(url);
      const { title, desc } = pickMeta(html);
      const cleaned = cleanLabelByHost(url, title, desc).slice(0, 120);
      if (cleaned) cacheSet(url, cleaned);
      sendResponse({ title: cleaned });
    }catch(_){
      sendResponse({ title: "" });
    }
  })();

  return true; // async
});

/* =========================
   BCP Alert
   - Google Trends: keyword monitoring (published within 1 hour)
   - JMA earthquake JSON: earthquakes within 24 hours
   - JMA notification: maximum intensity 3 or higher
========================= */

// v1.3.120では旧Google Trends版の定期処理を停止し、下段の気象警報版へ移行する。
const LEGACY_BCP_DISABLED = true;

const BCP_STORE = {
  settings: "bcp_settings_v1",
  keywords: "bcp_keywords_v1",
  lastItems: "bcp_lastItems_v1",
  seenIds: "bcp_seenIds_v1",
  notifLinks: "bcp_notifLinks_v1",
  attention: "bcp_attention_v1",
  testItems: "bcp_testItems_v1",
  lastError: "bcp_lastError_v1",
  uiToggleAt: "bcp_uiToggleAt_v1",
  cooldownMap: "bcp_cooldownMap_v1",
  jmaInitialized: "bcp_jma_initialized_v1",
  jmaNotifyLevels: "bcp_jma_notify_levels_v1",
};

const BCP_DEFAULTS = {
  trendsRssUrl: "https://trends.google.co.jp/trending/rss?geo=JP",
  periodMinutes: 5,
  enableNotifications: true,
  searchMode: "news", // news | web
  maxItems: 120,
};

const JMA_QUAKE_URL = "https://www.data.jma.go.jp/multi/quake/index.html?lang=jp";
const JMA_QUAKE_LIST_URL = "https://www.jma.go.jp/bosai/quake/data/list.json";
const TRENDS_RECENT_WINDOW_MS = 60 * 60 * 1000;
const JMA_DISPLAY_WINDOW_MS = 24 * 60 * 60 * 1000;
const JMA_NOTIFY_MIN_SCORE = 3;
const BCP_COOLDOWN_MS = 12 * 60 * 60 * 1000;

const DEFAULT_TRENDS_KEYWORDS = [
  "津波", "台風", "豪雨", "線状降水帯", "洪水", "停電", "断水",
  "避難", "交通障害", "大雪", "暴風", "システム障害", "サイバー攻撃"
];

chrome.runtime.onInstalled.addListener(async () => {
  if (LEGACY_BCP_DISABLED) return;
  try{
    const keys = Object.values(BCP_STORE);
    const cur = await chrome.storage.local.get(keys);

    if (!cur[BCP_STORE.settings]){
      await chrome.storage.local.set({ [BCP_STORE.settings]: BCP_DEFAULTS });
    }

    const oldKeywords = Array.isArray(cur[BCP_STORE.keywords])
      ? cur[BCP_STORE.keywords]
      : DEFAULT_TRENDS_KEYWORDS;
    // 地震・震度は気象庁へ移行。津波はGoogle Trends側に残す。
    const migratedKeywords = oldKeywords.filter((x) => !["地震", "震度"].includes(String(x || "").trim()));
    await chrome.storage.local.set({
      [BCP_STORE.keywords]: migratedKeywords.length ? migratedKeywords : DEFAULT_TRENDS_KEYWORDS,
    });

    const init = {};
    if (!cur[BCP_STORE.seenIds]) init[BCP_STORE.seenIds] = {};
    if (!cur[BCP_STORE.notifLinks]) init[BCP_STORE.notifLinks] = {};
    if (!cur[BCP_STORE.attention]) init[BCP_STORE.attention] = { count: 0, lastAt: 0 };
    if (!cur[BCP_STORE.testItems]) init[BCP_STORE.testItems] = [];
    if (!cur[BCP_STORE.lastError]) init[BCP_STORE.lastError] = { at: 0, message: "" };
    if (!cur[BCP_STORE.uiToggleAt]) init[BCP_STORE.uiToggleAt] = 0;
    if (!cur[BCP_STORE.cooldownMap]) init[BCP_STORE.cooldownMap] = {};
    if (cur[BCP_STORE.jmaInitialized] == null) init[BCP_STORE.jmaInitialized] = false;
    if (!cur[BCP_STORE.jmaNotifyLevels]) init[BCP_STORE.jmaNotifyLevels] = {};
    if (Object.keys(init).length) await chrome.storage.local.set(init);

    await bcpSetupAlarm();
    bcpRefreshAll().catch(() => {});
  }catch(_){ }
});

chrome.runtime.onStartup?.addListener(async () => {
  if (LEGACY_BCP_DISABLED) return;
  try{
    await bcpSetupAlarm();
    await bcpRefreshAll();
  }catch(_){ }
});

async function bcpSetupAlarm(){
  const { [BCP_STORE.settings]: settings } = await chrome.storage.local.get([BCP_STORE.settings]);
  const cfg = { ...BCP_DEFAULTS, ...(settings || {}) };
  const mins = Math.max(1, Number(cfg.periodMinutes || 0) || BCP_DEFAULTS.periodMinutes);
  await chrome.alarms.clear("bcp_refresh");
  chrome.alarms.create("bcp_refresh", { periodInMinutes: mins });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (LEGACY_BCP_DISABLED) return;
  if (alarm?.name !== "bcp_refresh") return;
  await bcpRefreshAll().catch(() => {});
});

function bcpNormalizeText(s){
  return String(s || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function bcpMatchKeyword(text, kws){
  const t = bcpNormalizeText(text);
  for (const raw of (kws || [])){
    const k = bcpNormalizeText(raw);
    if (!k) continue;
    const parts = k.split(" ").filter(Boolean);
    if (parts.length && parts.every((p) => t.includes(p))) return raw;
  }
  return null;
}

function bcpMakeSearchUrl(query, mode="news"){
  const q = encodeURIComponent(String(query || ""));
  if (mode === "news") return `https://www.google.com/search?tbm=nws&hl=ja&gl=jp&q=${q}`;
  return `https://www.google.com/search?hl=ja&gl=jp&q=${q}`;
}

function parseRfcDateMs(raw){
  const ms = Date.parse(String(raw || "").trim());
  return Number.isFinite(ms) ? ms : NaN;
}

function parseJmaDateMs(raw){
  const value = String(raw || "").trim();
  if (!value) return NaN;

  // list.json は通常 ISO 8601（+09:00付き）。まず標準パーサーで処理する。
  const isoMs = Date.parse(value);
  if (Number.isFinite(isoMs)) return isoMs;

  // 多言語ページ等の YYYY/MM/DD HH:mm 表記にも対応する。
  const m = value.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h - 9, mi, 0, 0);
}

function isWithin(ms, windowMs, now=Date.now()){
  if (!Number.isFinite(ms)) return false;
  const age = Number(now) - ms;
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

async function bcpCooldownAllows(title){
  try{
    const key = bcpNormalizeText(title);
    if (!key) return true;
    const { [BCP_STORE.cooldownMap]: map0 } = await chrome.storage.local.get([BCP_STORE.cooldownMap]);
    const map = map0 || {};
    const last = Number(map[key] || 0);
    return !last || (Date.now() - last) >= BCP_COOLDOWN_MS;
  }catch(_){
    return true;
  }
}

async function bcpCooldownTouch(title){
  try{
    const key = bcpNormalizeText(title);
    if (!key) return;
    const now = Date.now();
    const { [BCP_STORE.cooldownMap]: map0 } = await chrome.storage.local.get([BCP_STORE.cooldownMap]);
    const map = map0 || {};
    map[key] = now;
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const k of Object.keys(map)){
      if (Number(map[k] || 0) < cutoff) delete map[k];
    }
    await chrome.storage.local.set({ [BCP_STORE.cooldownMap]: map });
  }catch(_){ }
}

async function bcpNotify(title, message, url){
  const id = `bcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try{
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icons/icon48.png",
      title,
      message: message || "",
      priority: 2,
    });

    const got = await chrome.storage.local.get([BCP_STORE.notifLinks, BCP_STORE.attention]);
    const map = got[BCP_STORE.notifLinks] || {};
    map[id] = safeHttpUrl(url) || JMA_QUAKE_URL;
    const ids = Object.keys(map);
    if (ids.length > 200){
      for (const oldId of ids.slice(0, ids.length - 200)) delete map[oldId];
    }

    const att = got[BCP_STORE.attention] || { count: 0, lastAt: 0 };
    att.count = (Number(att.count) || 0) + 1;
    att.lastAt = Date.now();
    await chrome.storage.local.set({
      [BCP_STORE.notifLinks]: map,
      [BCP_STORE.attention]: att,
    });
  }catch(_){ }
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  try{
    const { [BCP_STORE.notifLinks]: notifLinks } = await chrome.storage.local.get([BCP_STORE.notifLinks]);
    const map = notifLinks || {};
    const url = map[notificationId];
    if (url) chrome.tabs.create({ url });
    delete map[notificationId];
    await chrome.storage.local.set({
      [BCP_STORE.notifLinks]: map,
      [BCP_STORE.attention]: { count: 0, lastAt: 0 },
    });
    chrome.notifications.clear(notificationId);
  }catch(_){ }
});

async function bcpEnsureOffscreen(){
  try{
    await chrome.offscreen.createDocument({
      url: "offscreen_bcp.html",
      reasons: ["DOM_PARSER"],
      justification: "Parse Google Trends RSS XML for BCP alerts",
    });
  }catch(e){
    const message = String(e?.message || e);
    if (!message.includes("Only a single offscreen")) throw e;
  }
}

function bcpCallOffscreen(cmd, payload){
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "bcp_offscreen", cmd, ...(payload || {}) },
      (response) => {
        if (chrome.runtime.lastError){
          resolve({ ok: false, error: chrome.runtime.lastError.message, items: [] });
          return;
        }
        resolve(response || { ok: false, error: "empty response", items: [] });
      }
    );
  });
}

async function fetchText(url, accept){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try{
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: accept || "*/*" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      ok: true,
      url: response.url || url,
      contentType: response.headers.get("content-type") || "",
      text: await response.text(),
    };
  }catch(e){
    return { ok: false, url, error: String(e?.message || e) };
  }finally{
    clearTimeout(timer);
  }
}

async function fetchTrends(primaryUrl){
  const candidates = [...new Set([
    primaryUrl,
    "https://trends.google.co.jp/trending/rss?geo=JP",
    "https://trends.google.com/trending/rss?geo=JP",
    "https://trends.google.co.jp/trends/trendingsearches/daily/rss?geo=JP",
    "https://trends.google.com/trends/trendingsearches/daily/rss?geo=JP",
  ].filter(Boolean))];

  let lastError = "fetch failed";
  for (const url of candidates){
    const result = await fetchText(url, "application/rss+xml,application/xml,text/xml,*/*");
    if (result.ok) return result;
    lastError = result.error || lastError;
  }
  return { ok: false, error: lastError };
}

async function collectTrendItems(cfg, keywords, seenMap){
  const fetched = await fetchTrends(cfg.trendsRssUrl);
  if (!fetched.ok) throw new Error(`Google Trends取得失敗: ${fetched.error || "fetch failed"}`);

  const parsed = await bcpCallOffscreen("parseTrends", { xmlText: fetched.text });
  if (!parsed?.ok) throw new Error(`Google Trends解析失敗: ${parsed?.error || "parse error"}`);

  const parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
  const now = Date.now();
  const items = parsedItems
    .filter((it) => isWithin(parseRfcDateMs(it.published), TRENDS_RECENT_WINDOW_MS, now))
    // 地震・震度は気象庁の公式情報へ一本化する。
    .filter((it) => !/(地震|震度)/.test(String(it.title || "")))
    .slice(0, cfg.maxItems)
    .map((it) => {
      const hitKey = bcpMatchKeyword(it.title, keywords);
      return {
        ...it,
        sourceType: "trends",
        sourceLabel: "Google Trends",
        _hit: !!hitKey,
        _hitKey: hitKey || "",
        sortAt: parseRfcDateMs(it.published) || 0,
      };
    });

  const newOnes = [];
  for (const it of items){
    const id = `trends:${it.id || `${it.title}|${it.published}`}`;
    it.id = id;
    if (!seenMap[id]){
      newOnes.push(it);
      seenMap[id] = now;
    }
  }

  return {
    items,
    newOnes,
    sourceUrl: fetched.url,
    parsedCount: parsedItems.length,
  };
}

async function collectJmaQuakes(){
  const fetched = await fetchText(JMA_QUAKE_LIST_URL, "application/json,*/*");
  if (!fetched.ok) throw new Error(`気象庁地震情報取得失敗: ${fetched.error || "fetch failed"}`);

  let reports;
  try{
    reports = JSON.parse(fetched.text);
  }catch(e){
    throw new Error(`気象庁地震情報JSON解析失敗: ${e?.message || e}`);
  }
  if (!Array.isArray(reports)){
    throw new Error("気象庁地震情報JSON解析失敗: 一覧形式ではありません");
  }

  const now = Date.now();
  const grouped = new Map();

  // 同じ地震に複数種類の情報が発表されるため、Event ID単位でまとめる。
  for (const report of reports){
    if (!report || typeof report !== "object") continue;

    const eventTime = String(report.at || "").trim();
    const eventAt = parseJmaDateMs(eventTime);
    if (!isWithin(eventAt, JMA_DISPLAY_WINDOW_MS, now)) continue;

    const eventId = String(report.eid || `${eventTime}|${report.anm || ""}`).trim();
    if (!eventId) continue;

    const reportTime = String(report.rdt || "").trim();
    const reportAt = parseJmaDateMs(reportTime);
    const jsonName = String(report.json || "").trim();

    // 多言語版の一覧で「地震検知日時」に設定される詳細URLは、
    // 地震自体の eid ではなく、発表データ側の ctt を eventID に使用する。
    // ctt がない場合は、個別JSON名の先頭14桁（同じ発表ID）を代用する。
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
      maxIntensityRaw: String(report.maxi || "").trim(),
      jsonName,
    };

    if (!grouped.has(eventId)) grouped.set(eventId, []);
    grouped.get(eventId).push(entry);
  }

  const items = [];
  for (const [eventId, entries] of grouped){
    entries.sort((a, b) => (b.reportAt || 0) - (a.reportAt || 0));

    // 最新発表を優先しつつ、情報種別によって空欄の項目は別発表から補完する。
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

    // テンメモで必要な4項目が成立しない情報種別は一覧対象外にする。
    if (!Number.isFinite(eventAt) || !epicenter || !magnitude || !maxIntensityRaw) continue;

    const maxIntensity = formatIntensity(maxIntensityRaw);
    const score = intensityScore(maxIntensity);

    // 一覧の「地震検知日時」と同じ詳細先を使う。
    // 最新のうち、必要項目と詳細IDを持つ発表を優先する。
    const detailEntry = entries.find((x) =>
      x.detailId && x.epicenter && x.magnitude && x.maxIntensityRaw
    ) || entries.find((x) => x.detailId) || latest;
    const detailId = String(detailEntry?.detailId || eventId).trim();
    const link = `https://www.data.jma.go.jp/multi/quake/quake_detail.html?eventID=${encodeURIComponent(detailId)}&lang=jp`;

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
      title: epicenter,
      published: reportTime || eventTime,
      sourceType: "jmaQuake",
      sourceLabel: "気象庁",
      link,
      _hit: score >= JMA_NOTIFY_MIN_SCORE,
      _hitKey: score >= JMA_NOTIFY_MIN_SCORE ? `${maxIntensity}以上` : "",
      eventAt,
      sortAt: eventAt || latest?.reportAt || 0,
    });
  }

  items.sort((a, b) => (b.sortAt || 0) - (a.sortAt || 0));

  return {
    success: true,
    items,
    sourceUrl: fetched.url || JMA_QUAKE_LIST_URL,
    parsedCount: reports.length,
  };
}

function jmaNotificationMessage(it){
  return [
    `発生: ${it.eventTime || "不明"}`,
    `震央: ${it.epicenter || "不明"}`,
    `マグニチュード: M${it.magnitude || "不明"}`,
    `最大震度: ${it.maxIntensity || "不明"}`,
  ].join("\n");
}

async function notifyNewJmaQuakes(items, cfg, storageSnapshot){
  const initialized = !!storageSnapshot[BCP_STORE.jmaInitialized];
  const levels0 = storageSnapshot[BCP_STORE.jmaNotifyLevels];
  const levels = (levels0 && typeof levels0 === "object") ? levels0 : {};
  const now = Date.now();

  for (const it of items){
    const score = Number(it.intensityScore || 0) || 0;
    const previous = levels[it.id];
    const previousScore = Number(previous?.score ?? previous ?? 0) || 0;

    // 初回取得では過去24時間分を通知せず、監視開始地点として記録する。
    if (initialized && cfg.enableNotifications && score >= JMA_NOTIFY_MIN_SCORE && previousScore < score){
      await bcpNotify(
        `地震情報: ${it.maxIntensity}`,
        jmaNotificationMessage(it),
        it.link || JMA_QUAKE_URL
      );
    }

    levels[it.id] = { score: Math.max(previousScore, score), at: now };
  }

  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  for (const id of Object.keys(levels)){
    const at = Number(levels[id]?.at || 0);
    if (at && at < cutoff) delete levels[id];
  }

  await chrome.storage.local.set({
    [BCP_STORE.jmaInitialized]: true,
    [BCP_STORE.jmaNotifyLevels]: levels,
  });
}

function mergeAndSortItems(testItems, jmaItems, trendItems){
  const merged = [...(testItems || []), ...(jmaItems || []), ...(trendItems || [])];
  const seen = new Set();
  const unique = [];
  for (const item of merged){
    const id = String(item?.id || `${item?.title || ""}|${item?.published || ""}`);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({ ...item, id });
  }

  const priority = (it) => {
    if (String(it.id || "").startsWith("test_")) return 4;
    if (it.sourceType === "jmaQuake") return 3;
    if (it.sourceType === "trends" && it._hit) return 2;
    return 1;
  };

  unique.sort((a, b) =>
    priority(b) - priority(a) ||
    (Number(b.sortAt || 0) - Number(a.sortAt || 0))
  );
  return unique;
}

async function bcpSetLastError(messages){
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [messages].filter(Boolean);
  await chrome.storage.local.set({
    [BCP_STORE.lastError]: {
      at: list.length ? Date.now() : 0,
      message: list.join("\n"),
    },
  });
}

async function bcpRefreshAll(){
  const got = await chrome.storage.local.get([
    BCP_STORE.settings,
    BCP_STORE.keywords,
    BCP_STORE.seenIds,
    BCP_STORE.testItems,
    BCP_STORE.lastItems,
    BCP_STORE.jmaInitialized,
    BCP_STORE.jmaNotifyLevels,
  ]);

  const cfg = { ...BCP_DEFAULTS, ...(got[BCP_STORE.settings] || {}) };
  const keywords = Array.isArray(got[BCP_STORE.keywords]) ? got[BCP_STORE.keywords] : [];
  const seenMap = (got[BCP_STORE.seenIds] && typeof got[BCP_STORE.seenIds] === "object")
    ? got[BCP_STORE.seenIds]
    : {};
  const testItems = Array.isArray(got[BCP_STORE.testItems]) ? got[BCP_STORE.testItems] : [];
  const previousItems = Array.isArray(got[BCP_STORE.lastItems]?.items) ? got[BCP_STORE.lastItems].items : [];

  await bcpEnsureOffscreen();

  const errors = [];
  let trendResult = null;
  let jmaResult = null;

  try{
    trendResult = await collectTrendItems(cfg, keywords, seenMap);
  }catch(e){
    errors.push(String(e?.message || e));
    trendResult = {
      items: previousItems.filter((it) => it?.sourceType === "trends"),
      newOnes: [],
      sourceUrl: got[BCP_STORE.lastItems]?.trendsSourceUrl || cfg.trendsRssUrl,
      parsedCount: 0,
    };
  }

  try{
    jmaResult = await collectJmaQuakes();
  }catch(e){
    errors.push(String(e?.message || e));
    jmaResult = {
      success: false,
      items: previousItems
        .filter((it) => it?.sourceType === "jmaQuake")
        .filter((it) => isWithin(Number(it.eventAt || 0), JMA_DISPLAY_WINDOW_MS)),
      sourceUrl: got[BCP_STORE.lastItems]?.jmaSourceUrl || JMA_QUAKE_URL,
      parsedCount: 0,
    };
  }

  const now = Date.now();
  for (const id of Object.keys(seenMap)){
    if (Number(seenMap[id] || 0) < now - 7 * 24 * 60 * 60 * 1000) delete seenMap[id];
  }
  await chrome.storage.local.set({ [BCP_STORE.seenIds]: seenMap });

  if (trendResult && cfg.enableNotifications && keywords.length){
    for (const it of trendResult.newOnes || []){
      if (!it._hit) continue;
      if (!await bcpCooldownAllows(it.title)) continue;
      await bcpNotify(
        `BCPアラート: ${it._hitKey}`,
        [it.published, it.topNewsTitle].filter(Boolean).join("\n"),
        bcpMakeSearchUrl(it.title, cfg.searchMode)
      );
      await bcpCooldownTouch(it.title);
    }
  }

  if (jmaResult?.success){
    await notifyNewJmaQuakes(jmaResult.items || [], cfg, got);
  }

  const items = mergeAndSortItems(testItems, jmaResult?.items, trendResult?.items);
  await chrome.storage.local.set({
    [BCP_STORE.lastItems]: {
      items,
      updatedAt: Date.now(),
      trendsSourceUrl: trendResult?.sourceUrl || cfg.trendsRssUrl,
      jmaSourceUrl: jmaResult?.sourceUrl || JMA_QUAKE_URL,
      trendsParsedCount: Number(trendResult?.parsedCount || 0),
      jmaParsedCount: Number(jmaResult?.parsedCount || 0),
      trendsRecentWindowMinutes: 60,
      jmaDisplayWindowHours: 24,
      jmaNotifyMinIntensity: 3,
    },
  });
  await bcpSetLastError(errors);

  return { ok: errors.length === 0, warnings: errors, itemCount: items.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "bcp") return;

  (async () => {
    if (msg.cmd === "refreshNow"){
      sendResponse(await bcpRefreshAll());
      return;
    }

    if (msg.cmd === "saveAll"){
      const settings = msg.settings || {};
      const keywords = Array.isArray(msg.keywords)
        ? msg.keywords.filter((x) => !["地震", "震度"].includes(String(x || "").trim()))
        : [];
      const cur = await chrome.storage.local.get([BCP_STORE.settings]);
      const merged = { ...(cur[BCP_STORE.settings] || BCP_DEFAULTS), ...settings };
      await chrome.storage.local.set({
        [BCP_STORE.settings]: merged,
        [BCP_STORE.keywords]: keywords,
      });
      await bcpSetupAlarm();
      sendResponse({ ok: true });
      return;
    }

    if (msg.cmd === "clearTests"){
      await chrome.storage.local.set({ [BCP_STORE.testItems]: [] });
      const got = await chrome.storage.local.get([BCP_STORE.lastItems]);
      const current = got[BCP_STORE.lastItems] || {};
      const items = Array.isArray(current.items)
        ? current.items.filter((it) => !String(it?.id || "").startsWith("test_"))
        : [];
      await chrome.storage.local.set({
        [BCP_STORE.lastItems]: { ...current, items, updatedAt: Date.now() },
      });
      sendResponse({ ok: true });
      return;
    }

    if (msg.cmd === "testNotify"){
      await bcpNotify("BCP テスト通知", "通知の動作確認です。", JMA_QUAKE_URL);
      sendResponse({ ok: true });
      return;
    }

    if (msg.cmd === "ackAttention"){
      await chrome.storage.local.set({ [BCP_STORE.attention]: { count: 0, lastAt: 0 } });
      sendResponse({ ok: true });
      return;
    }

    if (msg.cmd === "testHit"){
      const got = await chrome.storage.local.get([BCP_STORE.settings, BCP_STORE.keywords, BCP_STORE.testItems, BCP_STORE.lastItems]);
      const cfg = { ...BCP_DEFAULTS, ...(got[BCP_STORE.settings] || {}) };
      const keywords = Array.isArray(got[BCP_STORE.keywords]) ? got[BCP_STORE.keywords] : [];
      const keyword = String(keywords[0] || "台風");
      const title = `【テスト】${keyword} 発生`;
      const item = {
        id: `test_${Date.now()}`,
        title,
        published: new Date().toLocaleString("ja-JP"),
        approxTraffic: "TEST",
        topNewsTitle: "（テスト用）",
        link: bcpMakeSearchUrl(title, cfg.searchMode),
        sourceType: "test",
        sourceLabel: "テスト",
        _hit: true,
        _hitKey: keyword,
        sortAt: Date.now(),
      };
      const tests0 = Array.isArray(got[BCP_STORE.testItems]) ? got[BCP_STORE.testItems] : [];
      const tests = [item, ...tests0].slice(0, 30);
      const current = got[BCP_STORE.lastItems] || {};
      const currentItems = Array.isArray(current.items) ? current.items : [];
      await chrome.storage.local.set({
        [BCP_STORE.testItems]: tests,
        [BCP_STORE.lastItems]: {
          ...current,
          items: mergeAndSortItems(tests, currentItems.filter((x) => x.sourceType === "jmaQuake"), currentItems.filter((x) => x.sourceType === "trends")),
          updatedAt: Date.now(),
        },
      });
      if (cfg.enableNotifications){
        await bcpNotify(`BCPアラート: ${keyword}`, "（テスト通知）", item.link);
      }
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown bcp cmd" });
  })().catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));

  return true;
});

/* =========================
   BCP Weather - v1.3.123
   - 気象庁 地震情報（直近24時間）
   - 気象庁 全国の気象警報・注意報
   - 気象庁 台風情報
   - 地震・気象警報・台風を別々の間隔で巡回
========================= */
const BCP_WEATHER_STORE = {
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
};

const BCP_WEATHER_DEFAULTS = {
  quakePeriodMinutes: 5,
  warningPeriodMinutes: 10,
  cyclonePeriodMinutes: 10,
  quakeNotifications: true,
  warningNotifications: true,
  cycloneNotifications: true,
  showAdvisory: false,
};

const JMA_WARNING_MAP_URL = "https://www.jma.go.jp/bosai/warning/data/r8/map.json";
const JMA_AREA_URL = "https://www.jma.go.jp/bosai/common/const/area.json";
const JMA_WARNING_PAGE_URL = "https://www.jma.go.jp/bosai/warning/";
const JMA_CYCLONE_DATA_ROOT = "https://www.data.jma.go.jp/multi/data/VPTW60";
const JMA_CYCLONE_PAGE_URL = "https://www.data.jma.go.jp/multi/cyclone/index.html?lang=jp";
const JMA_CYCLONE_SLOT_IDS = [60, 61, 62, 63, 64, 65];

// 気象庁の2026年体系に対応した警報・注意報コード。
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
  "49": { name: "レベル4土砂災害危険警報", phenomenon: "土砂災害", level: 4 },
};

function bcpWeatherSettings(){
  return chrome.storage.local.get([
    BCP_WEATHER_STORE.settings,
    BCP_STORE.settings,
  ]).then((data) => {
    const saved = data[BCP_WEATHER_STORE.settings];
    if (saved) return { ...BCP_WEATHER_DEFAULTS, ...saved };

    // v1.3.116までの地震巡回間隔・通知設定だけ引き継ぐ。
    const legacy = data[BCP_STORE.settings] || {};
    return {
      ...BCP_WEATHER_DEFAULTS,
      quakePeriodMinutes: Math.max(1, Number(legacy.periodMinutes) || BCP_WEATHER_DEFAULTS.quakePeriodMinutes),
      quakeNotifications: legacy.enableNotifications !== false,
    };
  });
}

async function bcpWeatherSetError(kind, message){
  const data = await chrome.storage.local.get([BCP_WEATHER_STORE.errors]);
  const errors = data[BCP_WEATHER_STORE.errors] || {};
  errors[kind] = message ? { at: Date.now(), message: String(message) } : null;
  await chrome.storage.local.set({ [BCP_WEATHER_STORE.errors]: errors });
}

async function bcpWeatherSetupAlarms(){
  const settings = await bcpWeatherSettings();
  await chrome.alarms.clear("bcp_refresh");
  await chrome.alarms.clear("bcp2_quake");
  await chrome.alarms.clear("bcp2_warning");
  await chrome.alarms.clear("bcp2_cyclone");
  chrome.alarms.create("bcp2_quake", {
    periodInMinutes: Math.max(1, Number(settings.quakePeriodMinutes) || 5),
  });
  chrome.alarms.create("bcp2_warning", {
    periodInMinutes: Math.max(1, Number(settings.warningPeriodMinutes) || 10),
  });
  chrome.alarms.create("bcp2_cyclone", {
    periodInMinutes: Math.max(1, Number(settings.cyclonePeriodMinutes) || 10),
  });
}

async function bcpWeatherInitialize(){
  const data = await chrome.storage.local.get([
    BCP_WEATHER_STORE.settings,
    BCP_WEATHER_STORE.quakes,
    BCP_WEATHER_STORE.warnings,
    BCP_WEATHER_STORE.cyclones,
    BCP_WEATHER_STORE.quakeLevels,
    BCP_WEATHER_STORE.warningState,
    BCP_WEATHER_STORE.cycloneState,
    BCP_WEATHER_STORE.quakeInitialized,
    BCP_WEATHER_STORE.warningInitialized,
    BCP_WEATHER_STORE.cycloneInitialized,
    BCP_WEATHER_STORE.errors,
    BCP_WEATHER_STORE.view,
    BCP_STORE.settings,
  ]);

  const updates = {};
  if (!data[BCP_WEATHER_STORE.settings]){
    const legacy = data[BCP_STORE.settings] || {};
    updates[BCP_WEATHER_STORE.settings] = {
      ...BCP_WEATHER_DEFAULTS,
      quakePeriodMinutes: Math.max(1, Number(legacy.periodMinutes) || 5),
      quakeNotifications: legacy.enableNotifications !== false,
    };
  }
  if (!data[BCP_WEATHER_STORE.quakeLevels]) updates[BCP_WEATHER_STORE.quakeLevels] = {};
  if (!data[BCP_WEATHER_STORE.warningState]) updates[BCP_WEATHER_STORE.warningState] = {};
  if (!data[BCP_WEATHER_STORE.cycloneState]) updates[BCP_WEATHER_STORE.cycloneState] = {};
  if (data[BCP_WEATHER_STORE.quakeInitialized] == null){
    updates[BCP_WEATHER_STORE.quakeInitialized] = !!data[BCP_WEATHER_STORE.quakes]?.updatedAt;
  }
  if (data[BCP_WEATHER_STORE.warningInitialized] == null){
    updates[BCP_WEATHER_STORE.warningInitialized] = !!data[BCP_WEATHER_STORE.warnings]?.updatedAt;
  }
  if (data[BCP_WEATHER_STORE.cycloneInitialized] == null){
    updates[BCP_WEATHER_STORE.cycloneInitialized] = !!data[BCP_WEATHER_STORE.cyclones]?.updatedAt;
  }
  if (!data[BCP_WEATHER_STORE.errors]) updates[BCP_WEATHER_STORE.errors] = {};
  if (!["jma", "warning", "cyclone"].includes(data[BCP_WEATHER_STORE.view])){
    updates[BCP_WEATHER_STORE.view] = "jma";
  }
  if (Object.keys(updates).length) await chrome.storage.local.set(updates);

  await bcpWeatherSetupAlarms();
}

async function bcpWeatherRefreshQuakes(){
  try{
    const result = await collectJmaQuakes();
    const data = await chrome.storage.local.get([
      BCP_WEATHER_STORE.quakeLevels,
      BCP_WEATHER_STORE.quakeInitialized,
    ]);
    const levels = data[BCP_WEATHER_STORE.quakeLevels] || {};
    const initialized = !!data[BCP_WEATHER_STORE.quakeInitialized];
    const settings = await bcpWeatherSettings();
    const now = Date.now();

    for (const item of result.items || []){
      const score = Number(item.intensityScore || 0);
      const previous = Number(levels[item.id]?.score ?? levels[item.id] ?? 0);
      if (
        initialized &&
        settings.quakeNotifications &&
        score >= JMA_NOTIFY_MIN_SCORE &&
        previous < score
      ){
        await bcpNotify(
          `地震情報: ${item.maxIntensity}`,
          jmaNotificationMessage(item),
          item.link || JMA_QUAKE_URL
        );
      }
      levels[item.id] = { score: Math.max(previous, score), at: now };
    }

    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const id of Object.keys(levels)){
      if (Number(levels[id]?.at || 0) < cutoff) delete levels[id];
    }

    await chrome.storage.local.set({
      [BCP_WEATHER_STORE.quakes]: {
        items: result.items || [],
        updatedAt: now,
        sourceUrl: result.sourceUrl || JMA_QUAKE_LIST_URL,
      },
      [BCP_WEATHER_STORE.quakeLevels]: levels,
      [BCP_WEATHER_STORE.quakeInitialized]: true,
    });
    await bcpWeatherSetError("quake", "");
    return { ok: true, count: (result.items || []).length };
  }catch(error){
    const message = `気象庁地震情報の取得失敗: ${String(error?.message || error)}`;
    await bcpWeatherSetError("quake", message);
    return { ok: false, error: message };
  }
}

function bcpWarningIsActive(status){
  const text = String(status || "").trim();
  if (!text) return true;
  return !(
    text.includes("解除") ||
    text.includes("発表警報・注意報はなし") ||
    text === "なし"
  );
}

function bcpWarningDetailUrl(areaCode){
  if (!areaCode) return JMA_WARNING_PAGE_URL;
  return `${JMA_WARNING_PAGE_URL}#area_type=class10s&area_code=${encodeURIComponent(areaCode)}`;
}

async function bcpCollectWarnings(){
  const [warningResponse, areaResponse] = await Promise.all([
    fetch(JMA_WARNING_MAP_URL, { cache: "no-store" }),
    fetch(JMA_AREA_URL, { cache: "force-cache" }),
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
  const areaDictionaries = [
    class10Areas,
    officeAreas,
    areaJson?.class15s || {},
    areaJson?.class20s || {},
  ];
  const areaName = (code) => {
    for (const dictionary of areaDictionaries){
      if (dictionary?.[code]?.name) return dictionary[code].name;
    }
    return code;
  };

  const areas = new Map();
  for (const report of reports.filter(Boolean)){
    const reportDatetime = report.reportDatetime || report.controlDatetime || "";
    const class10Items =
      report?.warning?.class10Items ||
      report?.class10Items ||
      [];

    for (const area of Array.isArray(class10Items) ? class10Items : []){
      const areaCode = String(area?.areaCode || area?.code || "").trim();
      if (!areaCode) continue;
      const state = areas.get(areaCode) || {
        warnings: new Map(),
        reportDatetime: "",
      };

      for (const kind of Array.isArray(area?.kinds) ? area.kinds : []){
        const code = String(kind?.code || "").padStart(2, "0");
        const info = JMA_WARNING_INFO[code];
        if (!info || !bcpWarningIsActive(kind?.status)) continue;

        const current = state.warnings.get(info.phenomenon);
        if (!current || Number(current.level || 0) < info.level){
          state.warnings.set(info.phenomenon, {
            code,
            name: info.name,
            phenomenon: info.phenomenon,
            level: info.level,
            status: String(kind?.status || ""),
          });
        }
      }

      if (
        reportDatetime &&
        (!state.reportDatetime || Date.parse(reportDatetime) >= Date.parse(state.reportDatetime))
      ){
        state.reportDatetime = reportDatetime;
      }
      areas.set(areaCode, state);
    }
  }

  const items = [];
  for (const [areaCode, state] of areas){
    const warnings = [...state.warnings.values()]
      .sort((a, b) => b.level - a.level || a.code.localeCompare(b.code));
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
      detailUrl: bcpWarningDetailUrl(areaCode),
    });
  }

  items.sort((a, b) =>
    b.maxLevel - a.maxLevel ||
    (Date.parse(b.reportDatetime || 0) - Date.parse(a.reportDatetime || 0)) ||
    (a.parentAreaName || "").localeCompare(b.parentAreaName || "", "ja") ||
    a.areaName.localeCompare(b.areaName, "ja")
  );

  return { items, sourceUrl: JMA_WARNING_MAP_URL, reportCount: reports.length };
}

async function bcpWeatherRefreshWarnings(){
  try{
    const result = await bcpCollectWarnings();
    const data = await chrome.storage.local.get([
      BCP_WEATHER_STORE.warningState,
      BCP_WEATHER_STORE.warningInitialized,
    ]);
    const oldState = data[BCP_WEATHER_STORE.warningState] || {};
    const initialized = !!data[BCP_WEATHER_STORE.warningInitialized];
    const settings = await bcpWeatherSettings();
    const newState = {};

    for (const item of result.items || []){
      for (const warning of item.warnings || []){
        const key = `${item.areaCode}:${warning.phenomenon}`;
        const previousLevel = Number(oldState[key] || 0);
        newState[key] = warning.level;
        if (
          initialized &&
          settings.warningNotifications &&
          warning.level >= 3 &&
          previousLevel < warning.level
        ){
          const location = [item.parentAreaName, item.areaName]
            .filter((name, index, values) => name && values.indexOf(name) === index)
            .join("・");
          await bcpNotify(
            `気象警報: ${location || item.areaCode}`,
            warning.name,
            item.detailUrl || JMA_WARNING_PAGE_URL
          );
        }
      }
    }

    await chrome.storage.local.set({
      [BCP_WEATHER_STORE.warnings]: {
        items: result.items || [],
        updatedAt: Date.now(),
        sourceUrl: result.sourceUrl,
        reportCount: result.reportCount,
      },
      [BCP_WEATHER_STORE.warningState]: newState,
      [BCP_WEATHER_STORE.warningInitialized]: true,
    });
    await bcpWeatherSetError("warning", "");
    return { ok: true, count: (result.items || []).length };
  }catch(error){
    const message = `気象庁警報情報の取得失敗: ${String(error?.message || error)}`;
    await bcpWeatherSetError("warning", message);
    return { ok: false, error: message };
  }
}

function bcpCycloneDateMs(value){
  const match = String(value || "").trim().match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return Number.NaN;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 9,
    Number(match[5]),
    Number(match[6] || 0)
  );
}

function bcpCycloneIntensityLevel(classPart){
  const text = [
    classPart?.intensityAndTyphoonClass,
    classPart?.typhoonClassName,
  ].filter(Boolean).join(" ");
  if (/温帯低気圧|消滅/.test(text) || classPart?.typhoonClass === "LOW") return 1;
  if (text.includes("猛烈")) return 5;
  if (text.includes("非常に強い")) return 4;
  if (text.includes("強い")) return 3;
  if (/台風/.test(text) || ["TY", "STS", "TS"].includes(classPart?.typhoonClass)) return 2;
  return 1;
}

function bcpCycloneDisplayName(report){
  const number = String(report?.number || "").trim();
  const name = String(report?.name || "").trim();
  if (/^\d{4}$/.test(number)){
    const typhoonNumber = Number(number.slice(-2));
    return `台風第${typhoonNumber}号${name ? ` ${name}` : ""}`;
  }
  if (number || name){
    return `${report?.meteorologicalInfos?.[0]?.classPart?.typhoonClassName || "熱帯低気圧"}${number ? ` ${number}` : ""}${name ? ` ${name}` : ""}`;
  }
  return report?.meteorologicalInfos?.[0]?.classPart?.typhoonClassName || "台風情報";
}

function bcpCycloneForecast(info){
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
    speedKmH: String(centerPart.speedKmH || ""),
  };
}

function bcpCycloneItem(report, slotId){
  const current = report?.meteorologicalInfos?.[0];
  if (!current) return null;

  const classPart = current.classPart || {};
  const centerPart = current.centerPart || {};
  const windPart = current.windPart || {};
  const statusText = [
    classPart.typhoonClassName,
    classPart.intensityAndTyphoonClass,
    report?.remark,
  ].filter(Boolean).join(" ");
  const ended = classPart.typhoonClass === "LOW" || /温帯低気圧|消滅/.test(statusText);
  const number = String(report?.number || "").trim();

  return {
    id: `${number || `slot-${slotId}`}`,
    slotId,
    number,
    name: String(report?.name || ""),
    displayName: bcpCycloneDisplayName(report),
    reportDateTime: String(report?.reportDateTime || ""),
    targetDateTime: String(report?.targetDateTime || current.dateTime || ""),
    className: String(classPart.typhoonClassName || ""),
    areaClass: String(classPart.areaClass || ""),
    intensity: String(classPart.intensityAndTyphoonClass || classPart.typhoonClassName || ""),
    intensityLevel: bcpCycloneIntensityLevel(classPart),
    ended,
    pressure: String(centerPart.pressure || ""),
    direction: String(centerPart.direction || ""),
    speedKmH: String(centerPart.speedKmH || ""),
    maxWindMS: String(windPart.windSpeedMS || ""),
    gustWindMS: String(windPart.windGustSpeedMS || ""),
    forecasts: (Array.isArray(report?.meteorologicalInfos) ? report.meteorologicalInfos.slice(1) : [])
      .map(bcpCycloneForecast),
    detailUrl: `https://www.data.jma.go.jp/multi/cyclone/cyclone_detail.html?id=${slotId}&lang=jp`,
  };
}

async function bcpCollectCyclones(){
  const responses = await Promise.all(JMA_CYCLONE_SLOT_IDS.map(async (slotId) => {
    try{
      const response = await fetch(
        `${JMA_CYCLONE_DATA_ROOT}/${slotId}_jp.json`,
        { cache: "no-store" }
      );
      if (response.status === 404) return { slotId, reachable: true, report: null };
      if (!response.ok){
        return { slotId, reachable: true, report: null, error: `HTTP ${response.status}` };
      }
      return { slotId, reachable: true, report: await response.json() };
    }catch(error){
      return { slotId, reachable: false, report: null, error: String(error?.message || error) };
    }
  }));

  if (!responses.some((result) => result.reachable)){
    throw new Error("台風情報の配信元へ接続できません");
  }
  if (
    responses.every((result) => !result.report) &&
    responses.some((result) => result.error)
  ){
    const firstError = responses.find((result) => result.error)?.error || "取得失敗";
    throw new Error(firstError);
  }

  const now = Date.now();
  const availableMs = 24 * 60 * 60 * 1000;
  const items = responses
    .filter((result) => result.report)
    .filter((result) => {
      const reportAt = bcpCycloneDateMs(result.report.reportDateTime);
      return !Number.isFinite(reportAt) || now <= reportAt + availableMs;
    })
    .map((result) => bcpCycloneItem(result.report, result.slotId))
    .filter(Boolean)
    .sort((a, b) =>
      Number(a.ended) - Number(b.ended) ||
      Number(b.intensityLevel || 0) - Number(a.intensityLevel || 0) ||
      bcpCycloneDateMs(b.targetDateTime) - bcpCycloneDateMs(a.targetDateTime)
    );

  return {
    items,
    sourceUrl: JMA_CYCLONE_PAGE_URL,
    checkedSlots: JMA_CYCLONE_SLOT_IDS.length,
  };
}

async function bcpWeatherRefreshCyclones(){
  try{
    const result = await bcpCollectCyclones();
    const data = await chrome.storage.local.get([
      BCP_WEATHER_STORE.cycloneState,
      BCP_WEATHER_STORE.cycloneInitialized,
    ]);
    const oldState = data[BCP_WEATHER_STORE.cycloneState] || {};
    const initialized = !!data[BCP_WEATHER_STORE.cycloneInitialized];
    const settings = await bcpWeatherSettings();
    const now = Date.now();
    const newState = { ...oldState };

    for (const item of result.items || []){
      const previous = oldState[item.id];
      const currentLevel = Number(item.intensityLevel || 1);
      if (initialized && settings.cycloneNotifications && !item.ended){
        if (!previous){
          await bcpNotify(
            `台風情報: ${item.displayName}`,
            item.intensity || item.className || "台風が発生しました",
            item.detailUrl || JMA_CYCLONE_PAGE_URL
          );
        }else if (currentLevel > Number(previous.intensityLevel || 0)){
          await bcpNotify(
            `台風の勢力上昇: ${item.displayName}`,
            item.intensity || item.className || "勢力が強まりました",
            item.detailUrl || JMA_CYCLONE_PAGE_URL
          );
        }
      }
      newState[item.id] = {
        intensityLevel: currentLevel,
        ended: !!item.ended,
        at: now,
      };
    }

    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const id of Object.keys(newState)){
      if (Number(newState[id]?.at || 0) < cutoff) delete newState[id];
    }

    await chrome.storage.local.set({
      [BCP_WEATHER_STORE.cyclones]: {
        items: result.items || [],
        updatedAt: now,
        sourceUrl: result.sourceUrl,
        checkedSlots: result.checkedSlots,
      },
      [BCP_WEATHER_STORE.cycloneState]: newState,
      [BCP_WEATHER_STORE.cycloneInitialized]: true,
    });
    await bcpWeatherSetError("cyclone", "");
    return { ok: true, count: (result.items || []).length };
  }catch(error){
    const message = `気象庁台風情報の取得失敗: ${String(error?.message || error)}`;
    await bcpWeatherSetError("cyclone", message);
    return { ok: false, error: message };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try{
    await bcpWeatherInitialize();
    await Promise.allSettled([
      bcpWeatherRefreshQuakes(),
      bcpWeatherRefreshWarnings(),
      bcpWeatherRefreshCyclones(),
    ]);
  }catch(_){ }
});

chrome.runtime.onStartup?.addListener(async () => {
  try{
    await bcpWeatherInitialize();
    await Promise.allSettled([
      bcpWeatherRefreshQuakes(),
      bcpWeatherRefreshWarnings(),
      bcpWeatherRefreshCyclones(),
    ]);
  }catch(_){ }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === "bcp2_quake"){
    bcpWeatherRefreshQuakes().catch(() => {});
  }
  if (alarm?.name === "bcp2_warning"){
    bcpWeatherRefreshWarnings().catch(() => {});
  }
  if (alarm?.name === "bcp2_cyclone"){
    bcpWeatherRefreshCyclones().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "bcpWeather") return;

  (async () => {
    if (msg.cmd === "refreshQuake"){
      sendResponse(await bcpWeatherRefreshQuakes());
      return;
    }
    if (msg.cmd === "refreshWarning"){
      sendResponse(await bcpWeatherRefreshWarnings());
      return;
    }
    if (msg.cmd === "refreshCyclone"){
      sendResponse(await bcpWeatherRefreshCyclones());
      return;
    }
    if (msg.cmd === "saveSettings"){
      const current = await bcpWeatherSettings();
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
      };
      await chrome.storage.local.set({ [BCP_WEATHER_STORE.settings]: settings });
      await bcpWeatherSetupAlarms();
      sendResponse({ ok: true });
      return;
    }
    if (msg.cmd === "ackAttention"){
      await chrome.storage.local.set({
        [BCP_WEATHER_STORE.attention]: { count: 0, lastAt: 0 },
      });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "Unknown BCP weather command" });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });

  return true;
});
