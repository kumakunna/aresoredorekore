// bomb-room.js — 1人1台モードの「クイズ解除」の進行（第27弾）
//
// 設計の芯は wordwolf-room.js / wolf-room.js とまったく同じ:
//   ルール（コードの抽選・3択・ミスの罰・順位）は bomb-logic.js をそのまま使い、作り直さない。
//   状態はサーバーが持ち、各端末は「自分の盤面だけ」を受け取って表示する。
//   このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。
//
// 2つの遊び方を1つの進行で扱う:
//   通常版（coop）… みんなで1つの爆弾。盤面・ライフ・残り時間を全員で共有する。
//                    誰がどのコードに挑戦中かは全員に見える。個人の成績も順位も付けない。
//   競争版（race）… 全員が同じコードに同時に挑む。並び順・ライフ・残り時間は各自別々。
//
//   共有するか各自別々かの違いは「entries（成績の入れ物）を1つにするか人数分にするか」
//   だけに閉じ込めてある（entryOf 参照）。ここを分岐で書くと、片方だけ直す事故になる。
//
// 秘密の扱い（原則4.3）:
//   コードの中身（お題の名前）と説明文は publicView に絶対に入れない。
//   説明文は「その人がいま開けているコード」のぶんだけ privateFor で配る。
//   競争版の説明文は、待機中にサーバーだけで作り、試合が始まるまで1文字も配らない。

const path = require('path');
const BombLogic = require(path.join(__dirname, 'public', 'js', 'bomb-logic.js'));
// 第32弾-A-3-6：出題は問題バンクから。ゲーム中にAIは呼ばない
const QuizBank = require(path.join(__dirname, 'public', 'js', 'quiz-bank.js'));

// 進行の段階。人狼・ワードウルフの PHASE とは別物
const PHASE = {
  LOBBY: 'lobby',
  PREP: 'prep',    // 待機中：AIの説明文を作っている。中身はまだ誰にも配らない
  PLAY: 'play',    // 解除中
  ENDED: 'ended'
};

// 説明文を作る同時実行数。多くするとレート制限に当たりやすく、
// 少なくすると待ち時間が伸びる。3本が待合で耐えられる長さ（30本で10秒前後）
const PREP_CONCURRENCY = 3;
// 1本あたり、失敗しても1回だけやり直す（レート制限自体は ai-describe.js が面倒を見る）
const PREP_RETRY = 2;

const MIN_PLAYERS = 2;
const TEAM_KEY = 'team'; // 通常版で、全員がひとつの入れ物を共有するときの鍵

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}

// ---- 成績の入れ物 ----
// 通常版なら全員が同じものを、競争版なら自分のものを指す。
// これがあるおかげで、ライフもミスも解けた数も「1つの書き方」で済む
function entryOf(w, memberId) {
  if (!w) return null;
  return w.entries[w.mode === BombLogic.MODE.COOP ? TEAM_KEY : memberId] || null;
}
function allEntries(w) {
  return Object.keys(w.entries).map((k) => w.entries[k]);
}
function entryActive(e) {
  return !!e && !e.failed && !e.timedOut && e.finishedAt == null;
}
// まだ解除を続けている人（切れている人は待たない。ワードウルフの expectedMembers と同じ考え）
function activeMembers(room) {
  const w = room.bomb;
  if (!w) return [];
  return w.playerIds.filter((id) => {
    const m = room.members.get(id);
    if (!m || !m.connected) return false;
    return entryActive(entryOf(w, id));
  });
}

/**
 * コードの並び順を決める。
 * 第28弾-1：難易度別に並べる選択肢は無くしたので、必ず全部を混ぜる。
 * 整列させると盤面がグラデーションに見え、どこが難しいかが一目で分かってしまう。
 * 競争版では各自ばらばらに引くので、隣の画面を見ても場所が一致しない。
 */
function orderFor(wires, rnd) {
  return BombLogic.shuffleWires(wires, rnd).map((x) => x.uid);
}

