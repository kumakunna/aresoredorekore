// tv-mark.js — 指示75 3-8：「あつまれ TV」（TV 専用の Chrome・TVを開く.cmd とデスクトップのショートカット）が起動のたびに開く /tvs/mark で、
// 拡張機能に「このプロフィールは TV 専用」と教える。印の無い Chrome（ふだんの Chrome）では「はじめる」を押せない（start.js）。
// ページの中身は読まない・何も送らない（印を付けるだけ。タブは裏の処理が閉じる）
(function () {
  'use strict';
  try { chrome.runtime.sendMessage({ t: 'tv-profile' }).catch(() => {}); } catch (e) {}
})();
