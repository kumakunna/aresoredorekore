// tvs-routes.js — TV の切りかえ（指示69）。係のスマホ（リモコン）と、TV の PC の Chrome（拡張機能）をつなぐ
//
//   GET /tvs               … リモコン（係のスマホ）
//   GET /tvs/items         … 出す物の一覧（係の画面）
//   GET /tvs/mark          … TV 専用の Chrome の印（指示75 3-8・ログイン不要・字だけ）
//   GET /tvs/log           … 切りかえの記録の全部（指示75 2-10・検索としぼり込み）
//   GET /tvs/screen?tv=N   … TV の PC の「休けい」のタブ。サーバーとつながり、拡張機能に伝える役（指示69 2-1）
//   GET /api/tvs/asobi     … あそびまちの URL（key 付き）。**拡張機能だけが**休けいのタブから読む。リモコンは読まない
//   socket.io の /tvs      … 係のログインが無いと、つながらない
//
// 門は文化祭の係と同じ（io.fesRoleOf・.env の FES_OWNER・FES_STAFF）。ログインが無ければ 401、係でなければ 403。
// **あそびまちの URL は、ログ・リモコン・画面に出さない**（指示69 2-4）。
// TV ごとの今の画面は tvs-store.js（SQLite）に覚えるので、作り直してももどる。部屋の進行（realtime.js・fes-room.js）には何もしない。
// 「いまゲーム中か」だけ io.fesPhase で読む（文化祭の部屋が「遊ぶ」の段＝3-2-1 と遊んでいる間）
// 二の束：自動（回す・呼び出し・人が入った）は tvs-auto.js が決め、ここが1秒ごとに聞いて出す。サーバーの時計で回す（TV の PC の裏のタイマーに頼らない）

'use strict';

const fs = require('fs');
const path = require('path');
const { createTvsStore } = require('./tvs-store');
const { createAuto } = require('./tvs-auto');

const PAGES = path.join(__dirname, 'tv-switcher', 'pages');
const PING_MS = 10000;
const TICK_MS = 1000;       // 自動を見る間
// 記録の「だれが」：係はアカウントの名前、自動はその理由
const WHY = { auto: '自動で回す', chime: 'あそびまちの呼び出し', 'chime-end': '呼び出しのあと', fes: 'あつまれに人が入った', 'tv-pc': 'TV の PC', system: '出す物を消した' };      // TV の PC へ「生きているか」を聞く間（返事は受けた時にすぐ返す作り＝裏のタブでも遅れない）
const GAME_PHASES = ['play'];