function makeEntry(w, order) {
  return {
    order: order,          // このひとに見せるコードの並び（uidの配列）
    solved: {},            // uid -> true
    choices: {},           // uid -> 3択（開けた時に作る）
    lives: w.lives,
    misses: 0,
    solvedCount: 0,
    lastSolveAt: null,     // 最後に正解した時刻（開始からのms）。順位の同点処理に使う
    finishedAt: null,      // 全部解いた時刻（開始からのms）
    failed: false,         // ライフが0になった＝記録なし・最下位扱い
    timedOut: false,
    deadline: null         // 残り時間の終わり（epoch ms）。0秒設定なら null
  };
}

// ---- 開始 ----
/**
 * @param {object} room 部屋
 * @param {object} config 端末から届いた設定（mode / counts / lives / timerSec / endWhen / topics）
 * @param {object} ctx   realtime.js が渡す入り口 { describe, notify }
 *   describe … AIに説明文を作らせる（ai-describe.js）。テストからは差し替えられる
 *   notify   … 状態が動いたことを部屋の全員に伝える
 */
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: MIN_PLAYERS + '人以上必要です' };
  }
  const c = ctx || {};
  const cfg = BombLogic.normalizeConfig(config);
  const rnd = (config && config.rnd) || null;
  // 第32弾-A-3-6：問題バンクから作る。AIは呼ばないので、
  // 「説明文ができるまで待つ」段階そのものが無くなった
  const wires = BombLogic.pickQuestionWires(QuizBank, cfg.counts, rnd, {});
  if (!wires.length) {
    return { ok: false, error: 'no_wires', message: 'コードが1本もありません。設定を見直してください' };
  }
  const topics = [];

  const ids = members.map((m) => m.id);
  const w = {
    mode: cfg.mode,
    endWhen: cfg.endWhen,
    lives: cfg.lives,
    timerSec: cfg.timerSec,
    preset: cfg.preset,

    playerIds: ids,
    names: {},
    topics: topics,          // 3択のダミーを作るために持っておく（配らない）
    wires: wires,            // name / description は秘密。publicView に出さない

    ready: 0,                // 説明文ができた本数
    dropped: 0,              // 何度やってもAIが作れなかった本数
    aiError: null,

    entries: {},
    open: {},                // memberId -> いま開けている uid
    solvedBy: {},            // uid -> 解いた人（通常版の「誰が切ったか」の表示用）

    phase: PHASE.PREP,
    startedAt: null,
    deadline: null,          // realtime.js の時間切れ監視が見る（一番早い期限）
    result: null,
    recorded: false
  };
  members.forEach((m) => { w.names[m.id] = m.name; });

  if (cfg.mode === BombLogic.MODE.COOP) {
    w.entries[TEAM_KEY] = makeEntry(w, orderFor(wires, rnd));
  } else {
    ids.forEach((id) => { w.entries[id] = makeEntry(w, orderFor(wires, rnd)); });
  }

  room.bomb = w;
  room.state.game = 'bomb';
  // 第32弾-A-3-6：問題は最初から揃っているので、待つ段階を通らずにそのまま始める。
  // PREP そのものは残してある（画面・記録が段階名を見ているため）が、
  // ここを通り過ぎるので、遊ぶ人からは見えない
  w.ready = w.wires.length;
  finishPrep(room, c);
  return { ok: true };
}

/**
 * 待機中に、全コードの説明文をサーバー側だけで作る。
 * 試合が始まるまで publicView も privateFor も説明文を1文字も出さないので、
 * ここで作ったものは誰の端末にも届かない。
 */
async function prepare(room, ctx) {
  const w = room.bomb;
  if (!w) return;
  let next = 0;

  async function worker() {
    for (;;) {
      // 部屋が畳まれた・別のゲームを選び直された時は、静かにやめる
      if (room.bomb !== w) return;
      const i = next++;
      if (i >= w.wires.length) return;
      const wire = w.wires[i];
      let text = null;
      for (let attempt = 0; attempt < PREP_RETRY && !text; attempt++) {
        try {
          const res = await ctx.describe({ name: wire.name, ng_words: wire.ngWords });
          text = (res && res.description) ? String(res.description) : null;
        } catch (e) {
          // APIキーが無い等、やり直しても直らない失敗はその場でやめる
          if (e && (e.kind === 'no_key' || e.kind === 'bad_request')) {
            w.aiError = e.message || 'AIの説明文を作れませんでした';
            return;
          }
          text = null;
        }
      }
      if (room.bomb !== w) return;
      if (text) { wire.description = text; w.ready++; }
      else { w.dropped++; }
      if (ctx.notify) ctx.notify(room);
    }
  }

  const workers = [];
  for (let k = 0; k < PREP_CONCURRENCY; k++) workers.push(worker());
  await Promise.all(workers);
  if (room.bomb !== w || w.phase !== PHASE.PREP) return;
  finishPrep(room, ctx);
}

