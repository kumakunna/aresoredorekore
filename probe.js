// probe.js — 検査のための記録（11/7 の検査の準備 7・6）。**はっきり入れた時だけ動く**
//
//   PROBE=err      … スマホと TV の JavaScript のエラーを受け取って残す（7）
//   PROBE=lag      … 知らせの遅れ（サーバーが出した→受け取った→画面に出た）を受け取って残す（6）
//   PROBE=err,lag  … 両方
// 本番の .env に PROBE が無ければ、何も受け取らない・何も残さない（道は 404・端末も何も送らない）。
// tools/dev-server.js（手元の検証用）は、PROBE が無ければ err,lag で立てる。
//
// 残す所：data/probe/errors-YYYY-MM-DD.jsonl・lag-YYYY-MM-DD.jsonl（data/ は git に入れない）。読むのは tools/probe-report.js。
// **名前など個人の情報は入れない**：受け取るのは決めた欄だけ（ほかの欄は捨てる）・字の長さも切る・URL の ? から後ろは捨てる。
// 1つの IP から1分に送れる数と、1日のファイルの大きさに上限がある（いたずらや、こわれた端末の連打でディスクを埋めない）。

const fs = require('fs');
const path = require('path');

const KINDS = ['err', 'lag'];
// perMin：学校では全部の端末が1つの IP（NAT）に見える。16台＋TV が5秒ごとに遅れを送ると 1分に約200回なので、600 にしてある
const LIMIT = { perMin: 600, fileBytes: 20 * 1024 * 1024, lagBatch: 200 };

function parseModes(v) {
  const want = String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  const on = {};
  KINDS.forEach((k) => { on[k] = want.indexOf(k) !== -1 || want.indexOf('all') !== -1; });
  return on;
}
const cut = (s, n) => (s == null ? null : String(s).slice(0, n));
/** URL は道だけ（? と # から後ろは捨てる：部屋のコードや key を残さない） */
const pathOnly = (u) => (u == null ? null : String(u).replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0].slice(0, 120));
const day = (t) => new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);   // 日本の日付でファイルを分ける

/** エラー1件。受け取った物から、決めた欄だけを写す */
function cleanError(b) {
  b = b || {};
  return {
    msg: cut(b.msg, 300), src: pathOnly(b.src), line: b.line | 0, col: b.col | 0,
    stack: cut(String(b.stack || '').split('\n').slice(0, 4).map((l) => l.replace(/https?:\/\/[^/\s)]+/g, '').replace(/\?[^:\s)]*/g, '')).join('\n'), 600),
    kind: b.kind === 'rejection' ? 'rejection' : 'error',
    scr: cut(b.scr, 40), role: b.role === 'tv' ? 'tv' : b.role === 'staff' ? 'staff' : 'phone',
    ua: cut(b.ua, 200), v: cut(b.v, 12), n: Math.max(1, Math.min(999, b.n | 0)), at: Number(b.at) || null
  };
}
/** 遅れ1件（6）。数とどの場面かだけ */
function cleanLag(x) {
  x = x || {};
  const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
  return { e: cut(x.e, 24), scr: cut(x.scr, 40), ph: cut(x.ph, 16), game: cut(x.game, 16), role: x.role === 'tv' ? 'tv' : x.role === 'staff' ? 'staff' : 'phone',
    net: num(x.net), handle: num(x.handle), paint: num(x.paint), rtt: num(x.rtt), at: num(x.at) };
}

function createProbe(opts) {
  const o = opts || {};
  const on = o.on || parseModes(process.env.PROBE);
  const dir = o.dir || process.env.PROBE_DIR || path.join(__dirname, 'data', 'probe');   // PROBE_DIR：検証の道具が一時フォルダへ書かせる時
  const now = o.now || Date.now;
  const hits = new Map();   // ip -> { min, n }
  function allow(ip) {
    const m = Math.floor(now() / 60000);
    const h = hits.get(ip);
    if (!h || h.min !== m) { hits.set(ip, { min: m, n: 1 }); if (hits.size > 5000) hits.clear(); return true; }
    h.n++;
    return h.n <= LIMIT.perMin;
  }
  function append(kind, rows) {
    if (!rows.length) return 0;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, kind + '-' + day(now()) + '.jsonl');
    let size = 0; try { size = fs.statSync(file).size; } catch (e) {}
    if (size > LIMIT.fileBytes) return 0;
    const t = now();
    fs.appendFileSync(file, rows.map((r) => JSON.stringify(Object.assign({ t }, r))).join('\n') + '\n');
    return rows.length;
  }
  return {
    on,
    /** 端末に知らせる（app:version に添える）。何も入っていなければ null（送らない） */
    flags() { return on.err || on.lag ? { err: !!on.err, lag: !!on.lag } : null; },
    dir,
    /** 道をつなぐ。入っていない種類は 404 */
    mount(app) {
      // 端末が読み込んだ時に1回だけ聞く（部屋に入らない画面のエラーも送れるように）。入っていなければ 404
      app.get('/api/probe/flags', (req, res) => {
        const f = on.err || on.lag ? { err: !!on.err, lag: !!on.lag } : null;
        if (!f) return res.status(404).end();
        res.set('Cache-Control', 'no-store').json(f);
      });
      app.post('/api/probe/err', (req, res) => {
        if (!on.err) return res.status(404).end();
        if (!allow('e' + (req.ip || ''))) return res.status(429).json({ ok: false });
        const list = Array.isArray(req.body && req.body.list) ? req.body.list.slice(0, 20) : [];
        try { res.json({ ok: true, n: append('errors', list.map(cleanError)) }); }
        catch (e) { console.error('[probe] エラーの記録で例外:', e); res.status(500).json({ ok: false }); }
      });
      app.post('/api/probe/lag', (req, res) => {
        if (!on.lag) return res.status(404).end();
        if (!allow('l' + (req.ip || ''))) return res.status(429).json({ ok: false });
        const list = Array.isArray(req.body && req.body.list) ? req.body.list.slice(0, LIMIT.lagBatch) : [];
        try { res.json({ ok: true, n: append('lag', list.map(cleanLag)) }); }
        catch (e) { console.error('[probe] 遅れの記録で例外:', e); res.status(500).json({ ok: false }); }
      });
    }
  };
}

module.exports = { createProbe, parseModes, cleanError, cleanLag, LIMIT };
