#!/usr/bin/env node
// tools/big-census.js — 大画面（TV）を、人数を変えて最後まで通しながら撮って測る（指示64 着手前の確かめ1）
//
//   node tools/big-census.js bakudan --players 16 --port 3901 --cdp 9601
//
// 通し方は tools/flow-walk.js の台本（tools/flow-walk/<id>.js）をそのまま使い、bot の数だけ増やす
//（人数＝進行役＋参加者＋bot。4人＝bot 2、8人＝bot 6、16人＝bot 14）。
// 大画面の中身が変わるたびに（画面id＋段階の文字＋主役の文字＋名簿の数）、
// **1280×720 と 1920×1080 の両方**で次を測り、撮る：
//   巻き … ページが縦に巻けるか（scrollHeight と clientHeight。落とし穴28：同じ物差しで比べる）
//           ／中の箱が縦に巻けるか（overflow auto/scroll で scrollHeight > clientHeight）
//   切れ … 見えている文字・ボタン・行のうち、画面の外へ出ている／先祖の overflow:hidden で切られているもの
//   字   … 見えている文字のうち、正本§11-5 の下限（1280×720 で本文28px。1920×1080 は 1.5倍の 42px）より小さいもの
//   目立つ … 大画面でいちばん大きいボタン（面積）と、その文字
// 出力：docs/監査_大画面の画像/<id>_<人数>/（画像と 記録.json。git に入れない）

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const id = argv[0];
const 人数 = parseInt(arg('players', '4'), 10);
const PORT = String(arg('port', '3901'));
const CDP = parseInt(arg('cdp', '9601'), 10);
const BASE = 'http://localhost:' + PORT;
const OUT = path.join(__dirname, '..', 'docs', '監査_大画面の画像', id + '_' + 人数);
const 大きさ = [[1280, 720], [1920, 1080]];

// 測る式は tools/big-lab.js と共有する（写さない・落とし穴1）。中身は tools/big-measure.js
const { 測る } = require('./big-measure');
// ページの名簿・一枚看板の測り直し（bigReflowSoon・150ms）が残っている間も、まだ落ち着いていない
const 動き中 = "(!!window.__bigReflowPending) || document.getAnimations().some(function(a){ if(a.playState!=='running') return false; var t=a.effect&&a.effect.getComputedTiming&&a.effect.getComputedTiming(); return !!t && isFinite(t.endTime); })";

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter((f) => /\.(jpg|json)$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    const log = fs.openSync(path.join(require('os').tmpdir(), 'big-census-' + PORT + '.log'), 'w');
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: ['ignore', log, log] });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
  }
  const scenario = require(path.join(__dirname, 'flow-walk', id + '.js'));
  const W = makeWalk({ cassette: id, base: BASE, out: path.join(OUT, 'walk'), cdp: CDP, bots: Math.max(0, 人数 - 2) });
  W.idleMs = 5000;
  const 記録 = [];
  let 止める = false, 失敗 = null, 番 = 0, 前の鍵 = null;
  const 見回り = async () => {
    while (!止める) {
      const big = W.devices().大画面;
      if (big) {
        try {
          const m = await big.ev(測る);
          if (m) {
            const 鍵 = [m.画面, m.class.replace(/\s*(active|scr-in-\w+)\s*/g, ' '), m.段階, m.主役, m.名簿の数].join('|');
            if (鍵 !== 前の鍵) {
              前の鍵 = 鍵;
              番++;
              const rec = { 番, 手順: W.手順.length, 鍵, 測り: {} };
              for (const [w, h] of 大きさ) {
                await big.raw('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
                await sleep(350);
                // 終わりのある動き（演出）が走っている間は測らない——実験台（big-lab.js）と同じく、落ち着いた版組みを測る。
                // 名簿の行の「当たった」演出（fx-hit・1.09倍）の最中の1コマで、端の札の縁が「切れ」に数えられていた（指示64）
                for (let i = 0; i < 20 && await big.ev(動き中).catch(() => false); i++) await sleep(100);
                rec.測り[w + 'x' + h] = await big.ev(測る);
                const f = String(番).padStart(3, '0') + '_' + w + '.jpg';
                await big.shot(path.join(OUT, f));
                rec.測り[w + 'x' + h].画像 = f;
              }
              await big.raw('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
              記録.push(rec);
              const a = rec.測り['1280x720'], b = rec.測り['1920x1080'];
              console.log('  [大画面 ' + 番 + '] ' + a.画面 + ' ' + (a.段階 || '') + ' ／ 巻き ' + a.ページの巻き + '・' + b.ページの巻き + ' 箱' + a.箱の巻き.length +
                ' ／ 切れ ' + a.切れの数 + '・' + b.切れの数 + ' ／ 小さい字 ' + a.小さいの数 + '・' + b.小さいの数 + ' ／ 演出で除いた ' + a.演出で除いた + '・' + b.演出で除いた + ' ／ 一番大きいボタン「' + ((a.いちばん大きいボタン || {}).文字 || '') + '」');
            }
          }
        } catch (e) {}
      }
      await sleep(900);
    }
  };
  try {
    await W.始める(scenario.端末);
    const loop = 見回り();
    try { await scenario.run(W); } catch (e) { 失敗 = String(e && e.stack || e); console.error('失敗：' + 失敗.split('\n')[0]); }
    await sleep(2500);
    止める = true;
    await loop;
  } finally {
    fs.writeFileSync(path.join(OUT, '記録.json'), JSON.stringify({ カセット: id, 人数, 失敗, 記録 }, null, 1));
    await W.片付ける();
    if (server) { try { server.kill(); } catch (e) {} }
    console.log(id + ' ' + 人数 + '人：大画面の状態 ' + 記録.length + (失敗 ? ' ／ 途中で止まった' : ''));
    process.exit(失敗 ? 1 : 0);
  }
})();
