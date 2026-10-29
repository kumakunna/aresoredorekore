// public/js/version.js — アプリの版（指示68-1）
//
// **版はここ1か所だけ。**サーバー（server.js・realtime.js・fes-store.js）と画面（index.html）の両方がここから読む。
// push のたびに 0.01 上げる（v2.00 → v2.01 → …）。上げるのは push するコミットの中で、報告に新しい版を書く。
// 出す所：⚙設定のいちばん下と係の画面（TV には出さない）。感想の記録とサーバーの起動・落ちた時の記録にも残す。
// 版が変わったら、サーバーがつながった端末に知らせ、古い画面のままの端末は待合にいる時だけ読み込み直す
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AppVersion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERSION = '2.09';
  return { VERSION: VERSION, label: 'v' + VERSION, name: 'あつまれ、あれこれ v' + VERSION };
});
