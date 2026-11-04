// あつまれのサーバーに足す「配置づくり」の道（見本）。CC はこの約束どおりに、SQLite で本物を作る
const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.HAICHI_KEY || 'testkey';
const plans = new Map(); let rev = 0;
const html = fs.readFileSync(path.join(__dirname, '../dist/haichi-server.html'));
function send(res, code, body, type) { res.writeHead(code, {'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); }
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const ok = u.searchParams.get('key') === KEY;
  if (u.pathname === '/haichi') return ok ? send(res, 200, html, 'text/html; charset=utf-8') : send(res, 403, '<p>この URL では開けません</p>', 'text/html; charset=utf-8');
  if (!u.pathname.startsWith('/api/haichi/plans')) return send(res, 404, {error: 'not found'});
  if (!ok) return send(res, 403, {error: 'denied'});
  const id = decodeURIComponent(u.pathname.slice('/api/haichi/plans/'.length));
  if (req.method === 'GET' && !id) {
    const since = Number(u.searchParams.get('since'));
    if (since === rev) return send(res, 200, {rev, plans: null});
    return send(res, 200, {rev, plans: [...plans].map(([id, data]) => ({id, data}))});
  }
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return send(res, 400, {error: 'bad id'});
  if (req.method === 'DELETE') { plans.delete(id); rev++; return send(res, 200, {ok: true, rev}); }
  if (req.method === 'PUT') {
    let b = ''; req.on('data', c => { b += c; if (b.length > 300000) req.destroy(); });
    req.on('end', () => {
      if (b.length > 300000) return send(res, 413, {error: 'too big'});
      let j; try { j = JSON.parse(b); } catch (e) { return send(res, 400, {error: 'bad json'}); }
      if (!j || typeof j.data !== 'object') return send(res, 400, {error: 'no data'});
      if (!plans.has(id) && plans.size >= 60) return send(res, 507, {error: 'full'});
      plans.set(id, j.data); rev++; send(res, 200, {ok: true, rev});
    });
    return;
  }
  send(res, 405, {error: 'method'});
}).listen(process.env.PORT || 3999, () => console.log('mock on', process.env.PORT || 3999));
