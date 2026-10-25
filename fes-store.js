// fes-store.js — 文化祭の部屋で、サーバーに残すもの（指示66-2）
//
// 残すのは2つだけ。どちらも**1か月で自動で消す**（RETAIN_MS）。
//   ・名前の記録：入力された名前と、規制ではじいた名前。不適切な言葉の対策のため。
//     **見られるのはくまくんだけ**（server.js の /api/fes/names が、ログインしたアカウントで門を持つ）
//   ・感想：★（1〜5）と「ひとこと」。**自由文はくまくんと先生だけ**が係の画面で見る（/api/fes/feedback）
//
// どちらも部屋のメモリではなく SQLite に置く——サーバーを立て直しても、1か月たつまでは消えず、
// 1か月たったら必ず消える（起動のたびと、1時間ごとに掃く）。
// 端末の識別は部屋の memberId だけ（アカウントとは結ばない。ログインしていない人がほとんど）。

'use strict';

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

function createFesStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fes_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT NOT NULL,
      name TEXT NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fes_feedback (
      key TEXT PRIMARY KEY,         -- 部屋・回・人ごとに1つ（★を変えたら上書き）
      room TEXT NOT NULL,
      round INTEGER NOT NULL,
      mode TEXT NOT NULL,
      member TEXT NOT NULL,
      name TEXT NOT NULL,
      stars INTEGER,
      text TEXT,
      at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS fes_names_at ON fes_names(at);
    CREATE INDEX IF NOT EXISTS fes_feedback_at ON fes_feedback(at);
  `);
  // 指示68-1：感想に、その時の版を残す（あとから足した列。前からある表にも足す）
  try { db.exec('ALTER TABLE fes_feedback ADD COLUMN ver TEXT'); } catch (e) { /* もうある */ }
  const insName = db.prepare('INSERT INTO fes_names (room, name, blocked, reason, at) VALUES (?, ?, ?, ?, ?)');
  const getFb = db.prepare('SELECT * FROM fes_feedback WHERE key = ?');
  const insFb = db.prepare(`INSERT INTO fes_feedback (key, room, round, mode, member, name, stars, text, at, updated_at, ver)
    VALUES (@key, @room, @round, @mode, @member, @name, @stars, @text, @at, @at, @ver)`);
  const updStars = db.prepare('UPDATE fes_feedback SET stars = ?, name = ?, updated_at = ?, ver = COALESCE(?, ver) WHERE key = ?');
  const updText = db.prepare('UPDATE fes_feedback SET text = ?, name = ?, updated_at = ?, ver = COALESCE(?, ver) WHERE key = ?');
  const delNames = db.prepare('DELETE FROM fes_names WHERE at < ?');
  const delFb = db.prepare('DELETE FROM fes_feedback WHERE at < ?');

  return {
    RETAIN_MS,
    /** 入力された名前を1つ残す（はじいた名前も） */
    logName(room, name, blocked, reason, now) {
      insName.run(String(room), String(name).slice(0, 64), blocked ? 1 : 0, reason || null, now || Date.now());
    },
    /**
     * 感想。★と「ひとこと」は別々に届く（★は押した時点で送る・ひとことは別に送る）。
     * 同じ人・同じ回は1行にまとめて、あとから来た方で上書きする
     */
    saveFeedback(fb, now) {
      const t = now || Date.now();
      const key = fb.room + '|' + fb.round + '|' + fb.member;
      const row = getFb.get(key);
      if (!row) {
        insFb.run({ key, room: String(fb.room), round: fb.round | 0, mode: String(fb.mode), member: String(fb.member),
          name: String(fb.name || ''), stars: fb.stars == null ? null : fb.stars, text: fb.text == null ? null : fb.text, at: t, ver: fb.ver || null });
      } else {
        if (fb.stars != null) updStars.run(fb.stars, String(fb.name || row.name), t, fb.ver || null, key);
        if (fb.text != null) updText.run(fb.text, String(fb.name || row.name), t, fb.ver || null, key);
      }
      return getFb.get(key);
    },
    /** 1か月より前のものを消す（起動時と1時間ごと） */
    purge(now) {
      const cut = (now || Date.now()) - RETAIN_MS;
      return { names: delNames.run(cut).changes, feedback: delFb.run(cut).changes };
    },
    listNames(now) {
      this.purge(now);
      return db.prepare('SELECT room, name, blocked, reason, at FROM fes_names ORDER BY at DESC LIMIT 2000').all();
    },
    listFeedback(now) {
      this.purge(now);
      return db.prepare('SELECT room, round, mode, name, stars, text, at, updated_at, ver FROM fes_feedback ORDER BY at DESC LIMIT 2000').all();
    }
  };
}

module.exports = { createFesStore, RETAIN_MS };
