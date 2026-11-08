// background.js — TV の切りかえ（指示69）の拡張機能の裏の処理（service worker）
//
// サーバーとは直につながらない。Chrome がこの処理を眠らせても切れないように、つなぎは「休けい」のタブ
// （サーバーの /tvs/screen?tv=N）が持ち、知らせが来た時だけ bridge.js 経由でここを起こす（指示69 2-1）。
// 覚えること（窓・タブ・見えている物・あそびまちの URL）は chrome.storage.local に置く（眠っても忘れない）。
// **あそびまちの URL はログに出さない。**
// 二の束：お知らせの一言（その TV の窓の全部のタブに notice.js が帯で出す）・あそびまちの呼び出し（鳴らすタブの音の始まり）・動画の長さ

importScripts('logic.js', 'media-db.js');

const EXT = chrome.runtime.getURL('');
const BLANK = { server: 'https://aresoredorekore.duckdns.org', win: {}, tabs: { 1: {}, 2: {} }, active: { 1: null, 2: null }, items: [], asobiUrl: '', stuck: { 1: false, 2: false }, place: null, notice: { 1: '', 2: '' }, durations: {}, chimeAt: 0,
  // 指示75：asobiLoaded＝あそびまちのタブを読み込んだ時刻（3-1）・asobiErr＝開けなかったあそびまちのタブ（3-3）・placingUntil＝自分で窓を置いている間（3-2）・
  // startedAt＝「はじめる」の時刻（3-1）・tvProfile＝TV 専用の Chrome の印（3-8）
  asobiLoaded: {}, asobiErr: {}, placingUntil: 0, startedAt: 0, tvProfile: false,
  // 指示75 束4：動画ごとの印・範囲・くり返し・はじめの位置（vset）。動画のファイルといっしょに、この PC に覚える
  vset: {} };

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

