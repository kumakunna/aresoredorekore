// falsetrue-room.js — 1人1台の「False or True」の進行（指示53）
//
// 設計の芯は auction-room.js / bomb-room.js と同じ：
//   ルール（中身の数・結果表・相手の選び方）は falsetrue-logic.js をそのまま使う。
//   **数字はここに書かない。** 全部 FalseTrueLogic から読む。
//   状態はサーバーが持ち、端末は「自分に見せてよいものだけ」を受け取る。
//   このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。
//
// ======================= 秘密の扱い（門Q4・いちばん重い） =======================
// **ケースの中身（true/false）と、その並びは、publicView に一度も入らない。**
// 入れた瞬間、大画面を見ている全員に答えが渡る——このゲームは中身が1ビットしかないので、
// 漏れたらそのラウンドが完全に終わる。
//
//   もの                          | 本人 | 対面相手 | 他 | 大画面 | 公開スナップショット
//   持っているケースの中身        |  ○  |    ✕    | ✕ |   ✕   | ✕
//   全ケースの中身の並び          |  ✕  |    ✕    | ✕ |   ✕   | ✕（サーバーだけ）
//   誰が見たか・見終わったか      |  ○  |    ○    | ○ |   ○   | ○
//   対面ペア・残り時間            |  ○  |    ○    | ○ |   ○   | ○
//   奪う/奪わない（決める前）     |  ✕  |    ○    | ✕ |   ✕   | ✕
//   結果（開いたあとの中身）     |  ○  |    ○    | ○ |   ○   | ○
//
// **「書かないことによる保証」にしない。** publicView は白名簿で組み立て、
// `w.contents` を読む場所は openedView() ただ1つ（開いた番号しか通さない）。
//
// ======================= 段階 =======================
//   pick   … 選ぶ人がケースを1つ選ぶ（他は待つ）
//   peek   … 選んだ本人だけが中身を見る
//   face   … 対面相手の発表（誰も待っていない・時計で進む）
//   talk   … 話し合い（両者が「話し終わった」を押したら早く切り上げる・本人の裁定④）
//   decide … 相手が「奪う／奪わない」を決める
//   open   … ケースが開く＝結果（誰も待っていない・時計で進む）
//            **`reveal` と名付けない**——`RT_PHASE_LABEL`（index.html）は
//            ゲームをまたいだ1枚の表で、`reveal` はワードウルフの
//            「お題の確認」に取られている。同じ鍵を使うと、上帯と大画面に
//            別のゲームの言葉が出る（落とし穴2：借りた言葉が世界観ごと漏れる）
//   ended  … 決着
//
// ======================= 進み方の芯（落とし穴1の予防） =======================
// 段階を動かす道は **nextPhase() ただ1本**。
// 「押して進む」も「締め切りで進む」も「人が居なくなって進む」も、全部ここを通る。
// 締め切りで来た時だけ、通る前に既定（DEFAULT_ON_TIMEOUT）を埋める。

const path = require('path');
const L = require(path.join(__dirname, 'public', 'js', 'falsetrue-logic.js'));

const R = L.RULES;

const PHASE = {
  LOBBY: 'lobby',
  PICK: 'pick',
  PEEK: 'peek',
  FACE: 'face',
  TALK: 'talk',
  DECIDE: 'decide',
  OPEN: 'open',
  ENDED: 'ended'
};

/** その段階で操作を待つ人が居る段階。face と reveal は**わざと入れない**
 *  （落とし穴22：誰も待っていない段階を芯に「飛ばしてよい」と思わせない。
 *   見せるための段階なので、時計で進む） */
const WAITING_PHASES = [PHASE.PICK, PHASE.PEEK, PHASE.TALK, PHASE.DECIDE];

function now() { return Date.now(); }

/**
 * このゲームの「くじ」。中身の並び・最初に選ぶ人・対面の相手の3か所で引く。
 *
 * **部屋の状態オブジェクトには入れない**——`w` は純粋なデータのままにしておく
 * （芯の `shiftTimes` が中を歩くし、丸ごと写す処理が将来できても壊れない）。
 * 検査は `startGame(room, { _rand })` で差し込めるので、
 * **同じ種で何度でも同じ進行を作れる**——秘匿の差分検査はこれが無いと書けない。
 */
