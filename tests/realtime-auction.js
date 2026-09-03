// tests/realtime-auction.js — 相場オークションの進行（第38弾で作り直し）
//
// 本物のサーバーと socket.io の接続を複数立てて、開場から決着までを通す。
//
// **いちばん重いのは「品質が漏れないこと」**（門4）。
// これは最後に足すのではなく、土台として最初に置く：
//   ① 公開スナップショットを**文字列にして、品質の言葉と正体の文を全部探す**
//   ② 端末に届く privateFor も、他人のぶんが混ざっていないかを見る
// 「載せていないつもり」を信じずに、届いたものをバラして探す形にしてある。

const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const A = require('../public/js/auction-logic');
const Items = require('../public/js/auction-items');

const R = A.RULES;

function roomOf(srv, code) { return srv.store.get(code); }
function viewOf(dev) {
  const st = dev.room && dev.room.state;
  return (st && st.data) || null;
}
// 部屋の中身をサーバー側から直接見る（検体を作るためだけに使う）
function stateOf(srv, code) { return roomOf(srv, code).auction; }

/**
 * 締め切りを「今」まで引く（早送り）。
 * 進行役の見回りは0.5秒ごとなので、これで次の段階へ進む。
 *
 * **持ち時間の数そのものは検査に使わない**（落とし穴10-a の自己参照になる）。
 * ここでやっているのは「締め切りが来た」という状況を作ることだけで、
 * 「締め切りが本当に効くか」は下の専用の検査が実時間で見ている。
 */
function rush(srv, code) {
  const w = stateOf(srv, code);
  if (w && w.deadline) w.deadline = Date.now() - 1;
}

// 開場から始める。preview を飛ばして競りに入れる
async function toBid(rm, srv) {
  await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase === 'preview', '開場する');
  for (const d of rm.all) await d.call('wolf:act', { pick: 'halfticket' });
  await waitUntil(() => viewOf(rm.host).phase === 'bid', '競りに入る');
}

async function startAuction(srv, players, cfg) {
  const rm = await makeRoom(srv, players);
  const res = await rm.host.call('wolf:start', Object.assign({
    game: 'auction', mode: 'sealed', rounds: 1, previewSec: 30
  }, cfg || {}));
  assertEqual(res.ok, true, '始められる（' + (res.error || '') + '）');
  return rm;
}

