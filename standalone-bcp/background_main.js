async function setupAlarms(){
  const settings = await getSettings();
  await Promise.allSettled([
    chrome.alarms.clear("bcp2_quake"),
    chrome.alarms.clear("bcp2_warning"),
    chrome.alarms.clear("bcp2_cyclone")
  ]);

  if (settings.autoUpdateEnabled === false) return;

  chrome.alarms.create("bcp2_quake", {
    periodInMinutes: Math.max(1, Number(settings.quakePeriodMinutes) || 5)
  });
  chrome.alarms.create("bcp2_warning", {
    periodInMinutes: Math.max(1, Number(settings.warningPeriodMinutes) || 10)
  });
  chrome.alarms.create("bcp2_cyclone", {
    periodInMinutes: Math.max(1, Number(settings.cyclonePeriodMinutes) || 10)
  });
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
  await initialize();
  const settings = await getSettings();
  if (settings.autoUpdateEnabled === false) return;

  suppressOsNotifications = true;
  try{
    await Promise.allSettled([refreshQuakes(), refreshWarnings(), refreshCyclones()]);
  }finally{
    suppressOsNotifications = false;
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
