// wolf-room.js — 1人1台モードの人狼の進行（第21弾 第7部）
//
// 設計の芯（指示19からそのまま）:
//   ルール・役職・勝敗判定・スコアは wolf-logic.js をそのまま使い、作り直さない。
//   状態はサーバーが持ち、各端末は「自分の情報だけ」を受け取って表示する。
//
// 手渡し方式との違いは「順番」が無いことだけ。全員が同時に自分の端末で行動する。
// 誰が終わったかを room.wolf.done で数え、全員そろった時点で夜を解決する。
//
// このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。

const path = require('path');
const WolfLogic = require(path.join(__dirname, 'public', 'js', 'wolf-logic.js'));

// 進行の段階。手渡し方式の wr.step とは別物（あちらには触れていない）
const PHASE = {
  LOBBY: 'lobby',
  ROLE: 'roleReveal',   // 各自が自分の役職を確認する
  MEETING: 'meeting',   // 作戦会議（第24弾-2）。夜が来る前に話す時間
  NIGHT: 'night',       // 夜の行動（同時）
  PREVOTE: 'preVote',   // 1ターン戦の単発行動（同時）
  DAY: 'day',           // 朝の発表＋話し合い
  VOTE: 'vote',         // 投票（同時）
  TURN_RESULT: 'turnResult',
  ENDED: 'ended'
};

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}

// ---- 開始 ----
function startGame(room, config) {
  const members = playersOf(room);
  if (members.length < 3) return { ok: false, error: 'too_few_players', message: '3人以上必要です' };

  const cfg = config || {};
  // 第22弾-3：闇鍋（chaos）は席を全部埋める計算を使う。
  // 「ごく稀に村人が1人紛れる」の抽選もここで回るので、
  // 手渡し方式と1人1台で編成の作られ方が食い違わない。
  const counts = cfg.counts || (cfg.chaos
    ? WolfLogic.chaosCounts(cfg.roles || ['wolf', 'seer'], members.length)
    : WolfLogic.balancedCounts(cfg.roles || ['wolf', 'seer'], members.length));
  const game = WolfLogic.createGame({
    players: members.map((m) => ({ id: m.id, name: m.name })),
    counts,
    turnLimit: cfg.turnLimit || 5,
    seerResult: cfg.seerResult,
    seerShowsThird: cfg.seerShowsThird,
    revealRoleOnDeath: cfg.revealRoleOnDeath,
    wolfAttackDecision: cfg.wolfAttackDecision,
    teruteruContinue: cfg.teruteruContinue,
    lovers: cfg.lovers,
    loverIds: cfg.loverIds || null,
    nightTimeLimit: cfg.nightTimeLimit || 0,
    showVoteCounts: cfg.showVoteCounts !== false
  });

  room.wolf = {
    game,
    phase: PHASE.ROLE,
    done: {},            // memberId -> true（この段階で操作を終えた人）
    info: {},            // memberId -> その人が得た情報
    nightOut: null,
    voteOut: null,
    runoff: null,        // 決選投票の途中かどうか（第23弾-1）
    // 第24弾-2：作戦会議の持ち時間（秒）。0なら時間制限なし＝進行役が進めるまで待つ
    meetingSec: Math.max(0, parseInt(cfg.meetingSec, 10) || 0),
    pendingEnd: null,
    deadline: null,      // 制限時間の期限（ミリ秒）。0なら無し
    preset: cfg.preset || null
  };
  room.state.game = 'wolfrole';
  room.state.phase = PHASE.ROLE;
  return { ok: true };
}

