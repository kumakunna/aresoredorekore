// tools/dev-server.js — 検証専用の起動ラッパー（第35弾）
//
// 本物の server.js をそのまま起動し、検証用のログインルートを1本だけ足す。
// ブラウザの自動検証で、パスワードを画面に打たずに検証用アカウントの
// セッションを張るためのもの。**本番では絶対に使わない**（pm2 は server.js を起動する）。
// 保険として、NODE_ENV=production では何も足さない。
//
// 使い方：
//   node tools/dev-server.js
//   → http://localhost:3001/dev-login を一度開くと、検証用ユーザーでログイン状態になる
//   （.claude/launch.json の aresore-dev がこれを起動する）

const { app } = require('../server.js');
const db = require('../db');

if (process.env.NODE_ENV !== 'production') {
  app.get('/dev-login', (req, res) => {
    // 検証用ユーザー（無ければ作る。パスワードはログインに使わない乱数ハッシュ）
    const name = 'kensho34';
    let user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(name);
    if (!user) {
      const crypto = require('crypto');
      const bcrypt = require('bcryptjs');
      const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
        .run(name, bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10));
      user = { id: info.lastInsertRowid, username: name };
    }
    req.session.userId = user.id;
    res.send('<meta charset="utf-8">dev-login OK: ' + user.username + ' <a href="/">アプリへ</a>');
  });
  // 指示66-1：新しい見た目の画面を見本データで開く（/v2lab?scene=fes-lobby&n=6 など）。
  // 見本データと台本は tools/v2-lab/ にあり、public/ には置かない——本番（server.js）には、この道が無い
  require('./v2-lab/serve').mount(app);
  // 指示66-2：検証用ユーザーを、文化祭の係（くまくんと同じ owner）にする。本番の係は .env の FES_OWNER・FES_STAFF
  if (!process.env.FES_OWNER) process.env.FES_OWNER = 'kensho34';
}
