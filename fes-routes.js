// fes-routes.js — 文化祭の部屋のための道（指示66-2）。server.js と検査の両方がここを mount する
//
//   GET /tv                  … ふだんの部屋の TV の入口（指示66-3。コードを入れる画面へ）
//   GET /fes                 … いまの文化祭の部屋へ飛ぶ（机や壁のポスターのQRはここ。部屋を作り直しても使える）
//   GET /api/fes/names       … 名前の記録（入力された名前と、はじいた名前）。**くまくん（owner）だけ**
//   GET /fes/names           … 同じ記録を読む軽い画面（指示66-3。くまくんだけ。?only=blocked ではじいた名前だけ）
//   GET /api/fes/feedback    … 感想（★と自由文）。**くまくんと先生（owner・staff）だけ**
//   GET /api/fes/bomb-stats  … クイズ解除の記録（終わり方・問題ごとの正答率。名前は無い）。**くまくんだけ**（指示68-2）
//   GET /fes/bomb-stats      … 同じ記録を読む軽い画面（くまくんだけ）
//
// だれが係かは realtime.js の fesRoleOf（.env の FES_OWNER・FES_STAFF）。ログインしていなければ 401、
// 係でなければ 403。中身を返す前に、必ず1か月より前のものを掃く（fes-store.js の list* が掃く）

'use strict';

function mountFesRoutes(app, io) {
  // 指示66-3：ふだんの部屋の TV の入口。進行役のスマホの「TVに映す」がこのアドレスを出す（TV のリモコンで打てる短さ）。
  // 開くとコードを入れる画面になり、入れるとその部屋の TV になる（名前は聞かない）
  app.get('/tv', (req, res) => res.redirect(302, '/?tv=1'));
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