/**
 * 説明文がそろったら解除を始める。
 * 作れなかったコードは盤面から外す（開いても答えようがない「死んだコード」を置かない）。
 */
function finishPrep(room, ctx) {
  const w = room.bomb;
  const kept = w.wires.filter((x) => !!x.description);
  if (!kept.length) {
    w.phase = PHASE.ENDED;
    room.state.phase = PHASE.ENDED;
    w.result = {
      aborted: true,
      message: w.aiError || 'AIの説明文を1本も作れなかったので、始められませんでした'
    };
    if (ctx && ctx.notify) ctx.notify(room);
    return;
  }
  const alive = {};
  kept.forEach((x) => { alive[x.uid] = true; });
  w.wires = kept;
  allEntries(w).forEach((e) => { e.order = e.order.filter((uid) => alive[uid]); });

  w.phase = PHASE.PLAY;
  room.state.phase = PHASE.PLAY;
  w.startedAt = Date.now();
  if (w.timerSec > 0) {
    const end = w.startedAt + w.timerSec * 1000;
    allEntries(w).forEach((e) => { e.deadline = end; });
  }
  refreshDeadline(w);
  if (ctx && ctx.notify) ctx.notify(room);
}

/**
 * 残り時間は「あと何ミリ秒」で配る。期限（時刻）をそのまま配ると、
 * スマホの時計がずれている端末で残り時間が狂う（数分ずれている端末は珍しくない）。
 * 端末は受け取った数字から自分で1秒ずつ減らせばよい。
 */
function remainingMsOf(e) {
  if (!e || !e.deadline) return null;
  return Math.max(0, e.deadline - Date.now());
}

// realtime.js の時間切れ監視は room.bomb.deadline だけを見る。
// 競争版は人それぞれ期限が違うので、いちばん早いものを載せておく
function refreshDeadline(w) {
  if (w.phase !== PHASE.PLAY) { w.deadline = null; return; }
  let min = null;
  allEntries(w).forEach((e) => {
    if (!entryActive(e) || !e.deadline) return;
    if (min == null || e.deadline < min) min = e.deadline;
  });
  w.deadline = min;
}

// ---- 公開してよい情報だけ ----
// ここにお題の名前・説明文を混ぜると、大画面を含む全員に配られる。
function publicView(room) {
  const w = room.bomb;
  if (!w) return { phase: PHASE.LOBBY };
  const view = {
    phase: w.phase,
    mode: w.mode,
    endWhen: w.endWhen,
    total: w.wires.length,
    livesMax: w.lives,
    timerSec: w.timerSec,
    // 待機中の進み具合。中身は入っていない（本数だけ）
    prep: { ready: w.ready, dropped: w.dropped, total: w.wires.length },
    // 大画面のリーダーボード。難易度も進捗も公開情報だが、お題の名前は入れない
    players: w.playerIds.map((id) => {
      const e = entryOf(w, id);
      const m = room.members.get(id);
      const solved = e ? e.solvedCount : 0;
      return {
        id: id,
        name: w.names[id],
        connected: !!(m && m.connected),
        solved: solved,
        total: w.wires.length,
        pct: BombLogic.progressPct(solved, w.wires.length),
        lives: e ? Math.max(0, e.lives) : 0,
        livesMax: w.lives,
        misses: e ? e.misses : 0,
        failed: !!(e && e.failed),
        timedOut: !!(e && e.timedOut),
        finished: !!(e && e.finishedAt != null),
        // 誰がどのコードに挑戦中か。難易度までは見せる（お題の名前は見せない）
        working: workingTierOf(room, id),
        remainingMs: remainingMsOf(entryOf(w, id))
      };
    }),
    // 通常版は全員で1つの時計。競争版は「いちばん早く終わる人」の残り時間
    remainingMs: remainingMsOf(w.mode === BombLogic.MODE.COOP ? w.entries[TEAM_KEY] : null)
  };
  if (w.mode === BombLogic.MODE.COOP) {
    const team = w.entries[TEAM_KEY];
    view.team = {
      solved: team.solvedCount,
      total: w.wires.length,
      pct: BombLogic.progressPct(team.solvedCount, w.wires.length),
      lives: Math.max(0, team.lives),
      livesMax: w.lives,
      misses: team.misses
    };
    // 通常版は全員が同じ盤面を見るので、盤面そのものは公開情報。
    // ただし入れるのは「難易度・解除済みか・誰が挑戦中か」だけ
    view.board = team.order.map((uid) => boardCell(room, w, uid));
  }
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}

