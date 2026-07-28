// realtime.js — 複数のスマホが同じ部屋の状態を共有するための土台（第19弾）
//
// 設計の芯（ここを崩さないこと）:
//   状態はサーバーが持ち、ロジックもサーバーで計算する。
//   ホスト端末は「今の状態を表示し、操作をサーバーに伝える」だけで、勝敗判定などは一切しない。
//   だからホストが変わっても・落ちても、部屋の状態は失われない。
//
// 「部屋のオーナー」と「ホスト」は別物:
//   オーナー = 部屋を作ったアカウント(user_id)。対戦履歴の記録先。途中で変わらない。
//   ホスト   = いま進行を担当している端末。誰にでも譲れるし、切断されたら自動で移る。
//
// 部屋はメモリ上のみ。サーバーを再起動すると進行中の部屋は消える（今回は許容する仕様）。

const crypto = require('crypto');
const WolfLogic = require('./public/js/wolf-logic.js');
const WolfRoom = require('./wolf-room.js');

// 紛らわしい文字（0/O, 1/I/L など）を除いた部屋コード用の文字
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

const ROLE_PLAYER = 'player';
const ROLE_BIGSCREEN = 'bigscreen';

// ハートビート：この間隔で ping を送り、この時間返事が無ければ切断扱いにする
const HEARTBEAT_INTERVAL_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 25000;
const SWEEP_INTERVAL_MS = 5000;
// 空になった部屋を片付けるまでの猶予（全員が一時的に切れただけ、というケースを守る）
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

// db.js はネイティブモジュール（better-sqlite3）を読む。
// 読めない環境でも realtime 自体は動かしたいので、失敗しても落とさない。
function safeRequireDb() {
  try { return require('./db'); }
  catch (e) {
    console.warn('[realtime] db を読み込めませんでした。対戦履歴は保存されません:', e.message);
    return null;
  }
}

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function normalizeRole(role) {
  return role === ROLE_BIGSCREEN ? ROLE_BIGSCREEN : ROLE_PLAYER;
}

/**
 * 部屋の置き場。テストから直接触れるように、Mapごと外に出しておく。
 */
class RoomStore {
  constructor() {
    this.rooms = new Map(); // code -> room
  }

  create({ ownerUserId, ownerUsername }) {
    let code;
    let guard = 0;
    do { code = randomCode(); } while (this.rooms.has(code) && guard++ < 50);
    const room = {
      code,
      ownerUserId: ownerUserId || null,     // アカウント。履歴の記録先。ホストが変わっても不変
      ownerUsername: ownerUsername || null,
      hostMemberId: null,                   // いま進行している端末。譲渡・自動引き継ぎで動く
      members: new Map(),                   // memberId -> member
      // ゲームの種類を問わない汎用の状態。
      // 今後ゲームをリアルタイム化する時は、ここの game / data に固有の状態を載せる。
      state: { phase: 'lobby', game: null, data: {} },
      createdAt: Date.now(),
      emptySince: null
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase()) || null;
  }

  delete(code) {
    this.rooms.delete(code);
  }
}

// ---- 部屋の中身を読むためのヘルパー（ロジックはここに集約し、ハンドラ側では判断しない） ----

function memberList(room) {
  return Array.from(room.members.values());
}

// 大画面ホストは人数に数えない。ゲームの参加人数はかならずこれを使う
function playerMembers(room) {
  return memberList(room).filter((m) => m.role === ROLE_PLAYER);
}

function connectedMembers(room) {
  return memberList(room).filter((m) => m.connected);
}

/**
 * 次のホストを選ぶ。いちばん早く入った接続中のメンバー。
 * 役割で優先順位を付けないのは、大画面ホストしか残っていない場面でも
 * 部屋が止まらないようにするため。
 */
function pickNextHost(room, excludeMemberId) {
  const candidates = connectedMembers(room)
    .filter((m) => m.id !== excludeMemberId)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  return candidates.length ? candidates[0].id : null;
}

/**
 * 全員に配ってよい、部屋の公開スナップショット。
 * 役職などの秘密は絶対にここへ入れないこと（入れた瞬間に全員へ配られる）。
 */
