#!/usr/bin/env node
// tools/fes-away-walk.js — 別のアプリに切りかえて、もどってきた人を、本物の Chrome と本物の時間（25秒・2分）で通す（指示74 4）
//
//   node tools/fes-away-walk.js            … 検証用サーバー（tools/dev-server.js）を自分で立てる（立っていればそれを使う）
//   --port 3311  --cdp 9711  --out DIR（既定 docs/指示74/写真/walk）
//
// 11/6 に本番で起こした手順と同じ：スマホのタブで WebSocket.prototype.send（と XHR）をかぶせて、"hb:pong" を含む送信だけを捨てる（ほかは通す）。
// ヘッドレスの Chrome は JS が止まらないので、もどった時は visibilitychange と pageshow を起こす（本物のスマホがもどった時に起きるもの）。
//
//   1 投票の最中に 40秒 pong を捨てる → 係の画面で「つながっていない」になる → もどす → 係の画面で もどる（何秒か）
//     → そのゲームは「TV を見ていてね」（つながっていない人は次のゲームで外れる・変えない決まり）→ 結果の「つづける」を押せる
//     → 次の投票で押せて、投票ずみの印（本人だけの知らせ）が付く
//   2 準備OK の送信を1回なくす（届かなかった）→ 「つなぎ直しています」の一言 → もう一度押せる
//   3 ほかの2人が帰り、2分より長く pong を捨てる → 名簿から外される → もどると入る画面に「しばらく はなれていたので」
//     → 名前とむずかしさは入ったまま、「入る」1回で入れる
// 係は部屋を作り、そろえて発射を「入」にするだけ（終わったら元にもどす・入／切は SQLite に残る）。写真と記録.json は OUT に（git に入れない）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3311), CDP = +arg('cdp', 9711);
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', '指示74', '写真', 'walk')));
const 記録 = { いつ: new Date().toISOString(), 段: [], 失敗: null, 例外: [] };
const t0 = Date.now();
const log = (...a) => { const line = ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's ' + a.join(' '); console.log(line); 記録.段.push(line); };

async function サーバー() {
  const base = 'http://localhost:' + PORT;
  let up = false;
  try { up = (await fetch(base + '/')).ok; } catch (e) {}
  if (up) return { base, child: null };
  const out = fs.openSync(path.join(require('os').tmpdir(), 'fes-away-server-' + PORT + '.log'), 'w');
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }), stdio: ['ignore', out, out] });
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch(base + '/')).ok; } catch (e) {} }
  if (!up) throw new Error('検証用サーバーが立ちません（port ' + PORT + '）');
  return { base, child };
}
async function 開く(d, base, url) {
  await d.go(base + '/');
  await d.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:'skip'})); return 1; })()");
  await d.go(base + url);
  for (let i = 0; i < 40; i++) {
    const st = await d.ev("({gate:(function(){var g=document.getElementById('safetyGate');return !!g&&getComputedStyle(g).display!=='none';})(),scr:(document.querySelector('.screen.active')||{}).id})");
    if (st.gate) { await d.ev("document.getElementById('sgStartBtn').click()"); await sleep(300); continue; }
    if (st.scr && st.scr !== 'scr-door') return st.scr;
    await d.ev("(function(){var p=document.getElementById('doorPanel');if(p)p.click();})()"); await sleep(300);
  }
  return d.screen();
}
const 押す = (d, sel) => d.ev('(function(){var b=document.querySelector(' + JSON.stringify(sel) + ');if(b&&!b.disabled){b.click();return true;}return false;})()');
const 撮る = async (d, name) => { try { await d.shot(path.join(OUT, name + '.jpg')); log('写真', name); } catch (e) {} };
/** 送る物を捨てる仕掛け（本番で使った手順と同じ。WebSocket と XHR の両方） */
const 仕掛け = "(function(){ if (window.__drop) return 1; window.__drop = { pong: false, ready: 0 };" +
  " function bad(d){ if (typeof d !== 'string') return false; if (window.__drop.pong && d.indexOf('\"hb:pong\"') !== -1) return true;" +
  "   if (window.__drop.ready > 0 && d.indexOf('\"room:ready\"') !== -1) { window.__drop.ready--; return true; } return false; }" +
  " var ws = WebSocket.prototype.send; WebSocket.prototype.send = function(d){ if (bad(d)) return; return ws.apply(this, arguments); };" +
  " var xs = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function(d){ if (bad(d)) d = ''; return xs.apply(this, arguments); };" +
  " return 1; })()";
