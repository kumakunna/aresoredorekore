// tests/sugoroku-logic.js — カセット「すごろく」共通のルール層（第36弾）
//
// ここは DOM も socket.io も使わない純粋な計算なので、jsdom を立てずに確かめる。
// 見るのは7つ:
//   ・5ゲームの性格表が、指示どおりの人数・盤の長さ・目安時間になっていること
//   ・突然イベントを「起こさない」と決めたゲームには、構造的に配れないこと
//   ・盤の効果マスが、振り出し直後とあがり直前に置かれないこと
//   ・あがりを超える出目でも、あがり扱いになること（決めごと①）
//   ・効果マスの効果が連鎖しないこと（決めごと②）
//   ・コインが0を下回らないこと（落とし穴8：上限下限は両方向）
//   ・順位が「あがった順 → 距離 → コイン → 同着」の順で決まること
//
// ランダムは必ず引数で渡して固定する（乱数任せのテストは、たまに落ちて信用を失う）。

const S = require('../public/js/sugoroku-logic');
const { createRunner, assert, assertEqual } = require('./harness');

// 呼ばれた順に決まった値を返す乱数
function rndSeq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
// 全部「まん中」を返す乱数
const rndHalf = () => 0.5;

// 指示書に書かれた、5ゲームの決めごと。ここを正として突き合わせる
const SPEC = {
  sugograb: { cells: 30, min: 3, max: 8, estMin: 15, handoff: true, coins: true, events: 'any', tiebreak: 'coins' },
  sugohide: { cells: 30, min: 3, max: 6, estMin: 20, handoff: false, coins: false, events: 'none', tiebreak: 'same' },
  sugopair: { cells: 40, min: 4, max: 8, estMin: 15, handoff: true, coins: false, events: 'plus', tiebreak: 'same' },
  sugotoll: { cells: 40, min: 3, max: 8, estMin: 20, handoff: true, coins: true, events: 'any', tiebreak: 'coins' },
  sugohand: { cells: 30, min: 3, max: 6, estMin: 25, handoff: false, coins: true, events: 'none', tiebreak: 'coins' }
};