function publicSnapshot(room) {
  return {
    code: room.code,
    ownerUserId: room.ownerUserId,
    ownerUsername: room.ownerUsername,
    hostMemberId: room.hostMemberId,
    playerCount: playerMembers(room).length, // 大画面ホストを除いた人数
    memberCount: room.members.size,
    members: memberList(room)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        connected: m.connected,
        isHost: m.id === room.hostMemberId
      })),
    state: {
      phase: room.state.phase,
      game: room.state.game,
      // 人狼が始まっていれば、公開してよい範囲だけを載せる。
      // 役職・投票先などの秘密は publicView が一切通さない
      data: room.wolf ? WolfRoom.publicView(room) : room.state.data
    }
  };
}

/**
 * socket.io をExpressのhttpサーバーに相乗りさせ、部屋の仕組みを載せる。
 * @param {http.Server} httpServer 既存のHTTPサーバー（別ポートは立てない）
 * @param {Function} sessionMiddleware 既存の express-session。socket.io と共有してログイン判定に使う
 */
function attachRealtime(httpServer, sessionMiddleware, options) {
  const { Server } = require('socket.io');
  const opts = options || {};
  const store = opts.store || new RoomStore();
  // 第21弾-8：対戦履歴は、HTTP API ではなくサーバーから直接書く。
  // /api/matches は requireAuth ＋ req.session.userId で本人性を見るため、
  // 部屋のオーナーがゲーム終了時にその場に居ないと記録できない（指示19の申し送り）。
  // テストからは差し替えられるようにしておく。
  const db = (opts.db !== undefined) ? opts.db : safeRequireDb();
  // 掃除の間隔と猶予はテストから短くできるようにする（本番は既定値のまま）
  const sweepIntervalMs = opts.sweepIntervalMs || SWEEP_INTERVAL_MS;
  const emptyRoomTtlMs = opts.emptyRoomTtlMs != null ? opts.emptyRoomTtlMs : EMPTY_ROOM_TTL_MS;

  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    // engine.io 自身の死活監視。アプリ側のハートビートとは別に、これも効かせておく
    pingInterval: HEARTBEAT_INTERVAL_MS,
    pingTimeout: HEARTBEAT_TIMEOUT_MS
  });

  // express-session をそのまま socket.io にも通す。
  // これで socket.request.session.userId が、HTTP側の req.session.userId と同じものになる。
  io.engine.use(sessionMiddleware);

  function sessionOf(socket) {
    return (socket.request && socket.request.session) || {};
  }

  function broadcast(room) {
    io.to('room:' + room.code).emit('room:update', publicSnapshot(room));
  }

  function socketOf(memberId, room) {
    const m = room.members.get(memberId);
    if (!m || !m.socketId) return null;
    return io.sockets.sockets.get(m.socketId) || null;
  }

  // 秘密の情報は「その人のsocketにだけ」送る。部屋全体には流さない
  function emitPrivate(room, memberId, event, payload) {
    const s = socketOf(memberId, room);
    if (s) s.emit(event, payload);
  }

  // 第21弾-7：状態が動いたら、公開情報は全員へ、秘密は本人にだけ配る。
  // 秘密を配る先は「その人のsocket」だけなので、大画面ホストには何も届かない
  // （大画面はプレイヤーではないので privateFor が null を返す）。
  function pushWolfState(room) {
    broadcast(room); // 公開情報（publicSnapshot → WolfRoom.publicView）
    if (!room.wolf) return;
    for (const m of room.members.values()) {
      const mine = WolfRoom.privateFor(room, m.id);
      if (mine) emitPrivate(room, m.id, 'wolf:you', mine);
    }
    if (room.wolf.phase === WolfRoom.PHASE.ENDED && !room.wolf.recorded) {
      room.wolf.recorded = true;
      recordWolfMatch(room);
      io.to('room:' + room.code).emit('wolf:ended', WolfRoom.publicView(room));
    }
  }

  // 決着したら、部屋のオーナー（アカウント）の記録として残す。
  // オーナーがその場に居なくても書けるよう、db を直接叩く。
  function recordWolfMatch(room) {
    if (!db || !room.ownerUserId || !room.wolf) return;
    try {
      const g = room.wolf.game;
      const summary = WolfLogic.summary(g);
      summary.game = 'wolfrole';
      summary.style = 'realtime';           // 手渡しと1人1台を後から見分けられるように
      summary.preset = room.wolf.preset || null;
      const scores = WolfLogic.scoreGame(g);
      const deltas = {}, finalScores = {};
      g.players.forEach((p) => {
        const s = scores[p.id] || { points: 0 };
        deltas[p.name] = s.points;
        finalScores[p.name] = s.points;
      });
      const rounds = [{
        mode: room.wolf.preset || 'wolfrole',
        score_deltas: deltas,
        at: new Date().toISOString(),
        detail: summary
      }];
      db.prepare(
        'INSERT INTO matches (user_id, player_names, rounds, final_scores, ended_at) ' +
        "VALUES (?, ?, ?, ?, datetime('now'))"
      ).run(
        room.ownerUserId,
        JSON.stringify(g.players.map((p) => p.name)),
        JSON.stringify(rounds),
        JSON.stringify(finalScores)
      );
    } catch (e) {
      // 記録に失敗しても、遊んでいる人の進行は止めない
      console.warn('[realtime] 対戦履歴の保存に失敗しました:', e.message);
    }
  }


  /**
   * ホストが居なくなった／切断されたときに、別の接続中メンバーへ即座に移す。
   * 切断は明確なsignalなので、タイムアウトを待たない。
   * @returns {boolean} ホストが変わったか
   */
  function ensureHost(room, reason) {
    const cur = room.hostMemberId ? room.members.get(room.hostMemberId) : null;
    if (cur && cur.connected) return false;
    const next = pickNextHost(room, cur ? cur.id : null);
    if (next === room.hostMemberId) return false;
    room.hostMemberId = next;
    if (next) {
      io.to('room:' + room.code).emit('room:hostChanged', {
        hostMemberId: next,
        reason: reason || 'auto',
        previousHostMemberId: cur ? cur.id : null
      });
    }
    return true;
  }

  function markDisconnected(member, room) {
    if (!member.connected) return;
    member.connected = false;
    member.socketId = null;
    const changed = ensureHost(room, 'disconnect');
    if (!connectedMembers(room).length) room.emptySince = Date.now();
    broadcast(room);
    return changed;
  }

  // ---- ハートビート ----
  // socket.io 自身の ping/pong とは別に、アプリ側でも疎通を確認する。
  // 「接続は張られているが応答が返らない」端末を切断扱いにするため。
  const timers = [];
  timers.push(setInterval(() => {
    const now = Date.now();
    for (const room of store.rooms.values()) {
      for (const m of room.members.values()) {
        if (!m.connected) continue;
        const s = socketOf(m.id, room);
        if (s) s.emit('hb:ping', { at: now });
      }
    }
  }, HEARTBEAT_INTERVAL_MS));

  timers.push(setInterval(() => {
    const now = Date.now();
    for (const [code, room] of store.rooms) {
      for (const m of room.members.values()) {
        if (!m.connected) continue;
        if (now - m.lastSeen > HEARTBEAT_TIMEOUT_MS) markDisconnected(m, room);
      }
      // 誰も繋がっていない状態が続いた部屋は片付ける（メモリを永久に食わないように）。
      // サーバーはpushするまで動き続けるので、ここが無いと遊び終わった部屋が溜まり続ける。
      // 保険として、emptySince の付け忘れがあってもここで拾い直す。
      if (!connectedMembers(room).length && !room.emptySince) room.emptySince = now;
      if (room.emptySince && now - room.emptySince > emptyRoomTtlMs) store.delete(code);
    }
  }, sweepIntervalMs));

  // 第21弾-7：夜の制限時間で締める。全員そろわなくても夜が明けるようにする
  timers.push(setInterval(() => {
    const now = Date.now();
    for (const room of store.rooms.values()) {
      const w = room.wolf;
      if (!w || !w.deadline || now < w.deadline) continue;
      WolfRoom.advance(room);
      pushWolfState(room);
    }
  }, 500));

  timers.forEach((t) => { if (t.unref) t.unref(); });

  io.on('connection', (socket) => {
    // このsocketがどの部屋の誰なのか。join/create が成功した時に埋まる
    socket.data.roomCode = null;
    socket.data.memberId = null;

    function currentRoom() {
      return socket.data.roomCode ? store.get(socket.data.roomCode) : null;
    }
    function currentMember() {
      const room = currentRoom();
      return room && socket.data.memberId ? room.members.get(socket.data.memberId) : null;
    }
    function fail(cb, code, message) {
      if (typeof cb === 'function') cb({ ok: false, error: code, message });
    }

    function attachMember(room, member) {
      socket.data.roomCode = room.code;
      socket.data.memberId = member.id;
      member.socketId = socket.id;
      member.connected = true;
      member.lastSeen = Date.now();
      room.emptySince = null;
      socket.join('room:' + room.code);
    }

    // ---- 第2部-1：部屋を作る（ログイン済みのアカウントだけ） ----
    socket.on('room:create', (payload, cb) => {
      const sess = sessionOf(socket);
      if (!sess.userId) return fail(cb, 'auth_required', '部屋を作るにはログインが必要です');
      const name = String((payload && payload.name) || '').trim();
      if (!name) return fail(cb, 'name_required', '名前を入力してください');

      const room = store.create({ ownerUserId: sess.userId, ownerUsername: payload && payload.username });
      const member = {
        id: newId('m'),
        name,
        role: normalizeRole(payload && payload.role),
        socketId: null,
        connected: false,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        userId: sess.userId  // 作った本人だけはアカウントが紐づく
      };
      room.members.set(member.id, member);
      attachMember(room, member);
      room.hostMemberId = member.id; // 作った端末が最初のホスト（オーナーとは別概念）

      if (typeof cb === 'function') {
        cb({ ok: true, code: room.code, memberId: member.id, room: publicSnapshot(room) });
      }
      broadcast(room);
    });

    // ---- 第2部-2：部屋に入る（ログイン不要。コード＋名前だけ） ----
    socket.on('room:join', (payload, cb) => {
      const room = store.get(payload && payload.code);
      if (!room) return fail(cb, 'room_not_found', 'その部屋コードは見つかりません');
      const name = String((payload && payload.name) || '').trim();
      if (!name) return fail(cb, 'name_required', '名前を入力してください');

      // 同じ端末が入り直した時は、前のメンバーとして復帰する（再接続で別人が増えないように）
      const rejoinId = payload && payload.memberId;
      let member = rejoinId ? room.members.get(rejoinId) : null;
      if (member) {
        member.name = name;
        if (payload && payload.role) member.role = normalizeRole(payload.role);
      } else {
        member = {
          id: newId('m'),
          name,
          role: normalizeRole(payload && payload.role),
          socketId: null,
          connected: false,
          joinedAt: Date.now(),
          lastSeen: Date.now(),
          userId: sessionOf(socket).userId || null
        };
        room.members.set(member.id, member);
      }
      attachMember(room, member);
      ensureHost(room, 'join'); // ホスト不在の部屋に入ったら、その人がホストになる

      if (typeof cb === 'function') {
        cb({ ok: true, code: room.code, memberId: member.id, room: publicSnapshot(room) });
      }
      broadcast(room);
    });

    // ---- 第2部-3：役割の変更（自動判定はあくまで初期値。最後は本人が選ぶ） ----
    socket.on('room:setRole', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      me.role = normalizeRole(payload && payload.role);
      if (typeof cb === 'function') cb({ ok: true, role: me.role, room: publicSnapshot(room) });
      broadcast(room);
    });

    // ---- 第3部-1：ホストを手で譲る ----
    socket.on('room:transferHost', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', 'ホストだけが譲れます');
      const targetId = payload && payload.memberId;
      const target = targetId ? room.members.get(targetId) : null;
      if (!target) return fail(cb, 'member_not_found', 'その人は部屋にいません');
      if (!target.connected) return fail(cb, 'member_offline', 'その人はいま接続していません');

      const prev = room.hostMemberId;
      room.hostMemberId = target.id;
      io.to('room:' + room.code).emit('room:hostChanged', {
        hostMemberId: target.id, reason: 'manual', previousHostMemberId: prev
      });
      if (typeof cb === 'function') cb({ ok: true, room: publicSnapshot(room) });
      broadcast(room);
    });

    // ---- 第3部-3：ハートビートの応答 ----
    socket.on('hb:pong', () => {
      const me = currentMember();
      if (me) me.lastSeen = Date.now();
    });

    // ---- 第4部：汎用の状態更新（ゲーム固有の中身はここに載せる） ----
    socket.on('room:setState', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', 'ホストだけが操作できます');
      const p = payload || {};
      if (typeof p.phase === 'string') room.state.phase = p.phase;
      if (p.game !== undefined) room.state.game = p.game;
      if (p.data && typeof p.data === 'object') {
        room.state.data = Object.assign({}, room.state.data, p.data);
      }
      if (typeof cb === 'function') cb({ ok: true, room: publicSnapshot(room) });
      broadcast(room);
    });

    // ---- 第21弾 第7部：1人1台の人狼 ----
    // 進行・役職判定・勝敗判定はすべてサーバー（wolf-room.js → wolf-logic.js）。
    // 端末は「自分の情報を受け取って表示し、操作を送る」だけ。
    socket.on('wolf:start', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', 'ホストだけが始められます');
      if (room.wolf) return fail(cb, 'already_started', 'もう始まっています');

      const res = WolfRoom.startGame(room, payload || {});
      if (!res.ok) return fail(cb, res.error, res.message);
      if (typeof cb === 'function') cb({ ok: true, room: publicSnapshot(room) });
      pushWolfState(room);
    });

    // 夜の行動・役職確認。targetId が無ければ「確認しただけ」。
    // 行動が無い人も必ずここを通るので、外からは誰が行動持ちか分からない。
    socket.on('wolf:act', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me || !room.wolf) return fail(cb, 'not_in_room', '部屋に入っていません');
      const res = WolfRoom.submitAction(room, me.id, (payload && payload.targetId) || null);
      if (!res.ok) return fail(cb, res.error, '今はその操作ができません');
      if (typeof cb === 'function') cb({ ok: true });
      if (res.allDone) WolfRoom.advance(room);
      pushWolfState(room);
    });

    socket.on('wolf:vote', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me || !room.wolf) return fail(cb, 'not_in_room', '部屋に入っていません');
      const res = WolfRoom.submitVote(room, me.id, (payload && payload.targetId) || null);
      if (!res.ok) return fail(cb, res.error, '今は投票できません');
      if (typeof cb === 'function') cb({ ok: true });
      if (res.allDone) WolfRoom.advance(room);
      pushWolfState(room);
    });

    // 朝の話し合いを終える・ターンの結果を見終わる、はホストが進める
    socket.on('wolf:next', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me || !room.wolf) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', 'ホストだけが進められます');
      WolfRoom.advance(room);
      if (typeof cb === 'function') cb({ ok: true });
      pushWolfState(room);
    });

    socket.on('room:leave', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (room && me) {
        room.members.delete(me.id);
        socket.leave('room:' + room.code);
        ensureHost(room, 'leave');
        if (!connectedMembers(room).length) room.emptySince = Date.now();
        broadcast(room);
      }
      socket.data.roomCode = null;
      socket.data.memberId = null;
      if (typeof cb === 'function') cb({ ok: true });
    });

    // ---- 第3部-2：切断されたら即座に別の端末へ引き継ぐ ----
    socket.on('disconnect', () => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return;
      // 同じメンバーが別のsocketで入り直している場合は、古い切断で状態を壊さない
      if (me.socketId && me.socketId !== socket.id) return;
      markDisconnected(me, room);
    });
  });

  io.stopTimers = () => timers.forEach((t) => clearInterval(t));
  io.store = store;
  return io;
}

module.exports = {
  attachRealtime,
  RoomStore,
  publicSnapshot,
  playerMembers,
  pickNextHost,
  randomCode,
  CODE_ALPHABET,
  CODE_LENGTH,
  ROLE_PLAYER,
  ROLE_BIGSCREEN,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS
};
