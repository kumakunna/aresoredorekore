// tests/shinka-room.js — 進化じゃんけんの進行役（指示55-②・門U4／U6／U7／U8／U9）
//
// **この指示でいちばん重い門は秘匿（U4）。**守るものが2つある：
//   ① **出した手**（開くまで）
//   ② **AIの正体**（ずっと）
//
// ①の見張りは指示53・55-① と同じ**差分法**。ただし①（ロシアンカード）の「窓」は写せない——
// あちらは「秘密が、どのマスが安全かを決める」ので、両局で同じ動きになるマスだけを
// めくる窓を作った。②は**じゃんけんそのものが秘密**なので、窓の外が無い。
//
// だから形を変える：**開く前の1枚を、9通りの手の組み合わせ全部で比べる。**
// 進行がまだ動いていないので窓が要らず、
// 「どちらが勝つか」「あいこになるか」「相手の手そのもの」の3つを同時に捕まえる。
//
// ②の見張りは、差分法では足りない（AIが出るかどうかで盤面が変わる）。
// **「AIの印が publicView のどこにも無い」を、文字列で直に掃く。**

const path = require('path');
const R = require(path.join(__dirname, '..', 'shinka-room.js'));
const L = require(path.join(__dirname, '..', 'public', 'js', 'shinka-logic.js'));
const { createRunner, assert, assertEqual } = require('./harness');

