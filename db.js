const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'aresoredorekore.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    name TEXT NOT NULL,
    yomi TEXT,
    ng_words TEXT,
    category TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    player_names TEXT NOT NULL,
    rounds TEXT DEFAULT '[]',
    final_scores TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT
  );
  -- 第26弾-4：称号（アイコン・二つ名）。
  -- 一度手に入れたものは永久に残るので、対戦記録とは別に持つ
  -- （記録を消してもパーツは失われない）。
  -- stats は獲得条件の判定に使う積み上げ、unlocked は獲得済みID、
  -- equipped はいま名乗っている組み合わせ。中身の意味は titles.js が決める。
  CREATE TABLE IF NOT EXISTS user_titles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    stats TEXT NOT NULL DEFAULT '{}',
    unlocked TEXT NOT NULL DEFAULT '[]',
    equipped TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now'))
  );
  -- 第32弾-E 第1部：プレイヤー2人の組み合わせごとの「一緒に遊んだ回数」。
  -- グループ単位だと新しい人が1人加わるだけで記録が途切れるので、2人組で持つ。
  -- 名前は a < b に並べて1行にする（(あき,びび) と (びび,あき) を別に数えない）。
  -- 記録の持ち主は、対戦履歴と同じく「記録を残したアカウント」。
  CREATE TABLE IF NOT EXISTS pairs (
    user_id INTEGER NOT NULL REFERENCES users(id),
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    first_at TEXT DEFAULT (datetime('now')),
    last_at TEXT,
    PRIMARY KEY (user_id, a, b)
  );
`);

// 第32弾-E 第1部：1ゲーム遊ぶごとに、その場の全部の2人組へ+1する。
// 5人なら10組。新しい人が加わっても、既存の組の記録は減らない。
const pairUpsert = db.prepare(
  "INSERT INTO pairs (user_id, a, b, count, last_at) VALUES (?, ?, ?, 1, datetime('now')) " +
  "ON CONFLICT(user_id, a, b) DO UPDATE SET count = count + 1, last_at = datetime('now')"
);
const countPairsTx = db.transaction((userId, uniq) => {
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const pair = [uniq[i], uniq[j]].sort();
      pairUpsert.run(userId, pair[0], pair[1]);
    }
  }
});
db.countPairs = function countPairs(userId, names) {
  if (!userId) return;
  const uniq = Array.from(new Set(
    (names || []).map((n) => String(n == null ? '' : n).trim()).filter(Boolean)
  ));
  if (uniq.length < 2) return;
  countPairsTx(userId, uniq);
};

/**
 * いまのメンバーの中の組み合わせについて、控えめな一言のもとになる情報を返す。
 *   top   … 一番長い付き合いの2人（2回以上一緒に遊んでいる時だけ）
 *   fresh … 今日はじめて一緒に遊んだ2人組（第2部の「静かに祝う」用）
 * 一覧をそのまま返さないのは、回数の少ない人が疎外感を持つ表示を作らせないため。
 */
db.pairInfo = function pairInfo(userId, names) {
  if (!userId) return { top: null, fresh: [] };
  const uniq = Array.from(new Set(
    (names || []).map((n) => String(n == null ? '' : n).trim()).filter(Boolean)
  ));
  if (uniq.length < 2) return { top: null, fresh: [] };
  const rows = db.prepare('SELECT a, b, count, first_at FROM pairs WHERE user_id = ?').all(userId);
  const here = {};
  uniq.forEach((n) => { here[n] = true; });
  const mine = rows.filter((r) => here[r.a] && here[r.b]);
  let top = null;
  mine.forEach((r) => { if (r.count >= 2 && (!top || r.count > top.count)) top = r; });
  const fresh = mine.filter((r) =>
    db.prepare("SELECT date(?, 'localtime') = date('now', 'localtime') AS today").get(r.first_at).today
  ).map((r) => ({ a: r.a, b: r.b }));
  return {
    top: top ? { a: top.a, b: top.b, count: top.count } : null,
    fresh
  };
};

module.exports = db;
