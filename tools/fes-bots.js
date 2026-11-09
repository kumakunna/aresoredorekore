#!/usr/bin/env node
// tools/fes-bots.js — 文化祭の部屋に「テスト用プレイヤー」を入れて、ゲームを最後まで回す（11/7 の検査の準備 2）
//
//   node tools/fes-bots.js --serve --n 8 --laps 3                  … 手元に検証用サーバーを立て、係が部屋を作り、8人で3回遊ぶ
//   node tools/fes-bots.js --url http://localhost:3001 --n 5       … 立っている手元のサーバーの、いまの文化祭の部屋に5人入れる
//   node tools/fes-bots.js --serve --n 16 --min 30 --games bomb-coop,onaji-many,pittari,soroe,qhaya,qnear
//
// **向ける先は手元がいつも。本番は、はっきり指定した時だけ**：
//   localhost・127.0.0.1 以外の --url は、`--prod` を付けない限り走らない（何もつながない）。
//   本番では部屋を作らない（係のログインが無い）・入／切もしない。いまの部屋に入るだけ。
//   本番で使う前に、手順（docs/検査_1107/2_テスト用プレイヤー.md）の「止める条件」を読む。**11/7 はくまくんの決めで本番には入れない**
//
// プレイヤーは Node と socket.io-client だけ（ブラウザーは立てない）。1人＝1本の socket：
//   入る（名前・むずかしさ）→ 投票（候補から1つ）→ 準備OK → 遊ぶ → 結果で「つづける」 をくり返す。
//   心拍（hb:ping）に答える。外されたら（kicked）入り直す。--away で何人かを途中で黙らせる（25秒で「はなれた」・2分で外れる）
// 遊び方：
//   bomb（クイズ解除）・rcard … tools/bot-play/<id>.js（room-bots.js と同じ台本）
//   shinka … 手を出す段階でグー／チョキ／パー
//   onaji・qhaya … 選ぶ段階で、少し考えてから1つ選ぶ
//   pittari … 走っている段階で、10秒の前後（±1.5秒）で止める
//   soroe … 時計を合わせ（clock:sync・往復がいちばん短い回）、0 の時刻の前後（±0.4秒）で押す
//   qnear … 数を打つ（0〜9999）
//
// 記録（--out、既定 docs/検査_1107/fes-bots/<日時>/）：記録.json（回ごとのゲーム・かかった秒・人数）、
//   押してから返事（emit→ack）の ms を操作ごとに p50・p95・最大、つなぎ直しの回数、断られた返事（error）の数。
//   1分ごとに1行の様子を出す。--serve の時はサーバーのメモリー（RSS）も1分ごとに残す。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const SERVE = !!arg('serve', false);
const PORT = +arg('port', 3411);
const URL = String(arg('url', 'http://localhost:' + (SERVE ? PORT : 3001))).replace(/\/$/, '');
const N = +arg('n', 4);
const LAPS = +arg('laps', 0);              // 何回（結果まで行った回）遊んだら終わるか。0 なら --min まで
const MIN = +arg('min', LAPS ? 0 : 5);
const GAMES = arg('games', null) ? String(arg('games')).split(',') : null;   // 入にするゲーム（--serve か --create の時だけ）
const AWAY = +arg('away', 0);              // 途中で黙る人数（心拍に答えない・何も押さない）
const PROD = !!arg('prod', false);
const CREATE = SERVE || !!arg('create', false);
const PREFIX = String(arg('name', 'テスト'));
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '検査_1107', 'fes-bots', stamp)));
const QUIET = !!arg('quiet', false);
const VOTE = arg('vote', null) ? String(arg('vote')).split(',') : null;   // 投票するゲーム（まだ遊んでいない物を先に。候補に無ければ候補から1つ）

const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(URL);
if (!local && !PROD) { console.error('手元ではない先（' + URL + '）です。本番に入れる時だけ --prod を付けます（11/7 は入れない）。何もつながずに終わります'); process.exit(2); }
if (!local && CREATE) { console.error('本番では部屋を作らない・入／切しない（--serve・--create は手元だけ）'); process.exit(2); }