const もどる = "(function(){ window.__drop.pong = false; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); return 1; })()";
/** 係の画面の名簿で、その人が「つながっていない」（is-off）か。名簿にいなければ null */
const 係から見て = (name) => "(function(){ var r=[].slice.call(document.querySelectorAll('.v2-adm-r')).find(function(x){ return (x.querySelector('.v2-adm-nm')||{}).textContent===" + JSON.stringify(name) + "; }); return r ? (r.classList.contains('is-off') ? 'off' : 'on') : null; })()";
const 一言 = "(function(){ var t=document.getElementById('foulToast'); return t && t.classList.contains('show') ? t.textContent : ''; })()";
const 段階 = "(function(){var q=function(x){return !!document.querySelector('#scr-v2-fes-lobby '+x);};return q('.v2-vlist')?'vote':q('.v2-dec')?'decide':q('[data-fes-act=ready],[data-fes-unready]')?'ready':q('.v2-contsheet')?'result':q('.v2-facesbtn')?'lobby':'?';})()";
// 遊ぶ人がするように押す（そろえて発射は発射・みんなと同じは1つえらぶ・ぴったり10秒は止める）。押さないと、みんなと同じは答えを待ち続ける
const 遊ぶ = "(function(){var s=(document.querySelector('.screen.active')||{}).id;" +
  "function pick(sel){var a=[].slice.call(document.querySelectorAll(sel)).filter(function(b){return !b.disabled&&b.offsetParent!==null;});return a.length?a[0]:null;}" +
  "if(s==='scr-v2-soroe'){var f=pick('#scr-v2-soroe [data-so-fire]');if(f){f.click();return 'fire';}}" +
  "if(s==='scr-v2-onaji'){var o=pick('#scr-v2-onaji [data-onaji-pick]:not([aria-disabled=true])');if(o){o.click();return 'pick';}}" +
  "if(s==='scr-v2-pittari'){var p=pick('#scr-v2-pittari [data-pt-stop]');if(p){p.click();return 'stop';}}" +
  "return s;})()";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const { base, child } = await サーバー();
  const b = await launch({ port: CDP });
  const devs = [];
  let staff = null, soroeWasOff = false;
  try {
    staff = await b.newDevice('係', { width: 390, height: 844, mobile: true }); devs.push(staff);
    await staff.go(base + '/dev-login');
    await 開く(staff, base, '/fes?staff=1');
    await sleep(800);
    if (!(await 押す(staff, '[data-fes-act=create]'))) { await 押す(staff, '[data-v2-open="#v2Recreate"]'); await sleep(400); await 押す(staff, '[data-v2-act=recreate]'); }
    await sleep(1500);
    soroeWasOff = await staff.ev('!document.querySelector(\'[data-fes-game="soroe"]\').getAttribute("data-on")');
    if (soroeWasOff) { await 押す(staff, '[data-fes-game="soroe"]'); await sleep(600); }
    log('係が部屋を作った（クイズ解除とそろえて発射が候補）');
    const names = ['ふう', 'ひろ', 'びび'];
    const ph = [];
    for (let i = 0; i < 3; i++) {
      const d = await b.newDevice('スマホ' + (i + 1), { width: 390, height: 844, mobile: true }); devs.push(d);
      await 開く(d, base, '/fes');
      await d.ev("(function(){var n=document.querySelector('[data-fes-name]');n.value=" + JSON.stringify(names[i]) + ";n.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()");
      await 押す(d, '[data-fes-diff=normal]'); await sleep(150);
      await 押す(d, '[data-fes-act=join]');
      await d.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-fes-lobby'", 10000, '入れた');
      ph.push(d);
    }
    const [A, B, C] = ph;
    await A.ev(仕掛け);
    log('3人入った。ふう（スマホ1）に、送る物を捨てる仕掛け');

    // ---- 1：投票の最中に 40秒 ----
    await A.until("!!document.querySelector('#scr-v2-fes-lobby .v2-vlist')", 90000, '投票');
    await A.ev('(function(){ window.__drop.pong = true; return 1; })()');
    const away = Date.now();
    log('1：投票になった。ふうが別のアプリへ（pong を捨てる）');
    for (const d of [B, C]) { await 押す(d, '[data-fes-pick="soroe"]'); await sleep(120); await 押す(d, '[data-fes-act=vote]'); }
    let 外れた = null;
    while (Date.now() - away < 40000) {
      const s = await staff.ev(係から見て('ふう'));
      if (s === 'off' && 外れた == null) { 外れた = Date.now() - away; log('1：係の画面で ふう が「つながっていない」になった（' + (外れた / 1000).toFixed(1) + '秒）'); }
      await sleep(1000);
    }
    記録.外れるまで秒 = 外れた == null ? null : +(外れた / 1000).toFixed(1);
    await 撮る(staff, '1a_係_ふうが外れた');
    await A.ev(もどる);
    const back = Date.now();
    log('1：40秒でもどった（visibilitychange・pageshow）');
    await staff.until(係から見て('ふう') + "==='on'", 15000, '係の画面で ふう がもどる');
    記録.もどるまで秒 = +((Date.now() - back) / 1000).toFixed(1);
    log('1：係の画面で ふう がもどった（' + 記録.もどるまで秒 + '秒）');
    await sleep(1500); await 撮る(A, '1b_ふう_もどった直後');
    // ゲーム（そろえて発射）は2人で遊ぶ。ふうは「TV を見ていてね」
    const until = Date.now() + 5 * 60 * 1000;
    while (Date.now() < until) {
      if (await A.ev("!!document.querySelector('#scr-v2-fes-lobby .v2-contsheet')")) break;
      const r1 = [];
      // 準備OK はみんな押す（もどってきた ふう も。押せること自体が、本人だけの知らせが届いている証拠になる）
      for (const d of [A, B, C]) { if (await 押す(d, '[data-fes-act=ready]') && d === A) 記録.もどって準備OKを押せた = true; }
      for (const d of [B, C]) r1.push(await d.ev(遊ぶ).catch(() => null));
      if (Date.now() - (記録.__last || 0) > 15000) { 記録.__last = Date.now(); log('1：遊ぶ間 ふう ' + (await A.screen()) + '・ひろ/びび ' + r1.join('/') + '・段 ' + (await A.ev(段階))); }
      await sleep(800);
    }
    await A.until("!!document.querySelector('#scr-v2-fes-lobby .v2-contsheet')", 30000, '結果');
    await sleep(800); await 撮る(A, '1c_ふう_結果');
    記録.つづけるを押せた = await 押す(A, '[data-fes-act=continue]');
    await 押す(B, '[data-fes-act=continue]'); await 押す(C, '[data-fes-act=continue]');
    await A.until("!!document.querySelector('#scr-v2-fes-lobby .v2-vlist')", 90000, '次の投票');
    await 押す(A, '[data-fes-pick="soroe"]'); await sleep(150); await 押す(A, '[data-fes-act=vote]');
    await A.until("!!document.querySelector('#scr-v2-fes-lobby .v2-vcard.is-voted')", 5000, '投票ずみの印（本人だけの知らせ）');
    記録.次の投票で押せた = true;
    log('1：次の投票で押せた・投票ずみの印が付いた');
    await sleep(400); await 撮る(A, '1d_ふう_次の投票で押せた');
    for (const d of [B, C]) { await 押す(d, '[data-fes-pick="soroe"]'); await sleep(120); await 押す(d, '[data-fes-act=vote]'); }

    // ---- 2：準備OK の送信が1回届かなかった ----
    await A.until("!!document.querySelector('[data-fes-act=ready]')", 40000, '準備OK');
    await A.ev('(function(){ window.__drop.ready = 1; return 1; })()');
    await 押す(A, '[data-fes-act=ready]');
    await A.until(一言 + "!==''", 12000, '一言が出る');
    記録.失敗の一言 = await A.ev(一言);
    log('2：準備OK が届かなかった → 一言「' + 記録.失敗の一言 + '」');
    await 撮る(A, '2a_ふう_つなぎ直しています');
    await sleep(300);
    for (const d of [A, B, C]) await 押す(d, '[data-fes-act=ready]');
    await A.until("!document.querySelector('[data-fes-act=ready]')", 8000, 'もう一度押せた');
    記録.準備OKをもう一度押せた = true;
    log('2：もう一度押せた');
    const until2 = Date.now() + 5 * 60 * 1000;
    while (Date.now() < until2) {
      if (await A.ev("!!document.querySelector('#scr-v2-fes-lobby .v2-contsheet')")) break;
      for (const d of [A, B, C]) await d.ev(遊ぶ).catch(() => null);
      await sleep(800);
    }
    await A.until("!!document.querySelector('#scr-v2-fes-lobby .v2-contsheet')", 30000, '結果');
    for (const d of [A, B, C]) await 押す(d, '[data-fes-act=continue]');
    await A.until("!!document.querySelector('#scr-v2-fes-lobby .v2-facesbtn')", 40000, '待合へ');

    // ---- 3：ほかの2人が帰り、2分より長く ----
    B.close(); C.close();
    await A.ev('(function(){ window.__drop.pong = true; return 1; })()');
    const away3 = Date.now();
    log('3：ほかの2人が帰った。ふうが別のアプリへ（2分より長く）');
    await staff.until(係から見て('ふう') + '===null', 200000, '名簿から外される');
    記録.外されるまで秒 = +((Date.now() - away3) / 1000).toFixed(1);
    log('3：名簿から外された（' + 記録.外されるまで秒 + '秒）');
    await sleep(5000);
    await A.ev(もどる);
    await A.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-fes-join' && !!document.querySelector('[data-fes-name]')", 10000, '入る画面');
    await sleep(600);
    記録.入る画面 = await A.ev("({ 札:(document.querySelector('#scr-v2-fes-join .v2-note')||{}).textContent||'', 名前:document.querySelector('[data-fes-name]').value, むずかしさ:(document.querySelector('#scr-v2-fes-join .v2-diff.is-on')||{}).getAttribute ? document.querySelector('#scr-v2-fes-join .v2-diff.is-on').getAttribute('data-fes-diff') : null })");
    log('3：入る画面 ' + JSON.stringify(記録.入る画面));
    await 撮る(A, '3a_ふう_入る画面');
    await 押す(A, '[data-fes-act=join]');
    await A.until("(document.querySelector('.screen.active')||{}).id==='scr-v2-fes-lobby'", 10000, '「入る」1回で待合へ');
    記録.入る1回で入れた = true;
    log('3：「入る」1回で入れた');
    await sleep(800); await 撮る(A, '3b_ふう_入れた');
  } catch (e) {
    記録.失敗 = String(e && e.stack || e);
    for (const d of devs) { try { await 撮る(d, '失敗_' + d.name); log('失敗の時 ' + d.name + ' ' + (await d.screen())); } catch (x) {} }
    console.error('失敗：' + 記録.失敗);
  } finally {
    try { if (staff && soroeWasOff) { await 押す(staff, '[data-fes-game="soroe"]'); await sleep(600); log('係：そろえて発射を元の「切」にもどした'); } } catch (e) {}
    devs.forEach((d) => { if (d.logs && d.logs.length) 記録.例外.push({ 端末: d.name, 中身: d.logs.slice(0, 10) }); });
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(記録, null, 1));
    await b.close();
    if (child) { try { child.kill(); } catch (e) {} }
  }
  const ok = !記録.失敗 && 記録.次の投票で押せた && 記録.準備OKをもう一度押せた && 記録.入る1回で入れた;
  console.log((ok ? '✔ ' : '✖ ') + '通した（' + ((Date.now() - t0) / 1000).toFixed(0) + '秒）・画面の例外 ' + 記録.例外.length + '台。記録：' + path.relative(ROOT, OUT));
  process.exitCode = ok ? 0 : 1;
})();
