#!/usr/bin/env node
// tools/demo-walk.js — 審査会のデモの流れを、実サーバーで最後まで通してスクショを撮る（指示60 B-2）
//
// ── 使い方 ────────────────────────────────────────
//   node tools/dev-server.js            # 別の窓で。検証用サーバー（/dev-login 付き）
//   node tools/demo-walk.js             # 流れを通して docs/審査会_デモ/ にスクショを置く
//   node tools/demo-walk.js --out DIR   # スクショの置き場を変える
//   node tools/demo-walk.js --skip      # 参加者の端末を「演出の速さ＝スキップ」にして通す
//
// ── 通す流れ（スライドと同じ） ─────────────────────
//   棚 → 爆弾解除 → みんなのスマホで → 部屋をつくる → ゲームをえらぶ → 協力版 → 設定 →
//   待合（QR） → 参加者が**QRを読んで**入る（ログインしていない端末） → 大画面が入る →
//   ルール → 準備OK → はじめる → **1回目：わざと外して爆発** → 結果 → つぎは？（もう一度） →
//   **2回目：全部当てて解除** → 結果 → 部屋を出る
//
// **端末は3台とも別の人**（tools/cdp.js の newDevice：localStorage もクッキーも別）。
// 進行役だけ /dev-login でログインする。参加者はログインしない（QRから入る人）。
//
// **QRは本当に読む。**画面のSVGを画像にして、独立したデコーダー（jsqr）で読み、
// 出てきたURLを参加者の端末で開く（落とし穴19：自分の読み戻しだけで確かめない）。
//
// **答えは画面から探す。**3択の問題文を、配られている問題バンク（public/js/quiz-bank.js）で
// 引いて正解を選ぶ。判定は本物のサーバー（bomb-room.js）のまま。
//
// **本番には向けない**（検証用サーバーだけ）。

const fs = require('fs');
const path = require('path');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const BASE = arg('url', 'http://localhost:3001');
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'docs', '審査会_デモ')));
const SKIP = !!arg('skip', false);
const JSQR = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'jsqr', 'dist', 'jsQR.js'), 'utf8');

