"use strict";

const $ = (id) => document.getElementById(id);

// Elements
const msgEl = $("msg");
const subjEl = $("subj");
const bodyEl = $("body");
const codeBodyEl = $("codeBody");
const bodyLineNumbersEl = $("bodyLineNumbers");
const editorEl = document.querySelector(".editor");
const bodyModalEl = $("bodyModal");
const bodyModalEditorEl = $("bodyModalEditor");
const codeModalEditorEl = $("codeModalEditor");
const bodyModalLineNumbersEl = $("bodyModalLineNumbers");
const btnBodyExpand = $("btnBodyExpand");
const btnCodeMode = $("btnCodeMode");
const btnBodyModalClose = $("btnBodyModalClose");
const btnBodyModalApply = $("btnBodyModalApply");
const bodyModalBackdropEl = $("bodyModalBackdrop");
const tagsEl = $("tags");

const btnAdd = $("btnAdd");
const btnDelete = $("btnDelete");
const btnClear = $("btnClear");
const userNameEl = $("userName");
const btnNameEdit = $("btnNameEdit");
const btnLayoutMode = $("btnLayoutMode");

const qEl = $("q");
const sortEl = $("sort");
const btnClearQ = $("btnClearQ");
const listEl = $("list");
const favTagsEl = $("favTags");
const btnImport = $("btnImport");
const btnExport = $("btnExport");


const toastEl = $("toast");
/* list tabs (optional) */
const tabTplEl = $("tabTpl");
const tabMemoEl = $("tabMemo");
const tabCodeEl = $("tabCode");
const tabBcpEl = $("tabBcp");

// Storage keys
const STORE_KEY = "memo_state_v1";
const DRAFT_KEY = "editor_draft_v1";
const CODE_DRAFT_KEY = "code_editor_draft_v1";
const TPL_CACHE_KEY = "tpl_cache_v1";
const TPL_FILE_KEY  = "tpl_file_handle_v1";
const USER_NAME_KEY = "user_name_v1";
const NAME_EDIT_KEY = "user_name_edit_v1";

// template auto-sync meta
const TPL_META_KEY = "tpl_meta_v1";
/* list tab */
const LIST_TAB_KEY = "list_tab_v1";
/* sort */
const SORT_KEY = "list_sort_v1";
const CODE_MODE_KEY = "code_editor_mode_v1";

// State
let state = { memos: [], selectedId: null, codeMemos: [], selectedCodeId: null };
let templates = [];
let qText = "";
let selectedTplKey = "";

let userNameText = "";
let nameEditOn = false;

let listTab = "tpl"; // "tpl" | "memo" | "bcp"  ※Codeタブは廃止
let bcpOriginTab = "tpl"; // BCPを開く直前のTemp／Noteを保持
let editorManualOpen = false;

/* multi-tag filters */
const MAX_TAG_FILTERS = 8;
let tagFilters = new Set(); // lower-case tags
let sortMode = "recent";    // recent | az | za
let codeEditorMode = false;

// templates auto-sync state
let tplMeta = { name: "", lastModified: 0, size: 0 };
let tplSyncState = 0; // 0:unknown, 1:ok, -1:not configured, -2:error
let tplLastErr = "";
let _tplRefreshP = null;


const PANEL_LAYOUT_KEY = "panel_layout_mode"; // 旧版の保存キー（起動時に削除）
let panelLayoutMode = "single";

function setPanelLayoutMode(next){
  // レイアウトはセッション内だけで切り替える。
  // 拡張機能を閉じて再表示した際は、必ず1カラムから開始する。
  panelLayoutMode = (next === "abcd") ? "abcd" : "single";
  applyPanelLayoutModeUI();
}

async function loadPanelLayoutMode(){
  // 前回の拡張表示は引き継がず、毎回1カラムで起動する。
  panelLayoutMode = "single";
  try{ await chrome.storage.local.remove(PANEL_LAYOUT_KEY); }catch(_){}
}

function applyPanelLayoutModeUI(){
  const isAbcd = (panelLayoutMode === "abcd");
  try{
    document.documentElement.classList.toggle("layoutAbcd", isAbcd);
  }catch(_){}
  if (btnLayoutMode){
    // 表示崩れ防止のため、ボタン表示は常に固定
    btnLayoutMode.textContent = "⇔";
    btnLayoutMode.title = isAbcd ? "1列表示へ切替" : "ABCD表示へ切替";
    btnLayoutMode.setAttribute("aria-label", btnLayoutMode.title);
  }
}

function togglePanelLayoutMode(){
  setPanelLayoutMode(panelLayoutMode === "abcd" ? "single" : "abcd");
}

// --- Utils ---
function debounce(fn, ms){
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// --- Persisted handles (IndexedDB) ---
const FSDB_NAME = "ten_memo_fs_v1";
const FSDB_STORE = "handles";
const TPL_HANDLE_IDB_KEY = "tpl_file_handle";
const TPL_DIR_IDB_KEY = "tpl_dir_handle";
let _fsDbP = null;
let tplHandleSession = null; // fallback (non-persistent)
let tplDirHandleSession = null; // fallback (non-persistent)

function openFsDb(){
  if (_fsDbP) return _fsDbP;
  _fsDbP = new Promise((resolve, reject) => {
    const req = indexedDB.open(FSDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FSDB_STORE)) db.createObjectStore(FSDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _fsDbP;
}

async function idbGet(key){
  const db = await openFsDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(FSDB_STORE, "readonly");
    const st = tx.objectStore(FSDB_STORE);
    const req = st.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val){
  const db = await openFsDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(FSDB_STORE, "readwrite");
    const st = tx.objectStore(FSDB_STORE);
    const req = st.put(val, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

let _rafRender = 0;
function scheduleRender(){
  if (_rafRender) return;
  _rafRender = requestAnimationFrame(() => {
    _rafRender = 0;
    render();
  });
}

const scheduleSaveState = debounce(() => {
  chrome.storage.local.set({ [STORE_KEY]: state }).catch(() => {});
}, 200);

function isCodeTab(){
  return listTab === "code";
}

function getActiveSelectedId(){
  return isCodeTab() ? String(state?.selectedCodeId || "") : String(state?.selectedId || "");
}

function setActiveSelectedId(id){
  if (isCodeTab()) state.selectedCodeId = id || null;
  else state.selectedId = id || null;
}

function getActiveItems(){
  return isCodeTab() ? state.codeMemos : state.memos;
}

function getActiveDraftKey(){
  return isCodeTab() ? CODE_DRAFT_KEY : DRAFT_KEY;
}


function editorDraftPayload(){
  return {
    subj: String(subjEl?.value || ""),
    body: String(getBodyText ? getBodyText() : ""),
    tags: String(tagsEl?.value || ""),
    selectedId: getActiveSelectedId(),
    selectedTplKey: String(selectedTplKey || ""),
    listTab: String(listTab || "memo"),
    updatedAt: Date.now()
  };
}

function draftHasText(draft){
  if (!draft || typeof draft !== "object") return false;
  return !!(
    String(draft.subj || "").trim() ||
    String(draft.body || "").trim() ||
    String(draft.tags || "").trim()
  );
}

function saveEditorDraftNow(){
  try{
    const draft = editorDraftPayload();
    const key = getActiveDraftKey();
    if (draftHasText(draft)){
      chrome.storage.local.set({ [key]: draft }).catch(() => {});
    }else{
      chrome.storage.local.remove(key).catch(() => {});
    }
  }catch(_){/* noop */}
}

const scheduleSaveEditorDraft = debounce(saveEditorDraftNow, 250);

function clearEditorDraft(){
  try{ chrome.storage.local.remove(getActiveDraftKey()).catch(() => {}); }catch(_){/* noop */}
}

function editorHasContent(){
  try{
    return !!(
      String(subjEl?.value || "").trim() ||
      String(getEditorText ? getEditorText(bodyEl) : "").trim() ||
      String(tagsEl?.value || "").trim()
    );
  }catch(_){
    return false;
  }
}

function shouldCompactEditor(){
  // サイドバーABCD配置では、件名・本文スペースを常に表示する
  return false;
}

function updateEditorLayout(){
  try{
    document.body.classList.toggle("editorCompact", shouldCompactEditor());
  }catch(_){/* noop */}
}

let _editorLayoutRaf = 0;
function scheduleEditorLayout(){
  if (_editorLayoutRaf) return;
  _editorLayoutRaf = requestAnimationFrame(() => {
    _editorLayoutRaf = 0;
    updateEditorLayout();
  });
}

function openEditorForInput(){
  editorManualOpen = true;
  updateEditorLayout();
}

function collapseEditorIfEmptySoon(){
  setTimeout(() => {
    try{
      if (editorEl && editorEl.contains(document.activeElement)) return;
      if (!state?.selectedId && !selectedTplKey && !editorHasContent()){
        editorManualOpen = false;
        updateEditorLayout();
      }
    }catch(_){/* noop */}
  }, 120);
}

async function restoreEditorDraft(){
  try{
    const key = getActiveDraftKey();
    const d = await chrome.storage.local.get(key);
    const draft = d[key];
    if (!draftHasText(draft)) return false;

    const draftSelectedId = String(draft.selectedId || "");
    if (isCodeTab()){
      state.selectedCodeId = (draftSelectedId && state.codeMemos.some(x => x.id === draftSelectedId)) ? draftSelectedId : null;
    }else{
      state.selectedId = (draftSelectedId && state.memos.some(x => x.id === draftSelectedId)) ? draftSelectedId : null;
    }
    selectedTplKey = (!isCodeTab()) ? String(draft.selectedTplKey || "") : "";

    if (subjEl) subjEl.value = normalizeText(draft.subj || "");
    setBodyFromText(normalizeText(draft.body || ""));
    if (tagsEl) tagsEl.value = String(draft.tags || "");

    applyTabUI();
    syncListTabClass();
    syncTplModeForContext();
    applyCodeEditorModeUI();
    applyModeUI();
    editorManualOpen = true;
    scheduleEditorLayout();
    scheduleSaveState();
    return true;
  }catch(_){
    return false;
  }
}

function saveTplCache(){
  chrome.storage.local.set({ [TPL_CACHE_KEY]: templates }).catch(() => {});
}

const scheduleSaveUserName = debounce(() => {
  chrome.storage.local.set({ [USER_NAME_KEY]: userNameText }).catch(() => {});
}, 250);

const scheduleSaveListTab = debounce(() => {
  chrome.storage.local.set({ [LIST_TAB_KEY]: listTab }).catch(()=>{});
}, 200);

const scheduleSaveSort = debounce(() => {
  chrome.storage.local.set({ [SORT_KEY]: sortMode }).catch(()=>{});
}, 200);

function setMsg(t, sticky=false){
  if (!msgEl) return;
  msgEl.textContent = t || "";
  if (!sticky && t){
    clearTimeout(setMsg._tm);
    setMsg._tm = setTimeout(() => { msgEl.textContent = ""; }, 1200);
  }
}

function toast(t){
  if (!toastEl) return;
  toastEl.textContent = t || "";
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => { if (toastEl) toastEl.textContent = ""; }, 800);
}


function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}/* ===== Rich link (URL → タイトル表示) ===== */
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/ig;
const TRAIL_TRIM_RE = /[)\]\}＞>、。,.!?:;]+$/;

function safeHttpUrl(u){
  const s = String(u || "").trim();
  if (!s) return "";
  try{
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  }catch(_){
    return "";
  }
}

function normalizeUrlToken(raw){
  let s = String(raw || "").trim();
  if (!s) return "";
  // trim common trailing punctuation (paste often includes it)
  s = s.replace(TRAIL_TRIM_RE, "");
  return safeHttpUrl(s) || "";
}

function hostLabel(urlStr){
  const u = safeHttpUrl(urlStr);
  if (!u) return "";
  try{
    const h = new URL(u).hostname.toLowerCase();
    if (h === "teams.microsoft.com") return "Microsoft Teams";
    if (h.endsWith(".sharepoint.com")) return "SharePoint";
    if (h === "outlook.office.com" || h === "outlook.office365.com") return "Outlook";
    if (h === "github.com") return "GitHub";
    if (h === "docs.google.com") return "Google ドキュメント";
    if (h === "drive.google.com") return "Google ドライブ";
    // strip www.
    return h.replace(/^www\./, "");
  }catch(_){
    return "";
  }
}

const BODY_HTML_CACHE_MAX = 220;
const _bodyHtmlCache = new Map();

function cachePut(map, k, v){
  map.set(k, v);
  if (map.size > BODY_HTML_CACHE_MAX){
    const first = map.keys().next().value;
    map.delete(first);
  }
  return v;
}

function renderBodyHtml(text){
  const src = String(text || "");
  const hit = _bodyHtmlCache.get(src);
  if (hit != null) return hit;

  const t = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Markdown link: [label](url)
  const mdRe = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/ig;

  let out = "";
  let last = 0;

  const linkifyPlain = (seg) => {
    if (!seg) return "";
    let s = String(seg);
    let o = "";
    let li = 0;
    URL_RE.lastIndex = 0;
    for (const m of s.matchAll(URL_RE)){
      const a = m.index ?? 0;
      const b = a + m[0].length;
      o += escapeHtml(s.slice(li, a)).replace(/\n/g, "<br>");
      const url = normalizeUrlToken(m[0]);
      if (url){
        const lbl = hostLabel(url) || url;
        o += `<a class="rtLink" href="${escapeHtml(url)}" data-url="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lbl)}</a>`;
      }else{
        o += escapeHtml(m[0]);
      }
      li = b;
    }
    o += escapeHtml(s.slice(li)).replace(/\n/g, "<br>");
    return o;
  };

  let mm;
  while ((mm = mdRe.exec(t)) !== null){
    const a = mm.index ?? 0;
    const b = a + mm[0].length;
    out += linkifyPlain(t.slice(last, a));
    const label = String(mm[1] || "").trim();
    const url = normalizeUrlToken(mm[2]);
    if (url){
      const lbl = label || hostLabel(url) || url;
      out += `<a class="rtLink" href="${escapeHtml(url)}" data-url="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lbl)}</a>`;
    }else{
      out += escapeHtml(mm[0]);
    }
    last = b;
  }
  out += linkifyPlain(t.slice(last));
  return cachePut(_bodyHtmlCache, src, out);
}

