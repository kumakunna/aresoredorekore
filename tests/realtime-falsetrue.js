// tests/realtime-falsetrue.js — 「False or True」を、本物のサーバーと socket.io で通す（指示53）
//
// **なぜ単体の検査（tests/falsetrue-room.js）だけでは足りないか。**
// あちらは進行役を直に呼ぶので、`advance()` は必ず走る。
// ところが実サーバーでは、段階を進めるのは**芯の見回り**（realtime.js の0.5秒ごとのタイマー）で、
// そこは `w.deadline` を見て `advance` を呼ぶ。
// 「進行役は正しいのに、芯から呼ばれない」は単体では絶対に出ない——
// 実際に指示53の実機検証で、2戦目が `pick` のまま時計が 00:00 で止まった。
//
// だから、ここでは**時計に任せて進むこと**そのものを見る。
// 待ち時間を実時間で待つと1件で数分かかるので、締め切りを過去へずらして追い越す
// （落とし穴24：遊びの数字は縮めない。早送りは検査の側に作る）。

const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const L = require('../public/js/falsetrue-logic');

function roomOf(srv, code) { return srv.store.get(code); }
function stateOf(srv, code) { return roomOf(srv, code).falsetrue; }
function viewOf(dev) {
  const st = dev.room && dev.room.state;
  return (st && st.data) || null;
}
/** 締め切りを「今」まで引く。**進むのは芯の見回りにやらせる**（そこが見たい所） */
function rush(srv, code) {
  const w = stateOf(srv, code);
  if (w && w.deadline) w.deadline = Date.now() - 1;
}
/** その人の端末に届いている秘密 */
const youOf = (d) => d.you || null;

async function 始める(srv, n, cfg) {
  const rm = await makeRoom(srv, n);
  const res = await rm.host.call('wolf:start', Object.assign({ game: 'falsetrue', talkSec: 30 }, cfg || {}));
  assertEqual(res.ok, true, 'False or True が始まる');
  await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase === 'pick', 'pick に入る');
  return rm;
}
const 端末 = (rm, id) => rm.all.find((d) => d.memberId === id);

