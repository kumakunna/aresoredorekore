// tools/v2-lab/page.js — 見本データで新しい見た目の画面を開く、ページの中の台本（指示66-1）
//
// **本番には無い。**検証用サーバー（tools/dev-server.js の /v2lab）と撮る道具（tools/v2-shot.js）だけが、
// index.html の最後にこの台本と見本データ（window.__V2LAB_VIEW）を差し込んで配る。
// アプリの側に入口は無い（index.html は window.V2Screens で「描く」ことだけを許している）。
//
//   /v2lab?scene=fes-lobby&n=6        … 待合のスマホ（6人）
//   /v2lab?scene=fes-tv&n=16          … 待合のTV（16人）
//   &long=1   長い名前   &cd=4   のこり4秒（5秒以下の赤い札）   &freeze=23   のこりを23で止める（撮る時）
//
// 入口（扉）を通ったあとで描く——扉の演出は時間で次の画面へ移るので、先に描くと上書きされる。
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var sceneId = q.get('scene') || 'fes-lobby';
  var info = (window.__V2LAB_SCENES || []).filter(function (s) { return s.id === sceneId; })[0];
  window.V2Lab = { ready: false, scene: sceneId, error: null };
  // 初回の安全の案内は、見本では飛ばす（その画面そのものは 66-2 の F1 で撮る）
  try { localStorage.setItem('acac-safety-seen', '1'); } catch (e) {}

  function 描く() {
    var view = window.__V2LAB_VIEW;
    if (!info || !view || !window.V2Screens) { window.V2Lab.error = '見本データか画面が見つかりません: ' + sceneId; return; }
    view.joinUrl = location.origin + '/?room=' + view.code;
    if (q.get('freeze') != null && window.V2) V2.freeze(+q.get('freeze'));
    window.V2Screens[info.draw](view);
    window.goToScreen(info.screen);
    // 描いたあと、画面の箱が見えてから合わせる（TV の縮め・名前の縮め）
    setTimeout(function () {
      var scr = document.getElementById(info.screen);
      if (scr && window.V2) { V2.fitTv(scr); V2.relayout(scr); }
      window.V2Lab.ready = true;
    }, 60);
  }
  var t0 = Date.now();
  (function 待つ() {
    var a = document.querySelector('.screen.active');
    // 扉が開いて入口（またはログイン）に着いたら描く。8秒待っても着かなければ、そのまま描く
    if (a && a.id !== 'scr-door') return 描く();
    if (Date.now() - t0 > 8000) return 描く();
    setTimeout(待つ, 60);
  })();
})();
