// titles.js — 称号（アイコンと二つ名）の目録と、獲得条件の判定。
//
// 二つ名は3つのパーツでできている：はじめの言葉 ＋ 接続詞 ＋ 終わりの言葉。
// 初期状態は全員「はじめ」＋「の」＋「一歩」＝「はじめの一歩」。
//
// 勝敗ではなく「何をやったか」を讃える仕組みなので、条件は勝ち負けだけでなく
// 役職の仕事ぶり・遊んだ回数・遊び方の広さも見る。
//
// カセットを足す時にここだけを触れば済むようにしてある：
//   1. STAT_SHAPE に、そのカセットのカウンタを足す
//   2. CATALOG に cassette: 'そのカセットのid' のパーツを足す
// 画面もサーバーも判定はここを呼ぶだけなので、条件が2か所に散らない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TitleLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 二つ名のパーツの種類。並べる順がそのまま名乗りの順になる
  var PARTS = ['first', 'joiner', 'last'];

  // カセットごとの、ためていく数字。
  // 「一度でもやったか」で足りるものも数で持つ（1以上かで見るだけ）。
  var STAT_SHAPE = {
    jinro: {
      plays: 0,             // 人狼カセットを遊んだ回数（ワードウルフも含む）
      wordwolfPlays: 0,     // うち、ワードウルフ
      wins: 0,              // 勝った回数
      villageWins: 0,       // 村人側で勝った
      wolfWins: 0,          // 人狼側で勝った
      foxWins: 0,           // 妖狐で勝った
      correctVotes: 0,      // 投票でウルフ・人狼を正しく当てた
      runoffComeback: 0,    // 決選投票で逆転勝利に貢献した
      wolfEscapes: 0,       // 人狼側で、当てられずに逃げ切った
      seerHits: 0,          // 占った相手が人狼だった
      knightSaves: 0,       // 騎士として護衛に成功した
      foxSolo: 0,           // 妖狐として単独勝利した
      loversSurvived: 0,    // 恋人として2人で生き残った
      madmanHidden: 0,      // 狂人として正体がバレずに終わった
      wordwolfEscapes: 0,   // ワードウルフで、当てられずに逃げ切った
      tricks: 0,            // のぞき見役・まきこみ役として相手を欺いた
      mediumHits: 0         // 霊媒師として的中させた
    },
    aresore: {
      plays: 0,             // 遊んだ回数
      wins: 0,              // 勝った回数
      oneHintGiven: 0,      // 出題者として、最初のヒントだけで当てさせた
      sealedSuccess: 0,     // 封印ワード縛りでも当てさせた
      survivalWins: 0,      // サバイバルで優勝した
      normalPlays: 0,       // 通常プレイを遊んだ
      sealedPlays: 0,       // 封印ワードを遊んだ
      survivalPlays: 0,     // サバイバルを遊んだ
      normalWins: 0,
      sealedWins: 0,
      oneHintAnswered: 0,   // 正解者として、ヒント1つで当てた
      ownVoiceQuestions: 0, // AI読み上げを使わず、自分の声で出題した
      asGiver: 0,           // 出題者として出題した回数
      asAnswerer: 0,        // 正解者として正解した回数
      aiReadPlays: 0,       // AI読み上げモードで遊んだ回数
      comebackWins: 0       // 最下位候補から優勝した
    },
    // ---- 第32弾-B-2：新しい3カセットぶん ----
    // 数えられないカウンタは作らない。作ると「絶対に手に入らない称号」が
    // コレクション画面に永久に並ぶことになる（同時解除がまだ無いので、その分は入れていない）。
    bakudan: {
      plays: 0,             // 爆弾解除カセットを遊んだ回数
      wins: 0,              // 解除に成功した回数
      noMissClears: 0,      // ミス0で解除しきった
      raceWins: 0,          // 競争版で1位になった
      raceWinStreak: 0,     // 競争版の通算勝ち数
      defusePlays: 0,       // 実物解除を遊んだ
      defuseWins: 0,        // 実物解除に成功した
      defuseNoMiss: 0,      // 実物解除をミス0で終えた
      manualHelps: 0,       // マニュアル役として解除を成功に導いた
      focusWins: 0,         // 集中解除に成功した
      comebacks: 0          // ライフ1まで減ってから解除しきった
    },
    quizou: {
      plays: 0,             // クイズ王カセットを遊んだ回数
      wins: 0,              // 1位になった回数
      rushPlays: 0, rushWins: 0,
      rushNoPass: 0,        // パスを1回も使わずにラウンドを終えた
      listPlays: 0, listBest: 0,   // つぎつぎで出せた最高数
      revealPlays: 0, revealHits: 0, revealEarly: 0, // 開き始めてすぐ当てた
      buzzerPlays: 0, buzzerWins: 0, buzzerPerfect: 0, // 無失点で勝ち抜き
      hardHits: 0,          // むずかしい以上を正解した数
      muriHits: 0           // 「むりなんだが」を正解した数
    },
    auction: {
      plays: 0,             // オークションを遊んだ回数
      wins: 0,              // 1位になった回数
      jackpots: 0,          // 大当たりを落札した
      duds: 0,              // 大ハズレを落札した
      bestProfit: 0,        // 1ラウンドの最高収支
      appraises: 0,         // 鑑定眼を使った回数
      doubleHits: 0,        // ダブルアップで当たりを引いた
      allInWins: 0,         // 持ちチップを全部出して落札し、勝った
      quietWins: 0          // 一度も落札せずに勝った
    },
    // ---- 第32弾-F：季節イベント ----
    // 数えるのは「期間中に、実際に集まって遊んだこと」だけ。
    // ログイン・起動の回数は数えない（毎日開かせる仕組みは作らない）
    season: {
      summerPlays: 0,       // 夏まつりの期間中に、集まって遊んだ回数
      summerCrowd: 0        // うち、5人以上で遊んだ回数
    },
    // ---- 第34弾 2-2：みんなからのおくりもの ----
    // カセットを問わない、アプリ全体を通しての数字。
    // 「ありがとう」は勝敗と関係なくプレイヤー同士が贈り合うもの（第32弾-E 第5部）
    social: {
      thanksGot: 0          // 「ありがとう」を受け取った回数
    }
  };

  // ===== 第32弾-F：季節イベントの期間 =====
  // 「期間」を1件登録すれば季節が増える形。コードの書き換えでON/OFFしない。
  // 月・日で判定するので、毎年その期間になれば自動で始まり、過ぎれば自動で終わる。
  // 一度手に入れた称号は、期間が終わっても永久に残る（それが「あの夏の記念」になる）。
  var SEASONS = [
    { id: 'summer', label: '夏まつり', icon: '🎐', theme: 'season-summer',
      from: { m: 7, d: 1 }, to: { m: 8, d: 31 } }
    // 正月・春・ハロウィン・クリスマスなどは、ここに1件足し、
    // season のカウンタと CATALOG のパーツを添えるだけでよい
  ];
  // いまの季節。期間外は null（装飾も獲得条件も、完全に無効になる）
  function seasonFor(date) {
    var d = date || new Date();
    var md = (d.getMonth() + 1) * 100 + d.getDate();
    for (var i = 0; i < SEASONS.length; i++) {
      var s = SEASONS[i];
      var a = s.from.m * 100 + s.from.d;
      var b = s.to.m * 100 + s.to.d;
      // 年またぎ（12月末〜1月の正月など）にも対応しておく
      var hit = (a <= b) ? (md >= a && md <= b) : (md >= a || md <= b);
      if (hit) return s;
    }
    return null;
  }

  function emptyStats() {
    var out = {};
    Object.keys(STAT_SHAPE).forEach(function (cas) {
      out[cas] = {};
      Object.keys(STAT_SHAPE[cas]).forEach(function (k) { out[cas][k] = 0; });
    });
    return out;
  }
  // 保存されていた数字を、いまの形に揃える（あとから増やしたカウンタを 0 で埋める）
  function normalizeStats(stats) {
    var out = emptyStats();
    if (!stats || typeof stats !== 'object') return out;
    Object.keys(out).forEach(function (cas) {
      var src = stats[cas];
      if (!src || typeof src !== 'object') return;
      Object.keys(out[cas]).forEach(function (k) {
        var v = src[k];
        if (typeof v === 'number' && isFinite(v) && v > 0) out[cas][k] = Math.floor(v);
      });
    });
    return out;
  }
  // s(カセット, カウンタ名) で安全に読む
  function reader(stats) {
    var st = normalizeStats(stats);
    return function (cas, key) { return (st[cas] && st[cas][key]) || 0; };
  }

  // ---- 目録 ----
  // free:true は最初から使えるもの。それ以外は need(s) が真になったら手に入る。
  // hint は「どうすれば手に入るか」。まだ持っていない人にも見せる。
  var CATALOG = {
    icon: [
      { id: 'icon-default', cassette: null, emoji: '🙂', label: 'いつもの顔', free: true,
        hint: '最初から使えます' },

      { id: 'icon-wolf-1', cassette: 'jinro', emoji: '🌙', label: '見習いの証',
        hint: '人狼カセットを1回あそぶ',
        need: function (s) { return s('jinro', 'plays') >= 1; } },
      { id: 'icon-wolf-10', cassette: 'jinro', emoji: '🐺', label: 'ベテランの証',
        hint: '人狼カセットを通算10回あそぶ',
        need: function (s) { return s('jinro', 'plays') >= 10; } },
      { id: 'icon-wolf-teams', cassette: 'jinro', emoji: '🎭', label: '全陣営制覇の証',
        hint: '村人側・人狼側・妖狐で、それぞれ1回ずつ勝つ',
        need: function (s) {
          return s('jinro', 'villageWins') >= 1 && s('jinro', 'wolfWins') >= 1 && s('jinro', 'foxWins') >= 1;
        } },
      { id: 'icon-wolf-sheep', cassette: 'jinro', emoji: '🐑', label: 'シープの友',
        hint: 'ワードウルフを5回あそぶ',
        need: function (s) { return s('jinro', 'wordwolfPlays') >= 5; } },

      { id: 'icon-are-1', cassette: 'aresore', emoji: '🎈', label: 'はじめの参加証',
        hint: 'あれそれどれこれを1回あそぶ',
        need: function (s) { return s('aresore', 'plays') >= 1; } },
      { id: 'icon-are-10', cassette: 'aresore', emoji: '📖', label: '言葉の達人見習い',
        hint: 'あれそれどれこれを通算10回あそぶ',
        need: function (s) { return s('aresore', 'plays') >= 10; } },
      { id: 'icon-are-seal', cassette: 'aresore', emoji: '🚫', label: '封印破りの証',
        hint: '封印ワードモードで1回でも正解させる',
        need: function (s) { return s('aresore', 'sealedSuccess') >= 1; } },
      // ---- 第34弾 2-2：みんなからのおくりもの（カセットを問わない） ----
      { id: 'icon-thanks-1', cassette: 'social', emoji: '🎁', label: 'はじめてのありがとう',
        hint: 'だれかから「ありがとう」を1回もらう',
        need: function (s) { return s('social', 'thanksGot') >= 1; } },
      { id: 'icon-thanks-10', cassette: 'social', emoji: '💐', label: 'ありがとうの花束',
        hint: '「ありがとう」を通算10回もらう',
        need: function (s) { return s('social', 'thanksGot') >= 10; } },
      // ---- 第32弾-F：季節限定（夏）。期間中に集まって遊んだ人だけ。
      //      一度手に入れたら、夏が終わっても永久に残る ----
      { id: 'icon-season-summer', cassette: 'season', emoji: '🎐', label: 'あの夏の記念',
        hint: '夏まつり（7/1〜8/31）の間に、みんなで集まって1回あそぶ',
        need: function (s) { return s('season', 'summerPlays') >= 1; } },
      { id: 'icon-season-hanabi', cassette: 'season', emoji: '🎆', label: '夏の夜空の証',
        hint: '夏まつりの間に、5人以上で集まってあそぶ',
        need: function (s) { return s('season', 'summerCrowd') >= 1; } },
      // ---- 第32弾-B-2：爆弾解除 ----
      { id: 'icon-bomb-1', cassette: 'bakudan', emoji: '💣', label: '解除班の証',
        hint: '爆弾解除カセットを1回あそぶ',
        need: function (s) { return s('bakudan', 'plays') >= 1; } },
      { id: 'icon-bomb-10', cassette: 'bakudan', emoji: '🧨', label: 'ベテラン解除班の証',
        hint: '爆弾解除カセットを通算10回あそぶ',
        need: function (s) { return s('bakudan', 'plays') >= 10; } },
      { id: 'icon-bomb-defuse', cassette: 'bakudan', emoji: '🧰', label: '実物解除の証',
        hint: '実物解除を1回成功させる',
        need: function (s) { return s('bakudan', 'defuseWins') >= 1; } },
      { id: 'icon-bomb-clean', cassette: 'bakudan', emoji: '🎯', label: '無傷の証',
        hint: 'ミス0で解除しきる',
        need: function (s) { return s('bakudan', 'noMissClears') >= 1; } },

      // ---- 第32弾-B-2：クイズ王 ----
      { id: 'icon-quiz-1', cassette: 'quizou', emoji: '🎓', label: '挑戦者の証',
        hint: 'クイズ王カセットを1回あそぶ',
        need: function (s) { return s('quizou', 'plays') >= 1; } },
      { id: 'icon-quiz-10', cassette: 'quizou', emoji: '👑', label: 'クイズ王の証',
        hint: 'クイズ王カセットを通算10回あそぶ',
        need: function (s) { return s('quizou', 'plays') >= 10; } },
      { id: 'icon-quiz-buzzer', cassette: 'quizou', emoji: '🥊', label: '早押し王の証',
        hint: '早押しトーナメントで優勝する',
        need: function (s) { return s('quizou', 'buzzerWins') >= 1; } },
      { id: 'icon-quiz-muri', cassette: 'quizou', emoji: '🧠', label: '難問撃破の証',
        hint: '「むりなんだが」の問題を正解する',
        need: function (s) { return s('quizou', 'muriHits') >= 1; } },

      // ---- 第32弾-B-2：オークション ----
      { id: 'icon-auc-1', cassette: 'auction', emoji: '💰', label: '競り人の証',
        hint: 'オークションを1回あそぶ',
        need: function (s) { return s('auction', 'plays') >= 1; } },
      { id: 'icon-auc-10', cassette: 'auction', emoji: '🏛', label: '常連の証',
        hint: 'オークションを通算10回あそぶ',
        need: function (s) { return s('auction', 'plays') >= 10; } },
      { id: 'icon-auc-jackpot', cassette: 'auction', emoji: '💎', label: '大当たりの証',
        hint: '大当たりの品物を落札する',
        need: function (s) { return s('auction', 'jackpots') >= 1; } },
      { id: 'icon-auc-quiet', cassette: 'auction', emoji: '🕊', label: '静観の証',
        hint: '一度も落札せずに1位になる',
        need: function (s) { return s('auction', 'quietWins') >= 1; } },
      { id: 'icon-are-survivor', cassette: 'aresore', emoji: '🏆', label: '生き残りの証',
        hint: 'サバイバルで優勝する',
        need: function (s) { return s('aresore', 'survivalWins') >= 1; } }
    ],

    first: [
      { id: 'first-hajime', cassette: null, label: 'はじめ', free: true, hint: '最初から使えます' },

      // 第34弾 2-2：みんなからのおくりもの
      { id: 'first-tayori', cassette: 'social', label: 'たよりになる',
        hint: 'だれかから「ありがとう」を3回もらう',
        need: function (s) { return s('social', 'thanksGot') >= 3; } },

      // 第32弾-F：季節限定（夏）
      { id: 'first-natsu', cassette: 'season', label: 'なつまつりの',
        hint: '夏まつり（7/1〜8/31）の間に、みんなで集まって3回あそぶ',
        need: function (s) { return s('season', 'summerPlays') >= 3; } },

      { id: 'first-utagai', cassette: 'jinro', label: '疑り深き',
        hint: '投票でウルフ・人狼を正しく当てた回数が5回以上',
        need: function (s) { return s('jinro', 'correctVotes') >= 5; } },
      { id: 'first-daitan', cassette: 'jinro', label: '大胆',
        hint: '決選投票で逆転勝利に貢献する',
        need: function (s) { return s('jinro', 'runoffComeback') >= 1; } },
      { id: 'first-minuke', cassette: 'jinro', label: '見抜け',
        hint: '人狼側で3回、当てられずに逃げ切る',
        need: function (s) { return s('jinro', 'wolfEscapes') >= 3; } },
      { id: 'first-senri', cassette: 'jinro', label: '千里眼',
        hint: '占い師として、占った相手が人狼だったことを2回当てる',
        need: function (s) { return s('jinro', 'seerHits') >= 2; } },
      { id: 'first-chujitsu', cassette: 'jinro', label: '忠実',
        hint: '騎士として護衛に成功する',
        need: function (s) { return s('jinro', 'knightSaves') >= 1; } },
      { id: 'first-kodoku', cassette: 'jinro', label: '孤独',
        hint: '妖狐として単独勝利する',
        need: function (s) { return s('jinro', 'foxSolo') >= 1; } },
      { id: 'first-kizuna', cassette: 'jinro', label: '絆',
        hint: '恋人として2人で生き残る',
        need: function (s) { return s('jinro', 'loversSurvived') >= 1; } },

      { id: 'first-takumi', cassette: 'aresore', label: '巧み',
        hint: '出題者として、最初のヒントだけで当てさせた回数が5回以上',
        need: function (s) { return s('aresore', 'oneHintGiven') >= 5; } },
      { id: 'first-kiten', cassette: 'aresore', label: '機転',
        hint: '封印ワード縛りでも相手に当てさせる',
        need: function (s) { return s('aresore', 'sealedSuccess') >= 1; } },
      { id: 'first-nintai', cassette: 'aresore', label: '忍耐',
        hint: 'サバイバルで優勝する',
        need: function (s) { return s('aresore', 'survivalWins') >= 1; } },
      { id: 'first-hakushiki', cassette: 'aresore', label: '博識',
        hint: '通常プレイ・封印ワード・サバイバルを全部1回以上あそぶ',
        need: function (s) {
          return s('aresore', 'normalPlays') >= 1 && s('aresore', 'sealedPlays') >= 1 && s('aresore', 'survivalPlays') >= 1;
        } },
      { id: 'first-kikijozu', cassette: 'aresore', label: '聞き上手',
        hint: '正解者として、ヒント1つで当てる',
        need: function (s) { return s('aresore', 'oneHintAnswered') >= 1; } },
      { id: 'first-jozetsu', cassette: 'aresore', label: '饒舌',
        hint: 'AI読み上げを使わず、自分の声で10回以上出題する',
        need: function (s) { return s('aresore', 'ownVoiceQuestions') >= 10; } },

      // ---- 第32弾-B-2：爆弾解除（指示の設計どおり。同時解除はまだ無いので入れていない）----
      { id: 'first-reisei', cassette: 'bakudan', label: '冷静',
        hint: 'ミス0で解除しきる',
        need: function (s) { return s('bakudan', 'noMissClears') >= 1; } },
      { id: 'first-jinsoku', cassette: 'bakudan', label: '迅速',
        hint: 'クイズ解除（競争版）で1位になる',
        need: function (s) { return s('bakudan', 'raceWins') >= 1; } },
      { id: 'first-shincho', cassette: 'bakudan', label: '慎重',
        hint: '実物解除をミス0で終える',
        need: function (s) { return s('bakudan', 'defuseNoMiss') >= 1; } },
      { id: 'first-koko', cassette: 'bakudan', label: '孤高',
        hint: '集中解除（マニュアル役1人）を成功させる',
        need: function (s) { return s('bakudan', 'focusWins') >= 1; } },
      { id: 'first-fukutsu-bomb', cassette: 'bakudan', label: '不屈',
        hint: 'ライフが残り1まで減ってから解除しきる',
        need: function (s) { return s('bakudan', 'comebacks') >= 1; } },

      // ---- 第32弾-B-2：クイズ王（瞬発力・記憶・リスク判断・反射神経）----
      { id: 'first-shunsoku', cassette: 'quizou', label: '瞬速',
        hint: 'クイズラッシュでラウンドに勝つ',
        need: function (s) { return s('quizou', 'rushWins') >= 1; } },
      { id: 'first-hakushiki-quiz', cassette: 'quizou', label: '博識',
        hint: 'むずかしい以上の問題を通算20問正解する',
        need: function (s) { return s('quizou', 'hardHits') >= 20; } },
      { id: 'first-shunen', cassette: 'quizou', label: '執念',
        hint: 'つぎつぎクイズで10個以上出す',
        need: function (s) { return s('quizou', 'listBest') >= 10; } },
      { id: 'first-godan', cassette: 'quizou', label: '豪胆',
        hint: 'とくとくクイズで、ほとんど見えないうちに当てる',
        need: function (s) { return s('quizou', 'revealEarly') >= 1; } },
      { id: 'first-denko', cassette: 'quizou', label: '電光',
        hint: '早押しトーナメントを、1問も落とさずに勝ち抜く',
        need: function (s) { return s('quizou', 'buzzerPerfect') >= 1; } },

      // ---- 第32弾-B-2：オークション（読み合い）----
      { id: 'first-mekiki', cassette: 'auction', label: '目利き',
        hint: '鑑定眼を使って、大当たりを落札する',
        need: function (s) { return s('auction', 'appraises') >= 1 && s('auction', 'jackpots') >= 1; } },
      { id: 'first-gowan', cassette: 'auction', label: '豪腕',
        hint: '持ちチップを全部出して落札し、そのまま1位になる',
        need: function (s) { return s('auction', 'allInWins') >= 1; } },
      { id: 'first-goyoku', cassette: 'auction', label: '強欲',
        hint: 'ダブルアップで当たりの品物を2倍にする',
        need: function (s) { return s('auction', 'doubleHits') >= 1; } },
      { id: 'first-seikan', cassette: 'auction', label: '静観',
        hint: '一度も落札せずに1位になる',
        need: function (s) { return s('auction', 'quietWins') >= 1; } }
        ],

    // 接続詞は語彙こそ共通だが、条件はカセットごとに別（どちらで満たしても手に入る）
    joiner: [
      { id: 'joiner-no', cassette: null, label: 'の', free: true, hint: '最初から使えます' },

      { id: 'joiner-naru-wolf', cassette: 'jinro', label: 'なる',
        hint: '人狼カセットで通算5勝する',
        need: function (s) { return s('jinro', 'wins') >= 5; } },
      { id: 'joiner-taru-wolf', cassette: 'jinro', label: 'たる',
        hint: '人狼カセットで3つの陣営で勝つ',
        need: function (s) {
          var n = 0;
          if (s('jinro', 'villageWins') >= 1) n++;
          if (s('jinro', 'wolfWins') >= 1) n++;
          if (s('jinro', 'foxWins') >= 1) n++;
          return n >= 3;
        } },

      { id: 'joiner-naru-are', cassette: 'aresore', label: 'なる',
        hint: 'あれそれどれこれで通算5勝する',
        need: function (s) { return s('aresore', 'wins') >= 5; } },
      { id: 'joiner-taru-are', cassette: 'aresore', label: 'たる',
        hint: '通常プレイ・封印ワード・サバイバルで、それぞれ1勝以上する',
        need: function (s) {
          return s('aresore', 'normalWins') >= 1 && s('aresore', 'sealedWins') >= 1 && s('aresore', 'survivalWins') >= 1;
        } },

      { id: 'joiner-naru-bomb', cassette: 'bakudan', label: 'なる',
        hint: '爆弾解除カセットで通算5回、解除に成功する',
        need: function (s) { return s('bakudan', 'wins') >= 5; } },
      { id: 'joiner-koso-quiz', cassette: 'quizou', label: 'こそ',
        hint: 'クイズ王カセットで通算5回1位になる',
        need: function (s) { return s('quizou', 'wins') >= 5; } },
      { id: 'joiner-taru-auc', cassette: 'auction', label: 'たる',
        hint: 'オークションで通算5回1位になる',
        need: function (s) { return s('auction', 'wins') >= 5; } }
        ],

    last: [
      { id: 'last-ippo', cassette: null, label: '一歩', free: true, hint: '最初から使えます' },

      { id: 'last-yogensha', cassette: 'jinro', label: '予言者',
        hint: '占い師として1回でも当てる',
        need: function (s) { return s('jinro', 'seerHits') >= 1; } },
      { id: 'last-shugosha', cassette: 'jinro', label: '守護者',
        hint: '騎士として護衛成功を1回経験する',
        need: function (s) { return s('jinro', 'knightSaves') >= 1; } },
      { id: 'last-doke', cassette: 'jinro', label: '道化',
        hint: '狂人として、正体がバレずに試合を終える',
        need: function (s) { return s('jinro', 'madmanHidden') >= 1; } },
      { id: 'last-ippikiokami', cassette: 'jinro', label: '一匹狼',
        hint: 'ワードウルフで1回、当てられずに逃げ切る',
        need: function (s) { return s('jinro', 'wordwolfEscapes') >= 1; } },
      { id: 'last-sakushi', cassette: 'jinro', label: '策士',
        hint: 'のぞき見役・まきこみ役として相手を欺く',
        need: function (s) { return s('jinro', 'tricks') >= 1; } },
      { id: 'last-borei', cassette: 'jinro', label: '亡霊',
        hint: '霊媒師として2回、情報を的中させる',
        need: function (s) { return s('jinro', 'mediumHits') >= 2; } },

      { id: 'last-meishu', cassette: 'aresore', label: '名手',
        hint: 'あれそれどれこれで通算5勝する',
        need: function (s) { return s('aresore', 'wins') >= 5; } },
      { id: 'last-annainin', cassette: 'aresore', label: '案内人',
        hint: '出題者として通算10回出題する',
        need: function (s) { return s('aresore', 'asGiver') >= 10; } },
      { id: 'last-hayamimi', cassette: 'aresore', label: '早耳',
        hint: '正解者として通算10回正解する',
        need: function (s) { return s('aresore', 'asAnswerer') >= 10; } },
      { id: 'last-kataribe', cassette: 'aresore', label: '語り部',
        hint: 'AI読み上げモードで5回以上あそぶ',
        need: function (s) { return s('aresore', 'aiReadPlays') >= 5; } },
      { id: 'last-fukutsu', cassette: 'aresore', label: '不屈',
        hint: 'サバイバルで、一度最下位候補になってから優勝する',
        need: function (s) { return s('aresore', 'comebackWins') >= 1; } },

      // ---- 第32弾-B-2：爆弾解除 ----
      { id: 'last-shokunin', cassette: 'bakudan', label: '職人',
        hint: '実物解除を5回成功させる',
        need: function (s) { return s('bakudan', 'defuseWins') >= 5; } },
      { id: 'last-meishu-bomb', cassette: 'bakudan', label: '名手',
        hint: 'クイズ解除（競争版）で通算5勝する',
        need: function (s) { return s('bakudan', 'raceWinStreak') >= 5; } },
      { id: 'last-michibikite', cassette: 'bakudan', label: '導き手',
        hint: 'マニュアル役として5回、解除を成功に導く',
        need: function (s) { return s('bakudan', 'manualHelps') >= 5; } },
      { id: 'last-kaitaiya', cassette: 'bakudan', label: '解体屋',
        hint: 'ミス0での解除を3回やりとげる',
        need: function (s) { return s('bakudan', 'noMissClears') >= 3; } },
      { id: 'last-mamorite', cassette: 'bakudan', label: '守り手',
        hint: 'みんなで協力して、解除に成功する',
        need: function (s) { return s('bakudan', 'wins') >= 1; } },

      // ---- 第32弾-B-2：クイズ王 ----
      { id: 'last-hayauchi', cassette: 'quizou', label: '早撃ち',
        hint: '早押しトーナメントで通算5回優勝する',
        need: function (s) { return s('quizou', 'buzzerWins') >= 5; } },
      { id: 'last-monoshiri', cassette: 'quizou', label: '物知り',
        hint: 'クイズ王カセットを通算20回あそぶ',
        need: function (s) { return s('quizou', 'plays') >= 20; } },
      { id: 'last-kiokujutsushi', cassette: 'quizou', label: '記憶術師',
        hint: 'つぎつぎクイズで20個以上出す',
        need: function (s) { return s('quizou', 'listBest') >= 20; } },
      { id: 'last-yomite', cassette: 'quizou', label: '読み手',
        hint: 'とくとくクイズで通算10問正解する',
        need: function (s) { return s('quizou', 'revealHits') >= 10; } },
      { id: 'last-muso', cassette: 'quizou', label: '無双',
        hint: 'クイズラッシュで、パスを1回も使わずにラウンドを終える',
        need: function (s) { return s('quizou', 'rushNoPass') >= 1; } },

      // ---- 第32弾-B-2：オークション ----
      { id: 'last-serinin', cassette: 'auction', label: '競り人',
        hint: 'オークションで通算5回1位になる',
        need: function (s) { return s('auction', 'wins') >= 5; } },
      { id: 'last-kanteishi', cassette: 'auction', label: '鑑定士',
        hint: '鑑定眼を通算10回使う',
        need: function (s) { return s('auction', 'appraises') >= 10; } },
      { id: 'last-daishonin', cassette: 'auction', label: '大商人',
        hint: '1ラウンドで差し引き+15枚以上を出す',
        need: function (s) { return s('auction', 'bestProfit') >= 15; } },
      { id: 'last-godan-auc', cassette: 'auction', label: '剛胆',
        hint: '大ハズレを落札しても、そのゲームで1位になる',
        need: function (s) { return s('auction', 'duds') >= 1 && s('auction', 'wins') >= 1; } }
    ]
  };

  /**
   * サバイバルで「最下位候補」になった人を選ぶ（称号「不屈」の前半分）。
   *
   * 見るのは、そのラウンドが始まった時点の通算スコア。
   * ラウンドの伸びで脱落が決まるので、通算で最下位でも生き残ることがあり、
   * そこから勝ち上がったことを「一度最下位候補になってから優勝」と呼ぶ。
   *
   * 全員が並んでいる時（初回など）は誰も最下位候補にしない。
   * そうしないと1回目で全員に印が付いて、優勝者が必ず不屈になってしまう。
   *
   * @param {Array} active  まだ脱落していない人 [{id}]
   * @param {Object} startScores  ラウンド開始時の通算スコア（id -> 点）
   * @returns {Array} 最下位候補になった人のid
   */
  function lastPlaceIds(active, startScores) {
    var list = (active || []).filter(function (p) { return p && p.id != null; });
    if (list.length < 2) return [];
    var scoreOf = function (p) {
      var v = (startScores || {})[p.id];
      return (typeof v === 'number' && isFinite(v)) ? v : 0;
    };
    var min = Math.min.apply(null, list.map(scoreOf));
    var max = Math.max.apply(null, list.map(scoreOf));
    if (min === max) return []; // 全員並んでいるなら、誰も遅れていない
    return list.filter(function (p) { return scoreOf(p) === min; })
               .map(function (p) { return p.id; });
  }

  // 最初から全員が持っているもの
  var DEFAULTS = {};
  Object.keys(CATALOG).forEach(function (part) {
    var free = CATALOG[part].filter(function (p) { return p.free; })[0];
    DEFAULTS[part] = free ? free.id : CATALOG[part][0].id;
  });

  function partsOf(part) { return CATALOG[part] || []; }
  function partById(part, id) {
    return partsOf(part).filter(function (p) { return p.id === id; })[0] || null;
  }
  function allParts() {
    return ['icon'].concat(PARTS).reduce(function (acc, part) {
      return acc.concat(partsOf(part).map(function (p) {
        return { part: part, def: p };
      }));
    }, []);
  }

  /**
   * いまの成績で条件を満たしている全パーツのID。
   * 一度手に入れたものは永久に残るので、呼び出し側はこれと
   * 保存済みの獲得済みIDを足し合わせて使う（減ることはない）。
   */
  function unlockedIds(stats) {
    var s = reader(stats);
    var out = [];
    allParts().forEach(function (x) {
      if (x.def.free || (x.def.need && x.def.need(s))) out.push(x.def.id);
    });
    return out;
  }

  // 保存済みの獲得済みIDに、いまの成績で新しく満たしたものを足す
  function mergeUnlocked(owned, stats) {
    var set = {};
    (owned || []).forEach(function (id) { set[id] = true; });
    unlockedIds(stats).forEach(function (id) { set[id] = true; });
    // 目録に無いID（作り直したパーツ）は捨てる
    return allParts().map(function (x) { return x.def.id; }).filter(function (id) { return set[id]; });
  }

  // 増えたぶんだけを返す（「手に入れました」を出すため）
  function newlyUnlocked(before, after) {
    var had = {};
    (before || []).forEach(function (id) { had[id] = true; });
    return (after || []).filter(function (id) { return !had[id]; });
  }

  // 装備。持っていないものが入っていたら初期に戻す（データが古くても壊れない）
  function normalizeEquipped(equipped, owned) {
    var have = {};
    (owned || []).forEach(function (id) { have[id] = true; });
    var out = {};
    ['icon'].concat(PARTS).forEach(function (part) {
      var id = equipped && equipped[part];
      out[part] = (id && have[id] && partById(part, id)) ? id : DEFAULTS[part];
    });
    return out;
  }

  // 「はじめ」＋「の」＋「一歩」→「はじめの一歩」
  function titleText(equipped) {
    var eq = equipped || DEFAULTS;
    return PARTS.map(function (part) {
      var p = partById(part, eq[part]) || partById(part, DEFAULTS[part]);
      return p ? p.label : '';
    }).join('');
  }
  function iconEmoji(equipped) {
    var p = partById('icon', (equipped || DEFAULTS).icon) || partById('icon', DEFAULTS.icon);
    return p ? p.emoji : '🙂';
  }

  return {
    CATALOG: CATALOG,
    PARTS: PARTS,
    PART_KEYS: ['icon'].concat(PARTS),
    DEFAULTS: DEFAULTS,
    STAT_SHAPE: STAT_SHAPE,
    SEASONS: SEASONS,       // 第32弾-F：季節イベントの期間と装飾のまとまり
    seasonFor: seasonFor,   // いまの季節（期間外は null）
    emptyStats: emptyStats,
    normalizeStats: normalizeStats,
    partsOf: partsOf,
    partById: partById,
    lastPlaceIds: lastPlaceIds,
    unlockedIds: unlockedIds,
    mergeUnlocked: mergeUnlocked,
    newlyUnlocked: newlyUnlocked,
    normalizeEquipped: normalizeEquipped,
    titleText: titleText,
    iconEmoji: iconEmoji
  };
}));
