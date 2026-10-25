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
  waitScreen, el, click, activeScreen, openCassette, makeRoomV2 } = require('./harness');

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
 * 部屋を持った状態にする（進行役として）。指示66-3：入口の「部屋をつくる」を押すと、すぐ部屋ができる
 */
async function withRoom(win, doc) {
  const fake = win.__rtFake;
  fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: 'm1', room: roomSnapshot() }) };
  await makeRoomV2(win, doc);
}
/** 一覧でそのカセットのページを開き、ページの下（主ボタンの所）を返す */
async function ページ(x, id) {
  x.win.shelfShowProbe.showAll(true);   // 指示68-1：棚に出していないカセットも並べて見る（本物の棚は3本・tests/shelf.js の門3が見張る）
  click(x.doc, x.doc.querySelector('#scr-v2-pick [data-home-id="' + id + '"]'));
  await sleep(x.win, 40);
  return x.doc.querySelector('#scr-v2-pick [data-home-cta]');
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

  await r.test('指示55-①：1台で遊べない人数なら、二択を出さずに部屋へ倒す', async () => {
    // **変異で素通りしたので足した検査**（55-1-H5）。
    // ロシアンカードの「いっきうち」は2人専用なので、3人以上では
    // 「1台か、みんなのスマホか」を聞く意味が無い——
    // 聞いてから「その人数では遊べません」と言うのは、
    // **押せるのに始まらないボタン**と同じ形（落とし穴14）
    const { win } = await launch({ fakeSocket: true });
    assertEqual(win.roomProbe().room, false, '部屋が無い状態を作れている');  // 型(b)
    // 2人なら、両方できるので二択（E）
    assertEqual(win.playWayFor('rcard', 2).kind, 'choose', '2人なら1台かみんなのスマホかを聞く');
    // 3人以上は、1台が成り立たないので「部屋をつくる」へ（C）
    assertEqual(win.playWayFor('rcard', 3).kind, 'makeRoom', '3人なら部屋をつくるか聞く');
    assertEqual(win.playWayFor('rcard', 8).kind, 'makeRoom', '8人でも同じ');
    // **ほかのカセットの答えは変わっていない**（上限を書いていないモードは Infinity）
    assertEqual(win.playWayFor('jinro', 8).kind, 'choose', '人狼は8人でも二択のまま');
    assertEqual(win.playWayFor('bakudan', 8).kind, 'choose', '爆弾解除も二択のまま');
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

  // 指示66-3：確認の画面（scr-play-way）は無くなった。聞いていたことは、ゲームのページの主ボタンの所に出る（見本 S5）。
  // 入口で「1台で遊ぶ」を選んだ人には、両方で遊べるゲーム（E）を聞き直さない——もう1台と決まっているから
  await r.test('部屋が無い一覧：部屋でしか遊べないゲーム（C）は、主ボタンの所で「部屋をつくって 遊ぶ」（門D9 の後継）', async () => {
    const x = await launch({ fakeSocket: true });
    const cta = await ページ(x, 'quizou');
    assert(/みんなのスマホで遊ぶゲームです/.test(cta.textContent), 'C：理由（みんなのスマホで遊ぶ）');
    const b = cta.querySelector('[data-home-act="pick-make"]');
    assert(b && /部屋をつくって/.test(b.textContent), 'C：次にできること（部屋をつくって遊ぶ）');
    assert(!cta.querySelector('[data-home-act="pick-go"]'), 'C：「このゲームにする」は出さない');
    x.win.close();
  });

  await r.test('部屋が無い一覧：両方で遊べるゲーム（E）と1台だけのゲーム（A）は、聞き直さずに1台で進む', async () => {
    for (const id of ['jinro', 'aresoredorekore']) {
      const x = await launch({ fakeSocket: true });
      await openCassette(x.win, x.doc, id);
      await waitFor(x.win, () => activeScreen(x.doc) !== 'scr-v2-pick', 3000, id + '：進む');
      assert(['scr-game', 'scr-setup', 'scr-mode'].indexOf(activeScreen(x.doc)) !== -1, id + '：確認を挟まず先へ（実際: ' + activeScreen(x.doc) + '）');
      x.win.close();
    }
  });

  await r.test('近日公開は、押せる札にしない（「近日とどきます」の枠だけ）', async () => {
    const x = await launch({ fakeSocket: true });
    const soon = x.doc.querySelector('#scr-v2-pick .v2-ssoon');
    assert(soon, '近日の枠がある');  // 型(b)
    assertEqual(soon.tagName, 'DIV', '押せない（ボタンではない）');
    assert(!soon.querySelector('[data-home-card]'), 'ページを開く札ではない');
    x.win.close();
  });

  await r.test('部屋があっても無くても、一覧には同じゲームが全部ならぶ（消さない・理由が変わるだけ）', async () => {
    const { win, doc } = await launch({ fakeSocket: true });
    win.shelfShowProbe.showAll(true);   // 指示68-1：棚に出していないカセットも並べて見る（本物の棚は3本・tests/shelf.js の門3が見張る）
    const 前 = Array.from(doc.querySelectorAll('#scr-v2-pick [data-home-card]')).map((c) => c.dataset.homeId);
    assert(前.length >= 9, '一覧の札を数えられている（実際:' + 前.length + '件）');  // 型(b)
    await withRoom(win, doc);
    assertEqual(win.roomProbe().room, true, '部屋を作れている');     // 型(b)
    click(doc, doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
    await waitScreen(win, doc, 'scr-v2-pick', 3000);
    const 後 = Array.from(doc.querySelectorAll('#scr-v2-pick [data-home-card]')).map((c) => c.dataset.homeId);
    assertEqual(後.join('|'), 前.join('|'), '部屋ができても、同じゲームが同じ順で全部ならぶ');
    win.close();
  });

  await r.test('ページの左上の ‹ で一覧へ。一覧の左上の ‹ で入口へ（指示44 44-5 の後継）', async () => {
    const x = await launch({ fakeSocket: true });
    await ページ(x, 'quizou');
    const back = x.doc.querySelector('#scr-v2-pick .v2-ov-back [data-home-act="pick-back"]');
    assert(back && back.querySelector('.v2-ring'), 'ページの左上に丸の ‹');
    click(x.doc, back);
    await sleep(x.win, 40);
    assert(!x.doc.querySelector('#scr-v2-pick [data-home-ov]').classList.contains('is-open'), 'ページを閉じて一覧へ');
    click(x.doc, x.doc.querySelector('#scr-v2-pick [data-home-act="pick-exit"]'));
    await waitScreen(x.win, x.doc, 'scr-v2-home', 3000);
    assertEqual(el(x.doc, 'floatingBackBtn').style.display, 'none', '新しい画面には、浮いている戻るを重ねない（自分の ‹ がある）');
    x.win.close();
  });

  r.finish();
})();