function mountTvs(app, io, opts) {
  const o = opts || {};
  const store = o.store || createTvsStore(o.db);
  const asobiUrl = () => (o.asobiUrl !== undefined ? o.asobiUrl : process.env.TVS_ASOBI_URL) || '';
  const now = o.now || (() => Date.now());
  const roleOf = (uid) => (uid && io.fesRoleOf ? io.fesRoleOf(uid) : null);
  const auto = createAuto();
  let durations = {};   // PC の動画の長さ（秒・拡張機能が教える）。「1回分」に使う
  try { store.purge(now()); } catch (e) { console.error('[tvs] 記録の掃除で例外:', e); }

  // ---- HTTP ----
  function pageGate(req, res) {
    const uid = req.session && req.session.userId;
    if (!uid) { res.status(401).type('html').send(gatePage('ログインしてください', '係のアカウントでログインしてから、もう一度開いてください。')); return false; }
    if (!roleOf(uid)) { res.status(403).type('html').send(gatePage('見られません', 'この画面は、係のアカウントだけが見られます。')); return false; }
    return true;
  }
  const send = (file) => (req, res) => {
    if (!pageGate(req, res)) return;
    res.set('Cache-Control', 'no-store').type('html').send(fs.readFileSync(path.join(PAGES, file), 'utf8'));
  };
  app.get('/tvs', send('remote.html'));
  app.get('/tvs/items', send('items.html'));
  app.get('/tvs/screen', send('screen.html'));
  // 指示75 3-8：TV 専用の Chrome の印のページ。「あつまれ TV」（TVを開く.cmd・ショートカット）が起動のたびに開き、拡張機能（tv-mark.js）が
  // 「このプロフィールは TV 専用」と覚えてタブを閉じる。ログインは要らない（字だけ・あそびまちの事も係の事も何も出さない）
  app.get('/tvs/mark', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(gatePage('TV 専用の Chrome', 'この Chrome を TV 専用として覚えました。このタブは自分で閉じます。')));
  // 指示75 2-10（くまくんの決め）：切りかえの記録の全部（1か月）。だれが・何を（字で検索）・TV でしぼる・時刻でしぼる。リモコンの下の「ぜんぶ見る」から
  app.get('/tvs/log', (req, res) => {
    if (!pageGate(req, res)) return;
    const F = require('./fes-routes');
    const f = F.filterOf(req);
    const names = {}; store.items().forEach((it) => { names[it.id] = it.name; });
    const all = store.listLog(5000).map((r) => ({ at: r.at, who: whoName(r.who), tv: r.tv, item: names[r.item] || r.item }));
    const rows = F.applyFilter(all, f, (r) => r.who + ' ' + r.item, (r) => String(r.tv), (r) => r.at);
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const when = (at) => { const d = new Date(+at + 9 * 3600 * 1000); const z = (n) => (n < 10 ? '0' : '') + n; return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds()); };
    const body = F.filterForm('/tvs/log', f, [['1', 'TV①'], ['2', 'TV②']], 'だれが・何を で検索') +
      '<p class="n">' + rows.length + '件 / ' + all.length + '件・1か月より前のものは消えます・<a href="/tvs">リモコンへ</a></p>' +
      '<table><thead><tr><th>いつ</th><th>TV</th><th>何を</th><th>だれが</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td>' + when(r.at) + '</td><td>TV' + (r.tv === 2 ? '②' : '①') + '</td><td>' + esc(r.item) + '</td><td>' + esc(r.who) + '</td></tr>').join('') + '</tbody></table>';
    res.set('Cache-Control', 'no-store').type('html').send(F.namesPage('切りかえの記録', body));
  });
  app.get('/api/tvs/asobi', (req, res) => {
    const uid = req.session && req.session.userId;
    if (!uid) return res.status(401).json({ error: 'ログインしてください' });
    if (!roleOf(uid)) return res.status(403).json({ error: '見られません' });
    res.set('Cache-Control', 'no-store').json({ url: asobiUrl() || null });
  });

  // ---- つなぎ（socket.io の /tvs）----
  const nsp = io.of('/tvs');
  nsp.use((socket, next) => {
    const uid = socket.request && socket.request.session && socket.request.session.userId;
    if (!uid) return next(new Error('login'));
    const role = roleOf(uid);
    if (!role) return next(new Error('forbidden'));
    socket.data.uid = uid; socket.data.role = role;
    next();
  });

  // TV ごとの「いま」（メモリ）：つながっている休けいのタブ・最後の連絡・拡張機能が生きているか・映っている物・開き直しが要るか
  const live = { 1: blankLive(), 2: blankLive() };
  let seq = 0;
  let have = {};   // PC の画像・動画があるか（拡張機能が教える）。{ 物の id: true/false }
  function blankLive() { return { sockets: new Set(), seen: 0, ext: false, shown: null, shownSeq: 0, stuck: false }; }

  function state() {
    const sc = store.screens();
    const items = store.items().map((it) => ({ id: it.id, name: it.name, kind: it.kind, tvs: it.tvs, sound: it.sound, builtin: it.builtin,
      have: it.kind === 'asobi' ? !!asobiUrl() : (it.kind === 'images' || it.kind === 'video') ? (it.id in have ? !!have[it.id] : null) : true }));
    const tvs = {};
    [1, 2].forEach((tv) => {
      const L = live[tv];
      tvs[tv] = { item: sc[tv].item, prev: sc[tv].prev, connected: L.sockets.size > 0, ext: L.sockets.size > 0 && L.ext, side: L.side || null,
        seen: L.seen || null, shown: L.shown, stuck: L.stuck };
    });
    return { items, tvs, playing: isPlaying(), settings: store.settings(), log: store.listLog(10).map((r) => ({ at: r.at, who: whoName(r.who), tv: r.tv, item: r.item })) };
  }
  function whoName(w) {
    const m = /^(owner|staff):([0-9]+)$/.exec(String(w || ''));
    if (!m) return WHY[w] || String(w || '');
    try {
      const u = o.db && o.db.prepare('SELECT display_name, username FROM users WHERE id = ?').get(Number(m[2]));
      if (u) return u.display_name || u.username;
    } catch (e) {}
    return '係';
  }
  function ctx() { return { now: now(), settings: store.settings(), screens: store.screens(), phase: io.fesPhase ? io.fesPhase() : null, items: state().items, durations }; }
  /** 自動が決めた切りかえを出す */
  function perform(actions) {
    if (!actions.length) return;
    for (const a of actions) { store.setScreen(a.tv, a.item, a.why, now()); apply(a.tv); }
    broadcast();
  }
  /** 休けいのタブへ：休けいの字と、その TV のお知らせの一言 */
  function look(tv) { const S = store.settings(); return { rest: S.rest, notice: S.notice[tv] || '' }; }
  const sendLooks = () => [1, 2].forEach((tv) => nsp.to('screen:' + tv).emit('tvs:look', look(tv)));
  function isPlaying() { const p = io.fesPhase ? io.fesPhase() : null; return GAME_PHASES.indexOf(p) !== -1; }
  const broadcast = () => nsp.to('remote').emit('tvs:state', state());
  /** 休けいのタブ（TV の PC）に、出す物の一覧を渡す。URL の物はここで URL を付ける（あそびまちは付けない：拡張機能が自分で読む） */
  function screenItems() {
    return store.items().map((it) => ({ id: it.id, name: it.name, kind: it.kind, url: it.kind === 'url' ? it.url : null, tvs: it.tvs, sound: it.sound }));
  }
  function apply(tv) {
    const s = ++seq;
    const item = store.screens()[tv].item;
    nsp.to('screen:' + tv).emit('tvs:apply', { item, seq: s });
    return s;
  }
  function who(socket) { return socket.data.role + ':' + socket.data.uid; }
  const ok = (cb, v) => { if (typeof cb === 'function') cb(Object.assign({ ok: true }, v || {})); };
  const ng = (cb, error) => { if (typeof cb === 'function') cb({ ok: false, error }); };

  /** 切りかえの共通（出す物を押した・さっきの画面にもどす）。ゲーム中のあつまれから離れる時だけ確かめる（指示69 2-2） */
  function change(socket, tv, id, force, cb) {
    tv = Number(tv);
    if (tv !== 1 && tv !== 2) return ng(cb, 'bad_tv');
    const it = store.item(id);
    if (!it || it.tvs.indexOf(tv) === -1) return ng(cb, 'bad_item');
    const cur = store.screens()[tv].item;
    if (cur === 'fes' && it.id !== 'fes' && !force && isPlaying()) return ng(cb, 'confirm');
    store.setScreen(tv, it.id, who(socket), now());
    // 係が出す物のボタンを押したら、その TV の自動は切（指示69 二の束）
    if (store.settings().auto[tv]) store.setSettings({ auto: { [tv]: false } });
    auto.reset(tv);
    const s = apply(tv);
    broadcast();
    ok(cb, { seq: s });
  }

  nsp.on('connection', (socket) => {
    const a = socket.handshake.auth || {};
    const tv = Number(a.tv);
    if (a.as === 'screen' && (tv === 1 || tv === 2)) {
      // ---- TV の PC の休けいのタブ ----
      const L = live[tv];
      L.sockets.add(socket); L.seen = now();
      socket.join('screen:' + tv);
      socket.on('tvs:hello', (p, cb) => {
        L.ext = !!(p && p.ext); L.seen = now();
        if (p && p.have && typeof p.have === 'object') have = Object.assign({}, have, clean(p.have));
        const sc = store.screens()[tv];
        if (p && p.durations) durations = Object.assign({}, durations, cleanNum(p.durations));
        ok(cb, { items: screenItems(), item: sc.item, seq: ++seq, look: look(tv) });
        broadcast();
      });
      socket.on('tvs:pong', (p) => {
        L.seen = now();
        L.ext = !!(p && p.ext);
        if (p && p.have && typeof p.have === 'object') have = Object.assign({}, have, clean(p.have));
        if (p && typeof p.stuck === 'boolean') L.stuck = p.stuck;
        if (p && p.durations) durations = Object.assign({}, durations, cleanNum(p.durations));
        // 指示75 3-7：その TV が左か右か（拡張機能が「はじめる」の置き場所から教える）。左右のほかの字は受けとらない
        if (p && (p.side === 'left' || p.side === 'right')) L.side = p.side;
        broadcast();
      });
      // 拡張機能が切りかえ終わった（返事）。リモコンに「変わりました」
      socket.on('tvs:shown', (p) => {
        L.seen = now(); L.ext = true;
        L.shown = p && p.item ? String(p.item) : null;
        L.shownSeq = Number(p && p.seq) || 0;
        nsp.to('remote').emit('tvs:ack', { tv, seq: L.shownSeq, item: L.shown });
        broadcast();
      });
      // TV の PC で手で切りかえた（Ctrl+1〜5）。サーバーの「今の画面」もそれに合わせる
      socket.on('tvs:manual', (p) => {
        L.seen = now();
        const it = p && store.item(p.item);
        if (!it) return;
        L.shown = it.id;
        if (store.screens()[tv].item !== it.id) { store.setScreen(tv, it.id, 'tv-pc', now()); auto.reset(tv); }
        broadcast();
      });
      // 拡張機能が、あそびまちのタブの音の始まりを見つけた（呼び出しのチャイム）
      socket.on('tvs:chime', () => { L.seen = now(); perform(auto.chime(ctx())); });
      socket.on('tvs:stuck', (p) => { L.stuck = !!(p && p.on); L.seen = now(); broadcast(); });
      socket.on('disconnect', () => { L.sockets.delete(socket); if (!L.sockets.size) { L.ext = false; L.stuck = false; } broadcast(); });
      return;
    }
    // ---- リモコン・係の画面 ----
    socket.join('remote');
    socket.emit('tvs:state', state());
    socket.on('tvs:show', (p, cb) => change(socket, p && p.tv, p && p.item, !!(p && p.force), cb));
    socket.on('tvs:back', (p, cb) => {
      const t = Number(p && p.tv);
      const sc = store.screens()[t];
      if (!sc || !sc.prev) return ng(cb, 'no_prev');
      change(socket, t, sc.prev, !!(p && p.force), cb);
    });
    socket.on('tvs:reload', (p, cb) => {
      const t = Number(p && p.tv);
      if (t !== 1 && t !== 2) return ng(cb, 'bad_tv');
      nsp.to('screen:' + t).emit('tvs:reload', { item: 'fes' });
      ok(cb);
    });
    socket.on('tvs:items:add', (p, cb) => {
      const r = store.addItem(p, now());
      if (r.error) return ng(cb, r.error);
      nsp.to('screen:1').to('screen:2').emit('tvs:items', { items: screenItems() });
      broadcast(); ok(cb, { item: r.item });
    });
    socket.on('tvs:items:remove', (p, cb) => {
      if (!store.removeItem(p && p.id, now())) return ng(cb, 'cannot');
      nsp.to('screen:1').to('screen:2').emit('tvs:items', { items: screenItems() });
      [1, 2].forEach(apply);
      broadcast(); ok(cb);
    });
    socket.on('tvs:items:update', (p, cb) => {
      const it = store.updateItem(p && p.id, p || {});
      if (!it) return ng(cb, 'cannot');
      nsp.to('screen:1').to('screen:2').emit('tvs:items', { items: screenItems() });
      broadcast(); ok(cb, { item: it });
    });
    socket.on('tvs:auto', (p, cb) => {
      const t = Number(p && p.tv);
      if (t !== 1 && t !== 2) return ng(cb, 'bad_tv');
      store.setSettings({ auto: { [t]: !!(p && p.on) } });
      auto.reset(t);
      broadcast(); ok(cb);
      perform(auto.tick(ctx()));   // 入にしたら、すぐ回し始める
    });
    socket.on('tvs:settings', (p, cb) => {
      const changed = store.setSettings({ rot: p && p.rot, chime: p && p.chime, fesBack: p && p.fesBack, rest: p && p.rest, notice: p && p.notice });
      if (changed.indexOf('rot') !== -1) [1, 2].forEach((t) => auto.reset(t));
      if (changed.indexOf('rest') !== -1 || changed.indexOf('notice') !== -1) sendLooks();
      broadcast(); ok(cb, { changed });
    });
  });

  const ticker = setInterval(() => { try { perform(auto.tick(ctx())); } catch (e) { console.error('[tvs] 自動で例外:', e); } }, o.tickMs || TICK_MS);
  if (ticker.unref) ticker.unref();
  const timer = setInterval(() => {
    nsp.to('screen:1').to('screen:2').emit('tvs:ping', { at: now() });
    broadcast();   // 「最後に連絡があった時刻」と、ゲーム中かどうかを、リモコンに配り直す
  }, o.pingMs || PING_MS);
  if (timer.unref) timer.unref();

  return { store, nsp, state, tick: () => perform(auto.tick(ctx())), stop: () => { clearInterval(timer); clearInterval(ticker); } };
}

