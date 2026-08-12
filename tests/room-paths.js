// tests/room-paths.js — 部屋の出入り・開始合図をループ形式で固定する（第35弾フェーズA）
//
// 個別ケースを手書きせず、正本（tests/inventory.js）を回す。
// 新しいゲームが GAME_DRIVERS に増えたら、このテストは自動的にそのゲームも見る。
// 増えたのに開始設定（RT_START_MIN_CONFIG）を書き忘れた場合は「追加漏れ検出」が赤くなる。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');
const {
  RT_GAME_IDS, CASSETTE_GAME_IDS, HANDOFF_ONLY_GAME_IDS,
  RT_START_EVENT, RT_START_MIN_CONFIG, ROOM_EXIT_PATHS
} = require('./inventory');

async function run() {
  const r = createRunner('room-paths：出入りと開始合図（正本ループ）');

  // ---- 追加漏れ検出（落とし穴4の恒久対策） ----

  await r.test('GAME_DRIVERS の全ゲームに、テスト用の開始設定が登録されている', async () => {
    RT_GAME_IDS.forEach((id) => {
      assert(RT_START_MIN_CONFIG[id],
        id + ' の開始設定が tests/inventory.js の RT_START_MIN_CONFIG にありません。' +
        '新しいゲームを GAME_DRIVERS に足したら、開始設定も1行足してください');
    });
    // 逆向き：ゲームを消したのに設定が残っている（古いidの取り残し。落とし穴5）
    Object.keys(RT_START_MIN_CONFIG).forEach((id) => {
      assert(RT_GAME_IDS.indexOf(id) !== -1,
        id + ' は GAME_DRIVERS に無いのに開始設定だけ残っています');
    });
  });

  // ---- 開始の3-2-1：全ゲームで、全員に room:countdown が届く ----

  await r.test('全ゲーム：はじめた瞬間に、全員へ開始の合図（room:countdown）が届く', async () => {
    for (const gameId of RT_GAME_IDS) {
      const srv = await startTestServer();
      try {
        const rm = await makeRoom(srv, 6);
        const got = new Map(); // 端末ごとに届いた合図
        rm.all.forEach((d, i) => {
          d.socket.on('room:countdown', (p) => got.set(i, p));
        });
        const res = await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG[gameId]);
        assertEqual(res.ok, true, gameId + '：始められる（' + (res.error || '') + '）');
        await waitUntil(() => got.size === rm.all.length,
          gameId + '：全員に合図が届く（' + got.size + '/' + rm.all.length + '）');
        got.forEach((p) => assertEqual(p.seconds, 3, gameId + '：3秒の合図'));
        rm.all.forEach((d) => d.close());
      } finally { await srv.close(); }
    }
  });

  await r.test('全ゲーム：「もう一度」（待合に戻ってから再開）でも、合図がもう一度届く', async () => {
    // 再戦は「全員が待合に戻り、ホストのはじめるから」始める（第33弾B-1）。
    // つまり開始経路は初回とまったく同じ1本のはず。それを全ゲームで確かめる
    for (const gameId of RT_GAME_IDS) {
      const srv = await startTestServer();
      try {
        const rm = await makeRoom(srv, 6);
        let count = 0;
        rm.guests[0].socket.on('room:countdown', () => { count += 1; });
        const first = await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG[gameId]);
        assertEqual(first.ok, true, gameId + '：1回目が始まる');
        await waitUntil(() => count === 1, gameId + '：1回目の合図');
        // 「もう一度」＝ホストが同じゲームを reset 付きで選び直し、もう一度はじめる
        const reset = await rm.host.call('room:setState', { phase: 'lobby', game: gameId, reset: true });
        assertEqual(reset.ok, true, gameId + '：待合に戻せる');
        const second = await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG[gameId]);
        assertEqual(second.ok, true, gameId + '：2回目も始まる（' + (second.error || '') + '）');
        await waitUntil(() => count === 2, gameId + '：再戦でも合図が届く');
        rm.all.forEach((d) => d.close());
      } finally { await srv.close(); }
    }
  });

  // ---- 退室：サーバー側の約束 ----

  await r.test('つなぎ直した直後（部屋の印を失ったsocket）でも、code+memberId があれば退室できる', async () => {
    // 実機の「部屋を出るを押しても出ない」の正体のひとつ。
    // スリープ復帰などで socket がつなぎ直ると、サーバー側の socket.data は空になる。
    // その状態の room:leave は今まで「ok と返すのに名簿から消えない」嘘の応答だった
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const target = rm.guests[0];
      // 画面ロック→復帰でsocketが切り替わった状態を作る（入り直しの前に「出る」を押した）
      target.close();
      await waitUntil(() => {
        const m = srv.store.get(rm.code).members.get(target.memberId);
        return m && !m.connected;
      }, '切断が伝わる', 6000);
      const fresh = await device(srv.url);
      const res = await fresh.call('room:leave', { code: rm.code, memberId: target.memberId });
      assertEqual(res.ok, true, '退室できたと返る');
      assertEqual(srv.store.get(rm.code).members.has(target.memberId), false,
        '名簿からも本当に消えている（嘘のokを返さない）');
      fresh.close();
    } finally { await srv.close(); }
  });

  await r.test('code+memberId がでたらめな退室は、他人を消さない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const fresh = await device(srv.url);
      // 存在しないメンバー
      await fresh.call('room:leave', { code: rm.code, memberId: 'm_zzzzzzzzzzzzzzzz' });
      assertEqual(srv.store.get(rm.code).members.size, 3, '名簿は減らない');
      // 別の部屋のコード
      await fresh.call('room:leave', { code: 'ZZZZZZ', memberId: rm.guests[0].memberId });
      assertEqual(srv.store.get(rm.code).members.size, 3, '名簿は減らない（部屋違い）');
      fresh.close();
    } finally { await srv.close(); }
  });

  await r.test('在室確認（room:peek + memberId）で、自分がまだ部屋にいるか分かる', async () => {
    // 「部屋」ボタンの在室判定は、端末の記憶ではなくサーバーに聞く（サーバーが権威）。
    // peek に memberId を添えると、部屋の存在だけでなく「自分がまだ名簿にいるか」も返す
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 2);
      const inRoom = await rm.guests[0].call('room:peek', { code: rm.code, memberId: rm.guests[0].memberId });
      assertEqual(inRoom.ok, true, '部屋がある');
      assertEqual(inRoom.you, true, '自分はまだ名簿にいる');
      // 退室したら you は false になる
      await rm.guests[0].call('room:leave', { code: rm.code, memberId: rm.guests[0].memberId });
      const outRoom = await rm.guests[0].call('room:peek', { code: rm.code, memberId: rm.guests[0].memberId });
      assertEqual(outRoom.ok, true, '部屋はまだある');
      assertEqual(outRoom.you, false, '自分はもう名簿にいない');
      // memberId を送らない従来の呼び出しは、今まで通り（you は付かない）
      const legacy = await rm.host.call('room:peek', { code: rm.code });
      assertEqual(legacy.ok, true, '従来の覗きも動く');
      assertEqual(legacy.you, undefined, '従来の応答は変わらない');
    } finally { await srv.close(); }
  });

  // ---- 退室・kickでゲームが止まらないこと（第35弾B・実機報告のバグ） ----

  await r.test('待っている最後の1人が退室したら、その瞬間に段階が進む（全員が待ちっぱなしにならない）', async () => {
    // 実機報告：「誰かが部屋を抜けたときに、残っているメンバーに反映されない」。
    // 切断（markDisconnected）は isAllDone を数え直して進めるのに、
    // room:leave は数え直していなかった。時間制限の無い段階だと無期限に止まる
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      const start = await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG.wolfrole);
      assertEqual(start.ok, true, '人狼が始まる');
      // 役職確認は全員必須。3人だけ確認した状態を作る
      for (const d of [rm.host, rm.guests[0], rm.guests[1]]) {
        const res = await d.call('wolf:act', { targetId: null });
        assertEqual(res.ok, true, '確認できる');
      }
      assertEqual(srv.store.get(rm.code).wolf.phase, 'roleReveal', 'まだ全員待ち');
      // 最後の1人（4人目）が部屋を出る
      await rm.guests[2].call('room:leave', { code: rm.code, memberId: rm.guests[2].memberId });
      await waitUntil(() => srv.store.get(rm.code).wolf.phase !== 'roleReveal',
        '残った3人の待ちが解けて、次の段階へ進む');
    } finally { await srv.close(); }
  });

  await r.test('待っている最後の1人を進行役が出したら、その瞬間に段階が進む', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      await rm.host.call(RT_START_EVENT, RT_START_MIN_CONFIG.wolfrole);
      for (const d of [rm.host, rm.guests[0], rm.guests[1]]) {
        await d.call('wolf:act', { targetId: null });
      }
      assertEqual(srv.store.get(rm.code).wolf.phase, 'roleReveal', 'まだ全員待ち');
      const res = await rm.host.call('room:kick', { memberId: rm.guests[2].memberId });
      assertEqual(res.ok, true, '出せる');
      await waitUntil(() => srv.store.get(rm.code).wolf.phase !== 'roleReveal',
        '残った3人の待ちが解けて、次の段階へ進む');
    } finally { await srv.close(); }
  });

  await r.test('抜けた理由（自分で退室／出された）が、残った人に理由つきで放送される', async () => {
    // 通知の文言を「抜けました」と「出されました」で分けるため、
    // サーバーが room:memberGone を reason つきで放送する（クライアントの名簿差分では理由が分からない）
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      const gone = [];
      rm.guests[0].socket.on('room:memberGone', (p) => gone.push(p));
      const leaverGone = [];
      rm.guests[2].socket.on('room:memberGone', (p) => leaverGone.push(p));
      // 自分で退室
      await rm.guests[2].call('room:leave', { code: rm.code, memberId: rm.guests[2].memberId });
      await waitUntil(() => gone.length === 1, '退室が放送される');
      assertEqual(gone[0].name, 'P4', '誰が抜けたか分かる');
      assertEqual(gone[0].reason, 'leave', '自分で抜けたと分かる');
      assertEqual(leaverGone.length, 0, '抜けた本人には流さない');
      // 進行役が出す
      const res = await rm.host.call('room:kick', { memberId: rm.guests[1].memberId });
      assertEqual(res.ok, true, '出せる');
      await waitUntil(() => gone.length === 2, 'kickも放送される');
      assertEqual(gone[1].name, 'P3', '誰が出されたか分かる');
      assertEqual(gone[1].reason, 'kick', '出されたと分かる');
    } finally { await srv.close(); }
  });

  // ---- 部屋ワードウルフ・お題変更あり（第35弾B・実機で発見） ----

  await r.test('お題変更ありの2ターン戦：ターン1でウルフを当てた人の得点が消えない', async () => {
    // 実機で発見：得点計算が「全ターンの票」を「最終ターンのウルフ配役」で採点していた。
    // お題変更ありは毎ターン配役を引き直すので、ターン1で正しくウルフに投票した人の
    // +1が消える（手渡し版は毎ターン加点で正しい。部屋版だけ壊れていた並走・落とし穴1）
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      const start = await rm.host.call(RT_START_EVENT, {
        game: 'wordwolf', wolfCount: 1, wolfAware: false, roles: {},
        multiTurn: true, turnLimit: 2, changeTopic: true, meetingSec: 0, discussSec: 0
      });
      assertEqual(start.ok, true, '始められる');
      const room = () => srv.store.get(rm.code);
      const deviceOf = {};
      rm.all.forEach((d) => { deviceOf[d.memberId] = d; });

      // ターン1：全員確認 → 話し合いへ → 投票へ
      for (const d of rm.all) await d.call('wolf:act', { targetId: null });
      await rm.host.call('wolf:next', {});
      await rm.host.call('wolf:next', {});
      const wolf1 = room().wordwolf.wolfIds[0];
      const sheep1 = rm.all.filter((d) => d.memberId !== wolf1);
      // シープ3人がウルフに投票（正解）。ウルフはシープの1人に投票
      for (const d of sheep1) await d.call('wolf:vote', { targetId: wolf1 });
      await deviceOf[wolf1].call('wolf:vote', { targetId: sheep1[0].memberId });
      await waitUntil(() => room().wordwolf.phase === 'roundResult', 'ターン1が決まる');
      await rm.host.call('wolf:next', {});
      await waitUntil(() => room().wordwolf.phase === 'discuss', 'ターン2が始まる');

      // ターン2：全員がシープの1人に投票（ウルフを外す＝ウルフ逃げ切り）
      await rm.host.call('wolf:next', {});
      const wolf2 = room().wordwolf.wolfIds[0];
      const sheep2 = rm.all.filter((d) => d.memberId !== wolf2);
      const scapegoat = sheep2[0];
      for (const d of rm.all.filter((x) => x.memberId !== scapegoat.memberId)) {
        await d.call('wolf:vote', { targetId: scapegoat.memberId });
      }
      await scapegoat.call('wolf:vote', { targetId: wolf2 });
      await waitUntil(() => room().wordwolf.phase === 'roundResult', 'ターン2が決まる');
      await rm.host.call('wolf:next', {});
      await waitUntil(() => room().wordwolf.phase === 'ended', '決着する');

      const scores = room().wordwolf.scores;
      // ターン1でウルフに正しく投票したシープ3人に+1が残っていること
      for (const d of sheep1) {
        if (d.memberId === wolf2) continue; // ターン2でウルフになった人はターン2の逃げ切り分も混ざるので別で見る
        assert((scores[d.memberId] || 0) >= 1,
          'ターン1でウルフを当てた人に+1が残る（実際: ' + JSON.stringify(scores) + '）');
      }
      // ターン2で逃げ切ったウルフにも+1
      assert((scores[wolf2] || 0) >= 1, 'ターン2の逃げ切りウルフに+1');
    } finally { await srv.close(); }
  });

  await r.test('お題変更ありのターン結果には「新しいお題で続きます」と伝わる材料がある', async () => {
    // 実機で発見：ターン結果の公開情報に changeTopic が無く、画面は設定に関わらず
    // 「お題はこのままです」と出していた（実際は次のターンでお題が変わる・誤表示）
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 4);
      await rm.host.call(RT_START_EVENT, {
        game: 'wordwolf', wolfCount: 1, wolfAware: false, roles: {},
        multiTurn: true, turnLimit: 2, changeTopic: true, meetingSec: 0, discussSec: 0
      });
      const room = () => srv.store.get(rm.code);
      for (const d of rm.all) await d.call('wolf:act', { targetId: null });
      await rm.host.call('wolf:next', {});
      await rm.host.call('wolf:next', {});
      const wolf1 = room().wordwolf.wolfIds[0];
      const sheep = rm.all.filter((d) => d.memberId !== wolf1);
      for (const d of sheep) await d.call('wolf:vote', { targetId: wolf1 });
      const wolfDev = rm.all.find((d) => d.memberId === wolf1);
      await wolfDev.call('wolf:vote', { targetId: sheep[0].memberId });
      await waitUntil(() => room().wordwolf.phase === 'roundResult', 'ターン1が決まる');
      const WordwolfRoom = require('../wordwolf-room');
      const rr = WordwolfRoom.publicView(room()).roundResult;
      assertEqual(rr.continues, true, 'まだ続く');
      assertEqual(rr.changeTopic, true, '「お題が変わるか」が公開情報に載っている');
    } finally { await srv.close(); }
  });

  // ---- 追加漏れ検出（第35弾B：カセットのゲームと検証マトリクス） ----

  await r.test('カセットの全ゲームが、部屋対応（GAME_DRIVERS）か手渡し専用宣言のどちらかに入っている', async () => {
    // 新しいゲームをカセットに足した時、GAME_DRIVERS への登録を忘れると、
    // 手渡し専用のつもりなのか登録漏れなのかが分からないまま進んでしまう。
    // どちらなのかを必ず宣言させる（HANDOFF_ONLY_GAME_IDS は意識して書く例外の一覧）
    assert(CASSETTE_GAME_IDS.length >= 10, 'カセットからゲームを抽出できている（いま' + CASSETTE_GAME_IDS.length + '件）');
    CASSETTE_GAME_IDS.forEach((id) => {
      assert(RT_GAME_IDS.indexOf(id) !== -1 || HANDOFF_ONLY_GAME_IDS.indexOf(id) !== -1,
        id + ' が GAME_DRIVERS にも手渡し専用の宣言（inventory.js）にもありません。' +
        '部屋対応するなら GAME_DRIVERS へ、手渡し専用なら HANDOFF_ONLY_GAME_IDS へ書いてください');
    });
    // 逆向き：手渡し専用と宣言したゲームが、カセットから消えたのに残っている（落とし穴5）
    HANDOFF_ONLY_GAME_IDS.forEach((id) => {
      assert(CASSETTE_GAME_IDS.indexOf(id) !== -1,
        id + ' はカセットに無いのに手渡し専用の宣言だけ残っています');
    });
  });

  await r.test('検証マトリクスに、カセットの全ゲームの行がある（落とし穴4の恒久対策）', async () => {
    // docs/監査_プレイ検証マトリクス.md はフェーズBの検証台帳。
    // 新しいゲームを足したのにマトリクスへ行を足し忘れると、網羅検証から漏れる。
    // 行頭セルにゲームidを書く約束（`| id |`）を機械で照合する
    const p = path.join(__dirname, '..', 'docs', '監査_プレイ検証マトリクス.md');
    assert(fs.existsSync(p), 'docs/監査_プレイ検証マトリクス.md がありません');
    const md = fs.readFileSync(p, 'utf8');
    CASSETTE_GAME_IDS.forEach((id) => {
      assert(new RegExp('^\\|\\s*' + id + '\\s*\\|', 'm').test(md),
        id + ' の行が検証マトリクスにありません（| ' + id + ' | で始まる行を足してください）');
    });
  });

  // ---- 正本の形の健全性（一覧が壊れると上のループが空回りする） ----

  await r.test('正本（inventory）の一覧が空でなく、退室経路に room:leave と room:close の両方がある', async () => {
    assert(RT_GAME_IDS.length >= 9, 'ゲーム一覧が GAME_DRIVERS から導出されている（いま' + RT_GAME_IDS.length + '件）');
    const kinds = ROOM_EXIT_PATHS.map((p) => p.kind);
    assert(kinds.indexOf('leave') !== -1, '自分だけ出る経路がある');
    assert(kinds.indexOf('close') !== -1, '部屋ごと終わる経路がある');
    assert(kinds.indexOf('passive') !== -1, '出される側の経路がある');
  });

  r.finish();
}

if (require.main === module) run();
module.exports = { run };
