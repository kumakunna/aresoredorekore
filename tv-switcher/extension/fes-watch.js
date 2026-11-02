// fes-watch.js — あつまれの TV のタブ（/fes?tv=1 から飛んだ先）に入る content script（指示69 2-6）
//
// TV が隅に「F5 で開き直してください」（index.html fesTvWatch の [data-tv-stuck]）を出したら、裏の処理に知らせる。
// リモコンに「あつまれの開き直しが要ります［開き直す］」が出る。消えたら、それも知らせる。読むだけで、ページには何もしない

(function () {
  'use strict';
  if (!/[?&]tv=1(&|$)/.test(location.search)) return;
  let last = false;
  function check() {
    const on = !!document.querySelector('[data-tv-stuck]');
    if (on === last) return;
    last = on;
    try { chrome.runtime.sendMessage({ t: 'fes-stuck', on }).catch(() => {}); } catch (e) {}
  }
  new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
  check();
})();