const t0 = Date.now();
const 分 = () => ((Date.now() - t0) / 60000).toFixed(1);
const log = (...a) => { if (!QUIET) console.log(String(分()).padStart(5) + '分 ' + a.join(' ')); };
const 記録 = { いつ: new Date().toISOString(), 先: URL, 人数: N, 回: [], 返事: {}, 断られた: {}, つなぎ直し: 0, 外された: 0, 入れない: [], メモリー: [], 終わり方: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---- 検証用サーバー（--serve） ----
let server = null;
async function サーバーを立てる() {
  fs.mkdirSync(OUT, { recursive: true });
  const memf = path.join(OUT, 'server-mem.jsonl');
  const pre = "const fs=require('fs');setInterval(()=>{try{fs.appendFileSync(process.env.BOTS_MEM,JSON.stringify(Object.assign({t:Date.now()},process.memoryUsage()))+'\\n')}catch(e){}},60000).unref();require(" + JSON.stringify(path.join(ROOT, 'tools', 'dev-server.js')) + ')';
  const out = fs.openSync(path.join(OUT, 'server.log'), 'w');
  server = spawn(process.execPath, ['-e', pre], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), BOTS_MEM: memf }), stdio: ['ignore', out, out] });
  for (let i = 0; i < 80; i++) { await sleep(250); try { if ((await fetch(URL + '/')).ok) return; } catch (e) {} }
  throw new Error('サーバーが立ちません');
}

// ---- 係（手元だけ・/dev-login のクッキー） ----
async function 係() {
  const r = await fetch(URL + '/dev-login', { redirect: 'manual' });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => String(c).split(';')[0]).join('; ');
  const s = io(URL, { extraHeaders: { cookie }, transports: ['websocket'] });
  await new Promise((ok) => s.once('connect', ok));
  const call = (ev, p) => new Promise((ok) => s.timeout(8000).emit(ev, p || {}, (err, res) => ok(err ? { ok: false, error: 'timeout' } : res)));
  const c = await call('fes:create', { recreate: false });
  if (!c || !c.ok) throw new Error('部屋を作れません：' + JSON.stringify(c));
  let 入 = null;
  if (GAMES) {
    const sw = ((await call('fes:watch', { code: c.code })).staff || {}).games || [];
    記録.入切のもと = sw.map((g) => ({ mode: g.mode, on: !!g.on }));
    for (const g of sw) if (GAMES.includes(g.mode) && !g.on) await call('fes:game', { code: c.code, mode: g.mode, on: true });
    for (const g of sw) if (!GAMES.includes(g.mode) && g.on) await call('fes:game', { code: c.code, mode: g.mode, on: false });
    入 = (((await call('fes:watch', { code: c.code })).staff || {}).games || []).filter((g) => g.on).map((g) => g.mode);
  }
  // 入／切は SQLite に残る。終わる時にもとへもどす（ほかの検査と手元の遊びを変えない）
  const もどす = async () => { if (!記録.入切のもと) return; for (const g of 記録.入切のもと) await call('fes:game', { code: c.code, mode: g.mode, on: g.on }); };
  return { s, call, code: c.code, 入, もどす };
}

