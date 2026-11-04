#!/usr/bin/env node
// tools/haichi-rollback.js — 配置づくりで「直した所が勝手にもどらないか」を、本物の Chrome 2つで確かめる（指示72 の 3）
//
//   node tools/haichi-rollback.js [--port 3022] [--page 別のページ.html]
//   --page：haichi/haichi.html のかわりに、そのページを出す（置きかえる前で赤・あとで緑を見るため）
//
// 中身は docs/指示72/見本_巻き戻りの確かめ.js（Claude チャットの見本・playwright）と同じ確かめを、tools/cdp.js で写した物
// （このリポジトリに playwright は入れていない）。(b) は見本サーバーだけの道（/__slowget）を使うので、見本と同じく飛ばす。
//   (a) 1つ動かして、すぐ次の机をゆっくり（4秒）動かす → 動かしている間に保存先の答えが来ても、手元でも保存先でももどらない
//   (c) 2人が同じ案の別の机を、同じ時に動かす → 保存先に両方の直しがあり、2人の画面が同じ
//   (d) A がメモを書き、B が同じ案で机を動かす（ほぼ同時）→ メモと机の両方が残り、B の画面にもメモ
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
const PORT = Number(arg('port', 3022));
const PAGE = arg('page', null);

// いまの並び（くまくんの図）と同じ19台（見本と同じ）
const T = [['d1','long',100,148,3],['d2','long',100,293,3],['d3','long',100,438,3],['d4','long',100,583,3],['d5','long',100,728,3],['d6','long',344,148,3],['d7','long',344,293,3],['d8','long',344,438,3],['d9','long',344,583,3],['d10','long',344,728,3],['d11','long',582,148,3],['d12','long',582,293,3],['d13','long',582,438,3],['d14','long',582,583,2],['d15','short',796,148,3],['d16','long',826,293,4],['d17','long',826,438,4],['d18','long',826,583,3],['d19','small',896.5,227.5,0]];
const fresh = (name) => ({ name, order: 900, updated: Date.now(), memo: '', lock: false, desks: T.map(([id, kind, cx, cy, ch]) => ({ id, kind, cx, cy, rot: kind === 'small' ? 90 : 0, chairs: ch, side: 'front', tags: [], unused: false })), items: [], tv: { tv1: [], tv2: [] }, strokes: [] });