/** 指示75 4-4：自動で回す時の「1回分」（秒）。範囲を決めた動画は範囲の長さ、ほかは動画の長さ */
function rotDurations(S) {
  const out = Object.assign({}, S.durations);
  Object.keys(S.vset || {}).forEach((id) => { const d = (S.durations || {})[id]; const r = TvsLogic.rotSec(S.vset[id], d); if (r) out[id] = r; });
  return out;
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
  S.startedAt = Date.now();
  // 指示75 3-4（A29 (a)）：「はじめる」の画面が TV の上に開いていたら、主の画面（ノート PC）へ動かす（TV の窓と重ねない）
  const home = TvsLogic.homeDisplay(displays);
  if (sw && home && startDisplay && startDisplay !== home.id && displays.length >= 2) {
    try { await chrome.windows.update(sw.id, { state: 'normal' }); await chrome.windows.update(sw.id, { left: home.bounds.left + 40, top: home.bounds.top + 40 }); } catch (e) {}
  }
  for (const tv of [1, 2]) {
    let w = await winAlive(S.win[tv]);
    if (!w) {
      // 窓を開いた時に Chrome が出す「1つ目のタブが見えた」は、手で切りかえたのではない。サーバーから最初の「出して」が来るまで数えない
      // （数えると、サーバーの覚えている画面を「あつまれ」で上書きし、開き直しで前の画面にもどらなかった・11/02 通しで見た）
      S.boot = Object.assign({}, S.boot, { [tv]: true });
      // 休けいのタブだけで窓を開く。ほかのタブは、休けいのタブがサーバーから一覧をもらってから開く（sync）
      const items = S.items.length ? S.items : [{ id: 'rest', kind: 'rest' }];
      const urls = TvsLogic.plan(items, tv, S.server, S.asobiUrl, EXT);
      w = await chrome.windows.create({ url: urls.map((u) => u.url), focused: false, state: 'normal' });
      S.win[tv] = w.id;
      S.tabs[tv] = {};
      const tabs = await chrome.tabs.query({ windowId: w.id });
      tabs.sort((a, b) => a.index - b.index).forEach((t, i) => { if (urls[i]) S.tabs[tv][urls[i].id] = t.id; });
    }
    await ensurePlaced(S, tv);
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
/**
 * 指示75 3-2（A25・A27）：TV の窓を置き場所にもどす。もう正しい画面で全画面なら何もしない（「はじめる」の押し直しで窓を一瞬ふつうにしない）。
 * 同じ画面で全画面だけ外れた（Esc・F11）なら、全画面にもどすだけ。別の画面へ動いていたら動かす——その時、あそびまちが前に出ていたら
 * いったん休けいのタブを前にしてから動かす（ふつうの大きさの一瞬に、アドレス欄へ key 付きの URL が出ないように）。動かしおえたら元へ
 */
async function ensurePlaced(S, tv) {
  const p = S.place && S.place[tv];
  const w = await winAlive(S.win[tv]);
  if (!p || !w) return false;
  const step = TvsLogic.placeStep(w, p);
  if (step === 'none') return true;
  S.placingUntil = Date.now() + 1500;
  if (step === 'full') { await chrome.windows.update(w.id, { state: 'fullscreen' }); return true; }
  const asobi = await tabAlive((S.tabs[tv] || {}).asobi), rest = await tabAlive((S.tabs[tv] || {}).rest);
  const hide = !!(asobi && asobi.active && rest);
  if (hide) await chrome.tabs.update(rest.id, { active: true });
  await placeWindow(w.id, p);
  if (hide) await chrome.tabs.update(asobi.id, { active: true });
  S.placingUntil = Date.now() + 1500;
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  queue(async () => {
    const S = await load();
    let res = { ok: true };
    const tv = Number(msg && msg.tv) || (sender.tab ? tvOfWindow(S, sender.tab.windowId) : null);
    switch (msg && msg.t) {
      case 'ping':
        // 指示75 3-7：その TV が左か右か（リモコンの「TV①（左）」）
        // 指示75 4-4：自動で回す時の「1回分」は、範囲を決めた動画では範囲の長さ。印（名前と時刻）もサーバーへ
        res = { ok: true, have: await haveMedia(S), stuck: !!S.stuck[tv], durations: rotDurations(S), side: TvsLogic.sideOf(S.place, tv), vsets: S.vset || {} };
        break;
      case 'sync':   // 休けいのタブから：出す物の一覧（と、bridge.js が読んだあそびまちの URL）
        if (Array.isArray(msg.items)) S.items = msg.items;
        if (typeof msg.asobiUrl === 'string') S.asobiUrl = msg.asobiUrl;
        res = { ok: await sync(S, tv) };
        await applyMutes(S);
        break;
      case 'apply':
        res = { ok: await show(S, tv, msg.item) };
        if (S.boot && S.boot[tv]) S.boot = Object.assign({}, S.boot, { [tv]: false });
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
        // 指示75 3-8（A22・A30）：TV 専用の Chrome でない所では、はじめない（ふだんの Chrome に入った拡張機能で TV の PC が2台になりかけた）
        if (!S.tvProfile) { res = { ok: false, error: 'not_tv_chrome' }; break; }
        if (msg.server) S.server = String(msg.server).replace(/\/+$/, '');
        res = { ok: await start(S, msg.windowId) };
        break;
      case 'swap':   // TV① と TV② の左右が逆だった時：窓の置き場所を入れかえる（中身と名前はそのまま）
        S.place = Object.assign({}, S.place || {}, { swapped: !(S.place && S.place.swapped), 1: S.place && S.place[2], 2: S.place && S.place[1] });
        for (const n of [1, 2]) await ensurePlaced(S, n);
        break;
      case 'asobi-guide':   // あそびまちの「押すと始まります」を押してもらう間、両方の TV にあそびまちを出す
        // 手で切りかえたとは数えない（数えると、サーバーの今の画面があそびまちになり、「押しおわった」でもどる先が無くなっていた・11/02 通しで見た）
        if (!S.guide) S.guide = { 1: S.active[1], 2: S.active[2] };
        for (const n of [1, 2]) { const t = await tabAlive((S.tabs[n] || {}).asobi); if (t) await chrome.tabs.update(t.id, { active: true }); }
        break;
      case 'asobi-done': {  // 押し終わった：あそびまちを出す前の画面へ
        const back = S.guide || S.active;
        S.guide = null;
        for (const n of [1, 2]) await show(S, n, back[n] || 'rest');
        break;
      }
      case 'look': {   // 休けいのタブから：その TV のお知らせの一言
        S.notice = Object.assign({ 1: '', 2: '' }, S.notice, { [tv]: String(msg.notice || '') });
        for (const id of Object.keys(S.tabs[tv] || {})) { try { await chrome.tabs.sendMessage(S.tabs[tv][id], { t: 'notice', text: S.notice[tv] }); } catch (e) {} }
        break;
      }
      case 'place-check':  // 指示75 3-2：TV の窓のページの resize（notice.js・media.js）。全画面が外れていたら置き直す
        if (tv && Date.now() >= (S.placingUntil || 0)) await ensurePlaced(S, tv);
        break;
      case 'vset': {   // 指示75 4-2・4-4・4-5：「はじめる」の画面で印・範囲を変えた。覚えて、動画のタブとサーバー（休けいのタブ経由）に知らせる
        if (!msg.id) break;
        S.vset = Object.assign({}, S.vset, { [msg.id]: TvsLogic.cleanVset(msg.vset) });
        for (const n of [1, 2]) {
          const tabId = (S.tabs[n] || {})[msg.id];
          if (tabId) { try { await chrome.tabs.sendMessage(tabId, { t: 'vset', id: msg.id, vset: S.vset[msg.id] }); } catch (e) {} }
          await push(S, n, { t: 'vsets', vsets: S.vset, durations: rotDurations(S) });
        }
        res = { ok: true, vset: S.vset[msg.id] };
        break;
      }
      case 'vset-get':   // media.js が開いた時に聞く
        res = { ok: true, vset: (S.vset || {})[msg.id] || null };
        break;
      case 'video': {    // 指示75 4-3：休けいのタブから（リモコン → サーバー → 休けいのタブ）。その TV に出ている動画のタブへ
        const id = S.active[tv];
        const it = (S.items || []).find((x) => x.id === id);
        const tabId = (S.tabs[tv] || {})[id];
        if (!it || it.kind !== 'video' || !tabId || (msg.item && msg.item !== id)) { res = { ok: false }; break; }
        try { res = await chrome.tabs.sendMessage(tabId, { t: 'video', op: msg.op, at: msg.at, by: msg.by }); } catch (e) { res = { ok: false }; }
        break;
      }
      case 'video-time': {   // media.js（見えている動画）から1秒ごと：その窓の休けいのタブへ（サーバー → リモコン）
        if (!tv || !sender.tab || S.active[tv] !== msg.id) break;
        await push(S, tv, { t: 'vtime', item: msg.id, cur: msg.cur, dur: msg.dur, paused: !!msg.paused });
        break;
      }
      case 'notice-get':   // notice.js が開いた時に聞く（その窓の TV の一言。TV の窓でなければ空）
        res = { ok: true, text: tv && S.notice ? S.notice[tv] || '' : '' };
        break;
      case 'duration':     // media.js：動画の長さ（「1回分」に使う）
        if (msg.id && msg.sec > 0) S.durations = Object.assign({}, S.durations, { [msg.id]: msg.sec });
        break;
      case 'tv-profile':   // 指示75 3-8：「あつまれ TV」（TV 専用の Chrome）から開いた印のページ（/tvs/mark）。このプロフィールを TV 専用と覚え、そのタブは閉じる
        S.tvProfile = true;
        if (sender.tab) { try { await chrome.tabs.remove(sender.tab.id); } catch (e) {} }
        break;
      case 'status':
        res = { ok: true, tvProfile: !!S.tvProfile, vset: S.vset || {}, server: S.server, windows: { 1: !!(await winAlive(S.win[1])), 2: !!(await winAlive(S.win[2])) }, items: S.items, asobi: !!S.asobiUrl, swapped: !!(S.place && S.place.swapped) };
        break;
      case 'media-changed': {   // 「はじめる」の画面で画像・動画をえらんだ：すぐサーバーに教える（10秒ごとの確かめを待たない。待つと、えらんだ直後のリモコンが「まだありません」のままだった）
        const have = await haveMedia(S);
        for (const n of [1, 2]) await push(S, n, { t: 'have', have });
        // 指示75 4-2：開いている「はじめる」の画面にも描き直しを頼む（印を付ける所は、動画のファイルがある時だけ出る）
        chrome.runtime.sendMessage({ t: 'media-redraw', id: msg.id }).catch(() => {});
        res = { ok: true, have };
        break;
      }
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
    // 指示75 3-3：開けなかったあそびまちのタブが見えた → すぐ開き直す
    if (id === 'asobi' && S.asobiErr && S.asobiErr[info.tabId]) { try { await chrome.tabs.reload(info.tabId); } catch (e) {} }
    if (!id || S.active[tv] === id || S.guide) return;   // あそびまちの準備の間は数えない
    if (S.boot && S.boot[tv]) return;                     // 窓を開いた直後（サーバーの最初の「出して」の前）は数えない
    S.active[tv] = id;
    await applyMutes(S);
    await save(S);
    await push(S, tv, { t: 'manual', item: id });
  });
});

// あそびまちの呼び出し：鳴らすタブ（logic.js asobiOwner）の音が始まったら、その窓の休けいのタブからサーバーへ（10秒に1回まで）
// 指示75 3-1（A28）：読み込んでから20秒・あそびまちの準備の間・「はじめる」から20秒の音は数えない（開いた時の「押すと始まります」の音を、
// だれも呼ばれていないのに呼び出しと数えていた・5回中4回）。決まりは logic.js chimeCounts
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    queue(async () => {
      const S = await load();
      if (![1, 2].some((n) => (S.tabs[n] || {}).asobi === tabId)) return;
      S.asobiLoaded = Object.assign({}, S.asobiLoaded, { [tabId]: Date.now() });
      await save(S);
    });
  }
  if (info.audible !== true) return;
  queue(async () => {
    const S = await load();
    const owner = TvsLogic.asobiOwner(S.items);
    if ((S.tabs[owner] || {}).asobi !== tabId) return;
    const t = Date.now();
    if (!TvsLogic.chimeCounts({ now: t, loadedAt: (S.asobiLoaded || {})[tabId], guide: !!S.guide, startedAt: S.startedAt, chimeAt: S.chimeAt })) return;
    S.chimeAt = t;
    await save(S);
    await push(S, owner, { t: 'chime' });
  });
});

