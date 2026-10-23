// tools/v2-lab/serve.js — 見本データ入りの index.html を組み立てる（指示66-1）
//
// 配るのは2か所だけ：tools/dev-server.js の /v2lab（人が見る）と tools/v2-shot.js（撮って測る）。
// **本番の server.js はこれを読まない**——本番では /v2lab が無いので、見本データの画面は開けない。
// 1か所で組み立てるので、人が見る画面と道具が撮る画面は同じものになる（落とし穴1）。

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SCENES = require('./scenes');

/** query：URLSearchParams か { scene, n, long, cd, me } */
function labHtml(query) {
  const q = query instanceof URLSearchParams ? query : new URLSearchParams(query || {});
  const sceneId = q.get('scene') || 'fes-lobby';
  const num = (k) => (q.get(k) == null || q.get(k) === '' ? undefined : +q.get(k));
  const view = SCENES.view(sceneId, { n: num('n'), long: q.get('long') === '1', cd: num('cd'), me: num('me'), world: q.get('world') || undefined });
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  // </script> を字として含めない（名前に入っていても台本が途中で切れないように）
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
  const inject = '<script>window.__V2LAB_SCENES=' + json(SCENES.SCENES.map((s) => ({ id: s.id, screen: s.screen, draw: s.draw }))) +
    ';window.__V2LAB_VIEW=' + json(view) + ';</script>\n<script src="/dev/v2-lab/page.js"></script>\n';
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
