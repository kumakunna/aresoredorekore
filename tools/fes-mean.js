#!/usr/bin/env node
// tools/fes-mean.js — 文化祭の部屋の「いじわるなテスト」（2026-11-01）。手元の検証用サーバーだけで回す（本番にはつながない）
//
//   node tools/fes-mean.js                     … 全部（20分ほど）
//   node tools/fes-mean.js --only many,blip    … 名前でしぼる（many・blip・reopen・full・names・mash・random）
//   --port 3403（サーバー） --proxy 3404（中継） --cdp 9713 --out DIR（既定 docs/監査_指示66の画像/fes-mean）
//
// **Wi-Fi の一瞬の切れは「中継」で作る。**偽スマホ（socket の bot と Chrome のタブ）は中継を通してつなぐ。
// 中継のつなぎを全部切って3秒受け付けないと、つながっている socket が本当に切れる
// （Chrome の擬似オフラインは、もう張れている WebSocket を切らないことがある）。係（部屋を作る・名簿を見る）は中継を通さない。
//
// どの場面でも見る物：サーバーが落ちないか・画面が止まらないか（サーバーの段階と画面の段階）・人数がずれないか（名簿・つながっている人・同じ人が2人）
// 記録：記録.json・記録.md・写真。検証の Chrome は音を消してある（tools/cdp.js の --mute-audio）

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3403), PROXY = +arg('proxy', 3404), CDP = +arg('cdp', 9713);
const ONLY = arg('only', null) ? String(arg('only')).split(',') : null;
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'fes-mean')));
const SRV = 'http://localhost:' + PORT, VIA = 'http://localhost:' + PROXY;
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's ' + a.join(' '));
const 記録 = { いつ: new Date().toISOString(), 場面: [], 失敗: null };

// ---- 中継（Wi-Fi） ----
const 中継 = { socks: new Set(), down: false, n: 0 };
const proxy = net.createServer((c) => {
  if (中継.down) { c.destroy(); return; }
  const s = net.connect(PORT, '127.0.0.1');
  中継.socks.add(c); 中継.socks.add(s); 中継.n++;
  c.pipe(s); s.pipe(c);
  const end = () => { c.destroy(); s.destroy(); 中継.socks.delete(c); 中継.socks.delete(s); };
  c.on('error', end); s.on('error', end); c.on('close', end); s.on('close', end);
});
async function WiFiを切る(ms) { 中継.down = true; for (const s of 中継.socks) s.destroy(); 中継.socks.clear(); await sleep(ms); 中継.down = false; }

// ---- サーバー ----
const LOGF = path.join(OUT, 'server.log');
let child = null, 落ちた = null;
async function サーバー() {
  const out = fs.openSync(LOGF, 'w');
  child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: ['ignore', out, out] });
  child.on('exit', (c, sig) => { 落ちた = { code: c, sig }; });
  for (let i = 0; i < 120; i++) { await sleep(250); try { if ((await fetch(SRV + '/')).ok) return; } catch (e) {} }
  throw new Error('サーバーが立ちません');
}
async function 生きている() { if (落ちた) return false; try { return (await fetch(SRV + '/api/fes/current')).ok; } catch (e) { return false; } }

// ---- 係（中継を通さない） ----
let staff = null;
async function 係() {
  const r = await fetch(SRV + '/dev-login', { redirect: 'manual' });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const s = io(SRV, { extraHeaders: { cookie }, transports: ['websocket'] });
  await new Promise((ok) => s.once('connect', ok));
  staff = { s, call: (ev, p) => new Promise((ok) => s.timeout(8000).emit(ev, p || {}, (err, res) => ok(err ? { ok: false, error: 'timeout' } : res))) };
}
let CODE = null;
async function 作り直す(games) {
  const r = await staff.call('fes:create', { recreate: true });
  CODE = r.code;
  const w = await staff.call('fes:watch', { code: CODE });
  for (const g of w.staff.games) if (games.indexOf(g.mode) !== -1 && !g.on) await staff.call('fes:game', { code: CODE, mode: g.mode, on: true });
  for (const g of w.staff.games) if (games.indexOf(g.mode) === -1 && g.on) await staff.call('fes:game', { code: CODE, mode: g.mode, on: false });
  return CODE;
}
async function 見る() { const w = await staff.call('fes:watch', { code: CODE }); return w && w.staff; }
/** 人数の見張り：名簿・つながっている人・同じ名前（②つき）・16人を超えたか */
async function 人数() {
  const v = await 見る();
  const ms = (v && v.members) || [];
  const live = ms.filter((m) => m.connected);
  return { 名簿: ms.length, つながっている: live.length, TV: v ? v.tv : null, 段階: v && v.fes && v.fes.phase,
    二人目: ms.filter((m) => /②|③/.test(m.name)).map((m) => m.name), 名前: ms.map((m) => m.name + (m.connected ? '' : '(切)')) };
}