(async function main() {
  const r = createRunner('realtime-falsetrue：False or True（本物のサーバー）');

  await r.test('始まると全員に pick が届き、ケースの数と内訳が人数どおり', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      await waitUntil(() => rm.all.every((d) => viewOf(d) && viewOf(d).phase === 'pick'), '全員に届く');
      rm.all.forEach((d) => {
        const v = viewOf(d);
        assertEqual(v.cases.length, 4, d.name + ' に4枚のケースが届く');
        assertEqual(v.trueTotal, 1, d.name + ' に true の数が届く');
        assertEqual(v.falseTotal, 3, d.name + ' に false の数が届く');
      });
      // **中身は誰にも届いていない**
      rm.all.forEach((d) => {
        assert(JSON.stringify(viewOf(d)).indexOf('contents') === -1,
          d.name + ' の公開スナップショットに中身の入れ物が無い');
      });
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('**誰も押さなくても、芯の見回りが段階を進める**（実機で止まった形）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      const 通った = [];
      // 1ラウンドぶん、時計だけで進める。押す人は1人もいない
      for (let i = 0; i < 12; i++) {
        const v = viewOf(rm.host);
        if (!v) break;
        if (通った[通った.length - 1] !== v.phase) 通った.push(v.phase);
        if (v.phase === 'ended') break;
        const 前 = v.phase;
        rush(srv, rm.code);
        // **芯が進めるのを待つ。**ここで進まなければ、それが実機で起きた止まり方
        await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase !== 前,
          前 + ' から先へ進む（芯の見回りが advance を呼ぶ）');
      }
      ['pick', 'peek', 'face', 'talk', 'decide', 'open'].forEach((p) => {
        assert(通った.indexOf(p) !== -1, p + ' を通った（実際: ' + 通った.join('→') + '）');
      });
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('決着まで通る。生存者は全員勝ちで、ラウンド数は人数−1', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      for (let i = 0; i < 60; i++) {
        const v = viewOf(rm.host);
        if (v && v.phase === 'ended') break;
        const 前 = v && v.phase;
        rush(srv, rm.code);
        await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase !== 前, 前 + ' から進む');
      }
      const v = viewOf(rm.host);
      assertEqual(v.phase, 'ended', '決着した');
      assertEqual(v.endReason, 'last', '「1人残り」で終わる');
      assert(v.survivors.length >= 1, '生存者が1人以上いる');
      assertEqual(v.history.length, 3, '4人なら3ラウンド');
      // 決着でだけ、ふりかえりが配られる
      assert(v.history.every((h) => typeof h.content === 'boolean'), '決着後は中身が入っている');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('中身が届くのは持ち主の端末だけ（本物の socket で確かめる）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      const w = stateOf(srv, rm.code);
      const 持ち主 = w.pickerId;
      // 持ち主が本当に1枚えらぶ（本物の操作）
      const d = 端末(rm, 持ち主);
      // **その端末に届くまで待つ**（部屋の知らせは端末ごとに別々に届く・落とし穴18）
      await waitUntil(() => viewOf(d) && viewOf(d).phase === 'pick', '持ち主の端末に pick が届く');
      const res = await d.call('wolf:act', { pick: viewOf(d).cases[0] });
      assertEqual(res.ok, true, '持ち主はケースをえらべる');
      await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase === 'peek', 'peek に入る');
      await waitUntil(() => youOf(d) && youOf(d).phase === 'peek', '持ち主に秘密が届く');

      assertEqual(typeof youOf(d).myContent, 'boolean', '持ち主には中身が届く');
      let 他 = 0;
      rm.all.filter((x) => x.memberId !== 持ち主).forEach((x) => {
        assertEqual((youOf(x) || {}).myContent, null, x.name + ' には中身が届かない');
        他++;
      });
      assertEqual(他, 3, '持ち主でない3人ぶんを見た');
      rm.all.forEach((x) => x.close());
    } finally { await srv.close(); }
  });

  await r.test('えらぶ人でない端末が送っても、サーバーが断る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      const w = stateOf(srv, rm.code);
      const よそ者 = rm.all.find((d) => d.memberId !== w.pickerId);
      const res = await よそ者.call('wolf:act', { pick: 1 });
      assertEqual(res.ok, false, 'えらぶ人でなければ断られる');
      assertEqual(stateOf(srv, rm.code).heldNo, null, 'ケースは動いていない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('話し合いは、対面の2人がそろって押すと早く切り上がる（本人の裁定④）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      // talk まで、時計で進める
      for (let i = 0; i < 6; i++) {
        const v = viewOf(rm.host);
        if (v.phase === 'talk') break;
        const 前 = v.phase;
        rush(srv, rm.code);
        await waitUntil(() => viewOf(rm.host).phase !== 前, 前 + ' から進む');
      }
      const v = viewOf(rm.host);
      assertEqual(v.phase, 'talk', '話し合いに入った');
      const 持ち主 = 端末(rm, v.holderId), 相手 = 端末(rm, v.oppId);
      // 片方だけでは切り上がらない
      assertEqual((await 相手.call('wolf:act', { talkDone: true })).ok, true, '相手は押せる');
      await sleep(250);
      assertEqual(viewOf(rm.host).phase, 'talk', '**片方だけでは切り上がらない**');
      // 2人そろうと進む
      assertEqual((await 持ち主.call('wolf:act', { talkDone: true })).ok, true, '持ち主も押せる');
      await waitUntil(() => viewOf(rm.host).phase === 'decide', '2人そろうと決める段階へ');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('「奪う」を押すと、結果表どおりに相手の運命が決まる（実機で疑った所）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      for (let i = 0; i < 8; i++) {
        const v = viewOf(rm.host);
        if (v.phase === 'decide') break;
        const 前 = v.phase;
        rush(srv, rm.code);
        await waitUntil(() => viewOf(rm.host).phase !== 前, 前 + ' から進む');
      }
      const v = viewOf(rm.host);
      assertEqual(v.phase, 'decide', '決める段階に入った');
      const w = stateOf(srv, rm.code);
      const 持ち主 = w.pickerId, 相手 = w.oppId;
      const 中身 = w.contents[w.heldNo - 1];

      const res = await 端末(rm, 相手).call('wolf:act', { take: true });
      assertEqual(res.ok, true, '相手は「奪う」を押せる');
      await waitUntil(() => viewOf(rm.host).phase === 'open', '押すと、そのまま結果へ進む');

      const last = viewOf(rm.host).last;
      assertEqual(last.taken, true, '**サーバーに「奪った」として届いている**');
      assertEqual(last.decidedId, 相手, '奪った時に決まるのは相手（結果表どおり）');
      assertEqual(last.fate, 中身 ? 'alive' : 'out', '生存かどうかは中身で決まる');
      assertEqual(last.content, 中身, '開いた中身が、サーバーの持っていたものと一致する');
      assertEqual(stateOf(srv, rm.code).pickerId, 持ち主, '奪われた側（持ち主）が続けてえらぶ');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('**2戦目も、時計だけで進む**（「もう一度」で止まらない）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 4);
      // 1戦目を決着まで
      for (let i = 0; i < 60; i++) {
        const v = viewOf(rm.host);
        if (v && v.phase === 'ended') break;
        const 前 = v && v.phase;
        rush(srv, rm.code);
        await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase !== 前, '1戦目：' + 前 + ' から進む');
      }
      assertEqual(viewOf(rm.host).phase, 'ended', '1戦目が決着した');

      // 「もう一度」＝同じ設定でもう一戦（実機ではここから止まった）。
      // **端末がやっているとおりの順で送る**——前の進行を捨ててから始める。
      // `wolf:start` だけだと `already_started` で断られる（芯が room[key] を見ている）
      const cleared = await rm.host.call('room:setState', { reset: true, phase: 'lobby' });
      assertEqual(cleared.ok, true, '前の進行を捨てられる');
      const again = await rm.host.call('wolf:start', { game: 'falsetrue', talkSec: 30 });
      assertEqual(again.ok, true, '2戦目を始められる');
      await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase === 'pick', '2戦目が pick から始まる');
      assertEqual(viewOf(rm.host).cases.length, 4, '2戦目もケースは4枚');
      assertEqual(viewOf(rm.host).history, null, '2戦目のふりかえりは空（前の試合が残っていない）');

      // **ここが本題**：2戦目でも、押す人が1人もいなくても段階が進む
      const 前 = viewOf(rm.host).phase;
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase !== 前,
        '2戦目：芯の見回りが advance を呼ぶ（実機ではここで止まった）');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('Q10：話し合いの時計は、全端末と大画面で同じものを見る（締め切りはサーバー）', async () => {
    const srv = await startTestServer();
    try {
      // 5人で作り、1人を大画面にする（**進行役は大画面になれない**ので、ホスト以外を選ぶ）
      const rm = await makeRoom(srv, 5);
      const 画面役 = rm.guests[rm.guests.length - 1];
      const 役 = await 画面役.call('room:setRole', { role: 'bigscreen' });
      assertEqual(役.ok, true, '大画面になれる');

      const res = await rm.host.call('wolf:start', { game: 'falsetrue', talkSec: 30 });
      assertEqual(res.ok, true, '4人＋大画面で始まる');
      await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase === 'pick', 'pick に入る');
      assertEqual(viewOf(rm.host).cases.length, 4, '大画面は人数に数えない（ケースは4枚）');

      // 話し合いまで、時計で進める
      for (let i = 0; i < 6; i++) {
        const v = viewOf(rm.host);
        if (v.phase === 'talk') break;
        const 前 = v.phase;
        rush(srv, rm.code);
        await waitUntil(() => viewOf(rm.host).phase !== 前, 前 + ' から進む');
      }
      assertEqual(viewOf(rm.host).phase, 'talk', '話し合いに入った');
      await waitUntil(() => rm.all.every((d) => viewOf(d) && viewOf(d).phase === 'talk'),
        '全端末と大画面に、話し合いが届く');

      // **締め切りはサーバーが1つだけ持つ。**端末はそれを映すだけ
      const w = stateOf(srv, rm.code);
      assert(w.deadline, 'サーバーが締め切りを持っている');
      const 残り = rm.all.map((d) => viewOf(d).remainingMs);
      const 幅 = Math.max.apply(null, 残り) - Math.min.apply(null, 残り);
      assert(幅 <= 1500, '全端末の残り時間がそろっている（ばらつき ' + 幅 + 'ms）');
      // 大画面にも同じものが届く
      assertEqual(typeof viewOf(画面役).remainingMs, 'number', '大画面にも残り時間が届く');
      // **大画面はプレイヤーではないので、秘密は1つも受け取らない**
      assertEqual(youOf(画面役), null, '大画面には秘密が届かない');
      // どの端末の公開ビューにも中身が入っていない
      rm.all.forEach((d) => {
        assert(JSON.stringify(viewOf(d)).indexOf('myContent') === -1,
          d.name + ' の公開スナップショットに中身が無い');
      });
      // 締め切りを追い越せば、全端末がそろって次の段階へ行く
      rush(srv, rm.code);
      await waitUntil(() => rm.all.every((d) => viewOf(d) && viewOf(d).phase === 'decide'),
        '締め切りで、全端末がそろって決める段階へ');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('Q14：「読んだか」の鍵が、どの経路でも同じ（modeId が消えても割れない）', async () => {
    // 第48弾：端末の鍵は `rtRulesKey()` ＝ `modeId ?? gameId`。
    // **modeId が消える経路があるので、2つが違う id だと記憶が割れる**
    //（ルールをもう一度見せたのに、読んだことになっている／その逆）。
    // このカセットはモードidもゲームidも 'falsetrue' なので割れない——
    // **それを言葉ではなく検査で固定する**（あとで名前を変えた日に赤くなるように）
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      const 鍵 = () => {
        const st = roomOf(srv, rm.code).state;
        return (st.data && st.data.modeId) || st.game || null;
      };
      // 棚から選んだ状態（modeId が載る）
      await rm.host.call('room:setState', { game: 'falsetrue', data: { modeId: 'falsetrue' } });
      assertEqual(鍵(), 'falsetrue', 'えらんだ直後の鍵');
      // ゲーム中（modeId が消える経路）
      const res = await rm.host.call('wolf:start', { game: 'falsetrue', talkSec: 30 });
      assertEqual(res.ok, true, '始まる');
      assertEqual(鍵(), 'falsetrue', '**ゲーム中も同じ鍵**（modeId が消えても gameId に落ちるだけ）');
      // 再戦のあと
      await rm.host.call('room:setState', { reset: true, phase: 'lobby' });
      assertEqual(鍵(), 'falsetrue', '再戦のあとも同じ鍵');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ================= Q8：途中退室の3経路を、本物の socket で =================
  //
  // **単体（tests/falsetrue-room.js）では `isAllDone` → `advance` を直に呼んでいる。**
  // 実サーバーでは `room:leave` → `settleAfterMemberGone` → `isAllDone` → `advance` という
  // 芯の1本道を通る必要がある。**「進行役は正しいのに、芯から呼ばれない」**は
  // 締め切りの見回りで一度踏んでいるので、退室でも同じ形を疑う。

  /** その段階まで、時計で進める */
  async function まで(srv, rm, phase) {
    for (let i = 0; i < 10; i++) {
      const v = viewOf(rm.host);
      if (v.phase === phase) return v;
      const 前 = v.phase;
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase !== 前, 前 + ' から進む');
    }
    throw new Error(phase + ' に届かない');
  }

  await r.test('Q8-a：選ぶ人が本当に退室すると、次の人へ進む（ケースは減らない）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 5);
      const w = stateOf(srv, rm.code);
      const 抜ける = 端末(rm, w.pickerId);
      const 枚数 = viewOf(rm.host).cases.length;
      // ホストが抜けると進行役の移譲まで絡むので、ホストでない人が選ぶ回まで進める
      if (抜ける === rm.host) { rush(srv, rm.code); await waitUntil(() => true, '-'); }
      const 出る = 端末(rm, stateOf(srv, rm.code).pickerId);
      const id = 出る.memberId;
      const res = await 出る.call('room:leave', { code: rm.code, memberId: id });
      assertEqual(res.ok, true, '退室できる');
      // **芯が片付けて、また pick になる**（詰まらない）
      await waitUntil(() => {
        const v = viewOf(rm.host);
        return v && v.phase === 'pick' && v.holderId && v.holderId !== id;
      }, '別の人が選ぶ側になる');
      assertEqual(viewOf(rm.host).cases.length, 枚数, 'まだ選んでいないので、ケースは減らない');
      const p = viewOf(rm.host).players.find((x) => x.id === id);
      assertEqual(p.gone, true, '抜けたことが全員に伝わる');
      assertEqual(p.fate, null, '抜けた人は、生存でも脱落でもない');
      rm.all.filter((d) => d.memberId !== id).forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('Q8-b：中身を見た人が本当に退室すると、そのケースは消える（2-8）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 5);
      const 持ち主id = stateOf(srv, rm.code).pickerId;
      const d = 端末(rm, 持ち主id);
      await waitUntil(() => viewOf(d) && viewOf(d).cases, '持ち主に届く');
      const 番号 = viewOf(d).cases[1];
      assertEqual((await d.call('wolf:act', { pick: 番号 })).ok, true, 'ケースをえらぶ');
      await waitUntil(() => viewOf(rm.host).phase === 'peek', 'peek に入る');
      // ここで退室する（中身を知っている人が消える）
      assertEqual((await d.call('room:leave', { code: rm.code, memberId: 持ち主id })).ok, true, '退室できる');
      await waitUntil(() => viewOf(rm.host).phase === 'pick', '次の人の pick へ進む');
      const v = viewOf(rm.host);
      assertEqual(v.cases.indexOf(番号), -1, 'そのケースは選択欄に戻ってこない');
      assertEqual(v.discarded.indexOf(番号) >= 0, true, '消えたケースとして数えられている');
      rm.all.filter((x) => x.memberId !== 持ち主id).forEach((x) => x.close());
    } finally { await srv.close(); }
  });

  await r.test('Q8-c：対面の相手が本当に退室すると対面が流れ、持ち主はケースを持ったまま（2-8）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await 始める(srv, 5);
      await まで(srv, rm, 'face');
      const w = stateOf(srv, rm.code);
      const 持ち主 = w.pickerId, 相手 = w.oppId, 持っている = w.heldNo;
      assert(相手, '対面の相手がいる');
      const 出る = 端末(rm, 相手);
      assertEqual((await 出る.call('room:leave', { code: rm.code, memberId: 相手 })).ok, true, '退室できる');
      // **対面をやり直す。**持ち主とケースはそのまま
      await waitUntil(() => {
        const x = stateOf(srv, rm.code);
        return x.oppId && x.oppId !== 相手;
      }, '別の相手と対面し直す');
      const x = stateOf(srv, rm.code);
      assertEqual(x.pickerId, 持ち主, '持ち主はそのまま');
      assertEqual(x.heldNo, 持っている, 'ケースを持ったまま');
      assertEqual(x.discarded.length, 0, 'このケースは消えない');
      rm.all.filter((d) => d.memberId !== 相手).forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  r.finish();
})();
