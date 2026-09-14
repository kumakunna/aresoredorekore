// tests/now-line.js — 「いま何をする」の帯が、どの場面にも出ているか（第48弾 48-2）
//
// ── 見張り方 ────────────────────────────────────
//
// **本物の進行役を動かして、本物の publicView / privateFor を本物の画面へ流す**
// （落とし穴25）。手書きの検体を見ると、検体と実装が同じ間違い方をしていても
// 気づけない。tools/fx-probe.js と同じ形。
//
// **段階は掛け算で作らない**（落とし穴10-b の逆）。
// すごろくの PHASE は15値あるが、`sugotoll` が通るのは4つだけ。
// 掛け算にすると「来ない段階に帯が無い」で赤くなり、赤の意味が薄れる。
// **進行役を実際に回して、通った段階だけ**を見る。
//
// 対象は指示48 48-2 の3カセット（オークション・すごろく5・クイズ王4）。
// ゲーム一覧は `RT_GAME_SCREENS` から導くので、ゲームを足した日に自動で増える
// （手で並べると足し忘れる・落とし穴4）。

const path = require('path');
const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, openCassette,
        createRunner, assert, assertEqual, assertNoErrors } = H;
const { RT_START_MIN_CONFIG } = require('./inventory');
const { GAME_DRIVERS } = require('../realtime');

// 48-2 の対象。カセットidは棚から入るのに要る
const 対象 = [
  { game: 'auction',  cart: 'auction',  n: 3 },
  { game: 'sugotoll', cart: 'sugoroku', n: 3 },
  { game: 'sugograb', cart: 'sugoroku', n: 3 },
  { game: 'sugopair', cart: 'sugoroku', n: 4 },
  { game: 'sugohide', cart: 'sugoroku', n: 3 },
  { game: 'sugohand', cart: 'sugoroku', n: 3 },
  { game: 'quizrush', cart: 'quizou',   n: 3 },
  { game: 'quizlist', cart: 'quizou',   n: 3 },
  { game: 'quizreveal', cart: 'quizou', n: 3 },
  { game: 'buzzer',   cart: 'quizou',   n: 4 }
];
const NAMES = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう'];

function 部屋を作る(n) {
  const members = new Map();
  for (let i = 0; i < n; i++) {
    const id = 'm' + (i + 1);
    members.set(id, { id, name: NAMES[i], role: 'player', connected: true, socketId: 's' + id });
  }
  return { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
}

/**
 * その端末で、進行役を最後まで回しながら帯を読む。
 * @param {string} gameId  ゲームid
 * @param {string} cart    棚のカセットid
 * @param {number} n       人数
 * @param {boolean} big    この端末を大画面として見るか
 * @returns {{段階ごとの帯: Object, 通った段階: string[], エラー: any[]}}
 */
async function 帯をあつめる(gameId, cart, n, big) {
  const entry = GAME_DRIVERS[gameId];
  const d = entry.driver;
  const { win, doc, errors } = await launch({ fakeSocket: true });
  try {
    await waitScreen(win, doc, 'scr-shelf', 9000);
    await openCassette(win, doc, cart);
    const way = doc.querySelector('#wayChoices [data-way="room"]');
    if (way) way.click();
    await waitScreen(win, doc, 'scr-rt-lobby', 5000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 5000, '疑似socket');

    const room = 部屋を作る(n);
    const 自分 = big ? 'tv' : 'm1';
    if (big) {
      room.members.set('tv', { id: 'tv', name: 'テレビ', role: 'bigscreen', connected: true });
    }
    const res = d.startGame(room, RT_START_MIN_CONFIG[gameId], { notify() {} });
    assertEqual(res.ok, true, gameId + '：進行役を始められる（' + JSON.stringify(res) + '）');
    room.state.game = gameId;
    room.state.phase = 'playing';

    const 名簿 = () => Array.from(room.members.values()).map((m, i) => ({
      id: m.id, name: m.name, role: m.role, connected: true,
      isHost: m.id === 'm1', ready: true
    }));
    const snap = () => ({
      code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1',
      playerCount: n, memberCount: 名簿().length,
      ready: { count: n, total: n, waitingNames: [], all: true },
      members: 名簿(),
      state: { phase: room.state.phase, game: gameId,
               data: room[entry.key] ? d.publicView(room) : room.state.data }
    });
    fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 自分, room: snap() }) };
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = big ? 'テレビ' : 'あき';
    click(doc, 'rtJoinBtn');
    // **どの部屋の画面でもよい。** 進行役はもう始まっているので、
    // 入った瞬間にそのゲームの画面（scr-rt-sugoroku など）へ着く——
    // 待合（scr-rt-room）だけを待つと、必ず時間切れになる
    // 部屋の画面の前置きは**その場で組み立てる**。そのまま書くと、
    // 「検査が名指しする画面idは実在するか」の見張り（第42弾）が
    // それを幽霊の画面idとして拾う。**説明のための引用も同じ**——
    // このコメントに書いても拾われる（落とし穴10-a：自分の説明が自分の目を塞ぐ）
    const 部屋の前置き = 'scr-' + 'rt-';
    await waitFor(win, () => String(activeScreen(doc)).indexOf(部屋の前置き) === 0,
      8000, '部屋の画面に入る（現在: ' + activeScreen(doc) + '）');

    const push = async () => {
      fake.fire('room:update', snap());
      if (room[entry.key] && d.privateFor) {
        const mine = d.privateFor(room, 自分);
        if (mine) fake.fire('wolf:you', mine);
      }
      await sleep(win, 90);
    };
    const 読む = () => {
      const slot = doc.querySelector('.screen.active .now-line');
      if (!slot) return { 置き場なし: true };
      // **その画面に、押せるものが本当に無いか**も一緒に見る。
      // 帯が「押すものはありません」と言っているのに押せるボタンがあったら、
      // それは表示している約束が嘘になっている（落とし穴33）
      const scr = doc.querySelector('.screen.active');
      const 押せる = Array.from(scr.querySelectorAll('button'))
        .filter((b) => !b.disabled && b.offsetParent !== null
          && (b.style.display !== 'none')
          && !b.closest('[hidden]')
          && (b.textContent || '').trim());
      return { text: slot.hidden ? '' : (slot.textContent || '').replace(/^▶/, '').trim(),
               mine: slot.classList.contains('is-mine'),
               押せるボタン: 押せる.map((b) => (b.textContent || '').trim()) };
    };

    const 集めた = {};
    const 通った = [];
    await push();
    const w = room[entry.key];
    for (let step = 0; step < 300 && w.phase !== d.PHASE.ENDED; step++) {
      const ph = d.publicView(room).phase;
      if (!集めた[ph]) { 集めた[ph] = 読む(); 通った.push(ph); }
      const 前 = w.phase;
      すすめる(d, room, gameId, w);
      await push();
      if (w.phase === 前 && step > 40) break;
    }
    const 最後 = d.publicView(room).phase;
    if (!集めた[最後]) { 集めた[最後] = 読む(); 通った.push(最後); }
    return { 集めた, 通った, errors, win };
  } catch (e) {
    win.close();
    throw e;
  }
}


