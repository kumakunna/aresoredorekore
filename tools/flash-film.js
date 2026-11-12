#!/usr/bin/env node
// tools/flash-film.js — 文化祭で「ゲームが終わって『つづける？』が出る瞬間」の画面全体の光を、コマで撮って測る（指示78 ア）
//
//   node tools/flash-film.js --games onaji-many,pittari --port 3431 --cdp 9731 [--tag before] [--fx normal|skip]
//
// 手元の検証用サーバーだけ（本番にはつながない）。係（/dev-login）が部屋を作り、--games のゲームだけ入にする（終わったら元にもどす）。
// 端末：スマホ 375×667・390×844 を、⚙ の「光の点滅」入／切 で1台ずつ（4台）＋TV 1920×1080。中に tools/fes-agent.js の「遊ぶ人」。
// 遊ぶ段に入ったら全部の端末で画面配信（Page.startScreencast）を始め、「つづける？」（.v2-contsheet / TV は .v2-tend）が出た時刻を
// ページの中で拾う（rAF ごと）。出た 1.5秒前〜3.5秒後のコマを、別の白いページの canvas で小さく描いて、平均の明るさ（0〜1）を出す。
// 光った＝「出る前の落ち着いた明るさ」と「出た後の落ち着いた明るさ」の**両方より 0.12 以上明るいコマ**がある（一瞬だけ画面全体が明るくなる）。
// その瞬間に始まった CSS アニメ・遷移も拾って並べる（どの部品が光ったかの手がかり）。
// 記録：docs/検査_1107_証拠/監査_全画面/flash-<tag>/ に 記録.json・明るさ.md・光ったコマの写真。1件でも光れば終了コード 1。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const io = require('socket.io-client');
const { launch, sleep } = require('./cdp');
const { AGENT } = require('./fes-agent');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3431), CDP = +arg('cdp', 9731), MIN = +arg('min', 20);
const GAMES = String(arg('games', 'onaji-many')).split(',');
const TAG = String(arg('tag', 'now'));
const FX = String(arg('fx', 'normal'));
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '検査_1107_証拠', '監査_全画面', 'flash-' + TAG)));
const BASE = 'http://localhost:' + PORT;
const 光った差 = 0.12;
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + '秒 ' + a.join(' '));

// ページの中：「つづける？」が出た時刻と、その前後に始まったアニメ・遷移
const WATCH = function () {
  if (window.__ff) return 0;
  var W = window.__ff = { at: null, ev: [], round: null };
  function who(el) { if (!el || !el.tagName) return '?'; return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''); }
  ['animationstart', 'transitionstart'].forEach(function (k) {
    document.addEventListener(k, function (e) { W.ev.push({ t: Date.now(), k: k, n: e.animationName || e.propertyName, el: who(e.target) }); if (W.ev.length > 4000) W.ev.splice(0, 2000); }, true);
  });
  (function loop() {
    var c = document.querySelector('.screen.active .v2-contsheet, .screen.active .v2-tend, .screen.active .v2-tband.is-end');
    if (c && !W.at) {
      W.at = Date.now(); W.bar = [];
      // 指示78 イ：「つづけて遊ぶ？」のゲージの、描かれた長さ（枠に対する割合）を 0.5・3・6・9秒で測る（Chrome が transform まで計算した幅）
      [500, 3000, 6000, 9000].forEach(function (ms) {
        setTimeout(function () {
          var i = document.querySelector('.screen.active [data-fes-bar]');
          var r = i && i.getBoundingClientRect(), p = i && i.parentNode.getBoundingClientRect();
          W.bar.push({ ms: ms, 割合: r && p && p.width ? +(r.width / p.width).toFixed(3) : null });
        }, ms);
      });
    }
    requestAnimationFrame(loop);
  })();
  return 1;
};

