// tests/falsetrue-room.js — 「False or True」の進行役（指示53）
//
// 本物の進行役（falsetrue-room.js）を、最小の部屋で実際に動かす。
//
// **いちばん重いのは「中身が漏れないこと」**（門Q4）。これは最後に足すのではなく、土台として最初に置く。
//
// ---- なぜ「針を探す」形にしないか ----
// このゲームの秘密は **true / false の1ビット**しかない。
// `JSON.stringify(publicView).indexOf('true')` のような針は、
// JSON のどこにでも現れるので使えない（落とし穴10-d・48-4 の「99 がたまたま並ぶ」と同じ形）。
// 目印を別の値にすり替えると、こんどは**本物と違うものを検査する**ことになる（落とし穴25）。
//
// ---- 代わりに、情報そのものを測る（差分法） ----
//   **中身の並びだけが違う2局を、まったく同じ手順で進める。**
//   最初の開示までのすべての段階で publicView が1バイトも違わなければ、
//   publicView は中身について**何も運んでいない**。
//   符号化しても、圧縮しても、遠回しに入れても破れない——
//   「載せていないつもり」ではなく「載っていないことの証明」になる。
//
//   逆向きも同時に見る（落とし穴20）：開示の瞬間には、**開いた1枚のぶんだけ**違うこと。
//   「一度も出さない」だけを見ていると、出すべき時にも出さない実装が素通りする。

const F = require('../falsetrue-room.js');
const L = require('../public/js/falsetrue-logic.js');
const { createRunner, assert, assertEqual } = require('./harness');

const P = F.PHASE;

/** 本物の進行役を動かすための、最小の部屋（tests/mode-rules.js と同じ形） */
function makeRoom(names) {
  const members = new Map();
  names.forEach((n, i) => members.set('m' + i, {
    id: 'm' + i, name: n, role: 'player', connected: true, readyGame: null
  }));
  return { code: 'FT0001', members, state: { phase: 'lobby', game: null, data: {} } };
}
/** 決まった順で引く乱数（同じ進行を何度でも作れる） */
function seeded(seed) {
  let x = seed || 1;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}
function start(names, opts) {
  const o = opts || {};
  const room = makeRoom(names);
  const res = F.startGame(room, { _rand: seeded(o.seed || 7), talkSec: o.talkSec }, { notify() {} });
  return { room, res };
}
const pv = (room) => F.publicView(room);
const w_ = (room) => room.falsetrue;

/** 締め切りを「今」まで引く（早送り）。持ち時間の数そのものは検査に使わない（落とし穴10-a） */
function rush(room) {
  const w = w_(room);
  if (w.deadline) w.deadline = Date.now() - 1;
  F.advance(room);
}

/** いまの段階を、ふつうに操作して1つ進める */
function step(room, opt) {
  const o = opt || {};
  const w = w_(room);
  if (w.phase === P.PICK) {
    const no = o.pick != null ? o.pick : pv(room).cases[0];
    const r = F.submitAction(room, w.pickerId, null, { pick: no });
    assert(r.ok, 'ケースを選べた');
    if (r.allDone) F.advance(room);
    return;
  }
  if (w.phase === P.PEEK) {
    const r = F.submitAction(room, w.pickerId, null, { seen: true });
    assert(r.ok, '中身を見終われた');
    if (r.allDone) F.advance(room);
    return;
  }
  if (w.phase === P.FACE || w.phase === P.REVEAL) { rush(room); return; }
  if (w.phase === P.TALK) {
    // 切れている人は待たないので、**1人押しただけで切り上がることがある**。
    // 段階が変わったらそこで止める（押せなくなった人を無理に押させない）
    for (const id of [w.pickerId, w.oppId]) {
      if (w.phase !== P.TALK) break;
      const r = F.submitAction(room, id, null, { talkDone: true });
      assert(r.ok, '「話し終わった」を押せた');
      if (r.allDone) F.advance(room);
    }
    return;
  }
  if (w.phase === P.DECIDE) {
    const r = F.submitAction(room, w.oppId, null, o.take ? { take: true } : { keep: true });
    assert(r.ok, '奪う／奪わないを決められた');
    if (r.allDone) F.advance(room);
    return;
  }
  throw new Error('進められない段階：' + w.phase);
}

