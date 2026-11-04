#!/usr/bin/env node
// tools/home-play3.js — 文化祭の3本（みんなと同じ・ぴったり10秒・そろえて発射）を、ふだんの部屋で、テスト中ではないアカウントの
// 進行役と参加者2人（本物の Chrome・3台）で、「ゲームをえらぶ」から結果まで遊ぶ（指示71-3 の門）
//
//   node tools/home-play3.js [--port 3311] [--cdp 9711] [--only onaji,pittari,soroe]
//
// 検証用サーバー（tools/dev-server.js）は **FES_OWNER を検証ユーザー以外にして**立てる。/dev-login の検証ユーザー（kensho34）は
// ふだんは係（テスト中の札が見える）なので、そのままだと「テスト中ではないアカウント」にならない。
// ゲームごとに新しい3台で部屋を作る（前の部屋の続きの道に迷わない）。ゲームの中は tools/fes-soak.js と同じ押し方で、適当に押す。
// 写真と記録.json は docs/監査_指示71/home-play3/（git に入れない）。検証の Chrome は音を消してある（tools/cdp.js）

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = Number(arg('port', 3311)), CDP = Number(arg('cdp', 9711));
const ONLY = String(arg('only', 'onaji,pittari,soroe')).split(',');
const OUT = path.join(__dirname, '..', 'docs', '監査_指示71', 'home-play3');
fs.mkdirSync(OUT, { recursive: true });
const 記録 = { ゲーム: {} };
const log = (...a) => console.log('・' + a.join(' '));

const 押す = (d, sel) => d.ev('(function(){var b=document.querySelector(' + JSON.stringify(sel) + ');if(b&&!b.disabled){b.click();return true;}return false;})()');
const 遊ぶ = "(function(){var s=(document.querySelector('.screen.active')||{}).id, q=function(x){return [].filter.call(document.querySelectorAll(x),function(b){return !b.disabled && b.offsetParent;});}, pick=function(x){var a=q(x);return a[Math.floor(Math.random()*a.length)];};" +
  "if(s==='scr-rt-rules'){var ok=document.getElementById('rtRulesOkBtn'); if(ok&&!ok.disabled&&ok.offsetParent){ok.click();return 'ready';} return s;}" +
  "if(s==='scr-v2-onaji'){var a=pick('#scr-v2-onaji [data-onaji-pick]'); if(a&&Math.random()<0.6){a.click();return 'onaji';} return s;}" +
  "if(s==='scr-v2-pittari'){var b=pick('#scr-v2-pittari [data-pt-stop]'); if(b&&Math.random()<0.3){b.click();return 'stop';} return s;}" +
  "if(s==='scr-v2-soroe'){var f=pick('#scr-v2-soroe [data-so-fire]'); if(f&&Math.random()<0.35){f.click();return 'fire';} return s;}" +
  "return s;})()";

async function サーバー() {
  const out = fs.openSync(path.join(OUT, 'server.log'), 'w');
  // テスト中ではない：係は検証ユーザーとちがう名前にする（だれもその名前でログインしない）
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), FES_OWNER: 'not-a-real-owner-71', FES_STAFF: '' }), stdio: ['ignore', out, out] });
  const base = 'http://localhost:' + PORT;
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません');
  return child;
}
async function 開く(d, base, url) {
  await d.go(base + '/');
  await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:'skip'})); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
  await d.go(base + url);
  await d.until("(document.querySelector('.screen.active')||{}).id && (document.querySelector('.screen.active')||{}).id !== 'scr-door'", 10000, '扉が開く');
}

