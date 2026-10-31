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
const Edge = require('./room-edge');

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
    await sleep(t.win, 9000);
    assert(!t.doc.querySelector('[data-tv-stuck], #scr-v2-fes-tv .v2-why'), '入り直して着いたら、画面には何も出さない（F5 の一言も出ない）');
    t.win.close();
  });

  await r.test('入り直しても返事が来ない → 入り直しは1回だけ・ログも1行だけ（何度も聞き直さない）。参加者の入る画面へは落ちない', async () => {
    const t = await TV(['none', 'none']);
    await sleep(t.win, 14000);
    assert(!t.doc.querySelector('[data-tv-stuck]'), '入り直してから8秒たつまでは、F5 の一言を出さない');
    await sleep(t.win, 4000);
    const h = t.doc.querySelector('.v2.v2-tvhint[data-tv-stuck]');
    assert(h && h.textContent === 'F5 で開き直してください', '入り直してさらに8秒着かない → TV の隅に「F5 で開き直してください」（' + (h && h.textContent) + '）');
    assertEqual(t.doc.querySelectorAll('[data-tv-stuck]').length, 1, '一言は1つ');
    const fs = parseFloat(t.win.getComputedStyle(h).fontSize);
    assert(fs >= 48, '字は 48px 以上（離れた係が読める・10/31 の指示。いま ' + fs + 'px）');
    assertEqual(joins(t.win), 2, '入る（最初）＋入り直し1回だけ');
    assertEqual(t.sent.length, 1, 'ログは1行だけ（F5 の一言でログは増やさない）');
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
    assert(!t.doc.querySelector('[data-tv-stuck]'), 'F5 の一言も出ない');
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

  await r.test('サーバー：入る返事が落ちた TV が、同じつなぎのまま memberId なしで入り直す → 古い TV の席を消す（席は1つ）。別の TV（別のつなぎ）は消さない', async () => {
    const srv = await Edge.startTestServer();
    try {
      const { host } = await Edge.makeRoom(srv, 1);
      const 席 = () => Array.from(srv.store.get(host.code).members.values()).filter((m) => m.role === 'bigscreen');
      const tv = await Edge.device(srv.url);
      const a = await tv.call('room:join', { code: host.code, name: 'TV', role: 'bigscreen' });   // この返事が TV に届かなかった
      const b = await tv.call('room:join', { code: host.code, name: 'TV', role: 'bigscreen' });   // 見張りの入り直し（memberId を知らない）
      assertEqual(a.ok && b.ok, true, '2回とも入れる');
      assertEqual(席().length, 1, 'TV の席は1つ（' + 席().map((m) => m.id).join(',') + '）');
      assertEqual(席()[0].id, b.memberId, '残るのは新しい席');
      const tv2 = await Edge.device(srv.url);
      await tv2.call('room:join', { code: host.code, name: 'TV', role: 'bigscreen' });
      assertEqual(席().length, 2, '別の TV（2台目）は消さない');
      [tv, tv2, host].forEach((d) => d.close && d.close());
    } finally { await srv.close(); }
  });

  r.finish();
})();
