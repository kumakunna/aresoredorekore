// fes-routes.js — 文化祭の部屋のための道（指示66-2）。server.js と検査の両方がここを mount する
//
//   GET /tv                  … ふだんの部屋の TV の入口（指示66-3。コードを入れる画面へ）
//   GET /api/fes/current     … いまの文化祭の部屋のコード（無い時は null）。部屋を待つ画面が見る（だれでも読める・コードは QR にも出ている）
//   GET /fes                 … いまの文化祭の部屋へ飛ぶ（机や壁のポスターのQRはここ。部屋を作り直しても使える）
//   GET /api/fes/names       … 名前の記録（入力された名前と、はじいた名前）。**くまくん（owner）だけ**
//   GET /fes/names           … 同じ記録を読む軽い画面（指示66-3。くまくんだけ。?only=blocked ではじいた名前だけ）
//   GET /api/fes/feedback    … 感想（★と自由文）。**くまくんと先生（owner・staff）だけ**
//   GET /api/fes/bomb-stats  … クイズ解除の記録（終わり方・問題ごとの正答率。名前は無い）。**くまくんだけ**（指示68-2）
//   GET /fes/bomb-stats      … 同じ記録を読む軽い画面（くまくんだけ）
//   GET /api/fes/rounds・/fes/rounds … 回ごとの記録（名前は無い）。係（くまくんと先生）（指示68-T 二の束6）
//
// だれが係かは realtime.js の fesRoleOf（.env の FES_OWNER・FES_STAFF）。ログインしていなければ 401、
// 係でなければ 403。中身を返す前に、必ず1か月より前のものを掃く（fes-store.js の list* が掃く）

'use strict';