// ---- 公開してよい情報だけ ----
// ここに秘密を混ぜると全員（大画面を含む）に配られる。役職・投票先は絶対に入れない。
function publicView(room) {
  const w = room.wolf;
  if (!w) return { phase: PHASE.LOBBY };
  const g = w.game;
  const alive = WolfLogic.alivePlayers(g);
  const view = {
    phase: w.phase,
    turn: g.turn,
    turnLimit: g.config.turnLimit,
    counts: g.counts,                       // 何の役職が何人いるか（誰が、は入れない）
    aliveCount: alive.length,
    players: g.players.map((p) => ({
      id: p.id, name: p.name, alive: p.alive,
      // 死んだ人の役職は、設定がONの時だけ公開される
      role: (!p.alive && g.config.revealRoleOnDeath) ? p.role : null,
      deadCause: p.alive ? null : p.deadCause,
      deadTurn: p.alive ? null : p.deadTurn
    })),
    waiting: waitingNames(room),            // まだ操作していない人の「名前」だけ
    deadline: w.deadline || null
  };
  if (w.phase === PHASE.DAY && w.nightOut) {
    view.morning = {
      deaths: (w.nightOut.deaths || []).map((d) => {
        const p = WolfLogic.findPlayer(g, d.id);
        return {
          name: p ? p.name : '?', cause: d.cause,
          role: (p && g.config.revealRoleOnDeath) ? WolfLogic.roleById(p.role).name : null
        };
      }),
      attackOverlap: !!w.nightOut.attackOverlap
    };
  }
  // 第23弾-1：決選投票の最中は、候補が誰かを全員に見せる（誰が投票するかは伏せたまま）
  if (w.phase === PHASE.VOTE && w.runoff) {
    view.runoff = {
      candidates: w.runoff.candidates.map((id) => {
        const p = WolfLogic.findPlayer(g, id);
        return p ? p.name : '?';
      })
    };
  }
  if (w.phase === PHASE.TURN_RESULT && w.voteOut) {
    const ex = w.voteOut.executed;
    const ro = w.voteOut.runoff;
    view.turnResult = {
      executed: ex ? {
        name: ex.name,
        role: g.config.revealRoleOnDeath ? ex.roleName : null
      } : null,
      counts: g.config.showVoteCounts ? namedCounts(g, w.voteOut.tally.counts) : null,
      // 決選投票を行った回は、候補と2回目の票数も添える
      runoff: ro ? {
        candidates: ro.candidates.map((id) => {
          const p = WolfLogic.findPlayer(g, id);
          return p ? p.name : '?';
        }),
        counts: g.config.showVoteCounts ? namedCounts(g, ro.tally.counts) : null
      } : null
    };
  }
  if (w.phase === PHASE.ENDED && g.result) {
    view.result = {
      winner: g.result.winner,
      reason: g.result.reason,
      teruteruWin: !!g.teruteruWin,
      // 決着したので、ここで初めて全員の役職を明かす
      roles: g.players.map((p) => ({ name: p.name, role: p.role, roleName: WolfLogic.roleById(p.role).name, alive: p.alive })),
      scores: WolfLogic.scoreGame(g),
      // 第23弾-2：決着したこの瞬間だけ、誰が誰に入れたかも開ける。
      // 手渡し方式と同じ扱いにする（片方だけ見られる、を作らない）
      voteLog: g.config.showVoteCounts === false ? null : (g.log || [])
        .filter((e) => e.type === 'vote' && e.votes && Object.keys(e.votes).length)
        .map((e) => ({
          turn: e.turn,
          rows: Object.keys(e.votes).map((voter) => {
            const from = WolfLogic.findPlayer(g, voter);
            const to = WolfLogic.findPlayer(g, e.votes[voter]);
            return { from: from ? from.name : '?', to: to ? to.name : '?' };
          })
        }))
    };
  }
  return view;
}
function namedCounts(game, counts) {
  return Object.keys(counts || {}).map((id) => {
    const p = WolfLogic.findPlayer(game, id);
    return { name: p ? p.name : '?', n: counts[id] };
  }).sort((a, b) => b.n - a.n);
}

// まだ操作を終えていない人の名前。誰が「行動を持っているか」は漏らさない
// （行動が無い人も確認を押す必要があるので、この一覧から役職は分からない）
function waitingNames(room) {
  const w = room.wolf;
  if (!w) return [];
  if ([PHASE.ROLE, PHASE.NIGHT, PHASE.PREVOTE, PHASE.VOTE].indexOf(w.phase) === -1) return [];
  return expectedMembers(room)
    .filter((id) => !w.done[id])
    .map((id) => {
      const p = WolfLogic.findPlayer(w.game, id);
      return p ? p.name : '?';
    });
}

// この段階で操作が必要な人。
// 接続が切れている人は待たない。待つと、誰かの電池が切れただけで
// 全員の夜が明けなくなる（実際に検証で詰まった）。
// 戻ってくれば、その段階が終わる前なら操作できる。
function expectedMembers(room) {
  const w = room.wolf;
  const g = w.game;
  const base = (w.phase === PHASE.ROLE)
    ? g.players.map((p) => p.id)
    : WolfLogic.alivePlayers(g).map((p) => p.id);
  return base.filter((id) => {
    const m = room.members.get(id);
    return m && m.connected;
  });
}

