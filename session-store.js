// session-store.js — ログインの記憶を、プロセスの外（SQLite）に置く（第52弾 52-2）
//
// ## なぜ要るのか
//
// `express-session` は、`store` を渡さないと**既定の MemoryStore**を使う。
// 名前のとおりプロセスのメモリなので、**再起動で全部消える**。
//
// このアプリは `tools/deploy.sh` が2分おきに走り、
// **更新があるたび `pm2 restart` する**。つまり push するたびに全員のセッションが消える。
// cookie の署名は `.env` の `SESSION_SECRET` で再起動後も有効なので、
// **ブラウザは cookie を送り続け、サーバーだけが「知らない」と答える**——
// 遊ぶ人には「ログインしているのに『要ログイン』と出る」としか見えない
// （本人の実機報告。名前変更の画面で出た）。
//
// ## なぜ自分で書くのか
//
// `connect-sqlite3` などを足すと **VPS に新しい native 依存が増える**。
// ここに必要なのは get / set / destroy / touch の4つだけで、
// **すでに持っている `better-sqlite3` でそのまま書ける**。
// 動く部品を増やさない方を採った（新しい依存は、動かなくなる場所が1つ増える）。
//
// ## 表を db.js ではなくここに置く理由
//
// これは**アプリのデータではなく、ログインの足場**。
// db.js の表は「遊んだ記録」で、寿命も持ち主も違う。
// 一緒に置くと、バックアップ（`tools/backup-db.js`）の意味が混ざる
// ——セッションは消えても誰も困らないが、記録は消えたら戻らない。

const session = require('express-session');

/** 期限切れを掃く間隔。短くしすぎても得は無い（読むたびに期限は見ている） */
const 掃除の間隔ms = 1000 * 60 * 60;

class SqliteSessionStore extends session.Store {
  /**
   * @param {{db: import('better-sqlite3').Database}} opts
   */
  constructor(opts) {
    super();
    const db = opts && opts.db;
    if (!db) throw new Error('session-store: db がありません');
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid     TEXT PRIMARY KEY,
        expires INTEGER NOT NULL,
        data    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
    `);
    this.文 = {
      読む: db.prepare('SELECT data, expires FROM sessions WHERE sid = ?'),
      書く: db.prepare(
        'INSERT INTO sessions (sid, expires, data) VALUES (@sid, @expires, @data) ' +
        'ON CONFLICT(sid) DO UPDATE SET expires = @expires, data = @data'),
      触る: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      消す: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      掃く: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
      数える: db.prepare('SELECT COUNT(*) AS n FROM sessions')
    };
    this.掃除();
    // サーバーを終わらせない（`unref`）。掃除のために起き続ける必要は無い
    this.timer = setInterval(() => this.掃除(), 掃除の間隔ms);
    if (this.timer.unref) this.timer.unref();
  }

  /** 期限（ミリ秒のエポック）を決める。cookie の maxAge が正本 */
  期限(sess) {
    const c = sess && sess.cookie;
    if (c && c.expires) return new Date(c.expires).getTime();
    if (c && typeof c.originalMaxAge === 'number') return Date.now() + c.originalMaxAge;
    return Date.now() + 1000 * 60 * 60 * 24 * 30;   // server.js の既定と同じ30日
  }

  get(sid, cb) {
    try {
      const row = this.文.読む.get(sid);
      if (!row) return cb(null, null);
      // **期限切れは「無い」と答える。**掃除を待たない
      if (row.expires <= Date.now()) { this.文.消す.run(sid); return cb(null, null); }
      return cb(null, JSON.parse(row.data));
    } catch (e) {
      // **読めなかったものを、黙って「無い」にしない**（落とし穴10-e の親戚）。
      // ここで握り潰すと、壊れた行1つで「ログインできない理由が分からない」になる
      return cb(e);
    }
  }

  set(sid, sess, cb) {
    try {
      this.文.書く.run({ sid, expires: this.期限(sess), data: JSON.stringify(sess) });
      return cb(null);
    } catch (e) { return cb(e); }
  }

  /** 触られたら期限だけ延ばす（中身は書き直さない） */
  touch(sid, sess, cb) {
    try {
      this.文.触る.run(this.期限(sess), sid);
      return cb(null);
    } catch (e) { return cb(e); }
  }

  destroy(sid, cb) {
    try { this.文.消す.run(sid); return cb(null); }
    catch (e) { return cb(e); }
  }

  掃除() {
    try { this.文.掃く.run(Date.now()); }
    catch (e) { console.error('[session] 期限切れの掃除で例外:', e); }
  }

  /** 検査用：いま何件あるか */
  件数() { return this.文.数える.get().n; }
}

module.exports = { SqliteSessionStore };