const RANDS = new WeakMap();
function randOf(room) {
  return RANDS.get(room.falsetrue) || Math.random;
}

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
/** まだ部屋に居るか（退室・kick で room.members から消える） */
function isPresent(room, id) { return room.members.has(id); }
/** いま繋がっているか（切断は「待たない」が、まだプレイヤーではある） */
function isLive(room, id) {
  const m = room.members.get(id);
  return !!(m && m.connected);
}

/** まだ生存も脱落も決まっておらず、部屋にも居る人 */
function undecidedIds(room) {
  const w = room.falsetrue;
  return w.playerIds.filter((id) => !w.fate[id] && w.gone.indexOf(id) === -1);
}

// ================= 段階を切り替える唯一の場所 =================
function setPhase(room, phase, sec) {
  const w = room.falsetrue;
  w.phase = phase;
  room.state.phase = phase;
  w.deadline = sec > 0 ? now() + sec * 1000 : null;
}

// ================= 始める =================
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < R.MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: R.MIN_PLAYERS + '人以上必要です' };
  }
  if (members.length > R.MAX_PLAYERS) {
    return { ok: false, error: 'too_many_players', message: R.MAX_PLAYERS + '人までです' };
  }
  const cfg = L.normalizeConfig(config);
  const ids = members.map((m) => m.id);
  const names = {};
  members.forEach((m) => { names[m.id] = m.name; });

  const n = ids.length;
  const rand = (config && config._rand) || Math.random;
  const w = {
    talkSec: cfg.talkSec,
    playerIds: ids,
    names: names,

    // ---- 秘密の正本。**publicView には一度も入らない** ----
    contents: L.makeContents(n, rand),

    // ---- 公開してよいもの ----
    caseTotal: L.caseCount(n),
    trueTotal: L.trueCount(n),
    falseTotal: L.falseCount(n),
    remaining: Array.from({ length: L.caseCount(n) }, (_, i) => i + 1),
    opened: {},          // 開いた番号 → true/false（開いた分だけ公開）
    discarded: [],       // 中身を見た人が抜けて消えた番号

    // ---- ラウンドごと ----
    round: 0,
    pickerId: ids[Math.floor(rand() * ids.length)],
    oppId: null,
    heldNo: null,
    peeked: false,
    talkDone: {},
    choice: null,

    // ---- ゲーム通算 ----
    fate: {},
    gone: [],
    everFaced: [],
    history: [],
    last: null,
    endReason: null,
    recorded: false,
    phase: PHASE.LOBBY,
    deadline: null
  };
  room.falsetrue = w;
  RANDS.set(w, rand);
  room.state.game = 'falsetrue';

  beginRound(room);
  if (ctx && ctx.notify) ctx.notify(room);
  return { ok: true };
}

// ================= ラウンド =================
function beginRound(room) {
  const w = room.falsetrue;
  w.heldNo = null;
  w.peeked = false;
  w.oppId = null;
  w.choice = null;
  w.talkDone = {};
  if (finishIfOver(room)) return true;
  // 選ぶ人が居なくなっていたら、残っている人から選び直す
  const 残り = undecidedIds(room);
  if (残り.indexOf(w.pickerId) === -1) w.pickerId = 残り[0] || null;
  if (!w.pickerId) return finishIfOver(room);
  w.round++;
  setPhase(room, PHASE.PICK, R.PICK_SEC);
  return true;
}

/** 終わっていれば終わらせる。終了条件は falsetrue-logic の endReason ただ1つ */
function finishIfOver(room) {
  const w = room.falsetrue;
  if (w.phase === PHASE.ENDED) return true;
  const why = L.endReason(undecidedIds(room).length, w.remaining.length);
  if (!why) return false;
  // 残っている人は全員生存（1人残り＝対面する相手がいない／ケース尽き＝運が悪いだけ）
  undecidedIds(room).forEach((id) => { w.fate[id] = 'alive'; });
  w.endReason = why;
  w.pickerId = null;
  w.oppId = null;
  w.heldNo = null;
  setPhase(room, PHASE.ENDED, 0);
  return true;
}

