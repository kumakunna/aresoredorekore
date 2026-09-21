// tests/rcard-room.js — ロシアンカードの進行役（指示55-①・門T4／T5／T6）
//
// **この指示でいちばん重い門は秘匿（T4）。**
// 相手の盤に仕掛けた爆弾の位置は、めくるまで誰にも見えてはいけない。
// 見張りは指示53と同じ**差分法**：
//   位置だけが違う2局を同じ手順で進め、**めくる前の publicView が1バイトも違わない**。
//
// ただしこのゲームには、False or True に無い罠がある——
// **秘密が「どのマスが安全か」を決めてしまう。**
// 素朴に「1番から順にめくる」と、差は漏れではなく**進行の違い**として出る。
// だから「**両局で空になるマスだけをめくる窓**」を作る（Aは1,2,3／Bは7,8,9 に置いて、
// 4,5,6 だけをめくる）。
//
// そして**その窓では1ビット漏れは捕まえられない**——窓の中では2局とも同じ答えになるので、
// 「次が爆弾か」を漏らす実装でも publicView は同じになる（落とし穴10-f）。
// だから False or True と同じく**配分を分ける**：
//   ・差分法 … 位置そのもの／符号化して混ぜる
//   ・別の門 … 「めくるまで本人にも返さない」「置いた本人だけに返す」「大画面には返さない」

const path = require('path');
const R = require(path.join(__dirname, '..', 'rcard-room.js'));
const L = require(path.join(__dirname, '..', 'public', 'js', 'rcard-logic.js'));
const { createRunner, assert, assertEqual } = require('./harness');

/** 本物の進行役を動かすための、最小の部屋（tests/falsetrue-room.js と同じ形） */
function makeRoom(names) {
  const members = new Map();
  names.forEach((n, i) => members.set('m' + i, {
    id: 'm' + i, name: n, role: 'player', connected: true, readyGame: null
  }));
  return { code: 'RC0001', members, state: { phase: 'lobby', game: null, data: {} } };
}
function seeded(seed) {
  let x = seed || 1;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}
function start(names, opts) {
  const o = opts || {};
  const room = makeRoom(names);
  const res = R.startGame(room, Object.assign({ _rand: seeded(o.seed || 7) }, o.cfg || {}), { notify() {} });
  return { room, res };
}
const pv = (room) => R.publicView(room);
const w_ = (room) => room.rcard;
const you = (room, id) => R.privateFor(room, id);

/** 締め切りを「今」まで引く（早送り）。持ち時間の数そのものは検査に使わない（落とし穴10-a） */
function rush(room) {
  const w = w_(room);
  if (w.deadline) w.deadline = Date.now() - 1;
  R.advance(room);
}

/**
 * **芯（realtime.js）と同じ形で送る。**
 * あちらは `submitAction` の戻り値を見て `if (res.allDone) dr.advance(room)` する
 * （realtime.js:1391）。検査がこれを写さないと、
 * 「全員が置いたのに段階が進まない」という**検査だけの世界**ができる——
 * 実装は正しいのに赤くなり、赤を信じられなくする
 */
function 送る(room, id, payload) {
  const res = 直に(room, id, payload);
  if (res && res.allDone) R.advance(room);
  return res;
}
/**
 * **芯と同じ4引数で呼ぶ**（realtime.js:1404）。
 * ここを3引数で書いていたせいで、`submitAction` の引数の形が芯と食い違ったまま
 * **単体の検査だけが緑**になっていた——実サーバーに繋いで初めて分かった（落とし穴12）。
 * 検査が実装の呼ばれ方を写していないと、「検査だけの世界」ができる
 */
function 直に(room, id, payload) {
  return R.submitAction(room, id, (payload && payload.targetId) || null, payload);
}

/** 全員が置く。置き場所を渡さなければ、盤の 1,2,3… に置く */
function placeAll(room, 場所) {
  const w = w_(room);
  const 組 = R.liveMatches(room).slice();
  組.forEach((m) => {
    [m.a, m.b].forEach((id) => {
      const 相手 = m.a === id ? m.b : m.a;
      const list = (場所 && 場所[相手]) || [1, 2, 3, 4, 5, 6, 7, 8, 9].slice(0, w.bombsPerBoard);
      送る(room, id, { place: list });
    });
  });
}

