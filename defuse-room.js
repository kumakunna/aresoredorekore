// defuse-room.js — 1人1台モードの「実物解除」の進行（第27弾-3）
//
// 設計の芯は bomb-room.js / wordwolf-room.js とまったく同じ:
//   ルール（モジュールの生成・対応表・判定）は defuse-logic.js をそのまま使い、作り直さない。
//   状態はサーバーが持ち、各端末は「自分の役割に応じたぶんだけ」を受け取る。
//   このファイルは socket.io を知らない。通知は呼び出し側（realtime.js）が行う。
//
// ---- 進み方 ----
//   consent … 体を動かすモジュールが入る時だけ。全員が「参加する／しない」を選ぶ
//   roles   … 解除役かマニュアル役かを選ぶ（集中解除はマニュアル役1人だけ）
//   play    … モジュール一覧。どれから手をつけてもよい。ミス上限は全体で共有
//   ended   … 全部解除できたか、ミス上限に達したか、時間切れか
//
// ---- 秘密の扱い（原則4.3） ----
//   answer（正解）はどの端末にも渡さない。判定は必ずサーバーが行う。
//   マニュアルありの時、対応表はマニュアル役だけに配る。
//   マニュアルなしの時は、同じ対応表を解除役にも配る（別の性質の遊びとして扱う）。
//   センサーを使うモジュールは、端末から「粗くした測定値」だけを送ってもらう。

const path = require('path');
const DefuseLogic = require(path.join(__dirname, 'public', 'js', 'defuse-logic.js'));

const PHASE = {
  LOBBY: 'lobby',
  CONSENT: 'consent',
  ROLES: 'roles',
  PLAY: 'play',
  ENDED: 'ended'
};

const ROLE = { DEFUSER: 'defuser', MANUAL: 'manual' };
const MIN_PLAYERS = 2;

function playersOf(room) {
  return Array.from(room.members.values()).filter((m) => m.role === 'player');
}
function connectedIds(room, ids) {
  return ids.filter((id) => {
    const m = room.members.get(id);
    return m && m.connected;
  });
}

// ---- 開始 ----
function startGame(room, config, ctx) {
  const members = playersOf(room);
  if (members.length < MIN_PLAYERS) {
    return { ok: false, error: 'too_few_players', message: MIN_PLAYERS + '人以上必要です' };
  }
  const cfg = DefuseLogic.normalizeConfig(config);
  const ids = members.map((m) => m.id);

  const w = {
    mode: cfg.mode,
    manual: cfg.manual,
    moduleCount: cfg.moduleCount,
    strikesMax: cfg.strikes,
    strikesLeft: cfg.strikes,
    timerSec: cfg.timerSec,
    allowPhysical: cfg.allowPhysical,
    allowCamera: cfg.allowCamera,
    preset: cfg.preset,

    playerIds: ids,
    names: {},
    consent: {},        // memberId -> true（体を動かすのに参加する）
    roles: {},          // memberId -> 'defuser' | 'manual'
    caps: {},           // memberId -> その端末で読めるセンサー（役割を選ぶ時に一緒に届く）
    modules: [],
    manualOf: {},       // memberId -> 持っている対応表のuid
    open: {},           // memberId -> いま開けているモジュールのuid
    done: {},           // その段階で答え終わった人

    phase: null,
    startedAt: null,
    deadline: null,
    result: null,
    recorded: false,
    log: []             // ミスの記録（決着画面で「どこで転んだか」を出す）
  };
  members.forEach((m) => { w.names[m.id] = m.name; });

  room.defuse = w;
  room.state.game = 'defuse';
  // 体を動かすモジュールを混ぜる設定なら、まず全員に確かめる。
  // 身体的なリスクがあるものは事前に同意を取る、というアプリ共通の決まり
  setPhase(room, cfg.allowPhysical ? PHASE.CONSENT : PHASE.ROLES);
  if (ctx && ctx.notify) ctx.notify(room);
  return { ok: true };
}

// ---- 段階の切り替え ----
function setPhase(room, phase) {
  const w = room.defuse;
  w.phase = phase;
  w.done = {};
  w.deadline = null;
  room.state.phase = phase;
}

/**
 * 役割が決まったら、その人数に合わせてモジュールを選ぶ。
 * マニュアル役の人数で出せるモジュールが変わる（分割暗号は2人以上）ので、
 * 役割が決まる前には作れない。
 */