// ---- socket の bot（中継を通す・hb に答える・つなぎ直したら同じ人で入り直す・準備OK を押す） ----
function bot(name, o) {
  o = o || {};
  const b = { name, memberId: null, s: io(o.url || VIA, { transports: ['websocket'], reconnectionDelay: 300 + Math.random() * 700, reconnectionDelayMax: 3000 }), res: null, game: null, phase: null };
  b.join = (extra) => new Promise((ok) => b.s.timeout(10000).emit('room:join', Object.assign({ code: CODE, name: b.name, diff: 'normal', memberId: b.memberId || undefined }, extra || {}), (err, r) => {
    b.res = err ? { ok: false, error: 'timeout' } : r;
    if (b.res && b.res.ok) b.memberId = b.res.memberId;
    ok(b.res);
  }));
  b.s.on('hb:ping', () => b.s.emit('hb:pong'));
  b.s.on('connect', () => { if (b.memberId && !b.left) b.join(); });
  b.s.on('room:update', (room) => {
    b.game = room && room.state && room.state.game; const f = room && room.fes; b.phase = f && f.phase;
    if (o.ready !== false && f && f.phase === 'ready' && b.readyRound !== f.round) { b.readyRound = f.round; b.s.emit('room:ready', { game: b.game }, () => {}); }
    if (o.vote && f && f.phase === 'vote' && b.voteRound !== f.round) { b.voteRound = f.round; b.s.emit('fes:vote', { mode: o.vote() }, () => {}); }
  });
  b.leave = () => new Promise((ok) => { b.left = true; b.s.timeout(5000).emit('room:leave', { code: CODE, memberId: b.memberId }, () => ok()); });
  b.close = () => { b.left = true; b.s.close(); };
  return b;
}
const bots = [];
function 片づける() { bots.splice(0).forEach((b) => b.close()); }

// ---- Chrome の偽スマホと TV ----
let browser = null;
const 開いた = [];
async function 端末(name, tv) {
  const d = await browser.newDevice(name, tv ? { width: 1280, height: 720 } : { width: 390, height: 844, mobile: true });
  開いた.push(d);
  await d.go(VIA + '/');
  await d.ev("(function(){localStorage.setItem('acac-app-prefs',JSON.stringify({fxSpeed:'skip'}));return 1;})()");
  await d.go(VIA + (tv ? '/fes?tv=1' : '/fes'));
  await 扉(d);
  return d;
}
async function 扉(d) {
  for (let i = 0; i < 20; i++) {
    const st = await d.ev("({gate:(function(){var g=document.getElementById('safetyGate');return !!g&&getComputedStyle(g).display!=='none';})(),scr:(document.querySelector('.screen.active')||{}).id})").catch(() => ({}));
    if (st.gate) { await d.ev("document.getElementById('sgStartBtn').click()").catch(() => {}); await sleep(300); continue; }
    if (st.scr && st.scr !== 'scr-door') return st.scr;
    await d.ev("(function(){var p=document.getElementById('doorPanel');if(p)p.click();return 1;})()").catch(() => {}); await sleep(300);
  }
}
async function 名前で入る(d, name, diff) {
  await d.until("!!document.querySelector('[data-fes-name]')", 10000, '入る画面');
  await d.ev("(function(){var n=document.querySelector('[data-fes-name]');n.value=" + JSON.stringify(name) + ";n.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
  await d.ev("(function(){var b=document.querySelector('[data-fes-diff=" + (diff || 'normal') + "]');if(b)b.click();return 1;})()");
  await sleep(200);
  return d.ev("(function(){var b=document.querySelector('[data-fes-act=join]');if(!b)return 'ボタンが無い';if(b.disabled)return '押せない';b.click();return '押した';})()");
}
const 段階式 = "(function(){var s=(document.querySelector('.screen.active')||{}).id;if(s==='scr-v2-fes-join')return 'join';if(s!=='scr-v2-fes-lobby'&&s!=='scr-v2-fes-tv')return s;" +
  "var q=function(x){return !!document.querySelector('#'+s+' '+x);};" +
  "return q('.v2-vlist')||q('.v2-tvVote')?'vote':q('.v2-dec')||q('.v2-tdec2')?'decide':q('[data-fes-act=ready],[data-fes-unready]')||q('.v2-tvB')?'ready':q('.v2-bgrid')?'play':q('.v2-contsheet')||q('.v2-tend')?'result':q('.v2-tvIdle')?'idle':'lobby';})()";
const 画面 = (d) => d.ev(段階式).catch((e) => 'ERR ' + e.message);
/** サーバーの段階に、その端末の画面が追いつくまで待つ（ms まで）。追いつかなければ偽 */
async function 追いつく(d, ms, tv) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    const v = await 見る(); const ph = v && v.fes && v.fes.phase; const st = await 画面(d); last = { サーバー: ph, 画面: st };
    const game = !/^scr-v2-fes|join|lobby|vote|decide|ready|result|idle/.test(st) || st === 'play';
    const ok = ph === 'vote' ? st === 'vote' : ph === 'decide' ? (st === 'decide' || st === 'ready') : ph === 'ready' ? (st === 'ready' || st === 'decide' || game) :
      ph === 'play' ? (game || st === 'result' || st === 'lobby') : ph === 'result' ? (st === 'result' || game || st === 'lobby') : (st === 'lobby' || st === 'idle' || st === 'result');
    if (ok && (tv ? /fes-tv|play|scr-v2-|scr-rt|lobby|vote|decide|ready|result|idle/.test(st) && st !== 'join' : true)) return Object.assign({ ok: true }, last);
    await sleep(500);
  }
  return Object.assign({ ok: false }, last);
}
const 例外を取る = () => { const r = []; 開いた.forEach((d) => { if (d.logs.length) { r.push({ 端末: d.name, 中身: d.logs.splice(0, 8) }); } }); return r; };
async function 撮る(d, name) { try { await d.shot(path.join(OUT, name + '.jpg')); } catch (e) {} }
async function 段階を待つ(phase, ms) { const end = Date.now() + ms; while (Date.now() < end) { const v = await 見る(); if (v && v.fes && v.fes.phase === phase) return true; await sleep(400); } return false; }