// 盤面のマス。お題の名前も説明文も、ここには絶対に入れない
function boardCell(room, w, uid) {
  const wire = w.wires.find((x) => x.uid === uid);
  const team = w.entries[TEAM_KEY];
  const holder = holderOf(room, uid);
  return {
    uid: uid,
    tier: wire ? wire.tier : null,
    solved: !!(team && team.solved[uid]),
    solvedBy: w.solvedBy[uid] ? w.names[w.solvedBy[uid]] : null,
    by: holder ? w.names[holder] : null
  };
}

// 通常版で、そのコードをいま開けている人（同時に2人が挑まないようにするため）
function holderOf(room, uid) {
  const w = room.bomb;
  if (!w || w.mode !== BombLogic.MODE.COOP) return null;
  const ids = Object.keys(w.open).filter((mid) => w.open[mid] === uid);
  for (const mid of ids) {
    const m = room.members.get(mid);
    if (m && m.connected) return mid;
  }
  return null;
}

// その人がいま挑戦中のコードの難易度。開けていなければ null
function workingTierOf(room, memberId) {
  const w = room.bomb;
  const uid = w.open[memberId];
  if (!uid) return null;
  const wire = w.wires.find((x) => x.uid === uid);
  return wire ? wire.tier : null;
}

// 決着したこの瞬間だけ、答え合わせのために中身を開ける（試合中は絶対に出さない）
function resultView(room) {
  const w = room.bomb;
  if (w.result && w.result.aborted) return w.result;
  const out = {
    mode: w.mode,
    total: w.wires.length,
    elapsedSec: w.startedAt ? Math.round(((w.endedAt || Date.now()) - w.startedAt) / 1000) : 0,
    // 何で終わったか。どちらの遊び方でも残す（記録を見返した時に、
    // 時間切れだったのか解き切ったのかが分かるように）
    cause: (w.result && w.result.cause) || null,
    codes: w.wires.map((x) => ({
      tier: x.tier,
      name: x.name,
      solved: w.mode === BombLogic.MODE.COOP ? !!w.entries[TEAM_KEY].solved[x.uid] : null
    }))
  };
  if (w.mode === BombLogic.MODE.COOP) {
    const team = w.entries[TEAM_KEY];
    out.success = !!(w.result && w.result.success);
    out.solved = team.solvedCount;
    out.lives = Math.max(0, team.lives);
    out.livesMax = w.lives;
    out.misses = team.misses;
  } else {
    out.ranking = BombLogic.rankPlayers(w.playerIds.map((id) => {
      const e = w.entries[id];
      return {
        id: id, name: w.names[id],
        solved: e.solvedCount, lastSolveAt: e.lastSolveAt,
        failed: e.failed, timedOut: e.timedOut,
        misses: e.misses, lives: Math.max(0, e.lives),
        finished: e.finishedAt != null
      };
    }));
  }
  return out;
}

