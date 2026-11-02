// background.js — TV の切りかえ（指示69）の拡張機能の裏の処理（service worker）
//
// サーバーとは直につながらない。Chrome がこの処理を眠らせても切れないように、つなぎは「休けい」のタブ
// （サーバーの /tvs/screen?tv=N）が持ち、知らせが来た時だけ bridge.js 経由でここを起こす（指示69 2-1）。
// 覚えること（窓・タブ・見えている物・あそびまちの URL）は chrome.storage.local に置く（眠っても忘れない）。
// **あそびまちの URL はログに出さない。**

importScripts('logic.js', 'media-db.js');

const EXT = chrome.runtime.getURL('');
const BLANK = { server: 'https://aresoredorekore.duckdns.org', win: {}, tabs: { 1: {}, 2: {} }, active: { 1: null, 2: null }, items: [], asobiUrl: '', stuck: { 1: false, 2: false }, place: null };

// 知らせは1つずつ順に（同時に来ても、窓とタブの記録が食いちがわない）
let chain = Promise.resolve();
const queue = (fn) => (chain = chain.then(fn, fn).catch((e) => { console.error('[tvs]', e && e.message); return null; }));

async function load() { const v = await chrome.storage.local.get('S'); return Object.assign({}, BLANK, v.S || {}); }
async function save(S) { await chrome.storage.local.set({ S }); }
async function tabAlive(id) { if (!id) return null; try { return await chrome.tabs.get(id); } catch (e) { return null; } }
async function winAlive(id) { if (!id) return null; try { return await chrome.windows.get(id); } catch (e) { return null; } }
function tvOfWindow(S, windowId) { return S.win[1] === windowId ? 1 : S.win[2] === windowId ? 2 : null; }
function itemOfTab(S, tv, tabId) { const m = S.tabs[tv] || {}; return Object.keys(m).find((k) => m[k] === tabId) || null; }

/** 音の決まり（logic.js）を全部のタブにかける */
async function applyMutes(S) {
  for (const tv of [1, 2]) {
    for (const id of Object.keys(S.tabs[tv] || {})) {
      const want = TvsLogic.muted(tv, id, S.active, S.items);
      const t = await tabAlive(S.tabs[tv][id]);
      if (t && !!(t.mutedInfo && t.mutedInfo.muted) !== want) await chrome.tabs.update(t.id, { muted: want });
    }
  }
}

/** 窓のタブを、出す物の一覧どおりにそろえる（足りない物を開く・消えた物を閉じる・並びを直す）。開いているページは開き直さない */
async function sync(S, tv) {
  const w = await winAlive(S.win[tv]);
  if (!w) return false;
  const want = TvsLogic.plan(S.items, tv, S.server, S.asobiUrl, EXT);
  const have = S.tabs[tv] || {};
  const next = {};
  for (let i = 0; i < want.length; i++) {
    const p = want[i];
    let t = await tabAlive(have[p.id]);
    if (t && t.windowId !== w.id) t = null;
    if (!t) t = await chrome.tabs.create({ windowId: w.id, url: p.url, index: i, active: false });
    else {
      // あそびまちの URL が後から届いた（「まだありません」の画面のままだった）時だけ、行き先を変える
      if (p.id === 'asobi' && S.asobiUrl && (t.pendingUrl || t.url || '').indexOf(EXT) === 0) await chrome.tabs.update(t.id, { url: S.asobiUrl });
      if (t.index !== i) await chrome.tabs.move(t.id, { index: i });
    }
    next[p.id] = t.id;
  }
  for (const id of Object.keys(have)) if (!(id in next)) { const t = await tabAlive(have[id]); if (t) await chrome.tabs.remove(t.id); }
  S.tabs[tv] = next;
  if (!S.active[tv] || !(S.active[tv] in next)) S.active[tv] = 'rest';
  return true;
}

async function show(S, tv, id) {
  const tabId = (S.tabs[tv] || {})[id];
  const t = await tabAlive(tabId);
  if (!t) return false;
  S.active[tv] = id;
  if (!t.active) await chrome.tabs.update(t.id, { active: true });
  await applyMutes(S);
  return true;
}

async function haveMedia(S) {
  const ids = S.items.filter((it) => it.kind === 'images' || it.kind === 'video').map((it) => it.id);
  try { return await MediaDb.have(ids); } catch (e) { return {}; }
}

/** 休けいのタブ（サーバーとつながっている）へ知らせる */
async function push(S, tv, msg) {
  const id = (S.tabs[tv] || {}).rest;
  if (id) { try { await chrome.tabs.sendMessage(id, { push: msg }); } catch (e) {} }
}

