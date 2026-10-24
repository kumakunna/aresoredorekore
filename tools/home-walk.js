#!/usr/bin/env node
// tools/home-walk.js — ふだんの部屋（指示66-3）を、本物のサーバーとスマホ2台・TV 1台で歩いて、門2・4・5の証拠を残す
//
//   node tools/home-walk.js                 … 演出「ふつう」
//   node tools/home-walk.js --fx skip       … 演出「なし」（決めた時のカードは最後の形だけ・1.5秒は同じ）
//   --port 3302  --cdp 9702  --out DIR（既定 docs/監査_指示66の画像/home-walk）
//
// 進行役（ログインした端末）が入口の「部屋をつくる」→ 参加者が QR のアドレスで名前から入る → TV が /tv からコードで入る。
// 進行役が「ゲームをえらぶ」一覧 → 札を押してページ → 指で横に送る → ‹ で一覧（門2：手順ごとの写真）。
// そのあいだ TV の画面の中身を何度も読み、変わらないことを見る（門4）。
// 「このゲームにする」まで進めて、3台それぞれが「決めた時のカード」を出した時刻を記録する（門5：動かした記録）。
// 写真と記録.json は OUT に置く（git に入れない）。検証の Chrome は音を消してある（tools/cdp.js）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3302), CDP = +arg('cdp', 9702), FX = arg('fx', 'normal');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '監査_指示66の画像', 'home-walk' + (FX === 'skip' ? '-skip' : ''))));
const 記録 = { いつ: new Date().toISOString(), 演出: FX, 手順: [], TV: [], 決めた時: [], 例外: [], 失敗: null };
const t0 = Date.now();
const log = (...a) => { const line = ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's ' + a.join(' '); console.log(line); 記録.手順.push(line); };

