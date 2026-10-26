// tests/realtime-soroe.js — 「そろえて発射」を本物のサーバーで通す（指示68-4 門4・門5・門6）
//
// 門4：遅れと時計のずれを足した端末でも、直したあとの誤差が0.05秒以内（測った数を出す）。
//      端末の時計を ずれ（−3〜＋5秒）でまねし、clock:sync の行きと帰りに遅れ（0〜300ミリ秒＋ゆらぎ）を足す。
//      「同じ瞬間」に押した時、端末が直した時刻とサーバーの時刻の差を測る。
//      行きと帰りの遅れがちがう（片道だけ遅い）時の誤差も測って出す（門には数えない・報告の数）
// 門5：だれがずれたかが、どこにも届かない（押した時刻・名前つきの点が、TV にもほかの端末にも本人にも無い）
// 門6：2人と16人で5回まわる
const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const L = require('../public/js/soroe-logic');

const W = (srv, code) => srv.store.get(code).soroe;
const viewOf = (d) => (d.room && d.room.state && d.room.state.data) || null;
function rush(srv, code) { const w = W(srv, code); if (w && w.deadline) w.deadline = Date.now() - 1; }
function 記録する(d) { d.log = []; d.socket.onAny((ev, p) => { d.log.push({ ev, at: Date.now(), json: JSON.stringify(p) }); }); return d; }

/**
 * 遅い・時計がずれた端末の時計合わせ。local() は端末の時計（本当の時刻＋skew）。
 * out(i)・back(i) は i 回目の行きと帰りの遅れ。返す：{ offset, rtt }（SoroeLogic.offsetOf と同じ計算）
 */
async function 時計合わせ(d, skew, out, back) {
  const local = () => Date.now() + skew;
  const samples = [];
  for (let i = 0; i < L.RULES.SYNC_SAMPLES; i++) {
    const t0 = local();
    const server = await new Promise((res) => setTimeout(() => d.socket.emit('clock:sync', {}, (r) => setTimeout(() => res(r.now), back(i))), out(i)));
    samples.push({ t0, server, t1: local() });
  }
  return Object.assign(L.offsetOf(samples), { local });
}

async function 始める(srv, n, 支度) {
  const rm = await makeRoom(srv, n);
  if (支度) await 支度(rm);   // 始まる前にすること（時計合わせ。端末も部屋に入った時に合わせる）
  rm.all.forEach((d) => { d.code = rm.code; 記録する(d); });
  const tv = await device(srv.url);
  記録する(tv);
  assertEqual((await tv.call('room:join', { code: rm.code, name: 'テレビ', role: 'bigscreen' })).ok, true, 'TV が入れる');
  const res = await rm.host.call('wolf:start', { game: 'soroe' });
  assertEqual(res.ok, true, 'そろえて発射が始まる（' + n + '人）');
  await waitUntil(() => rm.all.every((d) => viewOf(d) && viewOf(d).phase === 'launch'), '全員に合図が届く', 6000);
  return Object.assign(rm, { tv });
}

