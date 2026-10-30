// fes-store.js — 文化祭の部屋で、サーバーに残すもの（指示66-2）
//
// 残すのは3つだけ。どれも**1か月で自動で消す**（RETAIN_MS）。ほかに、係の画面の設定（ゲームごとの入／切）は消さずに覚える。
//   ・クイズ解除の記録（指示68-2・くまくんの決め 2026-10-26）：1試合ごとの終わり方（解除・爆発・時間切れ）と人数・本数・ライフ・時間、
//     問題ごとの「答えた数・1回目で正解したか・外した数」。**名前も端末も残さない**（問題の正答率と数字の決め直しのため）
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
    CREATE TABLE IF NOT EXISTS bomb_plays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      room TEXT NOT NULL,
      fes INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL,
      players INTEGER NOT NULL,
      codes INTEGER NOT NULL,
      lives INTEGER NOT NULL,
      timer_sec INTEGER NOT NULL,
      cause TEXT,
      success INTEGER,
      solved INTEGER,
      misses INTEGER,
      elapsed_sec INTEGER,
      ver TEXT
    );
    CREATE TABLE IF NOT EXISTS bomb_questions (
      play_id INTEGER NOT NULL,
      q TEXT NOT NULL,
      tier TEXT NOT NULL,
      tries INTEGER NOT NULL,
      first_ok INTEGER,
      wrong INTEGER NOT NULL,
      solved INTEGER NOT NULL
    );
    -- 指示68-T 二の束1：係の画面のゲームごとの入／切。記録ではなく設定なので、1か月で消さない
    CREATE TABLE IF NOT EXISTS fes_game_switch (
      mode TEXT PRIMARY KEY,
      on_ INTEGER NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bomb_plays_at ON bomb_plays(at);
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
  // 指示68-2：クイズ解除の記録。cause は defused（解除）・lives（爆発）・time（時間切れ）、競争版は firstDone・allDone。
  // first_ok は 1回目で正解（1）・外した（0）・だれも答えなかった（NULL）
  const insPlay = db.prepare(`INSERT INTO bomb_plays (at, room, fes, mode, players, codes, lives, timer_sec, cause, success, solved, misses, elapsed_sec, ver)
    VALUES (@at, @room, @fes, @mode, @players, @codes, @lives, @timer_sec, @cause, @success, @solved, @misses, @elapsed_sec, @ver)`);
  const insQ = db.prepare('INSERT INTO bomb_questions (play_id, q, tier, tries, first_ok, wrong, solved) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const delQ = db.prepare('DELETE FROM bomb_questions WHERE play_id IN (SELECT id FROM bomb_plays WHERE at < ?)');
  const delPlays = db.prepare('DELETE FROM bomb_plays WHERE at < ?');

  const getSw = db.prepare('SELECT mode, on_ FROM fes_game_switch');
  const putSw = db.prepare('INSERT INTO fes_game_switch (mode, on_, at) VALUES (?, ?, ?) ON CONFLICT(mode) DO UPDATE SET on_ = excluded.on_, at = excluded.at');

  return {
    RETAIN_MS,
    /** 指示68-T 二の束1：係の入／切（mode -> 真偽）。一度も押していないゲームは入っていない */
    gameSwitches() {
      const out = {};
      getSw.all().forEach((r) => { out[r.mode] = !!r.on_; });
      return out;
    },
    setGameSwitch(mode, on, now) { putSw.run(String(mode), on ? 1 : 0, now || Date.now()); },
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
    /**
     * 指示68-2：クイズ解除の1試合を残す。p：{ room, fes, mode, players, codes, lives, timerSec, cause, success, solved, misses, elapsedSec, ver,
     *   questions:[{ q, tier, tries, firstOk, wrong, solved }] }。名前・端末は受け取らない
     */
    recordBombPlay(p, now) {
      const t = now || Date.now();
      const run = db.transaction(() => {
        const id = insPlay.run({ at: t, room: String(p.room || ''), fes: p.fes ? 1 : 0, mode: String(p.mode || 'coop'), players: p.players | 0,
          codes: p.codes | 0, lives: p.lives | 0, timer_sec: p.timerSec | 0, cause: p.cause || null,
          success: p.success == null ? null : (p.success ? 1 : 0), solved: p.solved == null ? null : p.solved | 0,
          misses: p.misses == null ? null : p.misses | 0, elapsed_sec: p.elapsedSec | 0, ver: p.ver || null }).lastInsertRowid;
        (p.questions || []).forEach((x) => insQ.run(id, String(x.q || '').slice(0, 300), String(x.tier || ''), x.tries | 0,
          x.firstOk == null ? null : (x.firstOk ? 1 : 0), x.wrong | 0, x.solved ? 1 : 0));
        return id;
      });
      return run();
    },
    /** 試合ごと（新しい順）・難しさごと・問題ごとの正答率（1回目で正解した割合。答えた数の多い順） */
    listBombStats(now) {
      this.purge(now);
      const rate = (r) => Object.assign(r, { first_ok_rate: r.asked ? Math.round(r.first_ok / r.asked * 100) : null });
      const plays = db.prepare('SELECT * FROM bomb_plays ORDER BY at DESC LIMIT 2000').all();
      const questions = db.prepare(`SELECT q, tier, COUNT(*) AS plays, SUM(tries) AS tries, SUM(wrong) AS wrong,
          SUM(CASE WHEN first_ok IS NOT NULL THEN 1 ELSE 0 END) AS asked, SUM(CASE WHEN first_ok = 1 THEN 1 ELSE 0 END) AS first_ok
        FROM bomb_questions GROUP BY q, tier ORDER BY asked DESC, q LIMIT 2000`).all().map(rate);
      const tiers = db.prepare(`SELECT tier, SUM(CASE WHEN first_ok IS NOT NULL THEN 1 ELSE 0 END) AS asked,
          SUM(CASE WHEN first_ok = 1 THEN 1 ELSE 0 END) AS first_ok FROM bomb_questions GROUP BY tier`).all().map(rate);
      return { plays, questions, tiers };
    },
    /** 1か月より前のものを消す（起動時と1時間ごと） */
    purge(now) {
      const cut = (now || Date.now()) - RETAIN_MS;
      delQ.run(cut);
      return { names: delNames.run(cut).changes, feedback: delFb.run(cut).changes, bomb: delPlays.run(cut).changes };
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
