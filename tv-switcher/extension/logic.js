// logic.js — TV の切りかえ（指示69）の、拡張機能の決まり（Chrome にさわらない所だけ。node の検査からも読む）
//
// 2-3 は案3（くまくん 2026-11-02）：TV① の窓と TV② の窓に、出す物を全部、同じ並びでタブで開いておく。
// タブは窓の間で動かさない（Ctrl+1〜5 がいつも同じ物）。切りかえ＝見せるタブを変えるだけ。
// 音は「見えているか」ではなく「鳴らしてよいタブを物ごとに1つ」で決める（2回鳴らない）：
//   ・あそびまち：鳴らす窓は1つだけ（TV② に出せるなら TV②、出せないなら TV①）。そのタブは見えていなくても鳴らす（呼び出しのチャイム）
//   ・ほかの物：TV① の窓で、見えていて、音が「入」の時だけ鳴らす。TV② の窓のほかの物は鳴らさない
//     （Windows の音の出し先は1つで TV① のスピーカー。TV② の画面の物で鳴らすのはチャイムだけ・くまくんの決め）

(function (root) {
  'use strict';

  /** あそびまちを鳴らす窓（1 か 2） */
  function asobiOwner(items) {
    const a = (items || []).find((it) => it.kind === 'asobi');
    return a && a.tvs && a.tvs.indexOf(2) !== -1 ? 2 : 1;
  }

  /**
   * そのタブの音を消すか。win：1 か 2・id：出す物・active：{1: 見えている物, 2: …}・items：出す物の一覧
   */
  function muted(win, id, active, items) {
    const it = (items || []).find((x) => x.id === id);
    if (!it) return true;
    if (it.kind === 'asobi') return win !== asobiOwner(items);
    return !(win === 1 && active && active[1] === id && it.sound);
  }

  /**
   * 窓ごとに開くタブの並び（どちらの窓も同じ並び・全部の物）。URL は物の種類で決まる。
   * server：あつまれのサーバー（例 https://….duckdns.org）・asobiUrl：あそびまち（無ければ「まだありません」の画面）・ext：拡張機能の中のページの頭
   */
  function plan(items, tv, server, asobiUrl, ext) {
    const s = String(server || '').replace(/\/+$/, '');
    return (items || []).map((it) => ({ id: it.id, url: urlOf(it, tv, s, asobiUrl, ext) }));
  }
  function urlOf(it, tv, s, asobiUrl, ext) {
    switch (it.kind) {
      case 'fes': return s + '/fes?tv=1';
      case 'rest': return s + '/tvs/screen?tv=' + tv;
      case 'asobi': return asobiUrl || (ext + 'wait.html');
      case 'images': case 'video': return ext + 'media.html?id=' + encodeURIComponent(it.id) + '&kind=' + it.kind;
      case 'url': return it.url || (ext + 'wait.html');
      default: return ext + 'wait.html';
    }
  }

  /**
   * 「はじめる」で使う画面（ディスプレイ）を2つえらぶ。左から TV①・TV②。
   * 3つ以上ある時は、「はじめる」を押した画面（PC の画面）をのぞく。1つしか無い時（手元の検査）は同じ画面を左右に分ける
   */
  function pickDisplays(displays, startDisplayId) {
    let ds = (displays || []).slice().sort((a, b) => a.bounds.left - b.bounds.left || a.bounds.top - b.bounds.top);
    // 指示75 3-4（A29 (a)）：3つ以上なら、主の画面（ノート PC・isPrimary）をのぞく。「はじめる」の画面が TV の上に開いていても、まちがえない。
    // 主の画面が分からない時だけ、今までどおり「はじめる」を押した画面をのぞく
    if (ds.length >= 3) { const pri = ds.find((d) => d.isPrimary); ds = ds.filter((d) => d.id !== (pri ? pri.id : startDisplayId)); }
    if (ds.length >= 2) return { 1: { bounds: ds[0].bounds, full: true }, 2: { bounds: ds[1].bounds, full: true } };
    const b = (ds[0] && ds[0].bounds) || { left: 0, top: 0, width: 1280, height: 720 };
    const w = Math.floor(b.width / 2);
    return { 1: { bounds: { left: b.left, top: b.top, width: w, height: b.height }, full: false },
      2: { bounds: { left: b.left + w, top: b.top, width: w, height: b.height }, full: false } };
  }

  /** 指示75 3-4：「はじめる」の画面を置く所（主の画面。分からなければ左はし） */
  function homeDisplay(displays) {
    const ds = (displays || []).slice().sort((a, b) => a.bounds.left - b.bounds.left);
    return ds.find((d) => d.isPrimary) || ds[0] || null;
  }

  /** 指示75 3-7：TV の左右（置き場所 place の左の位置でくらべる）。分からない時は null */
  function sideOf(place, tv) {
    const a = place && place[1] && place[1].bounds, b = place && place[2] && place[2].bounds;
    if (!a || !b || a.left === b.left) return null;
    const leftTv = a.left < b.left ? 1 : 2;
    return tv === leftTv ? 'left' : 'right';
  }

  /**
   * 指示75 3-1（A28）：あそびまちのタブの音を「呼び出し」に数えるか。
   * 読み込んでから20秒（開いた時の「押すと始まります」の音）・あそびまちの準備の間・「はじめる」から20秒は数えない。10秒に1回まで
   */
  const CHIME_QUIET_MS = 20000, CHIME_GAP_MS = 10000;
  function chimeCounts(o) {
    if (o.guide) return false;
    if (o.loadedAt && o.now - o.loadedAt < CHIME_QUIET_MS) return false;
    if (o.startedAt && o.now - o.startedAt < CHIME_QUIET_MS) return false;
    if (o.chimeAt && o.now - o.chimeAt < CHIME_GAP_MS) return false;
    return true;
  }

  /**
   * 指示75 3-2：窓の置き直しで何をするか。w：chrome.windows の窓・p：置き場所 { bounds, full }。
   *   'none'（そのまま）・'full'（同じ画面で全画面だけ外れた＝全画面にもどすだけ。窓をふつうの大きさにしない）・'move'（別の画面へ動かす）
   * 窓のまん中が置き場所の画面の中なら「同じ画面」
   */
  function placeStep(w, p) {
    const b = p.bounds, cx = w.left + w.width / 2, cy = w.top + w.height / 2;
    const same = cx >= b.left && cx < b.left + b.width && cy >= b.top && cy < b.top + b.height;
    if (!same) return 'move';
    if (p.full) return w.state === 'fullscreen' ? 'none' : 'full';
    return w.left === b.left && w.top === b.top && w.width === b.width && w.height === b.height ? 'none' : 'move';
  }

  // ---- 指示75 束4：動画の印・範囲とくり返し・はじめの位置（くまくんの決め）----
  // vset（動画ごとの設定・TV の PC の拡張機能が覚える）：{ marks:[{ id, name, t }], start, end（印の id か秒）, loop（真偽）, from（はじめの位置・印の id か秒） }
  const MARK_NAME_MAX = 20, MARKS_MAX = 30;
  function cleanVset(v) {
    const o = v || {};
    const marks = (Array.isArray(o.marks) ? o.marks : []).filter((m) => m && typeof m.t === 'number' && isFinite(m.t)).slice(0, MARKS_MAX)
      .map((m) => ({ id: String(m.id || '').slice(0, 20), name: String(m.name || '').slice(0, MARK_NAME_MAX), t: Math.max(0, Math.round(m.t * 10) / 10) }));
    const pos = (x) => (typeof x === 'number' && isFinite(x) && x >= 0 ? x : (typeof x === 'string' && marks.some((m) => m.id === x) ? x : null));
    return { marks, start: pos(o.start), end: pos(o.end), loop: o.loop !== false, from: pos(o.from) };
  }
  /** 印の id か秒を、秒に */
  function secOf(vs, x) { if (typeof x === 'number') return x; const m = ((vs && vs.marks) || []).find((k) => k.id === x); return m ? m.t : null; }
  /** 流す範囲。dur：動画の長さ。何も決めない時は全部・くり返す。終わりが始めより前なら終わりは動画の終わり */
  function rangeOf(vs, dur) {
    const d = typeof dur === 'number' && isFinite(dur) && dur > 0 ? dur : Infinity;
    let start = secOf(vs, vs && vs.start); if (start == null || start >= d) start = 0;
    let end = secOf(vs, vs && vs.end); if (end == null || end <= start || end > d) end = d;
    let from = secOf(vs, vs && vs.from); if (from == null || from < start || from >= end) from = start;
    return { start, end, loop: !(vs && vs.loop === false), from };
  }
  /** いまの時刻で何をするか：null（そのまま）・秒（そこへ）・'stop'（止める）。終わりを 0.05秒すぎたら */
  function loopStep(cur, R) {
    if (cur < R.start - 0.05) return R.start;
    if (cur >= R.end - 0.02) return R.loop ? R.start : 'stop';
    return null;
  }
  /** 自動で回す時の「1回分」（秒）＝範囲の長さ */
  function rotSec(vs, dur) { const R = rangeOf(vs, dur); return isFinite(R.end) ? Math.round((R.end - R.start) * 10) / 10 : null; }

  const api = { asobiOwner, muted, plan, pickDisplays, homeDisplay, sideOf, chimeCounts, placeStep, CHIME_QUIET_MS,
    cleanVset, rangeOf, loopStep, rotSec, secOf, MARK_NAME_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TvsLogic = api;
})(typeof self !== 'undefined' ? self : globalThis);
