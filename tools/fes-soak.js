#!/usr/bin/env node
// tools/fes-soak.js — 文化祭の当日を想定した耐久（2026-11-01）。手元の検証用サーバーだけで回す（本番にはつながない）
//
//   node tools/fes-soak.js --min 180 --recreate 3                         … 偽スマホ16台＋TV で3時間・途中で3回 部屋を作り直す
//   node tools/fes-soak.js --min 60 --games bomb-coop,onaji-many,pittari,soroe,qhaya,qnear --port 3402 --cdp 9712 --name six
//   --phones 16  --port 3401  --cdp 9711  --out DIR（既定 docs/監査_指示66の画像/fes-soak-<name>）
//
// 偽スマホは本物のページ（Chrome のタブ・tools/cdp.js）。ページの中に小さな「遊ぶ人」を入れて（下の AGENT）、
// 名前を入れて入る・投票・準備OK・遊ぶ・つづける を押させる。作り直しで /fes に飛ばされたら、また名前を入れて入る。
// 係は socket（/dev-login のクッキー）で、部屋を作る・作り直す・入／切 だけ。サーバーの本当の様子（段階・名簿）は係の fes:watch で見る。
//
// 見る物（記録.json と 記録.md）：
//   ・メモリー：サーバー（1分ごと・30分ごとの表）と、TV とスマホ1台の画面（JS のヒープ・要素の数）
//   ・止まった画面：サーバーの段階と画面の段階が 25秒より長く食い違う／画面の中身が 4分変わらないのにサーバーは進んだ
//   ・ログのエラー・tv-stuck の行（サーバーの出力を全部ファイルに残し、最後に拾う）
//   ・人数のずれ：サーバーの名簿（つながっている人）・TV の顔の数・入れている偽スマホの数
//   ・回ったゲームの数（ゲームごと）・画面の例外
// 検証の Chrome は音を消してある（tools/cdp.js の --mute-audio）

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3401), CDP = +arg('cdp', 9711), MIN = +arg('min', 180), PHONES = +arg('phones', 16);
const RECREATE = +arg('recreate', 0);
const NAME = String(arg('name', 'four'));
const GAMES = String(arg('games', 'bomb-coop,onaji-many,pittari,soroe')).split(',');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'fes-soak-' + NAME)));
const BASE = 'http://localhost:' + PORT;
const NAMES = ['あき', 'いお', 'うた', 'えま', 'おと', 'かい', 'きよ', 'くう', 'けい', 'こと', 'さら', 'しん', 'すず', 'せな', 'そら', 'たく'];

const t0 = Date.now();
const 分 = () => +((Date.now() - t0) / 60000).toFixed(1);
const log = (...a) => console.log(String(分()).padStart(6) + '分 ' + a.join(' '));
const 記録 = {
  いつ: new Date().toISOString(), 分: MIN, スマホ: PHONES, ゲーム: GAMES, 作り直し: [], メモリー: [], 画面のメモリー: [],
  回: [], 止まった: [], 人数のずれ: [], 例外: [], 段階の数: {}, 失敗: null
};

// ---- サーバー（メモリーを1分ごとにファイルへ書く・出力は全部残す） ----
const MEMF = path.join(OUT, 'server-mem.jsonl'), LOGF = path.join(OUT, 'server.log');
function サーバー() {
  const pre = "const fs=require('fs');setInterval(()=>{try{fs.appendFileSync(process.env.SOAK_MEM,JSON.stringify(Object.assign({t:Date.now()},process.memoryUsage()))+'\\n')}catch(e){}},60000).unref();require(" + JSON.stringify(path.join(__dirname, 'dev-server.js')) + ')';
  const out = fs.openSync(LOGF, 'w');
  return spawn(process.execPath, ['-e', pre], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), SOAK_MEM: MEMF }), stdio: ['ignore', out, out] });
}