function normalizeCodeText(s){
  return String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function setCodeText(el, text){
  if (!el) return;
  el.value = normalizeCodeText(text);
  el.scrollTop = 0;
  el.scrollLeft = 0;
}

function getCodeText(el){
  return normalizeCodeText(el?.value || "");
}

function toHalfWidthAscii(s){
  return String(s || "")
    .replace(/\u3000/g, " ")
    .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

function normalizeCodeTextareaHalfWidth(el){
  if (!el) return false;
  const old = String(el.value || "");
  const next = toHalfWidthAscii(old);
  if (next === old) return false;

  const st = Number(el.selectionStart || 0);
  const en = Number(el.selectionEnd || st);
  el.value = next;
  try{ el.setSelectionRange(Math.min(next.length, st), Math.min(next.length, en)); }catch(_){}
  return true;
}

function activeCodeEditor(){
  return isBodyModalOpen() ? codeModalEditorEl : codeBodyEl;
}

function setEditorFromText(el, text){
  if (!el) return;

  const v = String(text || "");

  // textarea fallback
  if (typeof el.value === "string"){
    el.value = v;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    return;
  }

  // contenteditable
  el.innerHTML = renderBodyHtml(v);

  // ★長文でスクロールしていても、反映/選択時は必ず先頭表示
  el.scrollTop = 0;
  el.scrollLeft = 0;
}

function setBodyFromText(text){
  if (isCodeTab()){
    setCodeText(codeBodyEl, text);
    if (isBodyModalOpen()) setCodeText(codeModalEditorEl, text);
    refreshAllLineNumbers();
    return;
  }

  setEditorFromText(bodyEl, text);
  if (isBodyModalOpen()) setEditorFromText(bodyModalEditorEl, text);
  refreshAllLineNumbers();
}

function getEditorText(el){
  if (!el) return "";
  // textarea 互換：もし textarea のままなら value で拾う
  if (typeof el.value === "string") return String(el.value || "");

  const norm = (s) => {
    let t = String(s || "");
    t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    t = t.replace(/\u00A0/g, " ");           // NBSP → space
    t = t.replace(/[ \t]+\n/g, "\n");      // trailing spaces at EOL
    t = t.replace(/\n{3,}/g, "\n\n");      // compress huge blank blocks
    return t.replace(/\s+$/,"");
  };

  // ★リンクが無いケースが大半なので、最速ルート：そのまま innerText を採用
  // （contenteditable の多様なDOMでも「見た目どおりの改行」を保持できる）
  if (!el.querySelector("a")){
    return norm(el.innerText || el.textContent || "");
  }

  // リンクがある時だけクローンして <a>→Markdown に復元
  const clone = el.cloneNode(true);
  const as = clone.querySelectorAll("a");
  for (const a of as){
    const href = safeHttpUrl(a.getAttribute("href") || a.dataset.url || "");
    const labelRaw = (a.textContent || "").replace(/\s+/g, " ").trim();
    const label = labelRaw.replace(/[\]\n\r]+/g, " ").trim();
    const md = href ? `[${label || hostLabel(href) || href}](${href})` : (a.textContent || "");
    a.replaceWith(document.createTextNode(md));
  }

  // detach要素だと innerText の改行解釈が不安定なことがあるため、
  // 透明な一時コンテナに差し込んでから取得する
  let out = "";
  let holder = null;
  try{
    holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-99999px;top:-99999px;opacity:0;pointer-events:none;z-index:-1;";
    holder.appendChild(clone);
    document.body.appendChild(holder);
    out = clone.innerText || "";
  }catch(_){
    out = clone.textContent || "";
  }finally{
    try{ holder?.remove(); }catch(_){}
  }
  return norm(out);
}

function getBodyText(){
  if (isCodeTab()){
    if (isBodyModalOpen()) return getCodeText(codeModalEditorEl);
    return getCodeText(codeBodyEl);
  }
  if (isBodyModalOpen()) return getEditorText(bodyModalEditorEl);
  return getEditorText(bodyEl);
}

function isBodyModalOpen(){
  return !!(bodyModalEl && !bodyModalEl.hidden);
}

function placeCaretAtEnd(el){
  if (!el || typeof el.focus !== "function") return;
  try{
    el.focus();
    if (typeof el.value === "string"){
      const n = el.value.length;
      el.setSelectionRange(n, n);
      return;
    }
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
  }catch(_){
    try{ el.focus(); }catch(__){}
  }
}

const syncBodyModalToMain = debounce(() => {
  if (!isBodyModalOpen()) return;

  if (isCodeTab()){
    setCodeText(codeBodyEl, getCodeText(codeModalEditorEl));
  }else{
    setEditorFromText(bodyEl, getEditorText(bodyModalEditorEl));
  }
  refreshAllLineNumbers();
}, 250);

function openBodyModal(){
  if (!bodyModalEl || !bodyModalEditorEl) return;
  editorManualOpen = true;
  updateEditorLayout();
  if (typeof suppressCopy === "function") suppressCopy(500);

  if (isCodeTab()){
    setCodeText(codeModalEditorEl, getCodeText(codeBodyEl));
  }else{
    setEditorFromText(bodyModalEditorEl, getEditorText(bodyEl));
  }

  bodyModalEl.hidden = false;
  bodyModalEl.setAttribute("aria-hidden", "false");
  document.body.classList.add("bodyModalOpen");
  refreshAllLineNumbers();
  setTimeout(() => {
    if (isCodeTab()) placeCaretAtEnd(codeModalEditorEl);
    else placeCaretAtEnd(bodyModalEditorEl);
  }, 0);
}

function closeBodyModal(){
  if (!isBodyModalOpen()) return;

  if (isCodeTab()){
    setCodeText(codeBodyEl, getCodeText(codeModalEditorEl));
  }else{
    setEditorFromText(bodyEl, getEditorText(bodyModalEditorEl));
  }

  bodyModalEl.hidden = true;
  bodyModalEl.setAttribute("aria-hidden", "true");
  document.body.classList.remove("bodyModalOpen");
  refreshAllLineNumbers();
  saveEditorDraftNow();
  clearSelection();
  if (btnBodyExpand) btnBodyExpand.focus();
}





function placeCaretAfter(node){
  try{
    const sel = window.getSelection();
    if (!sel) return;
    const r = document.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }catch(_){}
}

function insertNodesAtCursor(nodes){
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();

  const frag = document.createDocumentFragment();
  let lastNode = null;
  for (const n of nodes){
    if (!n) continue;
    frag.appendChild(n);
    lastNode = n;
  }
  range.insertNode(frag);
  if (lastNode) placeCaretAfter(lastNode);
  return true;
}

function textToNodesWithNewlines(text){
  const s = String(text || "");
  if (!s) return [];
  const parts = s.split("\n");
  const out = [];
  for (let i=0;i<parts.length;i++){
    if (parts[i]) out.push(document.createTextNode(parts[i]));
    if (i < parts.length-1) out.push(document.createElement("br"));
  }
  return out;
}

async function openUrl(url){
  const u = safeHttpUrl(url);
  if (!u) return;
  try{
    if (chrome?.tabs?.create){
      chrome.tabs.create({ url: u });
      return;
    }
  }catch(_){}
  try{ window.open(u, "_blank", "noopener"); }catch(_){}
}let _openLinkTm = 0;
function scheduleOpenUrl(url){
  clearTimeout(_openLinkTm);
  _openLinkTm = setTimeout(() => { openUrl(url); }, 220);
}
function cancelOpenUrl(){
  clearTimeout(_openLinkTm);
  _openLinkTm = 0;
}


const _titleCache = new Map(); // url -> title
function _cacheTitle(url, title){
  _titleCache.set(url, title);
  if (_titleCache.size > 300){
    const first = _titleCache.keys().next().value;
    _titleCache.delete(first);
  }
}

async function fetchTitle(url){
  const u = safeHttpUrl(url);
  if (!u) return "";
  const hit = _titleCache.get(u);
  if (hit) return hit;

  // heuristic: auth-required links often fail → host label
  const h = hostLabel(u);
  try{
    const r = await chrome.runtime.sendMessage({ type: "fetchTitle", url: u });
    const t = (r && typeof r.title === "string") ? r.title.trim() : "";
    const title = (t || h || u).replace(/\s+/g, " ").slice(0, 80);
    _cacheTitle(u, title);
    return title;
  }catch(_){
    const title = (h || u).slice(0, 80);
    _cacheTitle(u, title);
    return title;
  }
}

function splitByUrls(text){
  const s = String(text || "");
  URL_RE.lastIndex = 0;
  const out = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)){
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (a > last) out.push({ type:"text", v: s.slice(last, a) });
    out.push({ type:"url", v: m[0] });
    last = b;
  }
  if (last < s.length) out.push({ type:"text", v: s.slice(last) });
  return out;
}

async function enrichAnchorTitle(a){
  if (!a) return;
  const url = safeHttpUrl(a.dataset.url || a.getAttribute("href") || "");
  if (!url) return;

  // already has a non-placeholder title
  const cur = (a.textContent || "").trim();
  if (cur && cur !== "…" && cur !== hostLabel(url)) return;

  a.textContent = "…";
  const t = await fetchTitle(url);
  if (!t) return;
  // if user deleted the node while fetching
  if (!a.isConnected) return;
  a.textContent = t;
  // body html cache may now be stale for this exact string (usually empty in editor)
  _bodyHtmlCache.clear();
}


function extractClipboardLinkHints(clipboardData){
  try{
    if (!clipboardData) return new Map();
    const html = clipboardData.getData("text/html") || "";
    if (!html) return new Map();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = Array.from(doc.querySelectorAll("a[href]"));
    const map = new Map();
    for (const a of anchors){
      const href = safeHttpUrl(a.getAttribute("href") || "");
      if (!href) continue;
      const txt = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt) continue;
      if (txt === href) continue;
      if (!map.has(href)) map.set(href, txt.slice(0, 120));
    }
    return map;
  }catch(_){
    return new Map();
  }
}

function handleBodyPaste(ev){
  const editorEl = ev?.currentTarget || bodyEl;
  if (!editorEl) return;
  const cd = ev.clipboardData;
  const rawText = cd ? (cd.getData("text/plain") || "") : "";
  const text = shouldForceHalfWidthInEditor(editorEl) ? toHalfWidthAscii(rawText) : rawText;
  if (!text) return;

  // Prefer display name from clipboard HTML (<a>TEXT</a>) when available (Teams等)
  const hintMap = extractClipboardLinkHints(cd);

  const parts = splitByUrls(text);
  if (!parts.some(p => p.type === "url")){
    if (!shouldForceHalfWidthInEditor(editorEl)) return; // let default paste for non-URL
    ev.preventDefault();
    const nodes = textToNodesWithNewlines(text);
    if (!insertNodesAtCursor(nodes)) editorEl.append(...nodes);
    const gutter = (editorEl === bodyModalEditorEl) ? bodyModalLineNumbersEl : bodyLineNumbersEl;
    scheduleLineNumberRefresh(editorEl, gutter);
    return;
  }

  ev.preventDefault();
  const nodes = [];

  for (const p of parts){
    if (p.type === "text"){
      nodes.push(...textToNodesWithNewlines(p.v));
      continue;
    }
    const url = normalizeUrlToken(p.v);
    if (!url){
      nodes.push(...textToNodesWithNewlines(p.v));
      continue;
    }

    const a = document.createElement("a");
    a.className = "rtLink";
    a.href = url;
    a.dataset.url = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    const hint = hintMap.get(url);
    if (hint){
      a.textContent = hint;
    }else{
      a.textContent = hostLabel(url) || "…";
    }
    nodes.push(a);
  }

  if (!insertNodesAtCursor(nodes)){
    editorEl.append(...nodes);
  }

  // async title resolve (only for placeholder/hostLabel)
  for (const n of nodes){
    if (n && n.tagName === "A"){
      enrichAnchorTitle(n).catch(()=>{});
    }
  }
}

function editorContainsSelection(el){
  try{
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    return !!(el && el.contains(r.startContainer));
  }catch(_){
    return false;
  }
}

function textAfterCaret(el){
  try{
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return "";
    const r = sel.getRangeAt(0);
    if (!el || !el.contains(r.startContainer)) return "";
    const after = r.cloneRange();
    after.selectNodeContents(el);
    after.setStart(r.endContainer, r.endOffset);
    return after.toString();
  }catch(_){
    return "";
  }
}

function insertPlainTextAtCaret(text){
  const s = String(text || "");
  if (!s) return false;
  try{
    if (document.queryCommandSupported && document.queryCommandSupported("insertText")){
      document.execCommand("insertText", false, s);
      return true;
    }
  }catch(_){}
  try{
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(s);
    range.insertNode(node);
    placeCaretAfter(node);
    return true;
  }catch(_){
    return false;
  }
}

function handleCodeEditorArrowKey(e){
  // コードタブ分離後は codeEditorMode フラグではなく、現在のタブで判定する
  if (listTab !== "code") return;
  const el = e?.currentTarget || null;
  if (!el || !editorContainsSelection(el)) return;

  // 末尾で ↓ を押したら空行を追加して下へ移動できるようにする
  // 末尾で → を押したら半角スペースを追加して右へ移動できるようにする
  // ※完全なVS Codeの「仮想カーソル」ではなく、実際に空行/空白を追加する軽量版
  if (e.key !== "ArrowDown" && e.key !== "ArrowRight") return;

  const after = textAfterCaret(el);
  if ((after || "").length > 0) return;

  e.preventDefault();
  const ins = e.key === "ArrowDown" ? "\n" : " ";
  if (insertPlainTextAtCaret(ins)){
    try{
      openEditorForInput();
      scheduleSaveEditorDraft();
      scheduleEditorLayout();
      const gutter = (el === bodyModalEditorEl) ? bodyModalLineNumbersEl : bodyLineNumbersEl;
      scheduleLineNumberRefresh(el, gutter);
    }catch(_){}
  }
}

function shouldForceHalfWidthInEditor(el){
  return !!el && listTab === "code";
}

function normalizeEditorHalfWidthIfNeeded(el){
  try{
    if (!shouldForceHalfWidthInEditor(el)) return false;
    const raw = getEditorText(el);
    const next = toHalfWidthAscii(raw);
    if (next === raw) return false;
    setEditorFromText(el, next);
    placeCaretAtEnd(el);
    return true;
  }catch(_){
    return false;
  }
}

function handleHalfWidthBeforeInput(e){
  try{
    const el = e?.currentTarget || null;
    if (!shouldForceHalfWidthInEditor(el)) return;
    if (e.isComposing) return;

    const inputType = String(e.inputType || "");
    if (!/^insert(Text|CompositionText)$/.test(inputType)) return;

    const raw = (typeof e.data === "string") ? e.data : "";
    if (!raw) return;

    const half = toHalfWidthAscii(raw);
    if (half === raw) return;

    e.preventDefault();
    if (insertPlainTextAtCaret(half)){
      openEditorForInput();
      scheduleSaveEditorDraft();
      scheduleEditorLayout();
      if (el === bodyModalEditorEl) syncBodyModalToMain();
      const gutter = (el === bodyModalEditorEl) ? bodyModalLineNumbersEl : bodyLineNumbersEl;
      scheduleLineNumberRefresh(el, gutter);
    }
  }catch(_){}
}

function normalizeText(s){
  let t = String(s || "");
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // If content contains literal \n etc, unescape
  t = t.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\n");
  return t;
}