async function 一本(b, id) {
  const r = { 進み: [] };
  const hb = 'http://localhost:' + PORT, gb = 'http://127.0.0.1:' + PORT;
  const host = await b.newDevice('進行役-' + id, { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  const g1 = await b.newDevice('参加者1-' + id, { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  const g2 = await b.newDevice('参加者2-' + id, { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
  const 端末 = [host, g1, g2];
  try {
    await host.go(hb + '/dev-login');
    await 開く(host, hb, '/');
    await host.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-home'", 8000, '入口');
    r.テスト中ではない = await host.ev("(function(){ var p = window.homeProbe(); return !p.testing || p.testing.length === 0; })()").catch(() => null);
    await 押す(host, '#scr-v2-home [data-home-act="make"]');
    await host.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-room'", 8000, '部屋ができて待合');
    const code = await host.ev("document.querySelector('#scr-v2-room .v2-ecode b').textContent");
    let k = 0;
    for (const g of [g1, g2]) {
      await 開く(g, gb, '/?room=' + code);
      await g.until("!!document.querySelector('#scr-v2-join [data-home-name]')", 8000, 'QR から名前の画面');
      await g.ev("(function(){var i=document.querySelector('#scr-v2-join [data-home-name]'); i.value=" + JSON.stringify(['ひろ', 'みさ'][k++]) + "; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()");
      await 押す(g, '#scr-v2-join [data-home-act="join-go"]');
      await g.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-room'", 8000, '参加者が待合に入る');
    }
    // ゲームをえらぶ → その札 → このゲームにする
    await 押す(host, '#scr-v2-room [data-home-act="room-pick"]');
    await host.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-pick'", 8000, '一覧');
    r.一覧にある = await host.ev("!!document.querySelector('#scr-v2-pick [data-home-id=\"" + id + "\"]')");
    r.テスト中の印 = await host.ev("!!document.querySelector('#scr-v2-pick [data-home-id=\"" + id + "\"] [data-home-testing]')");
    await host.shot(path.join(OUT, id + '-01-一覧.png'));
    await host.tap('#scr-v2-pick [data-home-id="' + id + '"] .v2-tile');
    await host.until("document.querySelector('#scr-v2-pick [data-home-ov]').classList.contains('is-open')", 4000, 'ページが開く');
    await host.shot(path.join(OUT, id + '-02-ページ.png'));
    await 押す(host, '#scr-v2-pick [data-home-act="pick-go"]');
    for (let i = 0; i < 30; i++) {
      const s = await host.screen();
      if (s === 'scr-game') await 押す(host, '#gameNextBtn');
      else if (s === 'scr-mode') await 押す(host, '#modeAutoBtn');
      else if (s === 'scr-mode-rules') await 押す(host, '#rulesStartBtn');
      else if (s === 'scr-rt-rules' || /^scr-v2-(onaji|pittari|soroe)$/.test(s)) break;
      await sleep(200);
    }
    // 遊ぶ：3台とも、結果（進行役に「つぎは？」）が出るまで
    const t0 = Date.now();
    let 結果 = false, 見た = new Set();
    while (Date.now() - t0 < 300000) {
      for (const d of 端末) { const x = await d.ev(遊ぶ).catch(() => 'err'); 見た.add(d.name.split('-')[0] + ':' + x); }
      if (await host.ev("!!document.querySelector('.screen.active [data-v2game-act=\"again\"]')")) { 結果 = true; break; }
      await sleep(250);
    }
    r.結果まで = 結果;
    r.秒 = Math.round((Date.now() - t0) / 1000);
    r.通った画面 = [...見た].filter((x) => !/err/.test(x)).sort();
    r.参加者も結果 = await Promise.all([g1, g2].map((g) => g.ev("(function(){var a=document.querySelector('.screen.active'); return a ? a.id + (a.querySelector('.v2-oph') ? ':結果' : '') : null; })()")));
    for (const [n, d] of [['進行役', host], ['参加者1', g1], ['参加者2', g2]]) await d.shot(path.join(OUT, id + '-09-結果-' + n + '.png'));
    r.例外 = [].concat(...端末.map((d) => d.logs.map((l) => d.name + '：' + l)));
  } catch (e) {
    r.失敗 = String(e && e.message || e);
    for (const d of 端末) { try { await d.shot(path.join(OUT, id + '-99-失敗-' + d.name + '.png')); } catch (x) {} }
  } finally {
    for (const d of 端末) { try { await d.close(); } catch (e) {} }
  }
  return r;
}

(async () => {
  const child = await サーバー();
  const b = await launch({ port: CDP });
  let ok = true;
  try {
    for (const id of ONLY) {
      const r = await 一本(b, id);
      記録.ゲーム[id] = r;
      const good = !r.失敗 && r.一覧にある && !r.テスト中の印 && r.テスト中ではない && r.結果まで && !(r.例外 || []).length;
      if (!good) ok = false;
      log(id, good ? 'OK' : 'NG', JSON.stringify({ テスト中ではない: r.テスト中ではない, 一覧にある: r.一覧にある, テスト中の印: r.テスト中の印, 結果まで: r.結果まで, 秒: r.秒, 参加者: r.参加者も結果, 例外: (r.例外 || []).length, 失敗: r.失敗 }));
    }
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 2));
    await b.close(); child.kill();
    console.log(ok ? '通しおわり（3本とも結果まで）' : '通しに NG あり（記録.json）');
    process.exit(ok ? 0 : 1);
  }
})();