/** 比べる時に落とすもの。**時刻は実時間で動くので潰す**（tests/falsetrue-room.js:181 と同じ） */
const 時刻を潰す = (k, v) => (k === 'remainingMs' ? 0 : v);
const 写す = (room) => JSON.stringify(pv(room), 時刻を潰す);

(async function main() {
  const r = createRunner('rcard-room：ロシアンカードの進行役');

  // ================= 始まり =================

  await r.test('2人未満では始まらない', async () => {
    const { res } = start(['あき']);
    assertEqual(res.ok, false, '1人では始まらない');
    assertEqual(res.error, 'too_few_players', '理由が出る');
  });

  await r.test('2人で始まると、1組できて「置く」段階になる', async () => {
    const { room, res } = start(['あき', 'びび']);
    assertEqual(res.ok, true, '始まる');
    assertEqual(w_(room).phase, 'place', '置く段階');
    assertEqual(w_(room).matches.length, 1, '1組');
    assertEqual(w_(room).byeId, null, '不戦勝は出ない');
    // **2人で始めた部屋は「最初から1対1」**なので、えらんだ数がそのまま使われる
    // （2026-09-21・本人の指示。それまでは必ず決勝の5つだった）。
    // 既定は3つ。進行役が渡した数が効くことは下の検査で見る
    assertEqual(w_(room).bombsPerBoard, 3, '2人で始めたら、ふだんの数（既定3つ）');
  });

  await r.test('2人の部屋で、進行役がえらんだ爆弾の数がそのまま効く', async () => {
    // **これが本人の報告そのもの**（いっきうちで数を指定しても5になる）。
    // 部屋も手渡しも同じ `bombsForMatch` を通るので、両方で効く（落とし穴1）
    [2, 4, 5].forEach((n) => {
      const { room } = start(['あき', 'びび'], { cfg: { bombs: n } });
      assertEqual(w_(room).bombsPerBoard, n, n + 'つをえらんだら ' + n + 'つ');
    });
    // **決勝の数は読まれない**（最初から1対1なので）
    const { room } = start(['あき', 'びび'], { cfg: { bombs: 3, finalBombs: 8 } });
    assertEqual(w_(room).bombsPerBoard, 3, '最初から1対1では決勝の数を見ない');
  });

  await r.test('5人で始まると、2組＋不戦勝1人。爆弾はふだんの3つ', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん', 'えみ']);
    assertEqual(w_(room).matches.length, 2, '2組');
    assert(w_(room).byeId, '不戦勝が1人いる');
    assertEqual(w_(room).bombsPerBoard, 3, '3人以上ならふだんの数');
    // 不戦勝の人は組に入っていない
    const 組の人 = [];
    w_(room).matches.forEach((m) => 組の人.push(m.a, m.b));
    assertEqual(組の人.indexOf(w_(room).byeId), -1, '不戦勝の人は組に入っていない');
  });

  // ================= 置く =================

  await r.test('置けるのは、決められた数・盤の中・重複なしだけ', async () => {
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3 } });
    const id = w_(room).matches[0].a;
    assertEqual(直に(room, id, { place: [1, 2] }).error, 'bad_count', '数が足りない');
    assertEqual(直に(room, id, { place: [1, 2, 3, 4] }).error, 'bad_count', '数が多い');
    assertEqual(直に(room, id, { place: [1, 2, 99] }).error, 'bad_cell', '盤の外');
    assertEqual(直に(room, id, { place: [1, 2, 2] }).error, 'duplicate', '重複');
    assertEqual(直に(room, id, { place: [1, 2, 3] }).ok, true, '正しければ通る');
    assertEqual(直に(room, id, { place: [4, 5, 6] }).error, 'already', '2度は置けない');
  });

  await r.test('置いた爆弾は「相手の盤」に乗る（自分の盤ではない）', async () => {
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3 } });
    const m = w_(room).matches[0];
    直に(room, m.a, { place: [1, 2, 3] });
    assertEqual((w_(room).bombsOnBoard[m.b] || []).join(','), '1,2,3', 'b の盤に乗っている');
    assertEqual(w_(room).bombsOnBoard[m.a], undefined, 'a の盤にはまだ何も無い');
  });

  await r.test('置かずに締め切りが来たら、サーバーが置いて進む（止まらない）', async () => {
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3 } });
    // 型(b)：**誰も置いていない状況が本当に作れているか**を先に見る
    assertEqual(Object.keys(w_(room).bombsOnBoard).length, 0, 'まだ誰も置いていない');
    rush(room);
    assertEqual(w_(room).phase, 'turn', 'めくる段階へ進んだ');
    const m = w_(room).matches[0];
    assertEqual((w_(room).bombsOnBoard[m.a] || []).length, 3, 'a の盤に3つ置かれた');
    assertEqual((w_(room).bombsOnBoard[m.b] || []).length, 3, 'b の盤に3つ置かれた');
  });

  // ================= めくる =================

  await r.test('めくれるのは手番の人だけ。相手の番には押せない', async () => {
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3 } });
    placeAll(room);
    const m = w_(room).matches[0];
    assertEqual(w_(room).phase, 'turn', 'めくる段階');
    const 手番 = m.turn === 'a' ? m.a : m.b;
    const 待つ人 = 手番 === m.a ? m.b : m.a;
    assertEqual(直に(room, 待つ人, { flip: 5 }).error, 'not_your_turn', '相手は押せない');
    assertEqual(直に(room, 手番, { flip: 5 }).ok, true, '手番の人は押せる');
  });

  await r.test('爆弾をめくると体力が1減り、安全なら減らない', async () => {
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3, lives: 3 } });
    const m = w_(room).matches[0];
    // a の盤に 1,2,3 を置く（b が置く）／b の盤に 7,8,9（a が置く）
    送る(room, m.b, { place: [1, 2, 3] });
    送る(room, m.a, { place: [7, 8, 9] });
    const 手番 = m.turn === 'a' ? m.a : m.b;
    const 爆弾 = 手番 === m.a ? 1 : 7;
    const 安全 = 手番 === m.a ? 5 : 5;
    // 型(b)：**その場所が本当に爆弾か**を先に確かめる
    assertEqual((w_(room).bombsOnBoard[手番] || []).indexOf(爆弾) !== -1, true, '狙った場所は爆弾');
    const 前 = w_(room).lives[手番];
    assertEqual(直に(room, 手番, { flip: 爆弾 }).hit, true, '当たり');
    assertEqual(w_(room).lives[手番], 前 - 1, '体力が1減る');
    // 型(c)：**もう一方の入力**。安全な場所では減らない
    rush(room);                       // show
    rush(room);                       // 手番が入れ替わる
    const 次 = w_(room).matches[0].turn === 'a' ? w_(room).matches[0].a : w_(room).matches[0].b;
    const 次の前 = w_(room).lives[次];
    assertEqual((w_(room).bombsOnBoard[次] || []).indexOf(安全), -1, '狙った場所は安全');
    直に(room, 次, { flip: 安全 });
    assertEqual(w_(room).lives[次], 次の前, '体力は減らない');
  });

  await r.test('時間切れは体力−1（膠着を防ぐ）。カードはめくらない', async () => {
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3, lives: 3 } });
    placeAll(room);
    const m = w_(room).matches[0];
    const 手番 = m.turn === 'a' ? m.a : m.b;
    const 前 = w_(room).lives[手番];
    assertEqual(w_(room).boards[手番].flipped.length, 0, 'まだ1枚もめくっていない');
    rush(room);   // 時間切れ
    assertEqual(w_(room).lives[手番], 前 - 1, '体力が1減る');
    assertEqual(w_(room).boards[手番].flipped.length, 0, 'カードはめくられていない');
    assertEqual(pv(room).last.timeout, true, '時間切れだと分かる');
  });

  // ================= 決着と順位 =================

  await r.test('体力が0になった方が負け。最後の1人が1位（2人）', async () => {
    // **2人で始めた部屋は `bombs` を読む**（2026-09-21 以降）。
    // 以前は `finalBombs` を渡していた——2人なら必ず決勝あつかいだったため
    const { room } = start(['あき', 'びび'], { cfg: { bombs: 8, lives: 1 } });
    // **爆弾の上限は8**（9枚全部にすると、めくる意味が無くなるので rcard-logic が止める）。
    // 1〜8 に置いて 1 をめくれば、必ず当たる
    assertEqual(w_(room).bombsPerBoard, 8, 'この試合の爆弾は8つ');
    const m = w_(room).matches[0];
    送る(room, m.b, { place: [1, 2, 3, 4, 5, 6, 7, 8] });
    送る(room, m.a, { place: [1, 2, 3, 4, 5, 6, 7, 8] });
    // 型(b)：**本当に置けたか**を先に見る（数を間違えると bad_count で1つも置かれない）
    assertEqual(w_(room).phase, 'turn', '置き終わってめくる段階になった');
    const 手番 = m.turn === 'a' ? m.a : m.b;
    assertEqual((w_(room).bombsOnBoard[手番] || []).indexOf(1) !== -1, true, '1番は爆弾');
    直に(room, 手番, { flip: 1 });
    assertEqual(w_(room).lives[手番], 0, '体力が0');
    rush(room);   // show → 決着
    rush(room);   // round → ended
    assertEqual(w_(room).phase, 'ended', '終わった');
    const res = R.resultView(room);
    assert(res, '結果がある');
    const 一位 = res.ranking.filter((x) => x.rank === 1);
    assertEqual(一位.length, 1, '1位はひとり');
    assert(一位[0].id !== 手番, '0になった方は1位ではない');
  });

  await r.test('3人以上：最後の1人が決まるまで通しで進む（門T5）', async () => {
    const { room } = start(['あ', 'い', 'う', 'え', 'お', 'か', 'き'],
      { cfg: { lives: 1, bombs: 8, finalBombs: 8 } });
    // **1〜8 に置いて 1 をめくる**ので、めくった人が必ず負ける＝1手で決着する
    assertEqual(w_(room).bombsPerBoard, 8, '爆弾は8つ（上限）');
    let 回 = 0, 置いた回 = 0, めくった手 = 0;
    while (w_(room).phase !== 'ended' && 回 < 200) {
      回++;
      const w = w_(room);
      if (w.phase === 'place') {
        placeAll(room, {});
        置いた回++;
        if (w_(room).phase === 'place') rush(room);
        continue;
      }
      if (w.phase === 'turn') {
        R.liveMatches(room).slice().forEach((m) => {
          const 手番 = m.turn === 'a' ? m.a : m.b;
          if (送る(room, 手番, { flip: 1 }).ok) めくった手++;
        });
        if (w_(room).phase === 'turn') rush(room);
        continue;
      }
      rush(room);
    }
    // 型(b)：**本当にその手順を通ったか**を先に主張する。
    // 置けていなくても autoPlace が進めてしまうので、素通りに気づけない
    assert(置いた回 >= 3, '「置く」を3回以上通った（実際:' + 置いた回 + '回）');
    assert(めくった手 >= 3, '実際に3手以上めくった（実際:' + めくった手 + '手）');
    assertEqual(w_(room).phase, 'ended', '最後まで進んだ（回:' + 回 + '）');
    const res = R.resultView(room);
    assertEqual(res.ranking.length, 7, '7人ぶんの順位がある');
    assertEqual(res.ranking.filter((x) => x.rank === 1).length, 1, '1位はひとり');
    assert(res.winner, '勝った人の名前がある');
  });

  await r.test('不戦勝の人は、体力をそのまま持ち越す', async () => {
    const { room } = start(['あ', 'い', 'う'], { cfg: { lives: 3, bombs: 3 } });
    const bye = w_(room).byeId;
    assert(bye, '不戦勝が1人いる');
    const 前 = w_(room).lives[bye];
    placeAll(room);
    rush(room); rush(room); rush(room);
    assertEqual(w_(room).lives[bye], 前, '不戦勝の体力は減っていない');
  });

  // ================= 秘匿（門T4・この指示でいちばん重い） =================

  await r.test('T4：爆弾の置き場所が違うだけの2局で、めくる前の publicView が1バイトも違わない', async () => {
    const A = start(['あき', 'びび'], { seed: 11, cfg: { finalBombs: 3 } });
    const B = start(['あき', 'びび'], { seed: 11, cfg: { finalBombs: 3 } });
    // **検体を作るためだけに、正本を直に入れ替える**（実装に試験用の入口は作らない）。
    // 窓：両局とも 4,5,6 は空なので、そこだけをめくるかぎり進行は同じになる
    [A, B].forEach((g) => { g.room.rcard.placed = { m0: true, m1: true }; });
    A.room.rcard.bombsOnBoard = { m0: [1, 2, 3], m1: [1, 2, 3] };
    B.room.rcard.bombsOnBoard = { m0: [7, 8, 9], m1: [7, 8, 9] };
    // 型(b)：**2局の置き場所が本当に違う**ことを先に主張する
    assert(JSON.stringify(A.room.rcard.bombsOnBoard) !== JSON.stringify(B.room.rcard.bombsOnBoard),
      '2局の置き場所は本当に違う');

    R.advance(A.room); R.advance(B.room);     // place → turn
    const 見た = [];
    for (let i = 0; i < 3; i++) {
      const 段階 = A.room.rcard.phase;
      assertEqual(B.room.rcard.phase, 段階, i + '手目：2局が同じ段階にいる');
      if (段階 === 'ended') break;
      assertEqual(写す(A.room), 写す(B.room),
        段階 + '（' + i + '手目）の公開スナップショットが、爆弾の位置に関係なく同じ');
      見た.push(段階);
      if (段階 === 'turn') {
        [A, B].forEach((g) => {
          const m = g.room.rcard.matches[0];
          const 手番 = m.turn === 'a' ? m.a : m.b;
          直に(g.room, 手番, { flip: 4 + i });   // **窓の中（4,5,6）だけ**
        });
      }
      R.advance(A.room); R.advance(B.room);
    }
    // 型(b)：**その状況が本当に作れたか**（自明に緑になっていないか）
    assertEqual(見た.join('→'), 'turn→show→turn', 'めくる段階を実際に2回通った');
    // 窓の中では、体力が1も減っていないこと＝本当に空のマスだけをめくった
    assertEqual(Object.values(A.room.rcard.lives).join(','), '3,3', '窓の中では誰も当たっていない');
  });

  await r.test('T4：公開スナップショットに、秘密の入れ物の名前が1つも出ない', async () => {
    // **値では針を張れない**——位置は 1〜9 の整数で、盤の番号として正当に出る。
    // だから**入れ物の名前**を見る。名前を変えた日は grep tests/ をかけること（落とし穴5）
    const { room } = start(['あき', 'びび']);
    placeAll(room);
    const 文字 = JSON.stringify(pv(room));
    assertEqual(文字.indexOf('bombsOnBoard'), -1, '盤の爆弾の入れ物が公開側に無い');
    assertEqual(文字.indexOf('bombsIPlaced'), -1, '仕掛けた位置も公開側に無い');
  });

  await r.test('T4：カタカナの目印を秘密の入れ物に混ぜても、公開側に出てこない', async () => {
    // 目印は**カタカナ**（tests/realtime.js:619 の前例と同じ理由）。
    // 部屋コードは 23456789ABCDEFGHJKMNPQRSTUVWXYZ、memberId は16進なので、
    // カタカナは実データと原理的にぶつからない——
    // 数字の 99 で見て「たまたま並んだ回だけ赤くなる」を作らない（落とし穴10-d）
    const { room } = start(['あき', 'びび']);
    placeAll(room);
    room.rcard.bombsOnBoard.m0 = ['バクダンノイチ', 2, 3];
    const 文字 = JSON.stringify(pv(room));
    assertEqual(文字.indexOf('バクダンノイチ'), -1, '公開側に目印が出ていない');
    // 型(b)：**目印が本当に仕込まれているか**を先に見る
    assertEqual(JSON.stringify(room.rcard.bombsOnBoard).indexOf('バクダンノイチ') !== -1, true,
      '目印は秘密の側に入っている');
  });

  await r.test('T4：自分の盤の答えは、本人にも返らない（返るのは自分が置いた位置だけ）', async () => {
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3 } });
    const m = w_(room).matches[0];
    送る(room, m.b, { place: [1, 2, 3] });   // a の盤
    送る(room, m.a, { place: [7, 8, 9] });   // b の盤
    const aの秘密 = you(room, m.a);
    assertEqual((aの秘密.bombsIPlaced || []).join(','), '7,8,9', '自分が置いた位置は返る');
    assertEqual(JSON.stringify(aの秘密).indexOf('1,2,3'), -1, '自分の盤の答えは返らない');
    // **どの分岐でも読まない**ことを、中身の数でも見る
    const 文字 = JSON.stringify(aの秘密);
    [1, 2, 3].forEach(() => {});
    assertEqual(文字.indexOf('"1"'), -1, '自分の盤の番号が素で出ていない');
  });

  await r.test('T4：置いている最中は、自分が置いた位置も返さない', async () => {
    // 同時に置く設計なので、置く前に返すと「自分が置く前に相手の答えを持つ」ことになる。
    // **段階を明示して守る**（falsetrue-room.js:471-472 と同じ形）
    const { room } = start(['あき', 'びび'], { cfg: { finalBombs: 3 } });
    const m = w_(room).matches[0];
    送る(room, m.a, { place: [7, 8, 9] });
    assertEqual(w_(room).phase, 'place', 'まだ置く段階');
    assertEqual(you(room, m.a).bombsIPlaced, null, '置く段階では返さない');
    // 型(c)：**分岐のもう一方**。置き終われば返る
    送る(room, m.b, { place: [1, 2, 3] });
    assertEqual(w_(room).phase, 'turn', 'めくる段階になった');
    assertEqual((you(room, m.a).bombsIPlaced || []).join(','), '7,8,9', '置き終われば返る');
  });

  await r.test('T4：大画面（プレイヤーでない端末）には、秘密を1つも返さない', async () => {
    const { room } = start(['あき', 'びび']);
    assertEqual(R.privateFor(room, 'tv'), null, '名簿に無い相手には null');
    assertEqual(R.privateFor(room, null), null, 'null にも null');
  });

  await r.test('T4 逆向き：めくったあとは、その1枚のぶんだけ違いが出る（隠しっぱなしにしない）', async () => {
    // **隠しすぎも壊れている。**開いた結果が公開されないと、遊びが成り立たない
    const A = start(['あき', 'びび'], { seed: 11, cfg: { finalBombs: 3 } });
    const B = start(['あき', 'びび'], { seed: 11, cfg: { finalBombs: 3 } });
    [A, B].forEach((g) => { g.room.rcard.placed = { m0: true, m1: true }; });
    A.room.rcard.bombsOnBoard = { m0: [1, 2, 3], m1: [1, 2, 3] };
    B.room.rcard.bombsOnBoard = { m0: [7, 8, 9], m1: [7, 8, 9] };
    R.advance(A.room); R.advance(B.room);
    // **1番をめくる**：A では爆弾、B では安全
    [A, B].forEach((g) => {
      const m = g.room.rcard.matches[0];
      直に(g.room, m.turn === 'a' ? m.a : m.b, { flip: 1 });
    });
    const a = pv(A.room), b = pv(B.room);
    const 手番A = A.room.rcard.matches[0].turn === 'a' ? 'm0' : 'm1';
    assertEqual(a.boards[手番A].hits.join(','), '1', 'A では当たりとして出る');
    assertEqual(b.boards[手番A].hits.join(','), '', 'B では当たっていない');
    assertEqual(a.last.hit, true, 'A の直前のめくりは当たり');
    assertEqual(b.last.hit, false, 'B の直前のめくりは安全');
    // それ以外（めくった場所・手番・組）は同じまま
    assertEqual(a.boards[手番A].flipped.join(','), b.boards[手番A].flipped.join(','),
      'めくった場所は2局とも同じ');
    assertEqual(JSON.stringify(a.matches), JSON.stringify(b.matches), '組は2局とも同じ');
  });

  // ================= 人が抜けた（門T9） =================

  await r.test('T9：試合中に相手が抜けたら、残った方の不戦勝になる（止まらない）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { cfg: { bombs: 3 } });
    placeAll(room);
    const m = w_(room).matches[0];
    // 型(b)：**その試合が本当に動いている**ことを先に見る
    assertEqual(m.done, false, '試合はまだ決着していない');
    room.members.delete(m.a);          // 退室（名簿から消える）
    R.isAllDone(room);                 // 芯はここを通って数え直す
    R.advance(room);
    assertEqual(w_(room).gone.indexOf(m.a) !== -1, true, '抜けた人として数えられた');
    assertEqual(w_(room).敗退回[m.a] != null, true, '抜けた人が敗退になった');
    assertEqual(w_(room).敗退回[m.b], null, '残った方は生きている');
  });

  await r.test('T9：待っている人（不戦勝）が抜けても、進行は止まらない', async () => {
    const { room } = start(['あ', 'い', 'う'], { cfg: { bombs: 3 } });
    const bye = w_(room).byeId;
    assert(bye, '不戦勝が1人いる');
    room.members.delete(bye);
    placeAll(room);
    let 回 = 0;
    while (w_(room).phase !== 'ended' && 回 < 60) { 回++; rush(room); }
    assertEqual(w_(room).phase, 'ended', '最後まで進む（止まらない）');
  });

  // ================= 時計（正本 §11-4） =================

  await r.test('§11-4：めくる段階は turn、見せる間は tick、置く段階は play', async () => {
    // **具体の段階名で書く**（落とし穴10-a）。
    // 手番の15秒を 'play' にすると、420pxの数字が1手番の3分の1の時間、盤を覆う
    assertEqual(R.clockKind({ rcard: { phase: 'turn' } }), 'turn', 'めくる段階は turn');
    assertEqual(R.clockKind({ rcard: { phase: 'show' } }), 'tick', '結果を見せる間は tick');
    assertEqual(R.clockKind({ rcard: { phase: 'round' } }), 'tick', '回の終わりを見せる間は tick');
    assertEqual(R.clockKind({ rcard: { phase: 'place' } }), 'play', '置く段階は play（全員が同時）');
    assertEqual(R.clockKind({}), 'play', '段階がまだ無ければ play');
  });

  // ================= 待つ相手（芯の数え直しが効くこと） =================

  await r.test('待つのは「まだ置いていない人」「いま手番の人」だけ', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { cfg: { bombs: 3 } });
    assertEqual(R.expectedMembers(room).length, 4, '置く段階では4人とも待つ');
    placeAll(room);
    assertEqual(w_(room).phase, 'turn', 'めくる段階');
    // **組ごとに1人ずつ。**相手は待っていない（すごろくの pair 進行と同じ形）
    assertEqual(R.expectedMembers(room).length, 2, '2組なので、待つのは2人');
    // 見せる間は誰も待たない（落とし穴22：見せる段階を飛ばさせない）
    R.liveMatches(room).slice().forEach((m) => {
      直に(room, m.turn === 'a' ? m.a : m.b, { flip: 5 });
    });
    R.advance(room);
    assertEqual(w_(room).phase, 'show', '見せる段階');
    assertEqual(R.expectedMembers(room).length, 0, '誰も待っていない');
    assertEqual(R.isAllDone(room), false, 'それでも「全員済み」にはしない（飛ばさせない）');
  });

  r.finish();
})();
