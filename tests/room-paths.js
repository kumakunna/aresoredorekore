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
    // **進行役があるのに、部屋の画面につながっていない。**
    // RT_GAME_SCREENS に無いと gameSupportsRoom が false になり、
    // 待合で「まだ1人1台に対応していません」と出て、始めるボタンが押せない。
    // てふだで実際に起きた（同じ形の手書き一覧が4つあった）
    const html2 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const screenMap = (html2.match(/var RT_GAME_SCREENS = \{([\s\S]*?)\};/) || [])[1] || '';
    RT_GAME_IDS.forEach((id) => {
      assert(new RegExp(id + ':').test(screenMap),
        id + ' が RT_GAME_SCREENS にありません。待合で「まだ1人1台に対応していません」と出て始められません');
    });
    // **開始設定（RT_START_CONFIG）が無いと、既定の人狼設定で始まってしまう。**
    // 待合の表示は「てふだの準備ができました」なのに、押すと人狼が始まる——
    // てふだで実際に起きた。黙って別のゲームが始まるのが、いちばん悪い
    const startMap = (html2.match(/var RT_START_CONFIG = \{([\s\S]*?)\};/) || [])[1] || '';
    RT_GAME_IDS.forEach((id) => {
      assert(new RegExp(id + ':').test(startMap),
        id + ' が RT_START_CONFIG にありません。押すと別のゲームが始まります');
    });
    // 名前と説明（GAMES）も無いと、画面には生のidが出る
    RT_GAME_IDS.forEach((id) => {
      assert(new RegExp("id:'" + id + "'").test(html2),
        id + ' が GAMES にありません。画面に生のidが出ます');
    });
    // **逆向き：進行役はあるのに、棚のカセットに入っていない。**
    // この向きの照合が無かったので、てふだは GAME_DRIVERS に登録して ready:true にしても
    // ゲーム選択の画面に出てこなかった（棚の games: は手書きの別一覧・落とし穴4）。
    // 遊べない進行役は、作った人以外には存在しないのと同じ
    RT_GAME_IDS.forEach((id) => {
      assert(CASSETTE_GAME_IDS.indexOf(id) !== -1,
        id + ' は GAME_DRIVERS にあるのに、どのカセットの games: にも入っていません。' +
        '棚から選べないので、誰も遊べません');
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

  await r.test('役職入りワードウルフの人数下限は、サーバーが門番する（正本ループ）', async () => {
    // 実機報告「のぞき見・3人だと開始できない」の調査で発見：下限（のぞき見4人など）は
    // クライアントの表示とボタン無効化だけで、サーバーは3人でものぞき見を開始できた。
    // 無効化はdisabled属性頼みで、選択状態は端末ローカルのため（リロード後のホスト等）
    // 通常UIからも素通りし得る。状態の権威はサーバー（落とし穴8・14）。
    // 下限の式は「基本3人＋役職の数」＝モード表のminPlayers（のぞき見4・かき乱し6・占い5）と一致。
    // 正本は wordwolf-logic の minPlayersFor に置く
    const WW = require('../public/js/wordwolf-logic.js');
    const CASES = [
      { label: 'のぞき見', roles: { peek: 1 }, multiTurn: false },
      { label: 'かき乱し', roles: { peek: 1, fake: 1, involve: 1 }, multiTurn: false },
      { label: '占い', roles: { seer: 1, madman: 1 }, multiTurn: true },
    ];
    for (const c of CASES) {
      const need = WW.minPlayersFor(Object.keys(c.roles));
      const cfg = {
        game: 'wordwolf', wolfCount: 1, wolfAware: true, roles: c.roles,
        multiTurn: c.multiTurn, turnLimit: 2, meetingSec: 0, discussSec: 0
      };
      // 下限のひとつ下：拒否＋必要人数入りのプレイヤー向け文言
      let srv = await startTestServer();
      try {
        const rm = await makeRoom(srv, need - 1);
        const res = await rm.host.call(RT_START_EVENT, cfg);
        assertEqual(res.ok, false, c.label + '：' + (need - 1) + '人では始まらない');
        assert(new RegExp(need + '人以上').test(res.message || ''),
          c.label + '：文言に必要人数が入る（実際:' + (res.message || res.error || 'なし') + '）');
      } finally { await srv.close(); }
      // 下限ちょうど：開始できて、役職も全部配られる
      srv = await startTestServer();
      try {
        const rm = await makeRoom(srv, need);
        const res = await rm.host.call(RT_START_EVENT, cfg);
        assertEqual(res.ok, true, c.label + '：' + need + '人なら始まる');
        const w = srv.store.get(rm.code).wordwolf;
        assertEqual(Object.keys(w.roles).length, Object.keys(c.roles).length,
          c.label + '：役職が全部配られている');
      } finally { await srv.close(); }
    }
  });

  await r.test('手書きの画面idリストが、実在する画面だけを指している（第35弾C・正本ループ）', async () => {
    // テーマ除外・歯車非表示などは手書きのscr-idリストで持っている（落とし穴4）。
    // 画面の改名・削除でリストが腐っても誰も気づかない（該当画面にだけ適用漏れが出る）ので、
    // 正本SCREEN_IDSとの包含を機械照合する
    const inv = require('./inventory');
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const LISTS = [
      ['THEME_FREE_SCREENS', /THEME_FREE_SCREENS = \[([^\]]*)\]/],
      ['noGear', /var noGear = \[([^\]]*)\]/],
      ['RT_SCREENS', /var RT_SCREENS = \[([^\]]*)\]/],
      // RT_GAME_SCREEN_IDS は第36弾から RT_GAME_SCREENS 由来（手書きではない）ので、ここでは見ない
    ];
    for (const [name, re] of LISTS) {
      const m = html.match(re);
      assert(m, name + ' がindex.htmlに存在する');
      const ids = m[1].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean);
      assert(ids.length > 0, name + ' が空でない');
      for (const id of ids) {
        assert(inv.SCREEN_IDS.indexOf(id) !== -1, name + ' の「' + id + '」が実在する画面');
      }
    }
  });

  await r.test('部屋のゲーム画面が、ちゃんと描画に繋がっている（第36弾）', async () => {
    // **器（HTML）だけ足して、描画の呼び出しを忘れる**という抜け方を防ぐ。
    // すごろく3ゲームで実際に起きた：サーバー側は正しく動き、部屋の自動テストも
    // 通るのに、画面には何も出ない（描画関数も分岐も無かった）。
    // 通信と状態しか見ないテストでは、画面の不在を捕まえられない。
    const fs2 = require('fs');
    const path2 = require('path');
    const html = fs2.readFileSync(path2.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // RT_GAME_SCREENS が指している画面（＝部屋で使う画面）を正本にする
    const m = html.match(/var RT_GAME_SCREENS = \{([\s\S]*?)\};/);
    assert(m, 'RT_GAME_SCREENS がindex.htmlに存在する');
    const screens = Array.from(new Set(
      Array.from(m[1].matchAll(/'(scr-rt-[a-z-]+)'/g)).map((x) => x[1])
    ));
    assert(screens.length >= 5, '部屋の画面が抽出できている（いま' + screens.length + '件）');
    for (const id of screens) {
      // ① 描き直しの分岐（rtRenderCurrent）に入っている
      assert(new RegExp("cur === '" + id + "'").test(html),
        id + ' が rtRenderCurrent の分岐に無い（画面に何も出ない）');
    }
    // ② 画面へ移った時の描画も、同じ一覧から引いている。
    //    goTo に画面idを手で並べていると、足し忘れて「開いた直後が空」になる
    assert(html.indexOf("if(RT_GAME_SCREEN_IDS.indexOf(id) !== -1 || id === 'scr-rt-big') rtRender();") !== -1,
      'goTo が RT_GAME_SCREEN_IDS から引いていない（画面idの手書きが復活している）');
    // ③ その一覧そのものも RT_GAME_SCREENS から導いている（手書きに戻っていない）
    assert(html.indexOf('var RT_GAME_SCREEN_IDS = Object.keys(RT_GAME_SCREENS)') !== -1,
      'RT_GAME_SCREEN_IDS が手書きに戻っている');
    // ④ 描き分けが2か所に割れていない。
    //    以前 rtRender に「ゲームidで分ける二つ目の一覧」があり、すごろくだけそこから落ちた。
    //    画面に入った直後だけ人狼の描画が走り、盤が空のままだった（落とし穴4）
    const body = (html.match(/function rtRender\(\)\{([\s\S]*?)\n  \}/) || [])[1] || '';
    assert(body.indexOf('rtRenderCurrent()') !== -1, 'rtRender が rtRenderCurrent を通っていない');
    assert(body.indexOf('rtRoomGameId()') === -1,
      'rtRender に二つ目の振り分け（ゲームidで分ける一覧）が復活している');
  });

  await r.test('すごろくの言い回しが、画面の側に直書きされていない（第36弾-19）', async () => {
    // 手渡し版の画面に書いてあった言葉を部屋版へ写すと、必ず片方だけ古びる
    // （落とし穴2「借りた言葉がその世界観のまま漏れる」）。
    // ルール層に1か所だけ置き、両方の画面がそこを通る形にした。
    // ここでは「画面の側に戻っていないこと」を機械で見張る。
    const fs3 = require('fs');
    const path3 = require('path');
    const dir = path3.join(__dirname, '..');
    const html = fs3.readFileSync(path3.join(dir, 'public', 'index.html'), 'utf8');
    const logic = fs3.readFileSync(path3.join(dir, 'public', 'js', 'sugoroku-logic.js'), 'utf8');
    const hide = fs3.readFileSync(path3.join(dir, 'public', 'js', 'sugoroku-hide.js'), 'utf8');
    const rules = logic + hide;
    const PHRASES = [
      '通行料 −', 'かわりに コイン+', '関所やぶり中',
      ' さんの勝ち！', ' さんが あがり！', 'あがり！',
      'あいこ！ もう一度', 'あいこのまま。この回は動きません',
      'サイコロを振って、駒を動かせます', 'サイコロを振って、2人で分け合ってください',
      '出目より多いので、確定できません', 'ぴったりです', '組で順位がつきます',
      'つじつまが合いません。', 'さんは何も言いませんでした'
    ];
    for (const t of PHRASES) {
      assert(rules.indexOf(t) !== -1, '「' + t + '」がルール層にある（言い回しの置き場所）');
      assert(html.indexOf(t) === -1,
        '「' + t + '」が index.html に直書きされている（片方だけ古びる形）');
    }
  });

  await r.test('部屋の移動記録が、何マス動かしたかを持っている（第36弾-19）', async () => {
    // 持っていないと、画面の側が敗者移動の歩数を計算し直すことになり、
    // ルールが2か所に分かれる（落とし穴1）
    const fs4 = require('fs');
    const path4 = require('path');
    const src = fs4.readFileSync(path4.join(__dirname, '..', 'sugoroku-room.js'), 'utf8');
    const m = src.match(/function moveShared\(room, id, steps, info\) \{([\s\S]*?)\n\}/);
    assert(m, 'moveShared がある');
    assert(m[1].indexOf('steps,') !== -1 || m[1].indexOf('steps:') !== -1,
      '記録に歩数が入っていない（画面が計算し直すことになる）');
  });

  await r.test('完成したカセットが、棚全体の構想でも「完成」になっている（第36弾）', async () => {
    // CLAUDE.md は「docs/ は常に最新に保つ」と決めているが、守れているかを誰も見ていなかった。
    // すごろくを完成させた時点で、構想ドキュメントは
    // 「すごろくの項目が無い」「オークションは作り直す前の設計のまま」
    // 「クイズ王・早押しが非表示中のまま」「実物解除・人狼が未実装のまま」だった。
    // 遊べるのに「未実装」と書いてあると、次に読む人が同じものをもう一度作りかねない
    const inv = require('./inventory');
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'あつまれあれこれ_棚全体の構想.md'), 'utf8');
    const heads = doc.split('\n').filter((l) => l.indexOf('### ') === 0);
    assert(heads.length >= 10, '構想ドキュメントの見出しが読めている（いま' + heads.length + '件）');
    Object.keys(inv.READY_CASSETTE_TITLES).forEach((id) => {
      const title = inv.READY_CASSETTE_TITLES[id];
      const hit = heads.filter((h) => h.indexOf(title) !== -1);
      assert(hit.length >= 1, title + '（' + id + '）の項目が、棚全体の構想にありません');
      assert(hit.some((h) => h.indexOf('★完成') !== -1),
        title + ' は棚に出ているのに、構想では「完成」になっていません（' + hit[0].trim() + '）');
    });
  });

  await r.test('入室経路の正本に、担当テストの割り当てが揃っている（第35弾E・正本ループ）', async () => {
    // 入室経路はUI・URL・socketと性質が違い、1本のループでは回せない。
    // 代わりに「経路→それを固定しているテスト」の対応表をここに置き、
    // 正本に新しい経路が増えたのに担当が決まっていない時に赤くする（落とし穴4の恒久対策）
    const inv = require('./inventory');
    const COVERAGE = {
      'howto-create': 'rt-screens「参加する時に役割を選ばせない」ほか作成系＋abnormal d12（20人・復帰）',
      'howto-join': 'room-edge join系＋abnormal d09（存在しないコード）',
      'qr-url': 'rt-screens「部屋コードを入れると何を遊ぶのかが出る」＋smoke QR系＋D-4実機（リロード3局面）',
      'login-join': 'rt-screens「呼ばれて入るだけの人には部屋をつくるを出さない」',
      'shelf-room-btn': 'rt-screens 部屋ボタン4態（在室・ゲーム中・未在室・消滅）',
      'auto-rejoin': 'room-edge「通信が切れて戻っても同じところに復帰」＋abnormal d01',
      'manual-rejoin': 'abnormal d08（同memberId復帰・同名別人の両面）',
    };
    for (const p of inv.ROOM_ENTRY_PATHS) {
      assert(COVERAGE[p.id], '入室経路「' + p.id + '」に担当テストが割り当てられている（' + p.label + '）');
    }
    assertEqual(Object.keys(COVERAGE).length, inv.ROOM_ENTRY_PATHS.length,
      '対応表に余り（正本から消えた経路）が無い');
  });

  await r.test('異常系シナリオの正本と監査台帳が一致している（第35弾D・正本ループ）', async () => {
    const inv = require('./inventory');
    assert(inv.ABNORMAL_SCENARIOS.length >= 14, 'シナリオ一覧がある（実際:' + inv.ABNORMAL_SCENARIOS.length + '）');
    const fs = require('fs');
    const path = require('path');
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', '監査_異常系シナリオ.md'), 'utf8');
    for (const sc of inv.ABNORMAL_SCENARIOS) {
      assert(doc.indexOf('`' + sc.id + '`') !== -1, '台帳にシナリオの行がある: ' + sc.id + ' ' + sc.name);
    }
  });

  await r.test('画面一覧の正本と監査台帳が一致している（第35弾C・正本ループ）', async () => {
    // 画面・オーバーレイを足したら、監査台帳（docs/監査_画面一覧.md）に行を足さないと赤くなる。
    // マトリクスの行照合（上のテスト）と同じ仕組みの画面版
    const inv = require('./inventory');
    assert(inv.SCREEN_IDS.length >= 60, '画面の自動抽出が動いている（実際:' + inv.SCREEN_IDS.length + '）');
    assert(inv.OVERLAY_IDS.length >= 10, 'オーバーレイの自動抽出が動いている（実際:' + inv.OVERLAY_IDS.length + '）');
    const fs = require('fs');
    const path = require('path');
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', '監査_画面一覧.md'), 'utf8');
    for (const id of inv.SCREEN_IDS) {
      assert(doc.indexOf('`' + id + '`') !== -1, '台帳に画面の行がある: ' + id);
    }
    for (const id of inv.OVERLAY_IDS) {
      assert(doc.indexOf('`' + id + '`') !== -1, '台帳にオーバーレイの行がある: ' + id);
    }
  });

  r.finish();
}

if (require.main === module) run();
module.exports = { run };
