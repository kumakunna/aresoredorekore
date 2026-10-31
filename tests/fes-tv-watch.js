// tests/fes-tv-watch.js — 文化祭の TV を開いて 8秒たっても文化祭の画面に着かない時（10/31 くまくん「手がかりを取る」）
//
// 10/31 12:45 の本番で1回だけ、TV が真っ白（scr-v2-room）のまま止まった。手元では再現できなかった（tools/fes-tv-first.js）。
// 直す前に手がかりを取る：
//   1. 8秒で着かない時、サーバーのログに1行残す（今の画面・入る返事が来たか・版・つなぎ直した回数）
//   2. 同じ時、TV が自分で1回だけ入り直す（画面には何も出さない）
// 「赤を先に」：入る返事が届かない状態を、疑似 socket（opts.rtSeed で読み込む前に返事を置く）で作る
const express = require('express');
const http = require('http');
const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');
const FesScenes = require('../tools/v2-lab/fes-scenes');
const { mountFesRoutes } = require('../fes-routes');

const URL = 'http://localhost/?room=TST754&fes=1&tv=1';
const act = (doc) => (doc.querySelector('.screen.active') || {}).id;
const joins = (win) => win.__rtFake.emits.filter((e) => e.name === 'room:join').length;

/** 入る返事の出し方：'none'＝来ない／'ok'＝TV の待合の部屋／'nofes'＝返事は来たが文化祭の印が無い部屋（画面が違う所へ行く）。順に使う（足りなければ最後のを使う） */
function 返事(順) {
  const room = FesScenes.view('fes2-tv-lobby').room;
  const nofes = Object.assign({}, room); delete nofes.fes;
  return 'window.__tvJoin = 0; window.__rtFake.replies = { "room:join": function(p, cb){' +
    ' var k = ' + JSON.stringify(順) + '[Math.min(window.__tvJoin++, ' + (順.length - 1) + ')];' +
    ' if (k === "none") return undefined;' +
    ' var room = k === "nofes" ? ' + JSON.stringify(nofes) + ' : ' + JSON.stringify(room) + ';' +
    // 本物と同じく、返事は「つながった」のあとに届く（その場で返すと、つながった時の自動の入り直しが走って数が狂う）
    ' setTimeout(function(){ cb({ ok: true, code: "TST754", memberId: "tv", room: room }); }, 30); return undefined; } };';
}
async function TV(順) {
  const t = await launch({ url: URL, fakeSocket: true, rtSeed: 返事(順), noDoorWait: true });
  t.sent = [];
  t.win.fetch = async (u, o) => { if (/tv-stuck/.test(String(u))) t.sent.push(JSON.parse((o && o.body) || '{}')); return { ok: true, json: async () => ({ ok: true }) }; };
  return t;
}

(async function main() {
  const r = createRunner('fes-tv-watch：TV が8秒で着かない時の手がかりと、1回だけの入り直し');

  await r.test('入る返事が来ない → 8秒でログに1行（画面・返事が来ない・版・つなぎ直し）を送り、1回だけ入り直して TV の画面に着く', async () => {
    const t = await TV(['none', 'ok']);
    await waitFor(t.win, () => act(t.doc) === 'scr-v2-fes-tv' && joins(t.win) >= 2, 12000, 'TV の画面（いま ' + act(t.doc) + '）');
    assertEqual(joins(t.win), 2, '入る（最初）＋入り直し1回');
    assertEqual(t.sent.length, 1, 'ログは1行');
    const s = t.sent[0];
    assertEqual(s.replied, false, '入る返事は来ていない');
    assert(typeof s.scr === 'string' || s.scr === null, '今の画面の名前（' + s.scr + '）');
    assertEqual(s.v, t.win.AppVersion.VERSION, '版');
    assertEqual(s.reconnects, 0, 'つなぎ直した回数');
    assertEqual(s.code, 'TST754', '部屋');
    await sleep(t.win, 1500);
    assert(!t.doc.querySelector('#scr-v2-fes-tv .v2-why, #scr-v2-fes-tv [data-tv-stuck]'), '画面には何も出さない');
    t.win.close();
  });

  await r.test('入り直しても返事が来ない → 入り直しは1回だけ・ログも1行だけ（何度も聞き直さない）。参加者の入る画面へは落ちない', async () => {
    const t = await TV(['none', 'none']);
    await sleep(t.win, 19000);
    assertEqual(joins(t.win), 2, '入る（最初）＋入り直し1回だけ');
    assertEqual(t.sent.length, 1, 'ログは1行だけ');
    assert(act(t.doc) !== 'scr-v2-fes-join', 'TV に参加者の入る画面（名前を打つ）を出さない（いま ' + act(t.doc) + '）');
    t.win.close();
  });

  await r.test('入る返事は来たのに文化祭の画面でない（本番の scr-v2-room に近い形）→ ログに「返事が来た」と今の画面・1回だけ入り直す', async () => {
    const t = await TV(['nofes', 'ok']);
    await waitFor(t.win, () => t.sent.length >= 1, 12000, 'ログ');
    assertEqual(t.sent[0].replied, true, '入る返事は来た');
    assert(t.sent[0].scr && t.sent[0].scr !== 'scr-v2-fes-tv', '今の画面（' + t.sent[0].scr + '）');
    await waitFor(t.win, () => act(t.doc) === 'scr-v2-fes-tv', 4000, '入り直して TV の画面（いま ' + act(t.doc) + '）');
    await sleep(t.win, 1000);
    assertEqual(t.sent.length, 1, 'ログは1行');
    t.win.close();
  });

  await r.test('すぐ着いた TV は、ログを送らず入り直さない', async () => {
    const t = await TV(['ok']);
    await waitFor(t.win, () => act(t.doc) === 'scr-v2-fes-tv', 6000, 'TV の画面');
    await sleep(t.win, 9000);
    assertEqual(joins(t.win), 1, '入るのは1回');
    assertEqual(t.sent.length, 0, 'ログは送らない');
    t.win.close();
  });

  await r.test('サーバー：/api/fes/tv-stuck はログに1行（改行は消す・長い字は切る）', async () => {
    const app = express(); app.use(express.json());
    mountFesRoutes(app, {});
    const srv = http.createServer(app);
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const url = 'http://127.0.0.1:' + srv.address().port;
    const lines = [], orig = console.log;
    console.log = (...a) => { lines.push(a.join(' ')); };
    let res;
    try {
      res = await fetch(url + '/api/fes/tv-stuck', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scr: 'scr-v2-room\n偽の行', replied: true, v: 'v2.13', reconnects: 2, code: 'U3GU55' }) });
    } finally { console.log = orig; }
    srv.close();
    assertEqual(res.status, 200, '受け取る');
    const mine = lines.filter((l) => /tv-stuck|TV が8秒/.test(l));
    assertEqual(mine.length, 1, '1行（' + lines.join(' / ') + '）');
    const l = mine[0];
    assert(!/\n/.test(l), '改行が無い');
    assert(/scr-v2-room/.test(l) && /来た/.test(l) && /v2\.13/.test(l) && /2回/.test(l) && /U3GU55/.test(l), '画面・返事・版・つなぎ直し・部屋（' + l + '）');
  });

  r.finish();
})();
