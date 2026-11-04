// asobi-start.js — あそびまちのモニターの「押すと始まります」を、拡張機能が1回押す（指示71 追記・くまくんの答え 2026-11-04）
//
// TV の PC の Chrome は --autoplay-policy=no-user-gesture-required で起動する（tv-switcher/TVを開く.cmd）。
// それでも、モニターのページは「押されるのを待つ」作り（div.mon-start を押すと、呼び出しのチャイムの音の箱を起こす）なので、ここが押す。
// あそびまちのコードと設定にはさわらない。押すのは .mon-start が出た時の1回だけ。ほかのページ（.mon-start が無い）では何もしない

(function () {
  'use strict';
  let done = false;
  function tryStart() {
    if (done) return true;
    const b = document.querySelector('.mon-start');
    if (!b) return false;
    done = true;
    b.click();
    return true;
  }
  if (tryStart()) return;
  const mo = new MutationObserver(() => { if (tryStart()) mo.disconnect(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 30000);   // 30秒たっても出なければ、見張りをやめる（あそびまち以外のページ）
})();
