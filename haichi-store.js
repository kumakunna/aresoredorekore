// haichi-store.js — 文化祭の「配置づくり」の案（指示70）。SQLite に置くので、サーバーを作り直しても（push しても）残る
//
//   haichi_plans(id, data, updated)：案ごとに1行。data は案の中身（JSON の字のまま）
//   haichi_rev(one, rev)：変わるたびに1つ上がる数（1行だけ）。ページは「rev が同じなら中身を送らない」で軽くする
// 置く・消すは、rev を上げるのと同じひとまとまり（transaction）でする——途中で落ちても、案と rev が食いちがわない。
// はじめは空。12の案は、最初に開いた人のページが自分で入れる（haichi.html の HAICHI_SEED）

'use strict';

const MAX_PLANS = 60;

function createHaichiStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS haichi_plans (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS haichi_rev (
      one INTEGER PRIMARY KEY CHECK (one = 1),
      rev INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO haichi_rev (one, rev) VALUES (1, 0);
  `);
  const getRev = db.prepare('SELECT rev FROM haichi_rev WHERE one = 1');
  const bump = db.prepare('UPDATE haichi_rev SET rev = rev + 1 WHERE one = 1');
  const count = db.prepare('SELECT COUNT(*) AS n FROM haichi_plans');
  const has = db.prepare('SELECT 1 FROM haichi_plans WHERE id = ?');
  const upsert = db.prepare('INSERT INTO haichi_plans (id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated');
  const del = db.prepare('DELETE FROM haichi_plans WHERE id = ?');
  const all = db.prepare('SELECT id, data FROM haichi_plans ORDER BY rowid');

  const rev = () => getRev.get().rev;
  /** 全部の案（置いた順） */
  function list() { return all.all().map((r) => ({ id: r.id, data: JSON.parse(r.data) })); }
  /** 置く。新しい案で60をこえるなら { full: true }（何も変えない） */
  const put = db.transaction((id, data, now) => {
    if (!has.get(id) && count.get().n >= MAX_PLANS) return { full: true };
    upsert.run(id, JSON.stringify(data), now);
    bump.run();
    return { rev: rev() };
  });
  /** 消す（無い案でも rev は上がる・見本と同じ） */
  const remove = db.transaction((id) => { del.run(id); bump.run(); return { rev: rev() }; });
  return { rev, list, put, remove };
}

module.exports = { createHaichiStore, MAX_PLANS };
