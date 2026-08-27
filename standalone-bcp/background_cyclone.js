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