// 白いページの中：JPEG の明るさ（平均・とても明るい画素の割合）
const LUMA = function (list) {
  return Promise.all(list.map(function (b64) {
    return new Promise(function (ok) {
      var im = new Image();
      im.onload = function () {
        var w = 64, h = Math.max(1, Math.round(64 * im.height / im.width));
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        var x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h).data, s = 0, hi = 0, n = w * h;
        for (var i = 0; i < d.length; i += 4) { var l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; s += l; if (l > 0.85) hi++; }
        ok({ m: +(s / n).toFixed(3), hi: +(hi / n).toFixed(3) });
      };
      im.onerror = function () { ok(null); };
      im.src = 'data:image/jpeg;base64,' + b64;
    });
  }));
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
  if (!up) throw new Error('サーバーが立ちません');
  const staff = await 係();
  const c = await staff.call('fes:create', { recreate: false });
  if (!c || !c.ok) throw new Error('部屋を作れません ' + JSON.stringify(c));
  const code = c.code;
  const sw0 = ((await staff.call('fes:watch', { code })).staff || {}).games || [];
  const もと = sw0.map((g) => ({ mode: g.mode, on: !!g.on }));
  for (const g of sw0) if (GAMES.includes(g.mode) && !g.on) await staff.call('fes:game', { code, mode: g.mode, on: true });
  for (const g of sw0) if (!GAMES.includes(g.mode) && g.on) await staff.call('fes:game', { code, mode: g.mode, on: false });
  const b = await launch({ port: CDP });
  const 記録 = { いつ: new Date().toISOString(), tag: TAG, fx: FX, ゲーム: GAMES, 回: [], 光った: [] };
  const 終わる = async (why, rc) => {
    記録.終わり方 = why;
    try { for (const g of もと) await staff.call('fes:game', { code, mode: g.mode, on: g.on }); } catch (e) {}
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    fs.writeFileSync(path.join(OUT, '明るさ.md'), 表(記録));
    try { await b.close(); } catch (e) {}
    srv.kill();
    log('終わり：' + why + '・光った ' + 記録.光った.length + ' 件 → ' + path.relative(ROOT, OUT));
    process.exit(rc);
  };
  try {
    const an = await b.newDevice('白', { width: 200, height: 200 });
    const devs = [];
    const 台 = [
      { tag: 'tv1920', w: 1920, h: 1080, tv: true, flash: true },
      { tag: '375x667_光入', w: 375, h: 667, flash: true },
      { tag: '375x667_光切', w: 375, h: 667, flash: false },
      { tag: '390x844_光入', w: 390, h: 844, flash: true },
      { tag: '390x844_光切', w: 390, h: 844, flash: false }
    ];
    const NAMES = ['あき', 'いお', 'うた', 'えま'];
    let ni = 0;
    for (const x of 台) {
      const d = await b.newDevice(x.tag, x.tv ? { width: x.w, height: x.h } : { width: x.w, height: x.h, mobile: true, deviceScaleFactor: 2 });
      Object.assign(d, x); devs.push(d);
      await d.go(BASE + '/');
      await d.ev("(localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:" + JSON.stringify(FX) + ",fxFlash:" + x.flash + "})), 1)");
      await d.go(BASE + (x.tv ? '/fes?tv=1' : '/fes'));
      d.cfg = x.tv ? { tv: true } : { name: NAMES[ni++], diff: 'normal', round: 0, target: null };
    }
    const 入れる = async (d) => d.ev('(function(){(' + AGENT.toString() + ')();(' + WATCH.toString() + ')();window.__soak.cfg=' + JSON.stringify(d.cfg) + ';return 1;})()').catch(() => 0);
    for (const d of devs) await 入れる(d);
    const 済 = new Set();
    let 票の回 = null, 撮り中 = null;
    const 締め = Date.now() + MIN * 60000;
    while (Date.now() < 締め && 済.size < GAMES.length) {
      const w = await staff.call('fes:watch', { code });
      const f = (w && w.staff && w.staff.fes) || {};
      if (f.phase === 'vote' && 票の回 !== f.round) {
        票の回 = f.round;
        const want = GAMES.find((g) => (f.candidates || []).includes(g) && !済.has(g)) || null;
        for (const d of devs) if (!d.tv) { d.cfg.round = f.round; d.cfg.target = want; await d.ev('window.__soak&&(window.__soak.cfg=' + JSON.stringify(d.cfg) + ')').catch(() => 0); }
        log('投票', (f.candidates || []).join(','), '→', want || '-');
      }
      for (const d of devs) { const ok = await d.ev('!!(window.__soak&&window.__ff)').catch(() => false); if (!ok) await 入れる(d); }
      if (f.phase === 'play' && !撮り中) {
        const mode = f.played.mode;
        log('遊ぶ', mode, '→ 撮り始め');
        for (const d of devs) await d.ev('window.__ff && (window.__ff.at = null, 1)').catch(() => 0);   // 「つづける？」が消えても時刻は残す（全員がつづけると早く待合へもどる）。遊ぶ段で消す
        撮り中 = { mode, round: f.round, 台: [] };
        for (const d of devs) {
          const コマ = [];
          const off = d.onEvent((m) => {
            if (m.method !== 'Page.screencastFrame') return;
            コマ.push({ ts: Math.round(m.params.metadata.timestamp * 1000), data: m.params.data });
            if (コマ.length > 900) コマ.splice(0, 300);
            d.raw('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
          });
          await d.raw('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 480, maxHeight: 480, everyNthFrame: 1 });
          撮り中.台.push({ d, コマ, off });
        }
      }
      if (f.phase === 'result' && 撮り中 && 撮り中.round === f.round) {
        await sleep(9600);
        const 回 = { mode: 撮り中.mode, 台: [] };
        for (const x of 撮り中.台) {
          await x.d.raw('Page.stopScreencast').catch(() => {}); x.off();
          const at = await x.d.ev('window.__ff && window.__ff.at').catch(() => null);
          const ev = await x.d.ev('window.__ff ? window.__ff.ev.splice(0) : []').catch(() => []);
          const bar = await x.d.ev('window.__ff && window.__ff.bar').catch(() => null);
          if (!at) { const st = await x.d.ev('window.__soak && [window.__soak.stage(), window.__soak.last, (document.querySelector(".screen.active")||{}).id]').catch(() => null); 回.台.push({ tag: x.d.tag, 出ない: true, いた所: st }); log(撮り中.mode, x.d.tag, '「つづける？」が出ない', JSON.stringify(st)); continue; }
          const 窓 = x.コマ.filter((k) => k.ts >= at - 1500 && k.ts <= at + 3500);
          const L = await an.ev('(' + LUMA.toString() + ')(' + JSON.stringify(窓.map((k) => k.data)) + ')');
          const 列 = 窓.map((k, i) => ({ t: k.ts - at, m: L[i] && L[i].m, hi: L[i] && L[i].hi })).filter((k) => k.m != null);
          const 中 = (a) => { const s = a.map((k) => k.m).sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
          const 前 = 中(列.filter((k) => k.t < -200)), 後 = 中(列.filter((k) => k.t > 2000));
          const 下 = Math.max(前 == null ? 0 : 前, 後 == null ? 0 : 後);
          const 山 = 列.filter((k) => k.t >= -200 && k.t <= 2000).reduce((a, k) => (!a || k.m > a.m ? k : a), null);
          const 光 = !!(山 && 前 != null && 後 != null && 山.m - 下 >= 光った差);
          const 近い = ev.filter((e) => e.t >= at - 400 && e.t <= at + 1200).map((e) => ({ t: e.t - at, k: e.k, n: e.n, el: e.el }));
          const r = { tag: x.d.tag, 光: x.d.flash, 前, 後, 山: 山 && { t: 山.t, m: 山.m, hi: 山.hi }, 光った: 光, ゲージ: bar, コマ数: 列.length, 列, 近い: 近い.slice(0, 80) };
          if (!x.d.tv) { const k = x.コマ.filter((z) => z.ts <= at + 3000).pop(); if (k) fs.writeFileSync(path.join(OUT, 撮り中.mode + '_' + x.d.tag + '_3秒後.jpg'), Buffer.from(k.data, 'base64')); }
          if (山) {
            const k = 窓[列.indexOf(山)] || 窓.find((z) => z.ts - at === 山.t);
            if (k) fs.writeFileSync(path.join(OUT, 撮り中.mode + '_' + x.d.tag + '_山' + 山.t + 'ms.jpg'), Buffer.from(k.data, 'base64'));
          }
          回.台.push(r);
          if (光) 記録.光った.push({ mode: 撮り中.mode, tag: x.d.tag, 前, 後, 山: r.山 });
          log(撮り中.mode, x.d.tag, '前', 前, '後', 後, '山', 山 ? 山.m + '@' + 山.t + 'ms' : '-', 光 ? '★光った' : '', 'ゲージ', (bar || []).map((z) => z.ms / 1000 + '秒:' + z.割合).join(' '));
        }
        記録.回.push(回);
        済.add(撮り中.mode);
        撮り中 = null;
      }
      await sleep(400);
    }
    await 終わる(済.size >= GAMES.length ? '全部撮った' : MIN + '分たった', 記録.光った.length ? 1 : 0);
  } catch (e) { 記録.失敗 = String(e && e.stack || e); console.error(e); await 終わる('失敗', 2); }
})().catch((e) => { console.error(e); process.exit(2); });

function 表(r) {
  let md = '# 「つづける？」が出る瞬間の明るさ（tools/flash-film.js・' + r.tag + '・演出 ' + r.fx + '）\n\n';
  md += '光った＝出る前と出た後の落ち着いた明るさの両方より ' + 光った差 + ' 以上明るいコマが、出る 0.2秒前〜2秒後にある。明るさは 0（黒）〜1（白）の平均。\n\n';
  md += '| ゲーム | 端末 | 前 | 後 | いちばん明るいコマ（時刻） | とても明るい画素 | 光った | ゲージの長さ（0.5・3・6・9秒） |\n|---|---|---|---|---|---|---|---|\n';
  r.回.forEach((g) => g.台.forEach((x) => {
    md += x.出ない ? `| ${g.mode} | ${x.tag} | - | - | 「つづける？」が出なかった | - | - |\n`
      : `| ${g.mode} | ${x.tag} | ${x.前} | ${x.後} | ${x.山 ? x.山.m + '（' + x.山.t + 'ms）' : '-'} | ${x.山 ? x.山.hi : '-'} | ${x.光った ? '★' : '-'} | ${(x.ゲージ || []).map((z) => z.割合).join('・') || '-'} |\n`;
  }));
  return md;
}