function startPlay(room) {
  const w = room.defuse;
  const holders = manualHolders(w);
  const cfg = {
    mode: w.mode, moduleCount: w.moduleCount, strikes: w.strikesMax,
    manual: w.manual, timerSec: w.timerSec,
    // 「参加しない」を選んだ人しかいなければ、体を動かすモジュールは外す
    allowPhysical: w.allowPhysical && anyoneConsented(w),
    allowCamera: w.allowCamera && anyoneConsented(w)
  };
  // 解除役の端末で読めるセンサーだけを使う。
  // 読めないセンサーのモジュールを載せると、一生解けないマスになる
  // （PCから参加した人が解除役、という場面は普通に起きる）
  const caps = DefuseLogic.mergeCaps(defusers(w).map((id) => w.caps[id]));
  w.caps.merged = caps;
  w.modules = DefuseLogic.pickModules(DefuseLogic.normalizeConfig(cfg), holders.length, null, caps);
  w.manualOf = DefuseLogic.splitManual(
    w.modules.filter((m) => !!m.manual).map((m) => m.uid), holders
  );
  setPhase(room, PHASE.PLAY);
  w.startedAt = Date.now();
  if (w.timerSec > 0) w.deadline = w.startedAt + w.timerSec * 1000;
}

function manualHolders(w) {
  return w.playerIds.filter((id) => w.roles[id] === ROLE.MANUAL);
}
function defusers(w) {
  return w.playerIds.filter((id) => w.roles[id] === ROLE.DEFUSER);
}
function anyoneConsented(w) {
  return w.playerIds.some((id) => w.consent[id] === true);
}

// ---- 公開してよい情報だけ ----
// モジュールの中身（hint・対応表・答え）は一切入れない。名前と解除済みかだけ。
function publicView(room) {
  const w = room.defuse;
  if (!w) return { phase: PHASE.LOBBY };
  const view = {
    phase: w.phase,
    mode: w.mode,
    manual: w.manual,
    strikesLeft: w.strikesLeft,
    strikesMax: w.strikesMax,
    timerSec: w.timerSec,
    remainingMs: w.deadline ? Math.max(0, w.deadline - Date.now()) : null,
    players: w.playerIds.map((id) => {
      const m = room.members.get(id);
      return {
        id, name: w.names[id],
        connected: !!(m && m.connected),
        role: w.roles[id] || null,
        // 何を開けているかは公開情報（大画面で「いま誰がどれに挑んでいるか」を出す）
        working: w.open[id] ? moduleNameOf(w, w.open[id]) : null,
        done: !!w.done[id]
      };
    }),
    waiting: waitingNames(room)
  };
  if (w.phase === PHASE.PLAY || w.phase === PHASE.ENDED) {
    view.board = DefuseLogic.publicProgress(w.modules, w.strikesLeft, w.strikesMax);
  }
  if (w.phase === PHASE.ENDED) view.result = resultView(room);
  return view;
}

function moduleNameOf(w, uid) {
  const inst = w.modules.find((m) => m.uid === uid);
  if (!inst) return null;
  const def = DefuseLogic.moduleById(inst.type);
  return def ? def.name : null;
}

function resultView(room) {
  const w = room.defuse;
  const solved = w.modules.filter((m) => m.solved).length;
  return {
    success: !!(w.result && w.result.success),
    cause: (w.result && w.result.cause) || null,
    solved, total: w.modules.length,
    strikesLeft: w.strikesLeft, strikesMax: w.strikesMax,
    elapsedSec: w.startedAt ? Math.round(((w.endedAt || Date.now()) - w.startedAt) / 1000) : 0,
    modules: w.modules.map((m) => {
      const def = DefuseLogic.moduleById(m.type);
      return { name: def.name, icon: def.icon, solved: !!m.solved };
    }),
    roles: w.playerIds.map((id) => ({ name: w.names[id], role: w.roles[id] || null })),
    // どのモジュールで何回転んだか。次に遊ぶ時の話のタネになる
    misses: w.log.slice(0, 20)
  };
}