// 指示75 3-2（A25）：TV の窓の全画面が外れた（Esc・F11・画面のつなぎ直し）→ 2秒以内に自分で置き直す。自分で置いている間（placingUntil）は見ない
chrome.windows.onBoundsChanged.addListener((w) => {
  setTimeout(() => queue(async () => {
    const S = await load();
    const tv = tvOfWindow(S, w.id);
    if (!tv || Date.now() < (S.placingUntil || 0)) return;
    await ensurePlaced(S, tv);
    await save(S);
  }), 400);
});

// 指示75 3-4（A29 (d)）：画面の数や並びが変わった（TV の電源・入力の切りかえ）→ 置き場所を決め直して、TV の窓を置き直す（1.5秒まとめて）
let displayTimer = null;
chrome.system.display.onDisplayChanged.addListener(() => {
  clearTimeout(displayTimer);
  displayTimer = setTimeout(() => queue(async () => {
    const S = await load();
    if (!S.place || !(await winAlive(S.win[1]) || await winAlive(S.win[2]))) return;
    const displays = await chrome.system.display.getInfo();
    let place = TvsLogic.pickDisplays(displays, null);
    if (S.place.swapped) place = { 1: place[2], 2: place[1] };
    S.place = Object.assign({}, S.place, { 1: place[1], 2: place[2] });
    for (const n of [1, 2]) await ensurePlaced(S, n);
    await save(S);
  }), 1500);
});