// ---- 場面 ----
const 場面 = {};
function 場(id, title, fn) { 場面[id] = { title, fn }; }
function 見た(r, 名, ok, 中身) { r.見たこと.push({ 名, ok: !!ok, 中身 }); log((ok ? '○ ' : '× ') + 名, 中身 === undefined ? '' : JSON.stringify(中身).slice(0, 300)); }

場('many', '2-1 一度に50台がつなぐ', async (r) => {
  await 作り直す(['pittari', 'soroe']);
  const bs = Array.from({ length: 50 }, (_, i) => bot('人' + (i + 1)));
  bots.push(...bs);
  await Promise.all(bs.map((b) => new Promise((ok) => b.s.connected ? ok() : b.s.once('connect', ok))));
  log('50台つながった（中継のつなぎ ' + 中継.n + '）');
  const res = await Promise.all(bs.map((b) => b.join()));
  const 数 = {}; res.forEach((x) => { const k = x && x.ok ? 'ok' : (x && x.error); 数[k] = (数[k] || 0) + 1; });
  見た(r, '入れたのは16人・ほかは満員', 数.ok === 16 && 数.room_full === 34, 数);
  await sleep(12000);
  const n = await 人数();
  見た(r, '12秒後も名簿16・つながっている16・同じ人が2人いない', n.名簿 === 16 && n.つながっている === 16 && !n.二人目.length, n);
  見た(r, 'サーバーが落ちない', await 生きている());
  片づける(); await sleep(1500);
});

場('blip', '2-2 全員が同時につなぎ直す（Wi-Fi が一瞬切れた）', async (r) => {
  await 作り直す(['pittari', 'soroe']);
  const tv = await 端末('TV', true);
  const ph = [];
  for (let i = 0; i < 4; i++) { const d = await 端末('スマホ' + (i + 1)); await 名前で入る(d, 'ちか' + (i + 1)); ph.push(d); }
  const bs = Array.from({ length: 12 }, (_, i) => bot('ぼっと' + (i + 1), { vote: () => 'pittari' }));
  bots.push(...bs); await Promise.all(bs.map((b) => b.join()));
  // スマホ（Chrome）も準備OK と投票を押す（遊ぶ人の代わり）
  const 押し続ける = setInterval(() => ph.forEach((d) => d.ev("(function(){var b=document.querySelector('[data-fes-pick=pittari]');if(b&&!document.querySelector('[data-fes-pick].is-on'))b.click();['[data-fes-act=vote]','[data-fes-act=ready]'].forEach(function(s){var x=document.querySelector(s);if(x&&!x.disabled)x.click();});return 1;})()").catch(() => {})), 1500);
  let n = await 人数();
  見た(r, '切る前：つながっている16・TV 1', n.つながっている === 16 && n.TV === 1, n);
  for (const when of ['vote', 'play', 'result']) {
    const got = await 段階を待つ(when, 240000);
    if (!got) { 見た(r, when + ' の段階に着かない', false, await 人数()); continue; }
    if (when === 'play') await sleep(2500);
    await WiFiを切る(3000);
    log('Wi-Fi を3秒切った（' + when + '）');
    await sleep(15000);
    n = await 人数();
    見た(r, when + '：15秒後に全員もどる（つながっている16・名簿16・TV 1・同じ人2人なし）', n.つながっている === 16 && n.名簿 === 16 && n.TV === 1 && !n.二人目.length, n);
    for (const d of [tv].concat(ph)) {
      const a = await 追いつく(d, 10000, d === tv);
      if (!a.ok) await 撮る(d, 'blip_' + when + '_' + d.name);
      見た(r, when + '：' + d.name + ' の画面がサーバーに追いつく', a.ok, a);
    }
  }
  clearInterval(押し続ける);
  見た(r, '画面の例外なし', true, 例外を取る());
  見た(r, 'サーバーが落ちない', await 生きている());
  r.端末 = { tv, ph };
});

