#!/usr/bin/env node
// tools/haichi-walk.js — 配置づくり（指示70）を、本物の Chrome 2つで通して測る
//
//   node tools/haichi-walk.js [--port 3021] [--page 別のページ.html]
//   --page：haichi/haichi.html のかわりに、そのページを出す（前の版で赤・新しい版で緑を見るため・11/04）
//
// 消えないかの3つ（11/04・見本 docs/指示70/見本_消えないかの確かめ.js）：サーバーが20秒止まっている間の直しが、もどったら届き画面からも消えない／
//   止まっている間に開き直しても届く／あとから直した人の形が残る。「止まる」は道（/api/haichi）だけが 502 を返す（nginx の後ろで、アプリを作り直している間と同じ）
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
const PAGE = arg('page', null);
const OUT = path.join(__dirname, '..', 'docs', '監査_指示70', 'walk');
fs.mkdirSync(OUT, { recursive: true });
const rec = [];
const note = (k, v) => { rec.push({ t: Date.now(), k, v }); console.log('・' + k + '：' + (typeof v === 'string' ? v : JSON.stringify(v))); };

(async function main() {
  const KEY = crypto.randomBytes(24).toString('hex');
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haichi-walk-')), 'h.db');
  let db = new Database(dbFile);
  let server = null, downUntil = 0;
  const startServer = () => new Promise((r) => {
    const app = express();
    app.use('/api/haichi', (req, res, next) => (Date.now() < downUntil ? res.status(502).end() : next()));
    if (PAGE) app.get('/haichi', (req, res, next) => (req.query.key === KEY ? res.set({ 'cache-control': 'no-store' }).type('html').send(fs.readFileSync(PAGE)) : next()));
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

    // ---- 消えないかの3つ ----
    const ids = await plans();
    const [p1, p2] = [ids[0], ids[1]];
    const memoOf = async (id) => ((await api()).plans.find((p) => p.id === id) || { data: {} }).data.memo;
    const pickP = (d, id) => d.ev('(() => { const t = document.querySelector(' + JSON.stringify('.tab[data-plan="' + id + '"]') + '); if (t) t.click(); return !!t; })()');
    const setMemo = (d, t) => d.ev('(() => { const m = document.getElementById("memo"); m.focus(); m.value = ' + JSON.stringify(t) + '; m.dispatchEvent(new Event("input", { bubbles: true })); m.blur(); return true; })()');
    const memoOn = (d) => d.ev('document.getElementById("memo").value');
    const st = (d) => d.ev('(document.getElementById("status") || {}).textContent');
    const net = (d, off) => d.cdp('Network.emulateNetworkConditions', { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const judge = [];
    const check = (name, cond, extra) => { judge.push({ name, ok: !!cond, extra }); note((cond ? 'OK ' : 'NG ') + name, extra == null ? '' : extra); };
    await pickP(a, p1); await sleep(300); await setMemo(a, 'A1'); await sleep(4500);
    check('ふつうの直しが届く', (await memoOf(p1)) === 'A1', await memoOf(p1));
    // 1) サーバーが20秒止まっている間に直す → もどったら届く。ほかの人の直しで消えない
    downUntil = Date.now() + 20000; await sleep(500);
    await setMemo(a, 'A2-止まっている間'); await sleep(12000);
    note('止まっている間の字（A）', await st(a));
    await sleep(9000);
    await pickP(b, p2); await sleep(300); await setMemo(b, 'B-もどったあと'); await sleep(8000);
    check('1 止まっていた20秒の直しが、もどったあと届く', (await memoOf(p1)) === 'A2-止まっている間', await memoOf(p1));
    check('1 A の画面からも消えていない', (await memoOn(a)) === 'A2-止まっている間', await memoOn(a));
    check('1 A の字が「保存しました」にもどる', /保存しました/.test(await st(a)), await st(a));
    // 2) 止まっている間に直して、ページを開き直す → もどったら届く
    downUntil = Date.now() + 15000; await sleep(500);
    await setMemo(a, 'A3-開き直す前'); await sleep(1500);
    await a.go(URL); await sleep(16000);
    check('2 止まっている間に開き直しても、もどったら届く', (await memoOf(p1)) === 'A3-開き直す前', await memoOf(p1));
    // 3) A だけネットが切れている間に、B があとから同じ案を直す → B の形が残る
    await pickP(a, p1); await sleep(300);
    await a.cdp('Network.enable'); await net(a, true);
    await setMemo(a, 'A4-ネットが切れた間'); await sleep(1500);
    await pickP(b, p1); await sleep(300); await setMemo(b, 'B4-あとから直した'); await sleep(4000);
    await net(a, false); await sleep(20000);
    check('3 あとから直した B の形が残る', (await memoOf(p1)) === 'B4-あとから直した', await memoOf(p1));
    check('3 A の画面も B の形になる', (await memoOn(a)) === 'B4-あとから直した', await memoOn(a));
    note('消えないかの3つ', judge.every((x) => x.ok) ? '全部 OK' : 'NG ' + judge.filter((x) => !x.ok).length + '件');
    await a.ev('(() => { document.getElementById("memo").blur(); return true; })()');

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