// ---- その端末だけに配る情報 ----
function privateFor(room, memberId) {
  const w = room.defuse;
  if (!w) return null;
  if (w.playerIds.indexOf(memberId) === -1) return null; // 大画面・観戦には配らない

  const role = w.roles[memberId] || null;
  const out = {
    phase: w.phase, mode: w.mode, manual: w.manual,
    role,
    strikesLeft: w.strikesLeft, strikesMax: w.strikesMax,
    remainingMs: w.deadline ? Math.max(0, w.deadline - Date.now()) : null,
    done: !!w.done[memberId],
    consent: w.consent[memberId] === undefined ? null : !!w.consent[memberId]
  };

  if (w.phase === PHASE.CONSENT) {
    // 何に同意するのかを具体的に書く（読まずに押されないように）
    out.consentAsk = {
      moves: ['端末を振る', 'その場でポーズを取る'],
      camera: w.allowCamera,
      notes: [
        'まわりに人や物がないか確かめてください',
        '端末は落とさないよう、しっかり握ってください',
        'カメラを使うモジュールは、映像を端末の外に出しません（保存もしません）'
      ],
      // 断る気まずさを作らない。断った人はマニュアル役として遊べる
      declineNote: '「参加しない」を選んでも、マニュアル役として一緒に遊べます'
    };
    return out;
  }

  if (w.phase === PHASE.ROLES) {
    out.roleAsk = {
      mode: w.mode,
      // 集中解除はマニュアル役1人・解除役全員
      focus: w.mode === DefuseLogic.MODE.FOCUS,
      taken: w.playerIds
        .filter((id) => w.roles[id])
        .map((id) => ({ name: w.names[id], role: w.roles[id] })),
      // 体を動かすのを断った人は、解除役にすると気まずくなるので勧めない
      physicalDeclined: w.allowPhysical && w.consent[memberId] === false
    };
    return out;
  }

  if (w.phase === PHASE.PLAY || w.phase === PHASE.ENDED) {
    out.board = DefuseLogic.publicProgress(w.modules, w.strikesLeft, w.strikesMax);
    if (role === ROLE.DEFUSER) {
      // 解除役：いま開けているモジュールの中身だけ。開けていないものは届かない
      const uid = w.open[memberId];
      const inst = uid ? w.modules.find((m) => m.uid === uid) : null;
      if (inst && w.phase === PHASE.PLAY) {
        // マニュアルなしの設定なら、対応表もここに載る
        out.open = DefuseLogic.openView(inst, w.manual);
      }
    }
    if (role === ROLE.MANUAL) {
      // マニュアル役：自分が受け持つ対応表だけ。進み具合や答えは出さない
      const mine = w.manualOf[memberId] || [];
      out.manualPages = mine
        .map((uid) => w.modules.find((m) => m.uid === uid))
        .filter(Boolean)
        .map((inst) => DefuseLogic.manualView(inst))
        .filter(Boolean);
    }
    if (w.phase === PHASE.ENDED) out.result = resultView(room);
  }
  return out;
}

// ---- 操作の受け付け ----
/**
 * 段階によって意味が変わる。
 *   consent … targetId 'yes' | 'no'
 *   roles   … targetId 'defuser' | 'manual'
 *   play    … targetId がモジュールのuidなら開ける、null なら閉じる
 */
function submitAction(room, memberId, targetId, payload) {
  const w = room.defuse;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.playerIds.indexOf(memberId) === -1) return { ok: false, error: 'not_expected' };

  if (w.phase === PHASE.CONSENT) {
    if (targetId !== 'yes' && targetId !== 'no') return { ok: false, error: 'bad_answer' };
    w.consent[memberId] = (targetId === 'yes');
    w.done[memberId] = true;
    return { ok: true, allDone: isAllDone(room) };
  }

  if (w.phase === PHASE.ROLES) {
    if (targetId !== ROLE.DEFUSER && targetId !== ROLE.MANUAL) {
      return { ok: false, error: 'bad_role' };
    }
    // 集中解除はマニュアル役1人だけ。早い者勝ちで埋まる
    if (w.mode === DefuseLogic.MODE.FOCUS && targetId === ROLE.MANUAL) {
      const taken = manualHolders(w).filter((id) => id !== memberId);
      if (taken.length >= 1) return { ok: false, error: 'manual_taken' };
    }
    w.roles[memberId] = targetId;
    // 端末で読めるセンサーを一緒に受け取る。役割が決まるまで誰が爆弾を持つか
    // 分からないので、モジュールを選ぶのはこれがそろってから
    if (payload && payload.caps && typeof payload.caps === 'object') {
      w.caps[memberId] = {
        orientation: !!payload.caps.orientation,
        compass: !!payload.caps.compass,
        motion: !!payload.caps.motion,
        camera: !!payload.caps.camera
      };
    }
    w.done[memberId] = true;
    return { ok: true, allDone: isAllDone(room) };
  }

  if (w.phase !== PHASE.PLAY) return { ok: false, error: 'wrong_phase' };
  if (w.roles[memberId] !== ROLE.DEFUSER) return { ok: false, error: 'not_defuser' };
  if (!targetId) { delete w.open[memberId]; return { ok: true, allDone: false }; }
  const inst = w.modules.find((m) => m.uid === targetId);
  if (!inst) return { ok: false, error: 'unknown_module' };
  if (inst.solved) return { ok: false, error: 'already_solved' };
  // 同じモジュールに2人が同時に挑むと、1回のしくじりでミスが2つ減る
  const holder = Object.keys(w.open).find(
    (id) => w.open[id] === targetId && id !== memberId && isConnected(room, id)
  );
  if (holder) return { ok: false, error: 'taken' };
  w.open[memberId] = targetId;
  return { ok: true, allDone: false };
}

