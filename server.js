// server.js — 「あれそれどれこれ」バックエンド本体
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;
// 予備値は「.envが無いときに動かないための無意味な値」。実際の登録コードは必ず .env に置くこと
const REGISTER_CODE = process.env.REGISTER_CODE || 'change-me-in-env';
// セッション署名鍵。公開リポジトリに固定値を置くとcookieを偽造されるため、
// .env に無い場合は起動ごとにランダム生成する（=推測不能。ただし再起動でログアウトされる）。
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[server] SESSION_SECRET が .env にありません。起動ごとに再生成するため、再起動でログイン状態が切れます。');
}

app.set('trust proxy', 1); // Nginxの後ろで動かす前提。X-Forwarded-Protoを見てsecure cookieを正しく判定する

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
// 第19弾：socket.io にも同じセッションを通すため、ミドルウェアを変数に取り出しておく。
// これで socket.request.session.userId と req.session.userId が同じものになる。
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // Nginx側でHTTPS終端している前提
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30 // 30日
  }
});
app.use(sessionMiddleware);

// -------------------- 認証まわり --------------------

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '要ログイン' });
  next();
}

app.post('/api/auth/register', (req, res) => {
  const { username, password, code } = req.body || {};
  if (code !== REGISTER_CODE) {
    return res.status(403).json({ error: '登録コードが違います' });
  }
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'ユーザー名とパスワード（6文字以上）が必要です' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'そのユーザー名は既に使われています' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  req.session.userId = info.lastInsertRowid;
  res.json({ id: info.lastInsertRowid, username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'ユーザー名またはパスワードが違います' });
  }
  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 第32弾-B-2：名前を変える。
// 名前は棚のバーにも、部屋の名簿にも、記録にも出るので、あとから直せないと困る。
// 記録は user_id で紐づいているので、名前を変えても過去の記録は残る。
app.put('/api/auth/name', requireAuth, (req, res) => {
  const name = String((req.body && req.body.username) || '').trim();
  if (!name || name.length > 20) {
    return res.status(400).json({ error: '名前は1〜20文字で入れてください' });
  }
  const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?')
    .get(name, req.session.userId);
  if (taken) return res.status(409).json({ error: 'その名前は既に使われています' });
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, req.session.userId);
  res.json({ id: req.session.userId, username: name });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: '未ログイン' });
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: '未ログイン' });
  res.json(user);
});

// -------------------- お題API（①） --------------------

app.get('/api/topics', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM topics WHERE user_id IS NULL OR user_id = ? ORDER BY id'
  ).all(req.session.userId);
  res.json(rows.map(rowToTopic));
});

app.post('/api/topics', requireAuth, (req, res) => {
  const { name, yomi, ng_words, category } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'お題の名前が必要です' });
  const info = db.prepare(
    'INSERT INTO topics (user_id, name, yomi, ng_words, category) VALUES (?, ?, ?, ?, ?)'
  ).run(req.session.userId, name.trim(), yomi || '', JSON.stringify(ng_words || []), category || null);
  const row = db.prepare('SELECT * FROM topics WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(rowToTopic(row));
});

app.put('/api/topics/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '見つかりません' });
  if (row.user_id !== req.session.userId) return res.status(403).json({ error: '編集できません（デフォルトお題、または他ユーザーのお題です）' });
  const { name, yomi, ng_words, category } = req.body || {};
  db.prepare('UPDATE topics SET name=?, yomi=?, ng_words=?, category=? WHERE id=?')
    .run(name ?? row.name, yomi ?? row.yomi, JSON.stringify(ng_words ?? JSON.parse(row.ng_words || '[]')), category ?? row.category, row.id);
  res.json(rowToTopic(db.prepare('SELECT * FROM topics WHERE id = ?').get(row.id)));
});