// ---- その人だけに見せる情報 ----
function privateFor(room, memberId) {
  const w = room.wolf;
  if (!w) return null;
  const g = w.game;
  const p = WolfLogic.findPlayer(g, memberId);
  if (!p) return null; // 大画面ホストや観戦者には何も返さない
  const role = WolfLogic.roleById(p.role);
  const out = {
    phase: w.phase,
    roleId: p.role,
    roleName: role.name,
    roleDesc: role.desc,
    alive: p.alive,
    done: !!w.done[memberId],
    info: w.info[memberId] || null,
    choices: []
  };
  // 仲間・相方（役職確認の段階で分かるもの）
  if (p.role === 'wolf') {
    out.mates = WolfLogic.playersWithRole(g, 'wolf', false)
      .filter((x) => x.id !== p.id).map((x) => x.name);
  }
  if (p.role === 'mason') {
    out.mates = WolfLogic.playersWithRole(g, 'mason', false)
      .filter((x) => x.id !== p.id).map((x) => x.name);
  }
  if (p.isLover) {
    out.lovers = (g.loverIds || []).filter((id) => id !== p.id)
      .map((id) => { const q = WolfLogic.findPlayer(g, id); return q ? q.name : '?'; });
  }
  // いま選べる相手
  if (p.alive && (w.phase === PHASE.NIGHT || w.phase === PHASE.PREVOTE)) {
    const pending = (w.phase === PHASE.NIGHT)
      ? WolfLogic.pendingNightActions(g)
      : WolfLogic.pendingPreVoteActions(g);
    const mine = pending.find((a) => a.playerId === p.id);
    if (mine && mine.kind !== 'medium') {
      out.action = mine.kind;
      out.choices = mine.targets;
    }
  }
  if (p.alive && w.phase === PHASE.VOTE) {
    out.action = 'vote';
    // 第23弾-1：決選投票では、同数で並んだ人だけが候補になる
    out.choices = WolfLogic.alivePlayers(g)
      .filter((t) => t.id !== p.id && (!w.runoff || w.runoff.candidates.indexOf(t.id) !== -1))
      .map((t) => ({ id: t.id, name: t.name }));
    if (w.runoff) out.runoff = true;
  }
  return out;
}

// ---- 操作の受け付け ----
// targetId が null なら「行動しないことを確認した」。
// 行動が無い人も必ずここを通るので、外から見て誰が行動持ちかは分からない。
function submitAction(room, memberId, targetId) {
  const w = room.wolf;
  if (!w) return { ok: false, error: 'not_started' };
  const g = w.game;
  if (w.phase !== PHASE.ROLE && w.phase !== PHASE.NIGHT && w.phase !== PHASE.PREVOTE) {
    return { ok: false, error: 'wrong_phase' };
  }
  if (expectedMembers(room).indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };

  if (targetId && w.phase === PHASE.NIGHT) WolfLogic.setNightAction(g, memberId, targetId);
  if (targetId && w.phase === PHASE.PREVOTE) WolfLogic.setPreVoteAction(g, memberId, targetId);
  w.done[memberId] = true;

  // 占い・のぞき見は、選んだその瞬間に結果を返す（手渡し方式と同じ考え方）
  if (targetId && w.phase === PHASE.NIGHT) {
    const p = WolfLogic.findPlayer(g, memberId);
    if (p && p.role === 'seer') w.info[memberId] = WolfLogic.previewDivine(g, targetId);
  }
  if (targetId && w.phase === PHASE.PREVOTE) {
    const p = WolfLogic.findPlayer(g, memberId);
    if (p && p.role === 'peek') w.info[memberId] = WolfLogic.previewPeek(g, targetId);
  }
  return { ok: true, allDone: isAllDone(room) };
}

function submitVote(room, memberId, targetId) {
  const w = room.wolf;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.VOTE) return { ok: false, error: 'wrong_phase' };
  if (expectedMembers(room).indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };
  if (!targetId) return { ok: false, error: 'target_required' };
  // 決選投票では、候補以外に入れられない（端末が古い画面のまま送ってきても弾く）
  if (w.runoff && w.runoff.candidates.indexOf(targetId) === -1) {
    return { ok: false, error: 'not_candidate' };
  }
  WolfLogic.setVote(w.game, memberId, targetId);
  w.done[memberId] = true;
  return { ok: true, allDone: isAllDone(room) };
}

function isAllDone(room) {
  const w = room.wolf;
  return expectedMembers(room).every((id) => w.done[id]);
}

