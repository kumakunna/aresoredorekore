#!/usr/bin/env node
// tools/probe-report.js — 検査のための記録（probe.js）を読んで一覧にする（11/7 の検査の準備 7・6）
//
//   node tools/probe-report.js                 … data/probe/ の今日の分（エラーと遅れの両方）
//   node tools/probe-report.js --day 2026-11-07 --errors   … その日のエラーだけ
//   node tools/probe-report.js --lag --since 13:00 --until 13:20  … 13時から13時20分の遅れだけ（日本の時刻）
//   --dir DIR（既定 data/probe）  --json（表ではなく JSON で）
//
// 本番で読む時は、本番のサーバーの中で同じものを動かす（ssh・読むだけ）。PROBE を入れていなければ、ファイルは無い。
// エラー：同じもの（字・ファイル・行）をまとめて、何回・何台（UA）・どの画面か。
// 遅れ：知らせ（e）× 役（スマホ／TV）× ゲーム × 段ごとに、件数と 中央値・95%（net＝サーバー→受け取り、handle＝受け口、paint＝受け取り→画面）

const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const DIR = path.resolve(arg('dir', path.join(__dirname, '..', 'data', 'probe')));
const DAY = arg('day', new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10));
const ONLY_ERR = !!arg('errors', false), ONLY_LAG = !!arg('lag', false), JSON_OUT = !!arg('json', false);
const SINCE = arg('since', null), UNTIL = arg('until', null);   // 日本の時刻 HH:MM（回線を変えた区切りごとに読む）

function read(kind) {
  const f = path.join(DIR, kind + '-' + DAY + '.jsonl');
  if (!fs.existsSync(f)) return [];
  let rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  const at = (hm) => { const [h, m] = String(hm).split(':').map(Number); return Date.parse(DAY + 'T00:00:00+09:00') + ((h || 0) * 60 + (m || 0)) * 60000; };
  if (SINCE) rows = rows.filter((r) => r.t >= at(SINCE));
  if (UNTIL) rows = rows.filter((r) => r.t < at(UNTIL));
  return rows;
}
const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
const jst = (t) => new Date(t + 9 * 3600 * 1000).toISOString().slice(11, 19);
const uaShort = (ua) => /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Android/.test(ua) ? 'Android' : /Windows|Macintosh|X11/.test(ua) ? 'PC' : 'その他';

const out = { day: DAY, dir: DIR };
if (!ONLY_LAG) {
  const errs = read('errors');
  const g = new Map();
  errs.forEach((e) => {
    const k = e.msg + '|' + e.src + '|' + e.line;
    const x = g.get(k) || { msg: e.msg, src: e.src, line: e.line, kind: e.kind, n: 0, rows: 0, ua: {}, scr: {}, role: {}, first: e.t, last: e.t, stack: e.stack, v: {} };
    x.n += e.n || 1; x.rows++; x.ua[uaShort(e.ua || '')] = (x.ua[uaShort(e.ua || '')] || 0) + 1; x.scr[e.scr || '-'] = (x.scr[e.scr || '-'] || 0) + 1;
    x.role[e.role] = (x.role[e.role] || 0) + 1; x.v[e.v || '-'] = 1; x.hidden = (x.hidden || 0) + (e.vis === 'hidden' ? 1 : 0); x.off = (x.off || 0) + (e.conn === false ? 1 : 0); x.first = Math.min(x.first, e.t); x.last = Math.max(x.last, e.t);
    g.set(k, x);
  });
  out.errors = Array.from(g.values()).sort((a, b) => b.rows - a.rows);
}
if (!ONLY_ERR) {
  const lag = read('lag');
  const g = new Map();
  lag.forEach((x) => {
    const k = [x.e, x.role, x.game || '-', x.ph || '-'].join('|');
    const y = g.get(k) || { e: x.e, role: x.role, game: x.game || '-', ph: x.ph || '-', net: [], handle: [], paint: [] };
    ['net', 'handle', 'paint'].forEach((f) => { if (typeof x[f] === 'number') y[f].push(x[f]); });
    g.set(k, y);
  });
  out.lag = Array.from(g.values()).map((y) => ({ e: y.e, role: y.role, game: y.game, ph: y.ph, n: Math.max(y.net.length, y.paint.length),
    net50: q(y.net, 0.5), net95: q(y.net, 0.95), handle50: q(y.handle, 0.5), paint50: q(y.paint, 0.5), paint95: q(y.paint, 0.95), paintMax: y.paint.length ? Math.max.apply(null, y.paint) : null }))
    .sort((a, b) => (a.game + a.ph + a.e + a.role).localeCompare(b.game + b.ph + b.e + b.role));
}

if (JSON_OUT) { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
console.log('記録：' + DIR + '（' + DAY + (SINCE || UNTIL ? ' ' + (SINCE || '') + '〜' + (UNTIL || '') : '') + '）');
if (out.errors) {
  console.log('\n■ エラー ' + out.errors.length + ' 種類（' + out.errors.reduce((s, e) => s + e.rows, 0) + ' 台ぶん）');
  out.errors.forEach((e) => console.log('- ' + e.rows + '台・' + e.n + '回  ' + e.msg + '  （' + (e.src || '-') + ':' + e.line + '）\n    機種 ' + JSON.stringify(e.ua) + '・画面 ' + JSON.stringify(e.scr) + '・役 ' + JSON.stringify(e.role) +
    '・版 ' + Object.keys(e.v).join(',') + '・画面が裏 ' + (e.hidden || 0) + '・切れていた ' + (e.off || 0) + '・' + jst(e.first) + '〜' + jst(e.last) + (e.stack ? '\n    ' + String(e.stack).split('\n').slice(0, 2).join(' / ') : '')));
}
if (out.lag) {
  console.log('\n■ 遅れ（ms）　net＝サーバー→受け取り　paint＝受け取り→画面に出た');
  console.log('ゲーム | 段 | 知らせ | 役 | 件 | net 中央 | net 95% | 受け口 中央 | paint 中央 | paint 95% | paint 最大');
  out.lag.forEach((y) => console.log([y.game, y.ph, y.e, y.role, y.n, y.net50, y.net95, y.handle50, y.paint50, y.paint95, y.paintMax].join(' | ')));
}