function mountFesRoutes(app, io) {
  // 指示66-3：ふだんの部屋の TV の入口。進行役のスマホの「TVに映す」がこのアドレスを出す（TV のリモコンで打てる短さ）。
  // 開くとコードを入れる画面になり、入れるとその部屋の TV になる（名前は聞かない）
  app.get('/tv', (req, res) => res.redirect(302, '/?tv=1'));
  // 2026-10-29：いまの文化祭の部屋のコード（無い時は null）。「部屋がありません」「作り直しています」の画面が数秒ごとに見て、できたら入る
  app.get('/api/fes/current', (req, res) => res.json({ code: (io.fesCurrentCode && io.fesCurrentCode()) || null }));
  // 2026-10-31：TV を開いて8秒たっても文化祭の画面に着かない時の手がかり（本番で1回だけ見た真っ白・手元では再現できない）。
  // TV が1回だけ送る（index.html fesTvWatch）。ログに1行だけ残す。人の打った字は無いが、改行は消して長さを切る。送りすぎは1分20回まで
  let 着かない = { t: 0, n: 0 };
  app.post('/api/fes/tv-stuck', (req, res) => {
    const now = Date.now();
    if (now - 着かない.t > 60000) 着かない = { t: now, n: 0 };
    if (++着かない.n > 20) return res.status(429).json({ ok: false });
    const b = req.body || {};
    const 字 = (v, n) => String(v == null ? '-' : v).replace(/\s+/g, ' ').slice(0, n);
    console.log('[fes] TV が8秒で着かない（tv-stuck）：画面=' + 字(b.scr, 40) + ' 入る返事=' + (b.replied ? '来た' : '来ない') +
      ' 版=' + 字(b.v, 16) + ' つなぎ直し=' + Math.max(0, Math.min(999, Math.floor(+b.reconnects) || 0)) + '回 部屋=' + 字(b.code, 8));
    res.json({ ok: true });
  });
  app.get('/fes', (req, res) => {
    const code = io.fesCurrentCode && io.fesCurrentCode();
    // TV（/fes?tv=1）と係（/fes?staff=1）は、その印をつけたまま飛ばす
    const extra = (req.query.tv ? '&tv=1' : '') + (req.query.staff ? '&staff=1' : '');
    // 部屋がまだ無い時は入口へ（「いまは部屋がありません」は入口が出す）
    res.redirect(302, code ? '/?room=' + encodeURIComponent(code) + '&fes=1' + extra : '/?fes=1' + extra);
  });
  function gate(need) {
    return (req, res, next) => {
      const uid = req.session && req.session.userId;
      if (!uid) return res.status(401).json({ error: 'ログインしてください' });
      const role = io.fesRoleOf ? io.fesRoleOf(uid) : null;
      if (!role || (need === 'owner' && role !== 'owner')) return res.status(403).json({ error: '見られません' });
      if (!io.fesStore) return res.status(503).json({ error: '記録の入れ物がありません' });
      next();
    };
  }
  app.get('/api/fes/names', gate('owner'), (req, res) => res.json({ names: io.fesStore.listNames() }));
  // 指示66-3：くまくんが名前の記録を読む軽い画面（新しい→古いの順。はじいた名前だけにも絞れる）。
  // JSON の道と同じ門（くまくんだけ）。名前は必ず字のまま出す（HTML として動かさない・落とし穴43）
  app.get('/fes/names', (req, res) => {
    const page = (code, title, body) => res.status(code).type('html').send(namesPage(title, body));
    const uid = req.session && req.session.userId;
    if (!uid) return page(401, 'ログインしてください', '<p>くまくんのアカウントでログインしてから、もう一度開いてください。</p><p><a href="/">ログインへ</a></p>');
    const role = io.fesRoleOf ? io.fesRoleOf(uid) : null;
    if (role !== 'owner') return page(403, '見られません', '<p>この画面は、くまくんのアカウントだけが見られます。</p>');
    if (!io.fesStore) return page(503, '記録の入れ物がありません', '');
    const only = req.query.only === 'blocked';
    const rows = io.fesStore.listNames().filter((r) => !only || r.blocked);
    const blockedN = io.fesStore.listNames().filter((r) => r.blocked).length;
    const body = '<p class="n">' + rows.length + '件' + (only ? '（はじいた名前だけ）' : '') + '・1か月より前のものは消えます</p>' +
      '<p class="f">' + (only ? '<a href="/fes/names">ぜんぶ見る</a>' : '<a href="/fes/names?only=blocked">はじいた名前だけ（' + blockedN + '件）</a>') + '</p>' +
      '<table><thead><tr><th>いつ</th><th>部屋</th><th>名前</th><th>はじいた</th></tr></thead><tbody>' +
      rows.map((r) => '<tr' + (r.blocked ? ' class="b"' : '') + '><td>' + whenText(r.at) + '</td><td>' + esc(r.room) + '</td><td>' + esc(r.name) + '</td><td>' +
        (r.blocked ? esc(REASON[r.reason] || r.reason || 'はじいた') : '') + '</td></tr>').join('') +
      '</tbody></table>';
    page(200, '名前の記録', body);
  });
  app.get('/api/fes/feedback', gate('staff'), (req, res) => res.json({ feedback: io.fesStore.listFeedback() }));
  // 指示68-2：あそびテストの記録（10/30 の結果で、人数の表 BombLogic.SIZING の数字を決め直す）
  app.get('/api/fes/bomb-stats', gate('owner'), (req, res) => res.json(io.fesStore.listBombStats()));
  app.get('/fes/bomb-stats', (req, res) => {
    const page = (code, title, body) => res.status(code).type('html').send(namesPage(title, body));
    const uid = req.session && req.session.userId;
    if (!uid) return page(401, 'ログインしてください', '<p>くまくんのアカウントでログインしてから、もう一度開いてください。</p><p><a href="/">ログインへ</a></p>');
    if ((io.fesRoleOf ? io.fesRoleOf(uid) : null) !== 'owner') return page(403, '見られません', '<p>この画面は、くまくんのアカウントだけが見られます。</p>');
    if (!io.fesStore) return page(503, '記録の入れ物がありません', '');
    page(200, 'クイズ解除の記録', bombStatsHtml(io.fesStore.listBombStats()));
  });
  // 指示68-T 二の束6：回ごとの記録（名前は無い・1か月で消える）。係（くまくんと先生）が係の画面から開く。
  // 11/6 のリハーサルで数を取って、しきい値とライフを見直すため
  app.get('/api/fes/rounds', gate('staff'), (req, res) => res.json({ rounds: io.fesStore.listRounds() }));
  app.get('/fes/rounds', (req, res) => {
    const page = (code, title, body) => res.status(code).type('html').send(namesPage(title, body));
    const uid = req.session && req.session.userId;
    if (!uid) return page(401, 'ログインしてください', '<p>係のアカウントでログインしてから、もう一度開いてください。</p><p><a href="/">ログインへ</a></p>');
    if (!(io.fesRoleOf ? io.fesRoleOf(uid) : null)) return page(403, '見られません', '<p>この画面は、係のアカウントだけが見られます。</p>');
    if (!io.fesStore) return page(503, '記録の入れ物がありません', '');
    page(200, '回ごとの記録', roundsHtml(io.fesStore.listRounds()));
  });
}