// ================= 段階を進める唯一の道 =================
function nextPhase(room) {
  const w = room.falsetrue;
  switch (w.phase) {
    case PHASE.PICK: return beginPeek(room);
    case PHASE.PEEK: return beginFace(room);
    case PHASE.FACE: return beginTalk(room);
    case PHASE.TALK: return beginDecide(room);
    case PHASE.DECIDE: return settleRound(room);
    case PHASE.OPEN: return beginRound(room);
    default: return false;
  }
}

function beginPeek(room) {
  setPhase(room, PHASE.PEEK, R.PEEK_SEC);
  return true;
}

function beginFace(room) {
  const w = room.falsetrue;
  const pool = L.opponentPool(undecidedIds(room), w.pickerId, w.everFaced);
  if (!pool.length) return finishIfOver(room) || beginRound(room);
  w.oppId = pool[Math.floor(randOf(room)() * pool.length)];
  if (w.everFaced.indexOf(w.pickerId) === -1) w.everFaced.push(w.pickerId);
  if (w.everFaced.indexOf(w.oppId) === -1) w.everFaced.push(w.oppId);
  setPhase(room, PHASE.FACE, R.FACE_SEC);
  return true;
}

function beginTalk(room) {
  const w = room.falsetrue;
  setPhase(room, PHASE.TALK, w.talkSec);
  return true;
}

function beginDecide(room) {
  setPhase(room, PHASE.DECIDE, R.DECIDE_SEC);
  return true;
}

/**
 * 決着（設計メモ 7 の表）。**判定はここ1か所**で、表は falsetrue-logic の OUTCOME。
 * ここで初めて中身が opened に入る＝publicView に出てよくなる。
 */
function settleRound(room) {
  const w = room.falsetrue;
  const no = w.heldNo;
  const content = w.contents[no - 1];
  const taken = w.choice === 'take';
  const o = L.outcomeOf(taken, content);

  const decidedId = o.決まる === 'opp' ? w.oppId : w.pickerId;
  w.fate[decidedId] = o.fate;
  w.opened[no] = content;          // ← 中身が公開されるのは、この1行だけ

  w.last = {
    round: w.round,
    no: no,
    content: content,
    taken: taken,
    holderId: w.pickerId, holderName: w.names[w.pickerId],
    oppId: w.oppId, oppName: w.names[w.oppId],
    decidedId: decidedId, decidedName: w.names[decidedId],
    fate: o.fate
  };
  w.history.push(w.last);

  // 次に選ぶ人。奪う＝持ち主が続投／奪わない＝相手が選ぶ側になる
  w.pickerId = o.次の選ぶ人 === 'holder' ? w.pickerId : w.oppId;
  setPhase(room, PHASE.OPEN, R.REVEAL_SEC);
  return true;
}

// ================= 人が居なくなった時（指示53 2-8・落とし穴17） =================
/**
 * **退室・kick で部屋から消えた人**を拾う。切断はここでは拾わない
 * （戻ってこられるので、プレイヤーのままにしておく。ただし「待たない」）。
 * 戻り値は「いまのラウンドが崩れたか」。
 */
function reapGone(room) {
  const w = room.falsetrue;
  let 崩れた = false;
  w.playerIds.forEach((id) => {
    if (w.gone.indexOf(id) !== -1) return;
    if (isPresent(room, id)) return;
    w.gone.push(id);
    // すでに生存／脱落が決まっていた人の運命は**消さない**（そこで上がっている）
    if (id === w.pickerId) {
      // 選ぶ人／持ち主が抜けた。
      // **中身を見た人が抜けたケースは、選択欄に戻さず消える**（指示53 2-8）
      if (w.heldNo != null) { w.discarded.push(w.heldNo); w.heldNo = null; }
      w.pickerId = null;
      崩れた = true;
    }
    if (id === w.oppId) {
      // 対面相手が抜けた → その対面は流れる。持っている人はケースを持ったまま
      w.oppId = null;
      崩れた = true;
    }
  });
  return 崩れた;
}

