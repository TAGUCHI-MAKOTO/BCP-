// v1.3.145
// 気象警報Tabは、新規の警報以上または警報レベル上昇時だけ赤点滅する。
// 注意報、同レベルの警報内容更新、解除、注意報への低下では点滅しない。
// 台風・地震の未読判定は従来どおり。
importScripts("service_worker_entry.js");

bcpTabWarningSeverity = function(oldData, newData){
  if (!oldData?.updatedAt) return 0;

  const oldMap = bcpTabWarningMap(oldData);
  const newMap = bcpTabWarningMap(newData);

  for (const [key, current] of newMap){
    const previous = oldMap.get(key);
    const currentLevel = Number(current?.level || 0);
    const previousLevel = Number(previous?.level || 0);

    // 新規の警報以上、注意報→警報以上、警報レベル上昇は赤点滅。
    if (currentLevel >= 3 && (!previous || currentLevel > previousLevel)){
      return 2;
    }
  }

  // 注意報・同レベル更新・解除・低下はすべて無点滅。
  return 0;
};

// v1.3.143以前で残っている「警報Tabの黄色未読」だけを更新時に消す。
// 赤の未読警報はそのまま保持する。
chrome.storage.local.get([BCP_TAB_UNREAD_KEY]).then((data) => {
  const raw = data[BCP_TAB_UNREAD_KEY] || {};
  if (bcpTabSeverityLevel(raw.warning) !== 1) return;
  return chrome.storage.local.set({
    [BCP_TAB_UNREAD_KEY]: {
      quake: bcpTabSeverityValue(bcpTabSeverityLevel(raw.quake)),
      warning: false,
      cyclone: bcpTabSeverityValue(bcpTabSeverityLevel(raw.cyclone)),
      lastAt: (bcpTabSeverityLevel(raw.quake) || bcpTabSeverityLevel(raw.cyclone)) ? Number(raw.lastAt || Date.now()) : 0,
    },
  });
}).catch(() => {});
