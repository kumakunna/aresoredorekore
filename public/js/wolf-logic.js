// wolf-logic.js — 役職あり人狼の「ルール」だけを担当する層
//
// ここには画面の話を一切書かない。
//   ・誰が何をすべきか（夜の行動・投票）
//   ・役職の効果（占い・護衛・襲撃・呪殺など）
//   ・勝敗の判定
// だけを扱う。今は1台のスマホを手渡しして遊ぶが、将来1人1台で
// リアルタイムに遊べるようにする時は、この層をそのまま使って
// 画面側だけ差し替えられる。
//
// ブラウザからは window.WolfLogic、Nodeからは require() で使える。
// （jsdom を立てずに単体テストできるようにするため）

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WolfLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== 陣営 =====
  var TEAM = { VILLAGE: 'village', WOLF: 'wolf', THIRD: 'third' };

  // ===== 役職 =====
  // team は「勝敗をどちら側で数えるか」。
  // looksLike は「占い師・霊媒師から見た時の見え方」（狂人は村人に見える）。
  var ROLES = {
    villager: { id: 'villager', name: '村人', team: TEAM.VILLAGE, looksLike: 'villager', night: null,
      desc: '特別な力はありません。話し合いで人狼を見つけましょう。' },
    wolf: { id: 'wolf', name: '人狼', team: TEAM.WOLF, looksLike: 'wolf', night: 'attack',
      desc: '夜に1人を襲撃します。昼は正体を隠しきりましょう。' },
    seer: { id: 'seer', name: '占い師', team: TEAM.VILLAGE, looksLike: 'villager', night: 'divine',
      desc: '夜に1人を占い、その正体の手がかりを得ます。' },
    medium: { id: 'medium', name: '霊媒師', team: TEAM.VILLAGE, looksLike: 'villager', night: 'medium',
      desc: '前の夜・前の昼に亡くなった人の正体が分かります。' },
    knight: { id: 'knight', name: '騎士', team: TEAM.VILLAGE, looksLike: 'villager', night: 'guard',
      desc: '夜に1人を守り、人狼の襲撃から救います。' },
    madman: { id: 'madman', name: '狂人', team: TEAM.WOLF, looksLike: 'villager', night: null,
      desc: '人狼の味方ですが、占いでは村人に見えます。人狼が誰かは知りません。' },
    mason: { id: 'mason', name: '共有者', team: TEAM.VILLAGE, looksLike: 'villager', night: null, pair: true,
      desc: '2人1組です。お互いが共有者であることを知っています。' },
    fox: { id: 'fox', name: '妖狐', team: TEAM.THIRD, looksLike: 'villager', night: null,
      desc: '村人側・人狼側どちらが勝っても、生き残っていればあなたの勝ちです。ただし占われると死んでしまいます。' },
    teruteru: { id: 'teruteru', name: 'てるてる坊主', team: TEAM.THIRD, looksLike: 'villager', night: null,
      desc: '昼の投票で処刑されることがあなたの勝ちです。' },
    // ---- ターン数1の時だけ使う単発役職 ----
    peek: { id: 'peek', name: 'のぞき見役', team: TEAM.VILLAGE, looksLike: 'villager', oneTurn: true, preVote: 'peek',
      desc: '投票の直前に1人だけ、こっそり相手の陣営が分かります。' },
    fake: { id: 'fake', name: 'にせもの役', team: TEAM.WOLF, looksLike: 'villager', oneTurn: true,
      desc: 'のぞき見役に覗かれると「人狼側」と表示されます。' },
    involve: { id: 'involve', name: 'まきこみ役', team: TEAM.THIRD, looksLike: 'villager', oneTurn: true, preVote: 'involve',
      desc: '投票の直前に1人を指名すると、その人の投票先が全員に公開されます。' }
  };
  var ONE_TURN_ROLE_IDS = ['peek', 'fake', 'involve'];
  var NORMAL_ROLE_IDS = ['wolf', 'seer', 'medium', 'knight', 'madman', 'mason', 'fox', 'teruteru'];

  function roleById(id) { return ROLES[id] || ROLES.villager; }
  // ターン数に応じて、選べる役職の集合が切り替わる（通常役職と1ターン専用役職は同時に選べない）。
  // 人狼だけはどちらでも必要なので常に含める。
  function selectableRoles(turnLimit) {
    var ids = (turnLimit === 1) ? ['wolf'].concat(ONE_TURN_ROLE_IDS) : NORMAL_ROLE_IDS;
    return ids.map(roleById);
  }

  // ===== 設定 =====
  var DEFAULTS = {
    turnLimit: 5,
    counts: { wolf: 1, seer: 0, medium: 0, knight: 0, madman: 0, mason: 0, fox: 0, teruteru: 0,
              peek: 0, fake: 0, involve: 0 },
    lovers: false,             // 恋人を入れるか
    loversPick: 'random',      // 'random' | 'manual'
    seerResult: 'binary',      // 'binary'（白黒のみ）| 'detail'（陣営まで）
    seerShowsThird: false,     // binaryの時に第三陣営も分かるようにするか
    revealRoleOnDeath: true,   // 死亡者の役職をその場で公開するか
    wolfAttackDecision: 'vote', // 人狼が2人以上の時 'vote'（多数決）| 'leader'（代表が決める）
    teruteruContinue: false,   // てるてる坊主が勝った後も試合を続けるか
    nightTimeLimit: 0          // 夜の行動の制限秒数（0＝無制限）
  };

  function mergeConfig(cfg) {
    cfg = cfg || {};
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = (cfg[k] === undefined) ? DEFAULTS[k] : cfg[k];
    });
    out.counts = Object.assign({}, DEFAULTS.counts, (cfg.counts || {}));
    return out;
  }

  // 死亡者の役職を公開する設定では霊媒師が完全に無意味になるので、選択肢から外す
  function isRoleSelectable(roleId, cfg) {
    if (roleId === 'medium' && cfg && cfg.revealRoleOnDeath) return false;
    return true;
  }

  // 共有者は2人1組でしか成立しない。組めない人数なら自動で無効にする
  function normalizeCounts(counts, playerCount, turnLimit) {
    var c = Object.assign({}, counts);
    if (turnLimit === 1) {
      // ターン数1では通常役職を使わない
      NORMAL_ROLE_IDS.forEach(function (id) { if (id !== 'wolf') c[id] = 0; });
    } else {
      ONE_TURN_ROLE_IDS.forEach(function (id) { c[id] = 0; });
    }
    if (c.mason) {
      // 共有者は必ず2人。村人が1人も残らない編成にはしない
      c.mason = 2;
      var others = countAssigned(c) - c.mason;
      if (playerCount < c.mason + others + 1) c.mason = 0;
    }
    return c;
  }
  function countAssigned(counts) {
    return Object.keys(counts).reduce(function (n, k) { return n + (counts[k] || 0); }, 0);
  }

  // 必要な最低人数（役職の合計＋村人1人）
  function minPlayers(counts) {
    return Math.max(3, countAssigned(counts) + 1);
  }

  // プリセットで有効にした役職を、人数に合わせてバランスよく配る。
  // プリセットを選んだ瞬間、何も触らなくても遊べる状態にするために使う。
  function balancedCounts(roleIds, playerCount) {
    var c = { wolf: 0, seer: 0, medium: 0, knight: 0, madman: 0, mason: 0, fox: 0, teruteru: 0,
              peek: 0, fake: 0, involve: 0 };
    var has = function (id) { return (roleIds || []).indexOf(id) >= 0; };
    if (has('wolf')) c.wolf = playerCount >= 11 ? 3 : (playerCount >= 7 ? 2 : 1);
    ['seer', 'medium', 'knight', 'madman'].forEach(function (id) { if (has(id)) c[id] = 1; });
    if (has('mason')) c.mason = 2;                  // 共有者は必ず2人1組
    // 妖狐・てるてる坊主・1ターン専用役職は1人まで
    ['fox', 'teruteru', 'peek', 'fake', 'involve'].forEach(function (id) { if (has(id)) c[id] = 1; });
    // 村人が最低1人は残るように、影響の小さい役職から削る
    var order = ['medium', 'madman', 'mason', 'knight', 'teruteru', 'fox', 'seer', 'fake', 'involve', 'peek'];
    var guard = 0;
    while (countAssigned(c) >= playerCount && guard++ < 50) {
      var removed = false;
      for (var i = 0; i < order.length; i++) {
        if (c[order[i]]) { c[order[i]] = 0; removed = true; break; }
      }
      if (!removed) { if (c.wolf > 1) c.wolf--; else break; }
    }
    return c;
  }

  // 重複配布（闇鍋）で1人（1組）までに制限する役職
  var SINGLE_ONLY_ROLE_IDS = ['fox', 'teruteru', 'peek', 'fake', 'involve'];
  function roleMax(roleId, playerCount) {
    if (roleId === 'mason') return 2;                       // 共有者は2人1組で固定
    if (SINGLE_ONLY_ROLE_IDS.indexOf(roleId) >= 0) return 1; // 妖狐・てるてる坊主などは1人まで
    return Math.max(0, playerCount);
  }

  // 人数に見合った標準的な編成を返す（設定を触らない人向けの初期値）
  function autoCounts(playerCount) {
    var c = { wolf: 1, seer: 0, medium: 0, knight: 0, madman: 0, mason: 0, fox: 0, teruteru: 0 };
    if (playerCount >= 7) c.wolf = 2;
    if (playerCount >= 11) c.wolf = 3;
    if (playerCount >= 5) c.seer = 1;
    if (playerCount >= 8) c.knight = 1;
    // 村人が最低1人は残るように削る
    while (countAssigned(c) >= playerCount) {
      if (c.knight) c.knight = 0;
      else if (c.seer) c.seer = 0;
      else if (c.wolf > 1) c.wolf--;
      else break;
    }
    return c;
  }

  // ===== 役職の配布 =====
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function buildRoleList(counts, playerCount) {
    var list = [];
    Object.keys(counts).forEach(function (id) {
      for (var i = 0; i < (counts[id] || 0); i++) list.push(id);
    });
    while (list.length < playerCount) list.push('villager');
    return list.slice(0, playerCount);
  }

  // ===== ゲームの生成 =====
  function createGame(config) {
    var cfg = mergeConfig(config);
    var rng = config && config.rng;
    var players = (config && config.players ? config.players : []).map(function (p) {
      return { id: p.id, name: p.name };
    });
    var counts = normalizeCounts(cfg.counts, players.length, cfg.turnLimit);
    if (!isRoleSelectable('medium', cfg)) counts.medium = 0;

    var roles = shuffle(buildRoleList(counts, players.length), rng);
    var game = {
      config: cfg,
      counts: counts,
      rng: rng,
      turn: 1,
      phase: cfg.turnLimit === 1 ? 'preVote' : 'night', // 1ターン戦は夜が無い
      players: players.map(function (p, i) {
        return {
          id: p.id, name: p.name, role: roles[i],
          alive: true, isLover: false,
          deadTurn: null, deadCause: null
        };
      }),
      nightActions: {},   // playerId -> targetId
      votes: {},          // voterId -> targetId
      preVoteActions: {}, // playerId -> targetId（1ターン戦の単発役職）
      log: [],            // 何が起きたかの記録（履歴用）
      lastDeaths: [],     // 直前に亡くなった人（霊媒師が見る）
      result: null        // 決着したら入る
    };
    if (cfg.lovers) assignLovers(game, config && config.loverIds);
    return game;
  }

  // 恋人は2人1組。既定はランダム、手動指定もできる
  function assignLovers(game, manualIds) {
    var ids;
    if (manualIds && manualIds.length === 2) ids = manualIds.slice();
    else ids = shuffle(game.players.map(function (p) { return p.id; }), game.rng).slice(0, 2);
    if (ids.length < 2) return;
    ids.forEach(function (id) {
      var p = findPlayer(game, id);
      if (p) p.isLover = true;
    });
    game.loverIds = ids;
  }

  function findPlayer(game, id) {
    return game.players.find(function (p) { return p.id === id; }) || null;
  }
  function alivePlayers(game) { return game.players.filter(function (p) { return p.alive; }); }
  function playersWithRole(game, roleId, aliveOnly) {
    return game.players.filter(function (p) {
      return p.role === roleId && (!aliveOnly || p.alive);
    });
  }
  function teamOf(player) { return roleById(player.role).team; }

  // ===== 夜フェーズ =====
  // 「今、誰が何をすべきか」だけを返す。並べ方や見せ方は画面側の仕事。
  function pendingNightActions(game) {
    if (game.phase !== 'night') return [];
    var out = [];
    alivePlayers(game).forEach(function (p) {
      var r = roleById(p.role);
      if (!r.night) return;
      if (r.night === 'attack') {
        // 人狼が2人以上いて「代表が決める」設定なら、代表だけが選ぶ
        if (game.config.wolfAttackDecision === 'leader') {
          var wolves = playersWithRole(game, 'wolf', true);
          if (wolves.length > 1 && wolves[0].id !== p.id) return;
        }
      }
      out.push({
        playerId: p.id, role: p.role, kind: r.night,
        targets: nightTargets(game, p, r.night)
      });
    });
    return out;
  }

  function nightTargets(game, player, kind) {
    return alivePlayers(game).filter(function (t) {
      if (kind === 'attack') return teamOf(t) !== TEAM.WOLF;   // 仲間は襲わない
      if (kind === 'divine') return t.id !== player.id;        // 自分は占わない
      if (kind === 'guard') return t.id !== player.id;         // 自分は守れない
      return false;
    }).map(function (t) { return { id: t.id, name: t.name }; });
  }

  function setNightAction(game, playerId, targetId) {
    if (game.phase !== 'night') return false;
    game.nightActions[playerId] = targetId;
    return true;
  }

  // 夜の行動をまとめて処理する。誰が死に、誰が何を知ったかを返す。
  function resolveNight(game) {
    var info = {};   // playerId -> その人が得た情報
    var deaths = [];

    // 1) 占い（先に処理する。妖狐は占われた時点で死ぬ＝呪殺）
    playersWithRole(game, 'seer', true).forEach(function (seer) {
      var targetId = game.nightActions[seer.id];
      var target = targetId ? findPlayer(game, targetId) : null;
      if (!target) return;
      info[seer.id] = { kind: 'divine', targetId: target.id, targetName: target.name, result: divineResult(game, target) };
      if (target.role === 'fox' && target.alive) {
        target.alive = false; target.deadTurn = game.turn; target.deadCause = 'cursed';
        deaths.push({ id: target.id, cause: 'cursed' });
      }
    });

    // 2) 護衛
    var guarded = {};
    playersWithRole(game, 'knight', true).forEach(function (k) {
      var t = game.nightActions[k.id];
      if (t) guarded[t] = true;
    });

    // 3) 襲撃（人狼が複数なら設定に応じて決める）
    var attackTarget = decideAttackTarget(game);
    if (attackTarget) {
      var victim = findPlayer(game, attackTarget);
      if (victim && victim.alive) {
        if (guarded[victim.id]) {
          game.log.push({ turn: game.turn, type: 'guarded', id: victim.id });
        } else if (victim.role === 'fox') {
          // 妖狐は人狼の襲撃では死なない
          game.log.push({ turn: game.turn, type: 'attackFailed', id: victim.id });
        } else {
          victim.alive = false; victim.deadTurn = game.turn; victim.deadCause = 'attacked';
          deaths.push({ id: victim.id, cause: 'attacked' });
        }
      }
    }

    // 4) 恋人の後追い
    deaths = deaths.concat(applyLoverDeaths(game));

    // 5) 霊媒（前回亡くなった人の正体）
    playersWithRole(game, 'medium', true).forEach(function (m) {
      var last = game.lastDeaths.map(function (id) {
        var p = findPlayer(game, id);
        return p ? { id: p.id, name: p.name, role: p.role, roleName: roleById(p.role).name } : null;
      }).filter(Boolean);
      info[m.id] = { kind: 'medium', deaths: last };
    });

    game.lastDeaths = deaths.map(function (d) { return d.id; });
    game.nightActions = {};
    game.phase = 'day';
    game.log.push({ turn: game.turn, type: 'night', deaths: deaths.slice() });
    return { deaths: deaths, info: info };
  }

  function decideAttackTarget(game) {
    var wolves = playersWithRole(game, 'wolf', true);
    if (!wolves.length) return null;
    var picks = wolves.map(function (w) { return game.nightActions[w.id]; }).filter(Boolean);
    if (!picks.length) return null;
    if (game.config.wolfAttackDecision === 'leader') return picks[0];
    // 多数決。同数なら先に選ばれた方を採用する
    var count = {};
    picks.forEach(function (id) { count[id] = (count[id] || 0) + 1; });
    var best = picks[0], bestN = 0;
    picks.forEach(function (id) { if (count[id] > bestN) { bestN = count[id]; best = id; } });
    return best;
  }

  // 占い結果の見え方。狂人は村人に見える（＝looksLike を使う）
  function divineResult(game, target) {
    var r = roleById(target.role);
    var looks = roleById(r.looksLike);
    if (game.config.seerResult === 'detail') {
      return { team: looks.team, label: looks.team === TEAM.WOLF ? '人狼側' : (looks.team === TEAM.THIRD ? '第三陣営' : '村人側') };
    }
    // 白黒のみ
    var isWolf = looks.team === TEAM.WOLF;
    if (game.config.seerShowsThird && teamOf(target) === TEAM.THIRD && r.looksLike === target.role) {
      return { team: TEAM.THIRD, label: '第三陣営' };
    }
    return { team: isWolf ? TEAM.WOLF : TEAM.VILLAGE, label: isWolf ? '⚫ 人狼' : '⚪ 人狼ではない' };
  }

  // 恋人は片方が死ぬともう片方も死ぬ
  function applyLoverDeaths(game) {
    if (!game.loverIds) return [];
    var extra = [];
    var lovers = game.loverIds.map(function (id) { return findPlayer(game, id); }).filter(Boolean);
    if (lovers.length === 2 && lovers[0].alive !== lovers[1].alive) {
      var survivor = lovers[0].alive ? lovers[0] : lovers[1];
      survivor.alive = false;
      survivor.deadTurn = game.turn;
      survivor.deadCause = 'lover';
      extra.push({ id: survivor.id, cause: 'lover' });
    }
    return extra;
  }

  // ===== 1ターン戦の単発役職（投票の直前に1回だけ） =====
  function pendingPreVoteActions(game) {
    if (game.phase !== 'preVote') return [];
    return alivePlayers(game).filter(function (p) {
      return !!roleById(p.role).preVote;
    }).map(function (p) {
      return {
        playerId: p.id, role: p.role, kind: roleById(p.role).preVote,
        targets: alivePlayers(game).filter(function (t) { return t.id !== p.id; })
          .map(function (t) { return { id: t.id, name: t.name }; })
      };
    });
  }

  function setPreVoteAction(game, playerId, targetId) {
    if (game.phase !== 'preVote') return false;
    game.preVoteActions[playerId] = targetId;
    return true;
  }

  // のぞき見の結果を返す。にせもの役は「人狼側」に見える
  function resolvePreVote(game) {
    var info = {};
    playersWithRole(game, 'peek', true).forEach(function (p) {
      var t = findPlayer(game, game.preVoteActions[p.id]);
      if (!t) return;
      var team = (t.role === 'fake') ? TEAM.WOLF : teamOf(t);
      info[p.id] = {
        kind: 'peek', targetId: t.id, targetName: t.name, team: team,
        label: team === TEAM.WOLF ? '人狼側' : (team === TEAM.THIRD ? '第三陣営' : '村人側')
      };
    });
    // まきこみ：指名された人の投票先を全員に公開する
    var revealVoteOf = null;
    playersWithRole(game, 'involve', true).forEach(function (p) {
      if (game.preVoteActions[p.id]) revealVoteOf = game.preVoteActions[p.id];
    });
    game.revealVoteOf = revealVoteOf;
    game.phase = 'vote';
    return { info: info, revealVoteOf: revealVoteOf };
  }

  // ===== 投票 =====
  function setVote(game, voterId, targetId) {
    if (game.phase !== 'vote') return false;
    game.votes[voterId] = targetId;
    return true;
  }

  function tallyVotes(game) {
    var counts = {};
    Object.keys(game.votes).forEach(function (voter) {
      var t = game.votes[voter];
      if (!t) return;
      counts[t] = (counts[t] || 0) + 1;
    });
    var max = 0;
    Object.keys(counts).forEach(function (id) { if (counts[id] > max) max = counts[id]; });
    var top = Object.keys(counts).filter(function (id) { return counts[id] === max; });
    return { counts: counts, top: top, tie: top.length > 1, max: max };
  }

  // 処刑を実行する。同数の時は誰も処刑しない（画面側で決選投票にしてもよい）
  function executeVote(game, forcedId) {
    var t = tallyVotes(game);
    var targetId = forcedId || (t.tie || !t.top.length ? null : t.top[0]);
    var executed = null;
    if (targetId) {
      var p = findPlayer(game, targetId);
      if (p && p.alive) {
        p.alive = false; p.deadTurn = game.turn; p.deadCause = 'executed';
        executed = { id: p.id, name: p.name, role: p.role, roleName: roleById(p.role).name };
        game.lastDeaths = [p.id].concat(applyLoverDeaths(game).map(function (d) { return d.id; }));
      }
    }
    game.votes = {};
    game.log.push({ turn: game.turn, type: 'vote', executed: executed ? executed.id : null, counts: t.counts });
    return { tally: t, executed: executed };
  }

  // ===== 勝敗判定 =====
  // 夜の処理のあとと、昼の投票のあとに必ず呼ぶ。
  function evaluate(game) {
    var alive = alivePlayers(game);
    var wolves = alive.filter(function (p) { return p.role === 'wolf'; });
    // 数える対象からは、人狼・妖狐・恋人を外す（狂人は人間なので数に入る）
    var villagers = alive.filter(function (p) {
      return p.role !== 'wolf' && p.role !== 'fox' && !p.isLover;
    });
    var foxAlive = alive.some(function (p) { return p.role === 'fox'; });

    // てるてる坊主の個人勝利は「処刑された瞬間」に決まるので、
    // 試合を続行する設定でも分かるよう、決着前でも必ず返す
    var teruteruWin = !!game.teruteruWin;

    var winner = null;
    if (wolves.length === 0) winner = TEAM.VILLAGE;
    else if (wolves.length >= villagers.length) winner = TEAM.WOLF;
    if (!winner) return { ended: false, winner: null, teruteruWin: teruteruWin, loversWin: loversWin(game) };

    // 妖狐は、村人側・人狼側どちらの決着でも生きていれば勝ち（最優先）
    if (foxAlive) winner = 'fox';

    return {
      ended: true,
      winner: winner,
      loversWin: loversWin(game),
      teruteruWin: teruteruWin
    };
  }

  function loversWin(game) {
    if (!game.loverIds) return false;
    return game.loverIds.every(function (id) {
      var p = findPlayer(game, id);
      return p && p.alive;
    });
  }

  // てるてる坊主は「処刑された瞬間」に個人勝利。試合を続けるかは設定次第
  function checkTeruteru(game, executed) {
    if (!executed || executed.role !== 'teruteru') return false;
    game.teruteruWin = true;
    game.log.push({ turn: game.turn, type: 'teruteruWin', id: executed.id });
    return true;
  }

  // ===== ターン進行 =====
  function isFinalTurn(game) { return game.turn >= game.config.turnLimit; }

  // 次のターンへ。上限に達していたら、夜を飛ばして最終投票だけを行う。
  function nextTurn(game) {
    if (game.result) return game.phase;
    if (isFinalTurn(game)) {
      game.phase = 'finalVote';
      return game.phase;
    }
    game.turn++;
    game.phase = 'night';
    return game.phase;
  }

  // 最終投票まで終わっても決着しない場合は村人陣営の勝ちにする（詰み防止）
  function finish(game, evaluation) {
    var res = evaluation || evaluate(game);
    if (!res.ended) {
      res = { ended: true, winner: TEAM.VILLAGE, reason: 'turnLimit',
              loversWin: loversWin(game), teruteruWin: !!game.teruteruWin };
    }
    game.result = res;
    game.phase = 'ended';
    return res;
  }

  // ===== 対戦履歴に残す内容 =====
  function summary(game) {
    var used = {};
    game.players.forEach(function (p) { used[p.role] = (used[p.role] || 0) + 1; });
    return {
      turnLimit: game.config.turnLimit,
      turnsPlayed: game.turn,
      roles: used,
      winner: game.result ? game.result.winner : null,
      teruteruWin: !!game.teruteruWin,
      loversWin: game.loverIds ? loversWin(game) : null,
      players: game.players.map(function (p) {
        return { id: p.id, name: p.name, role: p.role, alive: p.alive };
      })
    };
  }

  return {
    TEAM: TEAM, ROLES: ROLES,
    ONE_TURN_ROLE_IDS: ONE_TURN_ROLE_IDS, NORMAL_ROLE_IDS: NORMAL_ROLE_IDS,
    roleById: roleById, selectableRoles: selectableRoles, isRoleSelectable: isRoleSelectable,
    normalizeCounts: normalizeCounts, minPlayers: minPlayers, countAssigned: countAssigned,
    autoCounts: autoCounts, balancedCounts: balancedCounts,
    roleMax: roleMax, SINGLE_ONLY_ROLE_IDS: SINGLE_ONLY_ROLE_IDS,
    createGame: createGame,
    findPlayer: findPlayer, alivePlayers: alivePlayers, playersWithRole: playersWithRole, teamOf: teamOf,
    pendingNightActions: pendingNightActions, setNightAction: setNightAction, resolveNight: resolveNight,
    pendingPreVoteActions: pendingPreVoteActions, setPreVoteAction: setPreVoteAction, resolvePreVote: resolvePreVote,
    setVote: setVote, tallyVotes: tallyVotes, executeVote: executeVote, checkTeruteru: checkTeruteru,
    evaluate: evaluate, isFinalTurn: isFinalTurn, nextTurn: nextTurn, finish: finish,
    summary: summary
  };
});
