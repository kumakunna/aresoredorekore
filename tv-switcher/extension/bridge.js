// bridge.js — 「休けい」のタブ（サーバーの /tvs/screen?tv=N）に入る content script（指示69）
//
// ページ（screen.html）と拡張機能の裏の処理（background.js）の間を取り次ぐだけ。
// 一覧をそろえる時（sync）だけ、あそびまちの URL をここで読んで裏の処理に直接渡す。
// **URL はページには渡さない**（content script はページの JS から見えない別の世界で動く・指示69 2-4）

(function () {
  'use strict';
  async function asobiUrl() {
    try {
      const r = await fetch('/api/tvs/asobi', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return undefined;
      const j = await r.json();
      return typeof j.url === 'string' ? j.url : '';
    } catch (e) { return undefined; }
  }
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.tvsTo !== 'ext') return;
    const { id, msg } = ev.data;
    let res = null;
    try {
      const m = Object.assign({}, msg);
      if (m.t === 'sync') { const u = await asobiUrl(); if (u !== undefined) m.asobiUrl = u; }
      res = await chrome.runtime.sendMessage(m);
    } catch (e) { res = null; }   // 拡張機能が止まった・入れ直した
    window.postMessage({ tvsFrom: 'ext', id, res }, location.origin);
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m && m.push) window.postMessage({ tvsFrom: 'ext', push: m.push }, location.origin);
  });
})();
