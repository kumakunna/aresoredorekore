#!/usr/bin/env node
// tools/probe-63-lobby.js — 待合（375×667）の最初の画面に「何を待っているか」が入っているか、
// QR が**撮った画面から**読めるかを確かめる（指示63 門G8・第3部の QR）
//
//   node tools/probe-63-lobby.js [--port 3340 --cdp 9640]
//
// 進行役も参加者も 375×667（小さいスマホ）。3つの時点で撮る：
//   A 入った直後（進行役がまだゲームを選んでいない）
//   B 進行役がゲームを選び、参加者がルールを読んで準備OK を押したあと
//   C 進行役がゲームを選び直した2回目の待合（読んだ人の足に「✓ 準備OK」が増える形・指示62 の確かめで QR が切れた）
// QR は**撮った画像を jsQR にかけて**読む（画面の SVG ではなく、人のカメラが見るのと同じ絵）。
// 参加者は「友だちを呼ぶ」がたたんであるので、開いた時の絵でも読む（指示63：開いた時に全体が見える）。
// 画像と記録は docs/監査_審査会の指摘_画像/_63_待合/（git に入れない）。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = String(arg('port', '3340'));
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_審査会の指摘_画像', '_63_待合');
const JSQR = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'jsqr', 'dist', 'jsQR.js'), 'utf8');

/** 待合の「いま何を待っているか」が、巻かずに見える所にあるか */
const 待ちの文 = `(function(){
  var n = document.getElementById('rtRoomNote'); if(!n) return null;
  var r = n.getBoundingClientRect(), H = document.documentElement.clientHeight;
  return { 文: n.textContent.trim(), 上: Math.round(r.top), 下: Math.round(r.bottom), 画面の高さ: H,
    巻かずに見える: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= H };
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: 'ignore' });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const W = makeWalk({ cassette: '_63_lobby', base: BASE, out: OUT, cdp: parseInt(arg('cdp', '9640'), 10) });
  const 結果 = { 時点: {} };
  try {
    await W.始める([]);
    const devs = W.devices();
    devs.進行役 = await W._b.newDevice('進行役', { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
    devs.参加者 = await W._b.newDevice('参加者', { width: 375, height: 667, mobile: true, deviceScaleFactor: 2 });
    const 読む台 = await W._b.newDevice('読む台', { width: 800, height: 800, mobile: false, deviceScaleFactor: 1 });
    await 読む台.go('about:blank');
    await 読む台.ev('(function(){' + JSQR + ';window.__jsQR = (typeof jsQR!=="undefined"?jsQR:window.jsQR); return true;})()');

    /** 撮った画像（PNG）から QR を読む。読めたら中身、読めなければ null */
    async function 画像から読む(dev, file) {
      await dev.shot(file);
      const b64 = fs.readFileSync(file).toString('base64');
      return 読む台.ev("(async function(){var img=new Image(); img.src='data:image/png;base64," + b64 + "';" +
        "await new Promise(function(r){img.onload=r;img.onerror=r;});" +
        "var c=document.createElement('canvas'); c.width=img.width; c.height=img.height; var g=c.getContext('2d'); g.drawImage(img,0,0);" +
        "var d=g.getImageData(0,0,c.width,c.height); var q=window.__jsQR(d.data,c.width,c.height); return q?q.data:null;})()");
    }
    async function 撮る(時点, dev, 開く) {
      const 名 = 時点 + '_' + dev.name + (開く ? '_開いた' : '');
      if (開く) {
        await dev.ev("(function(){var d=document.getElementById('rtInvite'); if(d && !d.open){ d.open = true; d.dispatchEvent(new Event('toggle')); } return true;})()");
        await sleep(500);
      }
      const qr = await 画像から読む(dev, path.join(OUT, 名 + '.png'));
      const 待ち = await dev.ev(待ちの文);
      const 開いている = await dev.ev("!!(document.getElementById('rtInvite')||{}).open");
      (結果.時点[時点] = 結果.時点[時点] || {})[dev.name + (開く ? '（開いた）' : '')] = { QRが読める: !!qr, QRの中身: qr, 友だちを呼ぶ: 開いている ? '開いている' : 'たたんである', 待ちの文: 待ち };
      console.log(名 + '：QR ' + (qr ? '読める' : '読めない') + ' ／ 待ち「' + (待ち && 待ち.文) + '」' + (待ち && 待ち.巻かずに見える ? '（巻かずに見える）' : '（画面の外）'));
    }

    await W.進行役が部屋をつくる('bakudan', '爆弾解除');
    await W.参加者がQRで入る('ひろ');
    await W.botを入れる(2);
    await sleep(800);
    // A
    await 撮る('A', W.host);
    await 撮る('A', W.part);
    await 撮る('A', W.part, true);
    await W.part.ev("(function(){var d=document.getElementById('rtInvite'); if(d) d.open=false; return true;})()");
    // B：進行役がゲームを選ぶ → 参加者がルールを読んで準備OK
    await W.click(W.host, '#rtPickGameBtn');
    await W.画面は(W.host, 'scr-shelf');
    await W.設定を進める({ cassetteId: 'bakudan', 名: '爆弾解除' });
    await W.part.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-rules'", 10000, '参加者にルール');
    // 「はじめてですね」は断る（ここで見たいのは待合の並び）
    await W.part.click('#rtRulesOkBtn');
    await sleep(700);
    await W.part.ev("(function(){var b=Array.from(document.querySelectorAll('.ui-layer button')).find(function(x){return /いらない/.test(x.textContent);}); if(b) b.click(); return true;})()");
    await W.part.until("(document.querySelector('.screen.active')||{}).id==='scr-rt-room'", 10000, '参加者が待合へ');
    await sleep(800);
    await 撮る('B', W.host);
    await 撮る('B', W.part);
    await 撮る('B', W.part, true);
    await W.part.ev("(function(){var d=document.getElementById('rtInvite'); if(d) d.open=false; return true;})()");
    // C：進行役がゲームを選び直す（2回目の待合と同じ形：読んだ人の足に「✓ 準備OK」）
    await W.click(W.host, '#rtPickGameBtn');
    await W.画面は(W.host, 'scr-shelf');
    await W.設定を進める({ cassetteId: 'bakudan', 名: '爆弾解除' });
    await sleep(1200);
    if ((await W.part.screen()) === 'scr-rt-rules') { await W.part.click('#rtRulesCancelBtn').catch(() => {}); await sleep(600); }
    await 撮る('C', W.host);
    await 撮る('C', W.part);
    await 撮る('C', W.part, true);
  } catch (e) {
    結果.失敗 = String(e && e.stack || e);
    console.error(結果.失敗);
  } finally {
    await W.片付ける();
    if (server) server.kill();
  }
  fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify(結果, null, 2));
  process.exit(結果.失敗 ? 1 : 0);
})();
