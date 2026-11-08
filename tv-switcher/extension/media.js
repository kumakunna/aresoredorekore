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
      v.src = urls[0]; v.loop = true; v.playsInline = true; v.muted = false;
      // 長さを裏の処理に教える（自動で回す時の「1回分」）
      v.addEventListener('loadedmetadata', () => { if (isFinite(v.duration)) chrome.runtime.sendMessage({ t: 'duration', id, sec: Math.round(v.duration * 10) / 10 }).catch(() => {}); });
      // 出せないファイル（形がちがう・こわれている）の時は、黒い画面にせず「この動画は出せません」
      v.addEventListener('error', () => { none.textContent = 'この動画は出せません'; none.style.display = 'flex'; });
      box.appendChild(v);
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
  // 「はじめる」の画面でえらび直したら、その物だけ出し直す（ページは開き直さない）
  chrome.runtime.onMessage.addListener((m) => { if (m && m.t === 'media-changed' && m.id === id) draw(); });
  draw();
  // 指示75 3-2：窓の大きさが変わった → 裏の処理に置き直しを頼む（notice.js と同じ。拡張機能のページには notice.js が入らないので、ここでも）
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { chrome.runtime.sendMessage({ t: 'place-check' }).catch(() => {}); }, 150); });
})();
