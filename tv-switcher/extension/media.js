// media.js — media.html の中身（指示69）。画像は 8秒ごとに次へ（切りかえは一瞬・2-8）。動画はくり返し。
// 音は、タブの音の入／切（background.js の決まり）で決める。ページの中では鳴らせる形にしておく。
// 鳴らせない時（Chrome が「人が押すまで音を出さない」とした時）は、音を消して流し続ける（止まった画面にしない）

(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const id = q.get('id'), kind = q.get('kind');
  const box = document.getElementById('box'), none = document.getElementById('none');
  const SLIDE_MS = 8000;
  let timer = null, urls = [];

  async function draw() {
    clearInterval(timer);
    urls.forEach((u) => URL.revokeObjectURL(u));
    box.innerHTML = '';
    const files = await MediaDb.get(id);
    urls = files.map((f) => URL.createObjectURL(f.blob));
    none.style.display = urls.length ? 'none' : 'flex';
    if (!urls.length) return;
    if (kind === 'video') {
      const v = document.createElement('video');
      // 指示75 4-4：くり返しは、範囲（始め〜終わり）を見てここで回す（video.loop は動画の全部しか回せない）
      v.src = urls[0]; v.loop = false; v.playsInline = true; v.muted = false;
      video = v;
      // 長さを裏の処理に教える（自動で回す時の「1回分」）
      v.addEventListener('loadedmetadata', () => { if (isFinite(v.duration)) chrome.runtime.sendMessage({ t: 'duration', id, sec: Math.round(v.duration * 10) / 10 }).catch(() => {}); });
      // 出せないファイル（形がちがう・こわれている）の時は、黒い画面にせず「この動画は出せません」
      v.addEventListener('error', () => { none.textContent = 'この動画は出せません'; none.style.display = 'flex'; });
      box.appendChild(v);
      v.addEventListener('loadedmetadata', () => { const R = range(); if (v.currentTime < R.start || v.currentTime >= R.end) v.currentTime = R.from; });
      v.addEventListener('ended', () => { const R = range(); if (R.loop) { v.currentTime = R.start; v.play().catch(() => {}); } });
      // 何が起きたかを残す（検証の道具が読む・window.__play）
      window.__play = [];
      ['playing', 'pause', 'volumechange'].forEach((k) => v.addEventListener(k, () => window.__play.push(k + (k === 'volumechange' ? ':' + v.muted : ''))));
      v.play().then(() => window.__play.push('play-ok')).catch((e) => {
        window.__play.push('play-ng:' + (e && e.name));
        v.muted = true;
        v.play().then(() => window.__play.push('muted-play-ok')).catch((e2) => window.__play.push('muted-play-ng:' + (e2 && e2.name)));
      });
      return;
    }
    const imgs = urls.map((u, i) => { const im = document.createElement('img'); im.src = u; if (!i) im.className = 'on'; box.appendChild(im); return im; });
    let k = 0;
    if (imgs.length > 1) timer = setInterval(() => { imgs[k].className = ''; k = (k + 1) % imgs.length; imgs[k].className = 'on'; }, SLIDE_MS);
  }
  // ---- 指示75 束4：印・範囲とくり返し・はじめの位置・リモコンからの操作 ----
  let video = null, vset = null;
  const range = () => TvsLogic.rangeOf(vset || {}, video && isFinite(video.duration) ? video.duration : null);
  chrome.runtime.sendMessage({ t: 'vset-get', id }).then((r) => { vset = (r && r.vset) || null; }).catch(() => {});
  // 範囲の終わりで始めにもどる（くり返し切なら止める）。50ms ごと＝前後 0.05秒ほど（門は 0.3秒以内）
  setInterval(() => {
    if (!video || video.paused || video.readyState < 1) return;
    const step = TvsLogic.loopStep(video.currentTime, range());
    if (step === 'stop') video.pause();
    else if (step != null) video.currentTime = step;
  }, 50);
  // 見えた時（TV に出た時）は、はじめの位置から流す（4-5「ここから流す」）。裏の間は止めておく（音の決まりは background.js）
  document.addEventListener('visibilitychange', () => {
    if (!video) return;
    if (document.visibilityState === 'visible') { video.currentTime = range().from; video.play().catch(() => {}); }
  });
  // いまの時刻を1秒ごとに（見えている時だけ）：裏の処理 → 休けいのタブ → サーバー → リモコン
  setInterval(() => {
    if (!video || document.visibilityState !== 'visible') return;
    chrome.runtime.sendMessage({ t: 'video-time', id, cur: video.currentTime, dur: isFinite(video.duration) ? video.duration : null, paused: video.paused }).catch(() => {});
  }, 1000);
  // 「はじめる」の画面でえらび直したら、その物だけ出し直す（ページは開き直さない）。印・範囲が変わったら覚え直す。リモコンからの操作
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (m && m.t === 'media-changed' && m.id === id) draw();
    if (m && m.t === 'vset' && m.id === id) vset = m.vset;
    if (m && m.t === 'video' && video) {
      const R = range();
      if (m.op === 'seek' && typeof m.at === 'number') { video.currentTime = Math.min(Math.max(m.at, 0), isFinite(video.duration) ? video.duration : m.at); video.play().catch(() => {}); }
      if (m.op === 'play') video.play().catch(() => {});
      if (m.op === 'pause') video.pause();
      if (m.op === 'skip') video.currentTime = Math.min(Math.max(video.currentTime + (m.by || 0), R.start), R.end - 0.1);
      window.__ops = (window.__ops || []).concat([{ op: m.op, at: Date.now() }]);
      reply({ ok: true, cur: video.currentTime });
      return true;
    }
    return false;
  });
  draw();
  // 指示75 3-2：窓の大きさが変わった → 裏の処理に置き直しを頼む（notice.js と同じ。拡張機能のページには notice.js が入らないので、ここでも）
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { chrome.runtime.sendMessage({ t: 'place-check' }).catch(() => {}); }, 150); });
})();
