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
app.use(session({
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
}));

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

app.post('/api/ai-describe', requireAuth, async (req, res) => {
  const { name, ng_words, hint, avoid } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'サーバーにGEMINI_API_KEYが設定されていません（.envに追加してpm2 restartしてください）' });
  }
  try {
    const avoidList = (ng_words || []).join('、') || 'なし';
    let prompt;
    if (hint) {
      // 一言ヒントモード（③）：単語ひとつだけ返す。avoid には既出のヒントを渡す
      const already = (avoid || []).join('、');
      prompt = 'あなたは日本語のパーティーゲーム「あれそれどれこれ」のヒント役です。プレイヤーはヒントの単語だけを聞いてお題を当てます。\n'
        + `お題:「${name}」\n禁止ワード: ${avoidList}\n`
        + (already ? `すでに出したヒント: ${already}\n` : '')
        + '\nお題を連想できる「単語ひとつだけ」を日本語で出力してください。お題の名前そのもの・禁止ワード・すでに出したヒントは絶対に使わないこと。文ではなく単語のみ、説明・記号・句読点・番号は一切付けず、単語だけを返してください。';
    } else {
      prompt = 'あなたは日本語のパーティーゲーム「あれそれどれこれ」の出題者です。プレイヤーは言葉の説明だけを聞いて、お題が何かを当てます。\n'
        + `お題:「${name}」\n禁止ワード: ${avoidList}\n\n`
        + 'お題の名前そのものと禁止ワードは絶対に使わず、日本語で2〜3文の簡潔な説明をしてください。説明文以外（前置きや補足）は一切出力しないでください。';
    }
    // #3：無料枠のレート制限が緩い gemini-flash-lite-latest を使用
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const reqBody = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
    const callGemini = () => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: reqBody
    });
    let resp = await callGemini();
    if (resp.status === 429) {
      // #3：レート制限（429）は数秒待って1回だけ自動リトライ
      await new Promise((r) => setTimeout(r, 3000));
      resp = await callGemini();
    }
    if (!resp.ok) {
      const errBody = await resp.text();
      console.error('[ai-describe] Gemini API error:', resp.status, errBody);
      return res.status(502).json({ error: 'AI呼び出しに失敗しました（APIキーを確認してください）' });
    }
    const data = await resp.json();
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text
      ? cand.content.parts[0].text.trim() : null;
    if (!text) return res.status(502).json({ error: 'AIからの応答が空でした' });
    res.json({ description: text });
  } catch (e) {
    console.error('[ai-describe] error:', e);
    res.status(502).json({ error: 'AI呼び出し中にエラーが発生しました' });
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
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`[server] あれそれどれこれ backend running on port ${PORT}`);
});
