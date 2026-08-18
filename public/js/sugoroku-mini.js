// sugoroku-mini.js — すごろく「こまはひとつ」のミニゲーム（第36弾）
//
// 駒が1つしかないので、毎ターン「今回それを動かす権利を誰が得るか」をミニゲームで奪い合う。
// このファイルは、その**勝敗と順位づけだけ**を持つ。
//   DOM も socket.io も知らない。Node.js から require できる純粋な計算だけ。
//   進行（いつ出題して、いつ締め切るか）は sugoroku-room.js と index.html が持つ。
//
// sugoroku-logic.js と分けたのは、これが「盤のルール」ではなく
// 独立したサブシステム（4系統のミニゲーム）だから。盤の側に混ぜると、
// どちらを直しているのか読めなくなる。手渡しと部屋は、どちらもここを通る。
//
// **系統を4つに分けている理由**（指示書の芯）:
//   得意・不得意が偏らないよう、性質の違う4系統から毎回ランダムに選ぶ。
//   こうすると「特定の人が勝ち続ける」ことを、不自然なルール
//   （連続で勝った人は次に参加できない等）を入れずに防げる。
//   だから**系統は減らさない**。減らすと、このゲームの核が半分になる。
//
// **入力が揃わなかった時**（切断・無操作・時間切れ）:
//   出していない人は、必ず**最下位に同着**で並ぶ。ここで例外を作らないので、
//   進行役は「締め切ったら、そのまま順位をつける」だけでよい。
//   経路ごとに「揃わなかった時」を書くと、必ず片方を書き忘れる（落とし穴17）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SugorokuMini = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 連打の頭打ち。これ以上叩いても順位は上がらない。
  // 連打は反射神経ではなく「体力と指の速さ」で、年齢差がそのまま出る。
  // 上限を置くと、満タンに届いた人どうしは速さ（到達した早さ）の勝負になる
  var TAP_CAP = 30;

  // 指の数当てで出せる本数
  var FINGER_MAX = 5;

  var HAND = { ROCK: 'g', SCISSORS: 'c', PAPER: 'p' };
  var HANDS = [HAND.ROCK, HAND.SCISSORS, HAND.PAPER];
  // 勝つ相手
  var BEATS = { g: 'c', c: 'p', p: 'g' };

  // ===== ミニゲームの一覧（この表が正本） =====
  //
  // kind … 系統。**1系統につき1つ**（指示書の決めごと）。
  //   系統が偏らないよう、抽選は「まず系統を選び、その中から選ぶ」形にする。
  // simulInput … 全員が同時に出す遊びか。
  //   手渡し（1台を回す）では同時に出せないので、**1人ずつ画面に伏せて入力して回す**
  //   （設計書の決めごと⑬）。この印を見て、画面側が回す形に切り替える。
  // sec … 締め切りまでの目安（秒）。進行役がこれで期限を置く。
  var MINIS = {
    tap: {
      id: 'tap', kind: 'reflex', title: 'れんだ',
      lead: '合図が出たら、できるだけ速く連打',
      note: '30回で満タン。そこから先は、早く満タンにした人が上',
      simulInput: true, sec: 6
    },
    janken: {
      id: 'janken', kind: 'luck', title: 'いっせーの じゃんけん',
      lead: 'グー・チョキ・パーを出す',
      note: 'あいこなら、もう一度',
      simulInput: true, sec: 12
    },
    quiz: {
      id: 'quiz', kind: 'brain', title: 'はやおし クイズ',
      lead: '正解した人のうち、いちばん早い人が勝ち',
      note: '外しても、そのターンに損はしない',
      simulInput: true, sec: 20
    },
    fingers: {
      id: 'fingers', kind: 'mind', title: 'ゆびの かずあて',
      lead: 'せーので、0〜5本を出す',
      note: '**いちばん珍しい本数**を出した人が勝ち。かぶるほど順位が下がる',
      simulInput: true, sec: 14
    }
  };
  var KINDS = ['reflex', 'luck', 'brain', 'mind'];

  function miniById(id) { return MINIS[id] || null; }
  function miniIds() { return Object.keys(MINIS); }
  function minisOfKind(kind) {
    return miniIds().filter(function (id) { return MINIS[id].kind === kind; });
  }

  /**
   * 次のミニゲームを引く。
   *
   * **まず系統を選び、その中から選ぶ。** ミニゲームの一覧から直に引くと、
   * ある系統に2つ以上足した時、その系統だけ出やすくなる
   * （＝その系統が得意な人が勝ちやすくなる）。系統の重みを均すのが狙い。
   *
   * 直前と同じものは避ける（同じ遊びが続くと飽きる）。
   */
  function pickMini(rnd, lastId) {
    var r = rnd || Math.random;
    var last = MINIS[lastId];
    var kinds = KINDS.filter(function (k) {
      // 同じ系統が1つしか無い時は、直前と同じ系統を避ける
      return !(last && last.kind === k && minisOfKind(k).length <= 1);
    });
    if (!kinds.length) kinds = KINDS.slice();
    var kind = kinds[Math.floor(r() * kinds.length)];
    var pool = minisOfKind(kind).filter(function (id) { return id !== lastId; });
    if (!pool.length) pool = minisOfKind(kind);
    return MINIS[pool[Math.floor(r() * pool.length)]] || null;
  }

  // ===== 順位づけ =====
  //
  // どの系統も、返す形をそろえる:
  //   { ranked: [{id, rank, tied, score}], draw: boolean }
  // draw=true は「勝ちが決まらなかった」（じゃんけんのあいこ）。進行役がもう一度やる。
  //
  // 出していない人は必ず最下位に同着。ここに例外を作らない。

  // 点数の高い順に並べて、同点は同順位にする（共通の芯）
  function rankByScore(playerIds, scoreOf) {
    var list = (playerIds || []).map(function (id) {
      return { id: id, score: scoreOf(id) };
    }).sort(function (a, b) { return b.score - a.score; });
    var out = [];
    var rank = 0;
    list.forEach(function (p, i) {
      if (i === 0 || list[i - 1].score !== p.score) rank = i + 1;
      out.push({ id: p.id, rank: rank, score: p.score, tied: false });
    });
    var counts = {};
    out.forEach(function (p) { counts[p.rank] = (counts[p.rank] || 0) + 1; });
    out.forEach(function (p) { p.tied = counts[p.rank] > 1; });
    return out;
  }

  /**
   * 連打。叩いた回数が多い順。**30回で頭打ち**。
   * 満タンに届いた人どうしは、早く届いた方が上（entries[id].atMs）。
   * 上限を置くのは、体力と指の速さで年齢差がそのまま出るのを抑えるため。
   */
  function rankTap(playerIds, entries) {
    var e = entries || {};
    return {
      draw: false,
      ranked: rankByScore(playerIds, function (id) {
        var v = e[id];
        if (!v) return -1;                       // 出していない人は最下位
        var n = Math.min(TAP_CAP, Math.max(0, v.count | 0));
        // 満タンの人だけ、早さで差をつける（早いほど大きい点になるように引く）
        if (n >= TAP_CAP && v.atMs != null) return TAP_CAP + (1 - Math.min(1, v.atMs / 100000));
        return n;
      })
    };
  }

  /**
   * じゃんけん。3すくみ。
   * 3種類そろった時と、全員同じ手の時は「あいこ」＝勝ちが決まらない（draw）。
   * 出していない人は、勝ち負けの計算に入れず最下位。
   */
  function rankJanken(playerIds, entries) {
    var e = entries || {};
    var played = (playerIds || []).filter(function (id) {
      return e[id] && HANDS.indexOf(e[id].hand) !== -1;
    });
    var kinds = {};
    played.forEach(function (id) { kinds[e[id].hand] = true; });
    var shown = Object.keys(kinds);
    // あいこ：全員同じ／3種類そろった／出した人が1人もいない
    if (!played.length || shown.length !== 2) {
      return {
        draw: true,
        ranked: rankByScore(playerIds, function () { return 0; })
      };
    }
    // 2種類しか出ていないので、勝ち手は1つに決まる
    var winnerHand = (BEATS[shown[0]] === shown[1]) ? shown[0] : shown[1];
    return {
      draw: false,
      ranked: rankByScore(playerIds, function (id) {
        if (!e[id] || HANDS.indexOf(e[id].hand) === -1) return -1;   // 出していない
        return e[id].hand === winnerHand ? 1 : 0;
      })
    };
  }

  /**
   * はやおしクイズ。正解した人のうち、早い順。
   * 外した人・出していない人は、正解した人より必ず後ろ。
   * 問題そのものは quiz-bank.js から進行役が引く（ここでは持たない）。
   */
  function rankQuiz(playerIds, entries) {
    var e = entries || {};
    return {
      draw: false,
      ranked: rankByScore(playerIds, function (id) {
        var v = e[id];
        if (!v || v.correct !== true) return 0;     // 外した・出していない
        // 早いほど大きい点。同着を避けるため、ミリ秒をそのまま反映する
        return 1000000 - Math.max(0, v.atMs | 0);
      })
    };
  }

  /**
   * ゆびの かずあて。**いちばん珍しい本数**を出した人が勝ち。
   * 同じ本数を出した人が少ないほど上。人数が同じなら同順位。
   * これだけは運でも反射神経でもなく、「みんなが何を出すか」を読む遊びになる。
   */
  function rankFingers(playerIds, entries) {
    var e = entries || {};
    var count = {};
    (playerIds || []).forEach(function (id) {
      var v = e[id];
      if (!v || v.fingers == null) return;
      var n = clampFingers(v.fingers);
      count[n] = (count[n] || 0) + 1;
    });
    return {
      draw: false,
      ranked: rankByScore(playerIds, function (id) {
        var v = e[id];
        if (!v || v.fingers == null) return -1;      // 出していない人は最下位
        var n = clampFingers(v.fingers);
        // かぶった人数が少ないほど大きい点（1人だけなら最大）
        return FINGER_MAX + 2 - (count[n] || 1);
      })
    };
  }
  function clampFingers(v) {
    var n = v | 0;
    return n < 0 ? 0 : (n > FINGER_MAX ? FINGER_MAX : n);
  }

  var RANKERS = { tap: rankTap, janken: rankJanken, quiz: rankQuiz, fingers: rankFingers };

  /**
   * ミニゲームの結果から順位をつける。進行役はこの1本だけを呼ぶ。
   * ゲームごとに呼び分けを書くと、系統を足した時に書き忘れる（落とし穴4）。
   */
  function rankMini(miniId, playerIds, entries) {
    var fn = RANKERS[miniId];
    if (!fn) return { draw: false, ranked: rankByScore(playerIds || [], function () { return 0; }) };
    return fn(playerIds || [], entries || {});
  }

  /**
   * 順位から「駒を動かす順番」を作る。
   * 1位から順に並べ、同着は並び順のまま（同着でも誰かが先に動く必要がある）。
   */
  function grabOrder(ranked) {
    return (ranked || []).slice().sort(function (a, b) { return a.rank - b.rank; })
      .map(function (p) { return p.id; });
  }

  // 敗者が動けるマス数（設計書の決めごと⑫）。
  // 勝者の出目（1〜6）より必ず小さく保ち、勝ち筋を薄めない。
  // 何も起きないと、勝てない人がずっと傍観者になってしまうので0にはしない。
  var LOSER_STEPS = { 2: 2, 3: 1 };
  function loserSteps(rank) {
    return LOSER_STEPS[rank | 0] || 0;
  }

  return {
    MINIS: MINIS, KINDS: KINDS, HAND: HAND, HANDS: HANDS,
    TAP_CAP: TAP_CAP, FINGER_MAX: FINGER_MAX, LOSER_STEPS: LOSER_STEPS,
    miniById: miniById, miniIds: miniIds, minisOfKind: minisOfKind, pickMini: pickMini,
    rankMini: rankMini, rankByScore: rankByScore,
    grabOrder: grabOrder, loserSteps: loserSteps
  };
}));