/** 本物の進行役を動かすための、最小の部屋（tests/rcard-room.js:26-33 と同じ形） */
function makeRoom(names) {
  const members = new Map();
  names.forEach((n, i) => members.set('m' + i, {
    id: 'm' + i, name: n, role: 'player', connected: true, readyGame: null
  }));
  return { code: 'SH0001', members, state: { phase: 'lobby', game: null, data: {} } };
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
const w_ = (room) => room.shinka;
const you = (room, id) => R.privateFor(room, id);

/** 締め切りを「今」まで引く（早送り）。秒数そのものは検査に使わない（落とし穴10-a・24） */
function rush(room) {
  const w = w_(room);
  if (w.deadline) w.deadline = Date.now() - 1;
  R.advance(room);
}

/**
 * **芯（realtime.js）と同じ4引数で送る**（realtime.js:1404）。
 * 3引数で書くと payload が targetId の位置に入り、
 * **単体の検査だけが緑**になる（①が実サーバーで踏んだ形・落とし穴12）。
 */
function 送る(room, id, payload) {
  const res = R.submitAction(room, id, (payload && payload.targetId) || null, payload);
  if (res && res.allDone) R.advance(room);
  return res;
}

/** 全員が手を出す。`手` を渡さなければ全員グー */
function throwAll(room, 手) {
  R.liveMatches(room).forEach((m) => {
    [m.a, m.b].forEach((id) => {
      if (!w_(room).playerIds.indexOf) return;
      if (w_(room).playerIds.indexOf(id) === -1) return;   // AIは送らない
      送る(room, id, { hand: (手 && 手[id]) || 'g' });
    });
  });
}

/** 比べる時に落とすもの。**時刻は実時間で動くので潰す**（tests/rcard-room.js:89 と同じ） */
const 時刻を潰す = (k, v) => ((k === 'remainingMs' || k === '残り全体Ms') ? 0 : v);

/** match → throw まで進める */
function toThrow(room) {
  if (w_(room).phase === R.PHASE.MATCH) rush(room);
  assertEqual(w_(room).phase, R.PHASE.THROW, 'throw に来た');
}

(async function main() {
  const r = createRunner('shinka-room：進化じゃんけんの進行役');

  // ---------- 始まり ----------

  await r.test('3人未満では始まらない（部屋専用・指示書0）', async () => {
    const { res } = start(['あき', 'びび']);
    assertEqual(res.ok, false, '2人では始まらない');
    assertEqual(res.error, 'too_few_players', '理由');
    assertEqual(start(['あき', 'びび', 'ちか']).res.ok, true, '3人なら始まる');
  });

  await r.test('全員が最下段から始まる（指示書2-2）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん']);
    const v = pv(room);
    assertEqual(v.players.length, 4, '4人');
    assertEqual(v.players.every((p) => p.rank === 0), true, '全員が段0');
    assertEqual(v.players.every((p) => p.lose === 0), true, '連敗も0');
    assertEqual(v.段.length, 5, '通常版は5段');
    assertEqual(v.段[0].名, 'たまご', '最下段の名前が公開されている');
  });

  await r.test('段階は match → throw → reveal（指示書2-4）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん']);
    assertEqual(w_(room).phase, R.PHASE.MATCH, 'まず組み合わせの発表');
    rush(room);
    assertEqual(w_(room).phase, R.PHASE.THROW, '次に手を出す');
    throwAll(room);
    rush(room);
    assertEqual(w_(room).phase, R.PHASE.REVEAL, '開いて見せる');
  });

  // ---------- 門U4-①：出した手の秘匿（差分法・9通りの総当たり） ----------

  await r.test('**開く前の publicView は、9通りどの手でも1バイト違わない**（門U4・差分法）', async () => {
    const 基準 = {};
    L.HANDS.forEach((hA) => {
      L.HANDS.forEach((hB) => {
        const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 42 });
        toThrow(room);
        const 組 = R.liveMatches(room).filter((m) => !m.機械);
        assert(組.length > 0, '人どうしの組が1つ以上ある（条件が作れている・落とし穴10-b）');
        const m = 組[0];
        送る(room, m.a, { hand: hA });
        送る(room, m.b, { hand: hB });
        // **まだ開いていない**
        assertEqual(w_(room).phase, R.PHASE.THROW, hA + 'vs' + hB + '：まだ throw');
        const 文字 = JSON.stringify(pv(room), 時刻を潰す);
        if (!基準.s) 基準.s = 文字;
        assertEqual(文字, 基準.s, hA + ' vs ' + hB + ' で publicView が同じ');
      });
    });
  });

  await r.test('出した手は publicView のどこにも文字として出ない（符号化まで見る・門U4）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 5 });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    送る(room, 組.a, { hand: 'c' });
    送る(room, 組.b, { hand: 'p' });
    const 文字 = JSON.stringify(pv(room));
    // `封じた手` という入れ物の名前そのものが針になる（日本語のキーは publicView に出ない）
    assert(文字.indexOf('封じた手') === -1, '入れ物の名前が漏れない');
    assert(文字.indexOf('aHand":"c') === -1, '開く前に手が出ない（a）');
    assert(文字.indexOf('bHand":"p') === -1, '開く前に手が出ない（b）');
    assertEqual(pv(room).matches.every((m) => m.aHand === null && m.bHand === null), true,
      '開く前は、どの組の手も null');
  });

  await r.test('本人には自分の手だけ返る。**相手の手はどの段階でも返らない**（門U4）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 5 });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    送る(room, 組.a, { hand: 'c' });
    送る(room, 組.b, { hand: 'p' });
    assertEqual(you(room, 組.a).myHand, 'c', '自分の手は返る');
    assertEqual(you(room, 組.b).myHand, 'p', '相手も自分の手が返る');
    const 文字A = JSON.stringify(you(room, 組.a));
    assert(文字A.indexOf('"p"') === -1, 'a の手元に b の手（p）が無い');
    const 文字B = JSON.stringify(you(room, 組.b));
    assert(文字B.indexOf('"c"') === -1, 'b の手元に a の手（c）が無い');
  });

  await r.test('開き直しても、出した手は保たれる（サーバーが持つ・指示書2-9）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 5 });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    送る(room, 組.a, { hand: 'p' });
    // 切断 → 戻る（端末の記憶は消えるが、サーバーは覚えている）
    room.members.get(組.a).connected = false;
    R.reapGone(room);
    room.members.get(組.a).connected = true;
    assertEqual(you(room, 組.a).myHand, 'p', '開き直しても手は残っている');
    // 2度目は受け付けない
    assertEqual(送る(room, 組.a, { hand: 'g' }).error, 'already', '出し直せない');
  });

  await r.test('大画面（名簿に無いid）には秘密を1バイトも配らない（門U4）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん']);
    assertEqual(R.privateFor(room, 'big1'), null, '知らないidには null');
    room.members.set('big1', { id: 'big1', name: '大画面', role: 'bigscreen', connected: true });
    assertEqual(R.privateFor(room, 'big1'), null, '大画面にも null');
  });

  // ---------- 門U4-②：AIの正体 ----------

  await r.test('**AIの印が publicView のどこにも無い**（門U4・禁止1行目）', async () => {
    // 段がばらけて、必ずAIが出る盤面を作る
    const { room } = start(['あき', 'びび', 'ちか'], { seed: 3 });
    const w = w_(room);
    w.状態.m0.段 = 0; w.状態.m1.段 = 0; w.状態.m2.段 = 4;   // m2 は最上段に1人
    w.round = 0; R.liveMatches(room).forEach((m) => { m.done = true; });
    // 回を作り直す
    w.matches = []; w.byeIds = [];
    // startRound は外に出ていないので、reveal から次の回へ回して作らせる
    w.phase = R.PHASE.REVEAL; w.endsAt = Date.now() + 600000;
    R.advance(room);
    const 機械の組 = w.matches.filter((m) => m.機械);
    assert(機械の組.length > 0, '最上段に1人 → AIが出ている（条件が作れている・落とし穴10-b）');
    const 文字 = JSON.stringify(pv(room));
    assert(文字.indexOf('機械') === -1, '「機械」の印が無い');
    assert(文字.indexOf('aiName') === -1, 'AIの名前の欄が無い');
    assert(文字.indexOf('種別') === -1, '組の種別が出ない');
    assert(文字.indexOf('no-candidate') === -1, '相手がいない理由が出ない');
    assert(文字.indexOf('parity') === -1, '不戦勝の理由も出ない');
    // **相手の名前は、ふつうの人と同じ形で出ている**（本人の裁定）
    const 行 = pv(room).matches.find((x) => x.a === 機械の組[0].a);
    assert(!!行 && typeof 行.bName === 'string' && 行.bName.length > 0,
      'AIの相手名が、ふつうの名前として出ている');
  });

  await r.test('AIは名簿にも人数にも入らない（落とし穴：reapGone が不戦敗にする形）', async () => {
    const { room } = start(['あき', 'びび', 'ちか'], { seed: 3 });
    const w = w_(room);
    w.状態.m2.段 = 4;
    w.phase = R.PHASE.REVEAL; w.endsAt = Date.now() + 600000;
    R.liveMatches(room).forEach((m) => { m.done = true; });
    R.advance(room);
    const 機械 = w.matches.filter((m) => m.機械)[0];
    assert(!!機械, 'AI戦がある');
    assertEqual(w.playerIds.indexOf(機械.b), -1, 'AIの id は playerIds に無い');
    assertEqual(pv(room).players.length, 3, '人数は3人のまま（AIは players に居ない）');
    // reapGone を何度呼んでも、AIは「抜けた人」にならない
    R.reapGone(room); R.reapGone(room);
    assertEqual(w.gone.length, 0, 'AIは gone に入らない');
    assertEqual(機械.done, false, 'AI戦が不戦敗で畳まれていない');
    // **本人にもAIだと知らせない**（指示書2-8）
    const 手元 = JSON.stringify(you(room, 機械.a));
    assert(手元.indexOf('機械') === -1, '本人の手元にもAIの印が無い');
  });

  await r.test('AIは「まだ出していない人」に数えられない（相手を待って止まらない）', async () => {
    const { room } = start(['あき', 'びび', 'ちか'], { seed: 3 });
    const w = w_(room);
    w.状態.m2.段 = 4;
    w.phase = R.PHASE.REVEAL; w.endsAt = Date.now() + 600000;
    R.liveMatches(room).forEach((m) => { m.done = true; });
    R.advance(room);
    rush(room);   // match → throw
    assertEqual(w.phase, R.PHASE.THROW, 'throw に来た');
    const 待つ = R.expectedMembers(room);
    const 機械 = w.matches.filter((m) => m.機械)[0];
    assertEqual(待つ.indexOf(機械.b), -1, 'AIは待つ相手に入らない');
    assert(待つ.indexOf(機械.a) !== -1, '人の方は待っている');
  });

  await r.test('**手を出す段階は、締め切りを待つ**（進む速さがAIの指紋にならない・門U4）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 9 });
    toThrow(room);
    throwAll(room);                       // 全員が出した
    assertEqual(R.expectedMembers(room).length, 0, '待つ人は0人');
    assertEqual(R.isAllDone(room), false, 'それでも「全員済み」にはしない');
    assertEqual(w_(room).phase, R.PHASE.THROW, '締め切りまで throw のまま');
    rush(room);
    assertEqual(w_(room).phase, R.PHASE.REVEAL, '締め切りが来て初めて進む');
  });

  // ---------- 門U8：あいこと時間切れ ----------

  await r.test('あいこなら**同じ組のまま**もう一度（指示書2-3）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 11 });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    const 前のa = 組.a, 前のb = 組.b;
    送る(room, 組.a, { hand: 'g' });
    送る(room, 組.b, { hand: 'g' });
    rush(room);                            // throw → reveal
    assertEqual(組.あいこ回数, 1, 'あいこを1回数えた');
    assertEqual(組.done, false, 'まだ決着していない');
    rush(room);                            // reveal → throw（同じ組のまま）
    assertEqual(w_(room).phase, R.PHASE.THROW, 'もう一度出す');
    assertEqual(組.a, 前のa, '相手が変わっていない（a）');
    assertEqual(組.b, 前のb, '相手が変わっていない（b）');
  });

  await r.test('あいこが上限に達したら引き分け。**両者とも動かない**（指示書2-3・門U8）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 11, cfg: { drawMax: 2 } });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    const 前段 = { a: w_(room).状態[組.a].段, b: w_(room).状態[組.b].段 };
    for (let i = 0; i < 2; i++) {
      送る(room, 組.a, { hand: 'p' });
      送る(room, 組.b, { hand: 'p' });
      rush(room);                          // throw → reveal
      if (!組.done) rush(room);            // reveal → throw
    }
    assertEqual(組.あいこ回数, 2, '2回あいこ');
    assertEqual(組.done, true, '引き分けで決着');
    assertEqual(組.引き分け, true, '引き分けの印');
    assertEqual(組.winner, null, '勝者はいない');
    assertEqual(w_(room).状態[組.a].段, 前段.a, 'a の段は動かない');
    assertEqual(w_(room).状態[組.b].段, 前段.b, 'b の段は動かない');
    assertEqual(w_(room).状態[組.a].連敗, 0, 'a の連敗も増えない');
    assertEqual(w_(room).状態[組.b].連敗, 0, 'b の連敗も増えない');
  });

  await r.test('**出さなかったら負け**。両者とも出さなければ あいこ（指示書2-3・門U8）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 13 });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    送る(room, 組.a, { hand: 'g' });        // b は出さない
    rush(room);
    assertEqual(組.winner, 組.a, '出した方の勝ち');
    assertEqual(w_(room).状態[組.a].段, 1, '勝った人は1つ上');
    // 両者とも出さない
    const { room: r2 } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 13 });
    toThrow(r2);
    const 組2 = R.liveMatches(r2).filter((m) => !m.機械)[0];
    rush(r2);
    assertEqual(組2.あいこ回数, 1, '両者とも出さなければ あいこ');
    assertEqual(組2.done, false, '決着していない');
  });

  // ---------- 門U5／U6：ランクの動きが、実際の進行で効くか ----------

  await r.test('勝てば1つ上、2連敗で1つ下（門U5。ルール層と進行役がつながっている）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 21 });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    送る(room, 組.a, { hand: 'g' });
    送る(room, 組.b, { hand: 'c' });        // a の勝ち
    rush(room);
    assertEqual(w_(room).状態[組.a].段, 1, '勝った人は段1へ');
    assertEqual(w_(room).状態[組.b].段, 0, '負けた人はそのまま');
    assertEqual(w_(room).状態[組.b].連敗, 1, '連敗1');
    // 動きが公開ビューに出ている（大画面の階段の材料）
    const 動き = pv(room).moves.find((d) => d.id === 組.a);
    assert(!!動き, '段の動きが公開されている');
    assertEqual(動き.後, 1, '後の段');
  });

  await r.test('**肩慣らしでは誰も動かない**（本人の裁定・論点②の新規則）', async () => {
    // 段1に2人・段2に1人。段2の人は1人なので「1つ下」へ降りられるが、
    // **低い方（段1）には仲間が2人いる**ので、これは挑戦ではなく肩慣らし。
    // ただし誰が先に組むかは shuffle 次第なので、**種を振って条件が作れた回を使う**
    // 誰が先に組むかは shuffle 次第だが、**部品Aは「直前にあぶれた人」を先頭に置く**
    // （versus.js:169-174）。段2に1人でいる人は、前の回にあぶれているのが自然な流れなので、
    // そこまで含めて盤面を作る。これで順に依らず、必ず肩慣らしが1組できる
    const t = start(['あき', 'びび', 'ちか'], { seed: 5 });
    const room = t.room;
    {
      const w0 = w_(room);
      w0.状態.m0.段 = 2; w0.状態.m1.段 = 1; w0.状態.m2.段 = 1;
      w0.直前の不戦勝 = 'm0';
      w0.直前の相手 = {};
      w0.phase = R.PHASE.REVEAL; w0.endsAt = Date.now() + 600000;
      R.liveMatches(room).forEach((x) => { x.done = true; });
      R.advance(room);
    }
    const m = w_(room).matches.filter((x) => x.種別 === L.種別.肩慣らし)[0];
    assert(!!m, '肩慣らしの組が作れた（条件が作れている・落とし穴10-b）');
    const w = w_(room);
    const 前 = { a: w.状態[m.a].段, b: w.状態[m.b].段 };
    rush(room);                            // match → throw
    送る(room, m.a, { hand: 'g' });
    送る(room, m.b, { hand: 'c' });         // a の勝ち
    rush(room);
    assertEqual(m.winner, m.a, '勝敗そのものは決まる');
    assertEqual(w.状態[m.a].段, 前.a, '勝った方も動かない');
    assertEqual(w.状態[m.b].段, 前.b, '負けた方も動かない');
    assertEqual(w.状態[m.a].連敗, 0, '勝った方の連敗も動かない');
    assertEqual(w.状態[m.b].連敗, 0, '負けた方の連敗も数えない');
  });

  // ---------- 門U9：優勝と打ち切り ----------

  await r.test('通常版は**最終形に到達した瞬間**に終わる（本人の裁定・論点④・門U9）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 31 });
    const w = w_(room);
    // 2人を最終段の1つ手前へ
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    w.状態[組.a].段 = 3; w.状態[組.b].段 = 3;
    送る(room, 組.a, { hand: 'g' });
    送る(room, 組.b, { hand: 'c' });
    rush(room);                            // throw → reveal
    assertEqual(w.状態[組.a].段, 4, '最終段へ到達');
    rush(room);                            // reveal → 終わり
    assertEqual(w.phase, R.PHASE.ENDED, '到達した瞬間に終わる');
    const res = R.resultView(room);
    assertEqual(res.優勝, true, '優勝で終わった');
    assertEqual(res.winner, w.names[組.a], '勝者の名前');
    assertEqual(res.ranking[0].rank, 1, '1位がいる');
  });

  await r.test('10分で打ち切り。その時点の段順で、**同じ段は同着**（指示書2-9・門U9）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 33 });
    const w = w_(room);
    w.状態.m0.段 = 2; w.状態.m1.段 = 2; w.状態.m2.段 = 1; w.状態.m3.段 = 0;
    w.endsAt = Date.now() - 1;             // 10分が過ぎた
    w.phase = R.PHASE.REVEAL;
    R.liveMatches(room).forEach((m) => { m.done = true; });
    R.advance(room);
    assertEqual(w.phase, R.PHASE.ENDED, '打ち切られた');
    const res = R.resultView(room);
    assertEqual(res.優勝, false, '優勝ではない');
    const m = {}; res.ranking.forEach((x) => { m[x.id] = x.rank; });
    assertEqual(m.m0, 1, '段2 が1位');
    assertEqual(m.m1, 1, '同じ段は同着');
    assertEqual(m.m2, 3, '同着が2人いるので次は3位');
    assertEqual(m.m3, 4, '最下段は4位');
  });

  await r.test('**10分ちょうどに優勝が出たら、優勝を優先**（指示書2-9）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 31 });
    const w = w_(room);
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    w.状態[組.a].段 = 3; w.状態[組.b].段 = 3;
    送る(room, 組.a, { hand: 'g' });
    送る(room, 組.b, { hand: 'c' });
    rush(room);                            // reveal。ここで champion が付く
    w.endsAt = Date.now() - 1;             // 同時に10分も過ぎた
    R.advance(room);
    assertEqual(R.resultView(room).優勝, true, '優勝が勝つ');
  });

  await r.test('締め切りは「段階の期限」と「10分」の早い方（門の文書4-3）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { cfg: { limitSec: 60 } });
    const w = w_(room);
    // 全体の期限を、すぐ先に引き寄せる
    w.endsAt = Date.now() + 200;
    rush(room);                            // match → throw（throwSec は既定3秒）
    assert(w.deadline <= w.endsAt, '段階の期限が全体の期限を追い越さない');
  });

  // ---------- 門U15：抜けた人・途中参加 ----------

  await r.test('対戦中に抜けたら、相手の勝ち（指示書2-9・落とし穴17）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 41 });
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    room.members.delete(組.a);             // 退室
    R.reapGone(room);
    assertEqual(組.done, true, 'その組は畳まれた');
    assertEqual(組.winner, 組.b, '残った方の勝ち');
    assertEqual(w_(room).状態[組.b].段, 1, '勝ったので1つ上');
  });

  await r.test('**AI戦の最中に抜けたら、何も起きない**（指示書2-9・AIのidを公開しない）', async () => {
    const { room } = start(['あき', 'びび', 'ちか'], { seed: 3 });
    const w = w_(room);
    w.状態.m2.段 = 4;
    w.phase = R.PHASE.REVEAL; w.endsAt = Date.now() + 600000;
    R.liveMatches(room).forEach((m) => { m.done = true; });
    R.advance(room);
    const 機械 = w.matches.filter((m) => m.機械)[0];
    assert(!!機械, 'AI戦がある');
    const 前段 = w.状態[機械.a].段;
    room.members.delete(機械.a);
    R.reapGone(room);
    assertEqual(機械.winner, null, '勝者を立てない');
    assertEqual(機械.引き分け, true, '引き分け扱いで畳む');
    assertEqual(w.状態[機械.a].段, 前段, '段も動かない');
    // **勝者の欄は id ではなく 'a'/'b'。**id で言うと、AIが勝った回に
    // 名簿に無いidが勝者として公開される（2-2 は「AIは10%で勝つ」と決めている）
    const 行 = pv(room).matches.find((x) => x.a === 機械.a);
    assertEqual(行.winner, null, '勝者の欄は空');
    pv(room).matches.forEach((x) => {
      assert(x.winner === null || x.winner === 'a' || x.winner === 'b',
        '勝者は id ではなく a/b で言う');
    });
  });

  await r.test('切断は「抜けた」にしない。待たないだけ（rcard-room.js:434-445 と同じ判断）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん'], { seed: 43 });
    toThrow(room);
    room.members.get('m0').connected = false;
    R.reapGone(room);
    assertEqual(w_(room).gone.indexOf('m0'), -1, 'gone に入らない');
    assertEqual(R.expectedMembers(room).indexOf('m0'), -1, 'でも待たない');
    room.members.get('m0').connected = true;
    assert(R.expectedMembers(room).indexOf('m0') !== -1, '戻ったら、また待つ');
  });

  await r.test('**途中から入った人は、次の回から最下段で入る**（門の文書4-2・空白画面を作らない）', async () => {
    const { room } = start(['あき', 'びび', 'ちか'], { seed: 51 });
    const w = w_(room);
    // 1回まわす。**全員グーだと あいこ**で回が進まないので、手を分けて決着させる
    rush(room);
    R.liveMatches(room).forEach((m, i) => {
      if (w_(room).playerIds.indexOf(m.a) !== -1) 送る(room, m.a, { hand: 'g' });
      if (w_(room).playerIds.indexOf(m.b) !== -1) 送る(room, m.b, { hand: 'c' });
    });
    rush(room);
    assertEqual(w_(room).phase, R.PHASE.REVEAL, 'reveal に来た');
    assertEqual(R.liveMatches(room).length, 0, '組は全部決着した');
    // 途中参加
    room.members.set('m9', { id: 'm9', name: 'えみ', role: 'player', connected: true, readyGame: null });
    assertEqual(R.privateFor(room, 'm9'), null, '入る前は、まだ何も配られない');
    rush(room);                            // reveal → 次の回
    assert(w.playerIds.indexOf('m9') !== -1, '次の回から名簿に入った');
    assertEqual(w.状態.m9.段, 0, '最下段から');
    const 手元 = you(room, 'm9');
    assert(!!手元, '手元に配られるようになった（空白の画面にならない）');
    assertEqual(手元.myRank, 0, '自分の段が返る');
  });

  // ---------- 不戦勝（本人の裁定・論点①） ----------

  await r.test('相手がいなかった人は、**その回は何も動かない**（本人の裁定・論点①(a)）', async () => {
    const { room } = start(['あき', 'びび', 'ちか'], { seed: 61 });
    const w = w_(room);
    const v = pv(room);
    // 3人・全員同じ段なら、必ず1人あぶれる（門の文書1-1）
    assertEqual(v.byeIds.length, 1, '1人あぶれた（条件が作れている）');
    const 余 = v.byeIds[0];
    // **基準は「始まった時の段」＝0。**
    // ここを `w.状態[余].段` から取ると、**組を作る時に上げる実装**を素通りさせる——
    // 組は start() の中で既に作られているので、読んだ時にはもう上がっている
    //（変異 55-2-P6 が実際に素通りした。落とし穴10-b：条件が作れていない）
    assertEqual(w.状態[余].段, 0, '組を作った時点で、もう上がっていない');
    assertEqual(w.状態[余].連敗, 0, '連敗も0のまま');
    rush(room); throwAll(room); rush(room);
    assertEqual(w.状態[余].段, 0, '1回まわしても、段は0のまま（不戦勝で上げない・禁止）');
    assertEqual(w.状態[余].連敗, 0, '連敗も数えない');
    assertEqual(you(room, 余).isBye, true, '本人には「今回はおやすみ」と伝わる');
  });

  await r.test('**AIの手は、相手の手を見てから決まる**（指示書2-2・変異55-2-P7 の穴）', async () => {
    // 進行役を通した時の勝率を測る。**相手の手を見ずに引くと、3すくみの一様分布（33%）に落ちる**。
    // ルール層の分布検査（tests/shinka-logic.js）だけでは、この呼び方の間違いを捕まえられない
    let 勝 = 0, 負 = 0, 分 = 0;
    for (let s = 1; s <= 120; s++) {
      const { room } = start(['あき', 'びび', 'ちか'], { seed: s });
      const w = w_(room);
      w.状態.m2.段 = 4;                       // m2 を最上段に1人 → 必ずAI戦になる
      w.phase = R.PHASE.REVEAL; w.endsAt = Date.now() + 600000;
      R.liveMatches(room).forEach((m) => { m.done = true; });
      R.advance(room);
      const 機械 = w.matches.filter((m) => m.機械)[0];
      if (!機械) continue;
      rush(room);                             // match → throw
      送る(room, 機械.a, { hand: 'g' });       // **いつもグー**
      rush(room);                             // throw → 開く
      if (機械.引き分け || !機械.done) 分++;
      else if (機械.winner === 機械.a) 勝++;
      else 負++;
    }
    const 全 = 勝 + 負 + 分;
    assert(全 >= 100, '条件が作れている（AI戦が ' + 全 + ' 回できた）');
    const 勝率 = 100 * 勝 / 全;
    // 1回ぶんの分布は 75/10/15。**相手の手を見ないと 33% 前後まで落ちる**
    assert(勝率 > 60, '人の勝ちが 60% を超える（実測 ' + 勝率.toFixed(1) + '%）');
  });

  await r.test('**挑戦者は「段が低い方」。部品Aの印では決めない**（変異55-2-P8 の穴）', async () => {
    // 部品Aは `a` に「希望が当たった人」を入れるので、
    // **肩慣らしの向きで組まれると a が上のランクになる**（門の文書1-5）。
    // そのまま `挑戦者 = g.a` と書くと、特典が上下逆に付く
    let 見た = 0, 逆 = 0;
    for (let s = 1; s <= 200; s++) {
      const { room } = start(['あき', 'びび', 'ちか'], { seed: s });
      const w = w_(room);
      w.状態.m0.段 = 5; w.状態.m1.段 = 6; w.状態.m2.段 = 0;   // m0 と m1 は、どちらも1人ランク
      w.直前の相手 = {};
      w.phase = R.PHASE.REVEAL; w.endsAt = Date.now() + 600000;
      R.liveMatches(room).forEach((m) => { m.done = true; });
      R.advance(room);
      w.matches.filter((m) => m.種別 === L.種別.挑戦).forEach((m) => {
        見た++;
        if (w.状態[m.挑戦者].段 >= w.状態[m.受け].段) 逆++;
      });
    }
    assert(見た > 0, '挑戦の組が作れている（' + 見た + '件）');
    assertEqual(逆, 0, '挑戦者は必ず、段が低い方（' + 見た + '件すべて）');
  });

  await r.test('あぶれた人は、次の回でいちばん先に組ませる（連続でおやすみにしない）', async () => {
    const { room } = start(['あき', 'びび', 'ちか'], { seed: 61 });
    const w = w_(room);
    const 初回のおやすみ = pv(room).byeIds[0];
    assertEqual(w.直前の不戦勝, 初回のおやすみ, '部品Aへ渡す人を覚えている');
    // **配列ではなく1人分**（部品Aは配列を黙って無視する・門の文書1-6）
    assertEqual(typeof w.直前の不戦勝, 'string', '1人分の id を渡している');
  });

  // ---------- 時計（正本 §11-4） ----------

  await r.test('時計の種類：手を出す3秒は play、発表は tick（正本 §11-4）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん']);
    assertEqual(R.clockKind(room), 'tick', 'match は誰も待っていない');
    rush(room);
    assertEqual(R.clockKind(room), 'play', 'throw は全員が同時に動く');
    throwAll(room); rush(room);
    assertEqual(R.clockKind(room), 'tick', 'reveal も誰も待っていない');
  });

  // ---------- 芯との約束 ----------

  await r.test('芯が呼ぶ形（4引数）で受ける（rcard-room.js:404-414 が実サーバーで踏んだ形）', async () => {
    const { room } = start(['あき', 'びび', 'ちか', 'でん']);
    toThrow(room);
    const 組 = R.liveMatches(room).filter((m) => !m.機械)[0];
    // realtime.js:1404 と同じ呼び方
    const res = R.submitAction(room, 組.a, null, { hand: 'g' });
    assertEqual(res.ok, true, '4引数で通る');
    assertEqual(R.submitAction(room, 'よその人', null, { hand: 'g' }).error, 'not_player', '名簿に無い人は弾く');
    assertEqual(R.submitAction(room, 組.b, null, { hand: 'ねつ造' }).error, 'bad_hand', '知らない手は弾く');
  });

  await r.test('進行役の約束の形が、1つも欠けていない', async () => {
    ['startGame', 'publicView', 'privateFor', 'submitAction', 'submitVote',
      'isAllDone', 'advance', 'expectedMembers', 'resultView', 'reapGone', 'clockKind']
      .forEach((k) => assertEqual(typeof R[k], 'function', k + ' がある'));
  });

  r.finish();
})();
