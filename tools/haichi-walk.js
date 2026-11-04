#!/usr/bin/env node
// tools/haichi-walk.js — 配置づくり（指示70）を、本物の Chrome 2つで通して測る
//
//   node tools/haichi-walk.js [--port 3021]
//
// 見る物：門5（片方で直した案が、もう片方に6秒以内に出る）・門6（はじめて開くと12の案が入る・2回目や同時に開いても2重に入らない）
// **今ある DB にはさわらない。**道（haichi-routes.js）を、この道具だけの小さなサーバーに、使い捨ての SQLite（一時フォルダー）でつなぐ。
// 合い言葉はその場で作る乱数（どこにも書かない・出さない）。Chrome は tools/cdp.js（裏で動かす・音なし）を2つ別々に立てる（別の人のつもり）

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const Database = require('better-sqlite3');
const { launch, sleep } = require('./cdp');
const { mountHaichi } = require('../haichi-routes');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const PORT = Number(arg('port', 3021));
const OUT = path.join(__dirname, '..', 'docs', '監査_指示70', 'walk');
fs.mkdirSync(OUT, { recursive: true });
const rec = [];
const note = (k, v) => { rec.push({ t: Date.now(), k, v }); console.log('・' + k + '：' + (typeof v === 'string' ? v : JSON.stringify(v))); };