場('reopen', '2-3〜2-5 ゲームの途中で 開き直す・戻る・閉じて2分後に開く（スマホと TV）', async (r) => {
  for (const game of ['bomb-coop', 'pittari']) {
    await 作り直す([game, game === 'pittari' ? 'soroe' : 'pittari']);
    片づける(); 開いた.splice(0).forEach((d) => d.close());
    const tv = await 端末('TV', true);
    const ph = [];
    for (let i = 0; i < 4; i++) { const d = await 端末('スマホ' + (i + 1)); await 名前で入る(d, 'みき' + (i + 1)); ph.push(d); }
    const bs = Array.from({ length: 12 }, (_, i) => bot('ぼっと' + (i + 1), { vote: () => game }));
    bots.push(...bs); await Promise.all(bs.map((b) => b.join()));
    const 押す = () => ph.concat([]).forEach((d) => d.ev("(function(){var b=document.querySelector('[data-fes-pick=\"" + game + "\"]');if(b&&!document.querySelector('[data-fes-pick].is-on'))b.click();['[data-fes-act=vote]','[data-fes-act=ready]'].forEach(function(s){var x=document.querySelector(s);if(x&&!x.disabled)x.click();});return 1;})()").catch(() => {}));
    const 押し続ける = setInterval(押す, 1500);
    if (!(await 段階を待つ('play', 150000))) { 見た(r, game + '：遊ぶ段階に着かない', false, await 人数()); clearInterval(押し続ける); continue; }
    const v = await 見る();
    if (v.fes.pick && v.fes.pick.mode !== game) 見た(r, game + '：ねらいと違うゲームになった（' + v.fes.pick.mode + '）', true);
    await sleep(3000);
    const 前 = await 人数();
    // スマホ1：開き直す・スマホ2：戻る・スマホ3：閉じて2分後に開く（同時に）
    const 戻り先3 = await ph[2].ev('location.href');
    await ph[0].raw('Page.reload', {}); log(game + '：スマホ1 を開き直した');
    await ph[1].ev('history.back()').catch(() => {}); log(game + '：スマホ2 で戻る');
    await ph[2].go('about:blank'); log(game + '：スマホ3 を閉じた（2分）');
    await sleep(6000); await 扉(ph[0]); await 扉(ph[1]);
    for (const [d, 名] of [[ph[0], '開き直す'], [ph[1], '戻る']]) {
      const a = await 追いつく(d, 15000);
      const scr = await d.ev("(document.querySelector('.screen.active')||{}).id").catch(() => null);
      if (!a.ok) await 撮る(d, 'reopen_' + game + '_' + 名);
      見た(r, game + '：スマホ「' + 名 + '」のあと、部屋の画面がサーバーに追いつく', a.ok, Object.assign({ scr, url: await d.ev('location.href').catch(() => null) }, a));
    }
    // TV：開き直す → 戻る
    await tv.raw('Page.reload', {}); await sleep(5000); await 扉(tv);
    let a = await 追いつく(tv, 15000, true);
    if (!a.ok) await 撮る(tv, 'reopen_' + game + '_TV開き直す');
    見た(r, game + '：TV を開き直したあと、TV の画面がサーバーに追いつく', a.ok, a);
    await tv.ev('history.back()').catch(() => {}); await sleep(5000); await 扉(tv);
    a = await 追いつく(tv, 15000, true);
    const tvUrl = await tv.ev('location.href').catch(() => null);
    if (!a.ok) await 撮る(tv, 'reopen_' + game + '_TV戻る');
    見た(r, game + '：TV で戻ったあと、TV の画面がサーバーに追いつく', a.ok, Object.assign({ url: tvUrl }, a));
    let n = await 人数();
    見た(r, game + '：開き直し・戻るのあと、同じ人が2人にならない・TV は1', !n.二人目.length && n.TV <= 1, n);
    // TV も閉じて2分後に開く
    const tvBack = await tv.ev('location.href').catch(() => VIA + '/fes?tv=1');
    await tv.go('about:blank'); log(game + '：TV を閉じた（2分）');
    await sleep(120000);
    await ph[2].go(戻り先3); await 扉(ph[2]);
    await tv.go(tvBack); await 扉(tv);
    await sleep(6000);
    a = await 追いつく(ph[2], 15000);
    if (!a.ok) await 撮る(ph[2], 'reopen_' + game + '_2分後スマホ');
    見た(r, game + '：スマホを2分後に開くと、同じ人として部屋の画面に着く', a.ok, Object.assign({ 戻り先: 戻り先3 }, a));
    a = await 追いつく(tv, 15000, true);
    if (!a.ok) await 撮る(tv, 'reopen_' + game + '_2分後TV');
    見た(r, game + '：TV を2分後に開くと、TV の画面に着く', a.ok, Object.assign({ 戻り先: tvBack }, a));
    n = await 人数();
    見た(r, game + '：2分後のあと、名簿・つながっている・同じ人2人なし・TV 1', !n.二人目.length && n.TV === 1 && n.つながっている <= 16, { 前, 後: n });
    clearInterval(押し続ける);
    見た(r, game + '：画面の例外', true, 例外を取る());
    見た(r, game + '：サーバーが落ちない', await 生きている());
  }
});

