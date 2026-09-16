// falsetrue-logic.js — 「False or True」のルール層（指示53）
//
// ここが**唯一の正本**。サーバーの進行役（falsetrue-room.js）も、画面（index.html）も、
// 数字と言い回しはここからしか読まない。片方に書き写すと、必ずどちらかが古びる。
//
// ---- この遊びの芯 ----
// アタッシュケースの中身は true か false の1ビットしかない。
// **持っている人だけが中身を知っていて、対面する相手が「奪う／奪わない」を決める。**
// false のほうが多い（1:3）ので、相手の素の判断は「奪わない」＝持っている人を脱落させる。
// だから false を引いた持ち主は、**奪わせないと自分が落ちる**——嘘をつく動機がそこで生まれる。
//
// ---- 着手前に回して分かったこと（tools/fot-preflight.js） ----
// ① **中身の数は `Math.round(n/4)`。** 設計メモの本文は「端数は false 側へ」と書いてあるが、
//    同じメモの表（6人→2:4）は端数を true 側に上げた値で、表の4行すべてを再現する式は
//    round だけだった。本人の裁定（2026-09-16）で**表を正**とした。
// ② **1ラウンドは、ケース1枚と「確定する人」1人を同時に消す。**
//    だから「残りケース数 ≧ 未確定の人数」が崩れず、
//    終了条件「ケースが尽きた」は自然な進行では起きない（退室率30%で36万回まわして0）。
//    **保険として実装する**（本人の裁定）。消さない理由は、将来ここの規則を変えた日に効くから。
// ③ **結果表の4通りは、すべて「生存 ⟺ 中身が true」。**
//    奪う／奪わないが決めているのは、その運命を**誰が受け取るか**だけ。
//    下の OUTCOME を表のまま置いてあるのは、この性質を検査が直に読めるようにするため。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FalseTrueLogic = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // =====================================================================
  // 数字は全部ここ。**他のファイルに書き写さない**
  // =====================================================================
  var RULES = {
    // ---- 人数 ----
    // 始めるのに要る人数。**途中で4人を切っても続ける**（指示53 2-8）。
    // ここは「始める時の門番」だけ
    MIN_PLAYERS: 4,
    // 指示54：8 → 12。**画面側の写し（index.html の GAMES.maxPlayers）と必ず一対**で、
    // 食い違うと「押せるのに始まらない」か「押せないのに始まる」になる。
    // 両方向の照合を tests/falsetrue-logic.js が持っている
    MAX_PLAYERS: 12,

    // ---- 話し合いの長さ（本人の裁定 2026-09-16：既定60秒・設定で3択） ----
    // 既定を60秒にした理由（tools/fot-preflight.js time で測った）：
    //   8人なら 60秒＝全体11.6分・最長9.9分。90秒＝全体15.1分・最長12.9分で、
    //   **一度も出番が来ないまま12.9分見ているだけの人**が出るので90秒は既定にしなかった。
    //
    // **指示54で上限が12人になり、この線は既定の60秒でも超える。**
    //   10人・60秒 → 最長13.2分 ／ 12人・60秒 → 最長16.5分。
    // ラウンド数は必ず「人数−1」で、1ラウンドに関わるのは2人だけなので、
    // 長さを変えてもこの比率は動かない。
    // **だから既定は人数で変えず（落とし穴34：印の無い既定の切り替えは本人の選択を潰す）、
    //   設定の注記に実際の分数を出して進行役に選ばせる**（本人の裁定 2026-09-17）。
    // **この数字は検査の都合で動かさない**（落とし穴24）。早送りは検査の側に作る
    TALK_CHOICES: [30, 60, 90],
    TALK_SEC: 60,

    // ---- 締め切りの安全弁（押さなくても止まらない・落とし穴17／22） ----
    // 「待っている人が居なくなっても進む」ための上限であって、
    // 遊びの尺ではない。切れた時の既定は DEFAULT_ON_TIMEOUT
    PICK_SEC: 45,
    PEEK_SEC: 30,
    FACE_SEC: 3,        // 見せるだけの段階（誰も待っていない）
    DECIDE_SEC: 45,
    REVEAL_SEC: 8
  };

  /**
   * 締め切りが来て、その人が押さなかった時にどうするか。
   * **decide の既定を「奪わない」にした理由**：1:3 で false が多いので、
   * 「奪わない」が素の判断（設計メモ）。黙っていた人に、
   * より不自然なほうを押しつけない
   */
  var DEFAULT_ON_TIMEOUT = {
    pick: 'lowest',     // 選べるうち、いちばん小さい番号
    peek: 'seen',       // 見たことにして先へ
    decide: 'keep'      // 奪わない
  };

  // =====================================================================
  // 中身の数（設計メモの表・本人の裁定で round）
  // =====================================================================
  /**
   * ケースの数＝そのとき遊んでいる人数（大画面は数えない）。
   * **true は必ず1つ以上**（4人が下限なので round でも floor でも満たすが、明示しておく）
   */
  function caseCount(n) { return n; }
  function trueCount(n) {
    return Math.max(1, Math.round(n / 4));
  }
  function falseCount(n) { return caseCount(n) - trueCount(n); }

  /**
   * 中身の並びを作る。**この配列がこのゲームの秘密の正本**で、
   * publicView には一度も入らない（指示53 2-7）。
   * rand は 0〜1 を返す関数（テストから種つきのものを渡せるように外から受ける）
   */
  function makeContents(n, rand) {
    var r = rand || Math.random;
    var out = [];
    var t = trueCount(n);
    for (var i = 0; i < caseCount(n); i++) out.push(i < t);
    for (var j = out.length - 1; j > 0; j--) {
      var k = Math.floor(r() * (j + 1));
      var tmp = out[j]; out[j] = out[k]; out[k] = tmp;
    }
    return out;
  }

  // =====================================================================
  // 結果（設計メモ 7 の表を、そのままデータで置く）
  //
  // **表を分岐で書き写さない。** 書き写すと、表と実装が別々に古びる（落とし穴1）。
  // 検査（tests/falsetrue-logic.js）はこの配列そのものを回す
  // =====================================================================
  var OUTCOME = [
    // 奪う → 決まるのは【相手】。持っていた人はもう一度ケースを選ぶ
    { taken: true, content: true, 決まる: 'opp', fate: 'alive', 次の選ぶ人: 'holder' },
    { taken: true, content: false, 決まる: 'opp', fate: 'out', 次の選ぶ人: 'holder' },
    // 奪わない → 決まるのは【持ち主】。相手がケースを選ぶ側になる
    { taken: false, content: true, 決まる: 'holder', fate: 'alive', 次の選ぶ人: 'opp' },
    { taken: false, content: false, 決まる: 'holder', fate: 'out', 次の選ぶ人: 'opp' }
  ];

  /** 奪ったか × 中身 → その回の結末。表に無い組み合わせは作れない */
  function outcomeOf(taken, content) {
    var t = !!taken, c = !!content;
    for (var i = 0; i < OUTCOME.length; i++) {
      if (OUTCOME[i].taken === t && OUTCOME[i].content === c) return OUTCOME[i];
    }
    return null;
  }

  // =====================================================================
  // 対面の相手
  // =====================================================================
  /**
   * 相手の候補：**未確定で、選ぶ人ではない人**のうち、
   * **まだ一度も対面していない人を優先**する。
   *
   * 着手前に10万回まわして分かったこと：1ラウンドは必ず対面した2人のうち1人を
   * 盤から外すので、**同じ組が二度対面することは原理的に起きない**（0回）。
   * 「完全ランダム」と「未対面優先」が違う候補を見た回も0。
   * **つまり通常進行では、この2案は同じアルゴリズム。**
   *
   * それでも未対面優先を書くのは、2-8 の「対面が流れる」経路
   * （相手が抜けて、確定しないまま対面を経験した人が残る）でだけ2案が分かれるから。
   * **意図をコードに書いておく側を選んだ。**
   */
  function opponentPool(undecidedIds, pickerId, everFaced) {
    var pool = (undecidedIds || []).filter(function (id) { return id !== pickerId; });
    var fresh = pool.filter(function (id) { return (everFaced || []).indexOf(id) === -1; });
    return fresh.length ? fresh : pool;
  }

  // =====================================================================
  // 終わり
  // =====================================================================
  /**
   * 終了条件（設計メモ）。返すのは null（まだ続く）か、終わった理由。
   *   'last'  … 決まっていない人が1人 → その人は自動で生存
   *   'cases' … ケースが尽きた → 残った人は全員生存
   *
   * **'cases' は自然な進行では起きない**（②）。保険として残してある
   */
  function endReason(undecidedCount, remainingCases) {
    if (undecidedCount <= 1) return 'last';
    if (remainingCases <= 0) return 'cases';
    return null;
  }

  // =====================================================================
  // 言い回し（画面に直書きしない）
  // =====================================================================
  var TEXT = {
    TRUE: 'TRUE',
    FALSE: 'FALSE',
    // 音なしでも分かるように、色だけに頼らず文字も出す（指示53 2-11・正本 §1）
    中身: { true: 'TRUE（あたり）', false: 'FALSE（はずれ）' },
    運命: { alive: '生存', out: '脱落' },
    選択: { take: '奪う', keep: '奪わない' }
  };

  function normalizeConfig(cfg) {
    var c = cfg || {};
    var talk = parseInt(c.talkSec, 10);
    if (RULES.TALK_CHOICES.indexOf(talk) === -1) talk = RULES.TALK_SEC;
    return { talkSec: talk };
  }

  return {
    RULES: RULES,
    DEFAULT_ON_TIMEOUT: DEFAULT_ON_TIMEOUT,
    OUTCOME: OUTCOME,
    TEXT: TEXT,
    caseCount: caseCount,
    trueCount: trueCount,
    falseCount: falseCount,
    makeContents: makeContents,
    outcomeOf: outcomeOf,
    opponentPool: opponentPool,
    endReason: endReason,
    normalizeConfig: normalizeConfig
  };
}));