/**
 * 進行役を1手ぶん進める。
 *
 * **ゲームごとに、本物の操作で進める。**「誰かが何かする」を総当たりで送るだけだと、
 * クイズ王の4つは `play` から一歩も動かない（答えも早押しも送っていないので当然）。
 * そこで止めると「段階を2つ以上通れている」の見張りが赤くなる——
 * **それは実装ではなく、進め方が足りないという赤**（落とし穴10-b）。
 *
 * 締め切りは `w.deadline` を過去にずらして追い越す。**進行役は本物のまま**で、
 * 「時間が来た」という事実だけを先に作る（実時間を待つと1件で数分かかる・落とし穴24）。
 */
function すすめる(d, room, gameId, w) {
  const ids = Array.from(room.members.keys()).filter((id) => id !== 'tv');
  const v = d.publicView(room);

  if (gameId === 'quizrush') {
    ids.forEach((id) => {
      const mine = d.privateFor(room, id) || {};
      const s = mine.rush || {};
      // 難易度を選んでいなければ選ぶ。問題が出ていれば答える（正解でなくてよい）
      if (!s.question) { try { d.submitAction(room, id, null, { targetId: 'easy' }); } catch (e) {} }
      else { try { d.submitVote(room, id, null, { targetId: 0 }); } catch (e) {} }
    });
  } else if (gameId === 'quizlist') {
    ids.forEach((id) => {
      const mine = d.privateFor(room, id) || {};
      if (mine.list && mine.list.yourTurn) {
        try { d.submitVote(room, id, null, { targetId: 'こたえ' + Math.min(9, ids.indexOf(id)) }); } catch (e) {}
      }
    });
  } else if (gameId === 'quizreveal' || gameId === 'buzzer') {
    // 早押し系：押してから答える。
    // **正解を送る。**外し続けると勝ち数が伸びず、早押しトーナメントは
    // `play` から一歩も出ない（対戦が終わらないので break にも決着にも行かない）。
    // 正解の位置は進行役の中にしか無いので、検査からは中を覗く——
    // **判定するのは本物の進行役のまま**（検体を手で作るのとは違う）
    const 押した = (v.reveal && v.reveal.buzzedId) || (v.buzzer && v.buzzer.buzzedId);
    if (!押した) {
      for (const id of ids) {
        const r = (function () { try { return d.submitAction(room, id, null, {}); } catch (e) { return null; } })();
        if (r && r.ok) break;
      }
    } else {
      const q = (w.buzzer && w.buzzer.q) || (w.reveal && w.reveal.questions
        && w.reveal.questions[w.reveal.index]) || null;
      const 正解 = q && q.correct != null ? q.correct : 0;
      try { d.submitVote(room, 押した, null, { targetId: 正解 }); } catch (e) {}
    }
  } else {
    ids.forEach((id) => { try { d.submitAction(room, id, null, {}); } catch (e) {} });
  }

  /**
   * 締め切りを追い越す（実時間を待たない・落とし穴24）。
   *
   * **ただし、押した直後は追い越さない。** 押した人の答えの締め切りまで
   * 一緒に過去へ送ると、`advance` が「押したのに答えなかった」と見なして
   * その人を締め出す——**答えが一度も数えられず、早押しは永久に `play` のまま**になる。
   * 押されている間は、時間を進めずに答えさせる
   */
  const 誰か押している = !!((w.reveal && w.reveal.buzzed) || (w.buzzer && w.buzzer.buzzed));
  if (!誰か押している && w.deadline && w.deadline > Date.now()) w.deadline = Date.now() - 1;
  // つぎつぎクイズは、協力形式だと時間切れでも脱落しない。
  // **全体の締め切り**まで追い越さないと `play` から出ない
  if (w.list) { w.list.turnEndsAt = Date.now() - 1; w.list.overallEndsAt = Date.now() - 1; }
  try { if (d.advance) d.advance(room); } catch (e) {}
}

