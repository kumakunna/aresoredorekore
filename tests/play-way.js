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
  waitScreen, el, click, activeScreen, openCassette } = require('./harness');

/** 疑似socketに返させる部屋の姿 */
function roomSnapshot(over) {
  return Object.assign({
    code: 'ABC234',
    hostMemberId: 'm1',
    members: [{ id: 'm1', name: 'あき', role: 'player', connected: true }],
    state: { phase: 'lobby', game: null, data: {} }
  }, over || {});
}

/**
 * 部屋を持った状態にする（進行役として）。
 *
 * 道が変わった（第41弾 2-1・2-4）。以前は「あそびかたをえらぶ→みんなのスマホ」で
 * 部屋の画面へ行けた。その画面は廃止したので、
 * **部屋でしか遊べないカセットを選ぶ**→確認が「部屋をつくる」を出す、で行く。
 */
async function withRoom(win, doc) {
  await openCassette(win, doc, 'quizou');
  // **ここで waitScreen は使えない。**waitFor は「遊び方の確認」を
  // 自動で通り抜けるので、その画面を待つと永遠に来ない（自分で通してしまう）
  assertEqual(activeScreen(doc), 'scr-play-way', '部屋をつくる確認が出ている');
  click(doc, doc.querySelector('#wayChoices [data-way="room"]'));
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

  await r.test('判断のもとは部屋の実在だけ。ずれる値がもう存在しない（第41弾 2-1）', async () => {
    // **もとのバグ：**棚の 👥 を押して部屋を作らずに戻ると
    // playFlow='room'・部屋なしになり、クイズ王（部屋専用）の鍵が外れて
    // 「部屋が無いのに遊べる」ように見えた。押すと詰んだ。
    //
    // ④で判断を部屋の実在1つに寄せ、⑥で **playFlow という値そのものを消した**。
    // だから「ずれた状態を作って確かめる」検査は、もう組み立てられない。
    // 代わりに**ずれようがないこと**を2つの向きから見る（落とし穴20）。
    const { win, doc } = await launch({ fakeSocket: true });

    // 向き①：ずれる値が、もう外から見えない
    const probe = win.shelfProbe();
    assert(!('playFlow' in probe),
      '入口で決めた遊び方という値が、もう無い（実際のキー: ' + Object.keys(probe).join(',') + '）');
    assertEqual(probe.room, false, '部屋が無い状態から始めている');  // 型(b)

    // 向き②：部屋が無い時と有る時で、答えが実際に変わる
    assertEqual(win.playWayFor('quizou').kind, 'makeRoom',
      '部屋が無いなら「部屋をつくる」を聞く');
    assertEqual(JSON.stringify(win.playWayFor('aresoredorekore')),
      JSON.stringify({ kind: 'through', way: 'handoff' }),
      '部屋が無いなら、1台専用は素通りできる');

    await withRoom(win, doc);
    assertEqual(win.roomProbe().room, true, '部屋を作れている');     // 型(b)
    assertEqual(JSON.stringify(win.playWayFor('quizou')),
      JSON.stringify({ kind: 'through', way: 'room' }),
      '部屋が有れば、同じカセットが素通りになる');
    win.close();
  });

  await r.test('聞く3通りは、確認の画面が出る（門D9）', async () => {
    // C：部屋専用 × 部屋なし → 「部屋をつくる」
    let x = await launch({ fakeSocket: true });
    await openCassette(x.win, x.doc, 'quizou');
    assertEqual(activeScreen(x.doc), 'scr-play-way', 'C：確認の画面が出る');
    assertEqual(
      Array.from(x.doc.querySelectorAll('#wayChoices [data-way]')).map((b) => b.dataset.way).join(','),
      'room', 'C：出る道は「部屋をつくる」だけ');
    assert(/つくる/.test(x.doc.getElementById('wayChoices').textContent),
      'C：ボタンの札が「部屋をつくる」');
    x.win.close();

    // E：両方対応 × 部屋なし → 二択。**どちらも肯定の選択肢**
    x = await launch({ fakeSocket: true });
    await openCassette(x.win, x.doc, 'jinro');
    assertEqual(activeScreen(x.doc), 'scr-play-way', 'E：確認の画面が出る');
    assertEqual(
      Array.from(x.doc.querySelectorAll('#wayChoices [data-way]')).map((b) => b.dataset.way).join(','),
      'handoff,room', 'E：1台とみんなのスマホの二択');
    // やめる道があること（行き止まりにしない）
    assert(el(x.doc, 'wayCancelBtn').textContent.length > 0, 'E：やめる道がある');
    x.win.close();
  });

  await r.test('素通りの3通りは、確認を挟まない（門D9）', async () => {
    // A：1台専用 × 部屋なし。**ここに確認を挟むと1タップ増える**
    const x = await launch({ fakeSocket: true });
    await openCassette(x.win, x.doc, 'aresoredorekore');
    assert(activeScreen(x.doc) !== 'scr-play-way',
      'A：確認を挟まず先へ進む（実際: ' + activeScreen(x.doc) + '）');
    x.win.close();
  });

  await r.test('近日公開のカセットは、確認より手前で止まる', async () => {
    // 遊び方の鍵は外したが、**まだ中身が無いものは止める**
    const x = await launch({ fakeSocket: true });
    // **準備中は1枚に畳まれている**（第41弾 2-2）。
    // 畳んだ札は data-cart を持たない——1枚が特定のidを名乗る嘘にしないため
    const soon = x.doc.querySelector('.cart.soon[data-more]');
    assert(soon, '準備中の札が棚にある');  // 型(b)
    await openCassette(x.win, x.doc, null, soon);
    assertEqual(activeScreen(x.doc), 'scr-shelf', '棚に留まる');
    x.win.close();
  });

  await r.test('棚のタイルの鍵は、遊び方に左右されない（第41弾）', async () => {
    // **タイルが「みんなのスマホが必要です」と言うのに押すと開く、という嘘を作らない。**
    // タップが playFlow を見なくなったのに、タイルの鍵だけ playFlow で描いていた時期があった。
    // 遊び方の違いは、押した後の確認（playWayPlan）が引き受ける。
    // 棚で止めるのは「まだ中身が無い」ものだけ
    const { win, doc } = await launch({ fakeSocket: true });
    const 前 = win.shelfProbe().locks;
    assert(前.length >= 3, 'カセットの鍵を数えられている（実際:' + 前.length + '件）');  // 型(b)
    assertEqual(win.shelfProbe().room, false, '部屋が無い状態から始めている');  // 型(b)

    // **部屋を作っても、棚の鍵は1つも変わらない。**
    // 以前は棚の 👥 で入口の値をずらして確かめていたが、その値も 👥 も
    // 第41弾で無くなった。代わりに、鍵に影響しそうな一番大きい変化
    //（部屋ができる）を実際に起こして、それでも変わらないことを見る
    await withRoom(win, doc);
    assertEqual(win.roomProbe().room, true, '部屋を作れている');     // 型(b)
    click(doc, 'rtPickGameBtn');
    await waitScreen(win, doc, 'scr-shelf', 3000);

    assertEqual(win.shelfProbe().locks.join('|'), 前.join('|'),
      '部屋ができても、棚の鍵は変わらない');

    // 中身が無いものは止まる（鍵を全部外したわけではない）
    const soon = doc.querySelector('.cart.soon[data-more]');
    assert(soon, '準備中の札がある');
    assert(/準備中/.test(soon.textContent), '中身が無いものは、それと分かる');
    win.close();
  });
  r.finish();
})();