(async function main() {
  const KEY = crypto.randomBytes(24).toString('hex');
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haichi-walk-')), 'h.db');
  let db = new Database(dbFile);
  let server = null;
  const startServer = () => new Promise((r) => {
    const app = express();
    mountHaichi(app, { db, key: KEY });
    app.use(express.json());
    server = http.createServer(app).listen(PORT, '127.0.0.1', r);
  });
  const api = async (q) => (await fetch('http://127.0.0.1:' + PORT + '/api/haichi/plans?key=' + KEY + (q || '&since=-1'))).json();
  const URL = 'http://127.0.0.1:' + PORT + '/haichi?key=' + KEY;
  await startServer();
  const browsers = [];
  let ok = false;
  try {
    const A = await launch({ port: 9341 }); browsers.push(A);
    const B = await launch({ port: 9342 }); browsers.push(B);
    const a = await A.newDevice('A', { width: 1280, height: 800 });
    const b = await B.newDevice('B', { width: 1280, height: 800 });
    const plans = async () => (await api()).plans.map((p) => p.id);

    // 門6：はじめて開く（A だけ）→ 12の案
    await a.go(URL);
    const t0 = Date.now();
    let first = [];
    while (Date.now() - t0 < 15000) { first = await plans(); if (first.length >= 12) break; await sleep(200); }
    note('門6 はじめて開いた（A）→ サーバーの案', { 数: first.length, 秒: +((Date.now() - t0) / 1000).toFixed(1) });
    await sleep(4000);
    note('門6 少し待っても', { 数: (await plans()).length });
    // B を開く・A を開き直す → 増えない
    await b.go(URL);
    await a.go(URL);
    await sleep(8000);
    const after = await plans();
    note('門6 B を開き・A を開き直した後', { 数: after.length, 同じ: JSON.stringify(after) === JSON.stringify(first) });

    // 門5：A の「メモ」に書く → B に出るまで（B は同じ案を見ている）
    const memoA = await a.ev('(() => { const m = document.getElementById("memo"); return m ? m.value : null; })()');
    note('門5 はじめのメモ（A）', memoA === null ? 'メモの欄が無い' : 'あり');
    const words = 'テスト ' + Date.now().toString(36);
    const tIn = Date.now();
    await a.ev('(() => { const m = document.getElementById("memo"); m.focus(); m.value = ' + JSON.stringify(words) + '; m.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');
    let seen = null;
    while (Date.now() - tIn < 15000) {
      const v = await b.ev('(document.getElementById("memo") || {}).value');
      if (v === words) { seen = Date.now() - tIn; break; }
      await sleep(100);
    }
    note('門5 A で直した → B に出るまで（ms）', seen === null ? '15秒たっても出ない' : seen);
    // A のメモの欄から手をはなす（書いている途中の欄は、ページが上書きしない作り）
    await a.ev('(() => { document.getElementById("memo").blur(); return true; })()');
    await b.ev('(() => { document.getElementById("memo").blur(); return true; })()');
    const tIn2 = Date.now();
    const words2 = words + '（B から）';
    await b.ev('(() => { const m = document.getElementById("memo"); m.focus(); m.value = ' + JSON.stringify(words2) + '; m.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');
    let seen2 = null;
    while (Date.now() - tIn2 < 15000) {
      const v = await a.ev('(document.getElementById("memo") || {}).value');
      if (v === words2) { seen2 = Date.now() - tIn2; break; }
      await sleep(100);
    }
    note('門5 B で直した → A に出るまで（ms）', seen2 === null ? '15秒たっても出ない' : seen2);
    note('状態の字（A）', await a.ev('(document.getElementById("status") || {}).textContent'));

    // 門4（本物のページで）：サーバーを作り直す → ページが自分でつなぎ直し、案はそのまま
    server.close(); db.close();
    await sleep(4000);
    note('サーバーが止まっている間の字（A・直す前）', await a.ev('(document.getElementById("status") || {}).textContent'));
    const words3 = words2 + '（止まっている間に A）';
    await a.ev('(() => { const m = document.getElementById("memo"); m.focus(); m.value = ' + JSON.stringify(words3) + '; m.dispatchEvent(new Event("input", { bubbles: true })); m.blur(); return true; })()');
    await sleep(12000);
    note('サーバーが止まっている間に直した（A）の字・12秒後', await a.ev('(document.getElementById("status") || {}).textContent'));
    db = new Database(dbFile);
    await startServer();
    await sleep(7000);
    note('サーバーをもどした後', { 案の数: (await plans()).length, メモ: ((await api()).plans.find((p) => String(p.data.memo || '').indexOf(words) === 0) || { data: {} }).data.memo === words3 ? '止まっている間に直した分も届いた' : '届いていない', 字: await a.ev('(document.getElementById("status") || {}).textContent') });

    // ページの作りの確かめ（直さない・報告するだけ）：止まっている間に直した分は、ほかの人の変更が届いた時にどうなるか
    const other = (await api()).plans.find((p) => String(p.data.memo || '').indexOf(words) !== 0);
    await fetch('http://127.0.0.1:' + PORT + '/api/haichi/plans/' + other.id + '?key=' + KEY, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: Object.assign({}, other.data, { memo: 'ほかの人' }) }) });
    await sleep(5000);
    const memoNow = await a.ev('(document.getElementById("memo") || {}).value');
    const local = await a.ev('JSON.stringify(JSON.parse(localStorage.getItem("haichi.v1.plans") || "[]").map((p) => p.memo || ""))');
    note('ページの作り：止まっている間に A が直した分（ほかの人の変更が届いた後）', { 'A の画面のメモ': memoNow === words3 ? '残っている' : '消えた（サーバーの前の字にもどった）', 'A のブラウザの保存': local.indexOf(words3) !== -1 ? '残っている' : '消えた', サーバー: ((await api()).plans.find((p) => String(p.data.memo || '').indexOf(words) === 0) || { data: {} }).data.memo === words3 ? '届いた' : '届いていない' });
    // 門6：まっさらから2人が同時に開く → 12のまま
    db.prepare('DELETE FROM haichi_plans').run();
    db.prepare('UPDATE haichi_rev SET rev = rev + 1').run();
    const c = await A.newDevice('C', { width: 1280, height: 800 });
    const d = await B.newDevice('D', { width: 1280, height: 800 });
    await Promise.all([c.go(URL), d.go(URL)]);
    await sleep(10000);
    note('門6 まっさらから2人が同時に開いた', { 数: (await plans()).length });
    ok = true;
  } catch (e) {
    note('止まった', e.message);
  } finally {
    // 記録に合い言葉を入れない
    fs.writeFileSync(path.join(OUT, 'record.json'), JSON.stringify(rec, null, 1).split(KEY).join('＊＊＊'));
    for (const br of browsers) { try { await br.close(); } catch (e) {} }
    try { server.close(); } catch (e) {}
    try { db.close(); } catch (e) {}
    console.log(ok ? '通しおわり' : '通しが止まりました');
    process.exit(ok ? 0 : 1);
  }
})();