// ---- その端末だけに配る情報 ----
function privateFor(room, memberId) {
  const w = room.bomb;
  if (!w) return null;
  if (w.playerIds.indexOf(memberId) === -1) return null; // 大画面・観戦には配らない
  const e = entryOf(w, memberId);
  const out = {
    phase: w.phase,
    mode: w.mode,
    total: w.wires.length,
    solvedCount: e ? e.solvedCount : 0,
    lives: e ? Math.max(0, e.lives) : 0,
    livesMax: w.lives,
    misses: e ? e.misses : 0,
    failed: !!(e && e.failed),
    timedOut: !!(e && e.timedOut),
    finished: !!(e && e.finishedAt != null),
    remainingMs: remainingMsOf(e),
    // 待機中は本数だけ。説明文はまだ1文字も出さない
    prep: { ready: w.ready, dropped: w.dropped, total: w.wires.length }
  };
  if (w.phase === PHASE.PREP) return out;

  out.board = (e ? e.order : []).map((uid) => {
    const wire = w.wires.find((x) => x.uid === uid);
    const cell = {
      uid: uid,
      tier: wire ? wire.tier : null,
      solved: !!(e && e.solved[uid])
    };
    if (w.mode === BombLogic.MODE.COOP) {
      const holder = holderOf(room, uid);
      cell.by = (holder && holder !== memberId) ? w.names[holder] : null;
      cell.solvedBy = w.solvedBy[uid] ? w.names[w.solvedBy[uid]] : null;
    }
    return cell;
  });

  // 開けているコードの説明文と3択だけを配る。開けていない分は届かない
  const openUid = w.open[memberId];
  if (openUid && w.phase === PHASE.PLAY) {
    const wire = w.wires.find((x) => x.uid === openUid);
    if (wire) {
      out.open = {
        uid: openUid,
        tier: wire.tier,
        description: wire.description,
        choices: (e.choices[openUid] || []).slice()
      };
    }
  }
  if (w.phase === PHASE.ENDED) out.result = resultView(room);
  return out;
}

// ---- 操作の受け付け ----
/**
 * コードを開ける／閉じる。
 * targetId が uid なら「そのコードに挑戦する」、null なら「閉じる」。
 * 説明文は待機中に作り終えているので、ここでAIを待つことはない。
 */
function submitAction(room, memberId, targetId) {
  const w = room.bomb;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.PLAY) return { ok: false, error: 'wrong_phase' };
  const e = entryOf(w, memberId);
  if (!e || w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
  if (!entryActive(e)) return { ok: false, error: 'already_done' };

  if (!targetId) { delete w.open[memberId]; return { ok: true, allDone: false }; }
  if (e.order.indexOf(targetId) === -1) return { ok: false, error: 'unknown_code' };
  if (e.solved[targetId]) return { ok: false, error: 'already_solved' };
  // 通常版は盤面がひとつなので、同じコードに2人が同時に挑まないようにする
  // （2人とも外して、1回のミスでライフが2つ減るのを防ぐ）
  if (w.mode === BombLogic.MODE.COOP) {
    const holder = holderOf(room, targetId);
    if (holder && holder !== memberId) return { ok: false, error: 'taken' };
  }
  w.open[memberId] = targetId;
  if (!e.choices[targetId]) {
    const wire = w.wires.find((x) => x.uid === targetId);
    e.choices[targetId] = BombLogic.buildChoices(wire, w.topics);
  }
  return { ok: true, allDone: false };
}

/**
 * 3択に答える。いま開けているコードへの答えとして扱う。
 * どのコードへの答えかを端末に決めさせないので、開き直しの競合で
 * 「別のコードの正解が通ってしまう」ことが起きない。
 */