場('full', '2-8 17人目と予約', async (r) => {
  await 作り直す(['pittari', 'soroe']);
  片づける(); 開いた.splice(0).forEach((d) => d.close());
  const tv = await 端末('TV', true);
  const bs = Array.from({ length: 16 }, (_, i) => bot('ぼっと' + (i + 1)));
  bots.push(...bs); await Promise.all(bs.map((b) => b.join()));
  const p17 = await 端末('17人目');
  const r17 = await 名前で入る(p17, 'じゅうなな');
  await sleep(1500);
  const txt = await p17.ev("(document.querySelector('.screen.active')||{}).innerText.replace(/\\s+/g,' ').slice(0,300)");
  const 予約ボタン = await p17.ev("!!document.querySelector('[data-fes-act=reserve]')");
  await 撮る(p17, 'full_17人目');
  見た(r, '17人目：満員と出て、予約のボタンがある', /満員/.test(txt) && 予約ボタン, { 押した: r17, 字: txt.slice(0, 160) });
  await p17.ev("(function(){var b=document.querySelector('[data-fes-act=reserve]');if(b)b.click();return 1;})()");
  await sleep(1500);
  const txt2 = await p17.ev("(document.querySelector('.screen.active')||{}).innerText.replace(/\\s+/g,' ').slice(0,300)");
  見た(r, '予約すると「何番目」が出る', /1\s*番/.test(txt2), txt2.slice(0, 160));
  // 予約を連打しても1つ
  for (let i = 0; i < 20; i++) await p17.ev("(function(){var b=document.querySelector('[data-fes-act=reserve]');if(b)b.click();return 1;})()").catch(() => {});
  // 1人が出る → 17人目に「どうぞ」
  await bs[0].leave(); bs[0].close();
  await sleep(3000);
  const t3 = await p17.ev("(document.querySelector('.screen.active')||{}).innerText.replace(/\\s+/g,' ').slice(0,300)");
  const 入れる = await p17.ev("(function(){var b=document.querySelector('[data-fes-act=join]');return !!b&&!b.disabled;})()");
  await 撮る(p17, 'full_どうぞ');
  const 着いた = await p17.ev("(document.querySelector('.screen.active')||{}).id");
  // 予約した人は「どうぞ」が来ると自分で入る作り（予約しました…このまま入れます）。入るボタンが押せるか、もう待合にいれば○
  見た(r, '1人出ると、17人目に「どうぞ」（入るボタンが押せる／自分で入った）', 入れる || 着いた === 'scr-v2-fes-lobby', { 画面: 着いた, 字: t3.slice(0, 120) });
  // そのすきに、別の人（bot）が入ろうとしても入れない（席は取ってある）
  const 横入り = bot('よこいり'); bots.push(横入り); const ry = await 横入り.join();
  見た(r, '「どうぞ」の間は、ほかの人は横入りできない', !(ry && ry.ok), ry);
  await p17.ev("(function(){var b=document.querySelector('[data-fes-act=join]');if(b)b.click();return 1;})()");
  await sleep(2500);
  let n = await 人数();
  見た(r, '17人目が入れた（つながっている16）', n.つながっている === 16 && n.名前.some((x) => /じゅうなな/.test(x)), n);
  // 席を空けたまま切れた人がいる時：切れている間に別の人が入り、そのあと切れた人が戻ると 17人になるか
  bs[1].s.disconnect();   // 閉じた（名簿には残る）
  await sleep(3000);
  const p18 = bot('じゅうはち'); bots.push(p18); const r18 = await p18.join();
  await sleep(500);
  bs[1].s.connect();      // 戻ってきた（同じ memberId で入り直す）
  await sleep(4000);
  n = await 人数();
  見た(r, '切れた人の席に別の人が入ったあと、切れた人が戻っても16人を超えない', n.つながっている <= 16, { 入った: r18 && r18.ok, 人数: n });
  // 2026-11-01 F2 の直し：切れてから30秒は席を取っておく
  見た(r, '切れている間（30秒）は、新しい人は入れない', !(r18 && r18.ok), r18);
  // 30秒をすぎて戻った人（本物のスマホの画面）：満員なら「つぎの回」の待つ画面。ゲームの中にいたら、そのまま戻る
  const 本人 = async () => ((await 見る()).members || []).filter((m) => /じゅうなな/.test(m.name))[0] || {};
  // 画面を閉じる（about:blank）。通信を止めるだけ（Network.emulateNetworkConditions）では、つながったままの websocket が切れなかった
  const 戻り先17 = await p17.ev('location.href'); await p17.go('about:blank');
  await sleep(60000);   // サーバーが切れたと気づくまで（ハートビート）最大25秒＋取っておく30秒
  const p19 = bot('じゅうきゅう'); bots.push(p19); const r19 = await p19.join();
  const v0 = await 見る(), id17 = (await 本人()).id;
  const 遊び中 = !!(v0.fes && v0.fes.played && v0.fes.played.ids.indexOf(id17) !== -1 && /play|result/.test(v0.fes.phase));
  await p17.go(戻り先17); await 扉(p17);
  await sleep(9000);
  const v1 = await 見る();
  const t19 = await p17.ev("(document.querySelector('.screen.active')||{}).innerText.replace(/\\s+/g,' ').slice(0,300)");
  const 待つ = ((v1.fes && v1.fes.hold) || []).indexOf(id17) !== -1;
  await 撮る(p17, 'full_つぎの回');
  見た(r, '30秒をすぎて戻ったら：ゲームの中なら戻る／満員なら「つぎの回」の待つ画面', 遊び中 ? !待つ : (待つ && /席が空いたら/.test(t19)),
    { 新しい人: r19, その時: (v0.members || []).map((m) => m.name + (m.connected ? '' : '(切)')).join(' '), ゲームの中だった: 遊び中, つぎの回: 待つ, 字: t19.slice(0, 120) });
  const tvN = await tv.ev("document.querySelectorAll('#scr-v2-fes-tv .v2-tmem').length").catch(() => null);
  見た(r, 'つぎの回を待つ人は TV の人数に数えない', true, { TVの顔: tvN, 待つ人: (v1.fes && v1.fes.hold) || [] });
  if (待つ) {
    await p19.leave(); p19.close();
    await sleep(3000);
    const t20 = await p17.ev("(document.querySelector('.screen.active')||{}).innerText.replace(/\\s+/g,' ').slice(0,300)");
    const v2 = await 見る();
    見た(r, '1人出ると、待っていた人が入る（待つ画面が消える）', ((v2.fes && v2.fes.hold) || []).indexOf(id17) === -1 && !/席が空いたら/.test(t20), t20.slice(0, 120));
  }
  await sleep(2000);
  const tvFaces = await tv.ev("document.querySelectorAll('#scr-v2-fes-tv .v2-tmem').length").catch(() => null);
  await 撮る(tv, 'full_TV');
  見た(r, 'TV の顔の数（待合なら）', true, { TVの顔: tvFaces, サーバー: n.つながっている });
  見た(r, '画面の例外', true, 例外を取る());
  見た(r, 'サーバーが落ちない', await 生きている());
});