const 記録 = [];
let 番号 = 0;
async function 撮る(dev, 名, メモ) {
  番号++;
  const file = path.join(OUT, String(番号).padStart(2, '0') + '_' + dev.name + '_' + 名.replace(/[\/:*?"<>|（）]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') + '.jpg');
  await dev.shot(file);
  const scr = await dev.screen();
  記録.push({ 番号, 端末: dev.name, 名, 画面: scr, メモ: メモ || '', file: path.basename(file) });
  console.log(String(番号).padStart(2) + ' [' + dev.name + '] ' + 名 + ' → ' + scr + (メモ ? '（' + メモ + '）' : ''));
}
const 画面は = (dev, id, ms) => dev.until("(document.querySelector('.screen.active')||{}).id===" + JSON.stringify(id), ms || 10000, id);
const 見える = (sel) => "(function(){var e=document.querySelector(" + JSON.stringify(sel) + ");return !!e&&!!(e.offsetParent||e.getClientRects().length)&&getComputedStyle(e).display!=='none';})()";

/** 初めての人への「あそびかたを見ますか？」（指示57）。撮ってから「いらない」を選ぶ */
async function 問いかけ(dev, 名) {
  const 出た = await dev.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button')).find(function(x){return /いらない/.test(x.textContent)&&x.offsetParent;}); return !!b;})()");
  if (!出た) return false;
  await 撮る(dev, 名 || 'はじめてですね');
  await dev.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button')).find(function(x){return /いらない/.test(x.textContent)&&x.offsetParent;}); b.click(); return true;})()");
  await sleep(600);
  return true;
}
async function 扉を越える(dev) {
  await dev.until("document.getElementById('safetyGate').style.display==='flex'||(document.querySelector('.screen.active')||{}).id!=='scr-door'", 8000, '起動');
  if (await dev.ev("document.getElementById('safetyGate').style.display==='flex'")) await dev.click('#sgStartBtn');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(png|jpg)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  const b = await launch();
  try {
    const 進行役 = await b.newDevice('進行役');
    const 参加者 = await b.newDevice('参加者');
    const 大画面 = await b.newDevice('大画面', { width: 1280, height: 720, mobile: false, deviceScaleFactor: 1 });

    // ---- 進行役：ログインして棚へ ----
    await 進行役.go(BASE + '/dev-login');
    await 進行役.go(BASE + '/');
    await 扉を越える(進行役);
    await 画面は(進行役, 'scr-entry');
    await 撮る(進行役, '入口');
    await 進行役.click('[data-entry="choose"]');
    await 画面は(進行役, 'scr-shelf');
    await sleep(600);
    await 進行役.click('.cart[data-cart="bakudan"]'); await sleep(500);
    await 撮る(進行役, '棚で爆弾解除を選ぶ');
    if (await 進行役.screen() === 'scr-shelf') { await 進行役.click('.cart[data-cart="bakudan"]'); await sleep(1500); }
    await 画面は(進行役, 'scr-play-way');
    await 撮る(進行役, '遊び方をえらぶ');
    await 進行役.click('#wayChoices [data-way="room"]');
    await 画面は(進行役, 'scr-rt-lobby');
    await 進行役.ev("(function(){var i=document.getElementById('rtCreateName'); if(!i.value) i.value='くま'; return i.value;})()");
    await 撮る(進行役, '部屋をつくる');
    await 進行役.click('#rtCreateBtn');
    await 画面は(進行役, 'scr-rt-room');
    await sleep(500);
    await 撮る(進行役, '待合（QRとコード）');

    // ---- 進行役：ゲームをえらぶ → 協力版 → 設定 → 待合へ ----
    if (await 進行役.ev(見える('#rtPickGameBtn'))) await 進行役.click('#rtPickGameBtn');
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const scr = await 進行役.screen();
      if (process.env.DEMO_DEBUG) console.log('   …' + scr);
      if ((scr === 'scr-rt-room' || scr === 'scr-rt-rules') && i > 0) break;
      if (scr === 'scr-shelf') { await 進行役.click('.cart[data-cart="bakudan"]'); await sleep(500);
        if (await 進行役.screen() === 'scr-shelf') await 進行役.click('.cart[data-cart="bakudan"]'); continue; }
      if (scr === 'scr-mode') {
        await 進行役.click('.mode-card[data-id="bomb-coop"]'); await sleep(300);
        await 撮る(進行役, 'モード（協力版）');
        await 進行役.click('#modeNextBtn'); continue;
      }
      if (scr === 'scr-set-bomb') {
        // デモを短くする：かんたん3本だけ（本番の審査会で何本にするかは、その場で決めてよい）
        // 行は押すたびに描き直されるので、**毎回探し直して**押す（古い要素を押しても効かない）
        const 本数 = await 進行役.ev("(function(){var tiers=Array.from(document.querySelectorAll('#bombTierRows .bomb-minus')).map(function(b){return b.dataset.tier;});" +
          "tiers.forEach(function(t){for(var k=0;k<40;k++){var m=document.querySelector('#bombTierRows .bomb-minus[data-tier=\"'+t+'\"]'); if(!m) break; m.click();}});" +
          "for(var k=0;k<3;k++){document.querySelector('#bombTierRows .bomb-plus[data-tier=\"easy\"]').click();}" +
          "return tiers.map(function(t){var c=document.getElementById('bombCount-'+t); return t+':'+(c?c.textContent:'?');}).join(' ');})()");
        console.log('   コードの本数：' + 本数);
        await 撮る(進行役, '設定：コードの本数');
      }
      if (scr === 'scr-mode-rules') { await 撮る(進行役, 'モードのルール'); await 進行役.click('#rulesStartBtn'); continue; }
      const next = await 進行役.ev("(function(){var n=document.querySelector('.screen.active [data-wiz-next]'); if(!n) return false; n.click(); return true;})()");
      if (!next) await sleep(300);
    }
    // 設定を終えると、進行役も部屋のルール画面（準備OK）を通る（モードのルール画面は挟まない）
    if (await 進行役.screen() === 'scr-rt-rules') {
      await 撮る(進行役, 'ルール（進行役）');
      await 進行役.click('#rtRulesOkBtn');
    }
    await 画面は(進行役, 'scr-rt-room');
    await 撮る(進行役, '待合（ゲームが決まった）');

    // ---- QRを本当に読む ----
    const url = await 進行役.ev("(async function(){" + JSQR + ";\n" +
      "var svg=document.querySelector('#rtQr svg'); if(!svg) return null;" +
      "var xml=new XMLSerializer().serializeToString(svg);" +
      "var img=new Image(); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);" +
      "await new Promise(function(r){img.onload=r;img.onerror=r;});" +
      "var c=document.createElement('canvas'); c.width=400; c.height=400; var g=c.getContext('2d');" +
      "g.fillStyle='#fff'; g.fillRect(0,0,400,400); g.drawImage(img,20,20,360,360);" +
      "var d=g.getImageData(0,0,400,400); var q=(typeof jsQR!=='undefined'?jsQR:window.jsQR)(d.data,400,400);" +
      "return q?q.data:null;})()");
    if (!url) throw new Error('QRが読めませんでした');
    console.log('   QRの中身：' + url);

    // ---- 参加者：QRのURLを開く（ログインしていない） ----
    if (SKIP) {
      // 遊ぶ人が設定で選べるのと同じ状態（演出の速さ＝スキップ）を先に置く
      await 参加者.go(BASE + '/');
      await 参加者.ev("(function(){localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:'skip'})); return true;})()");
    }
    await 参加者.go(url);
    await 扉を越える(参加者);
    await sleep(1500);
    await 撮る(参加者, 'QRから入る', 'ログインしていない端末');
    if (await 参加者.screen() === 'scr-rt-lobby') {
      await 参加者.ev("(function(){var i=document.getElementById('rtJoinName'); i.value='びび'; return true;})()");
      await 撮る(参加者, '名前を入れる');
      await 参加者.click('#rtJoinBtn');
    }
    await 参加者.until("['scr-rt-room','scr-rt-rules'].indexOf((document.querySelector('.screen.active')||{}).id)!==-1", 10000, '部屋に入る');
    await sleep(800);
    await 撮る(参加者, '部屋に入った');

    // ---- 大画面：入口の「大画面として部屋に入る」 ----
    const code = await 進行役.ev("(document.getElementById('rtRoomCode')||{}).textContent||''");
    await 大画面.go(BASE + '/');
    await 扉を越える(大画面);
    await 画面は(大画面, 'scr-entry');
    await 大画面.click('[data-entry="big"]');
    await sleep(800);
    if (await 大画面.screen() === 'scr-rt-lobby') {
      await 大画面.ev("(function(){document.getElementById('rtJoinCode').value=" + JSON.stringify(code.replace(/\s/g, '')) + "; document.getElementById('rtJoinName').value='テレビ'; return true;})()");
      await 大画面.click('#rtJoinBtn');
    }
    await 画面は(大画面, 'scr-rt-big', 10000);
    await sleep(800);
    await 撮る(大画面, '大画面で待つ');

    // ---- ルール → 準備OK（参加者） ----
    let ルールを撮った = false;
    for (let i = 0; i < 10; i++) {
      if (await 問いかけ(参加者, 'はじめてですね（チュートリアルの問いかけ）')) continue;
      const scr = await 参加者.screen();
      if (scr === 'scr-rt-rules') {
        if (!ルールを撮った) { await 撮る(参加者, 'ルール'); ルールを撮った = true; }
        await 参加者.click('#rtRulesOkBtn'); await sleep(800); continue;
      }
      if (await 参加者.ev(見える('#rtRoomReadyBtn'))) { await 参加者.click('#rtRoomReadyBtn'); await sleep(800); continue; }
      if (await 参加者.ev(見える('#rtRoomShowRulesBtn')) && i === 0) { await 参加者.click('#rtRoomShowRulesBtn'); await sleep(800); continue; }
      break;
    }
    await 撮る(参加者, '準備OKを押した');
    // 進行役も準備OK（ルールを読んでいなければ読む）
    for (let i = 0; i < 10; i++) {
      if (await 問いかけ(進行役)) continue;
      const scr = await 進行役.screen();
      if (scr === 'scr-rt-rules') { await 進行役.click('#rtRulesOkBtn'); await sleep(800); continue; }
      if (await 進行役.ev(見える('#rtRoomReadyBtn'))) { await 進行役.click('#rtRoomReadyBtn'); await sleep(800); continue; }
      break;
    }
    await 撮る(進行役, 'はじめる前');

    // ---- 2回遊ぶ：1回目は爆発、2回目は解除 ----
    for (const 回 of ['爆発', '解除']) {
      // 全員が準備OKを押すと、自動で始まる（進行役の「はじめる」は要らない）。
      // まだ始まっていなければ、進行役が押す
      if (await 参加者.screen() !== 'scr-rt-bomb' && await 進行役.ev(見える('#rtStartBtn') + " && !document.getElementById('rtStartBtn').disabled")) {
        await 進行役.click('#rtStartBtn');
      }
      await 画面は(参加者, 'scr-rt-bomb', 15000);
      await sleep(600);
      await 撮る(大画面, 回 + '：3-2-1');
      await 参加者.until("document.querySelectorAll('#rtBombBoard .bomb-wire-btn').length>0", 15000, '盤');
      await sleep(3400);   // 3-2-1 が終わるまで
      await 撮る(参加者, 回 + '：盤');
      await 撮る(大画面, 回 + '：大画面の盤');

      const 仕掛け = []; // 出たものの時系列（参加者の端末）
      await 参加者.ev("(function(){window.__記録=[];var t0=performance.now();new MutationObserver(function(rs){rs.forEach(function(r){Array.prototype.forEach.call(r.addedNodes,function(n){if(n.classList&&/fx-(blackout|burst|shutter|cel)/.test(n.className))window.__記録.push(Math.round(performance.now()-t0)+'ms 出た '+n.className.split(' ').slice(0,2).join(' '));});Array.prototype.forEach.call(r.removedNodes,function(n){if(n.classList&&/fx-(blackout|burst|shutter|cel)/.test(n.className))window.__記録.push(Math.round(performance.now()-t0)+'ms 消えた '+n.className.split(' ')[0]);});if(r.type==='attributes'&&r.target.id==='titleGotOverlay'&&r.target.classList.contains('show'))window.__記録.push(Math.round(performance.now()-t0)+'ms 称号');});}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});return true;})()");

      for (let 手 = 0; 手 < 12; 手++) {
        if (await 参加者.ev("!!document.querySelector('.fx-blackout,.fx-cel')") ||
            await 参加者.ev("/結果/.test(document.getElementById('rtBombPhase').textContent)")) break;
        const ok = await 参加者.ev("(function(){var b=document.querySelector('#rtBombBoard .bomb-wire-btn:not(.solved):not(.taken)'); if(!b) return false; b.click(); return true;})()");
        if (!ok) { await sleep(400); continue; }
        await 参加者.until("document.getElementById('rtBombOverlay').classList.contains('show') && document.querySelectorAll('#rtBombChoices .pk-btn').length===3", 6000, '3択');
        if (手 === 0) await 撮る(参加者, 回 + '：3択');
        const 答え = await 参加者.ev("(function(){var q=document.getElementById('rtBombDescription').textContent; var all=[]; Object.keys(QuizBank.QUESTIONS).forEach(function(k){all=all.concat(QuizBank.QUESTIONS[k]);}); var hit=all.find(function(x){return x.q===q;}); return hit?hit.choices[hit.correct]:null;})()");
        const 選ぶ = 回 === '解除' ? 答え
          : await 参加者.ev("(function(){var a=" + JSON.stringify(答え) + "; var b=Array.from(document.querySelectorAll('#rtBombChoices .pk-btn')).find(function(x){return x.textContent!==a;}); return b?b.textContent:null;})()");
        await 参加者.ev("(function(){var b=Array.from(document.querySelectorAll('#rtBombChoices .pk-btn')).find(function(x){return x.textContent===" + JSON.stringify(選ぶ) + ";}); b.click(); return true;})()");
        await sleep(回 === '爆発' ? 700 : 500);
        if (回 === '爆発' && 手 === 0) await 撮る(参加者, '爆発：1つ外した');
      }
      // 決着の演出：出ている最中に撮る（片付いたあとに撮らない・落とし穴10-g）
      if (回 === '爆発' && SKIP) {
        // スキップ設定：💥は描かれず、黒い幕と「爆発しました」が2秒出る（指示60 A-1a①）
        await 参加者.until("!!document.querySelector('.fx-shutter')", 6000, '爆発しました');
        await 撮る(参加者, '爆発：スキップ設定でも爆発しました');
      } else if (回 === '爆発') {
        await 参加者.until("!!document.querySelector('.fx-burst')", 6000, '💥');
        await 撮る(参加者, '爆発：黒い幕の上の爆発');
        await 撮る(大画面, '爆発：大画面の爆発');
        await 参加者.until("!!document.querySelector('.fx-shutter')", 4000, '爆発しました');
        await sleep(600);
        await 撮る(参加者, '爆発：爆発しました（2秒かタップ）');
        await 撮る(大画面, '爆発：大画面の爆発しました');
      } else if (SKIP) {
        // スキップ設定：祝いは描かず、すぐ結果（A-2 の決まり）
        await 参加者.until("/結果/.test(document.getElementById('rtBombPhase').textContent)", 8000, '結果');
        await 撮る(大画面, '解除：大画面のクリア演出');
      } else {
        await 参加者.until("!!document.querySelector('.fx-cel')", 6000, '祝い');
        await sleep(700);
        await 撮る(参加者, '解除：クリア演出');
        await 撮る(大画面, '解除：大画面のクリア演出');
      }
      await 参加者.until("!document.querySelector('.fx-blackout,.fx-cel,.fx-shutter')", 8000, '演出が終わる');
      await sleep(700);
      await 撮る(参加者, 回 + '：結果');
      await 撮る(大画面, 回 + '：大画面の結果');
      仕掛け.push.apply(仕掛け, await 参加者.ev('window.__記録'));
      console.log('   時系列（参加者）：' + 仕掛け.join(' / '));
      記録.push({ 番号: '-', 端末: '参加者', 名: 回 + 'の時系列', 画面: '', メモ: 仕掛け.join(' / '), file: '' });

      if (回 === '爆発') {
        // もう一度：進行役が「つぎは？」→ 同じゲームをもう一度
        await 進行役.until(見える('#rtBombAgainBtn'), 8000, 'つぎは？');
        await 撮る(進行役, '爆発：進行役の結果');
        await 進行役.click('#rtBombAgainBtn');
        await sleep(800);
        await 撮る(進行役, 'つぎは？');
        const again = await 進行役.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button, .screen.active button')).find(function(x){return /もう一度|同じゲーム/.test(x.textContent)&&x.offsetParent;}); if(!b) return null; b.click(); return b.textContent.trim();})()");
        console.log('   もう一度：' + again);
        await sleep(1000);
        // 全員が待合に戻り、準備OK
        for (const d of [参加者, 進行役]) {
          for (let i = 0; i < 8; i++) {
            if (await 問いかけ(d)) continue;
            const scr = await d.screen();
            if (scr === 'scr-rt-rules') { await d.click('#rtRulesOkBtn'); await sleep(700); continue; }
            if (await d.ev(見える('#rtRoomReadyBtn'))) { await d.click('#rtRoomReadyBtn'); await sleep(700); continue; }
            break;
          }
        }
        await 撮る(参加者, 'もう一度：待合で準備OK');
      }
    }

    // ---- 部屋を出る（参加者） ----
    await 参加者.until(見える('#rtBombLeaveBtn'), 8000, '部屋を出る');
    await 参加者.click('#rtBombLeaveBtn');
    await sleep(800);
    const 確認 = await 参加者.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button')).find(function(x){return /出る/.test(x.textContent)&&x.offsetParent;}); if(!b) return null; b.click(); return b.textContent.trim();})()");
    await sleep(1200);
    await 撮る(参加者, '部屋を出た', 確認 ? '確認：' + 確認 : '');
    await 撮る(進行役, '参加者が出たあと');

    const エラー = [進行役, 参加者, 大画面].map((d) => d.name + '：' + (d.logs.length ? d.logs.join(' | ') : 'なし'));
    console.log('画面のエラー：' + エラー.join(' ／ '));
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify({ url, 記録, エラー, skip: SKIP }, null, 2));
  } finally { await b.close(); }
})().catch((e) => { console.error('失敗：' + (e && e.stack || e)); process.exit(1); });
