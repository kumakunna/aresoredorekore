// notice.js — お知らせの一言（指示69 二の束）。TV の窓の、どのタブの上にも、下に字の帯を出す。
// TV の窓でなければ何も出さない（裏の処理が空を返す）。ページの中身にはさわらない（閉じた shadow root の中だけ）

(function () {
  'use strict';
  if (window.top !== window) return;
  let host = null, box = null;
  function draw(text) {
    const t = String(text || '');
    if (!t) { if (host) host.style.display = 'none'; return; }
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-tvs-notice', '');
      host.style.cssText = 'all:initial;position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = '<style>div{box-sizing:border-box;width:100%;padding:1.2vh 3vw;background:rgba(26,26,26,.92);color:#fff;' +
        'font:800 4.2vh/1.3 system-ui,"Hiragino Sans",sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><div></div>';
      box = root.querySelector('div');
      (document.body || document.documentElement).appendChild(host);
    }
    box.textContent = t;   // 字のまま（HTML として動かさない）
    host.style.display = '';
    host.setAttribute('data-text', t);
  }
  chrome.runtime.onMessage.addListener((m) => { if (m && m.t === 'notice') draw(m.text); });
  // 指示75 3-2：窓の大きさが変わった（全画面が外れた・別の画面へ動いた）→ 裏の処理に置き直しを頼む（TV の窓でなければ裏の処理が何もしない）。
  // 窓の「状態」が変わっただけでは chrome.windows.onBoundsChanged が来ないので、見えているページの resize で知る
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { try { chrome.runtime.sendMessage({ t: 'place-check' }).catch(() => {}); } catch (e) {} }, 150); });
  try { chrome.runtime.sendMessage({ t: 'notice-get' }).then((r) => draw(r && r.text)).catch(() => {}); } catch (e) {}
})();
