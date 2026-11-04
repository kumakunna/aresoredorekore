#!/usr/bin/env node
// tools/haichi-split.js — 配置づくり（指示72 の門5）：本物の Chrome で、右の長机（いす4つ）をえらんで「2つに分ける」→ 開き直しても分けたまま
//
//   node tools/haichi-split.js [--port 3023]
//
// tools/haichi-rollback.js と同じく、道（haichi-routes.js）を使い捨ての SQLite の小さなサーバーにつなぎ、合い言葉はその場の乱数（出さない）。
// 写真は docs/監査_指示72/（git に入れない）：1 分ける前・2 分けたあと・3 開き直したあと

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
const PORT = Number(arg('port', 3023));
const OUT = path.join(__dirname, '..', 'docs', '監査_指示72');
fs.mkdirSync(OUT, { recursive: true });

const T = [['d1','long',100,148,3],['d2','long',100,293,3],['d3','long',100,438,3],['d4','long',100,583,3],['d5','long',100,728,3],['d6','long',344,148,3],['d7','long',344,293,3],['d8','long',344,438,3],['d9','long',344,583,3],['d10','long',344,728,3],['d11','long',582,148,3],['d12','long',582,293,3],['d13','long',582,438,3],['d14','long',582,583,2],['d15','short',796,148,3],['d16','long',826,293,4],['d17','long',826,438,4],['d18','long',826,583,3],['d19','small',896.5,227.5,0]];
const fresh = (name) => ({ name, order: 900, updated: Date.now(), memo: '', lock: false, desks: T.map(([id, kind, cx, cy, ch]) => ({ id, kind, cx, cy, rot: kind === 'small' ? 90 : 0, chairs: ch, side: 'front', tags: [], unused: false })), items: [], tv: { tv1: [], tv2: [] }, strokes: [] });

(async function main() {
  const KEY = crypto.randomBytes(24).toString('hex');
  const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'haichi-split-')), 'h.db'));
  const app = express();
  mountHaichi(app, { db, key: KEY });
  const server = await new Promise((r) => { const s = http.createServer(app).listen(PORT, '127.0.0.1', () => r(s)); });
  const BASE = 'http://127.0.0.1:' + PORT, Q = 'key=' + KEY;
  const PID = 'zz-split-' + Date.now().toString(36);
  const onServer = async () => { const j = await (await fetch(`${BASE}/api/haichi/plans?${Q}&since=-1`)).json(); return (j.plans.find((p) => p.id === PID) || {}).data; };
  let br = null, ok = false;
  const 記録 = {};
  try {
    const r0 = await fetch(`${BASE}/api/haichi/plans/${PID}?${Q}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-haichi-v': '2' }, body: JSON.stringify({ data: fresh('分ける確かめ（消してよい）') }) });
    if (!r0.ok) throw new Error('確かめ用の案を作れません ' + r0.status);
    br = await launch({ port: 9345 });
    const d = await br.newDevice('係', { width: 1440, height: 900 });
    const 開く = async () => { await d.go(`${BASE}/haichi?${Q}`); await sleep(3500); await d.click(`.tab[data-plan="${PID}"]`); await sleep(300); await d.click('#fitRoom'); await sleep(300); };
    const 机 = () => d.ev("[...document.querySelectorAll('g.desk')].map(function(g){ return g.getAttribute('data-id'); }).filter(function(x){ return /^d1[67]/.test(x); }).join(',')");
    await 開く();
    記録.分ける前 = await 机();
    await d.shot(path.join(OUT, '1-分ける前.png'));
    // 右の長机 d16 を本物のクリックでえらぶ
    const c = await d.ev("(function(){ var r = document.querySelector('g.desk[data-id=\"d16\"] > rect').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await d.tapAt(c.x, c.y); await sleep(400);
    記録.ボタン = await d.ev("(document.querySelector('[data-act=\"split\"]') || {}).textContent || null");
    await d.tap('[data-act="split"]'); await sleep(500);
    記録.分けたあと = await 机();
    await d.shot(path.join(OUT, '2-分けたあと.png'));
    await sleep(4000);   // 保存先へ送り終わるまで
    await 開く();
    記録.開き直したあと = await 机();
    const s = await onServer();
    記録.保存先 = s.desks.filter((x) => /^d1[67]/.test(x.id)).map((x) => x.id + ':' + x.kind + ':' + x.chairs).join(',');
    await d.shot(path.join(OUT, '3-開き直したあと.png'));
    記録.例外 = d.logs;
    ok = /d16a/.test(記録.開き直したあと) && /d16b/.test(記録.開き直したあと) && !/d16(,|$)/.test(記録.開き直したあと) && /d16a:half/.test(記録.保存先) && /d16b:half/.test(記録.保存先) && !d.logs.length;
  } catch (e) {
    記録.止まった = String(e && e.message);
  } finally {
    try { await fetch(`${BASE}/api/haichi/plans/${PID}?${Q}`, { method: 'DELETE', headers: { 'x-haichi-v': '2' } }); } catch (e) {}
    if (br) { try { await br.close(); } catch (e) {} }
    server.close();
  }
  console.log(JSON.stringify(記録, null, 1));
  console.log(ok ? '✔ 2つに分けた机が、開き直しても分けたまま（保存先も）' : '✖ 記録を見てください');
  process.exit(ok ? 0 : 1);
})();
