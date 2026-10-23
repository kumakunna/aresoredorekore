// fes-routes.js — 文化祭の部屋のための道（指示66-2）。server.js と検査の両方がここを mount する
//
//   GET /fes                 … いまの文化祭の部屋へ飛ぶ（机や壁のポスターのQRはここ。部屋を作り直しても使える）
//   GET /api/fes/names       … 名前の記録（入力された名前と、はじいた名前）。**くまくん（owner）だけ**
//   GET /api/fes/feedback    … 感想（★と自由文）。**くまくんと先生（owner・staff）だけ**
//
// だれが係かは realtime.js の fesRoleOf（.env の FES_OWNER・FES_STAFF）。ログインしていなければ 401、
// 係でなければ 403。中身を返す前に、必ず1か月より前のものを掃く（fes-store.js の list* が掃く）

'use strict';

function mountFesRoutes(app, io) {
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
  app.get('/api/fes/feedback', gate('staff'), (req, res) => res.json({ feedback: io.fesStore.listFeedback() }));
}

module.exports = { mountFesRoutes };
