// tests/mode-rules.js — 「ルール文に書いてあることは、本当か」（第45弾 45-3）
//
// ── なぜ要るか ────────────────────────────────────
//
// 指示39の A8 で「表示している約束は本当か」を見るようにしたが、
// **ルール文（MODES.bullets）には当てていなかった。**
// その結果、クイズ解除のルール文は3年ぶん実装から取り残されていた：
//
//   ・「コードをタップするとAIの説明文が出る」
//      → 実際は説明文と3択が**同時に**出る（タップした人は「3択が出た」と読む）
//      → しかも第32弾-A-3-6 で問題バンクに切り替わり、**AIはもう呼んでいない**
//
// 遊んだ人（くまくん以外の1人）がその場で迷って、初めて分かった。
// ルール文は「機能の一部」（大切なこと6）なので、実装と同じだけ見張る。
//
// ── 見張り方 ──────────────────────────────────────
//
// 行ごとに「それが本当なら通る検査」を1つ書き、**両方向で照合する**（落とし穴20）：
//   行き：モードが名乗る全部の行に、検査がある
//   帰り：検査が名指しする行が、実際にモードにある（消した行の幽霊を残さない）
//
// 検査は**本物の進行役（bomb-room.js）を動かして**確かめる（落とし穴25）。
// 手書きの検体を見ると、検体と実装が同じ間違い方をしていても気づかない。

const {
  createRunner, assert, assertEqual, launch } = require('./harness');
const BombRoom = require('../bomb-room.js');
const BombLogic = require('../public/js/bomb-logic.js');

// ---- 本物の進行役を動かすための、最小の部屋 ----
function makeRoom(names) {
  const members = new Map();
  names.forEach((n, i) => members.set('m' + i, {
    id: 'm' + i, name: n, role: 'player', connected: true, readyGame: null
  }));
  return { code: 'TEST45', members, state: { phase: 'lobby', game: null, data: {} } };
}
// 決まった順で並ぶ乱数（同じ盤面を何度でも作れるように）
function seeded(seed) {
  let x = seed || 1;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}
function startCoop(opts) {
  const o = opts || {};
  const room = makeRoom(o.names || ['あき', 'びび']);
  const 呼ばれたAI = [];
  const ctx = {
    notify() {},
    describe(input) { 呼ばれたAI.push(input); return Promise.resolve({ description: 'AIの説明' }); }
  };
  const res = BombRoom.startGame(room, {
    mode: 'coop',
    counts: o.counts || { easy: 3 },
    lives: o.lives == null ? 3 : o.lives,
    timerSec: o.timerSec == null ? 0 : o.timerSec,
    topics: [],
    preset: 'bomb-coop',
    rnd: seeded(o.seed || 7)
  }, ctx);
  return { room, res, ctx, 呼ばれたAI, w: room.bomb };
}
function 正解(w, uid) {
  const wire = w.wires.find((x) => x.uid === uid);
  return wire.choices[wire.correct];
}
function はずれ(w, uid, choices) {
  const 正 = 正解(w, uid);
  return choices.find((c) => c !== 正);
}