/** 締め切りで来た時に、押さなかった人のぶんを埋める（押さなくても止まらない） */
function fillDefaults(room) {
  const w = room.falsetrue;
  if (w.phase === PHASE.PICK && w.heldNo == null) {
    if (L.DEFAULT_ON_TIMEOUT.pick === 'lowest' && w.remaining.length) {
      takeCase(room, Math.min.apply(null, w.remaining));
    }
  }
  if (w.phase === PHASE.PEEK && L.DEFAULT_ON_TIMEOUT.peek === 'seen') w.peeked = true;
  if (w.phase === PHASE.DECIDE && !w.choice) {
    w.choice = L.DEFAULT_ON_TIMEOUT.decide === 'keep' ? 'keep' : 'take';
  }
}

function takeCase(room, no) {
  const w = room.falsetrue;
  const i = w.remaining.indexOf(no);
  if (i === -1) return false;
  w.remaining.splice(i, 1);
  w.heldNo = no;
  return true;
}

// ================= 芯（realtime.js）から呼ばれる =================
/**
 * その段階で「押すのを待っている人」。
 * face と reveal は誰も待っていない＝空（時計で進む）。
 */
function expectedMembers(room) {
  const w = room.falsetrue;
  if (!w || WAITING_PHASES.indexOf(w.phase) === -1) return [];
  if (w.phase === PHASE.PICK || w.phase === PHASE.PEEK) {
    return w.pickerId ? [w.pickerId] : [];
  }
  if (w.phase === PHASE.TALK) {
    return [w.pickerId, w.oppId].filter(Boolean);
  }
  return w.oppId ? [w.oppId] : [];   // decide
}

/** いまのラウンドが成り立つために要る人（選ぶ人と、決まっていれば対面の相手） */
function roundMembers(room) {
  const w = room.falsetrue;
  return [w.pickerId, w.oppId].filter(Boolean);
}

/**
 * **誰かが居なくなった直後**に芯が見る。真を返すと advance が呼ばれる。
 *
 * 見るものは2つ、**わざと分けてある**：
 *   ① **部屋から消えた**（退室・kick）… どの段階でも片付けが要る。
 *      face と reveal は誰も押さないが、対面の相手が消えたら
 *      その対面はもう成り立たない——**段階で決めると、ここを取りこぼす**
 *   ② **繋がっていない**（切断）… 押すのを待っている段階でだけ意味がある。
 *      切れた人は待たないが、戻ってこられるのでプレイヤーのままにしておく
 *
 * **誰も繋がっていない時は、あえて false を返す。**
 * そこで決着させると、全員の電波が一度に切れただけで部屋が壊れる——
 * 空の部屋は `emptySince` の時間だけ残り、戻ってくれば同じ段階から続けられる。
 * どの段階にも締め切りがあるので、これで止まったままにはならない。
 */
function isAllDone(room) {
  const w = room.falsetrue;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return false;
  // ① 部屋から消えた人が、いまのラウンドに要る人だったら、どの段階でも片付ける
  if (roundMembers(room).some((id) => !isPresent(room, id))) return true;
  // ② 押すのを待っている人が切れている
  const waiting = expectedMembers(room);
  if (!waiting.length) return false;
  if (!waiting.some((id) => isLive(room, id))) {
    // 待っている人が全員切れている。ただし**部屋に誰も繋がっていない**なら、何もしない
    return undecidedIds(room).some((id) => isLive(room, id));
  }
  return false;
}

/**
 * 段階を1つ進める。**締め切り・ホストの「すすめる」・人が居なくなった時**の3経路が、
 * 全部ここに集まる（落とし穴17）。
 */
function advance(room) {
  const w = room.falsetrue;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return false;

  const 崩れた = reapGone(room);
  if (finishIfOver(room)) return true;

  if (崩れた) {
    // 対面が流れただけで、持ち主はケースを持ったまま → 相手を選び直す
    if (w.pickerId && w.heldNo != null) return beginFace(room);
    // 持ち主ごと消えた → 次の人から選び直す
    return beginRound(room);
  }
  fillDefaults(room);
  return nextPhase(room);
}