(async function main() {
  const r = createRunner('sugoroku-logic：すごろく共通のルール');

  // ---- 性格表（一覧の正本） ----

  await r.test('5ゲームが揃っていて、指示どおりの人数・盤の長さ・目安時間になっている', async () => {
    assertEqual(S.gameIds().length, 5, 'ゲームは5つ');
    Object.keys(SPEC).forEach((id) => {
      const g = S.gameById(id);
      assert(g, id + ' が性格表にありません');
      assertEqual(g.cells, SPEC[id].cells, id + ' の盤のマス数');
      assertEqual(g.minPlayers, SPEC[id].min, id + ' の下限人数');
      assertEqual(g.maxPlayers, SPEC[id].max, id + ' の上限人数');
      assertEqual(g.estMin, SPEC[id].estMin, id + ' の目安時間');
      assertEqual(g.handoff, SPEC[id].handoff, id + ' の手渡し対応');
      assertEqual(g.coins, SPEC[id].coins, id + ' のコインの有無');
      assertEqual(g.events, SPEC[id].events, id + ' の突然イベント');
      assertEqual(g.tiebreak, SPEC[id].tiebreak, id + ' の同点の扱い');
      assert(g.room === true, id + ' は5つとも1人1台（部屋）に対応する');
    });
  });

  await r.test('コインを使わないゲームには、コインマスを置かない', async () => {
    // 指示：コインを使うのは うばいあい・つうこうりょう・てふだ の3つだけ。
    // てふだは「止まるマスを自分で選べる」ので、コインを使うがコインマスは置かない
    S.gameIds().forEach((id) => {
      const g = S.gameById(id);
      const hasCoinCell = (g.cellKinds || []).indexOf('coin') !== -1;
      if (!g.coins) assert(!hasCoinCell, id + ' はコインを使わないのにコインマスがあります');
      if (id === 'sugohand') assert(!hasCoinCell, 'てふだにコインマスを置くと、狙って踏み続けられます');
    });
  });

  await r.test('ふたりの盤には、マイナス方向のマスを置かない', async () => {
    // じっくり信頼関係を育てる遊びなので、荒らす要素を入れない（指示の方針）
    const kinds = S.gameById('sugopair').cellKinds;
    assert(kinds.indexOf('back') === -1, 'ふたりに「もどる」マスは置かない');
  });

  await r.test('まだ完成していないゲームは、棚に出す一覧に入らない', async () => {
    // 「器だけ先に用意し、中身は1つずつ完璧にしてから次へ」（原則2）をデータで持つ
    S.readyGameIds().forEach((id) => {
      assert(S.gameById(id).ready === true, id + ' が ready でないのに一覧に出ています');
    });
  });

  // ---- 突然イベント（構造で保証する） ----

  await r.test('イベントを起こさないゲームには、一覧に何を入れても配られない', async () => {
    // みえない＝位置が突然動くと申告と実際がズレて本人も混乱する
    // てふだ＝有限の手札で積み上げた計算が無に帰す
    // 条件分岐ではなくデータで塞ぐ。イベントを足した人が書き忘れても漏れない（落とし穴4）
    // 実際に入っているイベントの数は、ゲームが増えるたびに変わる。
    // ここで見たいのは「増えても、起こさないゲームには届かない」なので、
    // 足す前との差で見る（絶対数で書くと、イベントを足すたびにテストを直す羽目になる）
    const before = {};
    S.gameIds().forEach((id) => { before[id] = S.eventsFor(id).length; });
    assertEqual(before.sugohide, 0, 'はじめからみえないには何も無い');
    assertEqual(before.sugohand, 0, 'はじめからてふだには何も無い');
    const backup = S.EVENTS.slice();
    try {
      S.EVENTS.push({ id: 'test-any', tone: 'any', games: S.gameIds() });
      S.EVENTS.push({ id: 'test-plus', tone: 'plus', games: S.gameIds() });
      assertEqual(S.eventsFor('sugohide').length, 0, 'みえないにイベントは配られない');
      assertEqual(S.eventsFor('sugohand').length, 0, 'てふだにイベントは配られない');
      assertEqual(S.pickEvent('sugohide', rndHalf), null, 'みえないは引いても null');
      assertEqual(S.pickEvent('sugohand', rndHalf), null, 'てふだは引いても null');
      // ふたりはプラス方向だけ（足した2つのうち1つしか届かない）
      assertEqual(S.eventsFor('sugopair').length - before.sugopair, 1, 'ふたりに届くのは1つだけ');
      S.eventsFor('sugopair').forEach((e) => {
        assertEqual(e.tone, 'plus', 'ふたりに配られるのはプラス方向のものだけ');
      });
      // うばいあい・つうこうりょうは両方届く
      assertEqual(S.eventsFor('sugograb').length - before.sugograb, 2, 'うばいあいは両方');
      assertEqual(S.eventsFor('sugotoll').length - before.sugotoll, 2, 'つうこうりょうは両方');
    } finally {
      S.EVENTS.length = 0;
      backup.forEach((e) => S.EVENTS.push(e));
    }
  });

  await r.test('イベントの一覧に載っていないゲームには配られない', async () => {
    const backup = S.EVENTS.slice();
    try {
      S.EVENTS.length = 0;   // 実データを空にして、この検査だけの一覧で見る
      S.EVENTS.push({ id: 'only-toll', tone: 'any', games: ['sugotoll'] });
      assertEqual(S.eventsFor('sugotoll').length, 1, 'つうこうりょうには配られる');
      assertEqual(S.eventsFor('sugograb').length, 0, 'うばいあいには配られない');
    } finally {
      S.EVENTS.length = 0;
      backup.forEach((e) => S.EVENTS.push(e));
    }
  });

  await r.test('直前に出たイベントは、続けて引かれない', async () => {
    const backup = S.EVENTS.slice();
    try {
      S.EVENTS.length = 0;   // 実データを空にして、この検査だけの一覧で見る
      S.EVENTS.push({ id: 'e1', tone: 'any', games: ['sugotoll'] });
      S.EVENTS.push({ id: 'e2', tone: 'any', games: ['sugotoll'] });
      for (let i = 0; i < 10; i++) {
        const got = S.pickEvent('sugotoll', rndSeq([i / 10]), 'e1');
        assertEqual(got.id, 'e2', '直前の e1 は避ける');
      }
      // 1つしか無い時に「直前と同じ」を弾くと引けなくなる。null を返して黙って壊れない
      S.EVENTS.length = 0;
      S.EVENTS.push({ id: 'only', tone: 'any', games: ['sugotoll'] });
      assertEqual(S.pickEvent('sugotoll', rndHalf, 'only'), null, '引けない時は null');
    } finally {
      S.EVENTS.length = 0;
      backup.forEach((e) => S.EVENTS.push(e));
    }
  });

  // ---- 盤の作り方 ----

  await r.test('盤はふりだしで始まり、あがりで終わる', async () => {
    S.gameIds().forEach((id) => {
      const board = S.makeBoard(id, rndHalf);
      const g = S.gameById(id);
      assertEqual(board.length, g.cells + 1, id + ' の盤の長さ（0＝ふりだしを含む）');
      assertEqual(board[0], 'start', id + ' の0マス目はふりだし');
      assertEqual(board[g.cells], 'goal', id + ' の最後はあがり');
    });
  });

  await r.test('効果マスは、振り出し直後とあがり直前には置かれない', async () => {
    // 振り出してすぐ戻される／あと少しで戻されるのは、どちらも気持ちが折れる。
    //
    // ここで S.SAFE_HEAD を使って範囲を作ってはいけない。実装側の定数を緩めると
    // 検査の範囲も一緒に緩んで、テストが素通りする（実際に一度そうなった）。
    // 守りたい約束は「1・2マス目と、あがりの手前2マスは素のマス」という具体的な形なので、
    // そのままの数字で書く
    assert(S.SAFE_HEAD >= 2, '振り出し直後の安全域が2マス未満になっています');
    assert(S.SAFE_TAIL >= 2, 'あがり直前の安全域が2マス未満になっています');
    for (let seed = 0; seed < 20; seed++) {
      const rnd = rndSeq([seed / 20, 0.1, 0.9, 0.35, 0.7, 0.05]);
      const board = S.makeBoard('sugotoll', rnd);
      const n = board.length - 1;
      [1, 2, n - 2, n - 1].forEach((i) => {
        assertEqual(board[i], 'plain', i + 'マス目に効果マスがあります（安全域）');
      });
    }
  });

  await r.test('効果マスどうしが近づきすぎない', async () => {
    // ここも実装側の MIN_GAP を検査の基準にしない（緩めた時に一緒に緩むため）。
    // 「3マス未満で隣り合わない」という具体の約束をそのまま書く
    assert(S.MIN_GAP >= 3, '効果マスの間隔が3マス未満まで許されています');
    for (let seed = 0; seed < 20; seed++) {
      const rnd = rndSeq([seed / 20, 0.15, 0.8, 0.45, 0.6, 0.25]);
      const board = S.makeBoard('sugograb', rnd);
      const at = [];
      board.forEach((k, i) => { if (k !== 'plain' && k !== 'start' && k !== 'goal') at.push(i); });
      for (let i = 1; i < at.length; i++) {
        assert(at[i] - at[i - 1] >= 3,
          '効果マスが ' + at[i - 1] + ' と ' + at[i] + ' で近すぎます（効果が連鎖して盤が読めなくなる）');
      }
    }
  });

  await r.test('マスの種類を持たないゲームは、素の盤になる', async () => {
    ['sugohide', 'sugohand'].forEach((id) => {
      const board = S.makeBoard(id, rndHalf);
      board.slice(1, -1).forEach((k, i) => {
        assertEqual(k, 'plain', id + ' の ' + (i + 1) + 'マス目に効果マスがあります');
      });
    });
  });

  // ---- 盤面の並べ方（蛇行配置） ----

  await r.test('道が途切れない：行の終わりの次は、真下のマス', async () => {
    // 折り返しで列がずれると、道が斜めに飛んで「どっちへ進むのか」が読めなくなる
    const board = S.makeBoard('sugotoll', rndHalf);
    const lay = S.boardLayout(board);
    for (let i = 0; i < lay.cells.length - 1; i++) {
      const a = lay.cells[i];
      const b = lay.cells[i + 1];
      const sameRow = (a.row === b.row) && (Math.abs(a.col - b.col) === 1);
      const straightDown = (b.row === a.row + 1) && (a.col === b.col);
      assert(sameRow || straightDown,
        i + '→' + (i + 1) + ' が隣でも真下でもない（' + a.row + ',' + a.col + ')→(' + b.row + ',' + b.col + ')');
    }
  });

  await r.test('行ごとに向きが入れかわる（蛇行している）', async () => {
    const lay = S.boardLayout(S.makeBoard('sugotoll', rndHalf));
    assertEqual(lay.cells[0].row, 0, 'ふりだしは1行目');
    assertEqual(lay.cells[0].col, 0, 'ふりだしは左端');
    assertEqual(lay.cells[0].dir, 'right', '1行目は右へ');
    const secondRow = lay.cells.find((c) => c.row === 1);
    assertEqual(secondRow.dir, 'left', '2行目は左へ');
    assertEqual(secondRow.col, lay.cols - 1, '2行目の入口は右端（真下に折り返す）');
  });

  await r.test('同じ場所に2つのマスが重ならない', async () => {
    S.gameIds().forEach((id) => {
      const lay = S.boardLayout(S.makeBoard(id, rndHalf));
      const seen = new Set();
      lay.cells.forEach((c) => {
        const key = c.row + ',' + c.col;
        assert(!seen.has(key), id + ' の ' + key + ' が重複している');
        seen.add(key);
      });
    });
  });

  await r.test('いちばん長い盤（40マス）でも、1画面に収まる形に収まる', async () => {
    // スクロールせずに見渡せることが、この遊びの前提（みんなで同じ盤を見る）
    const lay = S.boardLayout(S.makeBoard('sugotoll', rndHalf));
    assertEqual(lay.cells.length, 41, '0＝ふりだしを含めて41マス');
    assert(lay.rows <= 7, '7行以内に収まる（実際:' + lay.rows + '行）');
    assert(lay.cols <= 6, '6列以内に収まる（実際:' + lay.cols + '列）');
  });

  await r.test('列数を指定しても、道の連なりは崩れない', async () => {
    const lay = S.boardLayout(S.makeBoard('sugohide', rndHalf), 5);
    assertEqual(lay.cols, 5, '指定した列数になる');
    for (let i = 0; i < lay.cells.length - 1; i++) {
      const a = lay.cells[i], b = lay.cells[i + 1];
      assert((a.row === b.row && Math.abs(a.col - b.col) === 1)
        || (b.row === a.row + 1 && a.col === b.col), i + ' で道が飛んでいる');
    }
  });

  // ---- 駒の見分け方 ----

  await r.test('駒は、色に頼らず形で見分けられる', async () => {
    // 色の見え方は人によって違う。形と名前をセットで持つ
    const most = Math.max(...S.gameIds().map((id) => S.gameById(id).maxPlayers));
    assert(S.PIECES.length >= most, '最大人数ぶんの形がある（必要:' + most + ' 実際:' + S.PIECES.length + '）');
    const shapes = new Set(S.PIECES.map((p) => p.shape));
    assertEqual(shapes.size, S.PIECES.length, '形が全部ちがう');
    S.PIECES.forEach((p) => assert(p.name, p.shape + ' に読み方がある'));
    assertEqual(S.pieceFor(0).shape, S.PIECES[0].shape, '1人目');
    assertEqual(S.pieceFor(S.PIECES.length).shape, S.PIECES[0].shape, '人数を超えても壊れず、先頭に戻る');
    assertEqual(S.pieceFor(-1).shape, S.PIECES[S.PIECES.length - 1].shape, '負の数でも壊れない');
  });

  // ---- サイコロ ----

  await r.test('出目は1〜6に収まる', async () => {
    assertEqual(S.rollDice(() => 0), 1, '下限');
    assertEqual(S.rollDice(() => 0.999999), 6, '上限');
    for (let i = 0; i < 100; i++) {
      const v = S.rollDice(() => i / 100);
      assert(v >= 1 && v <= S.DICE_MAX, '出目 ' + v + ' が範囲外');
    }
  });

  // ---- 振る操作（長押しとスワイプ） ----

  await r.test('スワイプすれば、押した時間が短くても振れる', async () => {
    const g = S.rollGesture(80, S.SWIPE_MIN_PX);
    assertEqual(g.ok, true, '振れる');
    assertEqual(g.reason, 'swipe', 'スワイプで振れたと分かる');
  });

  await r.test('スワイプできなくても、押し続けて離せば振れる', async () => {
    // 片手がふさがっている・手が不自由・画面が滑らない、はどれも実際に起きる。
    // 「押して離す」だけができれば必ず遊べる形にしておく
    const g = S.rollGesture(S.HOLD_MIN_MS, 0);
    assertEqual(g.ok, true, 'スワイプなしでも振れる');
    assertEqual(g.reason, 'hold', '長押しで振れたと分かる');
  });

  await r.test('ちょっと触れただけでは振れない（置いた指で暴発しない）', async () => {
    const g = S.rollGesture(60, 5);
    assertEqual(g.ok, false, '振れない');
    assertEqual(g.reason, null, '理由も無い');
  });

  await r.test('振り方の強さは、出目に使える形で返らない', async () => {
    // 勢いで目が変われば「操作が上手い人が有利」になり、サイコロの意味が消える。
    // 強さは演出の速さにしか使えないよう、出目になり得る数を1つも返さない
    const g = S.rollGesture(2000, 500);
    assertEqual(Object.keys(g).sort().join(','), 'ok,power,reason', '返すのはこの3つだけ');
    assert(g.power <= 1, '強さは1を超えない');
    assert(S.rollGesture(0, S.SWIPE_MIN_PX).power >= 0.15, '弱くても0にはしない（演出が止まって見えない）');
  });

  await r.test('強く振っても、出目の範囲は変わらない', async () => {
    // rollDice は乱数しか受け取らない＝勢いを渡す口が無い、という形で担保する
    assertEqual(S.rollDice.length, 1, 'サイコロが受け取るのは乱数だけ');
    const strong = S.rollGesture(3000, 900);
    assertEqual(strong.ok, true, '強く振れば振れる');
    for (let i = 0; i < 50; i++) {
      const v = S.rollDice(() => i / 50);
      assert(v >= 1 && v <= S.DICE_MAX, '出目は1〜6のまま');
    }
  });

  // ---- 駒を進める ----

  await r.test('途中のマスを1つずつ通る（ワープしない）', async () => {
    const board = S.makeBoard('sugohide', rndHalf); // 素の盤
    const mv = S.applyMove(board, 3, 4);
    assertEqual(mv.to, 7, '3マス目から4進む');
    assertEqual(mv.path.join(','), '4,5,6,7', '途中のマスが順に並ぶ');
  });

  await r.test('あがりを超える出目でも、あがり扱いになる（決めごと①）', async () => {
    // 「ぴったり止まらないと上がれない」にすると、最後の1人が延々と足踏みする
    const board = S.makeBoard('sugohide', rndHalf);
    const goal = board.length - 1;
    const mv = S.applyMove(board, goal - 1, 6);
    assertEqual(mv.to, goal, 'あがりに着く');
    assertEqual(mv.goal, true, 'あがったことが分かる');
    assertEqual(mv.path[mv.path.length - 1], goal, '道のりの終点もあがり');
  });

  await r.test('あがりのマスに効果は無い', async () => {
    const board = S.makeBoard('sugohide', rndHalf);
    const goal = board.length - 1;
    const mv = S.applyMove(board, goal - 2, 2);
    assertEqual(mv.coins, 0, 'あがりでコインは増えない');
    assertEqual(mv.bonusPath.length, 0, 'あがりから先へは動かない');
  });

  await r.test('コインマスに止まるとコインが増える', async () => {
    const board = S.makeBoard('sugohide', rndHalf).slice();
    board[10] = 'coin';
    const mv = S.applyMove(board, 6, 4);
    assertEqual(mv.to, 10, 'コインマスに止まる');
    assertEqual(mv.coins, S.CELL_KINDS.coin.coins, '対応表どおりの枚数');
    assertEqual(mv.bonusPath.length, 0, 'コインマスでは動かない');
  });

  await r.test('すすむ・もどるマスの効果が、そのぶん動かす', async () => {
    const board = S.makeBoard('sugohide', rndHalf).slice();
    board[10] = 'forward';
    board[20] = 'back';
    const fwd = S.applyMove(board, 6, 4);
    assertEqual(fwd.stop, 10, '止まったマス');
    assertEqual(fwd.to, 12, '効果で2マスすすむ');
    assertEqual(fwd.bonusPath.join(','), '11,12', '効果で動いたぶんも1マスずつ');

    const bk = S.applyMove(board, 16, 4);
    assertEqual(bk.stop, 20, '止まったマス');
    assertEqual(bk.to, 18, '効果で2マスもどる');
    assertEqual(bk.bonusPath.join(','), '19,18', 'もどる時も1マスずつ');
  });

  await r.test('効果マスの効果は連鎖しない（決めごと②）', async () => {
    // 連鎖を許すと、1回の手番で盤の端から端まで動くことがある
    const board = S.makeBoard('sugohide', rndHalf).slice();
    board[10] = 'forward';
    board[12] = 'coin';   // すすんだ先がコインマス
    const mv = S.applyMove(board, 6, 4);
    assertEqual(mv.to, 12, 'すすんだ先まで動く');
    assertEqual(mv.coins, 0, 'すすんだ先のコインマスは働かない');
  });

  await r.test('もどるマスでも、ふりだしより手前へは行かない', async () => {
    const board = S.makeBoard('sugohide', rndHalf).slice();
    board[1] = 'back';
    const mv = S.applyMove(board, 0, 1);
    assertEqual(mv.to, 0, 'ふりだしで止まる');
    assert(mv.to >= 0, 'マイナスにならない');
  });

  await r.test('動かない時は、道のりが空になる', async () => {
    const board = S.makeBoard('sugohide', rndHalf);
    const mv = S.applyMove(board, 5, 0);
    assertEqual(mv.to, 5, 'その場');
    assertEqual(mv.path.length, 0, '道のりは空（演出も起きない）');
  });

  // ---- コイン ----

  await r.test('コインは0を下回らない（落とし穴8：上限下限は両方向）', async () => {
    assertEqual(S.addCoins(5, 3), 8, '増える');
    assertEqual(S.addCoins(5, -3), 2, '減る');
    assertEqual(S.addCoins(2, -5), 0, '足りない時は0で止まる');
    assertEqual(S.addCoins(0, -1), 0, '0からさらに引いても0');
    assertEqual(S.canPay(5, 5), true, 'ちょうど払える');
    assertEqual(S.canPay(4, 5), false, '足りない');
  });

  // ---- 順位 ----

  await r.test('同じマスにいる人は同順位（決めごと⑥）', async () => {
    const ranks = S.positionRanks([
      { id: 'a', pos: 20 }, { id: 'b', pos: 20 }, { id: 'c', pos: 10 }, { id: 'd', pos: 5 }
    ]);
    assertEqual(ranks.a, 1, 'a は1位');
    assertEqual(ranks.b, 1, 'b も1位（同じマス）');
    assertEqual(ranks.c, 3, '1位が2人いるので、次は3位');
    assertEqual(ranks.d, 4, 'その次は4位');
  });

  await r.test('あがった順が、距離より優先される', async () => {
    const ranked = S.rankPlayers('sugotoll', [
      { id: 'a', pos: 40, coins: 0, goalOrder: 2 },
      { id: 'b', pos: 40, coins: 99, goalOrder: 1 },
      { id: 'c', pos: 39, coins: 99, goalOrder: null }
    ]);
    assertEqual(ranked[0].id, 'b', '先にあがった人が1位（コインは関係ない）');
    assertEqual(ranked[1].id, 'a', '次にあがった人が2位');
    assertEqual(ranked[2].id, 'c', 'あがっていない人は後ろ');
  });

  await r.test('コインを使うゲームは、距離が同じなら残りコインが多い方が上位', async () => {
    const ranked = S.rankPlayers('sugotoll', [
      { id: 'a', pos: 20, coins: 3, goalOrder: null },
      { id: 'b', pos: 20, coins: 9, goalOrder: null },
      { id: 'c', pos: 25, coins: 0, goalOrder: null }
    ]);
    assertEqual(ranked[0].id, 'c', '距離が先');
    assertEqual(ranked[1].id, 'b', '距離が同じならコインが多い方');
    assertEqual(ranked[2].id, 'a', 'コインが少ない方が下');
    assertEqual(ranked[1].tied, false, '差がついているので同着ではない');
  });

  await r.test('コインを使わないゲームは、距離が同じなら同着（無理に順位をつけない）', async () => {
    const ranked = S.rankPlayers('sugopair', [
      { id: 'a', pos: 20, coins: 3, goalOrder: null },
      { id: 'b', pos: 20, coins: 9, goalOrder: null },
      { id: 'c', pos: 25, coins: 0, goalOrder: null }
    ]);
    assertEqual(ranked[0].id, 'c', '距離が先');
    assertEqual(ranked[1].rank, 2, '2番手は2位');
    assertEqual(ranked[2].rank, 2, 'コインが違っても同着');
    assertEqual(ranked[1].tied, true, '同着の印が立つ');
    assertEqual(ranked[2].tied, true, '同着の印が立つ');
  });

  await r.test('コインまで同じなら、コインを使うゲームでも同着', async () => {
    const ranked = S.rankPlayers('sugotoll', [
      { id: 'a', pos: 20, coins: 5, goalOrder: null },
      { id: 'b', pos: 20, coins: 5, goalOrder: null }
    ]);
    assertEqual(ranked[0].rank, 1, '両方1位');
    assertEqual(ranked[1].rank, 1, '両方1位');
    assert(ranked[0].tied && ranked[1].tied, '同着の印が立つ');
  });

  await r.test('順位づけで、渡した情報が消えない', async () => {
    const ranked = S.rankPlayers('sugotoll', [
      { id: 'a', name: 'あき', pos: 20, coins: 5, goalOrder: null }
    ]);
    assertEqual(ranked[0].name, 'あき', '名前が残る');
    assertEqual(ranked[0].rank, 1, '順位が足される');
  });

  // ---- ふたりでひとつ ----

  await r.test('組はランダムに作られる（自分たちで選ばせない）', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const g1 = S.makePairs(ids, 'even', rndSeq([0.9, 0.1, 0.7, 0.3, 0.5]));
    const g2 = S.makePairs(ids, 'even', rndSeq([0.2, 0.8, 0.4, 0.6, 0.1]));
    const flat = (g) => g.map((x) => x.join('')).join('|');
    assert(flat(g1) !== flat(g2), '乱数が違えば組も違う（固定の並びになっていない）');
    // 全員がちょうど1つの組に入る
    [g1, g2].forEach((gs) => {
      const seen = gs.flat();
      assertEqual(seen.length, ids.length, '全員が入る');
      assertEqual(new Set(seen).size, ids.length, '同じ人が2つの組に入らない');
    });
  });

  await r.test('偶数なら、すべて2人組になる', async () => {
    [4, 6, 8].forEach((n) => {
      const ids = Array.from({ length: n }, (_, i) => 'p' + i);
      const gs = S.makePairs(ids, 'even', rndHalf);
      gs.forEach((g) => assertEqual(g.length, 2, n + '人：2人組でない組がある'));
      assertEqual(gs.length, n / 2, n + '人：組の数');
    });
  });

  await r.test('奇数の分け方が、決めごとどおりに違う（9人）', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => 'p' + i);
    const even = S.makePairs(ids, S.PAIR_STYLE.EVEN, rndHalf).map((g) => g.length).sort();
    const one = S.makePairs(ids, S.PAIR_STYLE.ONE, rndHalf).map((g) => g.length).sort();
    assertEqual(even.join('-'), '3-3-3', 'うまいこと＝3人組を均等に散らす');
    assertEqual(one.join('-'), '2-2-2-3', '1つだけ＝3人組は1つ、あとは2人組');
  });

  await r.test('5人・7人では分け方が同じなので、選択肢を出す意味が無い', async () => {
    [5, 7].forEach((n) => {
      assertEqual(S.pairStylesDiffer(n), false, n + '人では同じ結果になる');
      const ids = Array.from({ length: n }, (_, i) => 'p' + i);
      const even = S.makePairs(ids, 'even', rndHalf).map((g) => g.length).sort().join('-');
      const one = S.makePairs(ids, 'one', rndHalf).map((g) => g.length).sort().join('-');
      assertEqual(even, one, n + '人：実際に同じ形になる');
    });
    assertEqual(S.pairStylesDiffer(9), true, '9人では違う結果になるので聞く');
    assertEqual(S.pairStylesDiffer(6), false, '偶数では聞かない');
  });

  await r.test('配分は、合計が出目とぴったり一致した時だけ確定する', async () => {
    assertEqual(S.splitReady(5, { a: 3, b: 2 }), true, 'ぴったりなら確定');
    assertEqual(S.splitReady(5, { a: 2, b: 2 }), false, '少ないと確定しない');
    assertEqual(S.splitReady(5, { a: 4, b: 2 }), false, '多くても確定しない（出目より進めない）');
    assertEqual(S.splitReady(6, { a: 6, b: 0 }), true, '片方が0でもよい（全部まかせる形）');
    assertEqual(S.splitReady(5, {}), false, '誰も入れていなければ確定しない');
    assertEqual(S.splitSum({ a: 3, b: 2 }), 5, '合計が出る');
  });

  await r.test('まとまらない時は等分。端数は切り捨てて、わずかに損をする', async () => {
    // 「ちゃんと交渉した方が得」という誘導（指示書どおり）
    const two = S.autoSplit(5, ['a', 'b']);
    assertEqual(two.a + two.b, 4, '出目5が4マスになる（1マス分が失われる）');
    assertEqual(two.a, two.b, '等分される');
    const even = S.autoSplit(6, ['a', 'b']);
    assertEqual(even.a + even.b, 6, '割り切れる時は損をしない');
    const three = S.autoSplit(5, ['a', 'b', 'c']);
    assertEqual(three.a + three.b + three.c, 3, '3人組でも切り捨て');
  });

  await r.test('相方がいなくなったら、残った1人が出目を全部使える', async () => {
    // 「相談する相手がいないのに相談を待つ」状態を作らない（決めごと⑭）。
    // これが、このゲーム固有の止まり方への備え
    const solo = S.soloSplit(6, 'a');
    assertEqual(solo.a, 6, '出目をそのまま使える');
    assertEqual(S.splitReady(6, solo), true, 'そのまま確定する（待たされない）');
    assertEqual(Object.keys(solo).length, 1, '居ない人の枠は作らない');
  });

  // ---- 人数のチェック ----

  await r.test('人数の下限・上限が、両方向に効く（落とし穴8）', async () => {
    assertEqual(S.checkPlayerCount('sugohide', 2).ok, false, '下限未満は始められない');
    assertEqual(S.checkPlayerCount('sugohide', 3).ok, true, 'ちょうど下限は始められる');
    assertEqual(S.checkPlayerCount('sugohide', 6).ok, true, 'ちょうど上限は始められる');
    assertEqual(S.checkPlayerCount('sugohide', 7).ok, false, '上限超過は始められない');
    assert(S.checkPlayerCount('sugohide', 2).message.indexOf('3') !== -1, '何人必要かが伝わる');
    assert(S.checkPlayerCount('sugohide', 7).message.indexOf('6') !== -1, '何人までかが伝わる');
    assertEqual(S.checkPlayerCount('sonzai-shinai', 4).ok, false, '無いゲームは始められない');
    // 断る理由は、サーバーがそのまま端末へ返す。既存ドライバと同じ語彙にそろえる
    assertEqual(S.checkPlayerCount('sugohide', 2).error, 'too_few_players', '下限の理由コード');
    assertEqual(S.checkPlayerCount('sugohide', 7).error, 'too_many_players', '上限の理由コード');
    assertEqual(S.checkPlayerCount('sonzai-shinai', 4).error, 'unknown_game', '無いゲームの理由コード');
  });

  // ---- つうこうりょう ----

  await r.test('通行料は、順位が上ほど高い', async () => {
    assertEqual(S.tollFor(1, 6), 6, '1位は出目と同じ枚数');
    assertEqual(S.tollFor(1, 1), 1, '1位は出目1でも1枚');
    assertEqual(S.tollFor(2, 6), 3, '2位は半分');
    assertEqual(S.tollFor(3, 5), 3, '3位は半分・端数は切り上げ');
    assertEqual(S.tollFor(2, 1), 1, '半分でも0枚にはしない（切り上げ）');
    assertEqual(S.tollFor(4, 6), 0, '4位以下は無料');
    assertEqual(S.tollFor(8, 6), 0, '下位はずっと無料');
  });

  await r.test('払えるなら必ず払う（払うかどうかは選べない）', async () => {
    // 選べると、先頭の人がわざと払わずに救済の3枚をもらい続けるのが得になり、
    // 救済が抜け道に変わる
    const rich = S.tollOutcome(20, 1, 6);
    assertEqual(rich.cost, 6, '払う額');
    assertEqual(rich.paid, true, '払える');
    assertEqual(rich.stalled, false, '進める');
    assertEqual(rich.relief, 0, '救済は入らない');
  });

  await r.test('払えないと進めないが、代わりにコインが3枚入る', async () => {
    // この救済が無いと、全員がコイン切れで団子になったまま膠着する
    const poor = S.tollOutcome(2, 1, 6);
    assertEqual(poor.paid, false, '払えない');
    assertEqual(poor.stalled, true, 'その場で足止め');
    assertEqual(poor.relief, S.TOLL_RELIEF, '代わりにコインが入る');
    assert(S.TOLL_RELIEF > 0, '救済が0枚だと、膠着から抜け出せない');
  });

  await r.test('コインが0でも、4位以下なら進める（詰みが発生しない）', async () => {
    const broke = S.tollOutcome(0, 4, 6);
    assertEqual(broke.cost, 0, '4位以下は無料');
    assertEqual(broke.stalled, false, 'コインが無くても進める');
  });

  await r.test('つうこうりょうの順位は、コインではなく位置で決まる', async () => {
    // コインを勝利条件にすると「わざと進まずコインを貯める」のが最適解になり、
    // すごろくの目的と矛盾する
    const ranks = S.positionRanks([
      { id: 'a', pos: 5, coins: 999 },
      { id: 'b', pos: 30, coins: 0 }
    ]);
    assertEqual(ranks.b, 1, 'コインが0でも、前にいる人が1位');
    assertEqual(ranks.a, 2, 'コインを持っていても、後ろなら2位');
  });

  await r.test('つうこうりょうのイベントは、先頭の固定化をくずすものになっている', async () => {
    const list = S.eventsFor('sugotoll');
    assert(list.length >= 2, 'イベントが用意されている');
    list.forEach((e) => {
      assert(e.id && e.title && e.note, e.id + ' に題と説明がある（何が起きたか分からないのが一番混乱する）');
    });
  });

  // ===== 言い回し（第36弾-19） =====
  // 手渡し版と部屋版が同じ言葉を使うための層。**両方がここを通る**ことが要点なので、
  // 言葉そのものより「場面ごとに違うものが返る」ことを固定する

  await r.test('通行料：払えた時と払えなかった時で、言うことが変わる', async () => {
    const paid = S.tollWords({ toll: 3, rank: 2, coinsGained: 0 }, 'あき');
    assert(paid.note.indexOf('3') !== -1, 'いくら払ったか出る（' + paid.note + '）');
    assert(paid.note.indexOf('2位') !== -1, '何位だからかも出る');
    const stalled = S.tollWords({ stalled: true, toll: 5, relief: 3 }, 'あき');
    // 責める場面にしない（原則7）。**入った方が主語**になっていること
    assert(stalled.note.indexOf('コイン+3') !== -1, '入った方を大きく出す（' + stalled.note + '）');
    assert(stalled.hint.indexOf('あき') !== -1, '払えなかったことは小さく添える');
    assert(stalled.note.indexOf('払えません') === -1, '大きい方に、責める言葉を置かない');
  });

  await r.test('通行料：関所やぶり中は、0でも理由が分かる', async () => {
    const free = S.tollWords({ toll: 0, rank: 1, free: true }, 'あき');
    const zero = S.tollWords({ toll: 0, rank: 4 }, 'あき');
    assert(free.note !== zero.note, 'イベント中とそうでない時で言い方が違う');
    assert(free.note.indexOf('関所') !== -1, 'なぜ0なのかが分かる（' + free.note + '）');
  });

  await r.test('通行料：もらったコインは、別の一言として出せる', async () => {
    const got = S.tollWords({ toll: 1, rank: 1, coinsGained: 4 }, 'あき');
    assertEqual(got.gain, 'コイン+4', 'もらった分が取り出せる');
    assertEqual(S.tollWords({ toll: 1, rank: 1, coinsGained: 0 }, 'あき').gain, '', '無い時は空');
  });

  await r.test('分け合い：足りない・ぴったり・多すぎで、言うことが変わる', async () => {
    const few = S.splitWords(5, { a: 1, b: 1 });
    const just = S.splitWords(5, { a: 3, b: 2 });
    const many = S.splitWords(5, { a: 4, b: 4 });
    assertEqual(few.ok, false, '足りない時は確定できない');
    assertEqual(just.ok, true, 'ぴったりなら確定できる');
    assertEqual(many.ok, false, '多すぎる時も確定できない');
    assert(few.hint.indexOf('3') !== -1, 'あと何マスか出る（' + few.hint + '）');
    // 「違う言い方」では足りない。多すぎる時に残りマス数を言うと
    // 「あと -3 マス」のような負の数が出る（それも“違う言い方”になってしまう）
    assert(many.hint.indexOf('あと') === -1,
      '多すぎる時に「あと◯マス」と言わない（' + many.hint + '）');
    assert(!/-\s*\d/.test(many.hint), '負の数を出さない（' + many.hint + '）');
    assertEqual(just.note, '5 / 5', '合計と出た目が並ぶ');
  });

  await r.test('こまはひとつ：あいこは、続ける時とあきらめる時で違う', async () => {
    assert(S.drawWords(false).note !== S.drawWords(true).note, '言い方が違う');
    assert(S.drawWords(true).note.indexOf('動きません') !== -1, 'あきらめた時は、動かないことが分かる');
  });

  await r.test('勝った人が複数いても、全員の名前が出る', async () => {
    const w = S.grabWinWords(['あき', 'びび']);
    assert(w.note.indexOf('あき') !== -1 && w.note.indexOf('びび') !== -1, '同着は全員出る');
    const p = S.pairFirstWords(['あき', 'びび']);
    assert(p.note.indexOf('あき') !== -1 && p.note.indexOf('びび') !== -1, '組も全員出る');
  });

  // ===== できごとの効き目（第36弾-22） =====
  // 「設定は出るのに、何も起きない」を作らないための照合。
  // sugograb・sugopair は events を持つ性格なのに、EVENTS に1つも無く、
  // 設定画面にだけ「突然のできごと 起こす／起こさない」が出ていた

  await r.test('できごとを持つゲームには、実際に起きるできごとがある', async () => {
    S.gameIds().forEach((id) => {
      const spec = S.gameById(id);
      if (spec.events === 'none') {
        assertEqual(S.eventsFor(id).length, 0, id + ' は起こさない性格なのに、できごとがある');
        return;
      }
      assert(S.eventsFor(id).length >= 1,
        id + ' は events:' + spec.events + ' なのに、起きるできごとが1つも無い。設定だけ出て何も起きない状態になる');
    });
  });

  await r.test('どのできごとにも、効き目のある居場所がある', async () => {
    // 盤を書き換えるもの（applyEventTo）か、その一巡だけ効くもの（◯◯With）か。
    // どちらにも無いできごとを足すと、名前だけ出て何も起きない
    const board = S.makeBoard('sugotoll');
    S.EVENTS.forEach((ev) => {
      const st = { pos: { a: 5, b: 12 }, coins: { a: 20, b: 20 }, board };
      const applied = S.applyEventTo(st, ['a', 'b'], Object.assign({}, ev));
      const 盤を動かす = applied && applied.applied && st.pos.a !== 5;
      const 一巡だけ効く =
        S.loserStepsWith(ev, 2) !== 2 ||
        S.moveBonusCoins(ev) !== 0 ||
        S.pairBonusSteps(ev) !== 0 ||
        ev.id === 'toll-free';   // 通行料がタダになるのは tollTurn が見ている
      assert(盤を動かす || 一巡だけ効く,
        ev.id + ' に効き目が無い（名前だけ出て、何も起きない）');
    });
  });

  r.finish();
})();
