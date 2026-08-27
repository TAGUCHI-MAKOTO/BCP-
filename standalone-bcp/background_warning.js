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
          await addAttention();
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
