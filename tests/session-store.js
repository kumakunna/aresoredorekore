// tests/session-store.js — ログインの記憶が、再起動をまたいで残るか（第52弾 52-2）
//
// 本人の実機報告：「ログインしているのに、名前を変えようとすると『要ログイン』と出る」。
//
// 真因は `express-session` に `store` を渡していなかったこと。
// 既定は MemoryStore ＝プロセスのメモリなので、**再起動で全部消える**。
// このアプリは `tools/deploy.sh` が2分おきに走り、更新のたび `pm2 restart` するので、
// **push するたびに全員のセッションが消えていた**。
// cookie の署名は `.env` の `SESSION_SECRET` で再起動後も有効なため、
// ブラウザは cookie を送り続け、サーバーだけが「知らない」と答える。
//
// ## この検査が気をつけていること
//
// **(1) 「直っている」を、壊れている側と並べて測る**（落とし穴10-b・10-f）。
// store を付けた側だけ見ると、「再起動をまたげた」が
// 本当に store のおかげなのか分からない。**MemoryStore の側も同じ手順で回して、
// そちらは必ず切れること**を先に確かめる。対照が取れて初めて、緑に意味が出る。
//
// **(2) 本物の `express-session` を通す。**
// store の4つのメソッドを直接呼ぶだけの検査にすると、
// cookie の署名・期限・`resave:false` の絡みが一切試されない。
// 本物のミドルウェアを本物の http サーバーに載せて、**fetch で cookie を運ぶ**。
//
// **(3) 「再起動」を、同じファイルを開き直すことで作る。**
// プロセスを殺す必要はない——大事なのは
// 「メモリ上の store が作り直される」ことなので、db も store も作り直す。

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');

const { createRunner, assert, assertEqual } = require('./harness');
const { SqliteSessionStore } = require('../session-store');

/**
 * ログインを1つ持つ小さなサーバーを立てる。
 * `store` を渡さなければ MemoryStore（＝直す前の姿）になる
 */
function 立てる(store) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret-for-session-store',
    store: store || undefined,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 1000 * 60 * 60 }
  }));
  app.post('/login', (req, res) => { req.session.userId = 4242; res.json({ ok: true }); });
  app.get('/me', (req, res) => {
    // server.js:51 の requireAuth と同じ形
    if (!req.session.userId) return res.status(401).json({ error: '要ログイン' });
    res.json({ id: req.session.userId });
  });
  app.post('/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
  const srv = http.createServer(app);
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({
      url: 'http://127.0.0.1:' + srv.address().port,
      close: () => new Promise((r) => srv.close(() => r()))
    }));
  });
}

async function ログインする(url) {
  const res = await fetch(url + '/login', { method: 'POST' });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  return (sc || []).filter(Boolean).map((c) => c.split(';')[0]).join('; ');
}

async function 私は誰(url, cookie) {
  const res = await fetch(url + '/me', { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function 仮のDB() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acac-sess-')), 'test.db');
  return { path: p, open: () => new Database(p) };
}

(async () => {
  const r = createRunner('session-store');

  // ---- 対照：直す前の姿（MemoryStore）では、再起動でログインが切れる ----
  // **これが赤くならないと、下の検査は何も証明しない**（落とし穴10-b）
  await r.test('52-2（対照）：store を渡さないと、立て直しでログインが切れる', async () => {
    const A = await 立てる(null);
    const cookie = await ログインする(A.url);
    assert(cookie, 'cookie が配られた');
    assertEqual((await 私は誰(A.url, cookie)).status, 200, '同じサーバーなら分かる');
    await A.close();

    const B = await 立てる(null);            // ＝ pm2 restart
    const 後 = await 私は誰(B.url, cookie);
    assertEqual(後.status, 401, '立て直すと「知らない」と言われる（実機で起きていたこと）');
    assertEqual(後.body && 後.body.error, '要ログイン', '画面に出る文字はこれ');
    await B.close();
  });

  // ---- 本番：SQLite に置けば、立て直しても残る ----
  await r.test('52-2：SQLite に置いたセッションは、立て直しても残る', async () => {
    const DB = 仮のDB();
    const dbA = DB.open();
    const A = await 立てる(new SqliteSessionStore({ db: dbA }));
    const cookie = await ログインする(A.url);
    assertEqual((await 私は誰(A.url, cookie)).status, 200, 'ログインできている');
    await A.close(); dbA.close();

    // ＝ pm2 restart（プロセスも store も作り直し。残るのはファイルだけ）
    const dbB = DB.open();
    const B = await 立てる(new SqliteSessionStore({ db: dbB }));
    const 後 = await 私は誰(B.url, cookie);
    assertEqual(後.status, 200, '立て直しても、同じ cookie で自分だと分かる');
    assertEqual(後.body && 後.body.id, 4242, '中身（userId）もそのまま');
    await B.close(); dbB.close();
  });

  await r.test('52-2：ログアウトすると、立て直しても消えている', async () => {
    const DB = 仮のDB();
    const dbA = DB.open();
    const store = new SqliteSessionStore({ db: dbA });
    const A = await 立てる(store);
    const cookie = await ログインする(A.url);
    assertEqual(store.件数(), 1, '1件だけ入っている');
    await fetch(A.url + '/logout', { method: 'POST', headers: { Cookie: cookie } });
    assertEqual(store.件数(), 0, 'ログアウトで消える（残しっぱなしにしない）');
    await A.close(); dbA.close();

    const dbB = DB.open();
    const B = await 立てる(new SqliteSessionStore({ db: dbB }));
    assertEqual((await 私は誰(B.url, cookie)).status, 401, '立て直しても、消えたものは戻らない');
    await B.close(); dbB.close();
  });

  await r.test('52-2：期限が切れたものは、掃除を待たずに「無い」と答える', async () => {
    const DB = 仮のDB();
    const db = DB.open();
    const store = new SqliteSessionStore({ db });
    // **型(b)：期限切れの行が、本当に作れているか。**
    // 直に書き込んで、過去の期限を持つ行を1つ用意する
    db.prepare('INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?)')
      .run('ふるいの', Date.now() - 1000, JSON.stringify({ userId: 1 }));
    assertEqual(store.件数(), 1, '期限切れの行が1件ある');
    const got = await new Promise((res, rej) =>
      store.get('ふるいの', (e, v) => (e ? rej(e) : res(v))));
    assertEqual(got, null, '期限切れは「無い」と答える');
    assertEqual(store.件数(), 0, 'そのとき、行も片付ける');
    db.close();
  });

  await r.test('52-2：読めなかった時は、黙って「無い」にしない', async () => {
    // 落とし穴10-e：握り潰すと、壊れた行1つで「理由の分からないログアウト」になる
    const DB = 仮のDB();
    const db = DB.open();
    const store = new SqliteSessionStore({ db });
    db.prepare('INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?)')
      .run('こわれ', Date.now() + 60000, '{これはJSONではない');
    const err = await new Promise((res) => store.get('こわれ', (e) => res(e)));
    assert(err, '読めなかったことが、そのまま返る（null で握り潰さない）');
    db.close();
  });

  r.finish();
})();
