// 警報お知らせくん v1.0.15
// 気象警報Tabは、新規の警報以上または警報レベル上昇時だけ赤点滅する。
// 注意報、同レベルの警報内容更新、解除、注意報への低下では点滅しない。
// 地震・台風の未読判定は従来どおり。
importScripts("background.js");

bcpStandaloneWarningSeverity = function(oldData, newData){
  if (!oldData?.updatedAt) return 0;

  const oldMap = bcpStandaloneWarningMap(oldData);
  const newMap = bcpStandaloneWarningMap(newData);

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

// 旧版で残っている警報Tabの黄色未読だけを更新時に解除する。
chrome.storage.local.get([STORE.attention]).then((data) => {
  const current = bcpNormalizeAttentionV111(data[STORE.attention]);
  if (bcpAttentionLevel(current.warning) !== 1) return;
  const next = bcpNormalizeAttentionV111({ ...current, warning: false });
  if (next.count > 0) next.lastAt = current.lastAt || Date.now();
  return chrome.storage.local.set({ [STORE.attention]: next });
}).catch(() => {});
