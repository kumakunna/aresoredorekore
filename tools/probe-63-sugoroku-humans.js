#!/usr/bin/env node
// tools/probe-63-sugoroku-humans.js — すごろく（こまはひとつ）を、**bot 無し・全員が人の部屋**で
// 最初のミニゲームまで進め、3-2-1 が終わってから全員の手元に押すものが出るまでの時間を測る（指示63 門G2）
//
//   node tools/probe-63-sugoroku-humans.js [--port 3330 --cdp 9630]
//
// **なぜ bot を入れないか。**直す前は、ミニゲームの入力が「ほかの誰かが出して部屋の知らせが届いた時」に
// しか描かれなかった。bot は数え終わるとすぐ出すので、その知らせで人の画面も描き直され、
// **bot がいる検証では不具合が隠れていた**（指示62）。だから3人とも本物のブラウザにする。
//
// 3人とも、画面に出たもの（ルールの準備OK・盤のじゅんびOK・説明の幕の ✕・ミニゲームのじゅんびOK）を
// ページの中で押して進む。押すものが出た瞬間と、数え終わった瞬間を、ページの中の見張りが記録する。
// 画像は docs/監査_審査会の指摘_画像/_63_すごろく/ に置く（git に入れない）。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = String(arg('port', '3330'));
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_審査会の指摘_画像', '_63_すごろく');

// ページの中：見えている「進む」ものを押し、数え終わりと入力の出た時刻を記録する
const 自動 = `(function(){
  if (window.__g2) return true;
  var g = window.__g2 = { 数え始め: [], 数え: [], 入力: null, 押した: [] };
  var cv = typeof Element.prototype.checkVisibility === 'function';
  function shown(e){ if(!e) return false; var r = e.getBoundingClientRect(); if(r.width<1||r.height<1) return false; return cv ? e.checkVisibility({opacityProperty:true,visibilityProperty:true}) : true; }
  var 前 = false;
  setInterval(function(){
    var now = Date.now();
    var 数え中 = !!document.querySelector('.fx-countdown');
    // 数え始め（3-2-1 の箱が出た瞬間）。数え終わりは「始め＋3秒」で読む——
    // 裏に回ったタブでは数字の切り替えが進まないことがある（落とし穴28）ので、箱が消えるのを待たない
    if (!前 && 数え中) g.数え始め.push(now);
    if (前 && !数え中) g.数え.push(now);         // 数え終わった瞬間（取れた時だけ）
    前 = 数え中;
    var inp = document.getElementById('rtSugoInput');
    var 入力 = inp && (Array.from(inp.querySelectorAll('[data-hand],[data-fingers],[data-choice]')).some(shown) || shown(document.getElementById('rtSugoInputTapBtn')));
    if (入力 && !g.入力) g.入力 = { at: now, 文: inp.innerText.replace(/\\s+/g,' ').slice(0,60) };
    if (g.入力) return;                          // 押すものが出たら、そこで止まる（押さない）
    function 押す(sel, 名){ var b = Array.from(document.querySelectorAll(sel)).filter(shown).filter(function(x){return !x.disabled;})[0]; if(b){ b.click(); g.押した.push(名); return true; } return false; }
    // 「はじめてですね」は出ない（すごろくには台本が無い）が、出たら断る
    if (押す('.ui-layer.is-on [data-ui=close]', '幕の✕')) return;
    if (押す('#rtRulesOkBtn', 'ルールの準備OK')) return;
    if (押す('#rtRoomReadyBtn', '待合の準備OK')) return;
    if (押す('#rtSugoInput [data-rtsugo=ready]', 'じゅんびOK')) return;
  }, 60);
  return true;
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const W = makeWalk({ cassette: 'sugoroku', base: BASE, out: OUT, cdp: parseInt(arg('cdp', '9630'), 10) });
  const 結果 = { 人数: 3, bot: 0 };
  try {
    await W.始める(['進行役', '参加者']);
    const devs = W.devices();
    devs.参加者2 = await W._b.newDevice('参加者2', { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
    await W.進行役が部屋をつくる('sugoroku', 'すごろく');
    await W.参加者がQRで入る('ひろ');
    // 2人目の人：同じQRを、別の端末で読む
    const p2 = devs.参加者2;
    await p2.go(W.qrUrl);
    await W.扉を越える(p2);
    // 扉が開き切るのを待ってから見る（開く途中で見ると、まだ scr-door のことがある）
    await p2.until("['scr-rt-lobby','scr-rt-room','scr-rt-rules'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 12000, '2人目の入る画面');
    if ((await p2.screen()) === 'scr-rt-lobby') { await W.type(p2, '#rtJoinName', 'ゆい'); await p2.click('#rtJoinBtn'); }
    await p2.until("['scr-rt-room','scr-rt-rules'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 12000, '2人目が入る');
    // 進行役：ゲームを選ぶ（既定のまま）
    await W.click(W.host, '#rtPickGameBtn');
    await W.画面は(W.host, 'scr-shelf');
    await W.設定を進める({ cassetteId: 'sugoroku', 名: 'すごろく' });
    結果.ゲーム = W.ゲーム; 結果.モード = W.モード;
    // 3人とも、ページの中で自動で進める
    const 人 = { 進行役: W.host, 参加者: W.part, 参加者2: p2 };
    for (const k of Object.keys(人)) await 人[k].ev(自動);
    // 全員に押すものが出るまで待つ（最初のミニゲーム）
    const t0 = Date.now();
    for (;;) {
      const st = {};
      for (const k of Object.keys(人)) st[k] = await 人[k].ev('window.__g2');
      if (Object.values(st).every((g) => g && g.入力)) { 結果.見張り = st; break; }
      if (Date.now() - t0 > 120000) { 結果.見張り = st; 結果.失敗 = '120秒たっても、全員の手元に押すものが出ない'; break; }
      await sleep(200);
    }
    for (const k of Object.keys(人)) await 人[k].shot(path.join(OUT, k + '_入力が出た.jpg'));
    // 数え終わり（最後のもの）から入力が出るまで
    結果.数え終わりから入力まで_ms = {};
    for (const k of Object.keys(結果.見張り || {})) {
      const g = 結果.見張り[k];
      const 始め = (g.数え始め || []).slice(-1)[0];
      結果.数え終わりから入力まで_ms[k] = (g.入力 && 始め) ? g.入力.at - (始め + 3000) : null;
    }
    結果.画面のエラー = Object.fromEntries(Object.keys(人).map((k) => [k, 人[k].logs]));
  } catch (e) {
    結果.失敗 = String(e && e.stack || e);
  } finally {
    await W.片付ける();
    if (server) server.kill();
  }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(結果, null, 2));
  console.log(JSON.stringify({ ゲーム: 結果.ゲーム, 数え終わりから入力まで_ms: 結果.数え終わりから入力まで_ms, 失敗: 結果.失敗 || null }, null, 2));
  process.exit(結果.失敗 ? 1 : 0);
})();
