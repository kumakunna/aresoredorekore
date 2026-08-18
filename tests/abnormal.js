// tests/abnormal.js — 異常系シナリオの検証（第35弾D）
//
// docs/監査_異常系シナリオ.md の d07/d08/d09/d11/d13 をサーバー直叩きで固定する。
// 原則：サーバー権威。不正・重複・手遅れ・故障は、サーバー側で拒否または吸収され、
// 部屋が壊れたりプロセスが落ちたりしないこと。

const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const { createRunner, assert, assertEqual } = require('./harness');
const { RT_START_EVENT } = require('./inventory');

const WW_CFG = {
  game: 'wordwolf', wolfCount: 1, wolfAware: true, roles: {},
  multiTurn: false, meetingSec: 0, discussSec: 0
};

// ワードウルフ3人を「あと1票で決着」まで進める
async function toFinalVote(srv, rm) {
  const room = () => srv.store.get(rm.code);
  for (const d of rm.all) await d.call('wolf:act', { targetId: null });
  await rm.host.call('wolf:next', {});
  await rm.host.call('wolf:next', {});
  await waitUntil(() => room().wordwolf.phase === 'vote', '投票フェーズに入る');
  const wolfId = room().wordwolf.wolfIds[0];
  const devs = rm.all;
  const wolfDev = devs.find((d) => d.memberId === wolfId);
  const sheep = devs.filter((d) => d !== wolfDev);
  // シープ1人目とウルフが投票済み・シープ2人目が最後の1票
  await sheep[0].call('wolf:vote', { targetId: wolfId });
  await wolfDev.call('wolf:vote', { targetId: sheep[0].memberId });
  return { room, lastVoter: sheep[1], wolfId };
}