// ================= 見せるもの =================
/**
 * **開いた中身だけを通す**。`w.contents` を読むのはこの関数ただ1つ。
 * ここを通らないかぎり、中身は publicView に出ない
 */
function openedView(w) {
  const out = {};
  Object.keys(w.opened).forEach((no) => { out[no] = w.opened[no]; });
  return out;
}

/**
 * 部屋の全員（大画面を含む）に配られる。
 * **白名簿で組み立てる**——`w` を丸ごと写さないので、
 * あとで秘密の入れ物を足しても、ここに書かないかぎり漏れない
 */
function publicView(room) {
  const w = room.falsetrue;
  if (!w) return { phase: PHASE.LOBBY };
  const 見せる決着 = w.phase === PHASE.OPEN || w.phase === PHASE.ENDED;
  return {
    phase: w.phase,
    round: w.round,
    talkSec: w.talkSec,
    remainingMs: w.deadline ? Math.max(0, w.deadline - now()) : 0,

    // ケースは**番号だけ**。見た目は全部同じ（指示53 2-3）
    cases: w.remaining.slice(),
    caseTotal: w.caseTotal,
    trueTotal: w.trueTotal,
    falseTotal: w.falseTotal,
    discarded: w.discarded.slice(),
    opened: openedView(w),          // ← 開いた分だけ

    // 対面（誰が持っていて、誰が決めるか）。**中身は入らない**
    holderId: w.pickerId,
    holderName: w.pickerId ? w.names[w.pickerId] : null,
    oppId: w.oppId,
    oppName: w.oppId ? w.names[w.oppId] : null,
    heldNo: w.heldNo,
    peeked: w.peeked,
    talkReady: Object.keys(w.talkDone),

    players: w.playerIds.map((id) => ({
      id: id,
      name: w.names[id],
      connected: isLive(room, id),
      gone: w.gone.indexOf(id) !== -1,
      fate: w.fate[id] || null
    })),

    last: 見せる決着 ? w.last : null,
    endReason: w.phase === PHASE.ENDED ? w.endReason : null,
    history: w.phase === PHASE.ENDED ? w.history.slice() : null,
    survivors: w.phase === PHASE.ENDED
      ? w.playerIds.filter((id) => w.fate[id] === 'alive').map((id) => ({ id: id, name: w.names[id] }))
      : null
  };
}

/**
 * その人の端末にだけ届く。**プレイヤーでない相手（大画面・観戦）には必ず null**。
 * 先頭に phase を入れるのは落とし穴18 のため——部屋の知らせと順不同で届くので、
 * 端末が「自分の秘密がどの段階のものか」を照合できる必要がある
 */
function privateFor(room, memberId) {
  const w = room.falsetrue;
  if (!w || w.playerIds.indexOf(memberId) === -1) return null;
  const 持ち主 = memberId === w.pickerId;
  const 相手 = memberId === w.oppId;
  // 中身を見てよいのは**持ち主だけ**。しかも peek に入ってから
  const 見てよい = 持ち主 && w.heldNo != null &&
    [PHASE.PEEK, PHASE.FACE, PHASE.TALK, PHASE.DECIDE, PHASE.OPEN].indexOf(w.phase) !== -1;
  return {
    phase: w.phase,
    round: w.round,
    youAre: 持ち主 ? 'holder' : (相手 ? 'opp' : 'watch'),
    myContent: 見てよい ? w.contents[w.heldNo - 1] : null,
    myChoice: 相手 ? w.choice : null,
    talkDone: !!w.talkDone[memberId],
    fate: w.fate[memberId] || null,
    gone: w.gone.indexOf(memberId) !== -1
  };
}

// ================= 操作 =================
/**
 *   { pick: 3 }       … ケースを選ぶ（選ぶ人だけ・pick の間だけ）
 *   { seen: true }    … 中身を見終わった（持ち主だけ・peek の間だけ）
 *   { talkDone:true } … 話し終わった（対面の2人だけ・talk の間だけ。両者で切り上げ）
 *   { take: true }    … 奪う   （相手だけ・decide の間だけ）
 *   { keep: true }    … 奪わない（同上）
 */
