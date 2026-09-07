// tests/play-way.js — 遊び方の確認・6通り（第41弾 2-4・門D9）
//
// **「1台か部屋か」は、入口ではなくカセットをえらんだ後に決まる。**
//
// 指示41 2-4 の表は3通りしか挙げていないが、実際は
// カセットの種類（1台専用／部屋専用／両方対応）× 部屋の有無 で**6通り**ある。
// 表に無い3通りを素通りにしてよいのかを、コードを読んで決めた結果がこの検査。
//
//            | 部屋あり              | 部屋なし
//   1台専用  | B 部屋を閉じるか聞く   | A 素通り
//   部屋専用 | D 素通り              | C 部屋をつくるか聞く
//   両方対応 | F 素通り              | E 1台かみんなのスマホか聞く
//
// **素通りするところに確認を挟むと、1画面1つの原則に反して1タップ増える。**
// 逆に E を素通りにすると、両方対応のカセットが黙って1台に落ちる。

const { createRunner, assert, assertEqual, launch, sleep, waitFor,
  waitScreen, el, click, activeScreen } = require('./harness');

/** 疑似socketに返させる部屋の姿 */
function roomSnapshot(over) {
  return Object.assign({
    code: 'ABC234',
    hostMemberId: 'm1',
    members: [{ id: 'm1', name: 'あき', role: 'player', connected: true }],
    state: { phase: 'lobby', game: null, data: {} }
  }, over || {});
}

/** 部屋を持った状態にする（進行役として） */
async function withRoom(win, doc) {
  click(doc, 'shelfFlowBtn');
  await waitScreen(win, doc, 'scr-howto', 3000);
  click(doc, doc.querySelector('#scr-howto [data-howto="room"]'));
  await waitScreen(win, doc, 'scr-rt-lobby', 3000);
  const fake = win.__rtFake;
  await waitFor(win, () => fake.connected, 3000, '疑似socketがつながる');
  fake.replies = {
    'room:create': () => ({ ok: true, code: 'ABC234', memberId: 'm1', room: roomSnapshot() })
  };
  el(doc, 'rtCreateName').value = 'あき';
  click(doc, 'rtCreateBtn');
  await waitFor(win, () => ['scr-rt-room', 'scr-rt-big'].indexOf(activeScreen(doc)) >= 0,
    4000, '部屋の画面に入る');
}

(async function main() {
  const r = createRunner('play-way：遊び方の確認・6通り（第41弾）');

  await r.test('カセットの種類が、実データから正しく分かれている', async () => {
    // **手書きの分類ではない。**games と modes から導いている
    const { win } = await launch({ fakeSocket: true });
    const 種類 = (id) => {
      const w = win.cassetteWays(id);
      return w.room && w.handoff ? '両方対応' : (w.room ? '部屋専用' : '1台専用');
    };
    assertEqual(種類('aresoredorekore'), '1台専用', 'あれそれどれこれ');
    assertEqual(種類('quizou'), '部屋専用', 'クイズ王');
    assertEqual(種類('auction'), '部屋専用', 'オークション');
    assertEqual(種類('jinro'), '両方対応', '人狼');
    assertEqual(種類('bakudan'), '両方対応', '爆弾解除');
    assertEqual(種類('sugoroku'), '両方対応', 'すごろく');
    win.close();
  });

  await r.test('部屋が無い時の3通り（A・C・E）', async () => {
    const { win } = await launch({ fakeSocket: true });
    assertEqual(win.roomProbe().room, false, '部屋が無い状態を作れている');  // 型(b)

    // A：1台専用 × 部屋なし → **素通り**
    // ここに「部屋をつくる」しか出ないと、1台で遊べるゲームが遊べなくなる
    assertEqual(JSON.stringify(win.playWayFor('aresoredorekore')),
      JSON.stringify({ kind: 'through', way: 'handoff' }),
      'A：1台専用×部屋なしは素通りで1台に進む');

    // C：部屋専用 × 部屋なし → 部屋をつくるか聞く
    // いまは棚で「👥 みんなのスマホが必要です」と出るだけで、作る導線が無い
    assertEqual(win.playWayFor('quizou').kind, 'makeRoom',
      'C：部屋専用×部屋なしは、部屋をつくるか聞く');

    // E：両方対応 × 部屋なし → 二択
    // **ここを素通りにすると、黙って1台に落ちる**（いまの挙動）
    assertEqual(win.playWayFor('jinro').kind, 'choose',
      'E：両方対応×部屋なしは、1台かみんなのスマホかを聞く');
    win.close();
  });

  await r.test('部屋がある時の3通り（B・D・F）', async () => {
    const { win, doc } = await launch({ fakeSocket: true });
    await withRoom(win, doc);
    const probe = win.roomProbe();
    assertEqual(probe.room, true, '部屋を持った状態を作れている');  // 型(b)
    assertEqual(probe.host, true, '進行役として持っている');        // 型(b)

    // B：1台専用 × 部屋あり → 部屋を閉じるか聞く
    // **いまは完全な行き止まり。**棚で施錠され、その画面に部屋を閉じる導線が無い。
    // 救う処理は pickPlayFlow の中にしかなく、scr-howto からしか出せなかった
    const b = win.playWayFor('aresoredorekore');
    assertEqual(b.kind, 'leaveRoom', 'B：1台専用×部屋ありは、部屋を閉じるか聞く');
    assertEqual(b.isHost, true, '進行役なら「閉じる」（参加者なら「抜ける」）');

    // D：部屋専用 × 部屋あり → 素通り（2-4の表に無いが、聞く必要が無い）
    assertEqual(JSON.stringify(win.playWayFor('quizou')),
      JSON.stringify({ kind: 'through', way: 'room' }),
      'D：部屋専用×部屋ありは素通りで部屋に進む');

    // F：両方対応 × 部屋あり → 素通り（部屋があるのだから部屋で遊ぶ）
    assertEqual(JSON.stringify(win.playWayFor('jinro')),
      JSON.stringify({ kind: 'through', way: 'room' }),
      'F：両方対応×部屋ありは素通りで部屋に進む');
    win.close();
  });

  await r.test('判断のもとは、入口で決めた値ではなく部屋の実在', async () => {
    // **入口で決めた値と部屋の実在がずれると、行き止まりができる。**
    // 実測：棚の 👥 を押して部屋を作らずに戻ると playFlow='room'・部屋なしになり、
    // クイズ王（部屋専用）の鍵が外れて「部屋が無いのに遊べる」ように見えた。
    // 押すと全モードが施錠された画面に着いて詰む。
    const { win, doc } = await launch({ fakeSocket: true });

    // その状態を作る
    click(doc, 'shelfRoomBtn');
    await sleep(win, 200);
    const ずれ = win.shelfProbe();
    assertEqual(ずれ.room, false, '部屋はできていない');           // 型(b)

    // **playFlow がどうなっていようと、判断は変わらない**
    assertEqual(win.playWayFor('quizou').kind, 'makeRoom',
      '部屋が無いなら、入口の値に関わらず「部屋をつくる」を聞く');
    assertEqual(JSON.stringify(win.playWayFor('aresoredorekore')),
      JSON.stringify({ kind: 'through', way: 'handoff' }),
      '部屋が無いなら、1台専用は素通りできる');
    win.close();
  });

  r.finish();
})();
