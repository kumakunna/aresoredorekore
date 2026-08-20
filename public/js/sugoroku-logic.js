// sugoroku-logic.js — カセット「すごろく」5ゲーム共通のルール層（第36弾）
//
// 設計の芯は wolf-logic.js / bomb-logic.js とまったく同じ:
//   DOM も socket.io も知らない。Node.js から require できる純粋な計算だけを置く。
//   だから jsdom を立てずに単体テストできる。
//
// このカセットは5ゲーム × 遊び方（手渡し／1人1台）で、実装の文脈が8つに分かれる。
// これまでで一番「片方だけ直して、もう片方に反映し忘れる」（落とし穴1）が
// 起きやすい形なので、共通の計算はぜんぶここ1本に集める:
//   ・5ゲームの性格（人数・盤の長さ・コインの有無・突然イベントの可否・目安時間）
//   ・盤の作り方と、マスの種類
//   ・サイコロ
//   ・駒の進め方（あがりの扱い・効果マスの扱い）
//   ・コインの増減
//   ・順位（同点・引き分けの扱い）
//
// 進行（誰がいつ何を見られるか）は sugoroku-room.js が持つ。
// 画面（見た目・音）は index.html が持つ。
//
// ランダムは必ず引数で受け取る。テストを固定した条件で安定させるため
// （原則：ランダム性に依存するテストは、条件を固定して安定させる）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SugorokuLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 5ゲームの性格（この表が一覧の正本） =====
  //
  // 人数・盤の長さ・コインの有無・突然イベントの可否・遊び方・目安時間は、
  // 画面（index.html）もサーバー（sugoroku-room.js）も、必ずここから引く。
  // 同じ数字を2か所に書くと、片方だけ直した時に食い違う（落とし穴4）。
  //
  // ready: そのゲームが完成しているか。false のうちは棚に出さない。
  //   「器だけ先に用意し、中身は1つずつ完璧にしてから次へ」（原則2）を、
  //   宣言ではなくデータで持つための印。
  //
  // handoff: 手渡し（1台を回す）で遊べるか。
  //   みえない＝自分の位置を他人に見せてはいけない、
  //   てふだ＝手札を他人に見せてはいけない、ので false。
  //
  // events: 'any'＝どんな突然イベントも起こる / 'plus'＝プラス方向だけ / 'none'＝起こさない。
  //   みえないは「全員の位置が突然動くと、申告と実際がズレて本人も混乱する」ので none。
  //   てふだは「有限の手札で積み上げた計算が無に帰す」ので none。
  //
  // tiebreak: 進んだ距離が同じだった時。'coins'＝残りコインが多い方が上位 /
  //   'same'＝同着（コインを使わないゲームでは、無理に順位をつけない）。
  var GAMES = {
    // ① うばいあい：駒が1つしかない。毎ターン、それを動かす権利を奪い合う
    sugograb: {
      id: 'sugograb', title: 'こまはひとつ', sub: 'ミニゲームで勝った人だけが、たった1つの駒を動かせる',
      cells: 30, minPlayers: 3, maxPlayers: 8, estMin: 15,
      handoff: true, room: true,
      dice: true, sharedPiece: true,
      coins: true, startCoins: 20, cellKinds: ['coin', 'forward', 'back'],
      events: 'any', tiebreak: 'coins',
      ready: true      // 第36弾：手渡し・部屋の両方で遊べるようになった
    },
    // ② みえない：自分の位置は自分にしか見えない。申告では嘘をついてよい
    sugohide: {
      id: 'sugohide', title: 'どこにいる？', sub: '自分の位置は自分だけが知っている・申告では嘘をついてよい',
      cells: 30, minPlayers: 3, maxPlayers: 6, estMin: 20,
      handoff: false, room: true,
      dice: true, sharedPiece: false,
      coins: false, startCoins: 0, cellKinds: [],
      events: 'none', tiebreak: 'same',
      ready: true      // 第36弾：1人1台で遊べるようになった（手渡しには対応しない）
    },
    // ③ ふたり：2人1組で1つの駒を共有し、出目を分け合う
    sugopair: {
      id: 'sugopair', title: 'ふたりでひとつ', sub: '2人で1つの駒・出た目を相談して分け合う',
      cells: 40, minPlayers: 4, maxPlayers: 8, estMin: 15,
      handoff: true, room: true,
      dice: true, sharedPiece: false, pairs: true,
      coins: false, startCoins: 0, cellKinds: ['forward'],
      events: 'plus', tiebreak: 'same',
      ready: true      // 第36弾：手渡し・部屋の両方で遊べるようになった
    },
    // ④ つうこうりょう：先頭に近い人ほど、進む時にコインを払う
    sugotoll: {
      id: 'sugotoll', title: 'つうこうりょう', sub: '先頭ほど通行料が高い・払えないと進めない',
      cells: 40, minPlayers: 3, maxPlayers: 8, estMin: 20,
      handoff: true, room: true,
      dice: true, sharedPiece: false,
      coins: true, startCoins: 20, cellKinds: ['coin', 'forward', 'back'],
      events: 'any', tiebreak: 'coins',
      ready: true      // 第36弾：手渡し・部屋の両方で遊べるようになった
    },
    // ⑤ てふだ：サイコロを振らない。手札の数字と交渉だけで進む
    sugohand: {
      id: 'sugohand', title: 'てふだ', sub: 'サイコロを振らない・手札を交渉して進む',
      cells: 30, minPlayers: 3, maxPlayers: 6, estMin: 25,
      handoff: false, room: true,
      dice: false, sharedPiece: false,
      // コインマスは置かない。止まるマスを自分で選べるので、置くと狙って踏み続けられる
      coins: true, startCoins: 20, cellKinds: [],
      events: 'none', tiebreak: 'coins',
      ready: false
    }
  };

  function gameById(id) { return GAMES[id] || null; }
  function gameIds() { return Object.keys(GAMES); }
  // 棚・ゲーム選択に出してよいもの。1つずつ完成させるので、ここで絞る
  function readyGameIds() {
    return gameIds().filter(function (id) { return GAMES[id].ready; });
  }

  // ===== マスの種類（この表も正本。盤面・大画面・決着画面が全部ここを引く） =====
  //
  // 人狼で「盤面の死因対応表」と「決着画面の対応表」が別々に存在し、
  // 片方が古びて処刑が「襲撃」と誤表示された事故（型1）と同じ形を作らないため、
  // 見た目（icon/tone）も効果（coins/step）も1か所に置く。
  //
  // tone: 見た目の調子。'plain'＝ふつう / 'good'＝良いこと / 'soft'＝良くないこと /
  //   'gold'＝あがり。責める見た目にはしない（原則：責める時は静かに）ので、
  //   もどるマスも赤ではなく落ち葉の色にする。
  var CELL_KINDS = {
    start:   { id: 'start',   label: 'ふりだし',      icon: '⛩️', tone: 'plain' },
    plain:   { id: 'plain',   label: '',              icon: '',    tone: 'plain' },
    coin:    { id: 'coin',    label: 'コイン3まい',   icon: '🪙',  tone: 'good', coins: 3 },
    forward: { id: 'forward', label: '2マスすすむ',   icon: '🌸',  tone: 'good', step: 2 },
    back:    { id: 'back',    label: '2マスもどる',   icon: '🍂',  tone: 'soft', step: -2 },
    goal:    { id: 'goal',    label: 'あがり',        icon: '🏮',  tone: 'gold' }
  };
  function cellKind(id) { return CELL_KINDS[id] || CELL_KINDS.plain; }

  // 効果マスを置く割合と、置いてはいけない範囲
  var SPECIAL_RATIO = 0.25;
  var SAFE_HEAD = 2;   // 最初の2マスには置かない
  var SAFE_TAIL = 2;   // 最後の2マスには置かない
  var MIN_GAP = 3;     // 効果マスどうしを、これ未満の間隔で置かない

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /**
   * 盤を作る。0＝ふりだし、最後＝あがり。
   *
   * 決めごと:
   *   ・最初の2マスと最後の2マスには効果マスを置かない。
   *     振り出してすぐ戻される／あと少しで戻されるのは、どちらも気持ちが折れるため。
   *   ・効果マスどうしを3マス未満の間隔で置かない。
   *     近すぎると効果で動いた先がまた効果マスになり、盤面が読めなくなる。
   *   ・cellKinds が空のゲーム（みえない・てふだ）は、素の盤を返す。
   *
   * @param {string} gameId
   * @param {function} [rnd] 0以上1未満を返す関数（テストで固定するために引数で受け取る）
   * @returns {string[]} マスの種類id。長さは cells + 1
   */
  function makeBoard(gameId, rnd) {
    var g = gameById(gameId);
    var n = (g && g.cells) || 30;
    var kinds = (g && g.cellKinds) || [];
    var cells = [];
    for (var i = 0; i <= n; i++) cells.push('plain');
    cells[0] = 'start';
    cells[n] = 'goal';
    if (!kinds.length) return cells;

    var r = rnd || Math.random;
    var lo = SAFE_HEAD + 1;          // ここから
    var hi = n - SAFE_TAIL - 1;      // ここまで（あがりの手前）
    var span = hi - lo + 1;
    if (span <= 0) return cells;
    var want = Math.max(1, Math.round(span * SPECIAL_RATIO));
    var placed = [];
    // 抽選は必ず回数で打ち切る。埋まらないまま無限に回らないようにする
    for (var tries = 0; tries < span * 20 && placed.length < want; tries++) {
      var at = lo + Math.floor(r() * span);
      if (at < lo || at > hi || cells[at] !== 'plain') continue;
      var tooClose = false;
      for (var k = 0; k < placed.length; k++) {
        if (Math.abs(placed[k] - at) < MIN_GAP) { tooClose = true; break; }
      }
      if (tooClose) continue;
      cells[at] = kinds[Math.floor(r() * kinds.length)] || 'plain';
      placed.push(at);
    }
    return cells;
  }

  // ===== 盤面の並べ方（蛇行配置） =====
  //
  // 30〜40マスを、スクロールせずに1画面に収める。
  // 一列に並べると細長くなって読めないので、行ごとに向きを変えて折り返す。
  //
  //    0 →  1 →  2 →  3 →  4 →  5
  //                             ↓
  //   11 ← 10 ←  9 ←  8 ←  7 ←  6
  //    ↓
  //   12 → 13 → ...
  //
  // 折り返しの列をそろえる（行末の次は「真下」）ので、道が斜めに飛ばない。
  // 座標の計算をここに置くのは、**画面と大画面が同じ盤を見るため**。
  // 別々に計算すると、片方だけ直した時に見え方が食い違う（落とし穴1）。
  var BOARD_COLS = 6;   // 縦持ちのスマホで、1マスが指で押せる大きさに収まる列数

  /**
   * 盤の並びを、行と列の座標にする。
   *
   * @param {string[]} board makeBoard が返したマスの種類
   * @param {number} [cols] 列数（省略時 BOARD_COLS）
   * @returns {{cols:number, rows:number, cells:Array<{i:number,row:number,col:number,kind:string,dir:string}>}}
   *   dir … その行が進む向き（'right' | 'left'）。道しるべを描く時に使う
   */
  function boardLayout(board, cols) {
    var list = Array.isArray(board) ? board : [];
    var c = Math.max(2, (cols | 0) || BOARD_COLS);
    var cells = list.map(function (kind, i) {
      var row = Math.floor(i / c);
      var within = i % c;
      var rightward = (row % 2 === 0);
      return {
        i: i,
        row: row,
        col: rightward ? within : (c - 1 - within),
        kind: kind,
        dir: rightward ? 'right' : 'left'
      };
    });
    return { cols: c, rows: Math.ceil(list.length / c), cells: cells };
  }

  // ===== 駒の見分け方 =====
  //
  // **色だけで区別しない。** 色の見え方は人によって違うので、
  // 形と名前をセットで持ち、画面はこの形をそのまま出す（原則10）。
  // 絵文字ではなく文字の記号にしてあるのは、UIの記号は差し替えない決まりのため。
  var PIECES = [
    { shape: '●', name: 'まる' },
    { shape: '▲', name: 'さんかく' },
    { shape: '■', name: 'しかく' },
    { shape: '◆', name: 'ひしがた' },
    { shape: '★', name: 'ほし' },
    { shape: '♥', name: 'はーと' },
    { shape: '♣', name: 'くろーばー' },
    { shape: '✚', name: 'じゅうじ' }
  ];
  function pieceFor(index) {
    var n = PIECES.length;
    return PIECES[(((index | 0) % n) + n) % n];
  }

  // ===== サイコロ =====
  var DICE_MAX = 6;
  /**
   * サイコロを振る。
   *
   * 画面では「長押ししてスワイプ」で振るが、**スワイプの勢いは出目に一切影響させない**。
   * 勢いで目が変わると「操作が上手い人が有利」になり、サイコロの意味が消える。
   * 勢いは演出（転がる速さ・音）にだけ使う。
   */
  function rollDice(rnd) {
    var r = rnd || Math.random;
    return 1 + Math.floor(r() * DICE_MAX);
  }

  // 振る操作の手ごたえ。
  //
  // 主役は「長押ししてスワイプ」（手首を振る動きを画面上で再現する）。
  // ただし**それしか方法が無い作りにはしない**。片手がふさがっている・手が不自由・
  // 画面が滑らない、はどれも実際に起きる。
  //   ・スワイプすれば、押した時間が短くても振れる
  //   ・スワイプできなくても、**そのまま押し続けて離せば振れる**
  // どちらか一方でよいので、「押して離す」だけができれば必ず遊べる。
  //
  // 返す power は**転がる演出の勢いだけ**に使う。出目には一切影響しない
  // （勢いで目が変われば「操作が上手い人が有利」になり、サイコロの意味が消える）。
  // だからこの関数は、出目に使える数を1つも返さない。
  var HOLD_MIN_MS = 500;    // これだけ押していれば、スワイプしなくても振れる
  var SWIPE_MIN_PX = 40;    // これだけ動かせば、押した時間が短くても振れる

  function rollGesture(heldMs, swipePx) {
    var held = Math.max(0, heldMs | 0);
    var swipe = Math.abs(swipePx || 0);
    var bySwipe = swipe >= SWIPE_MIN_PX;
    var byHold = held >= HOLD_MIN_MS;
    return {
      ok: bySwipe || byHold,
      reason: bySwipe ? 'swipe' : (byHold ? 'hold' : null),
      power: clamp(Math.max(swipe / 220, held / 1400), 0.15, 1)
    };
  }

  // ===== 駒を進める =====
  /**
   * 決めごと①：あがりを超える出目でも、あがり扱いにする。
   *   「ぴったり止まらないと上がれない」にすると、最後の1人が延々と足踏みして
   *   置き去りになる（原則10：一つの点からすべてを喜ばせる）。
   * 決めごと②：効果マスの効果は連鎖しない。
   *   効果で動いた先がまた効果マスでも、そこでは何も起きない。
   *   連鎖を許すと、1回の手番で盤の端から端まで動くことがあり、
   *   「1マスずつ進む」演出も意味を失う。
   *
   * @returns {{from:number, stop:number, to:number, path:number[], bonusPath:number[],
   *            kind:string, coins:number, goal:boolean}}
   *   path      … 出目のぶん、1マスずつ動かす道のり（演出用）
   *   bonusPath … 効果マスで追加で動いたぶん（無ければ空）
   */
  function applyMove(board, from, steps) {
    var goal = board.length - 1;
    var start = clamp(from | 0, 0, goal);
    var stop = clamp(start + (steps | 0), 0, goal);
    var out = {
      from: start, stop: stop, to: stop,
      path: walk(start, stop), bonusPath: [],
      kind: 'plain', coins: 0, goal: false
    };
    var kind = cellKind(board[stop]);
    out.kind = kind.id;
    // あがりに着いたら、そこで終わり。あがりのマスに効果は無い
    if (stop >= goal) { out.goal = true; return out; }
    if (kind.coins) out.coins = kind.coins;
    if (kind.step) {
      var landed = clamp(stop + kind.step, 0, goal);
      out.bonusPath = walk(stop, landed);
      out.to = landed;
      out.goal = landed >= goal;
    }
    return out;
  }
  // from の次のマスから to まで、1マスずつ並べる。動かない時は空
  function walk(from, to) {
    var path = [];
    if (to === from) return path;
    var step = to > from ? 1 : -1;
    for (var p = from + step; ; p += step) {
      path.push(p);
      if (p === to) break;
    }
    return path;
  }

  // ===== コイン =====
  // 落とし穴8（上限・下限のチェックが片方向にしか効いていない）への備え。
  // 増やす時も減らす時も、必ずこの1本を通す
  function addCoins(cur, delta) {
    return Math.max(0, (cur | 0) + (delta | 0));
  }
  function canPay(cur, cost) { return (cur | 0) >= (cost | 0); }

  // ===== 順位 =====
  /**
   * 盤面の位置だけで決まる順位。同じマスにいる人は同順位。
   *
   * 決めごと⑥：同じマス＝同順位。「先に着いた方が上」にすると、
   * 盤面を見ただけでは誰が何位か分からなくなる（つうこうりょうでは、
   * 順位がそのまま支払額なので、見て分からないのは致命的）。
   *
   * @param {Array<{id:string,pos:number}>} players
   * @returns {Object} id -> 順位（1始まり）
   */
  function positionRanks(players) {
    var list = (players || []).slice().sort(function (a, b) {
      return (b.pos | 0) - (a.pos | 0);
    });
    var out = {};
    var rank = 0;
    list.forEach(function (p, i) {
      if (i === 0 || (list[i - 1].pos | 0) !== (p.pos | 0)) rank = i + 1;
      out[p.id] = rank;
    });
    return out;
  }

  /**
   * 決着の順位。
   *   1. あがった順（早い方が上）
   *   2. 進んだ距離（遠い方が上）
   *   3. コインを使うゲームだけ、残りコインが多い方が上位
   *   4. それも同じなら同着（無理に順位をつけない）
   *
   * 5ゲームで並べ方が2種類あるが、ゲームごとに書くと必ず片方が古びる（型1）。
   * 違いは GAMES[gameId].tiebreak の1文字だけにしてある。
   *
   * @param {Array<{id:string,pos:number,coins:number,goalOrder:?number}>} players
   * @returns {Array} rank と tied を足したもの（順位順に並ぶ）
   */
  function rankPlayers(gameId, players) {
    var cmp = comparator(gameId);
    var list = (players || []).slice().sort(cmp);
    var out = [];
    var rank = 0;
    list.forEach(function (p, i) {
      if (i === 0 || cmp(list[i - 1], p) !== 0) rank = i + 1;
      var row = {};
      Object.keys(p).forEach(function (k) { row[k] = p[k]; });
      row.rank = rank;
      out.push(row);
    });
    var counts = {};
    out.forEach(function (p) { counts[p.rank] = (counts[p.rank] || 0) + 1; });
    out.forEach(function (p) { p.tied = counts[p.rank] > 1; });
    return out;
  }
  function comparator(gameId) {
    var g = gameById(gameId) || {};
    var byCoins = g.tiebreak === 'coins';
    return function (a, b) {
      var ao = (a.goalOrder == null) ? Infinity : a.goalOrder;
      var bo = (b.goalOrder == null) ? Infinity : b.goalOrder;
      if (ao !== bo) return ao - bo;
      if ((b.pos | 0) !== (a.pos | 0)) return (b.pos | 0) - (a.pos | 0);
      if (byCoins && (b.coins | 0) !== (a.coins | 0)) return (b.coins | 0) - (a.coins | 0);
      return 0;
    };
  }

  // ===== つうこうりょう（sugotoll）のルール =====
  //
  // 先頭に近い人ほど、進む時にコインを払う。逆転アイテムのような外付けではなく、
  // ルールそのものに拮抗させる仕組みを入れる、という発想。
  //
  // 手渡しでも1人1台でも遊べるゲームなので、計算はここに置く。
  // 画面側とサーバー側で別々に書くと、片方だけ直す事故になる（落とし穴1）。
  var TOLL_RELIEF = 3;   // 払えなくて進めなかった人に入るコイン

  /**
   * 順位に応じた通行料。
   *   1位＝出目と同じ枚数 / 2位・3位＝出目の半分（切り上げ）/ 4位以下＝無料
   * 順位は「盤面の位置」で決まる（positionRanks）。コインで決めると
   * 「わざと進まずコインを貯める」のが最適解になり、すごろくの目的と矛盾する。
   */
  function tollFor(rank, dice) {
    if (rank <= 1) return dice | 0;
    if (rank <= 3) return Math.ceil((dice | 0) / 2);
    return 0;
  }

  /**
   * 通行料を払えるか。払えなければ進めないが、**代わりにコインが3枚入る**。
   *
   * この救済が無いと、全員がコイン切れで団子になったまま膠着する。
   * 足止めされても次のターンには払えるようになるので、続くことは構造的に起きない。
   *
   * 「払うかどうかを選べる」形にはしない。選べると、先頭の人がわざと払わずに
   * 3枚もらい続けるのが得になり、救済が抜け道に変わる。払えるなら必ず払う。
   */
  function tollOutcome(coins, rank, dice) {
    var cost = tollFor(rank, dice);
    if (cost <= 0) return { cost: 0, paid: true, stalled: false, relief: 0 };
    if (canPay(coins, cost)) return { cost: cost, paid: true, stalled: false, relief: 0 };
    return { cost: cost, paid: false, stalled: true, relief: TOLL_RELIEF };
  }

  /**
   * つうこうりょうの1手番ぶん。**手渡し版と部屋版が、同じここを通る。**
   *
   * 「順位を見る → 通行料 → 進む → 効果マス → あがり」という順番を2か所に書くと、
   * 片方だけ直して必ず事故る（落とし穴1）。ルールだけでなく**順番も**共通にする。
   *
   * @param {{board:string[], pos:Object, coins:Object, goalOrder:Object, goalCount:number, event:?Object}} st
   *        呼び出し側が持っている状態。この関数が直接書き換える
   * @param {string[]} liveIds 順位を数える母集団（部屋にいる人／手渡しの参加者）
   * @param {string} id 手番の人
   * @param {number} dice 出目（振るのは呼び出し側。乱数の持ち方が違うため）
   * @returns {Object} 何が起きたか。画面はこれを見て演出する
   */
  function tollTurn(st, liveIds, id, dice) {
    var ranks = positionRanks((liveIds || []).map(function (x) {
      return { id: x, pos: st.pos[x] };
    }));
    var rank = ranks[id] || 99;
    var free = !!(st.event && st.event.id === 'toll-free');
    var out = {
      id: id, dice: dice, rank: rank, free: free,
      toll: 0, paid: false, stalled: false, relief: 0,
      move: null, coinsGained: 0, goal: false, coinsAfter: 0
    };
    var o = free
      ? { cost: 0, paid: true, stalled: false, relief: 0 }
      : tollOutcome(st.coins[id], rank, dice);
    out.toll = o.cost;
    if (o.stalled) {
      // 進めない。ただし責める場面にしない（代わりにコインが入る、を主語にする）
      st.coins[id] = addCoins(st.coins[id], o.relief);
      out.stalled = true;
      out.relief = o.relief;
      out.coinsAfter = st.coins[id];
      return out;
    }
    if (o.cost > 0) {
      st.coins[id] = addCoins(st.coins[id], -o.cost);
      out.paid = true;
    }
    var mv = applyMove(st.board, st.pos[id], dice);
    st.pos[id] = mv.to;
    if (mv.coins) {
      st.coins[id] = addCoins(st.coins[id], mv.coins);
      out.coinsGained = mv.coins;
    }
    if (mv.goal && st.goalOrder[id] == null) {
      st.goalCount = (st.goalCount | 0) + 1;
      st.goalOrder[id] = st.goalCount;
      out.goal = true;
    }
    out.move = mv;
    out.coinsAfter = st.coins[id];
    return out;
  }

  // ===== ふたりでひとつ（sugopair）のルール =====
  //
  // 駒が「人」ではなく「組」に付く。出た目を2人で相談して分け合う。
  // 手渡しでも1人1台でも遊べるので、計算はここに置く（落とし穴1）。

  var PAIR_STYLE = { EVEN: 'even', ONE: 'one' };   // 奇数のときの組み分け

  /**
   * 組を作る。**ランダム。自分たちで選ばせない**（組み合わせの妙も含めた遊び）。
   *
   * 奇数のときの決めごと⑤:
   *   'even' … 3人組をなるべく均等に散らす（9人なら 3・3・3）
   *   'one'  … 3人組は必ず1つ、残りは全部2人組（9人なら 3・2・2・2）
   * 5人・7人ではどちらも同じ結果になるので、画面はその時に選択肢を出さない。
   */
  function makePairs(ids, style, rnd) {
    var list = (ids || []).slice();
    var r = rnd || Math.random;
    for (var i = list.length - 1; i > 0; i--) {      // 並びを混ぜる
      var j = Math.floor(r() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    var n = list.length;
    var threes = 0;
    if (n % 2 === 1) {
      // 3人組をいくつ作るか。even は均等に散らす（3で割り切れるならすべて3人組）
      threes = (style === PAIR_STYLE.EVEN && n % 3 === 0) ? (n / 3) : 1;
    }
    var groups = [];
    var at = 0;
    for (var k = 0; k < threes; k++) { groups.push(list.slice(at, at + 3)); at += 3; }
    while (at < n) { groups.push(list.slice(at, at + 2)); at += 2; }
    return groups;
  }

  /** 奇数のときに、2つの分け方が違う結果になるか（同じなら聞く意味が無い） */
  function pairStylesDiffer(n) {
    if ((n | 0) % 2 === 0) return false;
    return (n | 0) % 3 === 0 && n >= 9;
  }

  /**
   * 配分が確定したか。**合計が出目とぴったり一致した時だけ**。
   * 多くても少なくても確定しない（多い方を許すと、出目より進めてしまう）。
   */
  function splitReady(dice, parts) {
    var vals = Object.keys(parts || {}).map(function (k) { return Math.max(0, parts[k] | 0); });
    if (!vals.length) return false;
    var sum = vals.reduce(function (a, b) { return a + b; }, 0);
    return sum === (dice | 0);
  }
  function splitSum(parts) {
    return Object.keys(parts || {}).reduce(function (a, k) {
      return a + Math.max(0, parts[k] | 0);
    }, 0);
  }

  /**
   * まとまらなかった時の自動配分。**等分して、端数は切り捨てる**。
   * 例：出目5を2人なら 2＋2 で1マス分が失われる。
   * わずかに損をする形にしてあるのは、「ちゃんと交渉した方が得」という誘導のため。
   */
  function autoSplit(dice, memberIds) {
    var ids = (memberIds || []).slice();
    var each = Math.floor((dice | 0) / Math.max(1, ids.length));
    var out = {};
    ids.forEach(function (id) { out[id] = each; });
    return out;
  }

  /**
   * 相方がいなくなった組の配分。**残った1人が出目を全部使える。**
   * 「相談する相手がいないのに相談を待つ」状態を作らない（決めごと⑭）。
   */
  function soloSplit(dice, memberId) {
    var out = {};
    out[memberId] = Math.max(0, dice | 0);
    return out;
  }

  // ===== 突然イベント =====
  //
  // イベントは1つの一覧に集め、**どのゲームで起こるかをデータで持つ**。
  // 「みえない・てふだでは起こさない」を条件分岐で書くと、イベントを足した人が
  // 書き忘れて漏れる（落とし穴4）。games に書かれていないゲームには、
  // 構造的に配れない形にしておく。
  //
  // tone: 'plus'＝プラス方向だけ / 'any'＝そうでないものも含む。
  //   ふたり（events:'plus'）には、tone:'plus' のものしか渡さない。
  //   じっくり信頼関係を育てる遊びを、荒らすイベントで壊さないため。
  //
  // ここは各ゲームの実装と一緒に増えていく。
  var EVENT_CHANCE = 0.25;   // 一巡ごとに、この確率で起きる（手渡し・部屋で同じ）
  var EVENTS = [
    // --- つうこうりょう ---
    // 長く先頭を走っている人がいると単調になるので、順位を崩すものを入れる。
    // ただし「持っているものを取り上げる」形にはしない（責める演出にしない）。
    {
      id: 'toll-free', games: ['sugotoll'], tone: 'any',
      icon: '⛩️', title: 'せきしょ やぶり',
      note: 'この一巡だけ、通行料はいりません'
    },
    {
      id: 'swap-ends', games: ['sugotoll'], tone: 'any',
      icon: '🔄', title: 'みちがえ',
      note: '先頭の人と、いちばん後ろの人が入れかわります'
    }
  ];

  /**
   * 突然イベントを実際に効かせる。**手渡し版と部屋版が、同じここを通る。**
   * 盤を書き換えるものだけが、ここで仕事をする
   * （toll-free は「効いている間タダ」なので、盤には何もしない）。
   *
   * @param {{pos:Object}} st 呼び出し側の状態（この関数が書き換える）
   * @param {string[]} liveIds まだあがっていない人
   * @param {Object} ev イベント
   */
  function applyEventTo(st, liveIds, ev) {
    if (!ev) return ev;
    if (ev.id === 'swap-ends') {
      // 先頭といちばん後ろが入れかわる。同じマスに複数いる時は、並び順が先の人
      var live = (liveIds || []).slice();
      if (live.length < 2) { ev.applied = false; return ev; }
      var sorted = live.slice().sort(function (a, b) { return st.pos[b] - st.pos[a]; });
      var head = sorted[0];
      var tail = sorted[sorted.length - 1];
      if (head === tail || st.pos[head] === st.pos[tail]) { ev.applied = false; return ev; }
      var tmp = st.pos[head];
      st.pos[head] = st.pos[tail];
      st.pos[tail] = tmp;
      ev.applied = true;
      return ev;
    }
    ev.applied = true;
    return ev;
  }

  /**
   * そのゲームで起こしてよいイベント。
   * GAMES[gameId].events が 'none' なら、EVENTS に何が入っていても必ず空を返す。
   * （みえない・てふだで「イベントが起きない」ことを、二重に保証する）
   */
  function eventsFor(gameId) {
    var g = gameById(gameId);
    if (!g || g.events === 'none') return [];
    var plusOnly = g.events === 'plus';
    return EVENTS.filter(function (e) {
      if ((e.games || []).indexOf(gameId) === -1) return false;
      return plusOnly ? e.tone === 'plus' : true;
    });
  }
  /**
   * イベントを1つ引く。直前に出たものは避ける（同じものが続くと飽きる）。
   * 引けるものが無ければ null（イベントは「起きないこともある」のが普通）。
   */
  function pickEvent(gameId, rnd, lastId) {
    var pool = eventsFor(gameId).filter(function (e) { return e.id !== lastId; });
    if (!pool.length) return null;
    var r = rnd || Math.random;
    return pool[Math.floor(r() * pool.length)] || null;
  }

  // ===== 人数のチェック =====
  /**
   * その人数で始められるか。上限・下限の両方を必ず見る（落とし穴8）。
   * @returns {{ok:boolean, message:?string}}
   */
  function checkPlayerCount(gameId, n) {
    var g = gameById(gameId);
    if (!g) return { ok: false, error: 'unknown_game', message: 'そのゲームはありません' };
    var count = n | 0;
    if (count < g.minPlayers) {
      return { ok: false, error: 'too_few_players', message: g.minPlayers + '人以上必要です' };
    }
    if (g.maxPlayers && count > g.maxPlayers) {
      return { ok: false, error: 'too_many_players', message: g.maxPlayers + '人までで遊べます' };
    }
    return { ok: true, error: null, message: null };
  }

  return {
    GAMES: GAMES, CELL_KINDS: CELL_KINDS, EVENTS: EVENTS,
    DICE_MAX: DICE_MAX, SAFE_HEAD: SAFE_HEAD, SAFE_TAIL: SAFE_TAIL, MIN_GAP: MIN_GAP,
    gameById: gameById, gameIds: gameIds, readyGameIds: readyGameIds,
    cellKind: cellKind, makeBoard: makeBoard,
    BOARD_COLS: BOARD_COLS, PIECES: PIECES,
    boardLayout: boardLayout, pieceFor: pieceFor,
    rollDice: rollDice, applyMove: applyMove, walk: walk,
    HOLD_MIN_MS: HOLD_MIN_MS, SWIPE_MIN_PX: SWIPE_MIN_PX, rollGesture: rollGesture,
    addCoins: addCoins, canPay: canPay, clamp: clamp,
    positionRanks: positionRanks, rankPlayers: rankPlayers,
    EVENT_CHANCE: EVENT_CHANCE,
    eventsFor: eventsFor, pickEvent: pickEvent, applyEventTo: applyEventTo,
    checkPlayerCount: checkPlayerCount,
    TOLL_RELIEF: TOLL_RELIEF, tollFor: tollFor, tollOutcome: tollOutcome,
    tollTurn: tollTurn,
    PAIR_STYLE: PAIR_STYLE, makePairs: makePairs, pairStylesDiffer: pairStylesDiffer,
    splitReady: splitReady, splitSum: splitSum, autoSplit: autoSplit, soloSplit: soloSplit
  };
}));