function parseTags(s){
  const raw = (s || "").toString()
    .replace(/[＃#]/g, " ")
    .replace(/[，、]/g, ",")
    .split(/[,\s]+/);

  const out = [];
  const seen = new Set();

  for (let t of raw){
    t = t.trim();
    if (!t) continue;
    if (t.length > 30) t = t.slice(0, 30);
    const k = t.toLowerCase();
    if (!seen.has(k)){
      seen.add(k);
      out.push(t);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function tagsToText(arr){
  return (Array.isArray(arr) && arr.length) ? arr.join(", ") : "";
}

function splitQueryTerms(q){
  return (q || "")
    .toString()
    .replace(/　/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

function matchAllTerms(hayLower, terms){
  if (!terms.length) return true;
  const h = hayLower || "";
  for (const t of terms){
    if (!h.includes(t)) return false;
  }
  return true;
}

function applyUserReplace(s){
  const name = (userNameText || "").trim();
  if (!name) return String(s || "");
  return String(s || "").replaceAll("$name$", name);
}

function flash(el){
  if (!el) return;

  el.classList.remove("flash");
  void el.offsetWidth; // reflow
  el.classList.add("flash");

  // タイマー重複を防ぐ
  clearTimeout(el._flashTm);
  el._flashTm = setTimeout(() => {
    el.classList.remove("flash");
    el._flashTm = null;
  }, 1000);
}

/* =========================
   Copy guard (BCP遷移などでの誤コピー防止)
   - suppressCopy(ms): 一定時間コピー操作を無効化
   - canCopyNow(): 現在コピー可能か
========================= */
let _suppressCopyUntil = 0;
let _copyArmed = true; // require a fresh user action after UI transitions

function clearSelection(){
  try{ const sel = window.getSelection && window.getSelection(); sel && sel.removeAllRanges && sel.removeAllRanges(); }catch(_){ }
}

function armCopy(){ _copyArmed = true; }
function disarmCopy(){ _copyArmed = false; }

// Temporarily block copy/flash (also disarms until next user action)
function suppressCopy(ms = 300){
  const t = Number(ms || 0) || 0;
  _suppressCopyUntil = Date.now() + Math.max(0, t);
  disarmCopy();
  clearSelection();
}

function canCopyNow(){
  return _copyArmed && Date.now() >= (_suppressCopyUntil || 0);
}

// A fresh user action re-arms copy. Use capture so it runs early.
document.addEventListener("pointerdown", armCopy, { capture:true, passive:true });
document.addEventListener("keydown", armCopy, { capture:true, passive:true });
document.addEventListener("dblclick", (e) => { if (!canCopyNow()) { e.preventDefault(); e.stopPropagation(); } }, { capture:true });



function scrollListTop(smooth=true){
  if (!listEl) return;
  listEl.scrollTo({ top: 0, left: 0, behavior: smooth ? "smooth" : "auto" });
}

async function copyText(text, elToFlash){
  if (!canCopyNow()) return;

  const t = (text || "").toString();
  if (!t) return;

  try{
    await navigator.clipboard.writeText(t);
  }catch(_){
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  // avoid lingering selection highlight
  clearSelection();

  flash(elToFlash);
}

function updateUserNameHighlight(){
  if (!userNameEl) return;
  const empty = !(userNameEl.value || "").trim();
  userNameEl.classList.toggle("reqEmpty", empty);
}



function plainMemo(m){
  return {
    id: String(m.id || ""),
    subj: String(m.subj || ""),
    body: String(m.body || ""),
    tags: Array.isArray(m.tags) ? m.tags.slice(0, 12) : [],
    ts: Number(m.ts || 0) || 0
  };
}

function plainTemplate(t){
  return {
    id: String(t.id || ""),
    subject: String(t.subject || t.subj || ""),
    body: String(t.body || ""),
    tags: Array.isArray(t.tags) ? t.tags.slice(0, 12) : [],
    lastUsed: Number(t.lastUsed || 0) || 0,
    ord: Number(t._ord || t.ord || 0) || 0
  };
}

function downloadTextFile(filename, text, mime="application/json"){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function ymd_hm(){
  const d = new Date();
  const z2 = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}${z2(d.getMonth()+1)}${z2(d.getDate())}_${z2(d.getHours())}${z2(d.getMinutes())}`;
}

function parseImportedTemplates(text){
  const t = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!t) throw new Error("ファイルが空です");
  const data = JSON.parse(t);

  let arr = null;
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === "object" && Array.isArray(data.templates)) arr = data.templates;
  else if (data && typeof data === "object" && Array.isArray(data.memos)) arr = data.memos;

  if (!Array.isArray(arr)) throw new Error("JSON配列（または {templates:[...]}）ではありません");

  const out = arr.map(normalizeTemplate);
  ensureTemplateOrd(out);
  return out;
}

function templateMergeKey(t){
  const id = String(t?.id || "").trim();
  if (id) return "id:" + id;
  return "subj:" + String(t?.subject || "").trim().toLowerCase();
}

async function exportMemos(){
  try{
    const isTpl  = (listTab === "tpl");
    const isCode = (listTab === "code");
    const items = isTpl ? (templates || []) : (isCode ? (state.codeMemos || []) : (state.memos || []));
    const kindJa = isTpl ? "テンプレ" : (isCode ? "コード" : "追加メモ");
    const fileStem = isTpl ? "templates" : (isCode ? "code" : "memos");

    const payload = isTpl
      ? {
          type: "ten-memo-templates",
          version: 1,
          exportedAt: Date.now(),
          templates: items.map(plainTemplate)
        }
      : {
          type: isCode ? "ten-memo-code" : "ten-memo-memos",
          version: 1,
          exportedAt: Date.now(),
          memos: items.map(plainMemo)
        };

    const text = JSON.stringify(payload, null, 2);
    const name = `ten-memo_${fileStem}_${ymd_hm()}.json`;

    if (window.showSaveFilePicker){
      try{
        const h = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
        });
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
        setMsg(`${kindJa}をエクスポート完了`);
        return;
      }catch(e){
        // fallthrough to download (cancel is common)
      }
    }

    downloadTextFile(name, text, "application/json");
    setMsg(`${kindJa}をエクスポート完了`);
  }catch(e){
    setMsg(`ERR: ${e?.message || e}`, true);
  }
}

async function pickJsonFile(){
  if (window.showOpenFilePicker){
    try{
      const [h] = await window.showOpenFilePicker({
        multiple:false,
        types:[{ description:"JSON", accept:{ "application/json":[".json"] } }]
      });
      if (!h) throw new Error("未選択");
      const f = await h.getFile();
      return await f.text();
    }catch(e){
      if (String(e?.name||"").includes("Abort")) return null;
      // fallthrough to <input>
    }
  }

  return await new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f){ resolve(null); return; }
      resolve(await f.text());
    };
    inp.click();
  });
}

function parseImportedMemos(text){
  const t = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!t) throw new Error("ファイルが空です");
  const data = JSON.parse(t);

  let arr = null;
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === "object" && Array.isArray(data.memos)) arr = data.memos;
  if (!Array.isArray(arr)) throw new Error("JSON配列（または {memos:[...]}）ではありません");

  const out = [];
  for (const x of arr){
    // accept either subj/body or subject/body
    const m = normalizeMemo({
      id: x?.id || uid(),
      subj: x?.subj ?? x?.subject ?? "",
      body: x?.body ?? "",
      tags: x?.tags ?? "",
      ts: x?.ts ?? 0
    });
    out.push(m);
  }
  return out;
}

async function importMemos(){
  try{
    const text = await pickJsonFile();
    if (text == null) return; // cancelled

    const isTpl  = (listTab === "tpl");
    const isCode = (listTab === "code");

    if (isTpl){
      const incoming = parseImportedTemplates(text);
      const hasExisting = (templates && templates.length > 0);
      let mode = "merge";
      if (hasExisting){
        const ok = confirm("既存のテンプレに『追加』しますか？\nOK=追加（マージ） / キャンセル=置換（上書き）");
        mode = ok ? "merge" : "replace";
      }else{
        mode = "replace";
      }

      if (mode === "replace"){
        templates = incoming.slice();
        ensureTemplateOrd(templates);
        selectedTplKey = "";
        tplSyncState = 1;
        tplLastErr = "";
        saveTplCache();
        clearEditorOnly();
        scheduleRender();
        setMsg(`テンプレをインポート完了（置換:${incoming.length}件）`);
        return;
      }

      const map = new Map();
      for (const t of templates){
        map.set(templateMergeKey(t), t);
      }
      let added = 0, updated = 0;
      for (const t of incoming){
        const key = templateMergeKey(t);
        const cur = map.get(key);
        if (!cur){
          templates.push(t);
          map.set(key, t);
          added++;
        }else{
          const idx = templates.findIndex(x => templateMergeKey(x) === key);
          if (idx >= 0) templates[idx] = normalizeTemplate({ ...cur, ...t });
          map.set(key, templates[idx]);
          updated++;
        }
      }
      ensureTemplateOrd(templates);
      tplSyncState = 1;
      tplLastErr = "";
      saveTplCache();
      clearEditorOnly();
      scheduleRender();
      setMsg(`テンプレをインポート完了（追加:${added} / 更新:${updated}）`);
      return;
    }

    const incoming = parseImportedMemos(text);
    const kindJa = isCode ? "コード" : "追加メモ";
    const target = isCode ? state.codeMemos : state.memos;

    const hasExisting = (target && target.length > 0);
    let mode = "merge";
    if (hasExisting){
      const ok = confirm(`既存の${kindJa}に『追加』しますか？\nOK=追加（マージ） / キャンセル=置換（上書き）`);
      mode = ok ? "merge" : "replace";
    }else{
      mode = "replace";
    }

    if (mode === "replace"){
      const replaced = incoming.sort((a,b) => (b.ts||0)-(a.ts||0));
      if (isCode){
        state.codeMemos = replaced;
        state.selectedCodeId = null;
      }else{
        state.memos = replaced;
        state.selectedId = null;
      }
      scheduleSaveState();
      clearEditorOnly();
      scheduleRender();
      setMsg(`${kindJa}をインポート完了（置換:${incoming.length}件）`);
      return;
    }

    const map = new Map();
    for (const m of target){
      map.set(m.id, m);
    }
    let added = 0, updated = 0;
    for (const m of incoming){
      const cur = map.get(m.id);
      if (!cur){
        target.push(m);
        map.set(m.id, m);
        added++;
      }else{
        const curTs = Number(cur.ts || 0) || 0;
        const inTs  = Number(m.ts || 0) || 0;
        if (inTs > curTs){
          const idx = target.findIndex(x => x.id === cur.id);
          if (idx >= 0) target[idx] = m;
          map.set(m.id, m);
          updated++;
        }
      }
    }
    target.sort((a,b) => (b.ts||0)-(a.ts||0));

    if (isCode) state.selectedCodeId = null;
    else state.selectedId = null;

    scheduleSaveState();
    clearEditorOnly();
    scheduleRender();
    setMsg(`${kindJa}をインポート完了（追加:${added} / 更新:${updated}）`);
  }catch(e){
    setMsg(`ERR: ${e?.message || e}`, true);
  }
}
function tagsContainAll(tagsLowerBlob, set){
  if (!set || set.size === 0) return true;
  const h = tagsLowerBlob || "";
  for (const t of set){
    if (!h.includes(" " + t + " ")) return false; // boundary match
  }
  return true;
}

function toggleTagFilter(tag){
  const raw = String(tag || "").trim();
  if (!raw) return;

  const k = raw.toLowerCase();
  if (tagFilters.has(k)){
    tagFilters.delete(k);
  }else{
    if (tagFilters.size >= MAX_TAG_FILTERS){
      setMsg(`タグは最大${MAX_TAG_FILTERS}件まで`, true);
      return;
    }
    tagFilters.add(k);
  }
}

window.addEventListener("error", (e) => setMsg(`ERR: ${e?.message || e}`, true));
window.addEventListener("unhandledrejection", (e) => setMsg(`ERR: ${e?.reason?.message || e?.reason || e}`, true));

/* tabs helpers */
function tabsEnabled(){
  return !!(tabTplEl && tabMemoEl);
}
function applyTabUI(){
  if (!tabsEnabled()) return;
  tabTplEl.classList.toggle("on", listTab === "tpl");
  tabMemoEl.classList.toggle("on", listTab === "memo");
  if (tabCodeEl) tabCodeEl.classList.toggle("on", listTab === "code");
  if (tabBcpEl) tabBcpEl.classList.toggle("on", listTab === "bcp");
}
function applyCodeEditorModeUI(){
  // Codeタブ廃止に伴い、コードエディタ表示は常にOFF
  const on = false;
  document.body.classList.toggle("codeEditorMode", false);
  if (btnCodeMode){
    btnCodeMode.classList.toggle("on", on);
    btnCodeMode.textContent = on ? "コードON" : "コード";
    btnCodeMode.title = on ? "コードエディタ風表示：ON" : "コードエディタ風表示を切替";
  }
  refreshAllLineNumbers();
}

function saveCodeEditorMode(){
  chrome.storage.local.set({ [CODE_MODE_KEY]: !!codeEditorMode }).catch(()=>{});
}

async function loadCodeEditorMode(){
  const d = await chrome.storage.local.get(CODE_MODE_KEY);
  codeEditorMode = !!d[CODE_MODE_KEY];
}

function getEditorRawTextForLineNumbers(el){
  try{
    if (!el) return "";
    if (typeof el.value === "string"){
      return String(el.value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    let text = "";
    try{
      text = String(el.innerText || "");
    }catch(_){
      text = "";
    }
    if (!text) text = String(el.textContent || "");

    return text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u00A0/g, " ")
      .replace(/\u200B/g, "");
  }catch(_){
    return "";
  }
}

function countEditorLogicalLines(el){
  try{
    const raw = getEditorRawTextForLineNumbers(el);
    if (!raw) return 1;
    return Math.max(1, String(raw).split("\n").length);
  }catch(_){
    return 1;
  }
}

function codeLineCount(el){
  try{
    const raw = getCodeText(el);
    return raw === "" ? 1 : raw.split("\n").length;
  }catch(_){
    return 1;
  }
}

function lineNumbersHtml(count){
  const n = Math.max(1, Number(count) || 1);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`<div class="ln">${i}</div>`);
  return out.join("");
}


function buildLineNumbersText(count){
  const n = Math.max(1, Number(count) || 1);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(String(i));
  return out.join("\n");
}

function syncLineNumberScroll(editorEl, gutterEl){
  if (!editorEl || !gutterEl) return;
  const top = Number(editorEl.scrollTop || 0) || 0;
  gutterEl.style.transform = `translateY(${-1 * top}px)`;
}

function updateLineNumbersFor(editorEl, gutterEl){
  if (!gutterEl) return;

  let count = 1;
  if (isCodeTab() && editorEl && typeof editorEl.value === "string"){
    count = codeLineCount(editorEl);
  }else{
    count = countEditorLogicalLines(editorEl);
  }

  const html = lineNumbersHtml(count);
  if (gutterEl.innerHTML !== html) gutterEl.innerHTML = html;
  syncLineNumberScroll(editorEl, gutterEl);
}

function scheduleLineNumberRefresh(editorEl, gutterEl){
  if (!editorEl || !gutterEl) return;
  updateLineNumbersFor(editorEl, gutterEl);
  try{
    requestAnimationFrame(() => updateLineNumbersFor(editorEl, gutterEl));
  }catch(_){}
  setTimeout(() => updateLineNumbersFor(editorEl, gutterEl), 0);
  setTimeout(() => updateLineNumbersFor(editorEl, gutterEl), 40);
}

function observeEditorLineNumbers(editorEl, gutterEl){
  try{
    if (!editorEl || !gutterEl || typeof MutationObserver === "undefined") return null;
    const obs = new MutationObserver(() => scheduleLineNumberRefresh(editorEl, gutterEl));
    obs.observe(editorEl, { childList:true, subtree:true, characterData:true });
    return obs;
  }catch(_){
    return null;
  }
}

function refreshAllLineNumbers(){
  const mainEl = isCodeTab() ? codeBodyEl : bodyEl;
  const modalEl = isCodeTab() ? codeModalEditorEl : bodyModalEditorEl;
  updateLineNumbersFor(mainEl, bodyLineNumbersEl);
  updateLineNumbersFor(modalEl, bodyModalLineNumbersEl);
}
function setTemplateMode(isTpl){
  document.body.classList.toggle("tplMode", !!isTpl);
}


function applyEditorReadonlyForTab(){
  const ro = (listTab === "tpl" || listTab === "bcp");
  document.body.classList.toggle("editorReadOnly", !!ro);

  if (subjEl){
    subjEl.readOnly = !!ro;
    subjEl.tabIndex = ro ? -1 : 0;
  }
  if (tagsEl){
    tagsEl.readOnly = !!ro;
    tagsEl.tabIndex = ro ? -1 : 0;
  }
  if (bodyEl){
    bodyEl.setAttribute("contenteditable", ro ? "false" : "true");
    bodyEl.tabIndex = ro ? -1 : 0;
  }
  if (bodyModalEditorEl){
    bodyModalEditorEl.setAttribute("contenteditable", ro ? "false" : "true");
    bodyModalEditorEl.tabIndex = ro ? -1 : 0;
  }
  if (codeBodyEl){
    codeBodyEl.readOnly = !!ro;
    codeBodyEl.tabIndex = ro ? -1 : 0;
  }
  if (codeModalEditorEl){
    codeModalEditorEl.readOnly = !!ro;
    codeModalEditorEl.tabIndex = ro ? -1 : 0;
  }
}

function syncListTabClass(){
  document.body.classList.toggle("listTabTpl", listTab === "tpl");
  document.body.classList.toggle("listTabMemo", listTab === "memo");
  document.body.classList.toggle("listTabCode", listTab === "code");
  document.body.classList.toggle("listTabBcp", listTab === "bcp");
  applyEditorReadonlyForTab();
}

function updateIoButtonsForTab(){
  if (!btnImport || !btnExport) return;
  let importLabel = "テンプレをインポート";
  let exportLabel = "テンプレをエクスポート";

  if (listTab === "memo"){
    importLabel = "追加メモをインポート";
    exportLabel = "追加メモをエクスポート";
  }else if (listTab === "code"){
    importLabel = "コードをインポート";
    exportLabel = "コードをエクスポート";
  }

  btnImport.title = importLabel;
  btnImport.setAttribute("aria-label", importLabel);
  btnExport.title = exportLabel;
  btnExport.setAttribute("aria-label", exportLabel);
}
function syncTplModeForContext(){
  // ★tabsがある時は「テンプレタブ=tplMode」を常時維持
  if (tabsEnabled()){
    setTemplateMode(listTab === "tpl");
  }
}
function clearOnTabSwitch(){
  try{
    if (subjEl) subjEl.value = "";
    setBodyFromText("");
    setCodeText(codeBodyEl, "");
    setCodeText(codeModalEditorEl, "");
    if (tagsEl) tagsEl.value = "";

    if (qEl) qEl.value = "";
    qText = "";
    tagFilters.clear();

    selectedTplKey = "";
    state.selectedId = null;
    state.selectedCodeId = null;

    try{ chrome.storage.local.remove([DRAFT_KEY, CODE_DRAFT_KEY]); }catch(_){}
    scheduleSaveState();

    editorManualOpen = (listTab === "memo");
    applyModeUI();
    syncTplModeForContext();
    applyEditorReadonlyForTab();
    refreshAllLineNumbers();
    scheduleEditorLayout();
  }catch(e){
    try{ setMsg(`ERR: ${e?.message || e}`, true); }catch(_){}
  }
}

function setListTab(next){
  // Codeタブは廃止。過去データ等で code が来た場合は Note に退避。
  const v = (next === "code") ? "memo" : ((next === "memo" || next === "bcp") ? next : "tpl");
  if (listTab === v) return;

  const prev = listTab;
  const involvesBcp = (prev === "bcp" || v === "bcp");
  if (v === "bcp" && prev !== "bcp"){
    bcpOriginTab = (prev === "memo") ? "memo" : "tpl";
  }
  const shouldClear =
    (prev === "tpl" && v === "memo") ||
    (prev === "memo" && v === "tpl") ||
    (prev === "bcp" && v !== "bcp" && v !== bcpOriginTab);

  // BCPを開く直前の入力を即時保存する。
  // タブ移動直前のキー入力がdebounce待ちでも、入力途中の内容を残せるようにする。
  if (involvesBcp){
    try{ saveEditorDraftNow(); }catch(_){}
  }

  // BCP→他タブ遷移直後に本文が意図せずコピーされることがあるため、短時間コピー抑止
  if (prev === "bcp" && v !== "bcp") suppressCopy(1200);
  else suppressCopy(350);

  listTab = v;
  applyTabUI();
  scheduleSaveListTab();

  try{
    window.dispatchEvent(new CustomEvent("tenmemo:listTab", {
      detail: { tab: v, previousTab: prev, preserved: involvesBcp }
    }));
  }catch(_){}

  syncListTabClass();
  updateIoButtonsForTab();

  // Temp⇔Noteは従来どおりクリア。
  // BCPから元のタブへ戻る場合は保持し、別タブへ移る場合は
  // BCPを挟まないTemp⇔Note切替と同じようにクリアする。
  if (shouldClear){
    clearOnTabSwitch();
  }else{
    applyModeUI();
    syncTplModeForContext();
    applyEditorReadonlyForTab();
    refreshAllLineNumbers();
    scheduleEditorLayout();
  }

  applyCodeEditorModeUI();

  // BCP遷移時は背面の一覧を再描画しないことで、表示位置もそのまま保持する。
  if (!involvesBcp) scheduleRender();
}


function canToggleEditorFromTab(){
  // 件名・本文スペースは常時表示のため、タブ押下では開閉しない
  return false;
}

function handleListTabClick(next){
  const v = (next === "memo" || next === "code" || next === "bcp") ? next : "tpl";
  const wasCompact = document.body.classList.contains("editorCompact");

  if (listTab !== v){
    setListTab(v);
  }else{
    suppressCopy(350);
  }

  // テンプレ/追加メモのタブ押下で、未選択・未入力時の入力スペース表示/非表示を切り替える
  if (v !== "bcp" && canToggleEditorFromTab()){
    editorManualOpen = wasCompact;
    updateEditorLayout();
  }

  scheduleRender();
}


// --- Data normalization ---
function buildMemoBlob(subj, body, tagsArr){
  const t = Array.isArray(tagsArr) ? tagsArr.join(" ") : String(tagsArr || "");
  return (String(subj || "") + "\n" + String(body || "") + "\n" + t).toLowerCase();
}

function normalizeTemplate(t){
  const tagsArr = Array.isArray(t.tags) ? t.tags
    : (t.tags ? parseTags(String(t.tags)) : []);
  const subject = normalizeText(t.subject || t.subj || "");
  const body = normalizeText(t.body || "");
  const lastUsed = Number(t.lastUsed || 0) || 0;
  const ord = Number(t._ord || t.ord || 0) || 0;

  const obj = {
    id: t.id ? String(t.id) : "",
    subject,
    body,
    tags: tagsArr,
    lastUsed,
    _ord: ord
  };
  obj._tagsLower = " " + tagsArr.map(x => String(x).toLowerCase()).join(" ") + " ";
  obj._subjKey = (obj.subject || "").trim().toLowerCase();
  obj._blob = buildMemoBlob(obj.subject, obj.body, obj.tags);
  return obj;
}

function normalizeMemo(m){
  const tagsArr = Array.isArray(m.tags) ? m.tags
    : (m.tags ? parseTags(String(m.tags)) : []);
  const obj = {
    id: String(m.id || uid()),
    subj: normalizeText(m.subj || m.subject || ""),
    body: normalizeText(m.body || ""),
    tags: tagsArr,
    ts: Number(m.ts || 0) || 0
  };
  obj._tagsLower = " " + tagsArr.map(x => String(x).toLowerCase()).join(" ") + " ";
  obj._subjKey = (obj.subj || "").trim().toLowerCase();
  obj._blob = buildMemoBlob(obj.subj, obj.body, obj.tags);
  return obj;
}

// --- Storage ---
async function loadState(){
  const d = await chrome.storage.local.get(STORE_KEY);
  const saved = d[STORE_KEY];
  if (!saved || !Array.isArray(saved.memos)) return;

  const memos = saved.memos.map(normalizeMemo);
  const legacyCodeMemos = Array.isArray(saved.codeMemos)
    ? saved.codeMemos.map(normalizeMemo)
    : [];

  // Codeタブ廃止前のデータはNoteへ安全に移行する。
  if (legacyCodeMemos.length){
    const byId = new Map(memos.map((memo) => [memo.id, memo]));
    for (const memo of legacyCodeMemos){
      const current = byId.get(memo.id);
      if (!current || (memo.ts || 0) > (current.ts || 0)) byId.set(memo.id, memo);
    }
    memos.splice(0, memos.length, ...Array.from(byId.values()).sort((a, b) => (b.ts || 0) - (a.ts || 0)));
  }

  const legacySelectedId = String(saved.selectedCodeId || "");
  state = {
    memos,
    selectedId: saved.selectedId || (legacySelectedId && memos.some((memo) => memo.id === legacySelectedId) ? legacySelectedId : null),
    codeMemos: [],
    selectedCodeId: null
  };

  if (legacyCodeMemos.length || saved.selectedCodeId){
    await chrome.storage.local.set({ [STORE_KEY]: state }).catch(() => {});
  }
}

async function loadTplCache(){
  const d = await chrome.storage.local.get(TPL_CACHE_KEY);
  const arr = d[TPL_CACHE_KEY];
  templates = Array.isArray(arr) ? arr.map(normalizeTemplate) : [];
  ensureTemplateOrd(templates);
}

async function loadUserName(){
  const d = await chrome.storage.local.get(USER_NAME_KEY);
  userNameText = (d[USER_NAME_KEY] || "").toString();
  if (userNameEl) userNameEl.value = userNameText;
}

async function loadNameEditMode(){
  const d = await chrome.storage.local.get(NAME_EDIT_KEY);
  nameEditOn = !!d[NAME_EDIT_KEY];
}

async function loadListTab(){
  const d = await chrome.storage.local.get(LIST_TAB_KEY);
  const v = (d[LIST_TAB_KEY] || "").toString();
  // Codeタブは廃止。過去保存が code の場合は Note で起動。
  listTab = (v === "code") ? "memo" : ((v === "memo" || v === "bcp") ? v : "tpl");
}

async function loadSortMode(){
  // 並び替え切替は廃止し、最近選択した順で固定
  sortMode = "recent";
  if (sortEl) sortEl.value = sortMode;
  chrome.storage.local.set({ [SORT_KEY]: sortMode }).catch(()=>{});
}

// --- Persisted handles (IndexedDB) ---
async function getTplHandle(){
  if (tplHandleSession) return tplHandleSession;

  // Prefer IndexedDB (persisted)
  try{
    const h = await idbGet(TPL_HANDLE_IDB_KEY);
    if (h) return h;
  }catch(_){/* noop */}

  // Legacy migrate (chrome.storage)
  try{
    const d = await chrome.storage.local.get(TPL_FILE_KEY);
    const h = d[TPL_FILE_KEY] || null;
    if (h){
      try{ await idbSet(TPL_HANDLE_IDB_KEY, h); }catch(_){/* noop */}
      chrome.storage.local.remove(TPL_FILE_KEY).catch(()=>{});
    }
    return h;
  }catch(_){
    return null;
  }
}

async function setTplHandle(h){
  // showOpenFilePicker の FileSystemFileHandle は IndexedDB に保存できる
  try{
    await idbSet(TPL_HANDLE_IDB_KEY, h);
    tplHandleSession = null;
  }catch(_){
    // fallback (non-persistent)
    tplHandleSession = h;
  }
}

async function getTplDirHandle(){
  if (tplDirHandleSession) return tplDirHandleSession;
  try{
    const h = await idbGet(TPL_DIR_IDB_KEY);
    if (h) return h;
  }catch(_){/* noop */}
  return null;
}

async function setTplDirHandle(h){
  // DirectoryHandleもIndexedDBに保存できる(Chromium)
  // null のときは「未設定」に戻す
  if (!h){
    tplDirHandleSession = null;
    try{ await idbSet(TPL_DIR_IDB_KEY, null); }catch(_){/* noop */}
    return;
  }
  try{
    await idbSet(TPL_DIR_IDB_KEY, h);
    tplDirHandleSession = null;
  }catch(_){
    // fallback (non-persistent)
    tplDirHandleSession = h;
  }
}

async function ensureFsPermission(handle, interactive){
  if (!handle || typeof handle.queryPermission !== "function") return true;
  try{
    let perm = await handle.queryPermission({ mode: "read" });
    if (perm !== "granted" && interactive && perm === "prompt" && typeof handle.requestPermission === "function"){
      perm = await handle.requestPermission({ mode: "read" });
    }
    return perm === "granted";
  }catch(_){
    return false;
  }
}

async function findTemplateJsonInDir(dir){
  const curName = String((tplMeta && tplMeta.name) ? tplMeta.name : "").trim();
  if (curName){
    try{ await dir.getFileHandle(curName, { create:false }); return curName; }catch(_){/* noop */}
  }

  const common = ["templates.json", "template.json", "テンプレート.json", "テンプレ.json"];
  for (const n of common){
    try{ await dir.getFileHandle(n, { create:false }); return n; }catch(_){/* noop */}
  }

  const cands = [];
  try{
    for await (const [name, h] of dir.entries()){
      if (h && h.kind === "file" && String(name).toLowerCase().endsWith(".json")) cands.push(String(name));
    }
  }catch(_){/* noop */}

  if (cands.length === 1) return cands[0];
  if (cands.length === 0) throw new Error("フォルダ内に .json が見つかりません");
  throw new Error("フォルダ内の .json が複数あります。ファイル名を templates.json にするか、1つに絞ってください。");
}

async function loadTplMeta(){
  const d = await chrome.storage.local.get(TPL_META_KEY);
  const m = d[TPL_META_KEY];
  if (m && typeof m === "object"){
    tplMeta = {
      name: String(m.name || ""),
      lastModified: Number(m.lastModified || 0) || 0,
      size: Number(m.size || 0) || 0
    };
  }
}

async function setTplMeta(meta){
  tplMeta = {
    name: String(meta?.name || ""),
    lastModified: Number(meta?.lastModified || 0) || 0,
    size: Number(meta?.size || 0) || 0
  };
  chrome.storage.local.set({ [TPL_META_KEY]: tplMeta }).catch(()=>{});
}

function saveNameEditMode(v){
  nameEditOn = !!v;
  return chrome.storage.local.set({ [NAME_EDIT_KEY]: nameEditOn });
}

// --- UI state ---
function applyModeUI(){
  const selId = getActiveSelectedId();
  btnAdd.textContent = selId ? "上書き" : "追加";
  btnDelete.disabled = !selId;
  applyEditorReadonlyForTab();
}

function applyNameEditUI(){
  if (!userNameEl) return;
  const on = !!nameEditOn;
  userNameEl.readOnly = !on;
  userNameEl.tabIndex = on ? 0 : -1;

  if (btnNameEdit){
    btnNameEdit.classList.toggle("on", on);
    btnNameEdit.title = on ? "氏名の編集：ON" : "氏名の編集：OFF";
  }

  if (on){
    userNameEl.focus();
    userNameEl.select();
  }
}

// --- Actions ---
function clearUI(){
  subjEl.value = "";
  setBodyFromText("");
  setCodeText(codeBodyEl, "");
  setCodeText(codeModalEditorEl, "");
  if (tagsEl) tagsEl.value = "";

  qEl.value = "";
  qText = "";
  tagFilters.clear();
  selectedTplKey = "";

  setActiveSelectedId(null);
  scheduleSaveState();
  clearEditorDraft();
  applyModeUI();

  // ★タブに応じてtplModeを同期
  syncTplModeForContext();

  // Note / Code の下部「クリア」ボタンは、入力欄を閉じずにそのまま空欄表示を維持。
  // 検索欄横の×ボタンは clearEditorOnly() 側なので、従来通り閉じる。
  editorManualOpen = (listTab === "memo" || listTab === "code");
  scheduleEditorLayout();
  scheduleRender();
}

function clearUIForTag(){
  // タグ絞り込み時：誤操作防止のため「クリア」と同等にリセットするが、
  // クリックしたタグは toggleTagFilter() 側で保持されている前提
  subjEl.value = "";
  setBodyFromText("");
  setCodeText(codeBodyEl, "");
  setCodeText(codeModalEditorEl, "");
  if (tagsEl) tagsEl.value = "";

  if (qEl) qEl.value = "";
  qText = "";

  selectedTplKey = "";
  setActiveSelectedId(null);
  scheduleSaveState();
  clearEditorDraft();
  applyModeUI();

  // ★タブに応じてtplModeを同期
  syncTplModeForContext();

  editorManualOpen = false;
  scheduleEditorLayout();
  scheduleRender();
}

function clearEditorOnly(){
  subjEl.value = "";
  setBodyFromText("");
  setCodeText(codeBodyEl, "");
  setCodeText(codeModalEditorEl, "");
  if (tagsEl) tagsEl.value = "";
  setActiveSelectedId(null);
  scheduleSaveState();
  clearEditorDraft();
  selectedTplKey = "";
  applyModeUI();

  // ★タブに応じてtplModeを同期（テンプレタブでは常時非表示維持）
  syncTplModeForContext();

  editorManualOpen = false;
  scheduleEditorLayout();
}

function setSelection(id){
  setActiveSelectedId(id);
  selectedTplKey = "";
  const arr = getActiveItems();
  const m = arr.find(x => x.id === id);
  if (m){
    const now = Date.now();
    m.ts = now; // use time
    subjEl.value = normalizeText(m.subj || "");
    setBodyFromText(normalizeText(m.body || ""));
    if (tagsEl) tagsEl.value = tagsToText(m.tags);
    m._blob = buildMemoBlob(m.subj, m.body, m.tags);
  }
  applyModeUI();
  editorManualOpen = true;
  scheduleEditorLayout();
  scheduleSaveState();
  saveEditorDraftNow();

  // memo選択時は、tabs無し運用のためにtplMode解除
  if (!tabsEnabled()) setTemplateMode(false);

  scheduleRender();
}

function upsertMemo(){
  if (listTab === "tpl" || listTab === "bcp"){
    setMsg(listTab === "tpl" ? "テンプレは編集不可です" : "BCP表示中は編集できません");
    return;
  }
  const s = subjEl.value.trim();
  const b = getBodyText().trim();
  const tg = tagsEl ? parseTags(tagsEl.value) : [];
  if (!s && !b){
    setMsg("空です");
    return;
  }

  const arr = isCodeTab() ? state.codeMemos : state.memos;
  const selId = getActiveSelectedId();
  const now = Date.now();

  if (selId){
    const i = arr.findIndex(x => x.id === selId);
    if (i >= 0){
      const cur = arr[i];
      const upd = normalizeMemo({ ...cur, subj: s, body: b, tags: tg, ts: now });
      arr[i] = upd;
    }
    setMsg("上書き");
  }else{
    const m = normalizeMemo({ id: uid(), subj: s, body: b, tags: tg, ts: now });
    arr.unshift(m);
    setMsg("追加");
  }

  scheduleSaveState();
  clearEditorOnly();
  scheduleRender();
}

function deleteSelected(){
  if (listTab === "tpl" || listTab === "bcp"){
    setMsg(listTab === "tpl" ? "テンプレは削除不可です" : "BCP表示中は削除できません");
    return;
  }
  const selId = getActiveSelectedId();
  if (!selId) return;
  if (isCodeTab()){
    state.codeMemos = state.codeMemos.filter(x => x.id !== selId);
    state.selectedCodeId = null;
  }else{
    state.memos = state.memos.filter(x => x.id !== selId);
    state.selectedId = null;
  }
  scheduleSaveState();
  clearEditorOnly();
  scheduleRender();
  setMsg("削除");
}

// --- Filtering / tags ---
function getTopTags(limit=8){
  const counts = new Map(); // lower -> {tag, score}
  const addTag = (tag, w=1) => {
    const t = String(tag || "").trim();
    if (!t) return;
    const k = t.toLowerCase();
    const cur = counts.get(k);
    counts.set(k, { tag: cur ? cur.tag : t, score: (cur ? cur.score : 0) + w });
  };

  const now = Date.now();

  // templates (recent bonus within ~2 weeks, up to +2)
  for (const t of templates){
    const age = Math.max(0, now - (t.lastUsed || 0));
    const bonus = t.lastUsed ? Math.max(0, 2 - age / (1000*60*60*24*7)) : 0;
    const w = 1 + bonus;
    for (const x of (t.tags || [])) addTag(x, w);
  }

  // memos (recent bonus within ~2 weeks, up to +2)
  for (const m of state.memos){
    const age = Math.max(0, now - (m.ts || 0));
    const bonus = m.ts ? Math.max(0, 2 - age / (1000*60*60*24*7)) : 0;
    const w = 1 + bonus;
    for (const x of (m.tags || [])) addTag(x, w);
  }

  return Array.from(counts.values())
    .sort((a,b) => b.score - a.score || a.tag.localeCompare(b.tag, "ja"))
    .slice(0, limit)
    .map(x => x.tag);
}

function renderFavTags(){
  if (!favTagsEl) return;
  const top = getTopTags(8);
  if (!top.length){
    favTagsEl.innerHTML = "";
    return;
  }

  favTagsEl.innerHTML = top.map(t => {
    const sel = tagFilters.has(String(t).toLowerCase());
    const tEsc = escapeHtml(String(t));
    return `<button type="button" class="favTag${sel ? " sel" : ""}" data-tag="${tEsc}" title="タグで絞り込み">#${tEsc}</button>`;
  }).join("");
}

function tplKey(t){
  const id = t && t.id ? String(t.id) : "";
  if (id) return "tpl:" + id;

  const s = (t?.subject || "") + "\n" + (t?.body || "");
  let h = 0;
  for (let i = 0; i < s.length; i++){
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return "tplh:" + String(h);
}

function ensureTemplateOrd(arr){
  if (!Array.isArray(arr) || !arr.length) return;
  let max = 0;
  for (const t of arr){
    const o = Number(t._ord || 0) || 0;
    if (o > max) max = o;
  }
  for (const t of arr){
    const o = Number(t._ord || 0) || 0;
    if (!o){
      max += 1;
      t._ord = max;
    }
  }
}

// Keep "lastUsed" / stable order across JSON reloads.
function mergeTemplateUsage(oldArr, freshArr){
  if (!Array.isArray(freshArr)) return [];
  if (!freshArr.length) return freshArr;

  const map = new Map(); // tkey -> {lastUsed, ord}
  let maxOrd = 0;

  if (Array.isArray(oldArr) && oldArr.length){
    for (const t of oldArr){
      const k = tplKey(t);
      const lu = Number(t.lastUsed || 0) || 0;
      const ord = Number(t._ord || 0) || 0;
      if (ord > maxOrd) maxOrd = ord;

      const cur = map.get(k);
      if (!cur){
        map.set(k, { lastUsed: lu, ord });
      }else{
        if (lu > cur.lastUsed) cur.lastUsed = lu;
        if (ord > cur.ord) cur.ord = ord;
      }
    }
  }

  let nextOrd = maxOrd;
  for (const t of freshArr){
    const k = tplKey(t);
    const prev = map.get(k);
    if (prev){
      const luNow = Number(t.lastUsed || 0) || 0;
      if (prev.lastUsed > luNow) t.lastUsed = prev.lastUsed;
      if (prev.ord && !(Number(t._ord || 0) || 0)) t._ord = prev.ord;
    }
    if (!(Number(t._ord || 0) || 0)){
      nextOrd += 1;
      t._ord = nextOrd;
    }
  }

  return freshArr;
}

function filterTemplates(terms){
  return templates.filter(t => {
    const okQ = matchAllTerms(t._blob, terms);
    const okT = tagsContainAll(t._tagsLower, tagFilters);
    return okQ && okT;
  });
}

function filterMemos(terms){
  return state.memos.filter(m => {
    const okQ = matchAllTerms(m._blob, terms);
    const okT = tagsContainAll(m._tagsLower, tagFilters);
    return okQ && okT;
  });
}

function filterCodeMemos(terms){
  return state.codeMemos.filter(m => {
    const okQ = matchAllTerms(m._blob, terms);
    const okT = tagsContainAll(m._tagsLower, tagFilters);
    return okQ && okT;
  });
}

// --- Render ---
function render(){
  const terms = splitQueryTerms((qText || "").trim());
  const parts = [];

  if (listTab === "bcp") {
    listEl.innerHTML = "";
    return;
  }

  if (listTab === "tpl") {
    const items = filterTemplates(terms);
    items.sort((a, b) =>
      (b.lastUsed || 0) - (a.lastUsed || 0) ||
      (a._ord || 0) - (b._ord || 0)
    );

    if (tplSyncState !== 1 && !templates.length) {
      const title = tplSyncState === -2
        ? "テンプレ読み込み失敗（クリックで再設定）"
        : "クリックしてテンプレートを読み込んでください";
      const detail = tplLastErr
        ? `<div class="cardBody" style="max-height:none;opacity:.75;">${escapeHtml(tplLastErr)}</div>`
        : "";
      parts.push(`<div class="card tplSetup" data-action="pickTpl"><span class="cardSubj">${escapeHtml(title)}</span>${detail}</div>`);
    }

    if (!items.length) {
      parts.push(`<div class="card emptyMsg">${templates.length ? "該当なし" : "テンプレ未読込"}</div>`);
    } else {
      for (const t of items) {
        const key = tplKey(t);
        const subj = applyUserReplace((t.subject || "").trim()) || "（無題）";
        const body = applyUserReplace(t.body || "");
        const chips = renderTagChips(t.tags);
        parts.push(
          `<div class="card${selectedTplKey === key ? " sel" : ""}" data-tpl="1" data-tkey="${escapeHtml(key)}">
            <span class="cardSubj">${escapeHtml(subj)}</span>
            <div class="cardBody">${renderBodyHtml(body)}</div>
            ${chips}
          </div>`
        );
      }
    }
  } else {
    const items = filterMemos(terms);
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));

    if (!items.length) {
      parts.push(`<div class="card emptyMsg">${state.memos.length ? "該当なし" : "追加メモなし"}</div>`);
    } else {
      for (const m of items) {
        const subj = (m.subj || "").trim() || "（無題）";
        parts.push(
          `<div class="card${m.id === state.selectedId ? " sel" : ""}" data-id="${escapeHtml(m.id)}">
            <span class="cardSubj">${escapeHtml(subj)}</span>
            <div class="cardBody">${renderBodyHtml(m.body || "")}</div>
            ${renderTagChips(m.tags)}
          </div>`
        );
      }
    }
  }

  listEl.innerHTML = parts.join("");
  renderFavTags();
  scheduleEditorLayout();
}

function renderTagChips(tags){
  if (!Array.isArray(tags) || !tags.length) return "";
  const chips = tags.map((tag) => {
    const text = String(tag);
    const selected = tagFilters.has(text.toLowerCase());
    const escaped = escapeHtml(text);
    return `<span class="chip${selected ? " sel" : ""}" data-tag="${escaped}">#${escaped}</span>`;
  }).join("");
  return `<div class="chips">${chips}</div>`;
}

// --- Templates loading (auto-sync) ---
async function pickTemplatesJsonHandle(){
  if (window.showOpenFilePicker){
    try{
      const [h] = await window.showOpenFilePicker({
        multiple:false,
        types:[{ description:"templates.json", accept:{ "application/json":[".json"] } }]
      });
      return h;
    }catch(_){/* noop */}
  }

  // Fallback: <input type="file">
  return await new Promise((resolve, reject) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return reject(new Error("未選択"));
      resolve({ getFile: async () => f });
    };
    inp.click();
  });
}

async function readTemplatesFromFile(file){
  let text = await file.text();
  text = text.replace(/^\uFEFF/, "").trim();
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("JSON配列ではありません");
  return data.map(normalizeTemplate);
}

async function refreshTemplates(opts={}){
  if (_tplRefreshP) return _tplRefreshP;

  _tplRefreshP = (async () => {
    const { force=false, silent=false, interactive=false } = opts || {};
    const hadCache = Array.isArray(templates) && templates.length > 0;

    try{
      const dir = await getTplDirHandle().catch(() => null);
      const fileHandle = await getTplHandle().catch(() => null);
      const configured = !!(dir || fileHandle);

      if (!configured){
        if (!hadCache){
          tplSyncState = -1;
          tplLastErr = "";
          if (!silent) scheduleRender();
        }else{
          tplSyncState = 1;
        }
        return false;
      }

      let h = null;
      let permDenied = false;

      if (fileHandle){
        const ok = await ensureFsPermission(fileHandle, interactive);
        if (ok){
          h = fileHandle;
          permDenied = false;
        }else{
          permDenied = true;
        }
      }

      if (!h && dir){
        const ok = await ensureFsPermission(dir, interactive);
        if (!ok){
          permDenied = true;
        }else{
          try{
            const fname = await findTemplateJsonInDir(dir);
            if (!tplMeta || tplMeta.name !== fname){
              tplMeta = { name: fname, lastModified: Number(tplMeta?.lastModified||0)||0, size: Number(tplMeta?.size||0)||0 };
              await setTplMeta(tplMeta).catch(()=>{});
            }
            h = await dir.getFileHandle(fname, { create:false });
          }catch(e){
            const err = e?.message || String(e);
            tplLastErr = err;
            if (hadCache){
              tplSyncState = 1;
              return false;
            }
            tplSyncState = -2;
            if (!silent) scheduleRender();
            return false;
          }
        }
      }

      if (!h){
        if (!hadCache){
          tplSyncState = -2;
          tplLastErr = permDenied ? "権限が未許可です（クリックで再設定）" : "テンプレの参照先が不明です（クリックで再設定）";
          if (!silent) scheduleRender();
        }else{
          tplSyncState = 1;
        }
        return false;
      }

      if (!silent && !hadCache){
        tplSyncState = 0;
        tplLastErr = "";
        scheduleRender();
      }

      const file = await h.getFile();
      const meta = { name: file.name, lastModified: file.lastModified, size: file.size };

      if (!force && tplMeta &&
        meta.lastModified === tplMeta.lastModified &&
        meta.size === tplMeta.size &&
        meta.name === tplMeta.name
      ){
        tplSyncState = 1;
        return false;
      }

      const arr = await readTemplatesFromFile(file);
      templates = mergeTemplateUsage(templates, arr);
      ensureTemplateOrd(templates);
      tplMeta = meta;
      await setTplMeta(meta);
      saveTplCache();

      tplSyncState = 1;
      tplLastErr = "";
      scheduleRender();
      return true;

    }catch(e){
      const err = e?.message || String(e);
      tplLastErr = err;

      if (hadCache){
        tplSyncState = 1;
        return false;
      }

      tplSyncState = -2;
      if (!silent) scheduleRender();
      return false;

    }finally{
      _tplRefreshP = null;
    }
  })();

  return _tplRefreshP;
}

async function configureTemplatesSource(){
  try{
    const h = await pickTemplatesJsonHandle();
    if (h && typeof h === "object"){
      if (h.kind === "file") await setTplHandle(h);
      else tplHandleSession = h;
    }
    await setTplDirHandle(null);

    tplMeta = { name: "", lastModified: 0, size: 0 };
    chrome.storage.local.remove(TPL_META_KEY).catch(()=>{});
    tplSyncState = 0;
    tplLastErr = "";
    await refreshTemplates({ force:true, interactive:true });
    scheduleRender();
  }catch(e){
    tplSyncState = -2;
    tplLastErr = (e?.message || String(e || "")).slice(0, 200);
    scheduleRender();
  }
}

function afterCodeInput(el, gutterEl, syncToMain=false){
  if (!el) return;
  normalizeCodeTextareaHalfWidth(el);
  if (syncToMain) setCodeText(codeBodyEl, getCodeText(codeModalEditorEl));
  openEditorForInput();
  scheduleSaveEditorDraft();
  scheduleEditorLayout();
  updateLineNumbersFor(el, gutterEl);
  try{ requestAnimationFrame(() => updateLineNumbersFor(el, gutterEl)); }catch(_){}
}

function insertIntoCodeTextarea(el, text){
  if (!el) return false;
  const s = String(text || "");
  const start = Number(el.selectionStart ?? el.value.length);
  const end = Number(el.selectionEnd ?? start);
  try{
    el.setRangeText(s, start, end, "end");
  }catch(_){
    el.value = el.value.slice(0, start) + s + el.value.slice(end);
    const pos = start + s.length;
    try{ el.setSelectionRange(pos, pos); }catch(_){}
  }
  const isModal = (el === codeModalEditorEl);
  afterCodeInput(el, isModal ? bodyModalLineNumbersEl : bodyLineNumbersEl, isModal);
  return true;
}

function handleCodeTextareaKeydown(e, isModal=false){
  const el = e?.currentTarget || null;
  if (!el) return;

  if (isModal && e.key === "Escape"){
    e.preventDefault();
    closeBodyModal();
    return;
  }

  const atEnd = (el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
  if (e.key === "ArrowDown" && atEnd){
    e.preventDefault();
    insertIntoCodeTextarea(el, "\n");
    return;
  }
  if (e.key === "ArrowRight" && atEnd){
    e.preventDefault();
    insertIntoCodeTextarea(el, " ");
  }
}


// --- Events ---
function wireEvents(){
  if (tabsEnabled()){
    tabTplEl.addEventListener("click", () => handleListTabClick("tpl"));
    tabMemoEl.addEventListener("click", () => handleListTabClick("memo"));
    if (tabBcpEl) tabBcpEl.addEventListener("click", () => handleListTabClick("bcp"));
    applyTabUI();
  }

  btnAdd.addEventListener("click", upsertMemo);
  btnDelete.addEventListener("click", deleteSelected);
  btnClear.addEventListener("click", clearUI);
  if (btnLayoutMode) btnLayoutMode.addEventListener("click", togglePanelLayoutMode);

  if (editorEl){
    editorEl.addEventListener("focusin", openEditorForInput);
    editorEl.addEventListener("focusout", collapseEditorIfEmptySoon);
  }

  if (btnBodyExpand) btnBodyExpand.addEventListener("click", openBodyModal);
  if (btnCodeMode) btnCodeMode.addEventListener("click", () => {
    suppressCopy(350);
    applyCodeEditorModeUI();
  });
  if (btnBodyModalClose) btnBodyModalClose.addEventListener("click", closeBodyModal);
  if (btnBodyModalApply) btnBodyModalApply.addEventListener("click", closeBodyModal);
  // 拡大編集はEscキーで閉じる運用にするため、背景クリックでは閉じない
  // if (bodyModalBackdropEl) bodyModalBackdropEl.addEventListener("click", closeBodyModal);
  if (bodyModalEditorEl){
    bodyModalEditorEl.addEventListener("beforeinput", handleHalfWidthBeforeInput);
    bodyModalEditorEl.addEventListener("compositionend", () => setTimeout(() => {
      normalizeEditorHalfWidthIfNeeded(bodyModalEditorEl);
      syncBodyModalToMain();
      scheduleLineNumberRefresh(bodyModalEditorEl, bodyModalLineNumbersEl);
    }, 0));
    bodyModalEditorEl.addEventListener("input", () => {
      normalizeEditorHalfWidthIfNeeded(bodyModalEditorEl);
      syncBodyModalToMain();
      scheduleSaveEditorDraft();
      scheduleLineNumberRefresh(bodyModalEditorEl, bodyModalLineNumbersEl);
    });
    bodyModalEditorEl.addEventListener("scroll", () => syncLineNumberScroll(bodyModalEditorEl, bodyModalLineNumbersEl));
    bodyModalEditorEl.addEventListener("paste", () => setTimeout(() => {
      scheduleSaveEditorDraft();
      scheduleLineNumberRefresh(bodyModalEditorEl, bodyModalLineNumbersEl);
    }, 0));
    bodyModalEditorEl.addEventListener("paste", handleBodyPaste);
    bodyModalEditorEl.addEventListener("click", (e) => {
      const a = e.target.closest("a.rtLink, a[data-url]");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      scheduleOpenUrl(a.dataset.url || a.getAttribute("href") || "");
    });
    bodyModalEditorEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape"){
        e.preventDefault();
        closeBodyModal();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter"){
        e.preventDefault();
        closeBodyModal();
        return;
      }
      handleCodeEditorArrowKey(e);
      setTimeout(() => scheduleLineNumberRefresh(bodyModalEditorEl, bodyModalLineNumbersEl), 0);
    });
  }

  if (codeBodyEl){
    codeBodyEl.addEventListener("input", () => afterCodeInput(codeBodyEl, bodyLineNumbersEl, false));
    codeBodyEl.addEventListener("scroll", () => syncLineNumberScroll(codeBodyEl, bodyLineNumbersEl));
    codeBodyEl.addEventListener("keydown", (e) => handleCodeTextareaKeydown(e, false));
    codeBodyEl.addEventListener("paste", () => setTimeout(() => afterCodeInput(codeBodyEl, bodyLineNumbersEl, false), 0));
  }
  if (codeModalEditorEl){
    codeModalEditorEl.addEventListener("input", () => afterCodeInput(codeModalEditorEl, bodyModalLineNumbersEl, true));
    codeModalEditorEl.addEventListener("scroll", () => syncLineNumberScroll(codeModalEditorEl, bodyModalLineNumbersEl));
    codeModalEditorEl.addEventListener("keydown", (e) => handleCodeTextareaKeydown(e, true));
    codeModalEditorEl.addEventListener("paste", () => setTimeout(() => afterCodeInput(codeModalEditorEl, bodyModalLineNumbersEl, true), 0));
  }

  subjEl.addEventListener("input", () => { openEditorForInput(); scheduleSaveEditorDraft(); scheduleEditorLayout(); });
  if (tagsEl) tagsEl.addEventListener("input", () => { openEditorForInput(); scheduleSaveEditorDraft(); scheduleEditorLayout(); });
  bodyEl.addEventListener("beforeinput", handleHalfWidthBeforeInput);
  bodyEl.addEventListener("compositionend", () => setTimeout(() => {
    normalizeEditorHalfWidthIfNeeded(bodyEl);
    scheduleLineNumberRefresh(bodyEl, bodyLineNumbersEl);
  }, 0));
  bodyEl.addEventListener("input", () => {
    openEditorForInput();
    normalizeEditorHalfWidthIfNeeded(bodyEl);
    scheduleSaveEditorDraft();
    scheduleEditorLayout();
    scheduleLineNumberRefresh(bodyEl, bodyLineNumbersEl);
  });
  bodyEl.addEventListener("scroll", () => syncLineNumberScroll(bodyEl, bodyLineNumbersEl));
  bodyEl.addEventListener("keydown", (e) => {
    handleCodeEditorArrowKey(e);
    setTimeout(() => scheduleLineNumberRefresh(bodyEl, bodyLineNumbersEl), 0);
  });
  bodyEl.addEventListener("paste", () => setTimeout(() => {
    openEditorForInput();
    scheduleSaveEditorDraft();
    scheduleEditorLayout();
    scheduleLineNumberRefresh(bodyEl, bodyLineNumbersEl);
  }, 0));

  window.addEventListener("pagehide", saveEditorDraftNow);
  window.addEventListener("beforeunload", saveEditorDraftNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveEditorDraftNow();
  });

  if (btnExport) btnExport.addEventListener("click", exportMemos);
  if (btnImport) btnImport.addEventListener("click", importMemos);

  // Tempの件名はダブルクリックでコピーするため、2回目の押下で
  // input内の文字が選択されてEdgeのミニメニューが開くのを防ぐ。
  subjEl.addEventListener("mousedown", (e) => {
    if (listTab === "tpl" && e.button === 0 && e.detail >= 2){
      e.preventDefault();
      clearSelection();
    }
  });
  subjEl.addEventListener("dblclick", (e) => {
    if (!canCopyNow()) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault();
    clearSelection();
    try{
      const pos = Number.isInteger(subjEl.selectionEnd) ? subjEl.selectionEnd : subjEl.value.length;
      subjEl.setSelectionRange(pos, pos);
    }catch(_){}
    copyText(subjEl.value, subjEl);
  });
  bodyEl.addEventListener("dblclick", (e) => { if (!canCopyNow()) { e.preventDefault(); e.stopPropagation(); return; } e.preventDefault(); cancelOpenUrl(); clearSelection(); copyText(getBodyText(), bodyEl); });

  // URL貼り付け：本文内でリンク化（タイトルは非同期で取得して差し替え）
  if (bodyEl && typeof bodyEl.value !== "string"){
    bodyEl.addEventListener("paste", handleBodyPaste);
    bodyEl.addEventListener("click", (e) => {
      const a = e.target.closest("a.rtLink, a[data-url]");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      scheduleOpenUrl(a.dataset.url || a.getAttribute("href") || "");
    });
  }

  if (userNameEl){
    userNameEl.addEventListener("input", () => {
      userNameText = (userNameEl.value || "").toString();
      scheduleSaveUserName();
      updateUserNameHighlight();
      scheduleRender();
    });
  }

  if (btnNameEdit){
    btnNameEdit.addEventListener("click", () => {
      saveNameEditMode(!nameEditOn).then(applyNameEditUI).catch(() => {});
    });
  }

  qEl.addEventListener("input", () => {
    qText = qEl.value || "";
    clearEditorOnly();
    scheduleRender();
  });

  if (sortEl){
    sortEl.value = "recent";
    sortEl.addEventListener("change", () => {
      sortMode = "recent";
      sortEl.value = "recent";
      scheduleSaveSort();
      scheduleRender();
    });
  }

  btnClearQ.addEventListener("click", () => {
    qText = "";
    qEl.value = "";
    tagFilters.clear();
    clearEditorOnly();
    scheduleRender();
    qEl.focus();
  });

  if (favTagsEl){
    favTagsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tag]");
      if (!b) return;
      const t = b.dataset.tag || "";
      toggleTagFilter(t);
      clearUIForTag();
      scrollListTop(true);
    });
  }

  listEl.addEventListener("click", (e) => {
    const setup = e.target.closest(".tplSetup[data-action=\"pickTpl\"]");
    if (setup){
      configureTemplatesSource().catch(()=>{});
      return;
    }

    const link = e.target.closest("a.rtLink, a[data-url]");
    if (link){
      e.preventDefault();
      e.stopPropagation();
      scheduleOpenUrl(link.dataset.url || link.getAttribute("href") || "");
      return;
    }

    const chip = e.target.closest(".chip[data-tag]");
    if (chip){
      const t = chip.dataset.tag || "";
      toggleTagFilter(t);
      clearUIForTag();
      scrollListTop(true);
      return;
    }

    const tplCard = e.target.closest(".card[data-tpl]");
    if (tplCard){
      const tkey = tplCard.dataset.tkey || "";
      const tpl = templates.find(x => tplKey(x) === tkey);
      if (tpl){
        tpl.lastUsed = Date.now();
        saveTplCache();
      }

      if (tpl){
        const subj = applyUserReplace((tpl.subject || "").trim());
        const body = applyUserReplace(tpl.body || "");
        subjEl.value = normalizeText(subj);
        setBodyFromText(normalizeText(body));
      }else{
        subjEl.value = normalizeText(tplCard.querySelector(".cardSubj")?.textContent || "");
        setBodyFromText(normalizeText(tplCard.querySelector(".cardBody")?.textContent || ""));
      }
      state.selectedId = null;
      scheduleSaveState();
      selectedTplKey = tkey;
      applyModeUI();
      editorManualOpen = true;
      scheduleEditorLayout();
      saveEditorDraftNow();

      // ★tabs無し運用のときだけtplModeをON（tabs有りはタブ同期で常にON）
      if (!tabsEnabled()) setTemplateMode(true);

      scheduleRender();
      setMsg("反映");
      scrollListTop(true);
      return;
    }

    const card = e.target.closest(".card[data-id]");
    if (card){
      setSelection(card.dataset.id);
      scrollListTop(true);
    }
  });

  listEl.addEventListener("dblclick", (e) => {
    if (!canCopyNow()) { e.preventDefault(); e.stopPropagation(); return; }
    e.preventDefault();
    clearSelection();
    cancelOpenUrl();
    const card = e.target.closest(".card");
    if (!card) return;

    const subjNode = e.target.closest(".cardSubj");
    if (subjNode){
      copyText(subjNode.textContent || "", subjNode);
      return;
    }

    const bodyNode = e.target.closest(".cardBody");
    if (!bodyNode) return;

    const memoId = card.dataset.id || "";
    if (memoId){
      const m = getActiveItems().find(x => x.id === memoId);
      copyText(m ? (m.body || "") : (bodyNode.textContent || ""), bodyNode);
      return;
    }

    const tkey = card.dataset.tkey || "";
    if (tkey){
      const tpl = templates.find(x => tplKey(x) === tkey);
      const body = tpl ? applyUserReplace(tpl.body || "") : (bodyNode.textContent || "");
      copyText(body, bodyNode);
    }
  });

}