(async function main() {
  const KEY = crypto.randomBytes(24).toString('hex');
  const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haichi-rb-')), 'h.db'));
  const app = express();
  if (PAGE) app.get('/haichi', (req, res, next) => (req.query.key === KEY ? res.set({ 'cache-control': 'no-store' }).type('html').send(fs.readFileSync(PAGE)) : next()));
  mountHaichi(app, { db, key: KEY });
  const server = await new Promise((r) => { const s = http.createServer(app).listen(PORT, '127.0.0.1', () => r(s)); });
  const BASE = 'http://127.0.0.1:' + PORT, Q = 'key=' + KEY, H = { 'content-type': 'application/json', 'x-haichi-v': '2' };
  const PID = 'zz-check-' + Date.now().toString(36);
  const put = (id, data) => fetch(`${BASE}/api/haichi/plans/${id}?${Q}`, { method: 'PUT', headers: H, body: JSON.stringify({ data }) });
  const del = (id) => fetch(`${BASE}/api/haichi/plans/${id}?${Q}`, { method: 'DELETE', headers: H });
  const onServer = async () => { const j = await (await fetch(`${BASE}/api/haichi/plans?${Q}&since=-1`)).json(); return (j.plans.find((p) => p.id === PID) || {}).data; };
  const desk = (plan, id) => plan.desks.find((d) => d.id === id);
  const res = [];
  const check = (name, cond, extra) => { res.push(!!cond); console.log((cond ? 'OK  ' : 'NG  ') + name + (extra != null ? '  ' + extra : '')); };
  const browsers = [];
  const devs = [];
  let exit = 1;
  try {
    const r0 = await put(PID, fresh('確かめ用（消してよい）'));
    if (!r0.ok) throw new Error('確かめ用の案を作れません ' + r0.status);
    const open = async (name, port) => {
      const br = await launch({ port }); browsers.push(br);
      const d = await br.newDevice(name, { width: 1440, height: 900 }); devs.push(d);
      await d.go(`${BASE}/haichi?${Q}`);
      await sleep(3500);
      await d.click(`.tab[data-plan="${PID}"]`); await sleep(200);
      await d.click('#fitRoom'); await sleep(200);
      return d;
    };
    const tr = (d, id) => d.ev(`(document.querySelector('g.desk[data-id="${id}"]') || { getAttribute: () => null }).getAttribute('transform')`);
    // 机の左端から 8px・高さのまん中をつかんで、ms かけて dx・dy 動かす（見本の drag と同じ）
    const drag = async (d, id, dx, dy, ms = 400) => {
      const bb = await d.ev(`(function(){ var r = document.querySelector('g.desk[data-id="${id}"] > rect').getBoundingClientRect(); return { x: r.left, y: r.top, h: r.height }; })()`);
      const x = bb.x + 8, y = bb.y + bb.h / 2, n = Math.max(4, Math.round(ms / 50));
      const m = (type, px, py, buttons) => d.cdp('Input.dispatchMouseEvent', { type, x: px, y: py, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      await m('mouseMoved', x, y, 0); await m('mousePressed', x, y, 1);
      for (let i = 1; i <= n; i++) { await m('mouseMoved', x + dx * i / n, y + dy * i / n, 1); await sleep(ms / n); }
      await m('mouseReleased', x + dx, y + dy, 0);
      await sleep(100);
    };
    const A = await open('A', 9343);
    // (a)
    await drag(A, 'd3', 60, 0); await sleep(1200);
    const t0 = await tr(A, 'd8'); await drag(A, 'd8', 60, 0, 4000); const t1 = await tr(A, 'd8'); await sleep(5000); const t2 = await tr(A, 'd8');
    let s = await onServer();
    check('(a) 続けて動かした机が、手元でもどらない', t2 === t1 && t1 !== t0, `${t0} → ${t1} → ${t2}`);
    check('(a) 保存先にも、動かした場所', desk(s, 'd8').cx !== 344 && desk(s, 'd3').cx !== 100, `d3.cx=${desk(s, 'd3').cx} d8.cx=${desk(s, 'd8').cx}`);
    console.log('--  (b) は見本サーバーだけ（飛ばした）');
    const B = await open('B', 9344);
    // (c)
    s = await onServer(); const c4 = desk(s, 'd4').cx, c9 = desk(s, 'd9').cx;
    await Promise.all([drag(A, 'd4', 60, 0, 300), drag(B, 'd9', 60, 0, 300)]); await sleep(7000);
    s = await onServer();
    check('(c) 保存先に、2人の直しが両方ある', desk(s, 'd4').cx !== c4 && desk(s, 'd9').cx !== c9, `d4 ${c4}→${desk(s, 'd4').cx} / d9 ${c9}→${desk(s, 'd9').cx}`);
    check('(c) 2人の画面が同じ', (await tr(A, 'd4')) === (await tr(B, 'd4')) && (await tr(A, 'd9')) === (await tr(B, 'd9')));
    // (d) A がメモを書く（1字ずつ・見本は60ms ごと）、B が机を動かす
    const c10 = desk(s, 'd10').cx;
    await Promise.all([(async () => {
      await A.tap('#memo');
      for (const ch of 'Aのメモ') { await A.cdp('Input.insertText', { text: ch }); await sleep(60); }
      await A.tap('#status');
    })(), drag(B, 'd10', 60, 0, 300)]);
    await sleep(7000);
    s = await onServer();
    check('(d) メモと机の両方が残る', /Aのメモ/.test(s.memo) && desk(s, 'd10').cx !== c10, `memo=${JSON.stringify(s.memo)} d10 ${c10}→${desk(s, 'd10').cx}`);
    check('(d) B の画面にもメモ', /Aのメモ/.test(await B.ev("document.getElementById('memo').value")));
    const errs = [].concat(...devs.map((d) => d.logs));
    console.log('errs', JSON.stringify(errs));
    exit = res.every(Boolean) && !errs.length ? 0 : 1;
  } catch (e) {
    console.log('止まった：' + (e && e.message));
  } finally {
    try { await del(PID); } catch (e) {}
    for (const b of browsers) { try { await b.close(); } catch (e) {} }
    server.close();
  }
  console.log(exit === 0 ? 'ALL OK' : 'SOME NG');
  process.exit(exit);
})();