(async function main() {
  const r = createRunner('mode-rules：ルール文に書いてあることは本当か');

  // ---- クイズ解除（協力版）の1行ずつ ----
  // キーは**ルール文そのもの**。文を1文字でも直したら、この表も直すことになる——
  // それでよい。**言葉を変えたら、その言葉が本当かを確かめ直す**のが目的だから
  const 協力版の約束 = {
    'チームで協力して爆弾を解除する': (t) => {
      // 「チームで」＝成績が1つ。2人の手元に同じライフ・同じ盤面が届く
      const a = BombRoom.privateFor(t.room, 'm0');
      const b = BombRoom.privateFor(t.room, 'm1');
      assertEqual(a.lives, b.lives, '2人のライフが同じ数から始まる');
      assertEqual(a.total, b.total, '2人が同じ本数の爆弾に向かう');
      // 片方が1つ外すと、**もう片方のライフも減る**（別々の成績ではない）
      const uid = a.board[0].uid;
      BombRoom.submitAction(t.room, 'm0', uid);
      const 手元 = BombRoom.privateFor(t.room, 'm0');
      BombRoom.submitVote(t.room, 'm0', はずれ(t.w, uid, 手元.open.choices));
      assertEqual(BombRoom.privateFor(t.room, 'm1').lives, b.lives - 1,
        '1人が外すと、チーム全員のライフが減る');
    },
    'コードをタップすると、問題と3つの答えが出る': (t) => {
      const uid = BombRoom.privateFor(t.room, 'm0').board[0].uid;
      // タップする前は、問題も答えも1文字も届いていない
      assertEqual(BombRoom.privateFor(t.room, 'm0').open, undefined,
        'タップする前は、何も届いていない');                                   // 型(b)
      BombRoom.submitAction(t.room, 'm0', uid);
      const open = BombRoom.privateFor(t.room, 'm0').open;
      assert(open, 'タップすると届く');
      assert(open.description && open.description.length > 0,
        '問題が出る（' + open.description + '）');
      assertEqual(open.choices.length, 3, '答えは3つ');
      // **同時に**出ることが、この行の言っていること。
      // 片方だけ届く瞬間があるなら、ルール文の方が嘘になる
      assert(open.description && open.choices.length === 3,
        '問題と3つの答えが、同じ1つの知らせで届く');
    },
    '3択で答え、正解でコードが切れる': (t) => {
      const uid = BombRoom.privateFor(t.room, 'm0').board[0].uid;
      BombRoom.submitAction(t.room, 'm0', uid);
      const 前 = BombRoom.privateFor(t.room, 'm0');
      assertEqual(前.board.find((c) => c.uid === uid).solved, false,
        'まだ切れていない');                                                   // 型(b)
      const v = BombRoom.submitVote(t.room, 'm0', 正解(t.w, uid));
      assertEqual(v.correct, true, '正解として受け取られる');
      assertEqual(BombRoom.privateFor(t.room, 'm0').board.find((c) => c.uid === uid).solved, true,
        '正解でコードが切れる');
    },
    '外れるとライフが1つ減る（同じコードは何度でも再挑戦できる）': (t) => {
      const uid = BombRoom.privateFor(t.room, 'm0').board[0].uid;
      const 前 = BombRoom.privateFor(t.room, 'm0').lives;
      BombRoom.submitAction(t.room, 'm0', uid);
      const ch = BombRoom.privateFor(t.room, 'm0').open.choices;
      BombRoom.submitVote(t.room, 'm0', はずれ(t.w, uid, ch));
      assertEqual(BombRoom.privateFor(t.room, 'm0').lives, 前 - 1, 'ライフが1つ減る');
      // 「何度でも再挑戦できる」——同じコードをもう一度開けられる
      const 再 = BombRoom.submitAction(t.room, 'm0', uid);
      assertEqual(再.ok, true, '外したコードを、もう一度開けられる');
      assertEqual(BombRoom.privateFor(t.room, 'm0').open.uid, uid, '同じコードが開く');
    },
    'ライフが0で爆発・全解除で勝利': (t) => {
      // ① ライフを0にすると爆発（成功しない決着）
      const 爆 = startCoop({ lives: 2, counts: { easy: 3 }, seed: 11 });
      for (let i = 0; i < 2; i++) {
        const uid = BombRoom.privateFor(爆.room, 'm0').board.find((c) => !c.solved).uid;
        BombRoom.submitAction(爆.room, 'm0', uid);
        const ch = BombRoom.privateFor(爆.room, 'm0').open.choices;
        BombRoom.submitVote(爆.room, 'm0', はずれ(爆.w, uid, ch));
      }
      const 爆結果 = BombRoom.privateFor(爆.room, 'm0').result;
      assert(爆結果, 'ライフ0で決着する');
      assertEqual(爆結果.success, false, 'ライフが0なら爆発（成功しない）');

      // ② 全部解くと勝利（型(c)：分岐の反対側も通す）
      const 勝 = startCoop({ lives: 3, counts: { easy: 2 }, seed: 13 });
      for (let i = 0; i < 2; i++) {
        const uid = BombRoom.privateFor(勝.room, 'm0').board.find((c) => !c.solved).uid;
        BombRoom.submitAction(勝.room, 'm0', uid);
        BombRoom.submitVote(勝.room, 'm0', 正解(勝.w, uid));
      }
      const 勝結果 = BombRoom.privateFor(勝.room, 'm0').result;
      assert(勝結果, '全部解くと決着する');
      assertEqual(勝結果.success, true, '全解除で勝利');
    },
    '部屋を立てて遊ぶと、全員が同じ盤面を自分のスマホで見られる': (t) => {
      const a = BombRoom.privateFor(t.room, 'm0').board.map((c) => c.uid).sort();
      const b = BombRoom.privateFor(t.room, 'm1').board.map((c) => c.uid).sort();
      assert(a.length > 0, '盤面が届いている');                                // 型(b)
      assertEqual(a.join(','), b.join(','), '2人の盤面が同じコードでできている');
      // 「自分のスマホで」＝それぞれの端末に、それぞれ届いている
      assert(BombRoom.privateFor(t.room, 'm1'), '2人目にも自分ぶんが届く');
    }
  };

  await r.test('45-3：クイズ解除（協力版）のルール文は、1行ずつ本当', async () => {
    const { win } = await launch();
    const m = win.modeProbe('bomb-coop');
    win.close();
    assert(m, 'bomb-coop というモードがある');                                  // 型(b)
    assert(m.bullets.length >= 5, 'ルール文が5行以上ある（いま ' + m.bullets.length + '行）');

    // 行き：名乗っている全部の行に、検査がある
    const 検査の無い行 = m.bullets.filter((b) => !協力版の約束[b]);
    assertEqual(検査の無い行.join(' / '), '',
      'ルール文の全部の行に、本当かを見る検査がある');
    // 帰り：検査が名指しする行が、実際にある（消した行の幽霊を残さない・落とし穴20）
    const 幽霊 = Object.keys(協力版の約束).filter((k) => m.bullets.indexOf(k) < 0);
    assertEqual(幽霊.join(' / '), '', '検査が名指しする行は、いまもルール文にある');

    // 1行ずつ、本物の進行役を動かして確かめる（行ごとに部屋を作り直す）
    m.bullets.forEach((b) => {
      const t = startCoop({ seed: 3 });
      assertEqual(t.res.ok, true, '進行役が始められる：' + b);                 // 型(b)
      協力版の約束[b](t);
    });
  });

  await r.test('45-3：クイズ解除は、遊んでいる間にAIを1度も呼ばない', async () => {
    // ルール文が「AIの説明文」と言い続けていたのは、**第32弾-A-3-6 で
    // 問題バンクに切り替えたあとも言葉が残っていた**から（大切なこと9の型）。
    // 言葉を直すだけだと、また同じことが起きる。**呼んでいないこと自体**を見張る
    const t = startCoop({ counts: { easy: 3 }, seed: 5 });
    assertEqual(t.res.ok, true, '始められる');                                 // 型(b)
    assertEqual(t.呼ばれたAI.length, 0, '説明文を作るためにAIを呼んでいない');
    // 出ているのは問題バンクの問題文（3択を最初から持っているコード）
    const uid = BombRoom.privateFor(t.room, 'm0').board[0].uid;
    const wire = t.w.wires.find((x) => x.uid === uid);
    assert(BombLogic.isBankWire(wire), 'コードは問題バンクから来ている');
    assertEqual(wire.description, wire.question, '出るのは問題文そのもの');

    // だから、ルール文にも「AI」を書かない（書いてあれば、それは嘘）
    const { win } = await launch();
    const modes = ['bomb-coop', 'bomb-race'].map((id) => win.modeProbe(id));
    win.close();
    modes.forEach((m) => {
      assert(m, 'モードがある');                                               // 型(b)
      const 全文 = m.title + '／' + m.sub + '／' + m.bullets.join('／');
      assert(!/AI/.test(全文), m.id + ' の説明に「AI」が出てこない（' + 全文 + '）');
    });
  });

  r.finish();
})();
