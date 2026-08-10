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
      desc: '前の昼に処刑された人の正体が分かります。夜に襲われた人は分かりません。' },
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
    wolfAttackDecision: 'vote', // 人狼が2人以上の時 'vote'（全員で多数決）| 'each'（各自が独立に選ぶ）
    teruteruContinue: false,   // てるてる坊主が勝った後も試合を続けるか
    nightTimeLimit: 0,         // 夜の行動の制限秒数（0＝無制限）
    // 第20弾-5-2：誰に何票入ったかを結果で見せるか。
    // ここに書かないと mergeConfig が既定値しか通さず、画面側の設定が届かない。
    showVoteCounts: true
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

  // 闇鍋：村人を1人も作らず、全員が何かしらの役職を持つ編成を返す（第20弾-9-2）。
  // balancedCounts は必ず村人を1人残すので、こちらは席を全部埋めるための別関数。
  // ※共有者は「2人1組」かつ normalizeCounts が村人0になる時に落とすので、ここでは扱わない。
  // 第22弾-3：ごく稀に、何の役職も持たない村人が1人だけ紛れる。
  // 全員が役職持ちだと「自分は村人だ」という主張が絶対に嘘になるので、
  // その前提をたまに崩して、場に揺さぶりを入れるための仕掛け。
  var CHAOS_VILLAGER_CHANCE = 0.05; // 5%
  function chaosCounts(roleIds, playerCount, rng) {
    var c = { wolf: 0, seer: 0, medium: 0, knight: 0, madman: 0, mason: 0, fox: 0, teruteru: 0,
              peek: 0, fake: 0, involve: 0 };
    var has = function (id) { return (roleIds || []).indexOf(id) >= 0; };
    // 村人を1人だけ紛れさせる時は、埋める席を1つ減らして計算する。
    // 5人未満で使うと人狼だけが残りかねないので、余裕がある時だけ。
    var roll = rng ? rng() : Math.random();
    var sneakVillager = (playerCount >= 5) && (roll < CHAOS_VILLAGER_CHANCE);
    var seats = sneakVillager ? (playerCount - 1) : playerCount;
    // 人狼は多すぎると即決着するので、必ず過半数未満に収める
    var wolfCap = Math.max(1, Math.floor((playerCount - 1) / 2));
    if (has('wolf')) c.wolf = Math.min(wolfCap, playerCount >= 11 ? 3 : (playerCount >= 7 ? 2 : 1));
    ['seer', 'medium', 'knight', 'madman'].forEach(function (id) { if (has(id)) c[id] = 1; });
    ['fox', 'teruteru'].forEach(function (id) { if (has(id)) c[id] = 1; });

    // 席より多いなら、影響の小さい役職から落とす
    var dropOrder = ['teruteru', 'fox', 'madman', 'medium', 'knight', 'seer'];
    for (var i = 0; i < dropOrder.length && countAssigned(c) > seats; i++) {
      if (c[dropOrder[i]]) c[dropOrder[i]] = 0;
    }
    while (countAssigned(c) > seats && c.wolf > 1) c.wolf--;

    // 席が余っているぶんは、重ねられる役職を増やして埋める（村人を作らないのが闇鍋）
    var repeatable = ['seer', 'medium', 'knight', 'madman'].filter(has);
    var k = 0, guard = 0;
    while (countAssigned(c) < seats && guard++ < 200) {
      if (repeatable.length) { c[repeatable[k % repeatable.length]]++; k++; }
      else if (has('wolf') && c.wolf < wolfCap) c.wolf++;
      else break; // 埋められない（村人が残る）ときは、そこで諦める
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
          deadTurn: null, deadCause: null,
          // 第26弾-4：称号のもとになる「その人の仕事ぶり」。
          // 起きた瞬間にしか分からないもの（占って人狼だった・護衛が働いた・
          // 霊媒で人狼を見た・欺いた）を、その場で数えておく。
          // 公開ビューは項目を明示して組み立てるので、ここに足しても外へは漏れない。
          ach: { seerHits: 0, knightSaves: 0, mediumHits: 0, tricks: 0 }
        };
      }),
      nightActions: {},   // playerId -> targetId
      votes: {},          // voterId -> targetId
      preVoteActions: {}, // playerId -> targetId（1ターン戦の単発役職）
      log: [],            // 何が起きたかの記録（履歴用）
      // 第24弾-1：霊媒師が見るのは「前の昼に処刑された人」だけ。
      // 以前は「直前に亡くなった人」を持っていたので、処刑が無かった翌日は
      // 夜に襲われた人の役職を霊媒師が言い当ててしまっていた。
      lastExecuted: null,
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
  // 第26弾-4：仕事ぶりのカウンタ。古いセーブや外から作った game でも落ちないようにする
  function bumpAch(player, key, n) {
    if (!player) return;
    if (!player.ach) player.ach = { seerHits: 0, knightSaves: 0, mediumHits: 0, tricks: 0 };
    player.ach[key] = (player.ach[key] || 0) + (n == null ? 1 : n);
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
      // 襲撃は人狼全員がそれぞれ選ぶ（多数決でも各自選択でも、全員に聞く）
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
    game.attackOverlap = false; // 毎晩リセット（前の晩の記録を持ち越さない）

    // 1) 占い（先に処理する。妖狐は占われた時点で死ぬ＝呪殺）
    playersWithRole(game, 'seer', true).forEach(function (seer) {
      var targetId = game.nightActions[seer.id];
      var target = targetId ? findPlayer(game, targetId) : null;
      if (!target) return;
      info[seer.id] = { kind: 'divine', targetId: target.id, targetName: target.name, result: divineResult(game, target) };
      // 第26弾-4：占った相手が本当に人狼だった回数（称号「千里眼」「予言者」）
      if (target.role === 'wolf') bumpAch(seer, 'seerHits');
      if (target.role === 'fox' && target.alive) {
        target.alive = false; target.deadTurn = game.turn; target.deadCause = 'cursed';
        deaths.push({ id: target.id, cause: 'cursed' });
      }
    });

    // 2) 護衛
    var guarded = {};
    var guardSaved = {}; // 実際に襲撃を防いだ相手
    playersWithRole(game, 'knight', true).forEach(function (k) {
      var t = game.nightActions[k.id];
      if (t) guarded[t] = true;
    });

    // 3) 襲撃（設定に応じて1人 or 人狼それぞれが選んだ相手）
    decideAttackTargets(game).forEach(function (targetId) {
      var victim = findPlayer(game, targetId);
      if (!victim || !victim.alive) return;
      if (guarded[victim.id]) {
        guardSaved[victim.id] = true; // 第20弾-5-1：騎士に「守れた」と伝えるため
        game.log.push({ turn: game.turn, type: 'guarded', id: victim.id });
      } else if (victim.role === 'fox') {
        // 妖狐は人狼の襲撃では死なない
        game.log.push({ turn: game.turn, type: 'attackFailed', id: victim.id });
      } else {
        victim.alive = false; victim.deadTurn = game.turn; victim.deadCause = 'attacked';
        deaths.push({ id: victim.id, cause: 'attacked' });
      }
    });

    // 4) 恋人の後追い
    deaths = deaths.concat(applyLoverDeaths(game));

    // 4.5) 護衛の結果（第20弾-5-1）
    // 騎士は、自分の守りが実際に働いたのかが分からないと、次の夜の判断ができない。
    // 守った相手が襲われていたか＝守れたかどうかを本人にだけ伝える。
    // ※ここで初めて確定するので、夜のうちには渡せない（次に手渡された時に見せる）
    playersWithRole(game, 'knight', true).forEach(function (k) {
      var t = game.nightActions[k.id];
      if (!t) return;
      var target = findPlayer(game, t);
      if (!target) return;
      info[k.id] = {
        kind: 'guard', targetId: target.id, targetName: target.name,
        saved: !!guardSaved[target.id]
      };
      // 第26弾-4：守りが実際に働いた回数（称号「忠実」「守護者」）
      if (guardSaved[target.id]) bumpAch(k, 'knightSaves');
    });

    // 5) 霊媒（前の昼に処刑された人の正体）
    playersWithRole(game, 'medium', true).forEach(function (m) {
      var mi = mediumInfo(game);
      info[m.id] = mi;
      // 第26弾-4：処刑されたのが人狼側だったと分かった回数（称号「亡霊」）。
      // 「誰も処刑されなかった」夜は何も分からないので数えない
      if (mi.executed && mi.executed.team === TEAM.WOLF) bumpAch(m, 'mediumHits');
    });

    game.nightActions = {};
    game.phase = 'day';
    game.log.push({ turn: game.turn, type: 'night', deaths: deaths.slice() });
    return { deaths: deaths, info: info, attackOverlap: !!game.attackOverlap };
  }

  // 襲撃先を決める。返り値は「襲う相手の一覧」。
  //   'vote'  … 人狼全員で多数決。襲うのは1人
  //   'each'  … 人狼それぞれが独立に選ぶ。同じ相手を選んだら重なるだけで死者は増えない
  function decideAttackTargets(game) {
    var wolves = playersWithRole(game, 'wolf', true);
    if (!wolves.length) return [];
    var picks = wolves.map(function (w) { return game.nightActions[w.id]; }).filter(Boolean);
    if (!picks.length) return [];
    if (game.config.wolfAttackDecision === 'each') {
      // 重複を取り除く（2人が同じ相手を選んでも死ぬのは1人）。
      // 第20弾-4-2：被ったこと自体を朝に伝えたいので、記録に残しておく。
      // 結果だけ見ても「なぜ1人しか欠けていないのか」が分からないため。
      var uniq = picks.filter(function (id, i) { return picks.indexOf(id) === i; });
      game.attackOverlap = (picks.length > uniq.length);
      return uniq;
    }
    game.attackOverlap = false;
    // 多数決。同数なら先に選ばれた方を採用する
    var count = {};
    picks.forEach(function (id) { count[id] = (count[id] || 0) + 1; });
    var best = picks[0], bestN = 0;
    picks.forEach(function (id) { if (count[id] > bestN) { bestN = count[id]; best = id; } });
    return [best];
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

  // 第20弾-2：占い結果は「対象の役職」だけで決まるので、夜が明けるのを待たずに出せる。
  // 状態を一切変えない（呪殺などの反映は今までどおり resolveNight が行う）。
  function previewDivine(game, targetId) {
    var target = findPlayer(game, targetId);
    if (!target) return null;
    var res = divineResult(game, target);
    return { kind: 'divine', targetId: target.id, targetName: target.name, result: res };
  }
  // 霊媒師が知るのは「前の昼に処刑された人の正体」だけ。
  //
  // 第24弾-1：夜に襲われた人は対象外。決選投票を経た場合は、
  // その最終的な処刑者を指す（executeVote が確定した1人をそのまま持つので、
  // 1回目の投票で最多だった人を誤って指すことはない）。
  // 夜の頭には確定しているので、その場で渡せる。
  function mediumInfo(game) {
    var ex = game.lastExecuted;
    if (!ex) return { kind: 'medium', executed: null };
    var p = findPlayer(game, ex.id);
    return {
      kind: 'medium',
      executed: {
        id: ex.id,
        name: p ? p.name : ex.name,
        role: ex.role,
        roleName: roleById(ex.role).name,
        team: roleById(ex.role).team
      }
    };
  }
  function previewMedium(game) { return mediumInfo(game); }

  // のぞき見も、覗いた瞬間に結果が確定している（状態は変えない）
  function previewPeek(game, targetId) {
    var t = findPlayer(game, targetId);
    if (!t) return null;
    var team = (t.role === 'fake') ? TEAM.WOLF : teamOf(t);
    return {
      kind: 'peek', targetId: t.id, targetName: t.name, team: team,
      label: team === TEAM.WOLF ? '人狼側' : (team === TEAM.THIRD ? '第三陣営' : '村人側')
    };
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

  // 投票の集計。この関数だけが「誰が処刑されるか」を決める。
  //
  // 第22弾-6：ここに集約する前は、同じ集計がアプリの中に3か所あった。
  // そのうち1か所だけが「過半数（50%超）を集めないと処刑されない」という
  // 別のルールのまま残っていて、一番多く票を集めたウルフが逃げ切ってしまう
  // バグになっていた。ルールを1つにするために、集計はここへ一本化する。
  //
  //   ・一番多く票を集めた人が処刑される（過半数である必要はない）
  //   ・同数で並んだら、誰も処刑しない
  //   ・1票も入っていなければ、やはり処刑なし
  //
  // ゲームの状態ではなく「誰が誰に入れたか」だけを受け取るので、
  // 人狼からもワードウルフからも同じものを呼べる。
  function tally(votes) {
    var counts = {};
    Object.keys(votes || {}).forEach(function (voter) {
      var t = votes[voter];
      if (!t) return;
      counts[t] = (counts[t] || 0) + 1;
    });
    var max = 0;
    Object.keys(counts).forEach(function (id) { if (counts[id] > max) max = counts[id]; });
    var top = Object.keys(counts).filter(function (id) { return counts[id] === max; });
    var tie = top.length > 1;
    return {
      counts: counts, top: top, tie: tie, max: max,
      executedId: (tie || !top.length) ? null : top[0]
    };
  }
  function tallyVotes(game) { return tally(game.votes); }

  // 投票のあと、次に何をするかを決める。
  //
  // 第23弾-1：決選投票を足すにあたって、その判断もここに置く。
  // 集計は tally に任せ、ここは「同数だったらどうするか」だけを決める。
  // 画面側は返ってきた kind に従うだけなので、ワードウルフでも人狼でも
  // まったく同じ手順になる（また2通りの実装が生えないように）。
  //
  //   { kind:'execute', targetId }   … その人を処刑する
  //   { kind:'runoff',  candidates } … 同数。並んだ人だけでもう一度投票する
  //   { kind:'none' }                … 誰も処刑しない
  //
  // 決選投票は1回まで（opts.isRunoff）。決選投票でも同数なら、
  // そこで処刑なしに確定する。無限に投票し続けないための歯止め。
  function voteOutcome(votes, opts) {
    opts = opts || {};
    var t = tally(votes);
    if (t.executedId) return { tally: t, kind: 'execute', targetId: t.executedId, candidates: [] };
    // 第32弾-C：決選投票をしない設定（opts.runoff === false）なら、
    // 同数はそのまま「処刑なし」で確定する。
    // 付けなかった時は今までどおり決選投票をする（既存の呼び出しに影響しない）。
    if (t.tie && !opts.isRunoff && opts.runoff !== false) {
      return { tally: t, kind: 'runoff', targetId: null, candidates: t.top.slice() };
    }
    return { tally: t, kind: 'none', targetId: null, candidates: [] };
  }

  // 処刑を実行する。同数の時は誰も処刑しない（決選投票の結果は forcedId で渡す）
  function executeVote(game, forcedId) {
    var t = tallyVotes(game);
    var targetId = forcedId || t.executedId;
    var executed = null;
    if (targetId) {
      var p = findPlayer(game, targetId);
      if (p && p.alive) {
        p.alive = false; p.deadTurn = game.turn; p.deadCause = 'executed';
        executed = { id: p.id, name: p.name, role: p.role, roleName: roleById(p.role).name };
        applyLoverDeaths(game); // 恋人は後を追うが、処刑されたわけではない
      }
    }
    // 第24弾-1：霊媒師が見るのはここで決まった1人だけ。
    // 処刑が無かった昼は、必ず null に戻す（前の夜の襲撃死が残らないように）。
    // 恋人の後追いも「処刑された人」ではないので含めない。
    game.lastExecuted = executed;
    // 誰が誰に入れたかも残す（スコアの「読みが当たったか」の判定に使う）
    var castVotes = Object.assign({}, game.votes);
    game.votes = {};
    game.log.push({ turn: game.turn, type: 'vote', executed: executed ? executed.id : null,
                    counts: t.counts, votes: castVotes });
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

  // ===== スコア（第18弾・人狼専用の配点） =====
  // 考え方：
  //   ・勝敗が主、読みの精度が従。読みが当たっても負けた人が、勝った人を上回らないようにする
  //   ・人数が少ない陣営ほど1人あたりの配点を上げて、人狼側の少人数ハンデをならす
  //   ・「人狼を当てられなかった」ペナルティは、人狼を探す側（村人陣営）にだけ効かせる
  //     人狼が村人に投票するのは正しい立ち回りであって「外した」ではないため
  var SCORE = {
    win: 10,          // 陣営勝利の基本点
    wolfWinCap: 20,   // 人狼側の1人あたり上限
    soloWin: 15,      // 妖狐・てるてる坊主の個人勝利
    loversWin: 12,    // 恋人2人の勝利
    perGoodVote: 2,   // 人狼に投票できたターンごと
    goodVoteCap: 6    // 読みの精度で得られる上限
  };

  function isVillageTeam(player) { return roleById(player.role).team === TEAM.VILLAGE; }

  // 各プレイヤーが「人狼に投票できたターン数」を数える
  function goodVoteTurns(game, playerId) {
    var n = 0;
    (game.log || []).forEach(function (entry) {
      if (entry.type !== 'vote' || !entry.votes) return;
      var target = entry.votes[playerId];
      if (!target) return;
      var t = findPlayer(game, target);
      if (t && t.role === 'wolf') n++;
    });
    return n;
  }
  // その人が一度でも投票したか（一度も投票していない人を「外した」扱いにしない）
  function votedAtAll(game, playerId) {
    return (game.log || []).some(function (entry) {
      return entry.type === 'vote' && entry.votes && entry.votes[playerId];
    });
  }

  /**
   * 第26弾-4：称号のもとになる「その人がこの試合で何をしたか」。
   * 数え方をここ1か所に置く（画面ごとに数え直すと、片方だけ古くなるため）。
   * 返すのは titles.js の jinro カウンタと同じ名前の増分。
   *
   * 判断が要ったところ：
   *   ・逃げ切り … 人狼側で、一度も処刑されずに試合が終わったこと。
   *                襲われて死ぬことはないので「当てられなかった」と同じ意味になる。
   *   ・欺いた   … のぞき見役・にせもの役・まきこみ役が能力を使い、自分の側が勝ったこと。
   *   ・逆転     … 決選投票（同じターンの2回目の投票）で処刑された人に入れ、勝ったこと。
   */
  function achievements(game, playerId) {
    var p = findPlayer(game, playerId);
    var out = {};
    if (!p) return out;
    var res = game.result || evaluate(game);
    if (!res || !res.winner) return out;   // 決着していない試合は数えない
    var team = teamOf(p);
    var s = scoreGame(game)[p.id] || {};
    var ach = p.ach || {};
    var votes = (game.log || []).filter(function (e) { return e.type === 'vote'; });
    var executedMe = votes.some(function (e) { return e.executed === p.id; });

    out.plays = 1;
    if (s.win) {
      out.wins = 1;
      if (team === TEAM.VILLAGE) out.villageWins = 1;
      else if (team === TEAM.WOLF) out.wolfWins = 1;
      if (p.role === 'fox') out.foxWins = 1;
    }
    out.correctVotes = goodVoteTurns(game, p.id);
    if (ach.seerHits) out.seerHits = ach.seerHits;
    if (ach.knightSaves) out.knightSaves = ach.knightSaves;
    if (ach.mediumHits) out.mediumHits = ach.mediumHits;

    if (team === TEAM.WOLF && !executedMe) out.wolfEscapes = 1;
    if (p.role === 'madman' && !executedMe) out.madmanHidden = 1;
    if (p.role === 'fox' && res.winner === 'fox') out.foxSolo = 1;
    if (p.isLover && (game.loverIds || []).every(function (id) {
      var l = findPlayer(game, id); return l && l.alive;
    })) out.loversSurvived = 1;

    // 一手だけの特殊役職。能力を使って、自分の側が勝てたら「欺けた」とみなす
    if (['peek', 'fake', 'involve'].indexOf(p.role) >= 0 &&
        (game.preVoteActions || {})[p.id] && s.win) out.tricks = 1;

    // 決選投票（同じターンに2回目の投票があった回）で、処刑された人に入れていたか
    var byTurn = {};
    votes.forEach(function (e) { (byTurn[e.turn] = byTurn[e.turn] || []).push(e); });
    var comeback = Object.keys(byTurn).some(function (t) {
      var list = byTurn[t];
      if (list.length < 2) return false;
      var last = list[list.length - 1];
      return last.executed && last.votes && last.votes[p.id] === last.executed;
    });
    if (comeback && s.win) out.runoffComeback = 1;
    return out;
  }

  function scoreGame(game) {
    var res = game.result || evaluate(game);
    var winner = res.winner;
    var alive = alivePlayers(game);
    var wolfCount = game.players.filter(function (p) { return roleById(p.role).team === TEAM.WOLF; }).length;
    var villageCount = game.players.filter(isVillageTeam).length;
    // 人狼側は人数が少ないぶん、1人あたりの配点を上げる
    var wolfWin = Math.min(SCORE.wolfWinCap,
      Math.round(SCORE.win * (wolfCount ? (villageCount / wolfCount) : 1)));

    var out = {};
    game.players.forEach(function (p) {
      var team = roleById(p.role).team;
      var points = 0;
      var reasons = [];
      var won = false;

      if (winner === TEAM.VILLAGE && team === TEAM.VILLAGE) { won = true; points += SCORE.win; reasons.push('村人陣営の勝利'); }
      else if (winner === TEAM.WOLF && team === TEAM.WOLF) { won = true; points += wolfWin; reasons.push('人狼陣営の勝利'); }
      else if (winner === 'fox' && p.role === 'fox') { won = true; points += SCORE.soloWin; reasons.push('妖狐の勝利'); }

      // 読みの精度（人狼を探す側だけの評価）
      var good = 0;
      if (isVillageTeam(p)) {
        good = goodVoteTurns(game, p.id);
        var acc = Math.min(SCORE.goodVoteCap, good * SCORE.perGoodVote);
        if (acc > 0) { points += acc; reasons.push('人狼を見抜いた（' + good + '回）'); }
        // 一度も人狼に投票できなかった人は、陣営の勝利点が半分になる
        if (won && good === 0 && votedAtAll(game, p.id)) {
          points = Math.floor(points / 2);
          reasons.push('人狼を当てられなかったため半分');
        }
      }

      // 個人勝利は陣営の勝敗と別に加算する
      if (res.teruteruWin && p.role === 'teruteru') { won = true; points += SCORE.soloWin; reasons.push('てるてる坊主の個人勝利'); }
      if (res.loversWin && p.isLover) { won = true; points += SCORE.loversWin; reasons.push('恋人の勝利'); }

      out[p.id] = { points: points, win: won, goodVotes: good, reasons: reasons, alive: p.alive };
    });
    return out;
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
    autoCounts: autoCounts, balancedCounts: balancedCounts, chaosCounts: chaosCounts,
    roleMax: roleMax, SINGLE_ONLY_ROLE_IDS: SINGLE_ONLY_ROLE_IDS,
    createGame: createGame,
    findPlayer: findPlayer, alivePlayers: alivePlayers, playersWithRole: playersWithRole, teamOf: teamOf,
    pendingNightActions: pendingNightActions, setNightAction: setNightAction, resolveNight: resolveNight,
    previewDivine: previewDivine, previewMedium: previewMedium, previewPeek: previewPeek,
    pendingPreVoteActions: pendingPreVoteActions, setPreVoteAction: setPreVoteAction, resolvePreVote: resolvePreVote,
    setVote: setVote, tally: tally, tallyVotes: tallyVotes, voteOutcome: voteOutcome,
    executeVote: executeVote, checkTeruteru: checkTeruteru,
    evaluate: evaluate, isFinalTurn: isFinalTurn, nextTurn: nextTurn, finish: finish,
    SCORE: SCORE, scoreGame: scoreGame, isVillageTeam: isVillageTeam, goodVoteTurns: goodVoteTurns,
    achievements: achievements,
    summary: summary
  };
});
