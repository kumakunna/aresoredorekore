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
    // 指示75 3-8：TV 専用の Chrome でない所では、大きく言って「はじめる」を押せなくする
    $('notTv').style.display = s.tvProfile ? 'none' : 'block';
    $('start').disabled = !s.tvProfile;
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
        // 指示75 4-2：動画を入れかえたら、前の動画の印は消す（ちがう動画の時刻を指してしまう）
        if (it.kind === 'video') await send({ t: 'vset', id: it.id, vset: {} });
        drawMedia();
      });
      row.appendChild(label); row.appendChild(input);
      box.appendChild(row);
      if (it.kind === 'video' && files.length) box.appendChild(await markEditor(it, files[0]));
    }
  }

  // ---- 指示75 4-2・4-4・4-5（くまくんの決め）：動画の小さな見本と「ここに印」・印の一覧（名前を直す・消す・並べかえ）・流す範囲とくり返し・ここから流す ----
  // 印は動画といっしょにこの PC に覚える（裏の処理の vset）。サーバーには名前と時刻だけ（リモコンに出すため）
  const fmt = (t) => { if (t == null || !isFinite(t)) return '-'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
  const el = (tag, attrs, text) => { const e = document.createElement(tag); Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k])); if (text != null) e.textContent = text; return e; };
  async function markEditor(it, file) {
    const st = await send({ t: 'status' });
    let vs = TvsLogic.cleanVset((st && st.vset && st.vset[it.id]) || {});
    const wrap = el('div', { class: 'box marks', 'data-marks': it.id });
    const v = el('video', { class: 'prev', preload: 'metadata', playsinline: '' });
    v.muted = true; v.src = URL.createObjectURL(file.blob);
    const now = el('span', { class: 'now' }, '0:00.0');
    const ctl = el('div', { class: 'row' });
    const btn = (label, fn, cls) => { const b = el('button', { type: 'button', class: cls || '' }, label); b.addEventListener('click', fn); return b; };
    ctl.append(btn('再生／止める', () => (v.paused ? v.play() : v.pause())), btn('5秒もどす', () => { v.currentTime = Math.max(0, v.currentTime - 5); }),
      btn('5秒すすめる', () => { v.currentTime = Math.min(v.duration || 0, v.currentTime + 5); }), now);
    v.addEventListener('timeupdate', () => { now.textContent = fmt(v.currentTime) + ' / ' + fmt(v.duration); });
    const name = el('input', { type: 'text', maxlength: String(TvsLogic.MARK_NAME_MAX), placeholder: '印の名前（例：あいさつ）' });
    const add = el('div', { class: 'row' });
    add.append(name, btn('ここに印', () => { vs.marks.push({ id: 'k' + Date.now().toString(36), name: name.value.trim() || ('印' + (vs.marks.length + 1)), t: v.currentTime }); name.value = ''; save(); }, 'pri'));
    const list = el('ol', { class: 'mlist' });
    const rng = el('div', { class: 'rng' });
    async function save() {
      const r = await send({ t: 'vset', id: it.id, vset: vs });
      if (r && r.vset) vs = r.vset;
      draw();
    }
    function opts(sel, cur, first) {
      sel.innerHTML = '';
      sel.append(el('option', { value: '' }, first));
      vs.marks.forEach((m) => { const o = el('option', { value: m.id }, m.name + '（' + fmt(m.t) + '）'); if (cur === m.id) o.selected = true; sel.append(o); });
      if (typeof cur === 'number') { const o = el('option', { value: 'n:' + cur }, fmt(cur) + '（時刻）'); o.selected = true; sel.append(o); }
    }
    const pick = (val) => (!val ? null : (val.indexOf('n:') === 0 ? Number(val.slice(2)) : val));
    function draw() {
      list.innerHTML = '';
      vs.marks.forEach((m, i) => {
        const li = el('li');
        const nm = el('input', { type: 'text', maxlength: String(TvsLogic.MARK_NAME_MAX), value: m.name, 'aria-label': '印の名前' });
        nm.addEventListener('change', () => { m.name = nm.value.trim() || m.name; save(); });
        li.append(btn(fmt(m.t), () => { v.currentTime = m.t; }), nm,
          btn('↑', () => { if (i) { vs.marks.splice(i - 1, 0, vs.marks.splice(i, 1)[0]); save(); } }),
          btn('↓', () => { if (i < vs.marks.length - 1) { vs.marks.splice(i + 1, 0, vs.marks.splice(i, 1)[0]); save(); } }),
          btn('消す', () => { vs.marks.splice(i, 1); ['start', 'end', 'from'].forEach((k) => { if (vs[k] === m.id) vs[k] = null; }); save(); }));
        list.append(li);
      });
      if (!vs.marks.length) list.append(el('li', {}, 'まだ印がありません'));
      rng.innerHTML = '';
      const sStart = el('select', { 'aria-label': '始め' }), sEnd = el('select', { 'aria-label': '終わり' }), sFrom = el('select', { 'aria-label': 'ここから流す' });
      opts(sStart, vs.start, '動画のはじめ'); opts(sEnd, vs.end, '動画の終わり'); opts(sFrom, vs.from, '範囲のはじめ');
      const loop = el('input', { type: 'checkbox' }); loop.checked = vs.loop !== false;
      const lab = (t, x) => { const l = el('label'); l.append(t, x); return l; };
      sStart.addEventListener('change', () => { vs.start = pick(sStart.value); save(); });
      sEnd.addEventListener('change', () => { vs.end = pick(sEnd.value); save(); });
      sFrom.addEventListener('change', () => { vs.from = pick(sFrom.value); save(); });
      loop.addEventListener('change', () => { vs.loop = loop.checked; save(); });
      rng.append(lab('流す範囲：始め ', sStart), lab(' 終わり ', sEnd), btn('始めを今の時刻に', () => { vs.start = Math.round(v.currentTime * 10) / 10; save(); }),
        btn('終わりを今の時刻に', () => { vs.end = Math.round(v.currentTime * 10) / 10; save(); }), lab(' くり返す ', loop), lab(' ここから流す ', sFrom));
    }
    wrap.append(el('b', {}, it.name + 'の印'), v, ctl, add, list, rng);
    draw();
    return wrap;
  }

  $('start').addEventListener('click', async () => {
    $('msg').textContent = '開いています…';
    const me = await chrome.windows.getCurrent();
    const r = await send({ t: 'start', server: $('server').value.trim(), windowId: me.id });
    $('msg').textContent = r && r.ok ? '' : (r && r.error === 'not_tv_chrome' ? 'TV 専用の Chrome で開いてください' : 'うまくいきませんでした');
    setTimeout(refresh, 1500);
  });
  $('swap').addEventListener('click', () => send({ t: 'swap' }).then(refresh));
  $('asobi').addEventListener('click', async () => { await send({ t: 'asobi-guide' }); $('guide').style.display = 'block'; });
  $('asobiDone').addEventListener('click', async () => { await send({ t: 'asobi-done' }); $('guide').style.display = 'none'; });
  // 指示75 4-2：ファイルが変わった（ほかの「はじめる」の画面・裏から）→ 描き直す
  chrome.runtime.onMessage.addListener((m) => { if (m && m.t === 'media-redraw') drawMedia(); });
  refresh();
  setInterval(refresh, 3000);
})();