// --- Auto refresh (NO interval) ---
let _autoTplRefreshInFlight = false;
let _autoTplRefreshLast = 0;
const AUTO_TPL_REFRESH_COOLDOWN_MS = 700;

let _lastActivityAt = Date.now();
const ACTIVITY_GAP_MS = 1800;

function markActivity(){
  _lastActivityAt = Date.now();
}

async function autoRefreshTemplatesOnShow({ interactive=false, force=false } = {}){
  const now = Date.now();
  if (_autoTplRefreshInFlight) return;
  if (now - _autoTplRefreshLast < AUTO_TPL_REFRESH_COOLDOWN_MS) return;
  _autoTplRefreshLast = now;
  _autoTplRefreshInFlight = true;
  try{
    await refreshTemplates({ silent:true, force: !!force, interactive: !!interactive });
  }catch(_){
  }finally{
    _autoTplRefreshInFlight = false;
  }
}

function wireAutoRefreshOnShow(){
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible"){
      markActivity();
      autoRefreshTemplatesOnShow({ interactive:false, force:false });
    }
  });
  window.addEventListener("focus", () => {
    markActivity();
    autoRefreshTemplatesOnShow({ interactive:false, force:false });
  });
  window.addEventListener("pageshow", () => {
    markActivity();
    autoRefreshTemplatesOnShow({ interactive:false, force:false });
  });

  const onUserFirstAction = () => {
    const now = Date.now();
    const gap = now - _lastActivityAt;
    markActivity();
    if (gap >= ACTIVITY_GAP_MS){
      autoRefreshTemplatesOnShow({ interactive:true, force:false });
    }
  };

  document.addEventListener("pointerdown", onUserFirstAction, { passive:true });
  document.addEventListener("keydown", onUserFirstAction, { passive:true });
}

