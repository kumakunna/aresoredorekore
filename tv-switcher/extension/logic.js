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

  const api = { asobiOwner, muted, plan, pickDisplays, homeDisplay, sideOf, chimeCounts, placeStep, CHIME_QUIET_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TvsLogic = api;
})(typeof self !== 'undefined' ? self : globalThis);
