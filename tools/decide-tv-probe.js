#!/usr/bin/env node
// tools/decide-tv-probe.js — 文化祭の TV の「つぎのゲームは…」（決まる画面）で、動きが本当に流れたかを本物の流れで測る（指示78 ウ・調べるだけ）
//
//   node tools/decide-tv-probe.js --port 3441 --cdp 9741 [--rounds 2] [--reduce]
//
// 手元の検証用サーバーだけ。係（/dev-login）が部屋を作り、スマホ2台（tools/fes-agent.js）と TV 1920×1080。
// TV のページの中で、決まる段のあいだ「画面の描き直し（#scr-v2-fes-tv の中身の入れかえ）」「is-play の付け外し」
// 「始まった CSS アニメ（v2-dhop・v2-dwin・v2-dwash など）」を時刻つきで拾う。--reduce は TV を「動きを減らす」（Windows のアニメーション切）にする。
// 記録：docs/検査_1107_証拠/監査_全画面/decide-tv[-reduce]/記録.json

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const { launch, sleep } = require('./cdp');
const { AGENT } = require('./fes-agent');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3441), CDP = +arg('cdp', 9741), ROUNDS = +arg('rounds', 2), REDUCE = !!arg('reduce', false);
// --join：決まる段に入って 1.2秒あとに、3台目のスマホが部屋に入る（当日、決まる途中に人が来る形）
const JOIN = !!arg('join', false);
// --poke：決まる段に入って 1.5秒あとに、係が使っていないゲームの入／切を1回ずつ押す（部屋の知らせが TV に届いて描き直す）
const POKE = !!arg('poke', false);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '検査_1107_証拠', '監査_全画面', 'decide-tv' + (REDUCE ? '-reduce' : '') + (JOIN ? '-join' : '') + (POKE ? '-poke' : ''))));
const BASE = 'http://localhost:' + PORT;
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + '秒 ' + a.join(' '));

const WATCH = function () {
  if (window.__dt) return 0;
  var W = window.__dt = { ev: [] };
  var push = function (o) { o.t = Date.now(); W.ev.push(o); if (W.ev.length > 3000) W.ev.splice(0, 1000); };
  document.addEventListener('animationstart', function (e) { if (/^v2-d/.test(e.animationName)) push({ k: 'anim', n: e.animationName }); }, true);
  var scr = document.getElementById('scr-v2-fes-tv');
  new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      if (m.type === 'childList' && m.target === scr) push({ k: 'render', dec: !!scr.querySelector('.v2-tdec2'), play: scr.classList.contains('is-play') });
      if (m.type === 'attributes' && m.attributeName === 'class') push({ k: 'class', play: scr.classList.contains('is-play'), dec: !!scr.querySelector('.v2-tdec2') });
    });
  }).observe(scr, { childList: true, attributes: true, attributeFilter: ['class'] });
  return 1;
};

function サーバー() {
  const out = fs.openSync(path.join(OUT, 'server.log'), 'w');
  return spawn(process.execPath, [path.join(ROOT, 'tools', 'dev-server.js')], { cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT), PROBE: '' }), stdio: ['ignore', out, out] });
}
async function 係() {
  const r = await fetch(BASE + '/dev-login', { redirect: 'manual' });
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')]).map((c) => String(c).split(';')[0]).join('; ');
  const s = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] });
  await new Promise((ok) => s.once('connect', ok));
  const call = (ev, p) => new Promise((ok) => s.timeout(8000).emit(ev, p || {}, (err, res) => ok(err ? { ok: false, error: 'timeout' } : res)));
  return { s, call };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = サーバー();
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  const staff = await 係();
  const c = await staff.call('fes:create', { recreate: false });
  const code = c.code;
  const b = await launch({ port: CDP });
  const 記録 = { reduce: REDUCE, 回: [] };
  try {
    const tv = await b.newDevice('TV', { width: 1920, height: 1080 });
    if (REDUCE) await tv.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await tv.go(BASE + '/fes?tv=1');
    const phones = [];
    for (const n of ['あき', 'いお']) {
      const d = await b.newDevice(n, { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
      await d.go(BASE + '/fes');
      d.cfg = { name: n, diff: 'normal', round: 0, target: null };
      phones.push(d);
    }
    const 入れる = async (d, cfg, w) => d.ev('(function(){(' + AGENT.toString() + ')();' + (w ? '(' + WATCH.toString() + ')();' : '') + 'window.__soak.cfg=' + JSON.stringify(cfg) + ';return 1;})()').catch(() => 0);
    await 入れる(tv, { tv: true }, true);
    for (const d of phones) await 入れる(d, d.cfg, false);
    let 前 = null, 決 = null, 済 = 0;
    const 締め = Date.now() + 12 * 60000;
    while (Date.now() < 締め && 済 < ROUNDS) {
      const f = ((await staff.call('fes:watch', { code })).staff || {}).fes || {};
      if (!(await tv.ev('!!window.__dt').catch(() => false))) await 入れる(tv, { tv: true }, true);
      if (f.phase === 'decide' && 前 !== 'decide') {
        決 = Date.now(); log('決まる段', f.pick && f.pick.mode, f.pick && f.pick.lot);
        if (POKE) setTimeout(async () => {
          const gs = ((await staff.call('fes:watch', { code })).staff || {}).games || [];
          const g = gs.find((x) => !x.on) || gs[gs.length - 1];
          await staff.call('fes:game', { code, mode: g.mode, on: !g.on });
          await staff.call('fes:game', { code, mode: g.mode, on: !!g.on });
          log('係が入／切を押した（決まる段から', Date.now() - 決, 'ms）', g.mode);
        }, 1500);
        if (JOIN) setTimeout(async () => {
          const n = 'くる' + 済;
          const d = await b.newDevice(n, { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
          await d.go(BASE + '/fes');
          await 入れる(d, { name: n, diff: 'normal', round: 0, target: null }, false);
          log('3台目が入った（決まる段から', Date.now() - 決, 'ms）');
        }, 0);
      }
      if (前 === 'decide' && f.phase !== 'decide' && 決) {
        const ev = await tv.ev('window.__dt.ev.splice(0)').catch(() => []);
        const 窓 = ev.filter((e) => e.t >= 決 - 1500).map((e) => Object.assign({}, e, { t: e.t - 決 }));
        const 描 = 窓.filter((e) => e.k === 'render' && e.dec);
        const はじめ = 描.length ? 描[0].t : null;
        const 外れ = 窓.filter((e) => e.k === 'class' && e.dec && !e.play && はじめ != null && e.t > はじめ);
        const anims = Array.from(new Set(窓.filter((e) => e.k === 'anim').map((e) => e.n)));
        const r = { mode: f.played ? f.played.mode : null, 描き直し: 描.length, 描いた時刻: 描.map((e) => e.t + (e.play ? '(play)' : '(止)')), is_play_外れ: 外れ.map((e) => e.t), 始まったアニメ: anims };
        記録.回.push(r);
        log('決まる段の TV：描き直し', 描.length, '回', JSON.stringify(r.描いた時刻), '・is-play が外れた', JSON.stringify(r.is_play_外れ), '・アニメ', anims.join(','));
        決 = null; 済++;
      }
      前 = f.phase;
      await sleep(150);
    }
  } catch (e) { 記録.失敗 = String(e && e.stack || e); console.error(e); }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
  try { await b.close(); } catch (e) {}
  srv.kill();
  process.exit(0);
})();