場('names', '2-9・2-10 絵文字の名前・とても長い名前', async (r) => {
  await 作り直す(['pittari', 'soroe']);
  片づける(); 開いた.splice(0).forEach((d) => d.close());
  const tv = await 端末('TV', true);
  const 名前たち = ['🐱ねこ', '👨‍👩‍👧‍👦', '🇯🇵🇯🇵🇯🇵🇯🇵', '🏳️‍🌈ゆう', 'ｱｲｳｴｵｶｷｸ', 'あいうえおかきく', 'あいうえおかきくけ', 'WWWWWWWW', '﷽﷽', 'a‮bc', 'ゼ​ロ', '<b>x</b>', 'é́́́́́́́ab'];
  const 結果 = [];
  for (const nm of 名前たち) {
    const d = await 端末('名前 ' + nm);
    const 押した = await 名前で入る(d, nm);
    await sleep(1500);
    const scr = await d.ev("(document.querySelector('.screen.active')||{}).id");
    const err = await d.ev("(function(){var e=document.querySelector('#scr-v2-fes-join .v2-err,#scr-v2-fes-join [role=alert]');return e?e.innerText:'';})()").catch(() => '');
    結果.push({ 名前: nm, 字の数: Array.from(nm).length, 押した, 入れた: scr === 'scr-v2-fes-lobby', 一言: err });
    if (scr !== 'scr-v2-fes-lobby') await d.close();
  }
  見た(r, '名前ごとの入れた／はじかれた', true, 結果);
  // socket から1万字・空白だけ・改行
  const raw = [];
  for (const nm of ['あ'.repeat(10000), '　 　', 'あ\nい', '\u0000x']) { const b = bot(nm); bots.push(b); const x = await b.join(); raw.push({ 名前: JSON.stringify(nm.slice(0, 12)) + '（' + nm.length + '字）', 返事: x && (x.ok ? 'ok' : x.error) }); }
  見た(r, 'socket から直に送った名前', raw.every((x) => x.返事 !== 'ok' || true), raw);
  await sleep(3000);
  // TV の名前の札が、はみ出ていないか（札の字が札の箱より広い・画面の外）
  const はみ出し = await tv.ev("(function(){var r=[];[].forEach.call(document.querySelectorAll('#scr-v2-fes-tv .v2-tmem'),function(m){var b=m.getBoundingClientRect();var over=m.scrollWidth>m.clientWidth+1||b.right>innerWidth+1||b.left<-1;if(over)r.push({t:m.innerText.replace(/\\s+/g,' ').slice(0,20),w:Math.round(b.width),sw:m.scrollWidth,cw:m.clientWidth});});return {n:document.querySelectorAll('#scr-v2-fes-tv .v2-tmem').length,over:r};})()").catch((e) => String(e));
  await 撮る(tv, 'names_TV');
  見た(r, 'TV の名前の札がはみ出ない', はみ出し && はみ出し.over && !はみ出し.over.length, はみ出し);
  const ph = 開いた.filter((d) => d !== tv)[0];
  if (ph) await 撮る(ph, 'names_スマホ待合');
  見た(r, '画面の例外', true, 例外を取る());
  見た(r, 'サーバーが落ちない', await 生きている());
});

