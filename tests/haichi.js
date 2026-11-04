// tests/haichi.js — 文化祭の「配置づくり」をあつまれのサーバーにのせる（指示70）。本物の express に道をつけて、HTTP で回す
//
// 門1（合い言葉が合う時だけ）・門2（答えの形が見本 docs/指示70/見本_サーバーの道.js と同じ）・
// 門3（413・507・400）・門4（作り直しても残る）・門8（合い言葉がログに出ない）
// server.js と同じく、配置づくりの道は express.json（100KB まで）より前につなぐ——後ろだと 100KB をこえる案が道に届く前に断られる
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const { createRunner, assert, assertEqual } = require('./harness');
const { mountHaichi, HAICHI_HTML } = require('../haichi-routes');

const KEY = 'TEST-haichi-0123456789abcdef';   // 検査だけの合い言葉（本物は .env の HAICHI_KEY だけ）
const 出た = [];
['log', 'warn', 'error'].forEach((k) => { const o = console[k]; console[k] = (...a) => { 出た.push(a.map(String).join(' ')); o.apply(console, a); }; });

function start(o) {
  const opt = o || {};
  const app = express();
  const db = opt.db || new Database(':memory:');
  mountHaichi(app, { db, key: opt.key !== undefined ? opt.key : KEY });
  app.use(express.json());   // server.js と同じ並び（配置づくりの道のあと）
  app.post('/other', (req, res) => res.json({ ok: true }));
  const srv = http.createServer(app);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + srv.address().port;
    r({ url, db, close: () => new Promise((z) => srv.close(() => z())) });
  }));
}
const k = (extra) => '?key=' + encodeURIComponent(KEY) + (extra || '');
// 指示72：新しいページは全部の道に x-haichi-v: 2 を付けて送る。PUT・DELETE は、それが無い（古いページ）と 409。
// ここの検査は新しいページのつもりで付ける。v に null を渡すと付けない・数を渡すとその数（古いページのつもり）
async function call(s, method, p, body, raw, v) {
  const h = body !== undefined ? { 'content-type': 'application/json' } : {};
  if ((method === 'PUT' || method === 'DELETE') && v !== null) h['x-haichi-v'] = String(v === undefined ? 2 : v);
  const r = await fetch(s.url + p, { method, headers: h, body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, json, text, headers: r.headers };
}

(async function main() {
  const r = createRunner('haichi：配置づくりをあつまれのサーバーへ（指示70）');

  await r.test('門1：合い言葉が合う時だけページが開く（無い・ちがう時は 403 の短いページ）。ページは置いた物そのまま・保存しない・リファラーを送らない', async () => {
    const s = await start();
    try {
      for (const q of ['', '?key=', '?key=wrong', '?key=' + KEY.slice(0, -1), '?key=' + KEY + 'x']) {
        const x = await call(s, 'GET', '/haichi' + q);
        assertEqual(x.status, 403, q + ' は 403');
        assert(x.text.indexOf('この URL では開けません') !== -1 && x.text.length < 2000, '短いページ（' + q + '）');
        assert(x.text.indexOf('HAICHI_SEED') === -1, '中身（案）を出さない');
      }
      const ok = await call(s, 'GET', '/haichi' + k());
      assertEqual(ok.status, 200, '合い言葉が合う');
      assertEqual(ok.text, fs.readFileSync(HAICHI_HTML, 'utf8'), 'ページはそのまま（中身を直さない）');
      assertEqual(ok.headers.get('cache-control'), 'no-store', '保存しない');
      assertEqual(ok.headers.get('referrer-policy'), 'no-referrer', 'ほかのサイト（書体）へ URL（合い言葉）を送らない');
    } finally { await s.close(); }
  });

  await r.test('門1：合い言葉が無い・ちがう時は、道（読む・置く・消す）が 403 {error:"denied"}。中身は変わらない', async () => {
    const s = await start();
    try {
      await call(s, 'PUT', '/api/haichi/plans/a' + k(), { data: { n: 1 } });
      for (const q of ['', '?key=', '?key=nope']) {
        for (const [m, p, b] of [['GET', '/api/haichi/plans', undefined], ['PUT', '/api/haichi/plans/a', { data: { n: 2 } }], ['DELETE', '/api/haichi/plans/a', undefined], ['PUT', '/api/haichi/plans/zz', { data: {} }]]) {
          const x = await call(s, m, p + q, b);
          assertEqual(x.status + ' ' + JSON.stringify(x.json), '403 {"error":"denied"}', m + ' ' + p + q);
        }
      }
      const g = await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'));
      assertEqual(JSON.stringify(g.json), '{"rev":1,"plans":[{"id":"a","data":{"n":1}}]}', '中身はそのまま');
    } finally { await s.close(); }
  });

  await r.test('門1：.env に合い言葉が無い・短い（16字より下）時は、だれも開けない（空の合い言葉で開けてしまわない）', async () => {
    for (const bad of ['', undefined, null, 'short-key-15chr']) {
      const s = await start({ key: bad === undefined ? '' : bad });
      try {
        for (const q of ['', '?key=', '?key=' + encodeURIComponent(String(bad))]) {
          assertEqual((await call(s, 'GET', '/haichi' + q)).status, 403, 'ページ ' + JSON.stringify(bad) + ' ' + q);
          assertEqual((await call(s, 'GET', '/api/haichi/plans' + q)).status, 403, '道 ' + JSON.stringify(bad) + ' ' + q);
        }
      } finally { await s.close(); }
    }
  });

  await r.test('門2：答えの形が見本と同じ（rev・since が同じなら plans:null・置く／消すは {ok,rev}・知らない道は 404・ほかの動きは 405）', async () => {
    const s = await start();
    try {
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'))).json), '{"rev":0,"plans":[]}', 'はじめは空');
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k())).json), '{"rev":0,"plans":null}', 'since が無い＝0 と同じ（見本と同じ）');
      assertEqual(JSON.stringify((await call(s, 'PUT', '/api/haichi/plans/p1' + k(), { data: { name: '案1', desks: [1, 2] } })).json), '{"ok":true,"rev":1}', '置く');
      assertEqual(JSON.stringify((await call(s, 'PUT', '/api/haichi/plans/p-2_x' + k(), { data: { name: 'ふたつめ' } })).json), '{"ok":true,"rev":2}', '置く（2つ目）');
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k('&since=2'))).json), '{"rev":2,"plans":null}', 'since が同じ → 中身を送らない');
      const all = (await call(s, 'GET', '/api/haichi/plans' + k('&since=1'))).json;
      assertEqual(JSON.stringify(all), '{"rev":2,"plans":[{"id":"p1","data":{"name":"案1","desks":[1,2]}},{"id":"p-2_x","data":{"name":"ふたつめ"}}]}', 'ちがえば全部');
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans/' + k('&since=0'))).json), JSON.stringify(all), '最後の / があっても同じ');
      assertEqual(JSON.stringify((await call(s, 'PUT', '/api/haichi/plans/p1' + k(), { data: { name: '案1（直した）' } })).json), '{"ok":true,"rev":3}', '置きかえる');
      assertEqual(JSON.stringify((await call(s, 'DELETE', '/api/haichi/plans/p-2_x' + k())).json), '{"ok":true,"rev":4}', '消す');
      assertEqual(JSON.stringify((await call(s, 'DELETE', '/api/haichi/plans/nothing' + k())).json), '{"ok":true,"rev":5}', '無い案を消しても ok（見本と同じ）');
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k('&since=0'))).json.plans), '[{"id":"p1","data":{"name":"案1（直した）"}}]', '残った案');
      const nf = await call(s, 'GET', '/api/haichi/other' + k());
      assertEqual(nf.status + ' ' + JSON.stringify(nf.json), '404 {"error":"not found"}', '知らない道');
      for (const [m, p] of [['POST', '/api/haichi/plans/p1'], ['GET', '/api/haichi/plans/p1'], ['PATCH', '/api/haichi/plans/p1']]) {
        const x = await call(s, m, p + k(), m === 'GET' ? undefined : { data: {} });
        assertEqual(x.status + ' ' + JSON.stringify(x.json), '405 {"error":"method"}', m + ' ' + p);
      }
      const h = await call(s, 'GET', '/api/haichi/plans' + k());
      assertEqual(h.headers.get('cache-control'), 'no-store', '道の答えも保存しない');
      assert(/application\/json/.test(h.headers.get('content-type')), 'JSON');
    } finally { await s.close(); }
  });

  await r.test('門2：本文がおかしい時は 400（JSON でない・data が無い／物でない）。中身は変わらない', async () => {
    const s = await start();
    try {
      const x1 = await call(s, 'PUT', '/api/haichi/plans/a' + k(), undefined, '{not json');
      assertEqual(x1.status + ' ' + JSON.stringify(x1.json), '400 {"error":"bad json"}', 'JSON でない');
      for (const b of [{}, { data: 1 }, { data: 'x' }, { data: null }]) {
        const x = await call(s, 'PUT', '/api/haichi/plans/a' + k(), b);
        assertEqual(x.status + ' ' + JSON.stringify(x.json), '400 {"error":"no data"}', JSON.stringify(b));
      }
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'))).json), '{"rev":0,"plans":[]}', '何も入っていない');
    } finally { await s.close(); }
  });

  await r.test('門3：300KB（300000 バイト）をこえる本文は 413。ちょうどなら置ける（ほかの道の 100KB の決まりに止められない）', async () => {
    const s = await start();
    try {
      const body = (n) => { const head = '{"data":{"s":"', tail = '"}}'; return head + 'a'.repeat(n - head.length - tail.length) + tail; };
      const ok = await call(s, 'PUT', '/api/haichi/plans/big' + k(), undefined, body(300000));
      assertEqual(ok.status + ' ' + JSON.stringify(ok.json), '200 {"ok":true,"rev":1}', 'ちょうど 300000 バイト');
      const ng = await call(s, 'PUT', '/api/haichi/plans/big2' + k(), undefined, body(300001));
      assertEqual(ng.status + ' ' + JSON.stringify(ng.json), '413 {"error":"too big"}', '300001 バイト');
      // 日本語は1字3バイト：字の数ではなくバイトで数える
      const jp = '{"data":{"s":"' + 'あ'.repeat(100001) + '"}}';
      assertEqual((await call(s, 'PUT', '/api/haichi/plans/jp' + k(), undefined, jp)).status, 413, '日本語 100001 字（約300KB をこえる）');
      assertEqual((await call(s, 'PUT', '/api/haichi/plans/huge' + k(), undefined, 'x'.repeat(5000000))).status, 413, '5MB でも 413 を返す（つなぎを切らない）');
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'))).json.plans.map((p) => p.id)), '["big"]', '入ったのは 300000 バイトの案だけ');
      assertEqual((await call(s, 'POST', '/other', { a: 1 })).status, 200, 'ほかの道はふだんどおり');
    } finally { await s.close(); }
  });

  await r.test('門3：案は60まで。61個目の新しい案は 507 {error:"full"}。60ある時も、今ある案は直せる・消せば足せる', async () => {
    const s = await start();
    try {
      for (let i = 1; i <= 60; i++) assertEqual((await call(s, 'PUT', '/api/haichi/plans/p' + i + k(), { data: { i } })).status, 200, i + '個目');
      const x = await call(s, 'PUT', '/api/haichi/plans/p61' + k(), { data: { i: 61 } });
      assertEqual(x.status + ' ' + JSON.stringify(x.json), '507 {"error":"full"}', '61個目');
      assertEqual((await call(s, 'PUT', '/api/haichi/plans/p7' + k(), { data: { i: 'seven' } })).status, 200, '今ある案は直せる');
      await call(s, 'DELETE', '/api/haichi/plans/p1' + k());
      assertEqual((await call(s, 'PUT', '/api/haichi/plans/p61' + k(), { data: { i: 61 } })).status, 200, '1つ消したら足せる');
      assertEqual((await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'))).json.plans.length, 60, '60のまま');
    } finally { await s.close(); }
  });

  await r.test('門3：id は英数字と _ - で1〜40字。ちがえば 400 {error:"bad id"}（置く・消す）', async () => {
    const s = await start();
    try {
      assertEqual((await call(s, 'PUT', '/api/haichi/plans/' + 'a'.repeat(40) + k(), { data: {} })).status, 200, '40字');
      for (const id of ['a'.repeat(41), 'a.b', 'a%2Fb', '%E3%81%82', 'a%20b', 'a%00b', '%E0%A4%A']) {
        for (const m of ['PUT', 'DELETE']) {
          const x = await call(s, m, '/api/haichi/plans/' + id + k(), m === 'PUT' ? { data: {} } : undefined);
          assertEqual(x.status + ' ' + JSON.stringify(x.json), '400 {"error":"bad id"}', m + ' ' + id);
        }
      }
      assertEqual((await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'))).json.plans.length, 1, '入ったのは40字の1つだけ');
    } finally { await s.close(); }
  });

  await r.test('門4：サーバーを作り直しても、案と rev が残る（同じ SQLite）', async () => {
    const file = path.join(os.tmpdir(), 'haichi-test-' + process.pid + '.db');
    try { fs.unlinkSync(file); } catch (e) {}
    let db = new Database(file);
    const a = await start({ db });
    await call(a, 'PUT', '/api/haichi/plans/x' + k(), { data: { name: '案X', list: [1, 2, 3] } });
    await call(a, 'PUT', '/api/haichi/plans/y' + k(), { data: { name: '案Y' } });
    await call(a, 'DELETE', '/api/haichi/plans/y' + k());
    await a.close(); db.close();
    db = new Database(file);
    const b = await start({ db });
    try {
      assertEqual(JSON.stringify((await call(b, 'GET', '/api/haichi/plans' + k('&since=-1'))).json), '{"rev":3,"plans":[{"id":"x","data":{"name":"案X","list":[1,2,3]}}]}', '残る');
      assertEqual(JSON.stringify((await call(b, 'PUT', '/api/haichi/plans/z' + k(), { data: {} })).json), '{"ok":true,"rev":4}', 'rev は続きから');
    } finally { await b.close(); db.close(); try { fs.unlinkSync(file); } catch (e) {} }
  });

  await r.test('指示72 門3・門4：見出し x-haichi-v が無い・2より小さい PUT・DELETE は 409 {error:"old page"} で、保存先の案は変わらない。見出しありはこれまでどおり（答えに rev）。GET はそのまま', async () => {
    const s = await start();
    try {
      assertEqual(JSON.stringify((await call(s, 'PUT', '/api/haichi/plans/p1' + k(), { data: { name: '新しいページの案', desks: [{ id: 'd16a' }] } })).json), '{"ok":true,"rev":1}', '見出しありの置く（rev あり）');
      const before = JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'))).json);
      for (const v of [null, 1, 0, 'x']) {
        const a = await call(s, 'PUT', '/api/haichi/plans/p1' + k(), { data: { name: '古いページで上書き' } }, undefined, v);
        assertEqual(a.status + ' ' + a.text, '409 {"error":"old page"}', '置く・見出し ' + v);
        const d = await call(s, 'DELETE', '/api/haichi/plans/p1' + k(), undefined, undefined, v);
        assertEqual(d.status + ' ' + d.text, '409 {"error":"old page"}', '消す・見出し ' + v);
      }
      assertEqual(JSON.stringify((await call(s, 'GET', '/api/haichi/plans' + k('&since=-1'))).json), before, '保存先の案も rev も変わらない');
      assertEqual((await call(s, 'GET', '/api/haichi/plans' + k('&since=1'))).status, 200, 'GET は見出しが無くてもそのまま');
      assertEqual(JSON.stringify((await call(s, 'DELETE', '/api/haichi/plans/p1' + k(), undefined, undefined, 3)).json), '{"ok":true,"rev":2}', '見出し 3 でも消せる（rev あり）');
      assertEqual((await call(s, 'PUT', '/api/haichi/plans/p1' + k('x'), { data: {} }, undefined, null)).status, 403, '合い言葉がちがえば、見出しより先に 403（古いかどうかも教えない）');
    } finally { await s.close(); }
  });

  await r.test('門8：この検査で出たログに、合い言葉が1度も無い', async () => {
    assert(!出た.some((x) => x.indexOf(KEY) !== -1 || x.indexOf(encodeURIComponent(KEY)) !== -1), 'ログに合い言葉が出た');
  });

  r.finish();
  process.exit(0);
})();
