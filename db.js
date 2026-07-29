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
`);

module.exports = db;