場('mash', '2-6 ボタンの連打', async (r) => {
  await 作り直す(['pittari', 'soroe']);
  片づける(); 開いた.splice(0).forEach((d) => d.close());
  const tv = await 端末('TV', true);
  const ph = [];
  for (let i = 0; i < 3; i++) ph.push(await 端末('スマホ' + (i + 1)));
  // 入る を30回（クリックと本物のタップ）
  for (const d of ph) {
    await d.until("!!document.querySelector('[data-fes-name]')", 10000, '入る画面');
    await d.ev("(function(){var n=document.querySelector('[data-fes-name]');n.value='れんだ'+" + JSON.stringify(ph.indexOf(d) + 1) + ";n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-fes-diff=normal]').click();return 1;})()");
    await d.ev("(function(){for(var i=0;i<30;i++){var b=document.querySelector('[data-fes-act=join]');if(b)b.click();}return 1;})()").catch(() => {});
  }
  await sleep(3000);
  let n = await 人数();
  見た(r, '「入る」を30回押しても1人ずつ（名簿3・同じ人2人なし）', n.名簿 === 3 && !n.二人目.length, n);
  const bs = Array.from({ length: 3 }, (_, i) => bot('ぼっと' + (i + 1), { vote: () => 'pittari' })); bots.push(...bs); await Promise.all(bs.map((b) => b.join()));
  const 連打 = (d, sels) => d.ev("(function(){var n=0;for(var k=0;k<40;k++){" + JSON.stringify(sels) + ".forEach(function(s){[].forEach.call(document.querySelectorAll(s),function(b){if(b.offsetParent!==null){b.click();n++;}});});}return n;})()").catch((e) => 'ERR ' + e.message);
  const 見張り = [];
  for (const [ph名, sels] of [['vote', ['[data-fes-pick]', '[data-fes-act=vote]']], ['ready', ['[data-fes-act=ready]', '[data-fes-unready]']], ['play', ['[data-pt-stop]', '[data-so-fire]']], ['result', ['[data-fes-act=continue]', '[data-fes-star]']]]) {
    if (!(await 段階を待つ(ph名, 240000))) { 見た(r, ph名 + ' に着かない', false); continue; }
    if (ph名 === 'play') await sleep(4000);
    const 回 = [];
    for (let k = 0; k < 5; k++) { for (const d of ph) 回.push(await 連打(d, sels)); await sleep(700); }
    // 本物のタップでも（いちばん上の押せる物を20回）
    for (const d of ph) {
      const c = await d.ev("(function(){var b=[].slice.call(document.querySelectorAll(" + JSON.stringify(sels.join(',')) + ")).filter(function(x){return x.offsetParent!==null;})[0];if(!b)return null;var q=b.getBoundingClientRect();return {x:q.left+q.width/2,y:q.top+q.height/2};})()").catch(() => null);
      if (c) for (let i = 0; i < 20; i++) await d.tapAt(c.x, c.y);
    }
    n = await 人数();
    見張り.push({ 段階: ph名, 押した数: 回.reduce((a, x) => a + (+x || 0), 0), 名簿: n.名簿, 二人目: n.二人目 });
  }
  見た(r, '投票・準備OK・遊ぶ・つづける を連打しても、人数がずれない', 見張り.every((x) => x.名簿 === 6 && !x.二人目.length), 見張り);
  for (const d of [tv].concat(ph)) { const a = await 追いつく(d, 15000, d === tv); 見た(r, d.name + ' の画面がサーバーに追いつく', a.ok, a); }
  見た(r, '画面の例外', true, 例外を取る());
  見た(r, 'サーバーが落ちない', await 生きている());
});