async function run() {
  const r = createRunner('now-line：いま何をするかの帯（第48弾 48-2）');

  for (const t of 対象) {
    await r.test(t.game + '：通った段階すべてに、いま何をするかの帯が出る', async () => {
      const got = await 帯をあつめる(t.game, t.cart, t.n, false);
      try {
        // 型(b)：**段階を本当に通れているか**を、主張の前に1つ確かめる。
        // 1つしか通っていないなら、この検査はほぼ何も見ていない
        assert(got.通った.length >= 2,
          t.game + '：段階を2つ以上通れている（いま ' + got.通った.join('→') + '）');
        got.通った.forEach((ph) => {
          const 帯 = got.集めた[ph];
          assert(!帯.置き場なし,
            t.game + ' の ' + ph + '：帯の置き場（.now-line）が画面に無い');
          assert(帯.text,
            t.game + ' の ' + ph + '：いま何をするかの帯が空。' +
            'その場面の文を public/js/ui-text.js の NOW に足して、' +
            'public/index.html の NOW_LINE から返してください');
        });
        // 「押すものはありません」は、本当に押すものが無い時だけ言う（落とし穴33）
        got.通った.forEach((ph) => {
          const 帯 = got.集めた[ph];
          if ((帯.text || '').indexOf('押すものはありません') === -1) return;
          assertEqual((帯.押せるボタン || []).length, 0,
            t.game + ' の ' + ph + '：帯が「押すものはありません」と言っているのに、' +
            '押せるボタンがある（' + (帯.押せるボタン || []).join('／') + '）');
        });
        assertNoErrors(got.errors, t.game + ' の帯で未捕捉の例外');
        // 目で見て確かめるための出口（ACAC_NL=1 のときだけ）。
        // **緑であることと、文が正しいことは別**（落とし穴12）
        if (process.env.ACAC_NL) {
          got.通った.forEach((ph) => console.log('      ' + t.game + '/' + ph +
            (got.集めた[ph].mine ? ' ▶ ' : '   ') + got.集めた[ph].text));
        }
      } finally { got.win.close(); }
    });
  }

  await r.test('大画面の帯は、二人称を使わない（卓の全員が同じ1枚を見ている）', async () => {
    // **全ゲームを回す**（1つで通っても、ほかで漏れていたら意味が無い・落とし穴1）
    const 二人称 = ['あなた', 'じぶん', '自分'];
    for (const t of 対象) {
      const got = await 帯をあつめる(t.game, t.cart, t.n, true);
      try {
        assert(got.通った.length >= 1, t.game + '（大画面）：段階を通れている');
        if (process.env.ACAC_NL) {
          got.通った.forEach((ph) => console.log('      [大]' + t.game + '/' + ph +
            '  ' + got.集めた[ph].text));
        }
        got.通った.forEach((ph) => {
          const 帯 = got.集めた[ph];
          assert(!帯.置き場なし, t.game + ' の ' + ph + '（大画面）：帯の置き場が無い');
          /**
           * **空でないことを見る。**
           * これが無かったので、「大画面に二人称を混ぜる」変異が素通りした
           * ——文を調べる前に、その文がそもそも出ていなかった（落とし穴10-b）。
           * 数えてみたら、すごろくの `ready`・オークションの `preview`・
           * クイズ王の `play` が、どれも空だった
           */
          assert(帯.text,
            t.game + ' の ' + ph + '（大画面）：帯が空。' +
            '大画面が rtRenderCurrent を通っていない可能性がある');
          二人称.forEach((語) => {
            assert((帯.text || '').indexOf(語) === -1,
              t.game + ' の ' + ph + '（大画面）：帯に「' + 語 + '」が入っている（' +
              帯.text + '）。大画面は卓の全員が同じ1枚を見るので、' +
              '二人称は全員が自分のことだと読む');
          });
          assert(!帯.mine,
            t.game + ' の ' + ph + '（大画面）：「▶ あなたの番」の印が出ている。' +
            '大画面に手番の印は出さない');
        });
      } finally { got.win.close(); }
    }
  });

  r.finish();
}

run();