// ---- 「はじめる」：窓2つを TV① と TV② の画面に全画面で開き、タブを全部開く ----
async function start(S, startWindowId) {
  const displays = await chrome.system.display.getInfo();
  let startDisplay = null;
  const sw = await winAlive(startWindowId);
  if (sw) {
    const cx = sw.left + sw.width / 2, cy = sw.top + sw.height / 2;
    const d = displays.find((x) => cx >= x.bounds.left && cx < x.bounds.left + x.bounds.width && cy >= x.bounds.top && cy < x.bounds.top + x.bounds.height);
    startDisplay = d ? d.id : null;
  }
  let place = TvsLogic.pickDisplays(displays, startDisplay);
  if (S.place && S.place.swapped) place = { 1: place[2], 2: place[1] };
  S.place = Object.assign({}, S.place || {}, { 1: place[1], 2: place[2] });
  for (const tv of [1, 2]) {
    let w = await winAlive(S.win[tv]);
    if (!w) {
      // 休けいのタブだけで窓を開く。ほかのタブは、休けいのタブがサーバーから一覧をもらってから開く（sync）
      const items = S.items.length ? S.items : [{ id: 'rest', kind: 'rest' }];
      const urls = TvsLogic.plan(items, tv, S.server, S.asobiUrl, EXT);
      w = await chrome.windows.create({ url: urls.map((u) => u.url), focused: false, state: 'normal' });
      S.win[tv] = w.id;
      S.tabs[tv] = {};
      const tabs = await chrome.tabs.query({ windowId: w.id });
      tabs.sort((a, b) => a.index - b.index).forEach((t, i) => { if (urls[i]) S.tabs[tv][urls[i].id] = t.id; });
    }
    await placeWindow(w.id, place[tv]);
  }
  await save(S);
  return true;
}
async function placeWindow(id, p) {
  const b = p.bounds;
  await chrome.windows.update(id, { state: 'normal' });
  await chrome.windows.update(id, { left: b.left, top: b.top, width: b.width, height: b.height });
  if (p.full) await chrome.windows.update(id, { state: 'fullscreen' });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  queue(async () => {
    const S = await load();
    let res = { ok: true };
    const tv = Number(msg && msg.tv) || (sender.tab ? tvOfWindow(S, sender.tab.windowId) : null);
    switch (msg && msg.t) {
      case 'ping':
        res = { ok: true, have: await haveMedia(S), stuck: !!S.stuck[tv] };
        break;
      case 'sync':   // 休けいのタブから：出す物の一覧（と、bridge.js が読んだあそびまちの URL）
        if (Array.isArray(msg.items)) S.items = msg.items;
        if (typeof msg.asobiUrl === 'string') S.asobiUrl = msg.asobiUrl;
        res = { ok: await sync(S, tv) };
        await applyMutes(S);
        break;
      case 'apply':
        res = { ok: await show(S, tv, msg.item) };
        break;
      case 'active':
        res = { ok: true, item: S.active[tv] };
        break;
      case 'reload': {
        const t = await tabAlive((S.tabs[tv] || {}).fes);
        if (t) await chrome.tabs.reload(t.id);
        S.stuck[tv] = false;
        break;
      }
      case 'fes-stuck': {   // fes-watch.js から：あつまれのタブが「F5 で開き直してください」を出した／消した
        if (!tv || !sender.tab || itemOfTab(S, tv, sender.tab.id) !== 'fes') break;
        S.stuck[tv] = !!msg.on;
        await push(S, tv, { t: 'stuck', on: !!msg.on });
        break;
      }
      case 'start':
        if (msg.server) S.server = String(msg.server).replace(/\/+$/, '');
        res = { ok: await start(S, msg.windowId) };
        break;
      case 'swap':   // TV① と TV② の左右が逆だった時：窓の置き場所を入れかえる（中身と名前はそのまま）
        S.place = Object.assign({}, S.place || {}, { swapped: !(S.place && S.place.swapped), 1: S.place && S.place[2], 2: S.place && S.place[1] });
        for (const n of [1, 2]) { const w = await winAlive(S.win[n]); if (w && S.place[n]) await placeWindow(w.id, S.place[n]); }
        break;
      case 'asobi-guide':   // あそびまちの「押すと始まります」を押してもらう間、両方の TV にあそびまちを出す
        for (const n of [1, 2]) { const t = await tabAlive((S.tabs[n] || {}).asobi); if (t) await chrome.tabs.update(t.id, { active: true }); }
        break;
      case 'asobi-done':    // 押し終わった：もとの画面へ
        for (const n of [1, 2]) await show(S, n, S.active[n] || 'rest');
        break;
      case 'status':
        res = { ok: true, server: S.server, windows: { 1: !!(await winAlive(S.win[1])), 2: !!(await winAlive(S.win[2])) }, items: S.items, asobi: !!S.asobiUrl, swapped: !!(S.place && S.place.swapped) };
        break;
      case 'media-changed':
        res = { ok: true, have: await haveMedia(S) };
        break;
      default:
        res = { ok: false };
    }
    await save(S);
    return res;
  }).then((r) => reply(r || { ok: false }));
  return true;
});

// TV の PC で手で切りかえた（Ctrl+1〜5・タブを押した）。音をかけ直し、サーバーにも教える
chrome.tabs.onActivated.addListener((info) => {
  queue(async () => {
    const S = await load();
    const tv = tvOfWindow(S, info.windowId);
    if (!tv) return;
    const id = itemOfTab(S, tv, info.tabId);
    if (!id || S.active[tv] === id) return;
    S.active[tv] = id;
    await applyMutes(S);
    await save(S);
    await push(S, tv, { t: 'manual', item: id });
  });
});

// Chrome を開いたら「はじめる」の画面を出す。ボタン（拡張機能のアイコン）からも開ける
chrome.runtime.onStartup.addListener(() => chrome.tabs.create({ url: 'start.html' }));
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: 'start.html' }));