// --- Init ---
async function init(){
  await Promise.allSettled([
    loadState(),
    loadTplCache(),
    loadUserName(),
    loadNameEditMode(),
    loadListTab(),
    loadTplMeta(),
    loadSortMode(),
    loadCodeEditorMode(),
    loadPanelLayoutMode()
  ]);

  applyPanelLayoutModeUI();
  applyNameEditUI();
  applyModeUI();
  updateUserNameHighlight();
  applyTabUI();

  // ★初期でタブ状態をbody classへ反映
  syncListTabClass();
  updateIoButtonsForTab();
  applyCodeEditorModeUI();

  // ★初期でタブに応じてtplModeを同期（これが無いとテンプレタブでボタンが出る）
  syncTplModeForContext();

  await restoreEditorDraft();
  applyEditorReadonlyForTab();
  observeEditorLineNumbers(bodyEl, bodyLineNumbersEl);
  observeEditorLineNumbers(bodyModalEditorEl, bodyModalLineNumbersEl);
  refreshAllLineNumbers();
  scheduleEditorLayout();

  await refreshTemplates({ silent:true, force:false, interactive:false }).catch(()=>{});
  refreshAllLineNumbers();
  scheduleEditorLayout();
  scheduleRender();
}

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  wireAutoRefreshOnShow();
  init();
});

