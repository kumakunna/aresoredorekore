#!/usr/bin/env node
// tools/probe-63-return.js — 「← 部屋を出る」のあと、同じ参加者として戻れるか（指示63 門G6）
//
//   node tools/probe-63-return.js [--port 3360 --cdp 9660]
//
// 3つの戻り道を、本物のブラウザ（ゲストの参加者 375×667）で通す：
//   ① 結果の画面で出る（確認が出る）→ 棚の「さっきの部屋にもどる」→ 同じ人として戻る
//      （名前を入れ直さない・自分の結果の行・観戦にならない）。続けて「もう一度」でルールを読み直さない
//   ② 待合で出て、**同じQRを読み直す**（ページが開き直される）→ 名前が入っている → 同じ人として戻る
//   ③ 待合で**ページを読み込み直す** → 入る画面で止まらず、部屋の画面へ（全員の準備OKを止めない）
// memberId は端末の記憶（acac-room）で比べる。画像と記録は docs/監査_審査会の指摘_画像/_63_もどる/。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = String(arg('port', '3360'));
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_審査会の指摘_画像', '_63_もどる');
const 自分のid = "(JSON.parse(localStorage.getItem('acac-room')||'null')||{}).memberId||null";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const W = makeWalk({ cassette: '_63_return', base: BASE, out: OUT, cdp: parseInt(arg('cdp', '9660'), 10) });
  const 結果 = {};
  const 出る = async (名) => {
    await W.手順を('参加者', 名 + '：← 部屋を出る', '押す', () => W.press(W.part, /部屋を出る/), { 間: 600 });
    結果[名 + '_確認'] = await W.part.ev("(function(){var h=document.querySelector('.ui-layer .ui-head');return h?h.textContent:null;})()");
    await W.手順を('参加者', 名 + '：確認「出る」', '押す', () => W.press(W.part, /^出る$/, '.ui-layer button'), { 間: 900 });
  };
  try {
    await W.始める();
    await W.進行役が部屋をつくる('bakudan', '爆弾解除');
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await W.click(W.host, '#rtPickGameBtn');
    await W.画面は(W.host, 'scr-shelf');
    await W.設定を進める({ cassetteId: 'bakudan', 名: '爆弾解除' });
    await W.準備OKまで(W.part, { チュートリアル: 'いらない' });
    await W.準備OKまで(W.host);
    // bot 2人が解き終えるまで待つ（人の役と進行役は押さない）
    await W.待つ('全員', '決着（bot が全部解く）', '他の人待ち', () => W.part.until("/結果/.test((document.getElementById('rtBombPhase')||{}).textContent||'') && !document.querySelector('.fx-cel,.fx-blackout,.fx-shutter')", 240000), { 間: 2500 });
    const 前のid = await W.part.ev(自分のid);
    結果.前のid = 前のid;
    // ① 結果の画面で出る → 棚の「さっきの部屋にもどる」
    await 出る('①');
    結果['①_出た先'] = await W.part.screen();
    await W.part.until("(document.getElementById('shelfReturnNote')||{}).style && document.getElementById('shelfReturnNote').style.display!=='none'", 5000, '棚に「さっきの部屋にもどる」');
    await W.手順を('参加者', '①：棚に「さっきの部屋にもどる」', '見る', null);
    結果['①_棚の行'] = await W.part.ev("document.getElementById('shelfReturnNote').textContent");
    await W.手順を('参加者', '①：さっきの部屋にもどる', '押す', () => W.click(W.part, '#shelfReturnNote'), { 間: 1500 });
    結果['①_戻ったid'] = await W.part.ev(自分のid);
    結果['①_同じ人'] = 結果['①_戻ったid'] === 前のid;
    結果['①_観戦の文'] = await W.part.ev("/観戦/.test(document.body.innerText)");
    結果['①_自分の行'] = await W.part.ev("!!document.querySelector('.is-me')");
    // ② 「もう一度」でルールを読み直さないか
    await W.手順を('進行役', '②の前：つぎは？', '押す', () => W.click(W.host, '#rtBombAgainBtn'), { 間: 700 });
    await W.手順を('進行役', '②の前：もう一度', '押す', () => W.press(W.host, /^もう一度/), { 間: 1500 });
    結果['もう一度_参加者の画面'] = await W.part.screen();
    結果['もう一度_ルールに引っぱられない'] = 結果['もう一度_参加者の画面'] !== 'scr-rt-rules';
    // ② 待合で出て、同じQRを読み直す
    await 出る('②');
    await W.手順を('参加者', '②：同じQRを読み直す（ページが開き直される）', 'QRを読む', () => W.part.go(W.qrUrl), { 間: 1800 });
    結果['②_名前'] = await W.part.ev("(document.getElementById('rtJoinName')||{}).value||''");
    if ((await W.part.screen()) === 'scr-rt-lobby') {
      await W.手順を('参加者', '②：名前は入っている → 部屋に入る', '押す', () => W.click(W.part, '#rtJoinBtn'), { 間: 1500 });
    }
    結果['②_戻ったid'] = await W.part.ev(自分のid);
    結果['②_同じ人'] = 結果['②_戻ったid'] === 前のid;
    結果['②_画面'] = await W.part.screen();
    // ③ 待合でページを読み込み直す
    await W.手順を('参加者', '③：ページを読み込み直す', '開く', () => W.part.go(W.qrUrl), { 待ち: { 種類: '通信待ち', 何を: '部屋の画面', until: () => W.part.until("['scr-rt-room','scr-rt-rules','scr-rt-bomb'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 8000) }, 間: 800, 失敗してよい: true });
    結果['③_画面'] = await W.part.screen();
    結果['③_入る画面で止まらない'] = 結果['③_画面'] !== 'scr-rt-lobby';
    結果['③_id'] = await W.part.ev(自分のid);
    結果['③_同じ人'] = 結果['③_id'] === 前のid;
  } catch (e) {
    結果.失敗 = String(e && e.stack || e);
    console.error(結果.失敗);
  } finally {
    W.書き出す({ 結果 });
    await W.片付ける();
    if (server) server.kill();
    try { await require('./flow-sheet').build(OUT, { port: parseInt(arg('cdp', '9660'), 10) + 50 }); } catch (e) {}
  }
  console.log(JSON.stringify(結果, null, 2));
  process.exit(結果.失敗 ? 1 : 0);
})();