app.delete('/api/topics/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM topics WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '見つかりません' });
  if (row.user_id !== req.session.userId) return res.status(403).json({ error: '削除できません（デフォルトお題、または他ユーザーのお題です）' });
  db.prepare('DELETE FROM topics WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

function rowToTopic(row) {
  return {
    id: row.id,
    name: row.name,
    yomi: row.yomi,
    ng_words: JSON.parse(row.ng_words || '[]'),
    category: row.category,
    is_default: row.user_id === null
  };
}

// -------------------- AI読み上げ機能 --------------------
// GEMINI_API_KEY が .env に設定されている場合のみ動作する
// キーは https://aistudio.google.com で発行（Googleアカウントのみでクレジットカード不要）

// 第27弾：プロンプトと呼び出しは ai-describe.js に移した。
// 爆弾解除の競争版が、試合前にサーバー側だけで説明文を作る必要があり、
// 同じプロンプトを2箇所に書くと片方だけ直る事故になるため。
const AiDescribe = require('./ai-describe');
// エラーの種類ごとのHTTPステータス。返す本文は今までとまったく同じ
const AI_STATUS = { bad_request: 400, no_key: 503 };

app.post('/api/ai-describe', requireAuth, async (req, res) => {
  const { name, ng_words, hint, avoid } = req.body || {};
  try {
    const out = await AiDescribe.describe({ name, ng_words, hint, avoid });
    res.json(out);
  } catch (e) {
    if (e.kind === 'api_error') console.error('[ai-describe] Gemini API error:', e.status, e.body);
    else if (e.kind !== 'no_key' && e.kind !== 'bad_request') console.error('[ai-describe] error:', e);
    // 種類の付いていない失敗（想定外）は、中身をそのまま返さずに今までの文面にする
    const message = e.kind ? e.message : 'AI呼び出し中にエラーが発生しました';
    res.status(AI_STATUS[e.kind] || 502).json({ error: message });
  }
});

// -------------------- 対戦履歴・スコアAPI（②） --------------------

app.post('/api/matches', requireAuth, (req, res) => {
  const { player_names } = req.body || {};
  if (!Array.isArray(player_names) || player_names.length === 0) {
    return res.status(400).json({ error: 'player_names が必要です' });
  }
  const info = db.prepare(
    'INSERT INTO matches (user_id, player_names) VALUES (?, ?)'
  ).run(req.session.userId, JSON.stringify(player_names));
  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/matches/:id/round', requireAuth, (req, res) => {
  const match = getOwnedMatch(req);
  if (!match) return res.status(404).json({ error: '見つかりません' });
  const { mode, score_deltas, opts, detail } = req.body || {};
  const rounds = JSON.parse(match.rounds || '[]');
  // opts＝そのラウンドのあそびかた（出題方法・封印ワード・脱落）。記録のタグ絞り込みに使う。
  // detail＝そのゲーム固有の記録（人狼なら役職構成・勝った陣営など）。
  // どちらも無い場合（古いクライアント）は従来どおり mode だけを保存する。
  const round = { mode: mode || null, score_deltas: score_deltas || {}, at: new Date().toISOString() };
  if (opts && typeof opts === 'object') round.opts = opts;
  if (detail && typeof detail === 'object') round.detail = detail;
  rounds.push(round);
  db.prepare('UPDATE matches SET rounds = ? WHERE id = ?').run(JSON.stringify(rounds), match.id);
  res.json({ ok: true, rounds_count: rounds.length });
});

app.patch('/api/matches/:id/finish', requireAuth, (req, res) => {
  const match = getOwnedMatch(req);
  if (!match) return res.status(404).json({ error: '見つかりません' });
  const { final_scores } = req.body || {};
  db.prepare('UPDATE matches SET final_scores = ?, ended_at = datetime(\'now\') WHERE id = ?')
    .run(JSON.stringify(final_scores || {}), match.id);
  res.json({ ok: true });
});

app.get('/api/matches', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM matches WHERE user_id = ? ORDER BY started_at DESC LIMIT 100'
  ).all(req.session.userId);
  res.json(rows.map(rowToMatch));
});

// -------------------- 称号API（第26弾-4） --------------------
// 一度手に入れたパーツは永久に残る。だから「持ち物」はサーバーに置き、
// 端末を変えても、記録を消しても失われないようにする。
//
// 条件の判定は titles.js（画面と共通）が持つ。ここは中身を見ずに預かるだけ。
// ただし端末が送ってきた「持ち物」を鵜呑みにすると減ってしまうので、
// 保存時は必ず前の持ち物との和をとる（増えることはあっても減らない）。
const TitleLogic = require('./public/js/titles');

