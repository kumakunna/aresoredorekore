// start.js — 「はじめる」の画面（指示69）。むずかしい所は background.js がする。ここはボタンと、画像・動画をえらぶ所だけ
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const send = (m) => chrome.runtime.sendMessage(m);
  let items = [];

  async function refresh() {
    const s = await send({ t: 'status' });
    if (!s) return;
    if (!$('server').value) $('server').value = s.server;
    $('wins').innerHTML = [1, 2].map((n) => 'TV' + (n === 1 ? '①' : '②') + '：' + (s.windows[n] ? '<span class="ok">出ています</span>' : '<span class="ng">出ていません</span>')).join('　') +
      (s.swapped ? '（入れかえ中）' : '');
    $('loginLink').href = s.server + '/';
    $('login').style.display = s.windows[1] && !s.items.length ? 'block' : 'none';
    $('asobiNo').textContent = s.items.length && !s.asobi ? 'サーバーに、あそびまちのアドレスがまだありません' : '';
    const key = JSON.stringify(s.items.map((it) => it.id + it.kind));
    if (key !== JSON.stringify(items.map((it) => it.id + it.kind))) { items = s.items; drawMedia(); }
  }
  async function drawMedia() {
    const list = items.filter((it) => it.kind === 'images' || it.kind === 'video');
    const box = $('media');
    box.innerHTML = list.length ? '' : '<p>「はじめる」を押すと出ます。</p>';
    for (const it of list) {
      const files = await MediaDb.get(it.id);
      const row = document.createElement('div');
      row.className = 'box row';
      const label = document.createElement('span');
      label.textContent = it.name + '：' + (files.length ? files.map((f) => f.name).join('、') : 'まだありません');
      const input = document.createElement('input');
      input.type = 'file'; input.accept = it.kind === 'video' ? 'video/*' : 'image/*'; input.multiple = it.kind === 'images';
      input.addEventListener('change', async () => {
        const fs = Array.from(input.files || []).map((f) => ({ name: f.name, type: f.type, blob: f }));
        if (!fs.length) return;
        await MediaDb.put(it.id, it.kind === 'video' ? fs.slice(0, 1) : fs);
        await send({ t: 'media-changed', id: it.id });
        drawMedia();
      });
      row.appendChild(label); row.appendChild(input);
      box.appendChild(row);
    }
  }

  $('start').addEventListener('click', async () => {
    $('msg').textContent = '開いています…';
    const me = await chrome.windows.getCurrent();
    const r = await send({ t: 'start', server: $('server').value.trim(), windowId: me.id });
    $('msg').textContent = r && r.ok ? '' : 'うまくいきませんでした';
    setTimeout(refresh, 1500);
  });
  $('swap').addEventListener('click', () => send({ t: 'swap' }).then(refresh));
  $('asobi').addEventListener('click', async () => { await send({ t: 'asobi-guide' }); $('guide').style.display = 'block'; });
  $('asobiDone').addEventListener('click', async () => { await send({ t: 'asobi-done' }); $('guide').style.display = 'none'; });
  refresh();
  setInterval(refresh, 3000);
})();