// ---- 段階を進める ----
// 全員そろった時・制限時間が切れた時・ホストが押した時から呼ばれる。
// どこから来ても同じ経路を通す（分岐ごとに書くと片方だけ直し忘れる）。
function advance(room) {
  const w = room.wolf;
  if (!w) return { changed: false };
  const g = w.game;

  if (w.phase === PHASE.ROLE) {
    // 第24弾-2：役職を配ったら、夜の前に作戦会議。
    // 実機で「何をやっているのか分からない」「話す時間が無かった」と言われた通り、
    // 役職確認のあといきなり夜が来ていた。
    setPhase(room, PHASE.MEETING);
    if (w.meetingSec) w.deadline = Date.now() + w.meetingSec * 1000;
    return { changed: true };
  }
  if (w.phase === PHASE.MEETING) {
    startActionPhase(room, g.config.turnLimit === 1 ? PHASE.PREVOTE : PHASE.NIGHT);
    return { changed: true };
  }
  if (w.phase === PHASE.NIGHT) {
    w.nightOut = WolfLogic.resolveNight(g);
    // 夜に確定した情報（霊媒・守りの結果）を、本人にだけ渡す
    Object.keys(w.nightOut.info || {}).forEach((id) => { w.info[id] = w.nightOut.info[id]; });
    const res = WolfLogic.evaluate(g);
    if (res.ended) { finish(room, res); return { changed: true }; }
    setPhase(room, PHASE.DAY);
    return { changed: true };
  }
  if (w.phase === PHASE.PREVOTE) {
    const out = WolfLogic.resolvePreVote(g);
    Object.keys(out.info || {}).forEach((id) => { w.info[id] = out.info[id]; });
    startVotePhase(room);
    return { changed: true };
  }
  if (w.phase === PHASE.DAY) {
    g.phase = 'vote'; // ロジック層は phase が合わないと投票を黙って捨てる
    startVotePhase(room);
    return { changed: true };
  }
  if (w.phase === PHASE.VOTE) {
    // 第23弾-1：同数なら、並んだ人だけでもう一度。
    // 手渡し方式とまったく同じ判断（WolfLogic.voteOutcome）を使う。
    const vo = WolfLogic.voteOutcome(g.votes, { isRunoff: !!w.runoff });
    if (vo.kind === 'runoff') {
      w.runoff = {
        candidates: vo.candidates,
        firstTally: vo.tally,
        firstVotes: Object.assign({}, g.votes)
      };
      g.votes = {};
      startVotePhase(room, true);
      return { changed: true };
    }
    // 記録に残すのは1回目の投票。誰を処刑するかだけを決選投票の結果で上書きする
    const runoff = w.runoff;
    if (runoff) g.votes = runoff.firstVotes;
    const out = WolfLogic.executeVote(g, vo.kind === 'execute' ? vo.targetId : null);
    out.runoff = runoff ? { tally: vo.tally, candidates: runoff.candidates } : null;
    w.runoff = null;
    w.voteOut = out;
    if (out.executed) WolfLogic.checkTeruteru(g, out.executed);
    const res = WolfLogic.evaluate(g);
    // 決着していても、まずそのターンの結果を見せる（手渡し方式の第20弾-6と同じ）。
    // 決着の条件は3つあるが、どれも同じ経路（willEnd）を通す。
    if (res.teruteruWin && !g.config.teruteruContinue) {
      w.willEnd = true; w.pendingEnd = res.ended ? res : null;
    } else if (res.ended) {
      w.willEnd = true; w.pendingEnd = res;
    } else if (WolfLogic.isFinalTurn(g)) {
      w.willEnd = true; w.pendingEnd = null; // 上限ターンに到達
    } else {
      w.willEnd = false; w.pendingEnd = null;
    }
    setPhase(room, PHASE.TURN_RESULT);
    return { changed: true };
  }
  if (w.phase === PHASE.TURN_RESULT) {
    if (w.willEnd) { finish(room, w.pendingEnd || null); return { changed: true }; }
    WolfLogic.nextTurn(g);
    if (g.phase === 'finalVote') { startVotePhase(room); return { changed: true }; }
    startActionPhase(room, PHASE.NIGHT);
    return { changed: true };
  }
  return { changed: false };
}

function setPhase(room, phase) {
  const w = room.wolf;
  w.phase = phase;
  w.done = {};       // 段階が変わったら「終わった人」は数え直す
  w.deadline = null;
  room.state.phase = phase;
}
// 全員の操作を待つ段階に入る。制限時間があればここで期限を決める
// 投票の段階に入る唯一の入口。
// 第23弾-1：決選投票からの呼び出し以外は、前の決選投票の状態を必ず消す。
// （ここを通さずに投票を始めると、前のターンの候補が残ったままになる）
function startVotePhase(room, keepRunoff) {
  if (!keepRunoff) room.wolf.runoff = null;
  startActionPhase(room, PHASE.VOTE);
}
function startActionPhase(room, phase) {
  setPhase(room, phase);
  const sec = room.wolf.game.config.nightTimeLimit || 0;
  if (sec && (phase === PHASE.NIGHT || phase === PHASE.PREVOTE)) {
    room.wolf.deadline = Date.now() + sec * 1000;
  }
}
function finish(room, res) {
  const w = room.wolf;
  WolfLogic.finish(w.game, res || null);
  setPhase(room, PHASE.ENDED);
  w.willEnd = false;
}

module.exports = {
  PHASE, startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers
};