/* =========================
   BCP UI - FULLSCREEN
   - JMA earthquakes within 24 hours
   - Google Trends within 1 hour
========================= */
(() => {
  // v1.3.120ではGoogle Trends版を停止し、下段の気象警報版へ置き換える。
  return;
  const BCP_STORE = {
    settings: "bcp_settings_v1",
    keywords: "bcp_keywords_v1",
    lastItems: "bcp_lastItems_v1",
    attention: "bcp_attention_v1",
    uiToggleAt: "bcp_uiToggleAt_v1",
    lastError: "bcp_lastError_v1",
  };

  const DEFAULTS = {
    trendsRssUrl: "https://trends.google.co.jp/trending/rss?geo=JP",
    periodMinutes: 5,
    enableNotifications: true,
    searchMode: "news",
  };

  const $$ = (id) => document.getElementById(id);

  function parseKeywords(text){
    const values = String(text || "")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => !["地震", "震度"].includes(value));
    return Array.from(new Set(values));
  }

  function makeSearchUrl(query, mode){
    const q = encodeURIComponent(String(query || ""));
    if (mode === "news") return `https://www.google.com/search?tbm=nws&hl=ja&gl=jp&q=${q}`;
    return `https://www.google.com/search?hl=ja&gl=jp&q=${q}`;
  }

  function isBcpTab(){
    return document.body.classList.contains("listTabBcp");
  }

  async function send(cmd, payload={}){
    try{
      return await chrome.runtime.sendMessage({ type: "bcp", cmd, ...payload });
    }catch(e){
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function loadAll(){
    const data = await chrome.storage.local.get([
      BCP_STORE.settings,
      BCP_STORE.keywords,
      BCP_STORE.lastItems,
      BCP_STORE.lastError,
      BCP_STORE.uiToggleAt,
      BCP_STORE.attention,
    ]);
    return {
      settings: { ...DEFAULTS, ...(data[BCP_STORE.settings] || {}) },
      keywords: Array.isArray(data[BCP_STORE.keywords]) ? data[BCP_STORE.keywords] : [],
      lastItems: data[BCP_STORE.lastItems] || null,
      lastError: data[BCP_STORE.lastError] || { at: 0, message: "" },
      uiToggleAt: Number(data[BCP_STORE.uiToggleAt] || 0),
      attention: data[BCP_STORE.attention] || { count: 0, lastAt: 0 },
    };
  }

  function updateLastUpdated(lastItems){
    const element = $$("bcpLastUpdated");
    if (!element) return;
    const at = Number(lastItems?.updatedAt || 0);
    element.textContent = at ? `最終更新: ${new Date(at).toLocaleString()}` : "";
  }

  async function updateAttention(){
    try{
      const button = $$("btnBcp");
      if (!button) return;
      const data = await chrome.storage.local.get([BCP_STORE.attention]);
      const attention = data[BCP_STORE.attention] || { count: 0 };
      const active = (Number(attention.count) || 0) > 0;
      button.classList.toggle("reqEmpty", active);
      button.title = active ? "BCPアラート（未確認あり）" : "BCPアラート";
    }catch(_){ }
  }

  let handledToggleAt = 0;
  async function handleUiToggleAt(force=false){
    try{
      const data = await chrome.storage.local.get([BCP_STORE.uiToggleAt]);
      const at = Number(data[BCP_STORE.uiToggleAt] || 0);
      if (!at || (!force && at <= handledToggleAt)) return;
      handledToggleAt = at;
      $$("btnBcp")?.click();
    }catch(_){ }
  }

  let activeBcpSource = "jma";
  let latestTrendItems = [];
  const seenTrendHitIds = new Set();
  let bcpControlsHydrated = false;
  let bcpControlsDirty = false;

  function splitErrors(message){
    const result = { jma: [], trends: [] };
    const lines = String(message || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    for (const line of lines){
      if (line.includes("気象庁") || line.includes("地震情報JSON")) result.jma.push(line);
      else result.trends.push(line);
    }
    return result;
  }

  function appendErrorCards(box, messages){
    if (!box) return;
    const list = Array.isArray(messages)
      ? messages
      : String(messages || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    for (const message of list){
      const card = document.createElement("div");
      card.className = "bcpItem err";
      const title = document.createElement("div");
      title.className = "t";
      title.textContent = `⚠ ${message}`;
      card.appendChild(title);
      box.appendChild(card);
    }
  }

  function appendBadge(card, label){
    const badge = document.createElement("div");
    badge.className = "bcpBadge";
    badge.textContent = label;
    card.appendChild(badge);
  }

  function appendLink(card, label, url){
    const actions = document.createElement("div");
    actions.className = "a";
    const link = document.createElement("span");
    link.className = "bcpLink";
    link.textContent = label;
    link.addEventListener("click", () => {
      if (url) chrome.tabs.create({ url });
    });
    actions.appendChild(link);
    card.appendChild(actions);
  }

  function renderJmaCard(item){
    const card = document.createElement("div");
    const hit = Number(item.intensityScore || 0) >= 3;
    card.className = `bcpItem jma${hit ? " hit" : ""}`;
    appendBadge(card, "気象庁・地震");

    const title = document.createElement("div");
    title.className = "t";
    title.textContent = item.epicenter || item.title || "震央地名不明";
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "quakeGrid";
    const rows = [
      ["地震検知日時", item.eventTime || "不明"],
      ["震央地名", item.epicenter || "不明"],
      ["マグニチュード", item.magnitude ? `M${item.magnitude}` : "不明"],
      ["最大震度", item.maxIntensity || "不明"],
    ];
    for (const [key, value] of rows){
      const k = document.createElement("div");
      k.className = "k";
      k.textContent = key;
      const v = document.createElement("div");
      v.className = "v";
      v.textContent = value;
      grid.append(k, v);
    }
    card.appendChild(grid);

    if (item.reportTime){
      const meta = document.createElement("div");
      meta.className = "m";
      meta.textContent = `発表: ${item.reportTime}`;
      card.appendChild(meta);
    }
    appendLink(card, "気象庁で詳細を開く", item.link);
    return card;
  }

  function renderTrendCard(item, settings){
    const card = document.createElement("div");
    card.className = `bcpItem trends${item._hit ? " hit" : ""}`;
    appendBadge(card, item.sourceType === "test" ? "テスト" : "Google Trends");

    const title = document.createElement("div");
    title.className = "t";
    title.textContent = item.title || "(no title)";
    card.appendChild(title);

    const metadata = [];
    if (item._hitKey) metadata.push(`HIT: ${item._hitKey}`);
    if (item.approxTraffic) metadata.push(`推定: ${item.approxTraffic}`);
    if (item.published) metadata.push(String(item.published));
    if (item.topNewsTitle) metadata.push(`News: ${item.topNewsTitle}`);

    const meta = document.createElement("div");
    meta.className = "m";
    meta.textContent = metadata.join("\n");
    card.appendChild(meta);

    const mode = $$("bcpMode")?.value || settings.searchMode;
    appendLink(card, "Google検索を開く", makeSearchUrl(item.title, mode));
    return card;
  }

  function currentTrendHitIds(){
    return latestTrendItems
      .filter((item) => item?._hit)
      .map((item) => String(item.id || `${item.title || ""}|${item.published || ""}`))
      .filter(Boolean);
  }

  function updateTrendTabAlert(){
    const button = $$("bcpSubTrends");
    if (!button) return;

    const ids = currentTrendHitIds();
    if (activeBcpSource === "trends"){
      for (const id of ids) seenTrendHitIds.add(id);
    }
    const unseen = ids.filter((id) => !seenTrendHitIds.has(id));
    const active = unseen.length > 0 && activeBcpSource !== "trends";
    button.classList.toggle("hasHit", active);
  }

  function setBcpSource(source){
    activeBcpSource = source === "trends" ? "trends" : "jma";
    const isJma = activeBcpSource === "jma";
    const jmaTab = $$("bcpSubJma");
    const trendTab = $$("bcpSubTrends");
    const jmaView = $$("bcpViewJma");
    const trendView = $$("bcpViewTrends");

    jmaTab?.classList.toggle("on", isJma);
    trendTab?.classList.toggle("on", !isJma);
    jmaTab?.setAttribute("aria-selected", String(isJma));
    trendTab?.setAttribute("aria-selected", String(!isJma));
    if (jmaView) jmaView.hidden = !isJma;
    if (trendView) trendView.hidden = isJma;

    updateTrendTabAlert();
    const activeList = isJma ? $$("bcpJmaList") : $$("bcpTrendsList");
    try{ activeList?.scrollTo({ top: 0, left: 0, behavior: "auto" }); }catch(_){ }
  }

  function appendEmpty(box, message){
    if (!box || box.children.length) return;
    const empty = document.createElement("div");
    empty.className = "bcpMsg bcpEmptyMsg";
    empty.textContent = message;
    box.appendChild(empty);
  }

  function renderItems(items, settings, errorMessage){
    const jmaBox = $$("bcpJmaList");
    const trendsBox = $$("bcpTrendsList");
    if (!jmaBox || !trendsBox) return;

    // 再取得・タブ復帰でカードを描画し直しても、閲覧位置は維持する。
    const jmaScrollTop = Number(jmaBox.scrollTop || 0);
    const trendsScrollTop = Number(trendsBox.scrollTop || 0);

    jmaBox.innerHTML = "";
    trendsBox.innerHTML = "";

    const errors = splitErrors(errorMessage);
    appendErrorCards(jmaBox, errors.jma);
    appendErrorCards(trendsBox, errors.trends);

    const jmaItems = [];
    const trendItems = [];
    for (const item of items || []){
      if (item?.sourceType === "jmaQuake") jmaItems.push(item);
      else trendItems.push(item || {});
    }
    latestTrendItems = trendItems;

    for (const item of jmaItems) jmaBox.appendChild(renderJmaCard(item));
    for (const item of trendItems) trendsBox.appendChild(renderTrendCard(item, settings));

    appendEmpty(jmaBox, "直近24時間の地震情報はありません。");
    appendEmpty(trendsBox, "直近1時間の対象情報はありません。");
    updateTrendTabAlert();

    try{
      requestAnimationFrame(() => {
        jmaBox.scrollTop = jmaScrollTop;
        trendsBox.scrollTop = trendsScrollTop;
      });
    }catch(_){
      jmaBox.scrollTop = jmaScrollTop;
      trendsBox.scrollTop = trendsScrollTop;
    }
  }

  async function refreshUI(force=false, hydrateControls=false){
    if (!force && !isBcpTab()) return;
    if (!$$("bcpPane")) return;

    const { settings, keywords, lastItems, lastError } = await loadAll();

    // 初回表示・保存直後だけ設定値をフォームへ反映する。
    // BCPから離れて戻っただけでは、入力途中の設定を上書きしない。
    if (hydrateControls || !bcpControlsHydrated || !bcpControlsDirty){
      if (!bcpControlsDirty || hydrateControls || !bcpControlsHydrated){
        if ($$("bcpKeywords")) $$("bcpKeywords").value = keywords.join("\n");
        if ($$("bcpEnable")) $$("bcpEnable").checked = !!settings.enableNotifications;
        if ($$("bcpPeriod")) $$("bcpPeriod").value = Number(settings.periodMinutes || DEFAULTS.periodMinutes);
        if ($$("bcpMode")) $$("bcpMode").value = settings.searchMode || "news";
        if ($$("bcpRssUrl")) $$("bcpRssUrl").value = settings.trendsRssUrl || DEFAULTS.trendsRssUrl;
        bcpControlsHydrated = true;
        if (hydrateControls) bcpControlsDirty = false;
      }
    }

    updateLastUpdated(lastItems);
    renderItems(lastItems?.items || [], settings, lastError?.message || "");
  }

  function wire(){
    $$("bcpSubJma")?.addEventListener("click", () => setBcpSource("jma"));
    $$("bcpSubTrends")?.addEventListener("click", () => setBcpSource("trends"));

    // BCP設定の入力途中状態も、他タブへ移動しただけでは保持する。
    for (const id of ["bcpKeywords", "bcpEnable", "bcpPeriod", "bcpMode", "bcpRssUrl"]){
      const el = $$(id);
      if (!el) continue;
      el.addEventListener("input", () => { bcpControlsDirty = true; });
      el.addEventListener("change", () => { bcpControlsDirty = true; });
    }

    const button = $$("btnBcp");
    if (button){
      button.addEventListener("click", () => {
        try{
          if (typeof suppressCopy === "function") suppressCopy(900);
          window.__bcpPrevTab = window.__bcpPrevTab || "tpl";
          if (document.body.classList.contains("listTabBcp")){
            if (typeof setListTab === "function") setListTab(window.__bcpPrevTab);
            else $$("tabTpl")?.click();
            return;
          }
          window.__bcpPrevTab = document.body.classList.contains("listTabMemo") ? "memo" : "tpl";
          if (typeof setListTab === "function") setListTab("bcp");
          else $$("tabTpl")?.click();
        }catch(_){ }
      });
    }

    $$("bcpSave")?.addEventListener("click", async () => {
      const keywords = parseKeywords($$("bcpKeywords")?.value || "");
      const settings = {
        enableNotifications: !!$$("bcpEnable")?.checked,
        periodMinutes: Math.max(1, Number($$("bcpPeriod")?.value || DEFAULTS.periodMinutes)),
        searchMode: $$("bcpMode")?.value === "web" ? "web" : "news",
        trendsRssUrl: String($$("bcpRssUrl")?.value || "").trim() || DEFAULTS.trendsRssUrl,
      };
      await send("saveAll", { settings, keywords });
      bcpControlsDirty = false;
      await send("refreshNow");
      refreshUI(true, true).catch(() => {});
    });

    $$("bcpRefresh")?.addEventListener("click", async () => {
      await send("refreshNow");
      refreshUI(true).catch(() => {});
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[BCP_STORE.lastItems] || changes[BCP_STORE.settings] || changes[BCP_STORE.keywords] || changes[BCP_STORE.lastError]){
        refreshUI(false).catch(() => {});
      }
      if (changes[BCP_STORE.attention]) updateAttention();
      if (changes[BCP_STORE.uiToggleAt]) handleUiToggleAt(true);
    });

    window.addEventListener("tenmemo:listTab", (event) => {
      if (event?.detail?.tab !== "bcp") return;
      // 地震/Google Trendsの表示中サブタブとスクロール位置は維持する。
      send("ackAttention").catch(() => {});
      updateAttention();
      refreshUI(true, !bcpControlsHydrated).catch(() => {});
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    setBcpSource("jma");
    updateAttention();
    handleUiToggleAt(true);
  });
})();

/* =========================
   BCP UI - v1.3.130
   - 気象庁の地震情報（直近24時間）
   - 全国の気象警報・注意報
   - 気象庁の台風情報
   - 取得・通知・巡回間隔は3種類で個別管理
========================= */
(() => {
  const STORE = {
    settings: "bcp2_settings",
    quakes: "bcp2_quakes",
    warnings: "bcp2_warnings",
    cyclones: "bcp2_cyclones",
    errors: "bcp2_errors",
    attention: "bcp_attention_v1",
    uiToggleAt: "bcp_uiToggleAt_v1",
    view: "bcp2_view",
  };

  const DEFAULTS = {
    quakePeriodMinutes: 5,
    warningPeriodMinutes: 10,
    cyclonePeriodMinutes: 10,
    quakeNotifications: true,
    warningNotifications: true,
    cycloneNotifications: true,
    showAdvisory: false,
  };

  const $$ = (id) => document.getElementById(id);
  let activeSource = "jma";
  let controlsHydrated = false;
  let controlsDirty = false;
  let lastWarningData = { items: [] };
  let lastWarningError = null;

  function isBcpTab(){
    return document.body.classList.contains("listTabBcp");
  }

  function isExpanded(){
    return document.documentElement.classList.contains("layoutAbcd");
  }

  function formatDate(value){
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString("ja-JP");
  }

  function createElement(tag, className, text){
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function openUrl(url){
    if (url) chrome.tabs.create({ url });
  }

  function appendError(box, error){
    if (!box || !error?.message) return;
    const card = createElement("div", "bcpItem err");
    card.appendChild(createElement("div", "t", `⚠ ${error.message}`));
    box.appendChild(card);
  }

  function appendLink(card, label, url){
    const actions = createElement("div", "a");
    const link = createElement("button", "bcpLink", label);
    link.type = "button";
    link.addEventListener("click", () => openUrl(url));
    actions.appendChild(link);
    card.appendChild(actions);
  }

  function appendEmpty(box, message){
    if (!box || box.children.length) return;
    box.appendChild(createElement("div", "bcpMsg bcpEmptyMsg", message));
  }

  function renderQuakeCard(item){
    const score = Number(item.intensityScore || 0);
    const card = createElement("article", `bcpItem jma${score >= 3 ? " hit" : ""}`);
    card.appendChild(createElement("div", "bcpBadge", "気象庁・地震"));
    card.appendChild(createElement("div", "t", item.epicenter || "震央地名不明"));

    const grid = createElement("div", "quakeGrid");
    const rows = [
      ["地震検知日時", item.eventTime || "不明"],
      ["震央地名", item.epicenter || "不明"],
      ["マグニチュード", item.magnitude ? `M${item.magnitude}` : "不明"],
      ["最大震度", item.maxIntensity || "不明"],
    ];
    for (const [key, value] of rows){
      grid.appendChild(createElement("div", "k", key));
      grid.appendChild(createElement("div", "v", value));
    }
    card.appendChild(grid);

    if (item.reportTime){
      card.appendChild(createElement("div", "m", `発表: ${item.reportTime}`));
    }
    appendLink(card, "気象庁で詳細を開く", item.link);
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
    const card = createElement("article", `bcpItem weather level${Math.min(5, level)}`);
    card.appendChild(createElement("div", "bcpBadge", warningBadge(level)));
    const areaTitle = item.areaTitle || (
      item.parentAreaName ? `${item.parentAreaName}の警報・注意報` : ""
    );
    if (areaTitle){
      card.appendChild(createElement("div", "warningAreaTitle", areaTitle));
    }
    card.appendChild(createElement(
      "div",
      `t${areaTitle ? " warningAreaName" : ""}`,
      item.areaName || item.areaCode || "地域名不明"
    ));

    const names = createElement("div", "warningNames");
    for (const warning of item.warnings || []){
      const warningLevel = Math.max(2, Number(warning.level || 2));
      const name = createElement(
        "div",
        `warningName level${Math.min(5, warningLevel)}`,
        warning.name || `気象情報（${warning.code || "不明"}）`
      );
      if (warning.status) name.title = warning.status;
      names.appendChild(name);
    }
    card.appendChild(names);

    if (item.reportDatetime){
      card.appendChild(createElement("div", "m", `発表: ${formatDate(item.reportDatetime)}`));
    }
    appendLink(card, "気象庁で詳細を開く", item.detailUrl);
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
    const card = createElement(
      "article",
      `bcpItem cyclone intensity${Math.min(5, level)}${ended ? " ended" : ""}`
    );
    card.appendChild(createElement("div", "bcpBadge", cycloneBadge(item)));
    card.appendChild(createElement("div", "t", item.displayName || item.name || "台風情報"));

    const grid = createElement("div", "cycloneGrid");
    const movement = [
      item.direction || "不明",
      item.speedKmH ? `${item.speedKmH}km/h` : "",
    ].filter(Boolean).join(" ");
    const rows = [
      ["実況日時", item.targetDateTime || "不明"],
      ["大きさ", item.areaClass || "－"],
      ["強さ／種類", item.intensity || item.className || "不明"],
      ["中心気圧", item.pressure ? `${item.pressure}hPa` : "不明"],
      ["最大風速", item.maxWindMS ? `${item.maxWindMS}m/s` : "不明"],
      ["最大瞬間風速", item.gustWindMS ? `${item.gustWindMS}m/s` : "不明"],
      ["進行", movement || "不明"],
    ];
    for (const [key, value] of rows){
      grid.appendChild(createElement("div", "k", key));
      grid.appendChild(createElement("div", "v", value));
    }
    card.appendChild(grid);

    const forecasts = Array.isArray(item.forecasts) ? item.forecasts : [];
    if (forecasts.length){
      const details = createElement("details", "cycloneForecasts");
      const summary = createElement("summary", "", `今後の予報（${forecasts.length}件）`);
      details.appendChild(summary);
      const list = createElement("div", "cycloneForecastList");
      for (const forecast of forecasts){
        const line = createElement("div", "cycloneForecast");
        line.appendChild(createElement("div", "cycloneForecastTime", forecast.dateTime || "日時不明"));
        const forecastText = [
          forecast.intensity || forecast.className || "",
          forecast.pressure ? `${forecast.pressure}hPa` : "",
          forecast.maxWindMS ? `最大${forecast.maxWindMS}m/s` : "",
          forecast.direction || "",
          forecast.speedKmH ? `${forecast.speedKmH}km/h` : "",
        ].filter(Boolean).join(" ／ ");
        line.appendChild(createElement("div", "cycloneForecastValue", forecastText || "予報値なし"));
        list.appendChild(line);
      }
      details.appendChild(list);
      card.appendChild(details);
    }

    if (item.reportDateTime){
      card.appendChild(createElement("div", "m", `発表: ${item.reportDateTime}`));
    }
    appendLink(card, "気象庁で詳細を開く", item.detailUrl);
    return card;
  }

  function renderQuakes(data, error){
    const box = $$("bcpJmaList");
    if (!box) return;
    const scrollTop = Number(box.scrollTop || 0);
    box.innerHTML = "";
    appendError(box, error);
    for (const item of Array.isArray(data?.items) ? data.items : []){
      box.appendChild(renderQuakeCard(item));
    }
    appendEmpty(box, "直近24時間の地震情報はありません。");
    requestAnimationFrame(() => { box.scrollTop = scrollTop; });
  }

  function renderWarnings(data, error, showAdvisory){
    const box = $$("bcpWarningList");
    if (!box) return;
    const scrollTop = Number(box.scrollTop || 0);
    box.innerHTML = "";
    appendError(box, error);

    const items = (Array.isArray(data?.items) ? data.items : [])
      .map((item) => {
        const warnings = (item.warnings || [])
          .filter((warning) => showAdvisory || Number(warning.level || 0) >= 3);
        return {
          ...item,
          warnings,
          maxLevel: warnings.length
            ? Math.max(...warnings.map((warning) => Number(warning.level || 0)))
            : 0,
        };
      })
      .filter((item) => item.warnings.length);

    for (const item of items) box.appendChild(renderWarningCard(item));
    appendEmpty(
      box,
      showAdvisory
        ? "現在、発表中の警報・注意報はありません。"
        : "現在、発表中の警報以上の情報はありません。"
    );
    requestAnimationFrame(() => { box.scrollTop = scrollTop; });
  }

  function renderCyclones(data, error){
    const box = $$("bcpCycloneList");
    if (!box) return;
    const scrollTop = Number(box.scrollTop || 0);
    box.innerHTML = "";
    appendError(box, error);
    for (const item of Array.isArray(data?.items) ? data.items : []){
      box.appendChild(renderCycloneCard(item));
    }
    appendEmpty(box, "現在、発表中の台風情報はありません。");
    requestAnimationFrame(() => { box.scrollTop = scrollTop; });
  }

  function setSource(source, persist=true){
    activeSource = ["warning", "cyclone"].includes(source) ? source : "jma";

    const expanded = isExpanded();
    const isJma = activeSource === "jma";
    const isWarning = activeSource === "warning";
    const isCyclone = activeSource === "cyclone";

    $$("bcpSubJma")?.classList.toggle("on", !expanded && isJma);
    $$("bcpSubWarning")?.classList.toggle("on", !expanded && isWarning);
    $$("bcpSubCyclone")?.classList.toggle("on", !expanded && isCyclone);
    $$("bcpSubJma")?.setAttribute("aria-selected", String(!expanded && isJma));
    $$("bcpSubWarning")?.setAttribute("aria-selected", String(!expanded && isWarning));
    $$("bcpSubCyclone")?.setAttribute("aria-selected", String(!expanded && isCyclone));

    if ($$("bcpViewJma")) $$("bcpViewJma").hidden = expanded ? false : !isJma;
    if ($$("bcpViewWarning")) $$("bcpViewWarning").hidden = expanded ? false : !isWarning;
    if ($$("bcpViewCyclone")) $$("bcpViewCyclone").hidden = expanded ? false : !isCyclone;
    if ($$("bcpControlJma")) $$("bcpControlJma").hidden = expanded ? false : !isJma;
    if ($$("bcpControlWarning")) $$("bcpControlWarning").hidden = expanded ? false : !isWarning;
    if ($$("bcpControlCyclone")) $$("bcpControlCyclone").hidden = expanded ? false : !isCyclone;

    if (persist){
      chrome.storage.local.set({ [STORE.view]: activeSource }).catch(() => {});
    }
  }

  async function send(cmd, payload={}){
    try{
      return await chrome.runtime.sendMessage({ type: "bcpWeather", cmd, ...payload });
    }catch(error){
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function loadAndRender({ hydrate=false }={}){
    const data = await chrome.storage.local.get(Object.values(STORE));
    const settings = { ...DEFAULTS, ...(data[STORE.settings] || {}) };

    if (hydrate || !controlsHydrated || !controlsDirty){
      if (hydrate || !controlsHydrated || !controlsDirty){
        if ($$("bcpQuakeEnable")) $$("bcpQuakeEnable").checked = !!settings.quakeNotifications;
        if ($$("bcpWarningEnable")) $$("bcpWarningEnable").checked = !!settings.warningNotifications;
        if ($$("bcpCycloneEnable")) $$("bcpCycloneEnable").checked = !!settings.cycloneNotifications;
        if ($$("bcpShowAdvisory")) $$("bcpShowAdvisory").checked = !!settings.showAdvisory;
        if ($$("bcpQuakePeriod")) $$("bcpQuakePeriod").value = settings.quakePeriodMinutes;
        if ($$("bcpWarningPeriod")) $$("bcpWarningPeriod").value = settings.warningPeriodMinutes;
        if ($$("bcpCyclonePeriod")) $$("bcpCyclonePeriod").value = settings.cyclonePeriodMinutes;
        controlsHydrated = true;
        if (hydrate) controlsDirty = false;
      }
    }

    const storedView = data[STORE.view];
    if (!controlsHydrated || ["jma", "warning", "cyclone"].includes(storedView)){
      if (["jma", "warning", "cyclone"].includes(storedView)) activeSource = storedView;
    }
    setSource(activeSource, false);

    const quakeData = data[STORE.quakes] || { items: [] };
    const warningData = data[STORE.warnings] || { items: [] };
    const cycloneData = data[STORE.cyclones] || { items: [] };
    const errors = data[STORE.errors] || {};
    lastWarningData = warningData;
    lastWarningError = errors.warning || null;

    if ($$("bcpQuakeLastUpdated")){
      $$("bcpQuakeLastUpdated").textContent = quakeData.updatedAt
        ? `最終更新: ${formatDate(quakeData.updatedAt)}`
        : "";
    }
    if ($$("bcpWarningLastUpdated")){
      $$("bcpWarningLastUpdated").textContent = warningData.updatedAt
        ? `最終更新: ${formatDate(warningData.updatedAt)}`
        : "";
    }
    if ($$("bcpCycloneLastUpdated")){
      $$("bcpCycloneLastUpdated").textContent = cycloneData.updatedAt
        ? `最終更新: ${formatDate(cycloneData.updatedAt)}`
        : "";
    }

    renderQuakes(quakeData, errors.quake);
    renderWarnings(warningData, errors.warning, !!$$("bcpShowAdvisory")?.checked);
    renderCyclones(cycloneData, errors.cyclone);
    updateAttention(data[STORE.attention]);
  }

  function updateAttention(attention){
    const button = $$("btnBcp");
    if (!button) return;
    const active = Number(attention?.count || 0) > 0;
    button.classList.toggle("reqEmpty", active);
    button.title = active ? "BCPアラート（未確認あり）" : "BCPアラート";
  }

  async function saveSettings(){
    const settings = {
      quakeNotifications: !!$$("bcpQuakeEnable")?.checked,
      warningNotifications: !!$$("bcpWarningEnable")?.checked,
      cycloneNotifications: !!$$("bcpCycloneEnable")?.checked,
      showAdvisory: !!$$("bcpShowAdvisory")?.checked,
      quakePeriodMinutes: Math.max(1, Number($$("bcpQuakePeriod")?.value) || DEFAULTS.quakePeriodMinutes),
      warningPeriodMinutes: Math.max(1, Number($$("bcpWarningPeriod")?.value) || DEFAULTS.warningPeriodMinutes),
      cyclonePeriodMinutes: Math.max(1, Number($$("bcpCyclonePeriod")?.value) || DEFAULTS.cyclonePeriodMinutes),
    };
    await send("saveSettings", { settings });
    controlsDirty = false;
    await loadAndRender({ hydrate: true });
  }

  let handledToggleAt = 0;
  async function handleUiToggleAt(){
    const data = await chrome.storage.local.get([STORE.uiToggleAt]);
    const at = Number(data[STORE.uiToggleAt] || 0);
    if (!at || at <= handledToggleAt) return;
    handledToggleAt = at;
    $$("btnBcp")?.click();
  }

  function wire(){
    $$("bcpSubJma")?.addEventListener("click", () => setSource("jma"));
    $$("bcpSubWarning")?.addEventListener("click", () => setSource("warning"));
    $$("bcpSubCyclone")?.addEventListener("click", () => setSource("cyclone"));

    for (const id of [
      "bcpQuakeEnable",
      "bcpWarningEnable",
      "bcpCycloneEnable",
      "bcpShowAdvisory",
      "bcpQuakePeriod",
      "bcpWarningPeriod",
      "bcpCyclonePeriod",
    ]){
      const element = $$(id);
      if (!element) continue;
      element.addEventListener("input", () => { controlsDirty = true; });
      element.addEventListener("change", () => { controlsDirty = true; });
    }

    $$("bcpShowAdvisory")?.addEventListener("change", () => {
      renderWarnings(lastWarningData, lastWarningError, !!$$("bcpShowAdvisory")?.checked);
    });

    $$("bcpQuakeSave")?.addEventListener("click", saveSettings);
    $$("bcpWarningSave")?.addEventListener("click", saveSettings);
    $$("bcpCycloneSave")?.addEventListener("click", saveSettings);

    $$("bcpQuakeRefresh")?.addEventListener("click", async () => {
      await send("refreshQuake");
      await loadAndRender();
    });
    $$("bcpWarningRefresh")?.addEventListener("click", async () => {
      await send("refreshWarning");
      await loadAndRender();
    });
    $$("bcpCycloneRefresh")?.addEventListener("click", async () => {
      await send("refreshCyclone");
      await loadAndRender();
    });

    $$("btnBcp")?.addEventListener("click", () => {
      try{
        if (typeof suppressCopy === "function") suppressCopy(900);
        window.__bcpPrevTab = window.__bcpPrevTab || "tpl";
        if (isBcpTab()){
          if (typeof setListTab === "function") setListTab(window.__bcpPrevTab);
          else $$("tabTpl")?.click();
          return;
        }
        window.__bcpPrevTab = document.body.classList.contains("listTabMemo") ? "memo" : "tpl";
        if (typeof setListTab === "function") setListTab("bcp");
        else $$("tabTpl")?.click();
      }catch(_){ }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (
        changes[STORE.quakes] ||
        changes[STORE.warnings] ||
        changes[STORE.cyclones] ||
        changes[STORE.errors]
      ){
        if (isBcpTab()) loadAndRender().catch(() => {});
      }
      if (changes[STORE.settings] && !controlsDirty){
        loadAndRender({ hydrate: true }).catch(() => {});
      }
      if (changes[STORE.attention]){
        updateAttention(changes[STORE.attention].newValue);
      }
      if (changes[STORE.uiToggleAt]){
        handleUiToggleAt().catch(() => {});
      }
    });

    window.addEventListener("tenmemo:listTab", (event) => {
      if (event?.detail?.tab !== "bcp") return;
      send("ackAttention").catch(() => {});
      loadAndRender({ hydrate: !controlsHydrated }).catch(() => {});
    });

    window.addEventListener("resize", () => {
      // 1カラムは選択中の情報だけ、拡大時は3種類を同時表示する。
      setSource(activeSource, false);
    });
    new MutationObserver(() => setSource(activeSource, false))
      .observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }

  document.addEventListener("DOMContentLoaded", () => {
    wire();
    setSource("jma", false);
    loadAndRender({ hydrate: true }).catch(() => {});
    handleUiToggleAt().catch(() => {});
  });
})();