async function サーバー() {
  const base = 'http://localhost:' + PORT;
  let up = false;
  try { up = (await fetch(base + '/')).ok; } catch (e) {}
  if (up) return { child: null };
  const out = fs.openSync(path.join(require('os').tmpdir(), 'home-walk-server-' + PORT + '.log'), 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }), stdio: ['ignore', out, out] });
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません（port ' + PORT + '）');
  return { child };
}
/** 開いて、安全の案内（はじめの1回）と扉を通す */
async function 開く(d, base, url) {
  await d.go(base + '/');
  await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:" + JSON.stringify(FX) + "})); localStorage.setItem('acac-safety-seen','1'); return 1; })()");
  await d.go(base + url);
  await d.until("(document.querySelector('.screen.active')||{}).id && (document.querySelector('.screen.active')||{}).id !== 'scr-door'", 10000, '扉が開く');
  return d.screen();
}
async function 撮る(d, name) { await sleep(FX === 'skip' ? 120 : 450); return d.shot(path.join(OUT, name + '.jpg')); }
const 押す = (d, sel) => d.ev('(function(){var b=document.querySelector(' + JSON.stringify(sel) + ');if(b&&!b.disabled){b.click();return true;}return false;})()');
/** TV の画面の中身（名前の壁の流れと時計は動くので、形だけ：見出し・QR・名前の札・帯） */
const TVの形 = "(function(){var s=document.getElementById('scr-v2-room-tv'); if(!s||!s.classList.contains('active')) return 'TVの待合ではない:' + (document.querySelector('.screen.active')||{}).id;" +
  "return [s.querySelector('.v2-thd').textContent, !!s.querySelector('.v2-tqr svg'), [].map.call(s.querySelectorAll('.v2-tmem-nm'),function(e){return e.textContent;}).join('/'), s.querySelector('.v2-tband').textContent].join('|'); })()";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const { child } = await サーバー();
  const b = await launch({ port: CDP });
  const host = await b.newDevice('進行役', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  const guest = await b.newDevice('参加者', { width: 390, height: 844, mobile: true, deviceScaleFactor: 2 });
  const tv = await b.newDevice('TV', { width: 1280, height: 720, mobile: false });
  const 端末 = [host, guest, tv];
  try {
    // 進行役：ログインして、入口から「部屋をつくる」
    const hb = 'http://localhost:' + PORT, gb = 'http://127.0.0.1:' + PORT;
    await host.go(hb + '/dev-login');
    await 開く(host, hb, '/');
    await host.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-home'", 8000, '入口');
    await 撮る(host, '01-入口');
    await 押す(host, '#scr-v2-home [data-home-act="make"]');
    await host.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-room'", 8000, '部屋ができて待合');
    const code = await host.ev("document.querySelector('#scr-v2-room .v2-ecode b').textContent");
    log('部屋ができた', code);
    // 参加者：QR のアドレス（?room=）で開くと、名前から
    await 開く(guest, gb, '/?room=' + code);
    await guest.until("!!document.querySelector('#scr-v2-join [data-home-name]')", 8000, 'QR から名前の画面');
    await 撮る(guest, '02-参加者-名前');
    await guest.ev("(function(){var i=document.querySelector('#scr-v2-join [data-home-name]'); i.value='ひろ'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()");
    await 押す(guest, '#scr-v2-join [data-home-act="join-go"]');
    await guest.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-room'", 8000, '参加者が待合に入る');
    log('参加者が入った');
    // TV：/tv → コードだけで TV になる
    await 開く(tv, hb, '/tv');
    await tv.until("!!document.querySelector('#scr-v2-join [data-home-code]')", 8000, 'TV のコードの画面');
    await tv.ev("(function(){var i=document.querySelector('#scr-v2-join [data-home-code]'); i.value=" + JSON.stringify(code) + "; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()");
    await 押す(tv, '#scr-v2-join [data-home-act="code-go"]');
    await tv.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-room-tv'", 8000, 'TV の待合');
    log('TV が入った');
    await 撮る(host, '03-進行役-待合'); await 撮る(guest, '04-参加者-待合'); await 撮る(tv, '05-TV-待合');
    const TV前 = await tv.ev(TVの形);
    記録.TV.push({ いつ: 'えらぶ前', 形: TV前 });

    // 門2：一覧 → ページ → 指で送る → ‹ で一覧
    await 押す(host, '#scr-v2-room [data-home-act="room-pick"]');
    await host.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-pick'", 8000, '一覧');
    await 撮る(host, '10-一覧');
    記録.TV.push({ いつ: '一覧を開いた', 形: await tv.ev(TVの形) });
    await host.tap('#scr-v2-pick [data-home-id="sugoroku"] .v2-tile');
    await host.until("document.querySelector('#scr-v2-pick [data-home-ov]').classList.contains('is-open')", 4000, 'ページが開く');
    await 撮る(host, '11-ページ-すごろく');
    const 前のページ = await host.ev("document.querySelector('#scr-v2-pick [data-home-gname]').textContent");
    // 指で左へ送る（本物のタッチ）
    const 送る = async (from, to) => {
      const y = 420;
      await host.raw('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
      for (let k = 1; k <= 8; k++) { await host.raw('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (to - from) * k / 8, y }] }); await sleep(16); }
      await host.raw('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await 送る(320, 90);
    await sleep(450);
    const 次のページ = await host.ev("document.querySelector('#scr-v2-pick [data-home-gname]').textContent");
    log('指で送った', 前のページ, '→', 次のページ);
    await 撮る(host, '12-指で送った');
    記録.TV.push({ いつ: 'ページを送った', 形: await tv.ev(TVの形) });
    await 送る(320, 90); await sleep(450);
    記録.TV.push({ いつ: 'もう1枚送った', 形: await tv.ev(TVの形) });
    const 見ていた = await host.ev("(function(){ return window.homeProbe().cards[window.homeProbe().cur].id; })()");
    await host.tap('#scr-v2-pick [data-home-act="pick-back"]');
    await sleep(450);
    const 戻った所 = await host.ev("(function(){var p=window.homeProbe(), id=p.cards[p.cur].id, l=document.querySelector('#scr-v2-pick [data-home-list]'), c=l.querySelector('[data-home-id=\"'+id+'\"]'); var a=l.getBoundingClientRect(), r=c.getBoundingClientRect(); return { id: id, 見えている: r.top >= a.top - 1 && r.bottom <= a.bottom + 1 }; })()");
    log('‹ で一覧へ', '見ていたゲーム=' + 見ていた, '一覧で見えている=' + JSON.stringify(戻った所));
    await 撮る(host, '13-一覧にもどった');
    記録.門2 = { 前のページ, 次のページ, 見ていた, 戻った所 };

    // 門4：そのあいだ TV は同じ形
    記録.TV.push({ いつ: '一覧にもどった', 形: await tv.ev(TVの形) });
    記録.門4 = { 変わらない: 記録.TV.every((x) => x.形 === TV前), 回数: 記録.TV.length };
    await 撮る(tv, '14-TV-えらんでいる間');
    log('TV は変わらない', 記録.門4.変わらない);

    // 門5：決めた時のカードを、3台が出した時刻を記録する（各端末の中で、出た瞬間の時刻を取る）
    for (const d of 端末) {
      await d.ev("(function(){ window.__decAt=null; new MutationObserver(function(){ if(!window.__decAt && document.getElementById('v2Decided')) window.__decAt = Date.now(); }).observe(document.body,{childList:true}); return 1; })()");
    }
    await host.tap('#scr-v2-pick [data-home-id="rcard"] .v2-tile');
    await host.until("document.querySelector('#scr-v2-pick [data-home-ov]').classList.contains('is-open')", 4000, 'ページが開く');
    await 撮る(host, '15-ページ-ロシアンカード');
    const 押した = Date.now();
    await 押す(host, '#scr-v2-pick [data-home-act="pick-go"]');
    // カセットの中のゲーム・モード（S4）を通って「おまかせ」で決める
    for (let i = 0; i < 20; i++) {
      const s = await host.screen();
      if (s === 'scr-game') { await 撮る(host, '16-S4-ゲーム'); await 押す(host, '#gameNextBtn'); }
      else if (s === 'scr-mode') { await 撮る(host, '17-S4-モード'); await 押す(host, '#modeAutoBtn'); }
      else if (s === 'scr-mode-rules') await 押す(host, '#rulesStartBtn');
      else if (await host.ev("!!document.getElementById('v2Decided')")) break;
      await sleep(150);
    }
    await sleep(200);
    await Promise.all([撮る(host, '20-決めた-進行役'), 撮る(guest, '21-決めた-参加者'), 撮る(tv, '22-決めた-TV')]);
    for (const d of 端末) {
      const at = await d.until('window.__decAt', 5000, d.name + '：決めた時のカード');
      const 色 = await d.ev("(function(){var c=document.getElementById('v2Decided'); return c ? c.className : '(もう消えた)'; })()");
      記録.決めた時.push({ 端末: d.name, 出た: at, 押してから: at - 押した, 色 });
    }
    const ats = 記録.決めた時.map((x) => x.出た);
    記録.門5 = { ずれの最大ms: Math.max.apply(null, ats) - Math.min.apply(null, ats), 同じ色: 記録.決めた時.every((x) => /v2-w-rcard/.test(x.色) || x.色 === '(もう消えた)') };
    log('決めた時のカード', JSON.stringify(記録.決めた時.map((x) => x.端末 + ':' + x.押してから + 'ms')), 'ずれ', 記録.門5.ずれの最大ms + 'ms');
    await sleep(1700);
    記録.カードが消えた = await Promise.all(端末.map((d) => d.ev("!document.getElementById('v2Decided')")));
    await Promise.all([撮る(host, '23-そのあと-進行役'), 撮る(guest, '24-そのあと-参加者'), 撮る(tv, '25-そのあと-TV')]);
    // 指示68-0b B6：カードが消えたあと、スマホはルールと準備OK（scr-rt-rules）へ進む（演出「なし」でも止まらない）。TV は TV の画面
    記録.そのあとの画面 = await Promise.all(端末.map((d) => d.until("(function(){ var a=document.querySelector('.screen.active'); return !document.getElementById('v2Decided') && a ? a.id : null; })()", 6000, d.name + '：カードのあとの画面').catch(() => '（進まない）')));
    記録.B6 = { カードが消えた: 記録.カードが消えた.every(Boolean), スマホはルールへ: 記録.そのあとの画面.slice(0, 2).every((id) => id === 'scr-rt-rules') };
    log('カードのあと', JSON.stringify(記録.そのあとの画面), 'B6', JSON.stringify(記録.B6));
    for (const d of 端末) d.logs.forEach((l) => 記録.例外.push(d.name + '：' + l));
  } catch (e) {
    記録.失敗 = String(e && e.stack || e);
    console.error(e);
    for (const d of 端末) { try { await 撮る(d, '99-失敗-' + d.name); } catch (x) {} }
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 2));
    await b.close();
    if (child) child.kill();
    console.log(記録.失敗 ? '✖ 失敗（記録.json）' : '✔ 歩き終えた（記録.json・写真）：' + OUT);
    process.exit(記録.失敗 ? 1 : 0);
  }
})();
