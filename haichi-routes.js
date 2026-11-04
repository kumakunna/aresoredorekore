// haichi-routes.js — 文化祭の「配置づくり」を、あつまれのサーバーにのせる（指示70）
//
//   GET    /haichi?key=…                      … 合い言葉が合えば haichi/haichi.html（Claude チャットが作ったページ・中身は直さない）。ちがえば 403 の短いページ
//   GET    /api/haichi/plans?key=…&since=数   … { rev, plans }。since が今の rev と同じなら plans: null
//   PUT    /api/haichi/plans/:id?key=…        … 本文 { data } でその案を置きかえる。rev が1つ上がる
//   DELETE /api/haichi/plans/:id?key=…        … その案を消す。rev が1つ上がる
// 道の形・答えの形・エラーの番号は docs/指示70/見本_サーバーの道.js と同じ（ページがこの形で話す）。
// 見本とちがうのは1つだけ：data が null の時も 400 no data にする（見本は null を通して入れてしまう）。
//
// 入れるかどうかは合い言葉だけ（ログインは無い・くまくんの決め 11/04）。合い言葉は .env の HAICHI_KEY（16字以上）。
// **合い言葉は、コード・docs・git・ログに書かない。**無い・短い時は、だれも開けない（閉じたまま）。
// 比べる時は、かかる時間から中身が分からない比べ方（ハッシュをそろえて crypto.timingSafeEqual）。
// **server.js では express.json（100KB まで）より前につなぐ。**後ろだと 100KB をこえる案（300KB まで置ける）が道に届く前に断られる。

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createHaichiStore } = require('./haichi-store');

const HAICHI_HTML = path.join(__dirname, 'haichi', 'haichi.html');
const MAX_BODY = 300000;   // バイト
const KEY_MIN = 16;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DENIED_PAGE = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>開けません</title></head>' +
  '<body style="font-family:system-ui,sans-serif;padding:24px"><p>この URL では開けません</p></body></html>';

function mountHaichi(app, opts) {
  const o = opts || {};
  const store = o.store || createHaichiStore(o.db);
  const real = String((o.key !== undefined ? o.key : process.env.HAICHI_KEY) || '');
  const open = real.length >= KEY_MIN;
  const realHash = crypto.createHash('sha256').update(real).digest();
  if (!open) console.warn('[haichi] .env に HAICHI_KEY（16字以上）が無いので、配置づくりは閉じています');
  /** 合い言葉が合うか（長さがちがっても、比べる時間は同じ） */
  function keyOk(given) {
    if (!open || typeof given !== 'string') return false;
    return crypto.timingSafeEqual(crypto.createHash('sha256').update(given).digest(), realHash);
  }
  function send(res, code, body, type) {
    res.status(code).set({ 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  app.get('/haichi', (req, res) => {
    // ページは書体をほかのサイト（Google Fonts）から読む。URL（合い言葉）をそこへ送らない
    res.set('referrer-policy', 'no-referrer');
    if (!keyOk(req.query.key)) return send(res, 403, DENIED_PAGE, 'text/html; charset=utf-8');
    send(res, 200, fs.readFileSync(HAICHI_HTML), 'text/html; charset=utf-8');
  });

  app.use('/api/haichi', (req, res) => {
    const pathname = String(req.originalUrl || '').split('?')[0];
    if (!pathname.startsWith('/api/haichi/plans')) return send(res, 404, { error: 'not found' });
    if (!keyOk(req.query.key)) return send(res, 403, { error: 'denied' });
    let id;
    try { id = decodeURIComponent(pathname.slice('/api/haichi/plans/'.length)); } catch (e) { return send(res, 400, { error: 'bad id' }); }
    if (req.method === 'GET' && !id && (pathname === '/api/haichi/plans' || pathname === '/api/haichi/plans/')) {
      const since = Number(req.query.since === undefined ? null : req.query.since);   // 見本と同じ：無い時は 0
      const rev = store.rev();
      if (since === rev) return send(res, 200, { rev, plans: null });
      return send(res, 200, { rev, plans: store.list() });
    }
    if (!ID_RE.test(id)) return send(res, 400, { error: 'bad id' });
    if (req.method === 'DELETE') return send(res, 200, Object.assign({ ok: true }, store.remove(id)));
    if (req.method === 'PUT') {
      // 本文は自分で読む（300000 バイトまで）。こえたら読み捨ててから 413（つなぎを途中で切らない）
      const chunks = []; let size = 0, over = false;
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { over = true; chunks.length = 0; } else chunks.push(c); });
      req.on('end', () => {
        if (over) return send(res, 413, { error: 'too big' });
        let j;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad json' }); }
        if (!j || typeof j.data !== 'object' || j.data === null) return send(res, 400, { error: 'no data' });
        const r = store.put(id, j.data, Date.now());
        if (r.full) return send(res, 507, { error: 'full' });
        send(res, 200, { ok: true, rev: r.rev });
      });
      req.on('error', () => { if (!res.headersSent) send(res, 400, { error: 'bad body' }); });
      return;
    }
    send(res, 405, { error: 'method' });
  });

  return { store };
}

module.exports = { mountHaichi, HAICHI_HTML, MAX_BODY };