// 指示75 3-3（A26）：あそびまちが開けない（名前が引けない・つながらない）→ エラーの画面のままにしない。30秒ごとと、見えた時に開き直す
chrome.webNavigation.onErrorOccurred.addListener((d) => {
  if (d.frameId !== 0 || /ERR_ABORTED/.test(d.error || '')) return;
  queue(async () => {
    const S = await load();
    if (![1, 2].some((n) => (S.tabs[n] || {}).asobi === d.tabId)) return;
    S.asobiErr = Object.assign({}, S.asobiErr, { [d.tabId]: Date.now() });
    await save(S);
    chrome.alarms.create('asobi-retry', { periodInMinutes: 0.5 });
    // 10秒後にも開き直す（また開けなければ、ここにもう一度来て10秒後に）。裏の処理が眠っても、30秒ごとの見張り（alarms）が残る
    setTimeout(() => queue(async () => { const S2 = await load(); if (S2.asobiErr && S2.asobiErr[d.tabId] && await tabAlive(d.tabId)) { try { await chrome.tabs.reload(d.tabId); } catch (e) {} } }), 10000);
  });
});
chrome.webNavigation.onCompleted.addListener((d) => {
  if (d.frameId !== 0) return;
  queue(async () => {
    const S = await load();
    if (!S.asobiErr || !S.asobiErr[d.tabId]) return;
    const e = Object.assign({}, S.asobiErr); delete e[d.tabId];
    S.asobiErr = e;
    await save(S);
    if (!Object.keys(e).length) chrome.alarms.clear('asobi-retry');
  });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== 'asobi-retry') return;
  queue(async () => {
    const S = await load();
    const ids = Object.keys(S.asobiErr || {}).map(Number);
    if (!ids.length) { chrome.alarms.clear('asobi-retry'); return; }
    for (const id of ids) { if (await tabAlive(id)) { try { await chrome.tabs.reload(id); } catch (e) {} } else { delete S.asobiErr[id]; } }
    await save(S);
  });
});

// Chrome を開いたら「はじめる」の画面を出す。入れた時（はじめての日）も出す。ボタン（拡張機能のアイコン）からも開ける
// Chrome を開き直したら、前の窓とタブの番号は捨てる（新しい Chrome では同じ番号が別の窓・タブに付くことがある。
// 残すと「はじめる」の画面の窓を TV の窓と取りちがえる）。今の画面はサーバーが覚えているので、「はじめる」でもどる
chrome.runtime.onStartup.addListener(() => {
  queue(async () => { const S = await load(); S.win = {}; S.tabs = { 1: {}, 2: {} }; S.stuck = { 1: false, 2: false }; await save(S); });
  chrome.tabs.create({ url: 'start.html' });
});
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install') chrome.tabs.create({ url: 'start.html' }); });
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: 'start.html' }));