function isConnected(room, id) {
  const m = room.members.get(id);
  return !!(m && m.connected);
}

/**
 * 解除の操作そのもの（ボタンを押す・傾ける・振る・答えを入れる）。
 * どのモジュールへの操作かは「いま開けているもの」で決める。
 * 端末に答えを渡していないので、判定はここでしかできない。
 */
function submitVote(room, memberId, targetId, payload) {
  const w = room.defuse;
  if (!w) return { ok: false, error: 'not_started' };
  if (w.phase !== PHASE.PLAY) return { ok: false, error: 'wrong_phase' };
  if (w.roles[memberId] !== ROLE.DEFUSER) return { ok: false, error: 'not_defuser' };
  const uid = w.open[memberId];
  if (!uid) return { ok: false, error: 'nothing_open' };
  const inst = w.modules.find((m) => m.uid === uid);
  if (!inst || inst.solved) return { ok: false, error: 'unknown_module' };

  const action = (payload && payload.action) || null;
  if (!action || typeof action.type !== 'string') return { ok: false, error: 'bad_action' };
  const def = DefuseLogic.moduleById(inst.type);
  const res = def.judge(inst, action);
  if (!res.ok) return { ok: false, error: 'bad_action' };

  if (res.miss) {
    w.strikesLeft--;
    w.log.unshift({ name: def.name, by: w.names[memberId], note: res.note || null });
  }
  if (res.solved) {
    inst.solved = true;
    delete w.open[memberId];
  }
  checkEnd(room);
  return { ok: true, solved: !!res.solved, miss: !!res.miss, note: res.note || null };
}

/**
 * 終わりの条件。正解・ミス・時間切れ、どの入口から来ても必ずここを通す。
 */
function checkEnd(room) {
  const w = room.defuse;
  if (!w || w.phase !== PHASE.PLAY) return false;
  if (w.modules.every((m) => m.solved)) return finish(room, { success: true, cause: 'defused' });
  if (w.strikesLeft <= 0) return finish(room, { success: false, cause: 'strikes' });
  if (w.deadline && Date.now() >= w.deadline) return finish(room, { success: false, cause: 'time' });
  return false;
}

function finish(room, result) {
  const w = room.defuse;
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
 * 全員そろった時・時間切れ・進行役が押した時から呼ばれる。
 * どこから来ても同じ経路を通す（分岐ごとに書くと片方だけ直し忘れる）。
 */
function advance(room) {
  const w = room.defuse;
  if (!w) return { changed: false };

  if (w.phase === PHASE.CONSENT) {
    setPhase(room, PHASE.ROLES);
    return { changed: true };
  }
  if (w.phase === PHASE.ROLES) {
    // 解除役が1人もいないままでは始められない。
    // 決めていない人・断った人を解除役にはしないので、ここで自動では埋めない
    if (!defusers(w).length) return { changed: false, error: 'need_defuser' };
    startPlay(room);
    return { changed: true };
  }
  if (w.phase === PHASE.PLAY) {
    const changed = checkEnd(room);
    return { changed };
  }
  return { changed: false };
}

// その段階で操作を待つ人。切れている人は待たない
function expectedMembers(room) {
  const w = room.defuse;
  if (!w) return [];
  if (w.phase === PHASE.CONSENT || w.phase === PHASE.ROLES) {
    return connectedIds(room, w.playerIds);
  }
  return [];
}
function isAllDone(room) {
  const w = room.defuse;
  if (!w) return false;
  if (w.phase !== PHASE.CONSENT && w.phase !== PHASE.ROLES) return false;
  const expected = expectedMembers(room);
  if (!expected.length) return false;
  if (!expected.every((id) => w.done[id])) return false;
  // 役割決めは「解除役が1人以上」がそろって初めて終わり。
  // 全員がマニュアル役を選んだら、選び直してもらう
  if (w.phase === PHASE.ROLES && !defusers(w).length) return false;
  return true;
}
function waitingNames(room) {
  const w = room.defuse;
  if (!w) return [];
  return expectedMembers(room).filter((id) => !w.done[id]).map((id) => w.names[id]);
}

module.exports = {
  PHASE, ROLE, MIN_PLAYERS,
  startGame, publicView, privateFor,
  submitAction, submitVote, isAllDone, advance,
  playersOf, expectedMembers, resultView,
  manualHolders, defusers
};
