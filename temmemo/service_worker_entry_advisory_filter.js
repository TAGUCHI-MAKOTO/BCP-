// v1.3.143
// 気象警報Tabは、注意報だけの新規発表・更新・解除では未読点滅を付けない。
// 警報以上の新規/上昇は赤、警報以上に関係する更新・解除・注意報への低下は黄色を維持する。
importScripts("service_worker_entry.js");

bcpTabWarningSeverity = function(oldData, newData){
  if (!oldData?.updatedAt) return 0;

  const oldMap = bcpTabWarningMap(oldData);
  const newMap = bcpTabWarningMap(newData);
  let severity = 0;

  for (const [key, current] of newMap){
    const previous = oldMap.get(key);
    const currentLevel = Number(current?.level || 0);
    const previousLevel = Number(previous?.level || 0);

    // 注意報だけの新規発表は点滅させない。
    if (!previous){
      if (currentLevel >= 3) return 2;
      continue;
    }

    // 注意報から警報以上への移行、または警報レベル上昇は赤。
    if (currentLevel > previousLevel && currentLevel >= 3) return 2;

    const changed =
      currentLevel !== previousLevel ||
      current.code !== previous.code ||
      current.name !== previous.name ||
      current.status !== previous.status ||
      current.reportDatetime !== previous.reportDatetime;

    // 注意報だけの更新は無視。警報以上が関係する更新・低下は黄色。
    if (changed && (currentLevel >= 3 || previousLevel >= 3)){
      severity = Math.max(severity, 1);
    }
  }

  // 注意報だけの解除は無視。警報以上の解除は黄色。
  for (const [key, previous] of oldMap){
    if (!newMap.has(key) && Number(previous?.level || 0) >= 3){
      severity = Math.max(severity, 1);
    }
  }

  return severity;
};
