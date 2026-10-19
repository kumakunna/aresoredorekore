#!/usr/bin/env node
// tools/probe-63-look.js — 待合で着替えると、ほかの人の名簿と大画面に**その場で**出るか。
// 着替えの途中で進行役がゲームを選んだら、シートが閉じてルールへ進むか（指示63 門G5）
//
//   node tools/probe-63-look.js [--port 3350 --cdp 9650]
//
// 参加者は**ログインしないゲスト**。その日に遊んで取った称号を持っている状態から始める
//（くまくんの判断1：ゲストの称号はその日のうちは端末に残る。前の試合で取った人と同じ形）。
// 画像と記録は docs/監査_審査会の指摘_画像/_63_着替え/（git に入れない）。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = String(arg('port', '3350'));
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_審査会の指摘_画像', '_63_着替え');
const 今日 = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const W = makeWalk({ cassette: '_63_look', base: BASE, out: OUT, cdp: parseInt(arg('cdp', '9650'), 10) });
  const 結果 = {};
  try {
    await W.始める();
    await W.進行役が部屋をつくる('bakudan', '爆弾解除');
    // 参加者の端末に、その日に取った称号を置いてから QR を開く（前の試合で 💣 解除班の証を取った人）
    await W.part.go(BASE + '/');
    await W.part.ev("(function(){localStorage.setItem('acac-guest-titles', JSON.stringify({day:'" + 今日 + "',stats:{bakudan:{plays:1}},unlocked:['icon-bomb-1'],equipped:{icon:'icon-default',first:'first-hajime',joiner:'joiner-no',last:'last-ippo'},newIds:['icon-bomb-1']})); return true;})()");
    await W.参加者がQRで入る('ひろ');
    await W.大画面が入る();
    await W.botを入れる(2);
    await sleep(800);
    await W.手順を('参加者', '待合：着替えの入口（NEW つき）', '見る', null);
    結果.NEWが出ている = await W.part.ev("!document.getElementById('rtLookNew').hidden");
    // 着替える
    await W.手順を('参加者', '🏷 アイコン・二つ名をかえる', '押す', () => W.click(W.part, '#rtLookBtn'), { 間: 600 });
    結果.重ねて開く = await W.part.ev("!!document.querySelector('#uiLayerRoot [data-looksheet]') && (document.querySelector('.screen.active')||{}).id==='scr-rt-room'");
    await W.手順を('参加者', 'アイコンをかえる', '押す', () => W.press(W.part, /アイコンをかえる/, '#uiLayerRoot button'), { 間: 600 });
    結果.NEWの印 = await W.part.ev("Array.from(document.querySelectorAll('#uiLayerRoot [data-pickicon]')).filter(function(b){return b.querySelector('.new-mark');}).map(function(b){return b.dataset.pickicon;})");
    const t0 = Date.now();
    await W.手順を('参加者', '💣 を選ぶ', '押す', () => W.click(W.part, '#uiLayerRoot [data-pickicon="icon-bomb-1"]'), { 間: 0 });
    // ほかの人の名簿と大画面に、その場で出るか（時刻を測る）
    await W.host.until("(document.getElementById('rtMemberList')||{}).textContent.indexOf('💣')!==-1 || !!document.querySelector('#rtMemberList img[alt=\"💣\"]')", 5000, '進行役の名簿に 💣');
    結果.進行役の名簿に出るまで_ms = Date.now() - t0;
    await W.big.until("document.body.innerHTML.indexOf('💣')!==-1 || !!document.querySelector('#scr-rt-big img[alt=\"💣\"]')", 5000, '大画面に 💣');
    結果.大画面に出るまで_ms = Date.now() - t0;
    await W.手順を('全員', '着替えが名簿と大画面に出た', '見る', null);
    // 着替えの途中で、進行役がゲームを選ぶ
    await W.手順を('参加者', 'もう一度シートを開く（着替えの途中）', '押す', () => W.click(W.part, '#rtLookBtn'), { 間: 500 });
    await W.click(W.host, '#rtPickGameBtn');
    await W.画面は(W.host, 'scr-shelf');
    await W.設定を進める({ cassetteId: 'bakudan', 名: '爆弾解除' });
    await W.part.until("(document.querySelector('.screen.active')||{}).id!=='scr-rt-room'", 10000, '参加者がルールへ進む');
    await sleep(600);
    await W.手順を('参加者', '進行役がゲームを選んだ → シートは閉じてルールへ', '見る', null);
    結果.ルールへ進んだ = await W.part.screen();
    結果.シートが閉じた = await W.part.ev("!document.querySelector('#uiLayerRoot [data-looksheet]')");
    結果.着けたものが残っている = await W.part.ev("JSON.parse(localStorage.getItem('acac-guest-titles')).equipped.icon");
  } catch (e) {
    結果.失敗 = String(e && e.stack || e);
    console.error(結果.失敗);
  } finally {
    W.書き出す({ 結果 });
    await W.片付ける();
    if (server) server.kill();
    try { await require('./flow-sheet').build(OUT, { port: parseInt(arg('cdp', '9650'), 10) + 50 }); } catch (e) {}
  }
  console.log(JSON.stringify(結果, null, 2));
  process.exit(結果.失敗 ? 1 : 0);
})();