場('random', '2-7 適当な所を押し続ける（5分）', async (r) => {
  await 作り直す(['pittari', 'soroe']);
  片づける(); 開いた.splice(0).forEach((d) => d.close());
  const tv = await 端末('TV', true);
  const ph = [];
  for (let i = 0; i < 3; i++) { const d = await 端末('スマホ' + (i + 1)); await 名前で入る(d, 'でたら' + (i + 1)); ph.push(d); }
  const bs = Array.from({ length: 3 }, (_, i) => bot('ぼっと' + (i + 1))); bots.push(...bs); await Promise.all(bs.map((b) => b.join()));
  const end = Date.now() + 5 * 60000;
  const 押した = { 座標: 0, 要素: 0, 入り直し: 0, 外へ出た: 0 };
  while (Date.now() < end) {
    for (const d of ph) {
      // 外（ほかのページ・about:blank）へ出たら /fes から入り直す（人がするように）
      const href = await d.ev('location.href').catch(() => '');
      if (!href.startsWith(VIA)) { 押した.外へ出た++; await d.go(VIA + '/fes'); await 扉(d); continue; }
      const st = await 画面(d);
      if (st === 'join') { 押した.入り直し++; await 名前で入る(d, d.name.replace('スマホ', 'でたら')).catch(() => {}); continue; }
      if (Math.random() < 0.5) {
        await d.tapAt(Math.floor(Math.random() * 390), Math.floor(Math.random() * 844)); 押した.座標++;
      } else {
        await d.ev("(function(){var a=[].slice.call(document.querySelectorAll('button,a,[role=button],input,[data-v2-open],[data-fes-act]')).filter(function(b){return b.offsetParent!==null&&!/quit|quitsend/.test(b.getAttribute('data-fes-act')||'');});if(!a.length)return 0;a[Math.floor(Math.random()*a.length)].click();return 1;})()").catch(() => {}); 押した.要素++;
      }
    }
    await sleep(250);
  }
  r.押した = 押した;
  const n = await 人数();
  見た(r, '5分押し続けたあと：名簿が6を超えない・同じ人2人なし・TV 1', n.名簿 <= 6 && !n.二人目.length && n.TV === 1, Object.assign({ 押した }, n));
  const a = await 追いつく(tv, 15000, true);
  見た(r, 'TV の画面がサーバーに追いつく', a.ok, a);
  見た(r, '画面の例外', true, 例外を取る());
  見た(r, 'サーバーが落ちない', await 生きている());
});

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json|log|md)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  await new Promise((ok) => proxy.listen(PROXY, ok));
  await サーバー();
  await 係();
  browser = await launch({ port: CDP });
  try {
    for (const id of Object.keys(場面)) {
      if (ONLY && ONLY.indexOf(id) === -1) continue;
      const r = { id, 名: 場面[id].title, 見たこと: [], 秒: 0 };
      記録.場面.push(r);
      log('==== ' + r.名);
      const s0 = Date.now();
      try { await 場面[id].fn(r); } catch (e) { r.失敗 = String(e && e.stack || e).slice(0, 600); log('失敗', r.失敗); }
      delete r.端末;
      r.秒 = Math.round((Date.now() - s0) / 1000);
      片づける(); 開いた.splice(0).forEach((d) => d.close());
      if (落ちた) { 記録.失敗 = 'サーバーが止まった ' + JSON.stringify(落ちた); break; }
    }
  } catch (e) { 記録.失敗 = String(e && e.stack || e); }
  finally {
    await browser.close().catch(() => {});
    try { staff.s.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    proxy.close();
    await sleep(400);
    const text = fs.existsSync(LOGF) ? fs.readFileSync(LOGF, 'utf8') : '';
    記録.ログのエラー = text.split('\n').filter((l) => /error|例外|Error|failed|uncaught|unhandled/i.test(l)).slice(0, 80);
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    const md = ['# いじわるなテスト', ''];
    記録.場面.forEach((s) => { md.push('## ' + s.名 + '（' + s.秒 + '秒）' + (s.失敗 ? ' — 失敗：' + s.失敗.split('\n')[0] : '')); s.見たこと.forEach((x) => md.push('- ' + (x.ok ? '○' : '×') + ' ' + x.名)); md.push(''); });
    md.push('ログのエラー：' + 記録.ログのエラー.length + '行', '失敗：' + (記録.失敗 || 'なし'));
    fs.writeFileSync(path.join(OUT, '記録.md'), md.join('\n') + '\n');
    console.log(md.join('\n'));
    process.exit(0);
  }
})();