/** 決着まで通す。take は「毎回どちらを選ぶか」を決める関数 */
function playOut(room, take) {
  let guard = 0;
  while (w_(room).phase !== P.ENDED) {
    if (++guard > 400) throw new Error('決着しないまま止まった（段階:' + w_(room).phase + '）');
    step(room, { take: take ? take(w_(room)) : false });
  }
  return pv(room);
}

(async function main() {
  const r = createRunner('falsetrue-room：False or True の進行役');

  // ================= 始める =================

  await r.test('人数の門番：4人未満は始まらず、8人を超えても始まらない', async () => {
    assertEqual(start(['あ', 'い', 'う']).res.error, 'too_few_players', '3人では始まらない');
    // サーバー側の言い回しは tests/room-edge.js が「〇人以上」で照合している
    assert(/人以上/.test(start(['あ', 'い', 'う']).res.message), '「〇人以上必要です」と返す');
    const 九 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    assertEqual(start(九).res.error, 'too_many_players', '9人では始まらない');
    assertEqual(start(['あ', 'い', 'う', 'え']).res.ok, true, '4人なら始まる');
  });

  await r.test('始まると pick から。ケースの数と内訳が人数どおり（大画面は数えない）', async () => {
    const 表 = [
      { 人: 4, ケース: 4, true: 1 },
      { 人: 5, ケース: 5, true: 1 },
      { 人: 6, ケース: 6, true: 2 },
      { 人: 7, ケース: 7, true: 2 },
      { 人: 8, ケース: 8, true: 2 }
    ];
    表.forEach((行) => {
      const names = Array.from({ length: 行.人 }, (_, i) => '人' + i);
      const { room } = start(names);
      const v = pv(room);
      assertEqual(v.phase, 'pick', 行.人 + '人：pick から始まる');
      assertEqual(v.cases.length, 行.ケース, 行.人 + '人：ケースが ' + 行.ケース + ' 枚ならぶ');
      assertEqual(v.trueTotal, 行.true, 行.人 + '人：true が ' + 行.true + ' 枚');
      // **サーバーが本当にその数を持っているか**まで見る（公開の数字だけ合わせても意味がない）
      assertEqual(w_(room).contents.filter(Boolean).length, 行.true,
        行.人 + '人：中身の正本にも true が ' + 行.true + ' 枚ある');
      assertEqual(w_(room).contents.length, 行.ケース, 行.人 + '人：中身の正本の枚数も合っている');
    });
    assertEqual(表.length, 5, '4〜8人を全部見た');
  });

  await r.test('大画面（role が player でない人）はプレイヤーに数えない', async () => {
    const room = makeRoom(['あ', 'い', 'う', 'え']);
    room.members.set('big', { id: 'big', name: '大画面', role: 'screen', connected: true });
    assertEqual(F.startGame(room, { _rand: seeded(3) }, {}).ok, true, '4人＋大画面で始まる');
    assertEqual(pv(room).cases.length, 4, 'ケースは4枚（大画面ぶんは増えない）');
    assertEqual(F.privateFor(room, 'big'), null, '大画面には秘密を1つも返さない');
  });

  // ================= 秘匿（門Q4・差分法） =================

  await r.test('Q4：中身の並びが違うだけの2局で、開示までの publicView が1バイトも違わない', async () => {
    // 同じ種・同じ手順で2局を進め、**中身の並びだけ**を入れ替える。
    // publicView が中身について何か運んでいれば、必ずここで差が出る
    const A = start(['あき', 'びび', 'ちか', 'でん'], { seed: 11 });
    const B = start(['あき', 'びび', 'ちか', 'でん'], { seed: 11 });
    // 正本を直に入れ替える（検体を作るためだけに触る。実装には試験用の入口を作らない）
    w_(A.room).contents = [true, false, false, false];
    w_(B.room).contents = [false, false, false, true];
    assert(w_(A.room).contents.join() !== w_(B.room).contents.join(), '2局の中身は本当に違う');

    const 見た = [];
    for (let i = 0; i < 4; i++) {
      const 段階 = w_(A.room).phase;
      assertEqual(w_(B.room).phase, 段階, '2局が同じ段階にいる');
      if (段階 === P.REVEAL || 段階 === P.ENDED) break;
      // 時刻だけは実時間で動くので、比べる前に落とす（中身とは関係がない）
      const a = JSON.stringify(pv(A.room), (k, v) => (k === 'remainingMs' ? 0 : v));
      const b = JSON.stringify(pv(B.room), (k, v) => (k === 'remainingMs' ? 0 : v));
      assertEqual(a, b, 段階 + ' の公開スナップショットが、中身に関係なく同じ');
      見た.push(段階);
      step(A.room, { pick: 1, take: false });
      step(B.room, { pick: 1, take: false });
    }
    // **その状況が本当に作れているか**を確かめる（落とし穴10-b：自明に成立させない）
    assertEqual(見た.join('→'), 'pick→peek→face→talk', '開示の手前まで、4つの段階を実際に通った');
  });

  await r.test('Q4 逆向き：開示では「開いた1枚のぶんだけ」違う（隠しっぱなしにもしない）', async () => {
    const A = start(['あき', 'びび', 'ちか', 'でん'], { seed: 11 });
    const B = start(['あき', 'びび', 'ちか', 'でん'], { seed: 11 });
    w_(A.room).contents = [true, false, false, false];
    w_(B.room).contents = [false, false, false, true];
    // 1番のケースを選ぶ → A は true、B は false
    while (w_(A.room).phase !== P.REVEAL) {
      step(A.room, { pick: 1, take: false }); step(B.room, { pick: 1, take: false });
    }
    const a = pv(A.room), b = pv(B.room);
    assertEqual(a.opened['1'], true, 'A の1番は開いて true');
    assertEqual(b.opened['1'], false, 'B の1番は開いて false');
    assert(a.last && b.last, '2局とも結末が出ている');
    assertEqual(a.last.content, true, 'A の結末の中身は true');
    assertEqual(b.last.content, false, 'B の結末の中身は false');
    // 違っているのは「中身に由来するもの」だけで、それ以外はまだ同じ
    assertEqual(a.cases.join(), b.cases.join(), '残りのケースの並びは同じまま');
    assertEqual(a.holderName, b.holderName, '持ち主も同じ');
    assertEqual(a.oppName, b.oppName, '対面の相手も同じ');
    // **開いていない番号は、どちらにも1つも入っていない**
    assertEqual(Object.keys(a.opened).join(), '1', 'A で開いているのは1番だけ');
    assertEqual(Object.keys(b.opened).join(), '1', 'B で開いているのは1番だけ');
  });

  await r.test('Q4：中身を見てよいのは持ち主だけ。相手・他の人・見る前には返さない', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 5 });
    const w = w_(room);
    w.contents = [true, true, true, true];   // 全部 true にしておけば、漏れたら必ず true が見える
    const 持ち主 = w.pickerId;

    // pick の段階では、持ち主にもまだ返さない（まだ選んでいない）
    assertEqual(F.privateFor(room, 持ち主).myContent, null, '選ぶ前は、持ち主にも中身を返さない');
    step(room, { pick: 2 });                  // → peek
    assertEqual(w.phase, P.PEEK, 'peek に入った');
    assertEqual(F.privateFor(room, 持ち主).myContent, true, 'peek に入ったら、持ち主には中身を返す');
    assertEqual(F.privateFor(room, 持ち主).youAre, 'holder', '持ち主は holder と名乗る');

    let 他人 = 0;
    w.playerIds.filter((id) => id !== 持ち主).forEach((id) => {
      assertEqual(F.privateFor(room, id).myContent, null, '持ち主以外には中身を返さない');
      他人++;
    });
    assertEqual(他人, 3, '持ち主以外の3人すべてを見た');   // 型(b)：数を先に主張する

    step(room);                                // → face（相手が決まる）
    assert(w.oppId, '対面の相手が決まった');
    assertEqual(F.privateFor(room, w.oppId).myContent, null, '対面の相手にも中身は渡らない');
    assertEqual(F.privateFor(room, w.oppId).youAre, 'opp', '相手は opp と名乗る');
    assertEqual(JSON.stringify(pv(room)).indexOf('myContent'), -1, '公開スナップショットに myContent が無い');
  });

  await r.test('Q4：奪う／奪わないは、決めた本人にしか見えない', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 9 });
    const w = w_(room);
    while (w.phase !== P.DECIDE) step(room, { pick: pv(room).cases[0] });
    const 相手 = w.oppId, 持ち主 = w.pickerId;
    assertEqual(F.submitAction(room, 相手, null, { take: true }).ok, true, '相手が「奪う」を決めた');
    assertEqual(F.privateFor(room, 相手).myChoice, 'take', '決めた本人には見える');
    assertEqual(F.privateFor(room, 持ち主).myChoice, null, '持ち主には見えない');
    assertEqual(pv(room).choice, undefined, '公開スナップショットには選択そのものが無い');
    assertEqual(JSON.stringify(pv(room)).indexOf('"take"'), -1, '公開スナップショットに take の文字が無い');
  });

  // ================= 結果表（門Q6） =================

  await r.test('Q6：結果表の4通りが、実際の進行役でその通りになる', async () => {
    const 表 = [
      { 選択: '奪う', 中身: true, 決まる: 'opp', 運命: 'alive', 次: 'holder' },
      { 選択: '奪う', 中身: false, 決まる: 'opp', 運命: 'out', 次: 'holder' },
      { 選択: '奪わない', 中身: true, 決まる: 'holder', 運命: 'alive', 次: 'opp' },
      { 選択: '奪わない', 中身: false, 決まる: 'holder', 運命: 'out', 次: 'opp' }
    ];
    const 行 = [];
    表.forEach((t) => {
      const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 21 });
      const w = w_(room);
      w.contents = [t.中身, t.中身, t.中身, t.中身];   // 何番を選んでも同じ中身にする
      while (w.phase !== P.DECIDE) step(room, { pick: pv(room).cases[0] });
      const 持ち主 = w.pickerId, 相手 = w.oppId;
      step(room, { take: t.選択 === '奪う' });          // → reveal

      const 決まった人 = t.決まる === 'opp' ? 相手 : 持ち主;
      const もう一方 = t.決まる === 'opp' ? 持ち主 : 相手;
      assertEqual(w.fate[決まった人], t.運命,
        t.選択 + '×' + t.中身 + '：' + t.決まる + ' が ' + t.運命);
      assertEqual(w.fate[もう一方], undefined,
        t.選択 + '×' + t.中身 + '：もう一方はまだ決まっていない');
      assertEqual(w.pickerId, t.次 === 'holder' ? 持ち主 : 相手,
        t.選択 + '×' + t.中身 + '：次に選ぶのは ' + t.次);
      assertEqual(pv(room).last.fate, t.運命, '結末の札にも同じ運命が出ている');
      行.push(t.選択 + '×' + t.中身);
    });
    assertEqual(行.length, 4, '4通りすべてを、実際の進行役で通した');
  });

  await r.test('選ばれたケースは選択欄へ戻らない（設計メモ 8）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 31 });
    const w = w_(room);
    const 最初 = pv(room).cases.slice();
    step(room, { pick: 3 });
    assertEqual(pv(room).cases.indexOf(3), -1, '選んだ3番は選択欄から消える');
    assertEqual(pv(room).cases.length, 最初.length - 1, '残りは1枚減る');
    while (w.phase !== P.PICK && w.phase !== P.ENDED) step(room);
    assertEqual(pv(room).cases.indexOf(3), -1, '次のラウンドになっても戻ってこない');
  });

  // ================= 終わり（門Q7） =================

  await r.test('Q7：ふつうに遊ぶと必ず「1人残り」で終わり、ラウンド数は人数−1', async () => {
    const 見た = [];
    [4, 5, 6, 7, 8].forEach((n) => {
      const names = Array.from({ length: n }, (_, i) => '人' + i);
      for (let s = 1; s <= 12; s++) {
        const { room } = start(names, { seed: s });
        const v = playOut(room, () => s % 2 === 0);
        assertEqual(v.endReason, 'last', n + '人（種' + s + '）：1人残りで終わる');
        assertEqual(w_(room).history.length, n - 1, n + '人：ラウンド数は ' + (n - 1));
        // 決着の一覧は、全員ぶんそろっている
        assertEqual(v.players.filter((p) => p.fate).length, n, n + '人：全員の運命が決まっている');
        assert(v.survivors.length >= 1, n + '人：生存者が1人以上いる（全員勝ちの形）');
      }
      見た.push(n);
    });
    assertEqual(見た.length, 5, '4〜8人を全部通した');
  });

  await r.test('Q7：ケースが尽きた時も終わる（自然な進行では起きないので、状態を組み立てて通す）', async () => {
    // **着手前に分かっていたこと**（docs/監査_指示53の門.md ②）：
    // 1ラウンドは「ケース1枚」と「確定する人1人」を同時に消すので
    // 「残りケース ≧ 未確定の人数」が崩れず、この終了条件は自然な進行では起きない。
    // 本人の裁定②で**保険として実装する**と決めたので、状態を直に組み立てて通す。
    // 証拠の質を偽らないため、この検査の名前に「組み立てて」と書いてある
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 4 });
    const w = w_(room);
    w.remaining = [];                                  // ケースを尽きさせる
    F.advance(room);
    assertEqual(w.phase, P.ENDED, 'ケースが尽きたら終わる');
    assertEqual(pv(room).endReason, 'cases', '終わった理由は「ケース尽き」');
    assertEqual(pv(room).survivors.length, 4, '残っていた人は全員生存（運が悪いだけの人を罰しない）');
    pv(room).players.forEach((p) => assertEqual(p.fate, 'alive', p.name + ' は生存'));
  });

  await r.test('②の不変量：通しのあいだ「残りケース ≧ 未確定の人数」が一度も崩れない', async () => {
    // ②の理由そのものを見張る。崩れる日が来たら、ケース尽きが現実の経路になる
    let 測った = 0;
    [4, 6, 8].forEach((n) => {
      const names = Array.from({ length: n }, (_, i) => '人' + i);
      for (let s = 1; s <= 8; s++) {
        const { room } = start(names, { seed: s });
        let guard = 0;
        while (w_(room).phase !== P.ENDED) {
          if (++guard > 400) throw new Error('決着しない');
          const w = w_(room);
          const 未確定 = F.undecidedIds(room).length;
          // 持っている1枚は remaining から抜けているので、数え直して比べる
          const 手持ち = w.heldNo != null ? 1 : 0;
          assert(w.remaining.length + 手持ち >= 未確定,
            n + '人：残り' + (w.remaining.length + 手持ち) + ' ≧ 未確定' + 未確定);
          測った++;
          step(room, { take: s % 3 === 0 });
        }
      }
    });
    assert(測った > 100, '十分な回数を測った（実際:' + 測った + '回）');
  });

  // ================= 途中退室（門Q8） =================

  await r.test('Q8-a：選ぶ人が抜けたら、次の人へ進む（ケースは減らない）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 13 });
    const w = w_(room);
    const 抜ける = w.pickerId;
    const 枚数 = pv(room).cases.length;
    room.members.delete(抜ける);                      // 退室
    assertEqual(F.isAllDone(room), true, '待っている人が居なくなったので、芯が進める');
    F.advance(room);
    assertEqual(w.phase, P.PICK, 'また pick から（詰まらない）');
    assert(w.pickerId && w.pickerId !== 抜ける, '別の人が選ぶ側になった');
    assertEqual(pv(room).cases.length, 枚数, 'まだ選んでいないので、ケースは減らない');
    assertEqual(w.fate[抜ける], undefined, '抜けた人は、生存でも脱落でもない');
    assertEqual(pv(room).players.find((p) => p.id === 抜ける).gone, true, '抜けたことは分かる');
    assertEqual(playOut(room, () => false).endReason, 'last', '最後まで詰まらずに終わる');
  });

  await r.test('Q8-b：中身を見た人が抜けたら、そのケースは選択欄に戻らず消える（2-8）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 17 });
    const w = w_(room);
    step(room, { pick: 2 });                          // → peek。2番を持っている
    assertEqual(w.phase, P.PEEK, 'peek にいる');
    const 抜ける = w.pickerId;
    room.members.delete(抜ける);
    assertEqual(F.isAllDone(room), true, '見ている人が居なくなったので、芯が進める');
    F.advance(room);
    assertEqual(pv(room).cases.indexOf(2), -1, '2番は選択欄に戻ってこない');
    assertEqual(pv(room).discarded.join(), '2', '消えたケースとして数えられている');
    assertEqual(w.phase, P.PICK, '次の人の pick に進んだ（詰まらない）');
    assertEqual(playOut(room, () => true).endReason, 'last', '最後まで詰まらずに終わる');
  });

  await r.test('Q8-c：対面の相手が抜けたら対面は流れ、持ち主はケースを持ったまま(2-8)', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 23 });
    const w = w_(room);
    step(room, { pick: 4 });                          // pick → peek
    step(room);                                       // peek → face
    const 持ち主 = w.pickerId, 抜ける = w.oppId;
    assert(抜ける, '対面の相手がいる');
    room.members.delete(抜ける);
    assertEqual(F.isAllDone(room), true, '対面の片方が居なくなったので、芯が進める');
    F.advance(room);
    assertEqual(w.pickerId, 持ち主, '持ち主はそのまま');
    assertEqual(w.heldNo, 4, 'ケースを持ったまま（4番を持ち続けている）');
    assertEqual(pv(room).discarded.join(), '', 'このケースは消えない');
    assert(w.oppId && w.oppId !== 抜ける, '別の相手と対面し直す');
    assertEqual(w.phase, P.FACE, '対面からやり直す');
    assertEqual(playOut(room, () => false).endReason, 'last', '最後まで詰まらずに終わる');
  });

  await r.test('Q8：抜けた人は、結果発表の生存者にも脱落者にも入らない', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん', 'えみ'], { seed: 29 });
    const 抜ける = w_(room).pickerId;
    room.members.delete(抜ける);
    F.advance(room);
    const v = playOut(room, () => false);
    assertEqual(v.survivors.filter((s) => s.id === 抜ける).length, 0, '生存者に入らない');
    assertEqual(w_(room).fate[抜ける], undefined, '脱落にもならない');
    const 記録 = F.resultView(room);
    assertEqual(記録.players.find((p) => p.id === 抜ける).gone, true, '記録には「抜けた」と残る');
  });

  await r.test('全員が一度に切れても部屋は壊れない。戻ってきたら同じ段階から続けられる（Q9）', async () => {
    // **ここで決着させない**のは意図（falsetrue-room.js の isAllDone のコメント）。
    // 電波が一度に切れただけで部屋を壊すと、戻る場所が無くなる。
    // 止まったままにならないのは、どの段階にも締め切りがあるから
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 33 });
    step(room, { pick: 2 });                       // → peek。2番を持っている
    const 持ち主 = w_(room).pickerId;
    room.members.forEach((m) => { m.connected = false; });
    assertEqual(F.isAllDone(room), false, '誰も繋がっていない部屋は、あえて片付けない');
    assertEqual(w_(room).phase, P.PEEK, '段階はそのまま残っている');

    // 開き直し：戻ってきた人には、いまの段階と、自分の秘密がそのまま返る
    room.members.get(持ち主).connected = true;
    const mine = F.privateFor(room, 持ち主);
    assertEqual(mine.phase, P.PEEK, '戻ってきた人には、いまの段階が返る');
    assertEqual(typeof mine.myContent, 'boolean', '**持ち主には、中身がそのまま返る**');
    assertEqual(mine.youAre, 'holder', '自分が持ち主だと分かる');
    // 戻ってきていない他の人に、中身は渡らないまま
    w_(room).playerIds.filter((id) => id !== 持ち主).forEach((id) => {
      assertEqual(F.privateFor(room, id).myContent, null, '開き直しても、他の人には中身が渡らない');
    });
    assertEqual(playOut(room, () => false).endReason, 'last', 'そのまま最後まで遊べる');
  });

  // ================= 話し合いの早期終了（本人の裁定④） =================

  await r.test('話し合いは、対面の2人がそろって押した時だけ切り上がる', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 41 });
    const w = w_(room);
    while (w.phase !== P.TALK) step(room, { pick: pv(room).cases[0] });
    const 持ち主 = w.pickerId, 相手 = w.oppId;

    const 片方 = F.submitAction(room, 相手, null, { talkDone: true });
    assertEqual(片方.ok, true, '相手は押せる');
    assertEqual(片方.allDone, false, '**片方だけでは切り上がらない**（持ち主には押さない自由がある）');
    assertEqual(w.phase, P.TALK, 'まだ話し合いのまま');
    assertEqual(pv(room).talkReady.join(), 相手, '押した人は、押したと分かる');

    // 対面していない人は押せない
    const よそ者 = w.playerIds.find((id) => id !== 持ち主 && id !== 相手);
    assertEqual(F.submitAction(room, よそ者, null, { talkDone: true }).error, 'not_facing',
      '対面していない人は押せない');

    const 両方 = F.submitAction(room, 持ち主, null, { talkDone: true });
    assertEqual(両方.allDone, true, '2人そろったら切り上がる');
    F.advance(room);
    assertEqual(w.phase, P.DECIDE, '決める段階に進む');
  });

  await r.test('締め切りが来れば、誰も押さなくても止まらない（押し忘れ・寝落ちで詰まらない）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 43 });
    const w = w_(room);
    const 通った = [];
    let guard = 0;
    // **一度も操作せず、締め切りだけで決着まで行けること**
    while (w.phase !== P.ENDED) {
      if (++guard > 400) throw new Error('決着しないまま止まった（段階:' + w.phase + '）');
      通った.push(w.phase);
      rush(room);
    }
    assert(通った.indexOf(P.PICK) !== -1, '選ぶ段階も締め切りで抜けた');
    assert(通った.indexOf(P.DECIDE) !== -1, '決める段階も締め切りで抜けた');
    assertEqual(pv(room).endReason, 'last', '決着している');
    // 既定は「いちばん小さい番号」と「奪わない」
    assertEqual(w.history[0].no, 1, '選ばなかった人には、いちばん小さい番号が渡る');
    assertEqual(w.history[0].taken, false, '決めなかった人は「奪わない」になる（1:3 なので素の判断）');
  });

  // ================= 端末を信じない =================

  await r.test('端末が出す番号や、他人になりすました操作は断る', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 47 });
    const w = w_(room);
    const 選ぶ人 = w.pickerId;
    const よそ者 = w.playerIds.find((id) => id !== 選ぶ人);

    assertEqual(F.submitAction(room, よそ者, null, { pick: 1 }).error, 'not_picker',
      '選ぶ人でない人は選べない');
    [0, -1, 99, 1.5, null, 'いち'].forEach((n) => {
      assertEqual(F.submitAction(room, 選ぶ人, null, { pick: n }).error, 'unknown_case',
        JSON.stringify(n) + ' は残っている番号ではないので断る');
    });
    assertEqual(F.submitAction(room, 選ぶ人, null, { seen: true }).error, 'not_peek',
      'まだ選んでいないのに「見た」は通らない');
    assertEqual(F.submitAction(room, 選ぶ人, null, { take: true }).error, 'not_decide',
      '段階の外で「奪う」は通らない');
    assertEqual(F.submitAction(room, 'よその人', null, { pick: 1 }).error, 'not_player',
      'その部屋のプレイヤーでなければ何も通らない');

    // **二度選べない。**通すと、1枚目が誰の手にも残らないまま静かに消える
    assertEqual(F.submitAction(room, 選ぶ人, null, { pick: 2 }).ok, true, '2番を選べた');
    assertEqual(F.submitAction(room, 選ぶ人, null, { pick: 3 }).error, 'already_picked',
      '選んだあとに別の番号を押しても通らない');
    assertEqual(w.heldNo, 2, '持っているのは最初に選んだ2番のまま');
    assertEqual(pv(room).cases.indexOf(3), 1, '3番は選択欄に残っている（静かに消えていない）');
    assertEqual(pv(room).cases.length + 1, 4, '消えたケースが1枚も無い（持っている1枚＋残り3枚）');
  });

  await r.test('決まった人は、以後のラウンドで選ぶ側にも相手にもならない（設計メモ：そこで上がり）', async () => {
    let 確かめた = 0;
    for (let s = 1; s <= 10; s++) {
      const { room } = start(['あき', 'びび', 'ちか', 'でん', 'えみ', 'おと'], { seed: s });
      const w = w_(room);
      while (w.phase !== P.ENDED) {
        // **reveal は除く**——そこでは pickerId/oppId が「いま決着した対面の2人」を
        // 指していて、その片方は決まったばかり。見せるための値なので、それが正しい
        if (w.phase !== P.REVEAL) {
          if (w.pickerId) {
            assertEqual(w.fate[w.pickerId], undefined, '選ぶ人は、まだ決まっていない人');
            確かめた++;
          }
          if (w.oppId) assertEqual(w.fate[w.oppId], undefined, '対面の相手も、まだ決まっていない人');
        }
        step(room, { take: s % 2 === 0 });
      }
    }
    assert(確かめた > 20, '十分な回数を確かめた（実際:' + 確かめた + '回）');
  });

  await r.test('同じ2人が二度対面しない（着手前に机上で分かっていたことを、本物の進行役で固定する）', async () => {
    let 組の数 = 0;
    for (let s = 1; s <= 30; s++) {
      [4, 6, 8].forEach((n) => {
        const names = Array.from({ length: n }, (_, i) => '人' + i);
        const { room } = start(names, { seed: s * 7 + n });
        playOut(room, () => (s + n) % 2 === 0);
        const 組 = w_(room).history.map((h) => [h.holderId, h.oppId].sort().join('-'));
        assertEqual(new Set(組).size, 組.length,
          n + '人（種' + s + '）：同じ組が二度出てこない');
        組の数 += 組.length;
      });
    }
    assert(組の数 > 200, '十分な数の対面を見た（実際:' + 組の数 + '組）');
  });

  await r.test('ふりかえり（history）に、各ラウンドの「誰が誰と対面して、どうなったか」が残る', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 51 });
    const v = playOut(room, () => true);
    assertEqual(v.history.length, 3, '4人なら3ラウンドぶん残る');
    v.history.forEach((h) => {
      assert(h.holderName && h.oppName, '対面した2人の名前がある');
      assertEqual(typeof h.content, 'boolean', '中身が残っている（終わったあとなので出してよい）');
      assert(h.fate === 'alive' || h.fate === 'out', '結果が残っている');
      assertEqual(h.decidedName, h.fate && (h.taken ? h.oppName : h.holderName),
        '決まった人の名前が、結果表どおり');
    });
    // 決着の前は、ふりかえりを配らない（途中で全部見えたら遊びにならない）
    const 途中 = start(['あき', 'びび', 'ちか', 'でん'], { seed: 51 });
    assertEqual(pv(途中.room).history, null, '決着するまで history は配らない');
    assertEqual(pv(途中.room).survivors, null, '決着するまで生存者一覧も配らない');
  });

  r.finish();
})();
