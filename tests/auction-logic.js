// tests/auction-logic.js — 相場オークションのルール層（第38弾で作り直し）
//
// 見張るのは、この遊びが成り立つための約束：
//   ① 相場は「みんなが買った回数」で決まる（運ではない）
//   ② 誰も買わなかった系統を育てる逆転の道が、数の上で本当に開いている
//   ③ 落札できなかった人は何も失わない
//   ④ 残チップは少しだけ点になる（最終ラウンドにもブレーキが残る）
//   ⑤ 開場で宣言した内訳と、実際に並ぶ品質が一致する（嘘をつかない）
//   ⑥ 段階ヒントが、全員に同じ順番・同じ中身で開く
//
// 落とし穴10の型を避けるため、**守りたい約束は具体の数字で書く**。
// RULES の値をそのまま検査に持ち込むと、定数を変えた瞬間に検査も一緒に動いて素通りする。

const A = require('../public/js/auction-logic');
const Items = require('../public/js/auction-items');
const { createRunner, assert, assertEqual } = require('./harness');

// 決まった順で引く乱数（同じ並びを何度でも作れる）
function seeded(seed) {
  let s = seed || 1;
  return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

(async function main() {
  const r = createRunner('auction-logic：相場オークションのルール');

  // ---------- 設定 ----------

  await r.test('設定は範囲に収める。おかしな値でも遊べる形になる', async () => {
    const c = A.normalizeConfig({ mode: 'open', rounds: 99, previewSec: 5 });
    assertEqual(c.mode, 'open', 'せり上げ式');
    assertEqual(c.rounds, 3, 'ラウンドは3が上限');
    assertEqual(c.previewSec, 30, '下見は30秒が下限');
    const d = A.normalizeConfig({});
    assertEqual(d.mode, 'sealed', '既定は秘密入札');
    assertEqual(d.rounds, 2, '既定は2ラウンド');
    assertEqual(d.previewSec, 60, '既定の下見は60秒');
    const e = A.normalizeConfig({ rounds: 'あ', previewSec: null });
    assertEqual(e.rounds, 2, '数でなくても既定に落ちる');
    assertEqual(e.previewSec, 60, '同上');
  });

  // ---------- 品物を並べる ----------

  await r.test('開場で宣言した内訳どおりの品質が並ぶ（数で嘘をつかない）', async () => {
    // ここが崩れると、開場の「上物2・並物3・偽物1」が嘘になる。
    // 遊ぶ人は消去法をその宣言に賭けているので、これは一番やってはいけない
    for (let seed = 1; seed <= 30; seed++) {
      const items = A.buildRound({}, seeded(seed));
      assertEqual(items.length, 6, 'seed' + seed + '：6品ならぶ');
      const q = items.map((x) => x.quality);
      assertEqual(q.filter((x) => x === 'fine').length, 2, 'seed' + seed + '：上物2');
      assertEqual(q.filter((x) => x === 'plain').length, 3, 'seed' + seed + '：並物3');
      assertEqual(q.filter((x) => x === 'fake').length, 1, 'seed' + seed + '：偽物1');
    }
  });

  await r.test('品番号は1から6。順番も開場から見えている', async () => {
    const items = A.buildRound({}, seeded(7));
    assertEqual(items.map((x) => x.no).join(','), '1,2,3,4,5,6', '1から順に振られる');
  });

  await r.test('同じ見た目の品が、1ラウンドに2つ並ばない', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const looks = A.buildRound({}, seeded(seed)).map((x) => x.look);
      assertEqual(new Set(looks).size, 6, 'seed' + seed + '：見た目が全部ちがう');
    }
  });

  await r.test('前のラウンドで出た品は、なるべく避ける', async () => {
    const first = A.buildRound({}, seeded(3));
    const used = {};
    first.forEach((x) => { used[x.look] = true; });
    const second = A.buildRound(used, seeded(4));
    const again = second.filter((x) => used[x.look]);
    assertEqual(again.length, 0, '2ラウンド目に同じ品が出ない');
  });

  await r.test('ヒントと正体が、その品の品質のものになっている（矛盾しない）', async () => {
    // 門8「ヒントが品質と矛盾しない」。品質ごとに書き分けたデータを、
    // 並べる時に取り違えていないかを見る
    const items = A.buildRound({}, seeded(11));
    items.forEach((it) => {
      const src = Items.ITEMS.find((x) => x.look === it.look);
      assert(src, it.look + ' が品物の一覧にある');
      assertEqual(it.steps.join('｜'), src.q[it.quality].steps.join('｜'),
        it.look + '：段階ヒントが、その品質のもの');
      assertEqual(it.reveal, src.q[it.quality].reveal, it.look + '：正体が、その品質のもの');
    });
  });

  // ---------- ヒントの開き方 ----------

  await r.test('段階ヒントは、時間で順に開く（見た目→①→②で打ち止め）', async () => {
    const it = A.buildRound({}, seeded(5))[0];
    assertEqual(A.hintsVisible(it, 0).length, 1, '始めは見た目だけ');
    assertEqual(A.hintsVisible(it, 0)[0], it.look, 'それは見た目の一言');
    assertEqual(A.hintsVisible(it, 11).length, 1, '11秒ではまだ増えない');
    assertEqual(A.hintsVisible(it, 12).length, 2, '12秒で1つ開く');
    assertEqual(A.hintsVisible(it, 12)[1], it.steps[0], '開くのは1つ目のヒント');
    assertEqual(A.hintsVisible(it, 24).length, 3, '24秒で2つ目も開く');
    assertEqual(A.hintsVisible(it, 24)[2], it.steps[1], '順番どおり');
    assertEqual(A.hintsVisible(it, 600).length, 3, 'それ以上は増えない（打ち止め）');
    assertEqual(A.hintsVisible(null, 30).length, 0, '品が無ければ空');
  });

  await r.test('同じ経過時間なら、誰が見ても同じヒントになる', async () => {
    // 「全員に同時に届く」の土台。時間だけで決まる＝人によって違いようがない
    const it = A.buildRound({}, seeded(6))[0];
    for (const t of [0, 5, 12, 20, 24, 99]) {
      assertEqual(A.hintsVisible(it, t).join('｜'), A.hintsVisible(it, t).join('｜'),
        t + '秒：何度呼んでも同じ');
    }
  });

  // ---------- 相場 ----------

  await r.test('相場は全系統1から始まり、落札のたびにその系統だけ上がる', async () => {
    const m = A.newMarket();
    Items.KINDS.forEach((k) => assertEqual(m[k.id], 1, k.label + ' は1から'));
    A.bumpMarket(m, 'tsubo');
    A.bumpMarket(m, 'tsubo');
    assertEqual(m.tsubo, 3, 'つぼが2回落札されて3');
    assertEqual(m.egaku, 1, '買われていない系統は動かない');
    A.bumpMarket(m, 'しらない系統');
    assertEqual(Object.keys(m).length, 3, '知らない系統では増えない');
  });

  await r.test('相場が3以上で「熱い」（大画面の合図の境目）', async () => {
    const m = A.newMarket();
    assertEqual(A.isHot(m, 'tsubo'), false, '1では熱くない');
    A.bumpMarket(m, 'tsubo');
    assertEqual(A.isHot(m, 'tsubo'), false, '2でもまだ');
    A.bumpMarket(m, 'tsubo');
    assertEqual(A.isHot(m, 'tsubo'), true, '3で熱くなる');
  });

  // ---------- 得点 ----------

  await r.test('得点は「品質値 × その系統の最終相場」', async () => {
    const m = { tsubo: 3, egaku: 1, kagayaki: 2 };
    assertEqual(A.itemPoints({ kind: 'tsubo', quality: 'fine' }, m), 9, '上物×相場3で9点');
    assertEqual(A.itemPoints({ kind: 'egaku', quality: 'fine' }, m), 3, '同じ上物でも、相場1なら3点');
    assertEqual(A.itemPoints({ kind: 'kagayaki', quality: 'plain' }, m), 2, '並物×相場2で2点');
    assertEqual(A.itemPoints({ kind: 'tsubo', quality: 'fake' }, m), -6, '偽物は相場が育つほど痛い');
    assertEqual(A.itemPoints(null, m), 0, '品が無ければ0');
  });

  await r.test('逆転の道：誰も買わなかった系統を、ひとりで育てられる', async () => {
    // この遊びの芯。**安く買い集めて自分で相場を作る**が、数の上で本当に成り立つか。
    // みんなが群がった系統で上物を1つ買った人と、
    // 見向きもされない系統を3つ買って自分で育てた人を比べる
    const market = A.newMarket();
    // つぼ：3人が群がって3つ落札 → 相場4
    A.bumpMarket(market, 'tsubo'); A.bumpMarket(market, 'tsubo'); A.bumpMarket(market, 'tsubo');
    // えがく：ひとりが3つ買い集めた → 相場4
    A.bumpMarket(market, 'egaku'); A.bumpMarket(market, 'egaku'); A.bumpMarket(market, 'egaku');
    assertEqual(market.tsubo, 4, 'つぼの相場は4');       // 型(b)：条件が本当に作れている
    assertEqual(market.egaku, 4, 'えがくの相場も4');

    const 群がった人 = A.scoreOf([{ kind: 'tsubo', quality: 'fine' }], market, 0);
    const 育てた人 = A.scoreOf([
      { kind: 'egaku', quality: 'plain' },
      { kind: 'egaku', quality: 'plain' },
      { kind: 'egaku', quality: 'fine' }
    ], market, 0);
    assertEqual(群がった人.total, 12, '上物1つ×相場4で12点');
    assertEqual(育てた人.total, 20, '並物2つ＋上物1つ×相場4で20点');
    assert(育てた人.total > 群がった人.total,
      '安物を買い集めて相場を育てる道が、ちゃんと勝ちうる');
  });

  await r.test('残チップは3枚で1点。貯め込むだけでは勝てない', async () => {
    assertEqual(A.pointsFromChips(0), 0, '0枚は0点');
    assertEqual(A.pointsFromChips(2), 0, '2枚では点にならない');
    assertEqual(A.pointsFromChips(3), 1, '3枚で1点');
    assertEqual(A.pointsFromChips(20), 6, '20枚で6点');
    assertEqual(A.pointsFromChips(-5), 0, 'マイナスでも0止まり');
    // 何も買わずに全部残した人が、上物を1つ買った人に勝てないこと
    const 貯めた人 = A.scoreOf([], A.newMarket(), 26);      // 初期20＋収入6
    const 買った人 = A.scoreOf([{ kind: 'tsubo', quality: 'fine' }], { tsubo: 4 }, 0);
    assertEqual(貯めた人.total, 8, '26枚を貯め込んで8点');
    assertEqual(買った人.total, 12, '育った系統の上物1つで12点');
    assert(買った人.total > 貯めた人.total, '買わない人が勝つ形にはなっていない');
  });

  await r.test('得点の内訳が出る（なぜその点なのかを、結果画面で言える）', async () => {
    const s = A.scoreOf([{ kind: 'tsubo', quality: 'fine' }], { tsubo: 2 }, 7);
    assertEqual(s.fromItems, 6, '品物ぶん6点');
    assertEqual(s.fromChips, 2, '残7枚で2点');
    assertEqual(s.total, 8, '合わせて8点');
    assertEqual(s.items.length, 1, '品物ごとの内訳もある');
    assertEqual(s.items[0].points, 6, 'その品が何点だったか分かる');
  });

  // ---------- 入札 ----------

  await r.test('せり上げ式：いまの最高額より上でないと出せない', async () => {
    assertEqual(A.canBid('open', 5, 20, null).ok, true, '誰も出していなければ出せる');
    assertEqual(A.canBid('open', 0, 20, null).ok, false, '0では入札にならない');
    assertEqual(A.canBid('open', 5, 20, { amount: 5 }).ok, false, '同額では上回れない');
    assertEqual(A.canBid('open', 6, 20, { amount: 5 }).ok, true, '1つ上なら出せる');
    assertEqual(A.canBid('open', 5, 20, { amount: 5 }).reason, 'notHigher', '理由が分かる');
  });

  await r.test('持っていない額は出せない（端末の数字を信じない）', async () => {
    assertEqual(A.canBid('open', 21, 20, null).ok, false, '持ちチップを超えられない');
    assertEqual(A.canBid('open', 21, 20, null).reason, 'tooMuch', '理由が分かる');
    assertEqual(A.canBid('sealed', 21, 20, null).ok, false, '秘密入札でも同じ');
    assertEqual(A.canBid('sealed', -1, 20, null).ok, false, 'マイナスは出せない');
    assertEqual(A.canBid('sealed', 'あ', 20, null).ok, false, '数でないものは出せない');
  });

  await r.test('秘密入札：0は「降りる」。要らない品に値をつけさせない', async () => {
    assertEqual(A.canBid('sealed', 0, 20, null).ok, true, '0で出せる');
    assertEqual(A.settleSealed([{ id: 'a', amount: 0, at: 1 }]), null, '0だけなら落札者はいない');
  });

  await r.test('秘密入札：いちばん高い人。同額なら先に出した人', async () => {
    // ランダムにすると「なぜ負けたか」を誰にも説明できない
    const w = A.settleSealed([
      { id: 'a', amount: 5, at: 200 },
      { id: 'b', amount: 5, at: 100 },
      { id: 'c', amount: 4, at: 50 }
    ]);
    assertEqual(w.winnerId, 'b', '同額なら先に出した b');
    assertEqual(w.amount, 5, '額は5');
    assertEqual(A.settleSealed([]), null, '誰も出さなければ落札者はいない');
  });

  await r.test('半額チケットの端数は切り上げ（奇数だけ得をしない）', async () => {
    assertEqual(A.payFor(10, false), 10, 'ふつうは額そのまま');
    assertEqual(A.payFor(10, true), 5, '10の半分は5');
    assertEqual(A.payFor(7, true), 4, '7の半分は切り上げて4');
    assertEqual(A.payFor(1, true), 1, '1は1のまま');
    assertEqual(A.payFor(0, true), 0, '0は0');
  });

  await r.test('落札できなかった人は、何も失わない', async () => {
    // 第31弾から引き継いだ、この遊びの土台。
    // 負けた人の持ち物に触る計算が、そもそも存在しないことを見る
    const w = A.settleSealed([
      { id: 'a', amount: 9, at: 1 }, { id: 'b', amount: 8, at: 2 }
    ]);
    assertEqual(w.winnerId, 'a', 'aが落札');
    // 負けたbについて、払う額を計算する関数がそもそも呼ばれる形になっていない
    assertEqual(A.payFor(0, false), 0, '払わない人の支払いは0');
    const s = A.scoreOf([], { tsubo: 3 }, 20);
    assertEqual(s.fromItems, 0, '何も落札しなければ品物の点は0（マイナスにならない）');
  });

  // ---------- 収入 ----------

  await r.test('使いすぎた人は、次のラウンドで自動的に息切れする', async () => {
    assertEqual(A.incomeFor(0), 6, '使わなければ6枚');
    assertEqual(A.incomeFor(9), 6, '9枚までは6枚');
    assertEqual(A.incomeFor(10), 3, '10枚使ったら3枚');
    assertEqual(A.incomeFor(30), 3, 'それ以上でも3枚（追い打ちはしない）');
  });

  // ---------- 値踏み予想 ----------

  await r.test('値踏みは当たれば1枚。外しても何も失わない', async () => {
    assertEqual(A.guessReward('fine', 'fine'), 1, '当たれば1枚');
    assertEqual(A.guessReward('fake', 'fine'), 0, '外しても0（減らない）');
    assertEqual(A.guessReward(null, 'fine'), 0, '予想しなくても0（罰なし）');
  });

  // ---------- 順位 ----------

  await r.test('順位：点が多い順。同点なら同順位', async () => {
    const rows = A.rank([
      { id: 'a', score: 5 }, { id: 'b', score: 9 }, { id: 'c', score: 5 }, { id: 'd', score: 1 }
    ]);
    assertEqual(rows.map((x) => x.id).join(','), 'b,a,c,d', '点の多い順');
    assertEqual(rows.map((x) => x.rank).join(','), '1,2,2,4', '同点は同順位（1224方式）');
    assertEqual(A.rank([]).length, 0, '空でも落ちない');
  });

  // ---------- 名場面 ----------

  await r.test('名場面：出せるものが無い時は、無理に何か言わない', async () => {
    assertEqual(A.highlight([]), null, '何も起きていなければ何も言わない');
    assertEqual(A.highlight([{ passed: true }]), null, '流れた品だけでも言わない');
    assertEqual(A.highlight(null), null, '渡されなくても落ちない');
  });

  await r.test('名場面：みんなが偽物と読んだ品を信じて買った人を拾う', async () => {
    const line = A.highlight([
      { no: 3, winner: 'あき', kind: 'tsubo', quality: 'fine', points: 9,
        guesses: [{ guess: 'fake' }, { guess: 'fake' }] },
      { no: 1, winner: 'びび', kind: 'egaku', quality: 'plain', points: 2, guesses: [] }
    ]);
    assert(/あき/.test(line) && /3番/.test(line) && /9点/.test(line),
      '誰が・どの品で・何点かが入る（実際: ' + line + '）');
  });

  await r.test('名場面：ひとりで系統を育てた人も拾う', async () => {
    const h = [1, 2, 3].map((n) => ({
      no: n, winner: 'ちか', kind: 'egaku', quality: 'plain', points: 3, guesses: []
    }));
    const line = A.highlight(h);
    // 系統の名前は正本（auction-items）から引く。ここに書き写すと、
    // 名前を直した日に、実装ではなく検査のほうが赤くなる（落とし穴10-d）
    const egaku = Items.kindById('egaku').label;
    assert(/ちか/.test(line) && line.indexOf(egaku) !== -1,
      'ひとりで集めたことが出る（実際: ' + line + '）');
  });

  // ---------- アイテム ----------

  await r.test('アイテムは3種。ラウンドごとに1つだけ選ぶ', async () => {
    assertEqual(A.POWERS.length, 3, '3種');
    assertEqual(A.RULES.ITEMS_PICK, 1, '選べるのは1つ');
    ['appraise', 'halfticket', 'market'].forEach((id) => {
      const p = A.powerById(id);
      assert(p && p.label && p.icon && p.lead, id + ' に名前・アイコン・説明がある');
    });
    assertEqual(A.powerById('appraise').secretTarget, true,
      '鑑定眼だけ、どの品を見たかを伏せる');
    assertEqual(A.powerById('market').secretTarget, false,
      '相場操作は、どの系統かまで公開する');
  });

  // ---------- 数字の置き場所 ----------

  await r.test('遊びの数字が、ルール層に集まっている', async () => {
    // 「定数は1か所に」。ここに無い数字を他のファイルが持ち始めたら、必ず食い違う
    const need = ['START_CHIPS', 'INCOME', 'INCOME_TIRED', 'TIRED_SPENT', 'CHIPS_PER_POINT',
      'MARKET_START', 'MARKET_STEP', 'MARKET_HOT', 'ITEMS_PER_ROUND',
      'FIRST_BID_BONUS', 'GUESS_REWARD', 'HINT_STEP_SEC', 'HINT_STEPS',
      'MIN_PLAYERS', 'MAX_PLAYERS'];
    need.forEach((k) => {
      assert(typeof A.RULES[k] === 'number', k + ' がルール層にある');
    });
    // 別紙が決めた数字。ここを黙って変えられないように、具体の数で固定する
    assertEqual(A.RULES.START_CHIPS, 20, '初期チップ20');
    assertEqual(A.RULES.INCOME, 6, '基本収入6');
    assertEqual(A.RULES.INCOME_TIRED, 3, '使いすぎたら3');
    assertEqual(A.RULES.TIRED_SPENT, 10, '境目は10枚');
    assertEqual(A.RULES.ITEMS_PER_ROUND, 6, '1ラウンド6品');
    assertEqual(A.RULES.GUESS_REWARD, 1, '値踏み的中は1枚');
    assertEqual(A.RULES.MIN_PLAYERS, 3, '3人から');
    assertEqual(A.RULES.MAX_PLAYERS, 8, '8人まで');
    // 私が決めた数字（理由はルール層のコメントに書いてある）
    assertEqual(A.RULES.CHIPS_PER_POINT, 3, '残チップ3枚で1点');
    assertEqual(A.RULES.FIRST_BID_BONUS, 2, '最初の入札ボーナスは2枚');
    assert(A.RULES.FIRST_BID_BONUS > A.RULES.GUESS_REWARD,
      'ボーナスは値踏みの報酬より大きい');
  });

  await r.test('せり上げ式の持ち時間は、段階ヒントが全部開くだけの長さがある', async () => {
    // 実機で見つけた穴：せり上げ式の「最初の持ち時間」に名前がなく、
    // 延長の値（8秒）を使い回していた。ヒントは12秒ごとに開く約束なので、
    // **誰も入札しない品では、ヒントが1本も開かないまま流れていた**。
    // 「ヒントが増えるほど値が上がる」という遊びの芯が動いていなかった。
    //
    // ここで見るのは数の大小ではなく、**振る舞い**：
    // 最初の持ち時間を使い切った時点で、段階ヒントが何本開いているか。
    // こう書くと、持ち時間を縮めても、ヒントの間隔を延ばしても赤くなる
    const item = A.buildRound({})[0];
    const atEnd = A.hintsVisible(item, A.RULES.OPEN_START_SEC);
    assertEqual(atEnd.length, 1 + A.RULES.HINT_STEPS,
      '持ち時間を使い切る頃には、見た目＋段階ヒスト2本が出そろっている'.replace('ヒスト', 'ント'));
    // 開始の直後は、見た目だけ（先のヒントを最初から見せない）
    assertEqual(A.hintsVisible(item, 0).length, 1, '始まった瞬間は見た目だけ');
    // 延長は「最初の持ち時間」とは別の数（同じ数を使い回すと、上の穴が戻る）
    assert(A.RULES.OPEN_START_SEC !== A.RULES.OPEN_EXTEND_SEC,
      '最初の持ち時間と延長は、別の数として持っている');
  });

  await r.test('せり上げ式：何秒の時点で入札されても、ヒント①が開く前に品が閉じない', async () => {
    // 実機での確認で見つけた続きの穴。延長が8秒だった頃は、
    // 3秒の時点で1人が入札すると品は11秒で閉じ、12秒のヒント①が間に合わなかった。
    // **情報がゼロのまま落札が成立する品**ができると、
    // 「全員が同じ情報を見た上でのタイミング勝負」という核が、その品だけ成り立たない。
    //
    // 見るのは数の大小ではなく振る舞い：入札のあった時刻がいつであっても、
    // 締め切り（入札時刻＋延長）の時点でヒントが1本は開いているか
    const item = A.buildRound({})[0];
    for (let bidAt = 0; bidAt <= A.RULES.OPEN_START_SEC; bidAt++) {
      const closesAt = bidAt + A.RULES.OPEN_EXTEND_SEC;
      const seen = A.hintsVisible(item, closesAt);
      assert(seen.length >= 2,
        bidAt + '秒で入札された品も、閉じる時にはヒントが1本は開いている' +
        '（実際に見えているのは' + seen.length + '本）');
    }
    // 開いたヒントが、木槌と同時ではなく**読める時間だけ**見えていること
    const margin = A.RULES.OPEN_EXTEND_SEC - A.RULES.HINT_STEP_SEC;
    assert(margin >= 2, 'ヒントが開いてから閉じるまで、最低2秒ある（実際:' + margin + '秒）');
  });

  await r.test('6品は、系統が均等に並ぶ（相場が動かない系統を作らない）', async () => {
    // 無作為に6つ取っていた頃は「絵4・輝き2・壺0」のような回が普通に出た。
    // 相場が主役の遊びで、一度も相場が動かない系統ができると、
    // 「放っておかれた系統を安く買う」という芯の戦略がその回に存在しなくなる
    for (let t = 0; t < 40; t++) {
      const round = A.buildRound({});
      const count = {};
      round.forEach((it) => { count[it.kind] = (count[it.kind] || 0) + 1; });
      Items.KINDS.forEach((k) => {
        assertEqual(count[k.id], 2, k.label + ' が2品ある');
      });
    }
  });

  r.finish();
})();
