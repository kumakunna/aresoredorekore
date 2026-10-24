// tools/v2-lab/serve.js — 見本データ入りの index.html を組み立てる（指示66-1）
//
// 配るのは2か所だけ：tools/dev-server.js の /v2lab（人が見る）と tools/v2-shot.js（撮って測る）。
// **本番の server.js はこれを読まない**——本番では /v2lab が無いので、見本データの画面は開けない。
// 1か所で組み立てるので、人が見る画面と道具が撮る画面は同じものになる（落とし穴1）。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SCENES = require('./scenes');

/**
 * 見本データの乱数の種（指示68-0b K4）。同じ場面は、どの大きさでも同じ問題・同じ並びにする
 * （文化祭のクイズ解除の途中で、390 と 375 で違う問題が出ていた）。種は場面の名前と人数などから決める
 */
function 種(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function 乱数(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** 種を決めた Math.random で f を呼ぶ（呼び終えたら元にもどす） */
function 種を決めて(seed, f) { const old = Math.random; Math.random = 乱数(seed); try { return f(); } finally { Math.random = old; } }

/** query：URLSearchParams か { scene, n, long, cd, me } */
function labHtml(query) {
  const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || {});
  const sceneId = q.get('scene') || 'fes-lobby';
  const num = (k) => (q.get(k) == null || q.get(k) === '' ? undefined : +q.get(k));
  const seed = 種([sceneId, q.get('n') || '', q.get('long') || '', q.get('world') || ''].join('|'));
  const view = 種を決めて(seed, () => SCENES.view(sceneId, { n: num('n'), long: q.get('long') === '1', cd: num('cd'), me: num('me'), world: q.get('world') || undefined }));
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  // </script> を字として含めない（名前に入っていても台本が途中で切れないように）
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  const inject = '<script>window.__V2LAB_SCENES=' + json(SCENES.SCENES.map((s) => ({ id: s.id, screen: s.screen, draw: s.draw }))) +
    // ページの中の乱数も同じ種にする（画面の側で並べかえる物も、毎回同じ並びに）。見本データの画面だけ
    ';window.__V2LAB_VIEW=' + json(view) + ';Math.random=(' + 乱数.toString() + ')(' + seed + ');</script>\n<script src="/dev/v2-lab/page.js"></script>\n';
  const i = html.lastIndexOf('</body>');
  if (i < 0) throw new Error('index.html に </body> がありません');
  return html.slice(0, i) + inject + html.slice(i);
}
const PAGE_JS = path.join(__dirname, 'page.js');

/** express に2本の道を足す（検証用サーバーだけが呼ぶ） */
function mount(app) {
  app.get('/v2lab', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('html').send(labHtml(new URLSearchParams(req.query)));
  });
  app.get('/dev/v2-lab/page.js', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send(fs.readFileSync(PAGE_JS, 'utf8'));
  });
}

module.exports = { labHtml, mount, PAGE_JS };
