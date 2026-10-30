// tools/v2-lab/open.js — 見本データの画面を Chrome（tools/cdp.js）で開くための共通の部品（指示66-1）
//
// tools/v2-shot.js（撮って測る）・tools/v2-ink.js（字の高さを画素で測る）・tools/v2-motion.js（演出「なし」で止まるか）が
// 同じ配り手と同じ開き方を使う（道具ごとに写すと、片方だけ直す日が来る・落とし穴1）。
//
// 配り手：public/ をそのまま配り、socket.io は tests/harness.js の疑似、/v2lab は tools/v2-lab/serve.js の labHtml。
// サーバーも bot も要らない。

const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep } = require('../cdp');
const { labHtml, PAGE_JS } = require('./serve');

const ROOT = path.join(__dirname, '..', '..');

function 疑似socketを読む() {
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'harness.js'), 'utf8');
  const head = 'const fake = `<script>';
  const a = src.indexOf(head), b = src.indexOf('</script>`', a);
  if (a < 0 || b < 0) throw new Error('tests/harness.js に疑似socketが見つかりません');
  return src.slice(a + head.length, b);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.webp': 'image/webp' };

/** 配り手を立てる。publicDir を変えると、別の作業ツリーの画面を配れる（入れかえ前の画像を撮る時） */
function 配り手(port, publicDir) {
  const PUBLIC = publicDir || path.join(ROOT, 'public');
  const fakeJs = 疑似socketを読む();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = decodeURIComponent(u.pathname);
    if (p === '/socket.io/socket.io.js' || p === '/socket.io/socket.io.min.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(fakeJs); }
    if (p === '/v2lab') { res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' }); return res.end(labHtml(u.searchParams)); }
    if (p === '/dev/v2-lab/page.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(fs.readFileSync(PAGE_JS)); }
    if (p.indexOf('/api/') === 0) { res.writeHead(401, { 'Content-Type': TYPES['.json'] }); return res.end('{"error":"未ログイン"}'); }
    const file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
    if (file.indexOf(PUBLIC) !== 0) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((ok, ng) => { server.once('error', ng); server.listen(port, () => ok(server)); });
}

/** 書体が届いたか（M PLUS 1 と League Spartan の太字）。届く前の写真は字の形も幅も違う */
const 書体が届いた = "document.fonts && document.fonts.check('900 20px \"M PLUS 1\"') && document.fonts.check('900 20px \"League Spartan\"') && document.fonts.status === 'loaded'";
/** 測る時計が動いているか（落とし穴28：裏に回った枠では rAF が来ない）。返り値は2コマのミリ秒（-1＝来ない） */
const 時計 = 'new Promise(function(res){ var t0=performance.now(); requestAnimationFrame(function(){ requestAnimationFrame(function(){ res(performance.now()-t0); }); }); setTimeout(function(){ res(-1); }, 2000); })';

/**
 * 見本データの画面を開く。st：{ n, long, freeze, open, fx:'skip'|'normal' }
 * 書体が届いて、名前の縮めと TV の合わせをやり直し、時計が動いていることを確かめてから返す
 */
async function 開く(dev, port, scene, st) {
  const q = new URLSearchParams({ scene: scene.id });
  if (st.n != null) q.set('n', st.n);
  if (st.long) q.set('long', '1');
  if (st.freeze != null) q.set('freeze', st.freeze);
  if (st.cd != null) q.set('cd', st.cd);
  if (st.world) q.set('world', st.world);
  const base = 'http://127.0.0.1:' + port;
  await dev.go(base + '/');
  // 文字サイズ（指示66-2：設定の「大」＝130 でルールとシートの文が 1.15倍）
  await dev.ev("(function(){ localStorage.setItem('acac-app-prefs', JSON.stringify({fxSpeed:" + JSON.stringify(st.fx || 'normal') + ",fontScale:" + (+st.font || 100) + "})); return 1; })()");
  await dev.go(base + '/v2lab?' + q.toString());
  await dev.until('window.V2Lab && (window.V2Lab.ready || window.V2Lab.error)', 15000, '見本データの画面');
  const err = await dev.ev('window.V2Lab.error');
  if (err) throw new Error(err);
  // その画面で使わない太さは読み込まれないので、待つ前に頼んでおく（入る画面には League Spartan の 900 が無い・指示66-2）
  await dev.ev("Promise.all([document.fonts.load('900 20px \"M PLUS 1\"'), document.fonts.load('900 20px \"League Spartan\"')]).then(function(){ return 1; }, function(){ return 0; })");
  await dev.until(書体が届いた, 20000, '書体');
  await dev.ev(`(function(){ var s=document.getElementById(${JSON.stringify(scene.screen)}); V2.fitTv(s); V2.relayout(s); return 1; })()`);
  // 巻ける中身を一番下まで送って撮る（部品の見本の下の方）
  if (st.scroll === 'end') await dev.ev("(function(){ var b=document.querySelector('.screen.active .v2-in.is-scroll'); if(b) b.scrollTop=b.scrollHeight; return !!b; })()");
  if (st.open) await dev.ev(`(function(){ var l=document.querySelector('[data-v2-id="${st.open}"]'); V2.open(l); return !!l; })()`);
  // 指示68-T 2：開いたシートの中を一番下まで送る（くわしい説明が下まで読めるか）
  if (st.open && st.scroll === 'sheet') await dev.ev("(function(){ var b=document.querySelector('.screen.active .v2-sheet.is-open .v2-sbody'); if(b) b.scrollTop=b.scrollHeight; return !!b; })()");
  await sleep(st.open ? 700 : 400);   // 出入りの 0.25 秒と、絵文字の差し替えが済むまで
  const ms = await dev.ev(時計);
  if (!(ms > 0 && ms < 500)) throw new Error('ページの時計が止まっています（rAF ' + ms + 'ms）');
}

module.exports = { 配り手, 開く, 書体が届いた, 時計, ROOT };