async function run() {
  const r = createRunner('realtime-auction：相場オークションの進行（第38弾）');

  // ==================== 秘密（門4） ====================

  await r.test('秘密：品質と正体が、公開スナップショットのどこにも入っていない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3);
      await toBid(rm, srv);
      const w = stateOf(srv, rm.code);
      // 型(b)：探す対象が本当にあることを、先に確かめる
      assertEqual(w.items.length, 6, 'サーバーは6品を持っている');
      assert(w.items.every((x) => x.quality && x.reveal), 'どの品にも品質と正体がある');

      // 届いたものを文字列にして、正体の文を1つずつ探す
      const seen = JSON.stringify(rm.guests[0].room);
      w.items.forEach((it) => {
        assertEqual(seen.indexOf(it.reveal), -1,
          it.look + ' の正体が配られている（これは答えそのもの）');
      });
      // 品質のラベルも、この段階では出ない
      Items.QUALITIES.forEach((q) => {
        assertEqual(seen.indexOf('"' + q.id + '"'), -1, q.label + ' の印が混ざっている');
      });
      // まだ開いていない段階ヒントも配らない（先の情報を持たせない）
      w.items.forEach((it) => {
        it.steps.forEach((s, i) => {
          if (i >= 0) assertEqual(seen.indexOf(s), -1, it.look + ' の段階ヒントが先に配られている');
        });
      });
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('秘密：鑑定眼で見た品質は、見た本人にしか届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3);
      await waitUntil(() => viewOf(rm.host) && viewOf(rm.host).phase === 'preview', '開場する');
      await rm.host.call('wolf:act', { pick: 'appraise' });
      const w = stateOf(srv, rm.code);
      const target = w.items[0];
      await rm.host.call('wolf:act', { use: true, targetNo: target.no });
      await waitUntil(() => rm.host.you && rm.host.you.appraised
        && rm.host.you.appraised[target.no], '本人には届く');
      assertEqual(rm.host.you.appraised[target.no], target.quality, '見た品の品質が届く');

      // 他の人には届かない。どの品を見たかも配らない
      const others = JSON.stringify(rm.guests.map((g) => ({ room: g.room, you: g.you })));
      assertEqual(others.indexOf(target.reveal), -1, '他の人に正体が渡っていない');
      assert(!(rm.guests[0].you && rm.guests[0].you.appraised
        && Object.keys(rm.guests[0].you.appraised).length),
        '他の人の手元に、鑑定の結果が入っていない');
      // 「使った」ことは全員に見える（使ったこと自体が情報になる）
      await waitUntil(() => {
        const v = viewOf(rm.guests[0]);
        return v && v.players.some((p) => p.powerUsed);
      }, '使ったことは伝わる');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('秘密：秘密入札の額は、締め切るまで本人にしか届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      await rm.guests[0].call('wolf:vote', { amount: 7 });
      await waitUntil(() => rm.guests[0].you && rm.guests[0].you.myBid === 7, '本人には届く');

      const v = viewOf(rm.host);
      assert(v.doneNames && v.doneNames.length === 1, '出したことは全員に見える');
      const seen = JSON.stringify({ room: rm.host.room, you: rm.host.you });
      assertEqual(/"myBid":7/.test(seen), false, '他の人に額が渡っていない');
      assertEqual(seen.indexOf('"amount":7'), -1, '額そのものが混ざっていない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('秘密：値踏み予想は、開示まで本人にしか届かない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      await rm.host.call('wolf:vote', { amount: 5 });
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'guess', '値踏みに入る', 60000);

      await rm.guests[0].call('wolf:vote', { guess: 'fine' });
      await waitUntil(() => rm.guests[0].you && rm.guests[0].you.myGuess === 'fine', '本人には届く');
      // 他の端末に放送が届くのを待ってから見る（届く前に見ると、まだ空で当たり前）
      await waitUntil(() => {
        const x = viewOf(rm.guests[1]);
        return x && x.guessDoneNames && x.guessDoneNames.length === 1;
      }, '出したことが他の人にも届く');
      const v = viewOf(rm.guests[1]);
      const seen = JSON.stringify({ room: rm.guests[1].room, you: rm.guests[1].you });
      assertEqual(seen.indexOf('"guess":"fine"'), -1, '他の人に中身が渡っていない');

      // 開示になったら、全員の予想が一斉に開く
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.guests[1]).phase === 'reveal', '開示になる', 20000);
      const rv = viewOf(rm.guests[1]).lastResult;
      assert(rv.guesses && rv.guesses.length >= 1, '開示では、みんなの予想が開く');
      assert(rv.quality, '品質もここで初めて出る');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ==================== 開場と下見 ====================

  await r.test('開場：6品が最初から並び、内訳の数だけが公開される', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3);
      // 中身が入った知らせが届くまで待つ（空の器が届いた瞬間に見ない）
      await waitUntil(() => viewOf(rm.guests[0]) && viewOf(rm.guests[0]).lineup, 'ゲームの知らせが届く');
      const v = viewOf(rm.guests[0]);
      assertEqual(v.phase, 'preview', '下見から始まる');
      assertEqual(v.lineup.length, 6, '6品が最初から並ぶ');
      assert(v.lineup.every((x) => x.kind && x.look && x.no), '系統・見た目・品番号が見える');
      assert(v.lineup.every((x) => x.quality === undefined), '品質は並んでいない');
      assertEqual(v.mixLine, '上物2・並物3・偽物1', '内訳の数だけが宣言される');
      assertEqual(v.market.tsubo, 1, '相場はどれも1から');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('下見：全員がアイテムを選んだら、待たずに競りへ進む', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { previewSec: 90 });
      await waitUntil(() => viewOf(rm.host).phase === 'preview', '開場する');
      await rm.host.call('wolf:act', { pick: 'appraise' });
      await rm.guests[0].call('wolf:act', { pick: 'market' });
      assertEqual(viewOf(rm.host).phase, 'preview', 'まだ1人残っているので進まない');  // 型(b)
      await rm.guests[1].call('wolf:act', { pick: 'halfticket' });
      await waitUntil(() => viewOf(rm.host).phase === 'bid', '全員そろったら進む');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ==================== 競り ====================

  await r.test('最初に値をつけた人に、ボーナスが1回だけ入る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      const before = viewOf(rm.host).players.find((p) => p.id === rm.guests[0].memberId).chips;
      await rm.guests[0].call('wolf:vote', { amount: 3 });
      await waitUntil(() => {
        const p = viewOf(rm.host).players.find((x) => x.id === rm.guests[0].memberId);
        return p.chips === before + R.FIRST_BID_BONUS;
      }, 'ボーナスが入る');
      // 2番目の人には入らない
      const b2 = viewOf(rm.host).players.find((p) => p.id === rm.guests[1].memberId).chips;
      await rm.guests[1].call('wolf:vote', { amount: 4 });
      await sleep(150);
      const a2 = viewOf(rm.host).players.find((p) => p.id === rm.guests[1].memberId).chips;
      assertEqual(a2, b2, '2番目にはボーナスが入らない');
      // 同じ人がもう一度出しても、二重には入らない
      const b3 = viewOf(rm.host).players.find((p) => p.id === rm.guests[0].memberId).chips;
      await rm.guests[0].call('wolf:vote', { amount: 6 });
      await sleep(150);
      const a3 = viewOf(rm.host).players.find((p) => p.id === rm.guests[0].memberId).chips;
      assertEqual(a3, b3, '同じ人が出し直しても増えない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('持っていない額は、サーバーが断る（端末の数字を信じない）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      const res = await rm.guests[0].call('wolf:vote', { amount: R.START_CHIPS + 100 });
      assertEqual(res.ok, false, '持ちチップを超える額は通らない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('落札：払った人のチップだけが減り、その系統の相場が1つ上がる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      const w = stateOf(srv, rm.code);
      const item = w.items.find((x) => x.no === w.order[0]);
      const beforeMarket = viewOf(rm.host).market[item.kind];
      const otherBefore = viewOf(rm.host).players.find((p) => p.id === rm.guests[1].memberId).chips;

      await rm.guests[0].call('wolf:vote', { amount: 6 });
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'guess', '落札が決まる', 60000);
      const v = viewOf(rm.host);
      assertEqual(v.lastResult.winner, rm.guests[0].name, '出した人が落札');
      assertEqual(v.market[item.kind], beforeMarket + 1, 'その系統の相場が1つ上がる');
      const other = v.players.find((p) => p.id === rm.guests[1].memberId).chips;
      assertEqual(other, otherBefore, '落札できなかった人は、何も失わない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('締め切りは実時間で効く（誰も何もしなくても段階が進む）', async () => {
    // 上の検査たちは rush で締め切りを手前に引いている。
    // **その早送りが正しいと言えるのは、締め切りが本当に効く場合だけ**なので、
    // ここ1件だけは早送りを使わず、実時間で待って確かめる。
    // 使うのはいちばん短い段階（値踏み）。誰も予想を出さなくても開示へ進むはず
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      await rm.guests[0].call('wolf:vote', { amount: 3 });
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'guess', '値踏みに入る', 20000);
      // ここから先は誰も何もしない。**時計だけで**開示へ進むこと
      const startedAt = Date.now();
      await waitUntil(() => viewOf(rm.host).phase === 'reveal',
        '誰も予想を出さなくても、締め切りで開示へ進む', (R.GUESS_SEC + 8) * 1000);
      const waited = Date.now() - startedAt;
      // 早すぎたら「締め切りで進んだ」とは言えない（何か別の理由で進んでいる）
      assert(waited >= 2000, '締め切りを待って進んだ（実際:' + waited + 'ms）');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('誰も入札しない時は、すぐには流さず最終確認をはさむ', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      // 誰も出さないまま締め切りを迎える
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'confirm', '最終確認になる', 60000);
      const v = viewOf(rm.host);
      assert(v.waitingPass && v.waitingPass.length === 3, 'まだ3人が押していない');  // 型(b)

      // 2人が見送っても、まだ流れない
      await rm.host.call('wolf:act', { pass: true });
      await rm.guests[0].call('wolf:act', { pass: true });
      await sleep(200);
      assertEqual(viewOf(rm.host).phase, 'confirm', '全員が押すまで流れない');
      // 3人目が押して、はじめて流れる
      await rm.guests[1].call('wolf:act', { pass: true });
      await waitUntil(() => viewOf(rm.host).phase !== 'confirm', '流れる');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('最終確認の最中でも入札できる（それが最後のひと押し）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'confirm', '最終確認になる', 60000);
      const res = await rm.guests[0].call('wolf:vote', { amount: 2 });
      assertEqual(res.ok, true, '最終確認からでも出せる');
      await waitUntil(() => viewOf(rm.host).phase === 'bid', '競りに戻る');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('流れた品は、次の品のあとにもう一度だけ出る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await toBid(rm, srv);
      const w = stateOf(srv, rm.code);
      const first = w.order[0];
      const orderBefore = w.order.slice();
      assertEqual(orderBefore.length, 6, '最初は6品');                       // 型(b)

      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'confirm', '最終確認', 60000);
      for (const d of rm.all) await d.call('wolf:act', { pass: true });
      await waitUntil(() => stateOf(srv, rm.code).order.length === 7, 'もう一度並ぶ');
      const after = stateOf(srv, rm.code).order;
      assertEqual(after.filter((x) => x === first).length, 2, 'その品が2回並んでいる');
      assertEqual(after[2], first, '次の品のあとに戻っている');
      // 2度目も流れたら、もう戻らない
      assertEqual(stateOf(srv, rm.code).retried[first], true, '戻したことが記録されている');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ==================== アイテム ====================

  await r.test('相場操作：落札せずに、その系統の相場を1つ上げられる', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3);
      await waitUntil(() => viewOf(rm.host).phase === 'preview', '開場する');
      await rm.host.call('wolf:act', { pick: 'market' });
      const before = viewOf(rm.host).market.tsubo;
      const res = await rm.host.call('wolf:act', { use: true, targetKind: 'tsubo' });
      assertEqual(res.ok, true, '使える');
      await waitUntil(() => viewOf(rm.guests[0]).market.tsubo === before + 1, '全員に相場が届く');
      // 2回は使えない
      const again = await rm.host.call('wolf:act', { use: true, targetKind: 'tsubo' });
      assertEqual(again.ok, false, '1ラウンドに1回だけ');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('半額チケット：落札した時の支払いが半分になる（端数は切り上げ）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await waitUntil(() => viewOf(rm.host).phase === 'preview', '開場する');
      for (const d of rm.all) await d.call('wolf:act', { pick: 'halfticket' });
      await waitUntil(() => viewOf(rm.host).phase === 'bid', '競りに入る');
      await rm.guests[0].call('wolf:act', { use: true });
      const before = viewOf(rm.host).players.find((p) => p.id === rm.guests[0].memberId).chips;
      await rm.guests[0].call('wolf:vote', { amount: 7 });
      rush(srv, rm.code);
      await waitUntil(() => viewOf(rm.host).phase === 'guess', '落札が決まる', 60000);
      const v = viewOf(rm.host);
      assertEqual(v.lastResult.paid, 4, '7の半分は切り上げて4');
      const after = v.players.find((p) => p.id === rm.guests[0].memberId).chips;
      // ボーナス（最初の入札）も入っているので、その分を足して比べる
      assertEqual(after, before + R.FIRST_BID_BONUS - 4, '払ったのは4枚だけ');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  // ==================== 決着 ====================

  await r.test('決着：得点が「品質値×最終相場＋残チップぶん」になっている', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed', rounds: 1, previewSec: 30 });
      await toBid(rm, srv);
      // 6品を全部、誰かが落札して終わらせる
      for (let i = 0; i < 8; i++) {
        const v = viewOf(rm.host);
        if (v.phase === 'ended') break;
        if (v.phase === 'bid' || v.phase === 'confirm') {
          await rm.guests[0].call('wolf:vote', { amount: 1 });
          rush(srv, rm.code);
          await waitUntil(() => ['guess', 'reveal', 'ended'].indexOf(viewOf(rm.host).phase) >= 0,
            i + '：落札が決まる', 60000);
        }
        // 値踏み・開示も締め切りで進む。ここも早送りする
        rush(srv, rm.code);
        await waitUntil(() => ['bid', 'confirm', 'ended'].indexOf(viewOf(rm.host).phase) >= 0,
          i + '：次の品へ', 40000);
      }
      await waitUntil(() => viewOf(rm.host).phase === 'ended', '決着する', 90000);
      const res = viewOf(rm.host).result;
      assert(res && res.ranking.length === 3, '3人ぶんの順位が出る');
      // ルール層の計算と、進行役の出した数が一致する
      const w = stateOf(srv, rm.code);
      res.ranking.forEach((row) => {
        const s = A.scoreOf(w.won[row.id], w.market, w.chips[row.id]);
        assertEqual(row.score, s.total, row.name + ' の得点が、ルール層の計算と一致する');
        assertEqual(row.fromItems + row.fromChips, row.score, row.name + ' の内訳が合計と合う');
      });
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('人数：3人未満では始められない。8人を超えても始められない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2);
      const res = await rm.host.call('wolf:start', { game: 'auction', mode: 'sealed' });
      assertEqual(res.ok, false, '2人では始められない');
      assertEqual(res.error, 'too_few_players', '理由が分かる');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('切断：入札の途中で1人が切れても、進行は止まらない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await startAuction(srv, 3, { mode: 'sealed' });
      await waitUntil(() => viewOf(rm.host).phase === 'preview', '開場する');
      await rm.host.call('wolf:act', { pick: 'halfticket' });
      await rm.guests[0].call('wolf:act', { pick: 'halfticket' });
      assertEqual(viewOf(rm.host).phase, 'preview', 'まだ1人待っている');       // 型(b)
      // 3人目がブラウザを閉じた → 待たずに進む
      rm.guests[1].close();
      await waitUntil(() => viewOf(rm.host).phase === 'bid', '切れた人は待たない');
      rm.host.close(); rm.guests[0].close();
    } finally { await srv.close(); }
  });

  r.finish();
}

run();
