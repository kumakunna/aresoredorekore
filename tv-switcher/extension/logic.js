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
    if (ds.length >= 3) ds = ds.filter((d) => d.id !== startDisplayId);
    if (ds.length >= 2) return { 1: { bounds: ds[0].bounds, full: true }, 2: { bounds: ds[1].bounds, full: true } };
    const b = (ds[0] && ds[0].bounds) || { left: 0, top: 0, width: 1280, height: 720 };
    const w = Math.floor(b.width / 2);
    return { 1: { bounds: { left: b.left, top: b.top, width: w, height: b.height }, full: false },
      2: { bounds: { left: b.left + w, top: b.top, width: w, height: b.height }, full: false } };
  }

  const api = { asobiOwner, muted, plan, pickDisplays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TvsLogic = api;
})(typeof self !== 'undefined' ? self : globalThis);