function readTitles(userId) {
  const row = db.prepare('SELECT * FROM user_titles WHERE user_id = ?').get(userId);
  const parse = (s, fallback) => { try { return JSON.parse(s); } catch (e) { return fallback; } };
  const stats = TitleLogic.normalizeStats(row ? parse(row.stats, {}) : {});
  const unlocked = TitleLogic.mergeUnlocked(row ? parse(row.unlocked, []) : [], stats);
  const equipped = TitleLogic.normalizeEquipped(row ? parse(row.equipped, {}) : {}, unlocked);
  return { stats, unlocked, equipped };
}

app.get('/api/titles', requireAuth, (req, res) => {
  res.json(readTitles(req.session.userId));
});

app.put('/api/titles', requireAuth, (req, res) => {
  const body = req.body || {};
  const prev = readTitles(req.session.userId);
  // 成績は端末が積み上げたものを受け取るが、減る方向には動かさない
  const incoming = TitleLogic.normalizeStats(body.stats);
  const stats = TitleLogic.emptyStats();
  Object.keys(stats).forEach((cas) => {
    Object.keys(stats[cas]).forEach((k) => {
      stats[cas][k] = Math.max(prev.stats[cas][k], incoming[cas][k]);
    });
  });
  const unlocked = TitleLogic.mergeUnlocked(prev.unlocked.concat(body.unlocked || []), stats);
  const equipped = TitleLogic.normalizeEquipped(body.equipped || prev.equipped, unlocked);
  db.prepare(`
    INSERT INTO user_titles (user_id, stats, unlocked, equipped, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      stats = excluded.stats, unlocked = excluded.unlocked,
      equipped = excluded.equipped, updated_at = excluded.updated_at
  `).run(req.session.userId, JSON.stringify(stats), JSON.stringify(unlocked), JSON.stringify(equipped));
  res.json({ stats, unlocked, equipped });
});

app.get('/api/matches/stats', requireAuth, (req, res) => {
  const name = (req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name クエリが必要です' });
  const rows = db.prepare(
    'SELECT * FROM matches WHERE user_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC'
  ).all(req.session.userId);

  let playCount = 0, winCount = 0, totalScore = 0;
  for (const row of rows) {
    const scores = JSON.parse(row.final_scores || '{}');
    if (!(name in scores)) continue;
    playCount++;
    totalScore += scores[name];
    const maxScore = Math.max(...Object.values(scores));
    if (scores[name] === maxScore) winCount++;
  }
  res.json({
    name,
    play_count: playCount,
    win_count: winCount,
    win_rate: playCount ? Math.round((winCount / playCount) * 1000) / 10 : 0,
    total_score: totalScore,
    avg_score: playCount ? Math.round((totalScore / playCount) * 10) / 10 : 0
  });
});

function getOwnedMatch(req) {
  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!row || row.user_id !== req.session.userId) return null;
  return row;
}
function rowToMatch(row) {
  return {
    id: row.id,
    player_names: JSON.parse(row.player_names || '[]'),
    rounds: JSON.parse(row.rounds || '[]'),
    final_scores: row.final_scores ? JSON.parse(row.final_scores) : null,
    started_at: row.started_at,
    ended_at: row.ended_at
  };
}

// -------------------- フロントエンド（静的ファイル）配信 --------------------
// 絵文字SVGは中身が変わらない（Twemojiのコードポイント＝ファイル名）。
// キャッシュ指定なしだと実機は再描画のたびに 304 の往復をして、
// その待ちが絵文字の点滅（第33弾 A-1）の一因になっていた。長く覚えてもらう
app.use('/img/emoji', express.static(path.join(__dirname, 'public', 'img', 'emoji'), {
  maxAge: '30d',
  immutable: true
}));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- リアルタイム同期の土台（第19弾） --------------------
// 別ポートは立てず、既存のHTTPサーバーに socket.io を相乗りさせる。
// 一人一台前提の既存ゲームは、この機能を一切使わないので影響を受けない。
const http = require('http');
const { attachRealtime } = require('./realtime');

const httpServer = http.createServer(app);
attachRealtime(httpServer, sessionMiddleware);

httpServer.listen(PORT, () => {
  console.log(`[server] あれそれどれこれ backend running on port ${PORT}`);
});

module.exports = { app, httpServer, sessionMiddleware };