// ---- 係（socket） ----
async function 係を作る() {
  const r = await fetch(BASE + '/dev-login', { redirect: 'manual' });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => String(c).split(';')[0]).join('; ');
  const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'], reconnection: true });
  await new Promise((ok) => s.once('connect', ok));
  const call = (ev, p) => new Promise((ok) => s.timeout(8000).emit(ev, p || {}, (err, res) => ok(err ? { ok: false, error: 'timeout' } : res)));
  return { s, call };
}
async function 部屋を作る(staff, recreate) {
  const r = await staff.call('fes:create', { recreate: !!recreate });
  if (!r || !r.ok) throw new Error('部屋を作れません：' + JSON.stringify(r));
  // 入／切：回すゲームだけ入（ほかのゲームは切）。入を先にして「2本より少なくできない」に当たらないように
  const w = await staff.call('fes:watch', { code: r.code });
  const sw = (w && w.staff && w.staff.games) || [];
  for (const g of sw) if (GAMES.indexOf(g.mode) !== -1 && !g.on) await staff.call('fes:game', { code: r.code, mode: g.mode, on: true });
  for (const g of sw) if (GAMES.indexOf(g.mode) === -1 && g.on) await staff.call('fes:game', { code: r.code, mode: g.mode, on: false });
  const w2 = await staff.call('fes:watch', { code: r.code });
  return { code: r.code, games: ((w2 && w2.staff && w2.staff.games) || []).filter((g) => g.on).map((g) => g.mode) };
}

// ページの中の「遊ぶ人」は tools/fes-agent.js（画面監査の道具と同じもの・2026-11-07 に切り出した）
const { AGENT } = require('./fes-agent');

async function 開く(d, url, fx) {
  await d.go(BASE + '/');
  await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:" + JSON.stringify(fx || 'normal') + "})); return 1; })()");
  await d.go(BASE + url);
}
const 入れる = (d, cfg) => d.ev('(function(){(' + AGENT.toString() + ')();window.__soak.cfg=' + JSON.stringify(cfg) + ';return window.__soak.report();})()');