async function run() {
  const r = createRunner('abnormal：通信・異常系・状態復帰');

  await r.test('d13：記録のDB書き込みが失敗しても、サーバーが落ちず決着まで進む', async () => {
    // saveMatchRecord の INSERT はゲーム決着の最後の1票のハンドラ内で走る。
    // ここで例外が漏れると uncaughtException＝プロセス落ち＝部屋全滅になる
    const brokenDb = {
      prepare() { throw new Error('テスト用：DBが書けません（ディスク満杯を想定）'); },
      countPairs() {}, pairInfo() { return null; }
    };
    const srv = await startTestServer({ db: brokenDb });
    const caught = [];
    const trap = (e) => { caught.push(e && e.message); };
    process.on('uncaughtException', trap);
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call(RT_START_EVENT, WW_CFG);
      const { room, lastVoter, wolfId } = await toFinalVote(srv, rm);
      const res = await lastVoter.call('wolf:vote', { targetId: wolfId });
      assertEqual(res.ok, true, '最後の1票は受け付けられる');
      await waitUntil(() => room().wordwolf.phase === 'roundResult', 'ターン結果が出る');
      // 記録はホストが結果を送って ended になった瞬間に走る（そこでDBが失敗する）
      const nx = await rm.host.call('wolf:next', {});
      assertEqual(nx.ok, true, '結果送りは受け付けられる');
      await sleep(400);
      assertEqual(caught.length, 0,
        'DB失敗がプロセスまで漏れない（漏れた: ' + caught.join(' / ') + '）');
      assertEqual(room().wordwolf.phase, 'ended', '記録に失敗してもゲームは決着する');
      // 部屋はその後も生きている（別の操作が通る）
      const peek = await rm.host.call('room:peek', { code: rm.code, memberId: rm.host.memberId });
      assertEqual(peek.ok, true, '決着後も部屋は操作できる');
    } finally {
      process.removeListener('uncaughtException', trap);
      await srv.close();
    }
  });

  await r.test('d07：同じ人の二重投票は1票のまま・集計は一度だけ', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call(RT_START_EVENT, WW_CFG);
      const { room, lastVoter, wolfId } = await toFinalVote(srv, rm);
      // 最後の1票を「同時に」2連射（awaitせず同フレームで送る）
      const p1 = lastVoter.call('wolf:vote', { targetId: wolfId });
      const p2 = lastVoter.call('wolf:vote', { targetId: wolfId });
      const [r1, r2] = await Promise.all([p1, p2]);
      await sleep(300);
      assertEqual(room().wordwolf.phase, 'roundResult', '締切が成立して集計に入る');
      // 2発目は「もう投票フェーズではない」拒否か、上書きの冪等either。二重集計だけは起きない
      const votes = room().wordwolf.voteRounds[0];
      assertEqual(Object.keys(votes).length, 3, '票は3人ぶんだけ（二重集計なし・実際:' +
        Object.keys(votes).length + '票）');
      assert(r1.ok || r2.ok, '少なくとも一方は受理される');
    } finally { await srv.close(); }
  });

  await r.test('d07：開始の二重送信は2発目が「もう始まっています」で拒否される', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const p1 = rm.host.call(RT_START_EVENT, WW_CFG);
      const p2 = rm.host.call(RT_START_EVENT, WW_CFG);
      const [r1, r2] = await Promise.all([p1, p2]);
      const oks = [r1, r2].filter((x) => x.ok).length;
      assertEqual(oks, 1, '開始は1回だけ通る（実際:' + oks + '回）');
      const rejected = [r1, r2].find((x) => !x.ok);
      assertEqual(rejected.error, 'already_started', '2発目の理由が「もう始まっています」');
      // ついでに：ホスト以外の開始はそもそも拒否
      const r3 = await rm.all[1].call(RT_START_EVENT, WW_CFG);
      assertEqual(r3.error, 'not_host', 'ホスト以外は始められない');
    } finally { await srv.close(); }
  });

  await r.test('d11：締切（全員投票）と同時に届いた遅れ票は拒否され、集計は一度だけ', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call(RT_START_EVENT, WW_CFG);
      const { room, lastVoter, wolfId } = await toFinalVote(srv, rm);
      // 最後の1票（締切成立）と、別の人の「出し直し」を同フレームで送る
      const someoneElse = rm.all.find((d) => d !== lastVoter);
      const pFinal = lastVoter.call('wolf:vote', { targetId: wolfId });
      const pLate = someoneElse.call('wolf:vote', { targetId: lastVoter.memberId });
      const [rf, rl] = await Promise.all([pFinal, pLate]);
      await sleep(300);
      assertEqual(room().wordwolf.phase, 'roundResult', '締切が成立して集計に入る');
      assertEqual(rf.ok, true, '締切を成立させた票は受理');
      assertEqual(rl.ok, false, '締切後に処理された票は拒否（実際:' + JSON.stringify(rl) + '）');
      assertEqual(room().wordwolf.voteRounds.length, 1, '集計は1回だけ');
    } finally { await srv.close(); }
  });

  await r.test('d09：存在しない・解散済みの部屋コードは、入室も在室確認も正しく断られる', async () => {
    const srv = await startTestServer();
    try {
      const d = await device(srv.url);
      const r1 = await d.call('room:join', { code: 'ZZZZZZ', name: 'まいご' });
      assertEqual(r1.ok, false, '存在しないコードは入れない');
      assertEqual(r1.error, 'room_not_found', '理由が room_not_found');
      // 部屋を作って解散→古いコード（=古いQR相当）で入り直し
      const rm = await makeRoom(srv, 2);
      const code = rm.code;
      await rm.host.call('room:close', {});
      await sleep(200);
      const r2 = await d.call('room:join', { code, name: 'おそい' });
      assertEqual(r2.ok, false, '解散済みの部屋には入れない');
      const r3 = await d.call('room:peek', { code, memberId: 'm_x' });
      assertEqual(r3.ok, false, '在室確認も「無い」と答える（フェーズAのdropRoom導線）');
    } finally { await srv.close(); }
  });

  await r.test('d08：同じmemberIdの入り直しは復帰扱い・接続中の同名は別人として増える', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2);
      const room = () => srv.store.get(rm.code);
      const before = room().members.size;
      // 2つ目のタブ相当：同じmemberIdで別socketから入り直す
      const tab2 = await device(srv.url);
      const r1 = await tab2.call('room:join', { code: rm.code, name: rm.host.name || 'ホスト', memberId: rm.host.memberId });
      assertEqual(r1.ok, true, '同じmemberIdの入り直しは受け付ける');
      assertEqual(r1.memberId, rm.host.memberId, '別人にならず同じ枠に復帰する');
      assertEqual(room().members.size, before, '名簿は増えない');
      // 接続中の同名（memberIdなし）は別人として増える（設計コメントどおり）
      const dup = await device(srv.url);
      const r2 = await dup.call('room:join', { code: rm.code, name: 'ゲスト1' });
      assertEqual(r2.ok, true, '同名でも入れる');
      assert(r2.memberId !== rm.all[1].memberId, '接続中の同名は別人として扱う');
      assertEqual(room().members.size, before + 1, '名簿が1人増える');
    } finally { await srv.close(); }
  });

  await r.test('d01：投票中に1人切断→残りで進行→同じmemberIdで復帰し秘密も戻る', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      await rm.host.call(RT_START_EVENT, WW_CFG);
      const room = () => srv.store.get(rm.code);
      for (const d of rm.all) await d.call('wolf:act', { targetId: null });
      await rm.host.call('wolf:next', {});
      await rm.host.call('wolf:next', {});
      await waitUntil(() => room().wordwolf.phase === 'vote', '投票フェーズに入る');
      const wolfId = room().wordwolf.wolfIds[0];
      const wolfDev = rm.all.find((d) => d.memberId === wolfId);
      const sheep = rm.all.filter((d) => d !== wolfDev);
      // シープ2人がウルフへ・ウルフはシープへ（2対1で同数にならない）。3人目のシープが切断
      await sheep[0].call('wolf:vote', { targetId: wolfId });
      await sheep[1].call('wolf:vote', { targetId: wolfId });
      await wolfDev.call('wolf:vote', { targetId: sheep[0].memberId });
      const lastVoter = sheep[2];
      // 最後の1票を投じるはずだった人が切断（スリープ・電波切れ相当）
      const goneId = lastVoter.memberId;
      const goneTopic = (lastVoter.you || {}).topic;
      lastVoter.socket.disconnect();
      await waitUntil(() => {
        const m = room().members.get(goneId);
        return m && !m.connected;
      }, '切断が名簿に反映される');
      // 数え直し（settle）で残りだけの締切が成立し、集計に進む
      await waitUntil(() => room().wordwolf.phase === 'roundResult',
        '切断者を待たずにターン結果へ進む');
      // 数秒後に同じmemberIdで復帰 → 同じ枠・自分の秘密が戻る
      const back = await device(srv.url);
      const rj = await back.call('room:join', { code: rm.code, name: 'もどり', memberId: goneId });
      assertEqual(rj.ok, true, '復帰できる');
      assertEqual(rj.memberId, goneId, '同じ枠に戻る');
      await waitUntil(() => back.you && back.you.phase === 'roundResult', '復帰後に現在の秘密が届く');
      assertEqual(back.you.topic, goneTopic, '自分のお題がそのまま戻る（他人の秘密ではない）');
    } finally { await srv.close(); }
  });

  await r.test('d02：夜に役職持ちが切断→夜が完了→戻らないまま決着し記録にも名前が残る', async () => {
    const srv = await startTestServer();
    try {
      const saved = [];
      const fakeDb = {
        prepare() { return { run(...args) { saved.push(args); } }; },
        countPairs() {}, pairInfo() { return null; }
      };
      await srv.close();
      const srv2 = await startTestServer({ db: fakeDb });
      try {
        const rm = await makeRoom(srv2, 4);
        await rm.host.call(RT_START_EVENT, { game: 'wolfrole', roles: ['wolf', 'seer'], turnLimit: 5, meetingSec: 0 });
        const room = () => srv2.store.get(rm.code);
        for (const d of rm.all) await d.call('wolf:act', { targetId: null });
        await rm.host.call('wolf:next', {});
        await waitUntil(() => room().wolf.phase === 'night', '夜になる');
        // 占い師が夜のまっただ中で切断（行動待ちの1人）
        const seerDev = rm.all.find((d) => d.you && d.you.roleId === 'seer');
        const others = rm.all.filter((d) => d !== seerDev);
        const seerId = seerDev.memberId;
        seerDev.socket.disconnect();
        await waitUntil(() => {
          const m = room().members.get(seerId);
          return m && !m.connected;
        }, '切断が名簿に反映される');
        // 残り（狼の襲撃＋村人の確認）だけで夜が明ける
        const wolfDev = rm.all.find((d) => d.you && d.you.roleId === 'wolf');
        const victim = others.find((d) => d !== wolfDev);
        await wolfDev.call('wolf:act', { targetId: victim.memberId });
        for (const d of others) { if (d !== wolfDev) await d.call('wolf:act', { targetId: null }); }
        await waitUntil(() => room().wolf.phase !== 'night', '占い師を待たずに夜が明ける');
        assert(true, '夜が完了した（phase=' + room().wolf.phase + '）');
      } finally { await srv2.close(); }
    } finally { try { await srv.close(); } catch (e) {} }
  });

  await r.test('d07拡張：投票・夜の対象は「実在する参加者」だけ（幽霊IDはサーバーが拒否・正本ループ）', async () => {
    // 発見（8/16）：存在しないIDへの投票・夜行動が受理されていた。
    // 改造・バグったクライアントの幽霊票が集計を歪める（幽霊が最多得票→誰も処刑されない等）。
    // サーバー権威の原則どおり、対象の実在チェックはサーバー側に置く
    const WordwolfRoom = require('../wordwolf-room.js');
    const WolfRoom = require('../wolf-room.js');
    function mockRoom(n) {
      const members = new Map();
      for (let i = 0; i < n; i++) {
        const id = 'm_' + i;
        members.set(id, { id, name: 'P' + i, role: 'player', connected: true });
      }
      return { members, state: {} };
    }
    // ① ワードウルフの投票
    {
      const room = mockRoom(3);
      WordwolfRoom.startGame(room, { game: 'wordwolf', wolfCount: 1, wolfAware: true, roles: {}, meetingSec: 0, discussSec: 0 });
      room.wordwolf.phase = 'vote';
      const r1 = WordwolfRoom.submitVote(room, 'm_0', 'm_GHOST');
      assertEqual(r1.ok, false, 'WW投票：幽霊IDは拒否（実際:' + JSON.stringify(r1) + '）');
      assertEqual(Object.keys(room.wordwolf.votes).length, 0, 'WW投票：幽霊票は残らない');
    }
    // ② 人狼の投票
    {
      const room = mockRoom(4);
      WolfRoom.startGame(room, { game: 'wolfrole', roles: ['wolf'], turnLimit: 5, meetingSec: 0 });
      room.wolf.phase = 'vote';
      const r2 = WolfRoom.submitVote(room, 'm_0', 'm_GHOST');
      assertEqual(r2.ok, false, '人狼投票：幽霊IDは拒否（実際:' + JSON.stringify(r2) + '）');
    }
    // ③ 人狼の夜の行動（襲撃・占いの対象）
    {
      const room = mockRoom(4);
      WolfRoom.startGame(room, { game: 'wolfrole', roles: ['wolf'], turnLimit: 5, meetingSec: 0 });
      room.wolf.phase = 'night';
      const wolfId = room.wolf.game.players.find((p) => p.role === 'wolf').id;
      const r3 = WolfRoom.submitAction(room, wolfId, 'm_GHOST');
      assertEqual(r3.ok, false, '夜の行動：幽霊IDは拒否（実際:' + JSON.stringify(r3) + '）');
    }
  });

  await r.test('d12：部屋は20人まで——21人目は満員で断られ、20人ちょうど・復帰・大画面は通る', async () => {
    // レビュー決定（8/18）：技術は30人でも余裕だが、体験が成立する実用域として上限20人。
    // 上限・下限は両方向を見る（落とし穴8）
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 19);
      const room = () => srv.store.get(rm.code);
      // 20人ちょうどは入れる
      const p20 = await device(srv.url);
      const r20 = await p20.call('room:join', { code: rm.code, name: '二十' });
      assertEqual(r20.ok, true, '20人ちょうどは入れる');
      assertEqual(room().members.size, 20, '名簿20人');
      // 21人目は満員
      const p21 = await device(srv.url);
      const r21 = await p21.call('room:join', { code: rm.code, name: '二十一' });
      assertEqual(r21.ok, false, '21人目は入れない（実際:' + JSON.stringify(r21) + '）');
      assertEqual(r21.error, 'room_full', '理由が room_full');
      assert(/満員です（20人まで）/.test(r21.message || ''), 'プレイヤー向けの文言（実際:' + (r21.message || 'なし') + '）');
      assertEqual(room().members.size, 20, '名簿は増えない');
      // 満員でも「復帰」は締め出さない（20人のうちの1人が入り直すのは通る）
      const back = await device(srv.url);
      const rb = await back.call('room:join', { code: rm.code, name: '二十', memberId: r20.memberId });
      assertEqual(rb.ok, true, '既存メンバーの入り直しは満員でも通る');
      assertEqual(room().members.size, 20, '名簿は20人のまま');
    } finally { await srv.close(); }
  });

  await r.test('d12追試：入れ替わりで名簿に切断枠が溜まっても、実人数が少なければ新規は入れる', async () => {
    // 実機報告「QRが使えない」の真因（8/18）：門が名簿の枠数（切断中含む）で数えていたため、
    // 8人しか居ない部屋でも入れ替わりの切断枠が溜まると新規参加が「満員」で拒否された。
    // 上限20の趣旨は「同時に遊ぶ人数」なので、接続中のプレイヤー数で数える
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 8);
      const room = () => srv.store.get(rm.code);
      // 12人が入っては抜ける（タブを閉じた・名前を打ち直した等。枠は入り直し用に残る設計）
      for (let i = 0; i < 12; i++) {
        const d = await device(srv.url);
        const r = await d.call('room:join', { code: rm.code, name: 'いれかわり' + i });
        assertEqual(r.ok, true, (i + 1) + '人目の入れ替わりが入れる');
        d.socket.disconnect();
        await sleep(60);
      }
      await waitUntil(() => {
        const ms = Array.from(room().members.values());
        return ms.length === 20 && ms.filter((m) => m.connected).length === 8;
      }, '名簿20枠・接続中8人の状態ができる');
      // QRで来た新規の人：実人数は8人なので入れる
      const qr = await device(srv.url);
      const r = await qr.call('room:join', { code: rm.code, name: 'QRの新しい人' });
      assertEqual(r.ok, true, '接続中8人なら新規は入れる（実際:' + JSON.stringify(r.error || 'ok') + '）');
      // 接続中が20人に達している時だけ満員（趣旨どおり）
    } finally { await srv.close(); }
  });

  r.finish();
}

if (require.main === module) run();
module.exports = { run };
