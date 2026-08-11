// tests/titles.js — 称号（アイコン・二つ名）の目録と獲得条件（第26弾 第4部）
//
// 見るのは4つ：
//   ・初期状態は全員「はじめの一歩」＋いつもの顔で、誰でも最初から使える
//   ・指示書の条件表どおりに手に入る（1つずつ、境界の手前と後ろで確かめる）
//   ・一度手に入れたものは、あとで成績が変わっても消えない
//   ・持っていないものを装備していても壊れず、初期に戻る

const T = require('../public/js/titles');
const { createRunner, assert, assertEqual } = require('./harness');

// 指定したカウンタだけを立てた成績を作る
function stats(cassette, patch) {
  const s = T.emptyStats();
  Object.keys(patch || {}).forEach((k) => { s[cassette][k] = patch[k]; });
  return s;
}
function has(s, id) { return T.unlockedIds(s).indexOf(id) >= 0; }

// 条件表。[パーツID, カセット, 満たさない成績, 満たす成績]
const CASES = [
  // ---- 人狼カセット：アイコン ----
  ['icon-wolf-1', 'jinro', {}, { plays: 1 }],
  ['icon-wolf-10', 'jinro', { plays: 9 }, { plays: 10 }],
  ['icon-wolf-teams', 'jinro', { villageWins: 1, wolfWins: 1 }, { villageWins: 1, wolfWins: 1, foxWins: 1 }],
  ['icon-wolf-sheep', 'jinro', { wordwolfPlays: 4 }, { wordwolfPlays: 5 }],
  // ---- 人狼カセット：はじめの言葉 ----
  ['first-utagai', 'jinro', { correctVotes: 4 }, { correctVotes: 5 }],
  ['first-daitan', 'jinro', {}, { runoffComeback: 1 }],
  ['first-minuke', 'jinro', { wolfEscapes: 2 }, { wolfEscapes: 3 }],
  ['first-senri', 'jinro', { seerHits: 1 }, { seerHits: 2 }],
  ['first-chujitsu', 'jinro', {}, { knightSaves: 1 }],
  ['first-kodoku', 'jinro', {}, { foxSolo: 1 }],
  ['first-kizuna', 'jinro', {}, { loversSurvived: 1 }],
  // ---- 人狼カセット：接続詞 ----
  ['joiner-naru-wolf', 'jinro', { wins: 4 }, { wins: 5 }],
  ['joiner-taru-wolf', 'jinro', { villageWins: 1, wolfWins: 1 }, { villageWins: 1, wolfWins: 1, foxWins: 1 }],
  // ---- 人狼カセット：終わりの言葉 ----
  ['last-yogensha', 'jinro', {}, { seerHits: 1 }],
  ['last-shugosha', 'jinro', {}, { knightSaves: 1 }],
  ['last-doke', 'jinro', {}, { madmanHidden: 1 }],
  ['last-ippikiokami', 'jinro', {}, { wordwolfEscapes: 1 }],
  ['last-sakushi', 'jinro', {}, { tricks: 1 }],
  ['last-borei', 'jinro', { mediumHits: 1 }, { mediumHits: 2 }],

  // ---- あれそれどれこれ：アイコン ----
  ['icon-are-1', 'aresore', {}, { plays: 1 }],
  ['icon-are-10', 'aresore', { plays: 9 }, { plays: 10 }],
  ['icon-are-seal', 'aresore', {}, { sealedSuccess: 1 }],
  ['icon-are-survivor', 'aresore', {}, { survivalWins: 1 }],
  // ---- あれそれどれこれ：はじめの言葉 ----
  ['first-takumi', 'aresore', { oneHintGiven: 4 }, { oneHintGiven: 5 }],
  ['first-kiten', 'aresore', {}, { sealedSuccess: 1 }],
  ['first-nintai', 'aresore', {}, { survivalWins: 1 }],
  ['first-hakushiki', 'aresore', { normalPlays: 1, sealedPlays: 1 },
    { normalPlays: 1, sealedPlays: 1, survivalPlays: 1 }],
  ['first-kikijozu', 'aresore', {}, { oneHintAnswered: 1 }],
  ['first-jozetsu', 'aresore', { ownVoiceQuestions: 9 }, { ownVoiceQuestions: 10 }],
  // ---- あれそれどれこれ：接続詞 ----
  ['joiner-naru-are', 'aresore', { wins: 4 }, { wins: 5 }],
  ['joiner-taru-are', 'aresore', { normalWins: 1, sealedWins: 1 },
    { normalWins: 1, sealedWins: 1, survivalWins: 1 }],
  // ---- あれそれどれこれ：終わりの言葉 ----
  ['last-meishu', 'aresore', { wins: 4 }, { wins: 5 }],
  ['last-annainin', 'aresore', { asGiver: 9 }, { asGiver: 10 }],
  ['last-hayamimi', 'aresore', { asAnswerer: 9 }, { asAnswerer: 10 }],
  ['last-kataribe', 'aresore', { aiReadPlays: 4 }, { aiReadPlays: 5 }],
  ['last-fukutsu', 'aresore', {}, { comebackWins: 1 }],

  // ---- 第32弾-B-2：爆弾解除 ----
  ['icon-bomb-1', 'bakudan', {}, { plays: 1 }],
  ['icon-bomb-10', 'bakudan', { plays: 9 }, { plays: 10 }],
  ['icon-bomb-defuse', 'bakudan', {}, { defuseWins: 1 }],
  ['icon-bomb-clean', 'bakudan', {}, { noMissClears: 1 }],
  ['first-reisei', 'bakudan', {}, { noMissClears: 1 }],
  ['first-jinsoku', 'bakudan', {}, { raceWins: 1 }],
  ['first-shincho', 'bakudan', {}, { defuseNoMiss: 1 }],
  ['first-koko', 'bakudan', {}, { focusWins: 1 }],
  ['first-fukutsu-bomb', 'bakudan', {}, { comebacks: 1 }],
  ['joiner-naru-bomb', 'bakudan', { wins: 4 }, { wins: 5 }],
  ['last-shokunin', 'bakudan', { defuseWins: 4 }, { defuseWins: 5 }],
  ['last-meishu-bomb', 'bakudan', { raceWinStreak: 4 }, { raceWinStreak: 5 }],
  ['last-michibikite', 'bakudan', { manualHelps: 4 }, { manualHelps: 5 }],
  ['last-kaitaiya', 'bakudan', { noMissClears: 2 }, { noMissClears: 3 }],
  ['last-mamorite', 'bakudan', {}, { wins: 1 }],

  // ---- 第32弾-B-2：クイズ王 ----
  ['icon-quiz-1', 'quizou', {}, { plays: 1 }],
  ['icon-quiz-10', 'quizou', { plays: 9 }, { plays: 10 }],
  ['icon-quiz-buzzer', 'quizou', {}, { buzzerWins: 1 }],
  ['icon-quiz-muri', 'quizou', {}, { muriHits: 1 }],
  ['first-shunsoku', 'quizou', {}, { rushWins: 1 }],
  ['first-hakushiki-quiz', 'quizou', { hardHits: 19 }, { hardHits: 20 }],
  ['first-shunen', 'quizou', { listBest: 9 }, { listBest: 10 }],
  ['first-godan', 'quizou', {}, { revealEarly: 1 }],
  ['first-denko', 'quizou', {}, { buzzerPerfect: 1 }],
  ['joiner-koso-quiz', 'quizou', { wins: 4 }, { wins: 5 }],
  ['last-hayauchi', 'quizou', { buzzerWins: 4 }, { buzzerWins: 5 }],
  ['last-monoshiri', 'quizou', { plays: 19 }, { plays: 20 }],
  ['last-kiokujutsushi', 'quizou', { listBest: 19 }, { listBest: 20 }],
  ['last-yomite', 'quizou', { revealHits: 9 }, { revealHits: 10 }],
  ['last-muso', 'quizou', {}, { rushNoPass: 1 }],

  // ---- 第32弾-B-2：オークション ----
  ['icon-auc-1', 'auction', {}, { plays: 1 }],
  ['icon-auc-10', 'auction', { plays: 9 }, { plays: 10 }],
  ['icon-auc-jackpot', 'auction', {}, { jackpots: 1 }],
  ['icon-auc-quiet', 'auction', {}, { quietWins: 1 }],
  ['first-mekiki', 'auction', { appraises: 1 }, { appraises: 1, jackpots: 1 }],
  ['first-gowan', 'auction', {}, { allInWins: 1 }],
  ['first-goyoku', 'auction', {}, { doubleHits: 1 }],
  ['first-seikan', 'auction', {}, { quietWins: 1 }],
  ['joiner-taru-auc', 'auction', { wins: 4 }, { wins: 5 }],
  ['last-serinin', 'auction', { wins: 4 }, { wins: 5 }],
  ['last-kanteishi', 'auction', { appraises: 9 }, { appraises: 10 }],
  ['last-daishonin', 'auction', { bestProfit: 14 }, { bestProfit: 15 }],
  ['last-godan-auc', 'auction', { duds: 1 }, { duds: 1, wins: 1 }],
  // ---- 第32弾-F：季節イベント（夏） ----
  ['icon-season-summer', 'season', {}, { summerPlays: 1 }],
  ['icon-season-hanabi', 'season', { summerPlays: 9 }, { summerCrowd: 1 }],
  ['first-natsu', 'season', { summerPlays: 2 }, { summerPlays: 3 }],
  // ---- 第34弾 2-2：みんなからのおくりもの（カセットを問わない） ----
  ['icon-thanks-1', 'social', {}, { thanksGot: 1 }],
  ['icon-thanks-10', 'social', { thanksGot: 9 }, { thanksGot: 10 }],
  ['first-tayori', 'social', { thanksGot: 2 }, { thanksGot: 3 }]
];

