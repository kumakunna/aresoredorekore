#!/usr/bin/env node
// tools/probe-e2e.js — スマホのエラーがサーバーに残るかを、本物の Chrome と本物のサーバーで確かめる（11/7 の検査の準備 7）
//
//   node tools/probe-e2e.js            … PROBE=err,lag と、PROBE なし（本番の形）の2回、検証用サーバーを立てて確かめる
//   --port 3322  --cdp 9722
//
// /fes を開き、ページの中でわざとエラー（throw）と、受け取られない失敗（Promise.reject）を起こす。
// PROBE あり：data/probe の今日のファイルに、その2つが（同じものは1回だけ）残る。名前や部屋のコードは残らない。
// PROBE なし：何も送らない（ページから /api/probe へのリクエストが0）。記録は一時フォルダに書かせて、手元の data/ は汚さない。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const PORT = +arg('port', 3322), CDP = +arg('cdp', 9722);

async function server(env) {
  const child = spawn(process.execPath, [path.join(__dirname, 'dev-server.js')], { env: Object.assign({}, process.env, { PORT: PORT }, env), stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await fetch('http://localhost:' + PORT + '/')).ok; } catch (e) {} }
  if (!up) { child.kill(); throw new Error('サーバーが立ちません'); }
  return child;
}

async function once(label, env, dir) {
  const child = await server(env);
  const b = await launch({ port: CDP });
  const res = { label, sent: 0, rows: [] };
  try {
    const d = await b.newDevice('スマホ', { width: 390, height: 844, mobile: true });
    await d.cdp('Network.enable');
    // 中身を送る POST だけ数える（入っているかを聞く GET /api/probe/flags は、切なら 404 で、何も送っていない）
    d.onEvent((m) => { if (m.method === 'Network.requestWillBeSent' && m.params.request.method === 'POST' && /\/api\/probe\//.test(m.params.request.url)) res.sent++; });
    await d.go('http://localhost:' + PORT + '/fes?room=TST999');
    await sleep(2500);   // つながって app:version が届くまで
    await d.ev("(function(){ setTimeout(function(){ throw new Error('probe-e2e わざとのエラー'); }, 0); setTimeout(function(){ throw new Error('probe-e2e わざとのエラー'); }, 10); Promise.reject(new Error('probe-e2e わざとの失敗')); return 1; })()");
    await sleep(2500);
    const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const f = path.join(dir, 'errors-' + day + '.jsonl');
    if (fs.existsSync(f)) res.rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => /probe-e2e/.test(r.msg));
  } finally { await b.close(); child.kill(); await sleep(500); }
  return res;
}

(async () => {
  const dirOn = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-on-'));
  const dirOff = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-off-'));
  const on = await once('PROBE=err,lag', { PROBE: 'err,lag', PROBE_DIR: dirOn }, dirOn);
  const off = await once('PROBE なし', { PROBE: '', PROBE_DIR: dirOff }, dirOff);
  console.log(on.label + '：送った ' + on.sent + ' 回・残った ' + on.rows.length + ' 行');
  on.rows.forEach((r) => console.log('  ' + r.kind + '｜' + r.msg + '｜' + r.src + ':' + r.line + '｜画面 ' + r.scr + '｜' + r.role + '｜n=' + r.n + '｜' + String(r.ua).slice(0, 40)));
  console.log(off.label + '：送った ' + off.sent + ' 回・残った ' + off.rows.length + ' 行');
  const leak = on.rows.some((r) => /TST999/.test(JSON.stringify(r)));
  const ok = on.rows.length === 2 && on.rows.some((r) => r.kind === 'error') && on.rows.some((r) => r.kind === 'rejection') && !leak && off.sent === 0 && off.rows.length === 0;
  console.log((ok ? '✔' : '✖') + ' 入れた時だけ・同じエラーは1回・部屋のコードは残らない' + (leak ? '（部屋のコードが残った）' : ''));
  process.exitCode = ok ? 0 : 1;
})().catch((e) => { console.error(e); process.exit(2); });