function submitVote(room, memberId, targetId) {
  const w = room.bomb;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.PLAY) return { ok: false, error: 'wrong_phase' };
  const e = entryOf(w, memberId);
  if (!e || w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
  if (!entryActive(e)) return { ok: false, error: 'already_done' };
  const uid = w.open[memberId];
  if (!uid) return { ok: false, error: 'nothing_open' };
  const wire = w.wires.find((x) => x.uid === uid);
  if (!wire) return { ok: false, error: 'unknown_code' };
  const answer = String(targetId == null ? '' : targetId);
  // 見せた3択以外は受け付けない（状態が壊れないようにするための門）
  if ((e.choices[uid] || []).indexOf(answer) === -1) return { ok: false, error: 'not_a_choice' };

  delete w.open[memberId];
  const now = Date.now();
  const correct = BombLogic.isCorrect(wire, answer);
  if (correct) {
    e.solved[uid] = true;
    e.solvedCount++;
    e.lastSolveAt = w.startedAt ? (now - w.startedAt) : 0;
    if (!w.solvedBy[uid]) w.solvedBy[uid] = memberId;
  } else {
    e.misses++;
    e.lives--;
    if (e.lives <= 0) e.failed = true;
    // 競争版だけ、ライフとは別に残り時間も削る（両方を同時適用する設計）
    if (w.mode === BombLogic.MODE.RACE && e.deadline) {
      e.deadline -= BombLogic.MISS_TIME_PENALTY_SEC * 1000;
      if (e.deadline <= now) e.timedOut = true;
    }
  }
  checkEnd(room);
  refreshDeadline(w);
  return { ok: true, correct: correct, allDone: false };
}

/**
 * 終わりの条件を見て、必要なら決着させる。
 * 正解・不正解・時間切れ・切断、どの入口から来ても必ずここを通す
 * （分岐ごとに書くと、片方だけ直し忘れる）。
 */
function checkEnd(room) {
  const w = room.bomb;
  if (!w || w.phase !== PHASE.PLAY) return false;
  const total = w.wires.length;

  if (w.mode === BombLogic.MODE.COOP) {
    const team = w.entries[TEAM_KEY];
    if (team.solvedCount >= total) return finish(room, { success: true, cause: 'defused' });
    if (team.failed) return finish(room, { success: false, cause: 'lives' });
    if (team.timedOut) return finish(room, { success: false, cause: 'time' });
    return false;
  }

  // 競争版：全部解いた人には、その時刻を刻む
  const now = Date.now();
  w.playerIds.forEach((id) => {
    const e = w.entries[id];
    if (e.finishedAt == null && !e.failed && e.solvedCount >= total) {
      e.finishedAt = w.startedAt ? (now - w.startedAt) : 0;
    }
  });
  // 競争版に「成功／失敗」は無い（順位が結果なので success は付けない）
  const anyFinished = w.playerIds.some((id) => w.entries[id].finishedAt != null);
  if (w.endWhen === BombLogic.END_WHEN.FIRST && anyFinished) {
    return finish(room, { cause: 'firstDone' });
  }
  if (!activeMembers(room).length) return finish(room, { cause: 'allDone' });
  return false;
}

function finish(room, result) {
  const w = room.bomb;
  w.phase = PHASE.ENDED;
  room.state.phase = PHASE.ENDED;
  w.endedAt = Date.now();
  w.deadline = null;
  w.open = {};
  w.result = Object.assign({}, w.result || {}, result || {});
  return true;
}

// ---- 段階を進める ----
/**
 * 時間切れの監視（realtime.js の500msごとの見回り）と、
 * 最後の人が切断した時から呼ばれる。
 * 期限が本当に来ているかを必ず自分で確かめるので、進行役が余計に押しても何も起きない。
 */
function advance(room) {
  const w = room.bomb;
  if (!w || w.phase !== PHASE.PLAY) return { changed: false };
  const now = Date.now();
  let changed = false;
  allEntries(w).forEach((e) => {
    if (entryActive(e) && e.deadline && now >= e.deadline) { e.timedOut = true; changed = true; }
  });
  if (checkEnd(room)) changed = true;
  refreshDeadline(w);
  return { changed: changed };
}

// その段階で操作を待つ人。切れている人・もう終わった人は待たない
function expectedMembers(room) {
  const w = room.bomb;
  if (!w || w.phase !== PHASE.PLAY) return [];
  return activeMembers(room);
}
/**
 * 通常版に「全員が終わる」という概念は無い（爆弾が片付くか、爆発するかだけ）。
 * 競争版は、続けている人がいなくなったら締める。
 */
function isAllDone(room) {
  const w = room.bomb;
  if (!w || w.phase !== PHASE.PLAY) return false;
  if (w.mode === BombLogic.MODE.COOP) return false;
  return activeMembers(room).length === 0;
}

module.exports = {
  PHASE, MIN_PLAYERS, TEAM_KEY,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, entryOf, resultView
};
