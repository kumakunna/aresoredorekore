#!/usr/bin/env node
// tools/fx-boom-film.js — 爆弾解除の「爆発」を、3面で 0.1秒ごとのコマに撮る（指示62-3 3章・門E4）
//
//   node tools/fx-boom-film.js --set 1 --port 3801 --cdp 9901
//
// 3面：部屋の手元（参加者 375×667）・大画面（1280×720）・手渡し（375×667・ログインして1台で遊ぶ）
// どれもクイズ解除の協力版・ライフ1。**わざと外して**爆発させる（人の手で押すのと同じ click）。
// 撮り方は Chrome の画面配信（Page.startScreencast）。描き変わった瞬間ごとに1コマ届くので、
// 「0.1秒ごと」の各時刻には、その時刻までに届いた最後のコマを当てる（変わっていない間は同じ絵）。
// 0 秒は**その面で💥（FxKit.burst）が呼ばれた瞬間**。呼ばれない設定（スキップなど）では、
// 外した答えを押した瞬間を 0 にする（時間表に書く）。
// 時間表は tools/fx-recorder.js の記録から作る：どの部品がいつ呼ばれ、どの要素がいつ置かれ／外され、
// どのアニメがいつ始まったか・宣言の長さ。音（鳴った関数）と振動（型）も並べる。
//
// 出力：docs/監査_演出の画像/boom/<set>/
//   frames/<面>/<±t>.jpg ・ 時間表.json ・ 並べた.jpg（3面のコマを横に並べた1枚）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const rec = require('./fx-recorder');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const SET = String(arg('set', '1'));
const 設定 = rec.SETTINGS[SET];
const PORT = String(arg('port', '3801'));
const CDP = parseInt(arg('cdp', '9901'), 10);
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_演出の画像', 'boom', SET);
const 前 = 3000, 後 = 3500;

// 問題文で問題バンクを引き、**間違いの**選択肢を返す（tools/flow-walk/bakudan.js の QB の逆）
const 外す = (choicesSel, descSel) => "(function(){var q=(document.querySelector(" + JSON.stringify(descSel) + ")||{}).textContent;" +
  "var cs=Array.from(document.querySelectorAll(" + JSON.stringify(choicesSel) + "));" +
  "var all=[];Object.keys(QuizBank.QUESTIONS).forEach(function(k){all=all.concat(QuizBank.QUESTIONS[k]);});" +
  "var h=all.find(function(x){return x.q===q;}); var 正=h?h.choices[h.correct]:null;" +
  "var b=cs.find(function(x){return x.textContent!==正;}); if(!b) return null; b.click(); return {押した:b.textContent, 正解:正};})()";

