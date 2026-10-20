#!/usr/bin/env node
// tools/fx-census.js — 1つのカセットを、決めた設定で最後まで通し、出た演出を全部記録する（指示62-3）
//
//   node tools/fx-census.js bakudan --set 1 --port 3701 --cdp 9801
//   node tools/fx-census.js bakudan --set 3            # ③スキップ
//
// 通し方は tools/flow-walk.js の台本（tools/flow-walk/<id>.js）をそのまま使う——
// 同じ道を5つの設定で歩くので、設定ごとの違いだけが記録に残る。
// 各端末には読み込みの最初から tools/fx-recorder.js の見張りを差し込み、
// 設定（演出の速さ・光の点滅・画面の揺れ）は localStorage に置いてから開く。
// 記録は 0.4秒ごとに全端末から取り出し、そのとき進んでいた手順の番号を付けて残す。
//
// 出力：docs/監査_演出の画像/census/<id>_<set>.json（git に入れない）
// 結果のあとの放置は短く（既定 5秒）：ここで見たいのは演出で、放置の振る舞いは指示62 で見た

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { makeWalk } = require('./flow-walk');
const rec = require('./fx-recorder');
const { sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const id = argv[0];
const SET = String(arg('set', '1'));
const 設定 = rec.SETTINGS[SET];
if (!id || !設定) { console.error('使い方：node tools/fx-census.js <カセットid> --set 1..5'); process.exit(1); }
const PORT = String(arg('port', '3701'));
const CDP = parseInt(arg('cdp', '9801'), 10);
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', '監査_演出の画像', 'census');
const SHOTS = path.join(ROOT, 'docs', '監査_演出の画像', 'census-walk', id + '_' + SET);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null, up = false;
  try { up = (await fetch(BASE + '/')).ok; } catch (e) {}
  if (!up) {
    const log = fs.openSync(path.join(require('os').tmpdir(), 'fx-census-' + PORT + '.log'), 'w');
    server = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT }), stdio: ['ignore', log, log] });
    for (let i = 0; i < 60 && !up; i++) { await sleep(250); try { up = (await fetch(BASE + '/')).ok; } catch (e) {} }
    if (!up) { console.error('検証用サーバーが立ちません'); process.exit(1); }
  }
  const scenario = require(path.join(__dirname, 'flow-walk', id + '.js'));
  fs.mkdirSync(SHOTS, { recursive: true });
  const W = makeWalk({ cassette: id, base: BASE, out: SHOTS, cdp: CDP });
  W.idleMs = parseInt(arg('idle', '5'), 10) * 1000;
  const 記録 = [];
  let 止める = false, 失敗 = null;
  const t0 = Date.now();
  const 取り出す = async () => {
    const devs = W.devices();
    for (const name of Object.keys(devs)) {
      const evs = await rec.take(devs[name]);
      const 手順 = W.手順.length;
      evs.forEach((e) => { e.dev = name; e.step = 手順; 記録.push(e); });
    }
  };
  try {
    await W.始める(scenario.端末);
    for (const d of Object.values(W.devices())) await rec.attach(d, 設定.prefs);
    const 見回り = (async () => { while (!止める) { await 取り出す(); await sleep(400); } })();
    try { await scenario.run(W); } catch (e) { 失敗 = String(e && e.stack || e); console.error('失敗：' + 失敗); }
    await sleep(1500);
    止める = true;
    await 見回り;
    await 取り出す();
  } finally {
    const 手順 = W.手順.map((s) => ({ no: s.no, 誰: s.誰, 名: s.名, 経過ms: s.経過ms, 画面: s.画面 }));
    fs.writeFileSync(path.join(OUT, id + '_' + SET + '.json'), JSON.stringify({
      カセット: id, 設定: 設定.名, prefs: 設定.prefs, 失敗, かかった秒: Math.round((Date.now() - t0) / 1000),
      手順, 記録 }, null, 0));
    await W.片付ける();
    if (server) { try { server.kill(); } catch (e) {} }
    console.log(id + ' ' + 設定.名 + '：記録 ' + 記録.length + '件 ／ 手順 ' + 手順.length + (失敗 ? ' ／ 途中で止まった' : ''));
    process.exit(失敗 ? 1 : 0);
  }
})();
