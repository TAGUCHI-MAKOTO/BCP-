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