/** 画面配信を始める。stop() でコマ（{ts:ms, data}）を返す */
async function 撮り始める(dev) {
  const コマ = [];
  const off = dev.onEvent((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    コマ.push({ ts: Math.round(m.params.metadata.timestamp * 1000), data: m.params.data });
    dev.raw('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  });
  await dev.raw('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  return { async stop() { await dev.raw('Page.stopScreencast').catch(() => {}); off(); return コマ; } };
}

/** 記録係から溜まった分を取り出し続ける（端末ごと） */
function 記録を集める(devs) {
  const 箱 = {}; let 止 = false;
  Object.keys(devs).forEach((k) => { 箱[k] = []; });
  const loop = (async () => {
    while (!止) {
      for (const k of Object.keys(devs)) (await rec.take(devs[k])).forEach((e) => 箱[k].push(e));
      await sleep(250);
    }
  })();
  return { 箱, async stop() { 止 = true; await loop; for (const k of Object.keys(devs)) (await rec.take(devs[k])).forEach((e) => 箱[k].push(e)); } };
}

/** 0 秒（💥が呼ばれた瞬間）を決める。無ければ押した瞬間 */
function 零を決める(evs, 押した時刻) {
  const b = evs.find((e) => e.k === 'fx' && e.fn === 'burst' && e.t >= 押した時刻 - 200);
  if (b) return { t: b.t, 何で: '💥（FxKit.burst）が呼ばれた瞬間' };
  const x = evs.find((e) => e.t >= 押した時刻 && (e.k === 'fx' || e.k === 'node'));
  return { t: 押した時刻, 何で: '外した答えを押した瞬間（💥 が呼ばれなかった' + (x ? '。最初の反応は +' + ((x.t - 押した時刻) / 1000).toFixed(2) + '秒 ' + (x.fn || x.el) : '') + '）' };
}

/** 時間表：0 秒の前後で起きたことを並べる */
function 時間表(evs, 零) {
  const 名 = (e) => {
    if (e.k === 'fx') return 'FxKit.' + e.fn + (e.arg && e.arg.length ? '(' + e.arg.map((a) => String(a).slice(0, 40)).join(', ') + ')' : '');
    if (e.k === 'node') return (e.ev === 'add' ? '置かれた ' : '外れた ') + e.el;
    if (e.k === 'anim') return 'アニメ' + (e.ev === 'start' ? '開始 ' : e.ev === 'end' ? '終了 ' : '取消 ') + e.name + ' ' + e.el + (e.ev === 'start' ? '（宣言 ' + e.dur + (e.it && e.it !== '1' ? '×' + e.it : '') + '）' : '');
    if (e.k === 'cls') return 'class ' + e.el + ' +' + (e.add || []).join('+') + (e.del && e.del.length ? ' −' + e.del.join('−') : '');
    if (e.k === 'vib') return '振動 ' + JSON.stringify(e.p);
    if (e.k === 'snd') return '音 ' + ((e.from || []).filter((f) => !/^AudioScheduledSourceNode|^\?@|<anonymous>/.test(f))[0] || '?');
    if (e.k === 'tr') return '遷移' + (e.ev === 'start' ? '開始 ' : '終了 ') + e.prop + ' ' + e.el + (e.ev === 'start' ? '（' + e.dur + '）' : '');
    return e.k;
  };
  return evs.filter((e) => e.t >= 零 - 前 && e.t <= 零 + 後 && e.k !== 'tr')
    .map((e) => ({ 秒: Math.round((e.t - 零) / 100) / 10, 何: 名(e), 画面: e.scr }));
}

/** 0.1秒ごとの各時刻に、その時刻までに届いた最後のコマを当てて書き出す */
function コマを切る(コマ, 零, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (let ms = -前; ms <= 後; ms += 100) {
    const t = 零 + ms;
    let c = null;
    for (const f of コマ) { if (f.ts <= t) c = f; else break; }
    if (!c && コマ.length) c = コマ[0];
    const 名 = (ms < 0 ? 'm' : 'p') + String(Math.abs(ms)).padStart(4, '0') + '.jpg';
    if (c) fs.writeFileSync(path.join(dir, 名), Buffer.from(c.data, 'base64'));
    out.push({ ms, file: c ? 名 : null, 遅れ: c ? t - c.ts : null });
  }
  return out;
}

async function 手元と大画面(W, 全) {
  const { host, part, big } = W;
  await W.進行役が部屋をつくる('bakudan', '爆弾解除');
  await W.参加者がQRで入る('ひろ');
  await W.大画面が入る();
  await W.click(host, '#rtPickGameBtn');
  await W.画面は(host, 'scr-shelf');
  let ライフ済み = false;
  await W.設定を進める({ cassetteId: 'bakudan', 名: '爆弾解除', handlers: {
    'scr-set-bomblife': async (h) => {
      if (!ライフ済み) { await h.ev("(function(){var b=document.getElementById('bombLifeMinus'); for(var i=0;i<4;i++) b.click(); return document.getElementById('bombLifeValue').textContent;})()"); ライフ済み = true; }
      return false;
    } } });
  await W.準備OKまで(part, { チュートリアル: 'いらない' });
  await W.準備OKまで(host, { チュートリアル: 'いらない' });
  await part.until("document.querySelectorAll('#rtBombBoard .bomb-wire-btn').length>0 && !document.querySelector('.fx-countdown')", 20000, '盤');
  await sleep(1500);
  const ライフ = await part.ev("(document.getElementById('rtBombLives')||{}).textContent||''");
  const 撮 = { 手元: await 撮り始める(part), 大画面: await 撮り始める(big) };
  await sleep(800);
  await part.ev("(function(){var b=Array.from(document.querySelectorAll('#rtBombBoard .bomb-wire-btn')).find(function(x){return !x.classList.contains('solved')&&!x.classList.contains('taken')&&!x.disabled;}); b.click(); return true;})()");
  await part.until("document.getElementById('rtBombOverlay').classList.contains('show') && document.querySelectorAll('#rtBombChoices .pk-btn').length===3", 5000, '3択');
  await sleep(2200);   // 人が問題を読む間（ここも「前3秒」に入る）
  const 押した時刻 = Date.now();
  const 押した = await part.ev(外す('#rtBombChoices .pk-btn', '#rtBombDescription'));
  await sleep(後 + 1500);
  const コマ = { 手元: await 撮.手元.stop(), 大画面: await 撮.大画面.stop() };
  return { 押した時刻, 押した, ライフ, コマ };
}

async function 手渡し(b, W) {
  const d = await b.newDevice('手渡し', { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
  await rec.attach(d, 設定.prefs);
  await d.go(BASE + '/dev-login');
  await d.go(BASE + '/');
  await W.扉を越える(d, false);
  await d.until("(document.querySelector('.screen.active')||{}).id==='scr-entry'", 10000, '入口');
  await d.click('[data-entry="choose"]');
  await d.until("(document.querySelector('.screen.active')||{}).id==='scr-shelf'", 8000, '棚');
  await sleep(600);
  await d.click('.cart[data-cart="bakudan"]'); await sleep(700);
  if ((await d.screen()) === 'scr-shelf') { await d.click('.cart[data-cart="bakudan"]'); }
  await d.until("(document.querySelector('.screen.active')||{}).id!=='scr-shelf'", 8000, 'カセット');
  for (let i = 0; i < 30; i++) {
    const scr = await d.screen();
    if (scr === 'scr-bomb-play') break;
    // 「はじめてですね」は断る（見たいのは爆発）
    const 問い = await d.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button')).find(function(x){return /^いらない$/.test(x.textContent.trim())&&x.getBoundingClientRect().width>0;}); if(b){b.click();return true;} return false;})()");
    if (問い) { await sleep(500); continue; }
    if (scr === 'scr-countdown' || scr === 'scr-bomb-prep') { await sleep(600); continue; }   // 3-2-1・説明文の用意を待つ
    if (scr === 'scr-play-way') { await d.click('#wayChoices [data-way="handoff"]'); }
    else if (scr === 'scr-game') { await d.ev("(function(){document.querySelector('#gameCards .mode-card[data-game=\"bomb\"]').click(); document.getElementById('gameNextBtn').click(); return true;})()"); }
    else if (scr === 'scr-setup') {
      await d.ev("(function(){var ins=document.querySelectorAll('#scr-setup input.draft-name'); ['あき','びび'].forEach(function(n,i){ if(ins[i]){ ins[i].value=n; ins[i].dispatchEvent(new Event('input',{bubbles:true})); } }); document.getElementById('setupNextBtn').click(); return true;})()");
    }
    else if (scr === 'scr-mode') { await d.ev("(function(){document.querySelector('.mode-card[data-id=\"bomb-coop\"]').click(); document.getElementById('modeNextBtn').click(); return true;})()"); }
    else if (scr === 'scr-set-bomblife') { await d.ev("(function(){var b=document.querySelector('#scr-set-bomblife #bombLifeMinus'); for(var i=0;i<4;i++) b.click(); document.querySelector('#scr-set-bomblife [data-wiz-next]').click(); return true;})()"); }
    else if (scr === 'scr-mode-rules') { await d.click('#rulesStartBtn'); }
    else if (scr === 'scr-ready') {
      const c = await d.ev("(function(){var e=document.getElementById('holdBtn'); var r=e.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
      await d.raw('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await sleep(1600);
      await d.raw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    }
    else {
      const ok = await d.ev("(function(){var n=Array.from(document.querySelectorAll('.screen.active [data-wiz-next]')).find(function(b){return b.getBoundingClientRect().width>0&&!b.disabled;}); if(n){n.click();return true;} return false;})()");
      if (!ok) throw new Error('手渡し：知らない画面 ' + scr);
    }
    await sleep(900);
  }
  await d.until("(document.querySelector('.screen.active')||{}).id==='scr-bomb-play' && document.querySelectorAll('#bombWireList .bomb-wire-btn').length>0 && !document.querySelector('.fx-countdown')", 20000, '手渡しの盤');
  await sleep(1500);
  const ライフ = await d.ev("(document.getElementById('bombLives')||{}).textContent||''");
  const 撮 = await 撮り始める(d);
  await sleep(800);
  await d.ev("(function(){document.querySelector('#bombWireList .bomb-wire-btn:not(.solved)').click(); return true;})()");
  await d.until("document.querySelectorAll('#bombWireChoices .pk-btn').length===3", 5000, '手渡しの3択');
  await sleep(2200);
  const 押した時刻 = Date.now();
  const 押した = await d.ev(外す('#bombWireChoices .pk-btn', '#bombWireDescription'));
  await sleep(後 + 1500);
  return { dev: d, 押した時刻, 押した, ライフ, コマ: await 撮.stop() };
}

/** 3面のコマを横に並べた1枚（Chrome で HTML を描いて撮る） */
async function 並べる(b, 面, 時間表たち) {
  const ticks = [];
  for (let ms = -前; ms <= 後; ms += 100) ticks.push(ms);
  const col = { 手元: 120, 大画面: 256, 手渡し: 120 };
  const 名 = (ms) => (ms < 0 ? 'm' : 'p') + String(Math.abs(ms)).padStart(4, '0') + '.jpg';
  const 印 = (面名, ms) => (時間表たち[面名] || []).filter((x) => Math.round(x.秒 * 10) === ms / 100 && /FxKit\.(burst|blackout|shutter|shake|flash|edge)|置かれた div\.fx|振動|音 /.test(x.何)).map((x) => x.何.replace(/^置かれた /, '＋').slice(0, 34));
  let html = '<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#f4f1ea;font:12px/1.3 "Yu Gothic UI","Meiryo",sans-serif;width:max-content}' +
    'h1{font-size:20px;margin:0 0 6px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:2px 4px;vertical-align:top}th{background:#333;color:#fff}' +
    'td.t{font-weight:700;text-align:right;width:52px}tr.z td{background:#ffe0e0}img{display:block}.e{font-size:10px;color:#a00;max-width:180px}</style>' +
    '<h1>爆発（' + 設定.名 + '）0.1秒ごと：0秒＝💥が呼ばれた瞬間（各面）</h1><table><tr><th>秒</th>';
  Object.keys(col).forEach((k) => { html += '<th>' + k + '</th><th>起きたこと</th>'; });
  html += '</tr>';
  for (const ms of ticks) {
    html += '<tr' + (ms === 0 ? ' class="z"' : '') + '><td class="t">' + (ms / 1000).toFixed(1) + '</td>';
    Object.keys(col).forEach((k) => {
      const f = path.join(OUT, 'frames', k, 名(ms));
      html += '<td>' + (fs.existsSync(f) ? '<img width="' + col[k] + '" src="file:///' + f.replace(/\\/g, '/') + '">' : '—') + '</td><td class="e">' + 印(k, ms).join('<br>') + '</td>';
    });
    html += '</tr>';
  }
  html += '</table>';
  const file = path.join(OUT, '並べた.html');
  fs.writeFileSync(file, html);
  const d = await b.newDevice('並べる', { width: 1100, height: 900, mobile: false, deviceScaleFactor: 1 });
  await d.go('file:///' + file.replace(/\\/g, '/'));
  await sleep(1500);
  const size = await d.ev('({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})');
  await d.raw('Emulation.setDeviceMetricsOverride', { width: size.w, height: Math.min(size.h, 16000), deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  await d.shotFull(path.join(OUT, '並べた.jpg'), { w: size.w, h: Math.min(size.h, 16000) });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const W = makeWalk({ cassette: '_boom_' + SET, base: BASE, out: path.join(OUT, 'walk'), cdp: CDP });
  const 結果 = { 設定: 設定.名, prefs: 設定.prefs, 面: {} };
  try {
    await W.始める(['進行役', '参加者', '大画面']);
    for (const d of Object.values(W.devices())) await rec.attach(d, 設定.prefs);
    const 集め = 記録を集める({ 手元: W.part, 大画面: W.big });
    const r = await 手元と大画面(W, 結果);
    await 集め.stop();
    const 時間表たち = {};
    for (const 面 of ['手元', '大画面']) {
      const z = 零を決める(集め.箱[面], r.押した時刻);
      時間表たち[面] = 時間表(集め.箱[面], z.t);
      結果.面[面] = { 零: z.何で, 押した時刻からの零: ((z.t - r.押した時刻) / 1000).toFixed(2) + '秒', 押した: r.押した, ライフ: r.ライフ,
        コマ数: r.コマ[面].length, コマ: コマを切る(r.コマ[面], z.t, path.join(OUT, 'frames', 面)), 時間表: 時間表たち[面] };
    }
    const h = await 手渡し(W._b, W);
    const hev = []; (await rec.take(h.dev)).forEach((e) => hev.push(e));
    const z = 零を決める(hev, h.押した時刻);
    時間表たち.手渡し = 時間表(hev, z.t);
    結果.面.手渡し = { 零: z.何で, 押した時刻からの零: ((z.t - h.押した時刻) / 1000).toFixed(2) + '秒', 押した: h.押した, ライフ: h.ライフ,
      コマ数: h.コマ.length, コマ: コマを切る(h.コマ, z.t, path.join(OUT, 'frames', '手渡し')), 時間表: 時間表たち.手渡し };
    await 並べる(W._b, 結果.面, 時間表たち);
    // 記録係の生の記録も、通し（fx-census）と同じ形で残す——一覧の①〜⑤の欄に爆発の行を入れるため
    const 生 = [];
    [['手元', '参加者'], ['大画面', '大画面']].forEach(([k, dev]) => 集め.箱[k].forEach((e) => { e.dev = dev; e.step = 0; 生.push(e); }));
    hev.forEach((e) => { e.dev = '手渡し'; e.step = 0; 生.push(e); });
    fs.mkdirSync(path.join(OUT, '..', '..', 'census'), { recursive: true });
    fs.writeFileSync(path.join(OUT, '..', '..', 'census', '_boom_' + SET + '.json'), JSON.stringify({ カセット: 'bakudan-boom', 設定: 設定.名, prefs: 設定.prefs, 手順: [], 記録: 生 }));
  } catch (e) {
    結果.失敗 = String(e && e.stack || e);
    console.error(結果.失敗);
  } finally {
    fs.writeFileSync(path.join(OUT, '時間表.json'), JSON.stringify(結果, null, 1));
    await W.片付ける();
    if (server) server.kill();
  }
  Object.keys(結果.面).forEach((k) => console.log(k + '：' + 結果.面[k].零 + ' ／ コマ ' + 結果.面[k].コマ数 + ' ／ 押した ' + JSON.stringify(結果.面[k].押した)));
  process.exit(結果.失敗 ? 1 : 0);
})();