(async function main() {
  const r = createRunner('titles：称号（アイコン・二つ名）');

  await r.test('初期状態は全員「はじめの一歩」＋いつもの顔', async () => {
    const empty = T.emptyStats();
    const owned = T.unlockedIds(empty);
    assertEqual(T.titleText(T.DEFAULTS), 'はじめの一歩', '二つ名の初期値');
    assertEqual(T.iconEmoji(T.DEFAULTS), '🙂', 'アイコンの初期値');
    T.PART_KEYS.forEach((part) => {
      assert(owned.indexOf(T.DEFAULTS[part]) >= 0, part + ' の初期パーツは何もしなくても持っている');
    });
    // 初期パーツ以外は、何もしていない人には無い
    assertEqual(owned.length, T.PART_KEYS.length, '最初に持っているのは初期パーツだけ（' + owned.join(',') + '）');
  });

  await r.test('パーツのIDが重複していない', async () => {
    // 同じIDが2つあると、片方の条件しか効かない事故になる
    const seen = {};
    T.PART_KEYS.forEach((part) => {
      T.partsOf(part).forEach((p) => {
        assert(!seen[p.id], 'IDが重複していない：' + p.id);
        seen[p.id] = true;
        assert(p.label, p.id + ' に名前がある');
        assert(p.hint, p.id + ' に「どうすれば手に入るか」が書いてある');
        assert(p.free || typeof p.need === 'function', p.id + ' は初期か、条件を持っている');
      });
    });
  });

  await r.test('条件表どおりに手に入る（境界の手前では手に入らない）', async () => {
    CASES.forEach(([id, cassette, before, after]) => {
      assert(!has(stats(cassette, before), id), id + '：条件の手前ではまだ手に入らない');
      assert(has(stats(cassette, after), id), id + '：条件を満たすと手に入る');
    });
    // 条件表がカタログを網羅していること（追加したのに確かめ忘れる事故を防ぐ）
    const covered = {};
    CASES.forEach(([id]) => { covered[id] = true; });
    T.PART_KEYS.forEach((part) => {
      T.partsOf(part).forEach((p) => {
        if (p.free) return;
        assert(covered[p.id], p.id + ' の条件が、このテストで確かめられている');
      });
    });
  });

  await r.test('あるカセットの条件は、別のカセットの成績では満たされない', async () => {
    const wolfOnly = stats('jinro', { plays: 50, wins: 50, villageWins: 9, wolfWins: 9, foxWins: 9 });
    assert(!has(wolfOnly, 'icon-are-1'), '人狼をいくら遊んでも、あれそれのアイコンは出ない');
    assert(!has(wolfOnly, 'joiner-naru-are'), 'あれそれの接続詞も出ない');
    const areOnly = stats('aresore', { plays: 50, wins: 50 });
    assert(!has(areOnly, 'icon-wolf-1'), 'あれそれをいくら遊んでも、人狼のアイコンは出ない');
    assert(!has(areOnly, 'joiner-naru-wolf'), '人狼の接続詞も出ない');
  });

  await r.test('一度手に入れたものは、成績が減っても消えない', async () => {
    const owned = T.mergeUnlocked([], stats('jinro', { plays: 10 }));
    assert(owned.indexOf('icon-wolf-10') >= 0, 'いったんベテランの証を持つ');
    // 記録がリセットされても、持っているものは残る
    const later = T.mergeUnlocked(owned, T.emptyStats());
    assert(later.indexOf('icon-wolf-10') >= 0, '成績が0に戻っても持ったまま');
    assert(later.indexOf('icon-wolf-1') >= 0, '途中で手に入れたものも残る');
  });

  await r.test('新しく手に入ったぶんだけを取り出せる', async () => {
    const before = T.mergeUnlocked([], stats('jinro', { plays: 1 }));
    const after = T.mergeUnlocked(before, stats('jinro', { plays: 10 }));
    const got = T.newlyUnlocked(before, after);
    assertEqual(got.length, 1, '増えたのは1つだけ（' + got.join(',') + '）');
    assertEqual(got[0], 'icon-wolf-10', 'ベテランの証');
    assertEqual(T.newlyUnlocked(after, after).length, 0, '何も増えなければ空');
  });

  await r.test('目録に無いIDは持ち物に混ざらない', async () => {
    const owned = T.mergeUnlocked(['icon-nonexistent', 'icon-wolf-1'], stats('jinro', { plays: 1 }));
    assertEqual(owned.indexOf('icon-nonexistent'), -1, '知らないIDは捨てる');
    assert(owned.indexOf('icon-wolf-1') >= 0, '知っているIDは残る');
  });

  await r.test('持っていないものを装備していたら、初期に戻す', async () => {
    const owned = T.unlockedIds(T.emptyStats());
    const eq = T.normalizeEquipped({ icon: 'icon-wolf-10', first: 'first-senri', joiner: 'joiner-naru-wolf', last: 'last-borei' }, owned);
    assertEqual(eq.icon, T.DEFAULTS.icon, '持っていないアイコンは初期に戻る');
    assertEqual(T.titleText(eq), 'はじめの一歩', '持っていない二つ名も初期に戻る');
    // 持っていれば、そのまま使える
    const rich = T.mergeUnlocked([], stats('jinro', { plays: 10, seerHits: 2, wins: 5, mediumHits: 2 }));
    const eq2 = T.normalizeEquipped({ icon: 'icon-wolf-10', first: 'first-senri', joiner: 'joiner-naru-wolf', last: 'last-borei' }, rich);
    assertEqual(eq2.icon, 'icon-wolf-10', '持っているアイコンは使える');
    assertEqual(T.titleText(eq2), '千里眼なる亡霊', '3つのパーツがつながる');
    assertEqual(T.iconEmoji(eq2), '🐺', 'アイコンの絵も出る');
  });

  await r.test('壊れた保存データでも落ちない', async () => {
    assertEqual(T.titleText(null), 'はじめの一歩', '装備が無くても初期の名乗りになる');
    assertEqual(T.iconEmoji(undefined), '🙂', 'アイコンも初期になる');
    assertEqual(T.unlockedIds(null).length, T.PART_KEYS.length, '成績が無くても初期パーツは持っている');
    assertEqual(T.unlockedIds({ jinro: 'こわれている' }).length, T.PART_KEYS.length, '型が違っても落ちない');
    const s = T.normalizeStats({ jinro: { plays: -5, wins: 'x', unknown: 9 } });
    assertEqual(s.jinro.plays, 0, 'マイナスは0に直す');
    assertEqual(s.jinro.wins, 0, '数でないものは0に直す');
    assertEqual(s.aresore.plays, 0, '足りないカセットは0で埋める');
  });

  // ---- 第32弾-F：季節イベント ----

  await r.test('季節イベント：期間の判定は月日で決まり、境界の外は完全に無効', async () => {
    const d = (y, m, dd) => new Date(y, m - 1, dd, 12);
    assertEqual(T.seasonFor(d(2026, 6, 30)), null, '6/30はまだ始まっていない');
    assertEqual((T.seasonFor(d(2026, 7, 1)) || {}).id, 'summer', '7/1から夏まつり');
    assertEqual((T.seasonFor(d(2026, 8, 31)) || {}).id, 'summer', '8/31まで夏まつり');
    assertEqual(T.seasonFor(d(2026, 9, 1)), null, '9/1にはもう終わっている');
    // 年が変わっても同じ期間で自動的に始まる（毎年の夏が同じ記念になる）
    assertEqual((T.seasonFor(d(2031, 8, 10)) || {}).id, 'summer', '来年以降の夏も同じ');
  });

  await r.test('季節イベント：夏の称号は「期間中に集まって遊んだ数」だけで手に入る', async () => {
    assert(!has(stats('season', { summerPlays: 0 }), 'icon-season-summer'), '遊んでいなければ手に入らない');
    assert(has(stats('season', { summerPlays: 1 }), 'icon-season-summer'), '1回集まれば記念のアイコン');
    assert(!has(stats('season', { summerPlays: 2 }), 'first-natsu'), '2回では二つ名はまだ');
    assert(has(stats('season', { summerPlays: 3 }), 'first-natsu'), '3回で「なつまつりの」');
    assert(!has(stats('season', { summerPlays: 9 }), 'icon-season-hanabi'), '回数だけでは花火は出ない');
    assert(has(stats('season', { summerCrowd: 1 }), 'icon-season-hanabi'), '5人以上で集まると花火');
  });

  await r.test('季節イベント：一度手に入れたパーツは、期間が終わっても永久に残る', async () => {
    const un = T.mergeUnlocked([], stats('season', { summerPlays: 3, summerCrowd: 1 }));
    assert(un.indexOf('first-natsu') >= 0, 'まず手に入れる');
    // 期間が終わる＝もう数えられないだけ。成績が空でも、獲得済みの一覧からは消えない
    const later = T.mergeUnlocked(un, T.emptyStats());
    assert(later.indexOf('first-natsu') >= 0 && later.indexOf('icon-season-summer') >= 0
      && later.indexOf('icon-season-hanabi') >= 0, 'あの夏の記念は消えない');
  });

  await r.test('サバイバル：ラウンドを最下位で迎えた人だけが「最下位候補」になる', async () => {
    const P = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assertEqual(T.lastPlaceIds(P, { a: 1, b: 3, c: 3 }).join(','), 'a', '一番遅れている人');
    assertEqual(T.lastPlaceIds(P, { a: 1, b: 1, c: 3 }).sort().join(','), 'a,b', '並んでいれば両方');
    // 全員同点の回で印を付けると、優勝者が必ず不屈になってしまう
    assertEqual(T.lastPlaceIds(P, { a: 0, b: 0, c: 0 }).length, 0, '全員並んでいるなら誰も候補にしない');
    assertEqual(T.lastPlaceIds(P, {}).length, 0, 'まだ点が無い回（全員0）も同じ');
    // 脱落して1人になったら、もう順位を争っていない
    assertEqual(T.lastPlaceIds([{ id: 'a' }], { a: 0 }).length, 0, '1人だけなら候補なし');
    assertEqual(T.lastPlaceIds(null, null).length, 0, '空でも落ちない');
    // マイナスや欠けた値でも壊れない
    assertEqual(T.lastPlaceIds(P, { a: 2, b: 5 }).join(','), 'c', '点の記録が無い人は0点として扱う');
  });

  r.finish();
})();