const MODE_NAME = { 'bomb-coop': 'クイズ解除', 'onaji-many': 'みんなと同じ', pittari: 'ぴったり10秒', soroe: 'そろえて発射', qhaya: 'みんなで早答え', qnear: '数字ちかい方' };
/** 指示68-T 二の束6：回ごとの記録の表。秒は「待合→開始」「開始→結果」「結果→次の待合」。中身はゲームごとに短く */
function roundsHtml(rows) {
  const sec = (a, b) => (a && b ? Math.round((b - a) / 1000) + '秒' : '');
  const ms = (v) => (v == null ? '-' : (v > 0 ? '+' : '') + (v / 1000).toFixed(2));
  const 中身 = (r) => {
    const d = r.detail || {}, R = d.rounds || [];
    if (r.mode === 'soroe') return R.map((x, i) => (i + 1) + '回目 ' + (x.spread == null ? '飛ばず' : 'そろい ' + x.spread + 'ms') + '（' + x.count + '/' + x.n + '人）').join('<br>');
    if (r.mode === 'pittari') return R.map((x, i) => (i + 1) + '回目 ' + x.target + '秒' + (x.show ? '' : '（時計なし）') + '：' + (x.diffs || []).map(ms).join(' ')).join('<br>');
    if (r.mode === 'onaji-many') return R.map((x) => esc(x.q) + '：いちばん多い ' + x.top + '/' + x.answered + '人').join('<br>');
    if (r.mode === 'qhaya') return R.map((x) => esc(x.q) + '：' + (x.rate == null ? '答えなし' : '正答率 ' + x.rate + '%（' + x.answered + '人）')).join('<br>');
    if (r.mode === 'qnear') return R.map((x) => esc(x.q) + '：' + x.answered + '人・ぴったり ' + x.perfect + '人').join('<br>');
    if (r.mode === 'bomb-coop') return esc(CAUSE[d.cause] || d.cause || '') + (d.total ? '（' + d.solved + '/' + d.total + '本）' : '');
    return '';
  };
  return '<p class="n">' + rows.length + '回・名前は残していません・1か月より前のものは消えます</p>' +
    '<table><thead><tr><th>いつ</th><th>ゲーム</th><th>人数</th><th>待合→開始</th><th>開始→結果</th><th>結果→次</th><th>中身</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td>' + whenText(r.result_at || r.at) + '</td><td>' + esc(MODE_NAME[r.mode] || r.mode) + '</td><td>' + r.players + '</td><td>' +
      sec(r.lobby_at, r.start_at) + '</td><td>' + sec(r.start_at, r.result_at) + '</td><td>' + sec(r.result_at, r.next_at) + '</td><td>' + 中身(r) + '</td></tr>').join('') +
    '</tbody></table>';
}

const CAUSE = { defused: '解除', lives: '爆発', time: '時間切れ', firstDone: '1人が解き切った', allDone: '全員が終わった' };
/** 指示68-2：クイズ解除の記録を読む表。問題文は字のまま出す（落とし穴43）。正答率が半分より下の問題は色を変える */
function bombStatsHtml(st) {
  const cnt = {};
  st.plays.forEach((p) => { cnt[p.cause] = (cnt[p.cause] || 0) + 1; });
  const pct = (v) => (v == null ? '' : v + '%');
  return '<p class="n">' + st.plays.length + '試合・1か月より前のものは消えます</p>' +
    '<p class="f">' + Object.keys(cnt).map((k) => esc(CAUSE[k] || k) + ' ' + cnt[k]).join('・') + '</p>' +
    '<h2>難しさごとの正答率（1回目で正解）</h2><table><thead><tr><th>難しさ</th><th>答えた</th><th>正答率</th></tr></thead><tbody>' +
    st.tiers.map((t) => '<tr><td>' + esc(t.tier) + '</td><td>' + t.asked + '</td><td>' + pct(t.first_ok_rate) + '</td></tr>').join('') + '</tbody></table>' +
    '<h2>試合</h2><table><thead><tr><th>いつ</th><th>人数</th><th>本数・ライフ・時間</th><th>終わり方</th><th>解除・ミス・かかった秒</th></tr></thead><tbody>' +
    st.plays.map((p) => '<tr><td>' + whenText(p.at) + (p.fes ? '（文化祭）' : '') + '</td><td>' + p.players + '</td><td>' + p.codes + '本・' + p.lives + '・' + p.timer_sec + '秒</td><td>' +
      esc(CAUSE[p.cause] || p.cause || '') + '</td><td>' + (p.solved == null ? '' : p.solved) + '・' + (p.misses == null ? '' : p.misses) + '・' + p.elapsed_sec + '</td></tr>').join('') + '</tbody></table>' +
    '<h2>問題ごと（答えた数の多い順）</h2><table><thead><tr><th>問題</th><th>難しさ</th><th>答えた</th><th>正答率</th><th>外した</th></tr></thead><tbody>' +
    st.questions.map((q) => '<tr' + (q.first_ok_rate != null && q.first_ok_rate < 50 ? ' class="b"' : '') + '><td>' + esc(q.q) + '</td><td>' + esc(q.tier) + '</td><td>' + q.asked + '</td><td>' +
      pct(q.first_ok_rate) + '</td><td>' + q.wrong + '</td></tr>').join('') + '</tbody></table>';
}

const REASON = { blocked: '使えない言葉', long: '長い', empty: '空' };
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
/** 日本の時刻で「10/24 13:05」 */
function whenText(at) {
  const d = new Date(+at + 9 * 3600 * 1000);
  const z = (n) => (n < 10 ? '0' : '') + n;
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
}
function namesPage(title, body) {
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>' + esc(title) + '</title><style>' +
    'body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#FFF6DC;color:#1A1A1A}h1{font-size:22px;margin:4px 0 8px}' +
    '.n,.f{margin:4px 0;font-size:14px}a{color:#1A1A1A;font-weight:700}table{width:100%;border-collapse:collapse;margin-top:10px;background:#fff;font-size:15px}' +
    'th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #EEE;word-break:break-all}th{font-size:12px;color:#555}tr.b td{background:#FFE9E6}' +
    '</style></head><body><h1>' + esc(title) + '</h1>' + body + '</body></html>';
}

module.exports = { mountFesRoutes };