// ---- 返事の速さ（emit→ack） ----
function 測る(ev, ms, res) {
  (記録.返事[ev] = 記録.返事[ev] || []).push(Math.round(ms));
  if (res && res.ok === false && res.error) { const k = ev + ':' + res.error; 記録.断られた[k] = (記録.断られた[k] || 0) + 1; }
}
const q = (a, p) => { if (!a || !a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };

// ---- 台本（tools/bot-play） ----
const 台本の棚 = {};
function 台本(game) {
  if (game in 台本の棚) return 台本の棚[game];
  let f = null; try { f = require(path.join(__dirname, 'bot-play', game + '.js')); } catch (e) {}
  return (台本の棚[game] = f);
}

// ---- 1人 ----
function プレイヤー(i, code) {
  const name = PREFIX + String(i + 1).padStart(2, '0');
  const sock = io(URL, { transports: ['websocket', 'polling'], reconnection: true });
  const bot = { i, name, sock, memberId: null, room: null, mine: null, done: new Set(), away: false, offset: 0, 考え中: false };
  const call = (ev, p, cb) => {
    const a = Date.now();
    sock.timeout(10000).emit(ev, p || {}, (err, res) => {
      const r = err ? { ok: false, error: 'timeout' } : res;
      測る(ev, Date.now() - a, r);
      if (r && r.error === 'not_started') return setTimeout(() => call(ev, p, cb), 400);   // 3-2-1 の最中は少し待って送り直す
      if (cb) cb(r);
    });
  };
  const once = (k) => { if (bot.done.has(k)) return false; bot.done.add(k); return true; };
  const serverNow = () => Date.now() + bot.offset;

  async function 時計を合わせる() {
    let best = null;
    for (let k = 0; k < 8; k++) {
      const a = Date.now();
      const r = await new Promise((ok) => sock.timeout(3000).emit('clock:sync', {}, (err, res) => ok(err ? null : res)));
      const b = Date.now();
      if (r && typeof r.now === 'number' && (!best || b - a < best.rtt)) best = { rtt: b - a, off: r.now - (a + b) / 2 };
    }
    if (best) bot.offset = best.off;
  }
  function 入る() {
    if (bot.away) return;
    call('room:join', { code, name, role: 'player', memberId: bot.memberId || undefined, diff: pick(['easy', 'normal']) }, (res) => {
      if (!res || !res.ok) { 記録.入れない.push({ name, error: res && (res.error || res.message) }); log(name, '入れない', res && (res.error || res.message)); return; }
      bot.memberId = res.memberId; bot.room = res.room || bot.room;
      log(name, '入った');
    });
  }
  sock.on('connect', () => { if (bot.connectedOnce) 記録.つなぎ直し++; bot.connectedOnce = true; 時計を合わせる(); 入る(); });
  sock.on('hb:ping', () => { if (!bot.away) sock.emit('hb:pong'); });
  sock.on('room:kicked', (p) => { 記録.外された++; log(name, '外された', p && p.reason); bot.memberId = null; setTimeout(入る, 2000); });
  sock.on('room:update', (p) => { bot.room = (p && p.room) || p; 動く('room'); });
  sock.on('wolf:you', (mine) => { bot.mine = mine; 動く('you'); });
  // 本人だけの知らせ（盤）は、部屋の段が「遊ぶ」に変わるより先に届くことがある（落とし穴18）。そのままだと台本が1回も動かない。
  // 3秒ごとに、いまある材料で見直す（台本は送る直前にもう一度確かめる・取られていたら断られて手放す）
  bot.見直し = setInterval(() => { if (bot.mine) 動く('you'); }, 3000);

  function 動く(from) {
    if (bot.away || !bot.room || !bot.memberId) return;
    const room = bot.room, f = room.fes || {}, st = room.state || {};
    const me = (room.members || []).find((m) => m.id === bot.memberId);
    if (!me) return;
    // 文化祭の段
    if (f.phase === 'vote' && (f.candidates || []).length && once('vote:' + f.round)) {
      // 候補は毎回3つだけ。--vote の中で、まだ遊んでいない物が候補にあればそれ、無ければ --vote の中の物、無ければ候補から1つ
      const played = new Set(記録.回.map((r) => r.mode));
      const want = VOTE && (VOTE.find((g) => f.candidates.includes(g) && !played.has(g)) || VOTE.find((g) => f.candidates.includes(g)));
      setTimeout(() => call('fes:vote', { mode: want || pick(f.candidates) }), rnd(800, 4000));
    }
    if (f.phase === 'ready' && !me.ready && once('ready:' + f.round + ':' + (st.game || ''))) {
      setTimeout(() => call('room:ready', { ready: true, game: st.game || null }, (r) => { if (!r || !r.ok) bot.done.delete('ready:' + f.round + ':' + (st.game || '')); }), rnd(1000, 5000));
    }
    if (f.phase === 'result' && once('cont:' + f.round)) setTimeout(() => call('fes:continue', {}), rnd(1500, 6000));
    if (f.phase !== 'play' || !st.game) return;
    // 遊ぶ段の「1回だけ」は文化祭の回ごとに分ける（同じゲームが2回目に来ると、問題の番号が1からもどるので、前の回の鍵で黙っていた・11/9）
    const onceG = (k) => once('回' + f.round + ':' + k);
    const v = st.data || {};
    const g = st.game;
    const s = {
      from, game: g, room, view: v, mine: bot.mine, me: bot.memberId, once: onceG,
      act: (payload, cb) => call('wolf:act', payload, cb), vote: (payload, cb) => call('wolf:vote', payload, cb),
      emit: (ev, payload, cb) => call(ev, payload, cb), later: (ms, fn) => setTimeout(fn, ms), log: (m) => log(name, m)
    };
    if (g === 'bomb' || g === 'rcard') { const play = 台本(g); if (play) try { play(bot, s); } catch (e) { log(name, '台本で失敗', e.message); } return; }
    if (g === 'shinka') {
      if (v.phase !== 'throw') return;
      if (onceG('sh:' + v.round + ':' + (v.matches || []).filter((m) => !m.done).length)) setTimeout(() => call('wolf:act', { hand: pick(['g', 'c', 'p']) }), rnd(500, 3000));
      return;
    }
    if ((g === 'onaji' || g === 'qhaya') && v.phase === 'choose' && v.topic && onceG(g + ':' + v.round)) {
      const k = Math.floor(Math.random() * v.topic.choices.length), wait = rnd(1500, 6000);
      setTimeout(() => call('wolf:act', g === 'qhaya' ? { targetId: null, pick: k, ms: Math.round(wait) } : { targetId: null, pick: k }), wait);
      return;
    }
    if (g === 'pittari' && v.phase === 'run' && onceG('pt:' + v.round)) {
      const target = (v.target || 10) * 1000, ms = Math.round(target + rnd(-1500, 1500));
      setTimeout(() => call('wolf:act', { targetId: null, ms }), Math.max(0, ms));
      return;
    }
    if (g === 'soroe' && v.phase === 'launch' && v.zeroAt && onceG('so:' + v.round)) {
      const at = v.zeroAt + rnd(-400, 400);
      setTimeout(() => call('wolf:act', { targetId: null, at: Math.round(serverNow()) }), Math.max(0, at - serverNow()));
      return;
    }
    if (g === 'qnear' && v.phase === 'guess' && onceG('qn:' + v.round)) {
      setTimeout(() => call('wolf:act', { targetId: null, value: String(Math.floor(rnd(0, 9999))) }), rnd(2000, 8000));
    }
  }
  return bot;
}

// ---- 回を数える（だれか1人の目で：結果の段に入ったら1回） ----
function 見張る(bots) {
  let 前 = null, 始め = null, ゲーム = null;
  return setInterval(() => {
    const b = bots.find((x) => !x.away && x.room && x.room.fes);
    if (!b) return;
    const f = b.room.fes, st = b.room.state || {};
    const 今 = f.phase + ':' + f.round;
    if (今 === 前) return;
    if (f.phase === 'play') { 始め = Date.now(); ゲーム = (f.played && f.played.mode) || st.game; }
    if (f.phase === 'result' && 始め) {
      const n = (b.room.members || []).filter((m) => m.role === 'player' && m.connected !== false).length;
      記録.回.push({ round: f.round, mode: ゲーム, 秒: Math.round((Date.now() - 始め) / 1000), 人: n });
      log('— 回', 記録.回.length, ゲーム, Math.round((Date.now() - 始め) / 1000) + '秒', n + '人');
      始め = null;
    }
    前 = 今;
  }, 500);
}

function まとめ() {
  const 返事 = {};
  Object.keys(記録.返事).forEach((ev) => { const a = 記録.返事[ev]; 返事[ev] = { 件: a.length, p50: q(a, 0.5), p95: q(a, 0.95), 最大: Math.max.apply(null, a) }; });
  return { いつ: 記録.いつ, 先: URL, 人数: N, 分: +分(), 回: 記録.回.length, ゲームごと: 記録.回.reduce((o, r) => (o[r.mode] = (o[r.mode] || 0) + 1, o), {}),
    返事, 断られた: 記録.断られた, つなぎ直し: 記録.つなぎ直し, 外された: 記録.外された, 入れない: 記録.入れない.length, 終わり方: 記録.終わり方 };
}

(async () => {
  let staff = null;
  if (SERVE) { await サーバーを立てる(); log('検証用サーバー', URL); }
  let code;
  if (CREATE) {
    staff = await 係(); code = staff.code; log('係が部屋を作った', code, staff.入 ? '入：' + staff.入.join(',') : '');
    // 棚から下ろしたゲームは入にできない（候補にならない）。--all がそれを待ち続けないように、--vote から外す
    if (VOTE && staff.入) { const out = VOTE.filter((g) => !staff.入.includes(g)); if (out.length) { log('入にできない（棚から下ろした）：' + out.join(',')); 記録.入にできない = out; VOTE.splice(0, VOTE.length, ...VOTE.filter((g) => staff.入.includes(g))); } }
  }
  else { const j = await (await fetch(URL + '/api/fes/current')).json(); code = j && j.code; }
  if (!code) { console.error('文化祭の部屋がありません（係が作ってから。手元なら --create）'); process.exit(3); }
  const bots = [];
  for (let i = 0; i < N; i++) { bots.push(プレイヤー(i, code)); await sleep(150); }
  const w = 見張る(bots);
  // --debug：1人目に届いている様子を10秒ごとに（遊び方が動かない時の手がかり）
  if (arg('debug', false)) setInterval(() => {
    const b = bots[0], r = b.room || {}, f = r.fes || {}, st = r.state || {}, me = (r.members || []).find((m) => m.id === b.memberId);
    log('debug', JSON.stringify({ fes: f.phase, round: f.round, cand: f.candidates, game: st.game, sp: st.phase, dp: st.data && st.data.phase, ready: me && me.ready,
      mine: b.mine && Object.keys(b.mine).slice(0, 14), minePh: b.mine && b.mine.phase, open: b.mine && b.mine.open && Object.keys(b.mine.open), board: b.mine && b.mine.board && b.mine.board.length }).slice(0, 700));
  }, 10000);
  if (AWAY) setTimeout(() => { bots.slice(0, AWAY).forEach((b) => { b.away = true; }); log(AWAY + '人が黙った（心拍に答えない）'); }, 60000);
  const tick = setInterval(() => {
    const s = まとめ(), ack = Object.entries(s.返事).map(([e, x]) => e + ' ' + x.p50 + '/' + x.p95).join('・');
    log('様子：回 ' + s.回 + '・つなぎ直し ' + s.つなぎ直し + '・外された ' + s.外された + '・返事 p50/p95 ' + ack);
  }, 60000);
  const 終わる = async (why) => {
    clearInterval(w); clearInterval(tick);
    記録.終わり方 = why;
    for (const b of bots) { try { await new Promise((ok) => b.sock.timeout(3000).emit('room:leave', { code, memberId: b.memberId }, () => ok())); } catch (e) {} clearInterval(b.見直し); b.sock.close(); }
    if (staff) { try { await staff.もどす(); } catch (e) {} staff.s.close(); }
    if (server) {
      try { 記録.メモリー = fs.readFileSync(path.join(OUT, 'server-mem.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const m = JSON.parse(l); return { 分: +((m.t - t0) / 60000).toFixed(1), rssMB: Math.round(m.rss / 1048576), heapMB: Math.round(m.heapUsed / 1048576) }; }); } catch (e) {}
      server.kill();
    }
    fs.mkdirSync(OUT, { recursive: true });
    const s = まとめ();
    s.メモリー = 記録.メモリー; s.回の中身 = 記録.回;
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(s, null, 1));
    console.log(JSON.stringify({ 回: s.回, ゲームごと: s.ゲームごと, 返事: s.返事, 断られた: s.断られた, つなぎ直し: s.つなぎ直し, 外された: s.外された, 入れない: s.入れない, 終わり方: why }));
    console.log('記録：' + path.relative(ROOT, OUT));
    process.exit(0);
  };
  process.on('SIGINT', () => 終わる('止めた（Ctrl+C）'));
  if (MIN) setTimeout(() => 終わる(MIN + '分たった'), MIN * 60000);
  if (LAPS) { const lp = setInterval(() => { if (記録.回.length >= LAPS) { clearInterval(lp); setTimeout(() => 終わる(LAPS + '回遊んだ'), 3000); } }, 1000); }
  // --all：--vote のゲームを全部1回ずつ遊んだら終わる（--min で打ち切り）
  if (arg('all', false) && VOTE) { const al = setInterval(() => { const p = new Set(記録.回.map((r) => r.mode)); if (VOTE.every((g) => p.has(g))) { clearInterval(al); setTimeout(() => 終わる('--vote の' + VOTE.length + '本を全部遊んだ（' + 記録.回.length + '回）'), 3000); } }, 1000); }
  if (LAPS && !MIN) setTimeout(() => 終わる('時間切れ（' + LAPS + '回に届かない・30分）'), 30 * 60000);
})().catch((e) => { console.error(e); if (server) server.kill(); process.exit(1); });