/** 拡張機能が教える「ある・ない」は、id と真偽だけにする */
function clean(h) {
  const out = {};
  Object.keys(h).slice(0, 20).forEach((k) => { if (/^[a-z0-9]{1,20}$/i.test(k)) out[k] = !!h[k]; });
  return out;
}
/** 拡張機能が教える動画の長さは、id と秒（0〜3600）だけにする */
function cleanNum(h) {
  const out = {};
  Object.keys(h || {}).slice(0, 20).forEach((k) => { const v = +h[k]; if (/^[a-z0-9]{1,20}$/i.test(k) && v > 0 && v <= 3600) out[k] = v; });
  return out;
}
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function gatePage(title, msg) {
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + esc(title) + '</title><style>body{margin:0;padding:24px 16px;font-family:system-ui,sans-serif;background:#FFF6DC;color:#1A1A1A}' +
    'h1{font-size:24px;margin:0 0 12px}p{font-size:17px;line-height:1.6}a{display:inline-block;margin-top:8px;padding:14px 20px;background:#1A1A1A;color:#fff;border-radius:12px;text-decoration:none;font-weight:700}</style></head>' +
    '<body><h1>' + esc(title) + '</h1><p>' + esc(msg) + '</p><a href="/">ログインへ</a></body></html>';
}

module.exports = { mountTvs, GAME_PHASES };
