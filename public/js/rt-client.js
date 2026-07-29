// rt-client.js — 1人1台モードの通信まわり（第21弾）
//
// ここには画面の話を書かない。socket.io とのやり取りだけを引き受け、
// 「いまの部屋の状態」と「自分だけに届いた秘密」を持っておく。
// 画面側（index.html）は on() で変化を受け取って描くだけにする。
//
// 手渡し方式はこのファイルを一切使わない。読み込みに失敗しても、
// 手渡し方式が壊れないように window.io が無い場合は available:false を返す。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RTClient = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  function create(opts) {
    opts = opts || {};
    var io = opts.io || (typeof window !== 'undefined' ? window.io : null);

    var state = {
      connected: false,
      code: null,        // 部屋コード
      memberId: null,    // 自分のメンバーID
      name: null,        // 入り直す時に使う
      role: 'player',
      room: null,        // 公開スナップショット（全員に配られるもの）
      secret: null,      // 自分だけに届いた情報（役職など）
      rejoining: false,
      error: null
    };
    var socket = null;
    var listeners = {};

    function emitLocal(name, payload) {
      (listeners[name] || []).forEach(function (fn) {
        try { fn(payload); } catch (e) { /* 画面側の失敗で通信を止めない */ }
      });
    }
    function on(name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return function off() {
        listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; });
      };
    }

    // socket.io が読み込めていない環境（テストのjsdomなど）では何もしない。
    // 手渡し方式に影響を出さないため、ここで例外を投げない。
    function available() { return !!io; }

    function connect() {
      if (!available()) { state.error = 'socket.io が読み込めていません'; return false; }
      if (socket) return true;
      socket = io({ withCredentials: true });

      socket.on('connect', function () {
        state.connected = true;
        emitLocal('status', state);
        // スマホの画面を消すと、しばらくして接続が切れる（JSが止まって
        // ハートビートに応えられなくなるため）。socket.io は自動でつなぎ直すが、
        // それだけではサーバーから見て「切断したまま」なので、
        // 前と同じメンバーとして入り直す。新しい参加者として増えないよう
        // memberId を必ず添える。
        if (state.code && state.memberId && !state.rejoining) {
          state.rejoining = true;
          call('room:join', {
            code: state.code, name: state.name, role: state.role, memberId: state.memberId
          }).then(function (res) {
            state.rejoining = false;
            if (res && res.ok) {
              state.room = res.room;
              emitLocal('rejoined', state);
            }
            emitLocal('status', state);
          });
        }
      });
      socket.on('disconnect', function () {
        state.connected = false;
        emitLocal('status', state);
      });
      // 部屋の公開情報。誰が見てもよいものだけが入っている
      socket.on('room:update', function (room) {
        state.room = room;
        emitLocal('room', room);
      });
      socket.on('room:hostChanged', function (p) { emitLocal('hostChanged', p); });
      // 自分だけに届く情報（役職・占い結果など）
      socket.on('wolf:you', function (p) {
        state.secret = p;
        emitLocal('you', p);
      });
      socket.on('wolf:ended', function (p) { emitLocal('ended', p); });
      // 第24弾-3-5：ホストがゲームを終了すると、部屋ごと畳まれる。
      // 全員がここで抜ける（ホストだけ終わって他が置き去りにならないように）
      socket.on('room:closed', function (p) {
        state.code = null; state.memberId = null; state.room = null; state.secret = null;
        emitLocal('closed', p || {});
        emitLocal('status', state);
      });
      // サーバーからの死活確認。返さないと切断扱いになる
      socket.on('hb:ping', function () { socket.emit('hb:pong'); });
      return true;
    }

    function call(event, payload) {
      return new Promise(function (resolve) {
        if (!socket) { resolve({ ok: false, error: 'not_connected' }); return; }
        var done = false;
        var t = setTimeout(function () {
          if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); }
        }, 8000);
        socket.emit(event, payload || {}, function (res) {
          if (done) return;
          done = true; clearTimeout(t);
          resolve(res || { ok: false, error: 'no_response' });
        });
      });
    }

    async function createRoom(name, role) {
      connect();
      var res = await call('room:create', { name: name, role: role });
      if (res.ok) {
        state.code = res.code; state.memberId = res.memberId; state.room = res.room;
        state.name = name; state.role = role || 'player';
      } else state.error = res.message || res.error;
      emitLocal('status', state);
      return res;
    }
    async function joinRoom(code, name, role) {
      connect();
      var res = await call('room:join', { code: code, name: name, role: role, memberId: state.memberId });
      if (res.ok) {
        state.code = res.code; state.memberId = res.memberId; state.room = res.room;
        state.name = name; state.role = role || 'player';
      } else state.error = res.message || res.error;
      emitLocal('status', state);
      return res;
    }
    function setRole(role) {
      state.role = role; // 入り直す時にも同じ役割で戻れるように覚えておく
      return call('room:setRole', { role: role });
    }
    function transferHost(memberId) { return call('room:transferHost', { memberId: memberId }); }
    function leave() {
      // 自分から出た時は、つなぎ直しで戻らないように印も消す
      state.code = null; state.memberId = null; state.room = null; state.secret = null;
      return call('room:leave', {});
    }
    // 第24弾-3-5：ホストだけが呼べる。部屋にいる全員を終わらせる
    function closeRoom() { return call('room:close', {}); }

    // ---- 人狼（1人1台） ----
    function startWolf(config) { return call('wolf:start', config || {}); }
    function act(targetId) { return call('wolf:act', { targetId: targetId }); }
    function vote(targetId) { return call('wolf:vote', { targetId: targetId }); }
    function nextPhase() { return call('wolf:next', {}); }

    // 自分がホスト（進行を担当している端末）か
    function isHost() {
      return !!(state.room && state.memberId && state.room.hostMemberId === state.memberId);
    }
    function me() {
      if (!state.room || !state.memberId) return null;
      return (state.room.members || []).find(function (m) { return m.id === state.memberId; }) || null;
    }

    return {
      state: state, on: on, available: available, connect: connect,
      createRoom: createRoom, joinRoom: joinRoom, setRole: setRole,
      transferHost: transferHost, leave: leave, closeRoom: closeRoom,
      startWolf: startWolf, act: act, vote: vote, nextPhase: nextPhase,
      isHost: isHost, me: me,
      // テストから中身を差し替えられるように（socket.io本体は持たせない）
      _call: call
    };
  }

  return { create: create };
}));