function submitAction(room, memberId, targetId, payload) {
  const w = room.falsetrue;
  if (!w || w.phase === PHASE.ENDED || w.phase === PHASE.LOBBY) return { ok: false, error: 'not_playing' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_player' };
  const p = payload || {};

  if (p.pick !== undefined || targetId != null) {
    if (w.phase !== PHASE.PICK) return { ok: false, error: 'not_pick' };
    if (memberId !== w.pickerId) return { ok: false, error: 'not_picker' };
    // **二度選ばせない。**押した直後に芯が段階を進めるまでの隙に届いた2回目を通すと、
    // 1枚目が remaining から抜けたまま誰の手にも残らず、静かに消える
    if (w.heldNo != null) return { ok: false, error: 'already_picked' };
    // **端末が出す番号を信じない。**
    // `parseInt` で受けると 1.5 が 1 に、'3番' が 3 になって通ってしまう。
    // **整数そのもの（か、整数だけの文字列）でなければ断る**
    const raw = p.pick !== undefined ? p.pick : targetId;
    const no = (typeof raw === 'number') ? raw
      : (/^[0-9]+$/.test(String(raw)) ? Number(raw) : NaN);
    if (!Number.isInteger(no) || !takeCase(room, no)) return { ok: false, error: 'unknown_case' };
    return { ok: true, allDone: true };
  }

  if (p.seen) {
    if (w.phase !== PHASE.PEEK) return { ok: false, error: 'not_peek' };
    if (memberId !== w.pickerId) return { ok: false, error: 'not_holder' };
    w.peeked = true;
    return { ok: true, allDone: true };
  }

  if (p.talkDone) {
    // 本人の裁定④：両者が押したら早く切り上げる。
    // **片方だけでは切り上げない**（持ち主には、押さない自由がある）
    if (w.phase !== PHASE.TALK) return { ok: false, error: 'not_talk' };
    if (memberId !== w.pickerId && memberId !== w.oppId) return { ok: false, error: 'not_facing' };
    w.talkDone[memberId] = true;
    const 二人 = [w.pickerId, w.oppId].filter(Boolean);
    const そろった = 二人.every((id) => w.talkDone[id] || !isLive(room, id));
    return { ok: true, allDone: そろった };
  }

  if (p.take || p.keep) {
    if (w.phase !== PHASE.DECIDE) return { ok: false, error: 'not_decide' };
    if (memberId !== w.oppId) return { ok: false, error: 'not_opponent' };
    w.choice = p.take ? 'take' : 'keep';
    return { ok: true, allDone: true };
  }

  return { ok: false, error: 'unknown_action' };
}

/** 「奪う／奪わない」は投票の道から来てもよい（同じ処理を通す・二重に書かない） */
function submitVote(room, memberId, targetId, payload) {
  return submitAction(room, memberId, targetId, payload);
}

/** 記録に残す側（realtime.js）から参照する */
function resultView(room) {
  const w = room.falsetrue;
  if (!w) return null;
  return {
    endReason: w.endReason,
    rounds: w.history.length,
    players: w.playerIds.map((id) => ({
      id: id,
      name: w.names[id],
      fate: w.fate[id] || null,
      gone: w.gone.indexOf(id) !== -1
    })),
    survivors: w.playerIds.filter((id) => w.fate[id] === 'alive').map((id) => w.names[id]),
    history: w.history.slice()
  };
}

/**
 * 大画面と端末に出す「共通の時計」の種類（指示55・正本 §11-4）。
 * 'play' … 人が待っている締め切り。数えてよい
 * 'tick' … 画面が変わるだけの時刻。数えない
 * **必ず名乗る**（不在で表さない・落とし穴36）。`tests/room-paths.js` が両方向で見張る
 */
function clockKind() { return 'play'; }

module.exports = {
  PHASE, WAITING_PHASES,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView,
  undecidedIds, clockKind
};