// ---- サーバーの段階と、画面の段階の照らし合わせ ----
// サーバーの段階 → その時いてよい画面の段階（遊ぶ人だけ。あとから来た人・TV は別に見る）
function 合う(phase, rep, playing) {
  const st = rep.stage, scr = rep.scr;
  if (st === 'gate' || scr === 'scr-door' || st === 'join') return true;   // 入る途中は数えない（別の見張りで見る）
  const inGame = !/^scr-v2-fes/.test(scr) || st === 'play';
  switch (phase) {
    case 'vote': return st === 'vote';
    case 'decide': return st === 'decide' || st === 'ready';
    case 'ready': return st === 'ready' || st === 'decide' || inGame;
    case 'play': return playing ? (inGame || st === 'ready' || st === 'result') : true;
    case 'result': return st === 'result' || inGame || st === 'lobby';
    case 'lobby': case 'idle': return st === 'lobby' || st === 'result' || st === 'idle' || inGame;
    default: return true;
  }
}
function 合うTV(phase, rep) {
  const st = rep.stage, scr = rep.scr;
  if (scr !== 'scr-v2-fes-tv') return phase === 'play' || phase === 'ready' || phase === 'result';  // ゲームの TV 画面
  switch (phase) {
    case 'vote': return st === 'vote';
    case 'decide': return st === 'decide' || st === 'ready';
    case 'ready': return st === 'ready' || st === 'decide';
    case 'lobby': return st === 'lobby' || st === 'result' || st === 'idle';
    case 'idle': return st === 'idle' || st === 'lobby';
    default: return true;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json|jsonl|log|md)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const child = サーバー();
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  if (!up) { console.error('検証用サーバーが立ちません（port ' + PORT + '）'); process.exit(2); }
  log('サーバー', BASE, 'pid', child.pid);
  let 落ちた = null;
  child.on('exit', (c, sig) => { 落ちた = { 分: 分(), code: c, sig }; log('サーバーが止まった', c, sig); });

  const staff = await 係を作る();
  let room = await 部屋を作る(staff, true);
  記録.作り直し.push({ 分: 分(), code: room.code, 入: room.games, 初め: true });
  log('部屋', room.code, '入：' + room.games.join(','));

  const b = await launch({ port: CDP });
  const devs = [];
  let shots = 0;
  const 撮る = async (d, name) => { if (shots >= 60) return; shots++; try { await d.shot(path.join(OUT, String(分()).replace('.', '_') + '分_' + name + '.jpg')); } catch (e) {} };
  try {
    const tv = await b.newDevice('TV', { width: 1280, height: 720 }); devs.push(tv);
    await 開く(tv, '/fes?tv=1');
    await 入れる(tv, { tv: true });
    const ph = [];
    for (let i = 0; i < PHONES; i++) {
      const d = await b.newDevice('スマホ' + (i + 1) + '（' + NAMES[i] + '）', { width: 390, height: 844, mobile: true });
      d.nm = NAMES[i]; devs.push(d); ph.push(d);
      await 開く(d, '/fes');
      // 15・16台目は「つづける」を押さない（押さなければ「つづける」になる、の側を見る）
      d.cfg = { name: NAMES[i], diff: i % 3 === 0 ? 'easy' : 'normal', lazy: i >= PHONES - 2, round: 0, target: null };
      await 入れる(d, d.cfg);
      await sleep(300);
    }
    log('スマホ', PHONES, '台を開いた');

    // ---- 見回り ----
    const end = t0 + MIN * 60000;
    const 作り直す時 = Array.from({ length: RECREATE }, (_, i) => t0 + MIN * 60000 * (i + 1) / (RECREATE + 1));
    let 次のメモリー = t0, 次の画面メモリー = t0;
    let srv = null, 段階 = null, 段階の時 = Date.now(), round = 0, 回 = null;
    const 食い違い = new Map();   // 端末 → 食い違い始めた時刻
    const 最後の中身 = new Map(); // 端末 → { sig, at, phases }
    let 人数ずれ始め = null;
    while (Date.now() < end && !落ちた) {
      // 作り直し
      if (作り直す時.length && Date.now() >= 作り直す時[0]) {
        作り直す時.shift();
        const old = room.code;
        room = await 部屋を作る(staff, true);
        記録.作り直し.push({ 分: 分(), 前: old, code: room.code, 入: room.games });
        log('部屋を作り直した', old, '→', room.code);
        食い違い.clear();
      }
      const w = await staff.call('fes:watch', { code: room.code });
      if (!w || !w.ok) { log('係の見る道が答えない', JSON.stringify(w)); await sleep(2000); continue; }
      srv = w.staff;
      const f = srv.fes || {};
      if (f.phase !== 段階) {
        記録.段階の数[f.phase] = (記録.段階の数[f.phase] || 0) + 1;
        if (f.phase === 'play' && f.played) { 回 = { 分: 分(), mode: f.played.mode, 人: f.played.ids.length, round: f.round }; 記録.回.push(回); log('遊ぶ', f.played.mode, f.played.ids.length + '人'); }
        if (段階 === 'play' && 回) 回.秒 = Math.round((Date.now() - 段階の時) / 1000);
        段階 = f.phase; 段階の時 = Date.now();
        if (f.phase === 'vote') {
          round++;
          // 4本（6本）を順に回すため、多くの人がその回の「ねらい」に入れる。候補に無ければ好きに入れる
          const cands = f.candidates || [];
          const order = GAMES.filter((g) => cands.indexOf(g) !== -1);
          const counts = {}; 記録.回.forEach((x) => { counts[x.mode] = (counts[x.mode] || 0) + 1; });
          order.sort((a, c) => (counts[a] || 0) - (counts[c] || 0));
          const target = order[0] || null;
          for (const d of ph) { d.cfg.round = round; d.cfg.target = Math.random() < 0.75 ? target : null; await d.ev('window.__soak&&(window.__soak.cfg=' + JSON.stringify(d.cfg) + ')').catch(() => null); }
        }
      }
      const byName = new Map((srv.members || []).map((m) => [m.name, m]));
      const playingIds = new Set((f.played && f.played.ids) || []);
      // 端末ごと
      let 入れている = 0;
      for (const d of devs) {
        let rep;
        try { rep = await d.ev('window.__soak?window.__soak.report():null'); } catch (e) { rep = null; }
        if (!rep) { try { rep = await 入れる(d, d === tv ? { tv: true } : d.cfg); } catch (e) { continue; } }
        // 「step」で始まるのは、この道具の遊ぶ人のまちがい（ページの例外とは分けて数える）
        const 道具 = (rep.errs || []).filter((x) => /^step /.test(x)), ページ = (rep.errs || []).filter((x) => !/^step /.test(x));
        if (ページ.length) 記録.例外.push({ 分: 分(), 端末: d.name, 中身: ページ.slice(0, 5) });
        if (道具.length) (記録.道具の例外 = 記録.道具の例外 || []).push({ 分: 分(), 端末: d.name, 中身: 道具.slice(0, 3) });
        if (rep.stuck) { 記録.止まった.push({ 分: 分(), 端末: d.name, 種類: 'TV の「着かない」の一言', scr: rep.scr }); }
        const m = d === tv ? null : byName.get(d.nm);
        if (m && m.connected) 入れている++;
        const ok = d === tv ? 合うTV(f.phase, rep) : (!m || !m.playing && f.phase !== 'vote' ? true : 合う(f.phase, rep, playingIds.has(m.id)));
        const k = d.name;
        if (ok) 食い違い.delete(k);
        else if (!食い違い.has(k)) 食い違い.set(k, Date.now());
        else if (Date.now() - 食い違い.get(k) > 25000) {
          記録.止まった.push({ 分: 分(), 端末: k, 種類: 'サーバーと食い違う', サーバー: f.phase, 画面: rep.scr + '/' + rep.stage, 字: rep.txt });
          log('食い違い', k, 'サーバー=' + f.phase, '画面=' + rep.scr + '/' + rep.stage);
          await 撮る(d, k.replace(/[（）]/g, '') + '_食い違い'); 食い違い.set(k, Date.now() + 60000);   // 同じ食い違いは1分あけて書く
        }
        // 中身が変わらない（サーバーは2回以上進んだのに）
        const lc = 最後の中身.get(k);
        if (!lc || lc.sig !== rep.sig) 最後の中身.set(k, { sig: rep.sig, at: Date.now(), ph: 記録.段階の数.vote || 0 });
        else if (Date.now() - lc.at > 240000 && (記録.段階の数.vote || 0) - lc.ph >= 2 && rep.stage !== 'join') {
          記録.止まった.push({ 分: 分(), 端末: k, 種類: '画面が4分変わらない', 画面: rep.scr + '/' + rep.stage, 字: rep.txt });
          log('画面が変わらない', k, rep.scr); await 撮る(d, k.replace(/[（）]/g, '') + '_止まった'); lc.at = Date.now();
        }
        d.rep = rep;
      }
      // 人数のずれ：サーバーの名簿でつながっている人・入れている偽スマホ・TV の顔（待合の時だけ）
      const サーバーの人 = (srv.members || []).filter((m) => m.connected).length;
      const 名簿の人 = (srv.members || []).length;
      const TVの顔 = (f.phase === 'lobby' && tv.rep && tv.rep.stage === 'lobby') ? tv.rep.tmem : null;
      const ずれ = 名簿の人 > PHONES || サーバーの人 !== 入れている || (TVの顔 !== null && TVの顔 !== サーバーの人 && TVの顔 !== 名簿の人);
      if (!ずれ) 人数ずれ始め = null;
      else if (!人数ずれ始め) 人数ずれ始め = Date.now();
      else if (Date.now() - 人数ずれ始め > 30000) {
        記録.人数のずれ.push({ 分: 分(), サーバーの人, 名簿の人, 入れている, TVの顔, TV: srv.tv, 段階: f.phase, 名簿: (srv.members || []).map((m) => m.name + (m.connected ? '' : '(切)')).join(' ') });
        log('人数のずれ', 'サーバー' + サーバーの人, '名簿' + 名簿の人, '偽スマホ' + 入れている, 'TV' + TVの顔);
        人数ずれ始め = Date.now() + 60000;
      }
      // メモリー（30分ごとに表へ。1分ごとはファイル）
      if (Date.now() >= 次のメモリー) {
        次のメモリー += 30 * 60000;
        const lines = fs.existsSync(MEMF) ? fs.readFileSync(MEMF, 'utf8').trim().split('\n').filter(Boolean) : [];
        const m = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
        記録.メモリー.push({ 分: 分(), rssMB: m && +(m.rss / 1048576).toFixed(1), heapMB: m && +(m.heapUsed / 1048576).toFixed(1), 人: サーバーの人, 名簿: 名簿の人, 段階: f.phase });
        log('メモリー', m ? 'rss ' + (m.rss / 1048576).toFixed(1) + 'MB heap ' + (m.heapUsed / 1048576).toFixed(1) + 'MB' : '(まだ)');
      }
      if (Date.now() >= 次の画面メモリー) {
        次の画面メモリー += 30 * 60000;
        for (const d of [tv, ph[0]]) {
          const pm = await d.ev('({heap:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,nodes:document.getElementsByTagName("*").length,scr:(document.querySelector(".screen.active")||{}).id})').catch(() => null);
          記録.画面のメモリー.push(Object.assign({ 分: 分(), 端末: d.name }, pm || {}));
        }
      }
      await sleep(2000);
    }
    if (落ちた) 記録.失敗 = 'サーバーが止まった：' + JSON.stringify(落ちた);
    // 最後のメモリー
    const lines = fs.existsSync(MEMF) ? fs.readFileSync(MEMF, 'utf8').trim().split('\n').filter(Boolean) : [];
    if (lines.length) { const m = JSON.parse(lines[lines.length - 1]); 記録.メモリー.push({ 分: 分(), rssMB: +(m.rss / 1048576).toFixed(1), heapMB: +(m.heapUsed / 1048576).toFixed(1), 最後: true }); }
    for (const d of [tv, ph[0]]) {
      const pm = await d.ev('({heap:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,nodes:document.getElementsByTagName("*").length})').catch(() => null);
      記録.画面のメモリー.push(Object.assign({ 分: 分(), 端末: d.name, 最後: true }, pm || {}));
    }
    await 撮る(tv, 'TV_最後');
  } catch (e) {
    記録.失敗 = String(e && e.stack || e);
    console.error('失敗：' + 記録.失敗);
  } finally {
    devs.forEach((d) => { if (d.logs && d.logs.length) 記録.例外.push({ 端末: d.name, cdp: d.logs.slice(0, 10) }); });
    try { staff.s.close(); } catch (e) {}
    await b.close().catch(() => {});
    try { child.kill(); } catch (e) {}
    await sleep(500);
    // ログ：エラーと tv-stuck
    const text = fs.existsSync(LOGF) ? fs.readFileSync(LOGF, 'utf8') : '';
    記録.ログのエラー = text.split('\n').filter((l) => /error|例外|Error|failed|uncaught|unhandled/i.test(l)).slice(0, 80);
    記録.tvStuck = text.split('\n').filter((l) => /tv-stuck/.test(l));
    const 回数 = {}; 記録.回.forEach((x) => { 回数[x.mode] = (回数[x.mode] || 0) + 1; });
    記録.ゲームごと = 回数;
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    const md = ['# 耐久 ' + NAME + '（' + MIN + '分・スマホ' + PHONES + '台＋TV）', '', '- 回ったゲーム：' + JSON.stringify(回数) + '（全部で ' + 記録.回.length + '回）',
      '- 作り直し：' + (記録.作り直し.length - 1) + '回', '- 止まった：' + 記録.止まった.length + '件・人数のずれ：' + 記録.人数のずれ.length + '件・画面の例外：' + 記録.例外.length + '件',
      '- ログのエラー：' + 記録.ログのエラー.length + '行・tv-stuck：' + 記録.tvStuck.length + '行', '- 失敗：' + (記録.失敗 || 'なし'), '', '| 分 | rss MB | heap MB | 人 |', '|---|---|---|---|']
      .concat(記録.メモリー.map((m) => '| ' + m.分 + ' | ' + m.rssMB + ' | ' + m.heapMB + ' | ' + (m.人 == null ? '' : m.人) + ' |'));
    fs.writeFileSync(path.join(OUT, '記録.md'), md.join('\n') + '\n');
    console.log(md.slice(0, 8).join('\n'));
    process.exit(記録.失敗 || 記録.止まった.length || 記録.人数のずれ.length ? 1 : 0);
  }
})();