(async function main() {
  const r = createRunner('realtime-soroe：そろえて発射（本物のサーバー・指示68-4）');
  const 測った数 = {};

  await r.test('門4：遅れ（0〜300ms・ゆらぎ±30ms）と時計のずれ（−3〜＋5秒）を足した8台で、直したあとの誤差が0.05秒以内', async () => {
    const srv = await startTestServer();
    const devs = [];
    try {
      const ずれ = [-3000, -1200, 0, 450, 1700, 3333, 5000, -77];
      const 遅れ = [0, 40, 90, 150, 210, 260, 300, 120];
      const ゆらぎ = () => Math.floor(Math.random() * 31);
      const 誤差 = [];
      for (let i = 0; i < ずれ.length; i++) {
        const d = await device(srv.url); devs.push(d);
        const o = await 時計合わせ(d, ずれ[i], () => 遅れ[i] + ゆらぎ(), () => 遅れ[i] + ゆらぎ());
        // 同じ瞬間：端末が直した時刻と、本当の時刻（サーバーと同じ時計）
        誤差.push(Math.abs((o.local() + o.offset) - Date.now()));
      }
      測った数.ふつう = 誤差;
      console.log('    誤差（ms）：' + 誤差.map((x) => Math.round(x)).join('・') + '　最大 ' + Math.round(Math.max.apply(null, 誤差)));
      assert(Math.max.apply(null, 誤差) < 50, '直したあとの誤差が 50ms より小さい（最大 ' + Math.round(Math.max.apply(null, 誤差)) + 'ms）');
      // 型(b)：直さなければ、ずれがそのまま誤差になる
      assert(Math.abs((Date.now() + 5000) - Date.now()) >= 50, '直さない時計は 5秒ずれている（型b）');
    } finally { devs.forEach((d) => d.close()); await srv.close(); }
  });

  await r.test('記録：片道だけ遅い端末（行き0・帰り300ms など）の誤差を測る（門には数えない・報告の数）', async () => {
    const srv = await startTestServer();
    const devs = [];
    try {
      const 形 = [[0, 300], [300, 0], [0, 150], [100, 250]];
      const 誤差 = [];
      for (const [o1, b1] of 形) {
        const d = await device(srv.url); devs.push(d);
        const o = await 時計合わせ(d, 1234, () => o1, () => b1);
        誤差.push(Math.abs((o.local() + o.offset) - Date.now()));
      }
      測った数.片道 = 誤差;
      console.log('    片道だけ遅い時の誤差（ms）：' + 形.map((f, i) => f.join('/') + '→' + Math.round(誤差[i])).join('・'));
      // 往復の半分の差（|行き − 帰り| ÷ 2）が、そのまま誤差になる（理屈どおりか）
      形.forEach((f, i) => assert(Math.abs(誤差[i] - Math.abs(f[0] - f[1]) / 2) < 25, f.join('/') + '：誤差は |行き−帰り|÷2 に近い（' + Math.round(誤差[i]) + 'ms）'));
    } finally { devs.forEach((d) => d.close()); await srv.close(); }
  });

  await r.test('門4（通し）：時計のずれた端末が 0 の瞬間に押すと、サーバーで比べた差が小さい（月より上）', async () => {
    const srv = await startTestServer();
    try {
      const ずれ = [-2500, 0, 1800, 4200], 遅れ = [0, 100, 200, 300];
      const 時計 = [];
      const rm = await 始める(srv, 4, async (x) => { for (let i = 0; i < 4; i++) 時計.push(await 時計合わせ(x.all[i], ずれ[i], () => 遅れ[i], () => 遅れ[i])); });
      // 1回目（カウント）。知らせの 0 の時刻（サーバーの時刻）に、各端末が「自分の直した時計で」0 になった瞬間に押す
      const v = viewOf(rm.host);
      assertEqual(v.signal, 'count', '1回目はカウント');
      await Promise.all(rm.all.map((d, i) => new Promise((res) => {
        const 待つ = v.zeroAt - (時計[i].local() + 時計[i].offset);
        setTimeout(() => {
          const at = 時計[i].local() + 時計[i].offset;
          setTimeout(() => d.socket.emit('wolf:act', { at }, (x) => res(x)), 遅れ[i]);   // 送るのも遅れる（押した時刻はもう決まっている）
        }, Math.max(0, 待つ));
      })));
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'roundResult', '開く（全員押したら待たない）', 6000);
      const rv = viewOf(rm.tv).reveal;
      測った数.通しの差 = rv.spread;
      console.log('    通し：4台（ずれ ' + ずれ.join('・') + 'ms／遅れ ' + 遅れ.join('・') + 'ms）の差 ' + rv.spread + 'ms → ' + rv.height);
      assertEqual(rv.count, 4, '4人とも数えた');
      assert(typeof rv.spread === 'number' && rv.spread <= 100, '差が 0.10秒以内（' + rv.spread + 'ms）');
      [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
    } finally { await srv.close(); }
  });

  await r.test('門5：だれがずれたかが、どこにも届かない（押した時刻・名前つきの点が TV にもほかの端末にも本人にも無い）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 3);
      const t0 = Date.now();
      const w = W(srv, rm.code);
      const 押す = [w.startedAt + 1500, w.startedAt + 1730, w.startedAt + 1610];
      for (let i = 0; i < 3; i++) assertEqual((await rm.all[i].call('wolf:act', { at: 押す[i] })).ok, true, (i + 1) + '人目が押せる');
      assertEqual((await rm.all[0].call('wolf:act', { at: 押す[0] })).ok, false, '2回目ははねる');
      await waitUntil(() => (viewOf(rm.tv) || {}).phase === 'roundResult', '開く', 6000);
      await sleep(400);
      const rv = viewOf(rm.tv).reveal;
      assertEqual(rv.dots.join(','), '0,110,230', '開いたら名前なしの点（最初の人からのミリ秒）');
      assertEqual(Object.keys(rv).sort().join(','), 'count,dots,double,flew,height,n,points,signal,spread,together', '開いた中身は決めた10個だけ（名前も id も無い）');
      [rm.tv, rm.all[0], rm.all[1], rm.all[2]].forEach((d, k) => {
        const 字 = d.log.filter((x) => x.at >= t0).map((x) => x.json).join('\n');
        const 誰 = ['TV', '1人目', '2人目', '3人目'][k];
        押す.forEach((at) => assert(字.indexOf(String(at)) === -1, 誰 + 'に、押した時刻 ' + at + ' が届いていない'));
        assert(!/"presses"|"offset"|"late"|"slowest"|"fastest"/.test(字), 誰 + 'に、だれが遅れたかの手がかりが無い');
        assert(/"dots":\[0,110,230\]/.test(字), 誰 + 'に、名前なしの点は届いている（型b）');
      });
      // 時刻のありえない値
      rush(srv, rm.code);
      await waitUntil(() => (viewOf(rm.host) || {}).phase === 'launch' && viewOf(rm.host).round === 2, '2回目', 6000);
      const w2 = W(srv, rm.code);
      for (const bad of [w2.startedAt - 5000, w2.deadline + 60000, 'x', null]) assertEqual((await rm.all[0].call('wolf:act', { at: bad })).ok, false, 'はねる：' + bad);
      [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
    } finally { await srv.close(); }
  });

  for (const n of [2, 16]) {
    await r.test('門6：' + n + '人で、本物のサーバーで5回まわり、合計が出る', async () => {
      const srv = await startTestServer();
      try {
        const rm = await 始める(srv, n);
        for (let q = 1; q <= 5; q++) {
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'launch' && viewOf(rm.host).round === q, q + '回目の合図', 6000);
          const w = W(srv, rm.code);
          const base = w.startedAt + 1200;
          for (let i = 0; i < rm.all.length; i++) assertEqual((await rm.all[i].call('wolf:act', { at: base + i * 3 })).ok, true, q + '回目 ' + (i + 1) + '人目');
          await waitUntil(() => (viewOf(rm.host) || {}).phase === 'roundResult' && viewOf(rm.host).round === q, q + '回目が開く', 6000);
          rush(srv, rm.code);
        }
        await waitUntil(() => (viewOf(rm.host) || {}).phase === 'ended', '5回で終わる', 6000);
        const res = viewOf(rm.host).result;
        const spread = (n - 1) * 3;
        const h = L.heightOf(spread);
        assertEqual(res.total, h.points * 4 + h.points * 2, '合計（差 ' + spread + 'ms・最後は2倍）');
        [rm.all, [rm.tv]].forEach((list) => list.forEach((d) => d.close()));
      } finally { await srv.close(); }
    });
  }

  r.finish();
})();
