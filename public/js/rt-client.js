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
              // 第35弾A：入り直しの往復中に、本人が「部屋を出る」を押していた場合。
              // ここで room を書き戻すと「画面は棚なのに部屋に居る」ゾンビ状態になる。
              // サーバー側に入り直してしまった自分の枠を、あらためて出しておく
              if (!state.code) {
                call('room:leave', { code: res.code, memberId: res.memberId });
                return;
              }
              state.room = res.room;
              emitLocal('rejoined', state);
            } else if (res && res.error === 'room_not_found') {
              // 第27弾-1：入り直そうとしたら、その部屋がもう無かった。
              // サーバーが再起動した（メモリ上の部屋は消える仕様）か、
              // 誰も繋がっていない時間が続いて片付けられたか、のどちらか。
              //
              // ここで黙っていたのが、実機で起きた「全員が固まって、
              // ブラウザを立ち上げ直すまで直らない」の正体。
              // 画面は前のままなのに、押しても何も起きない状態になっていた。
              // 部屋の印を落として、画面側に知らせる。
              state.code = null; state.memberId = null;
              state.room = null; state.secret = null;
              emitLocal('lost', { reason: 'room_not_found', message: res.message || '' });
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
        // 第32弾-E 第3部：進行役が待機画面から自分の表示モードを切り替えることがある。
        // 覚えている役割が古いまま入り直すと、切り替えが巻き戻ってしまうので、
        // 部屋の公開情報にある「いまの自分」に必ず合わせておく
        var mine = ((room && room.members) || []).find(function (m) { return m.id === state.memberId; });
        if (mine && mine.role) state.role = mine.role;
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
      // 第32弾-B-1：部屋から出された。理由を伝えて、画面が固まらないようにする
      socket.on('room:kicked', function (p) {
        state.code = null; state.memberId = null; state.room = null; state.secret = null;
        emitLocal('kicked', p || {});
        emitLocal('status', state);
      });
      socket.on('room:closed', function (p) {
        state.code = null; state.memberId = null; state.room = null; state.secret = null;
        emitLocal('closed', p || {});
        emitLocal('status', state);
      });
      // 第32弾-E：リアクション・感謝・アルバム。どれも進行そのものには関係しない
      socket.on('room:reacted', function (p) { emitLocal('reacted', p || {}); });
      socket.on('room:thanked', function (p) { emitLocal('thanked', p || {}); });
      socket.on('album:update', function (p) { emitLocal('albumUpdate', p || {}); });
      // 第34弾 2-1：ゲームが始まる前の、みんなで見る3-2-1
      socket.on('room:countdown', function (p) { emitLocal('countdown', p || {}); });
      // 第35弾B：誰かが名簿から消えた（自分で退室 or 出された）。理由つきで届く
      socket.on('room:memberGone', function (p) { emitLocal('memberGone', p || {}); });
      // サーバーからの死活確認。返さないと切断扱いになる
      socket.on('hb:ping', function () { socket.emit('hb:pong'); });
      return true;
    }

    function call(event, payload, timeoutMs) {
      return new Promise(function (resolve) {
        if (!socket) { resolve({ ok: false, error: 'not_connected' }); return; }
        var done = false;
        var t = setTimeout(function () {
          if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); }
        }, timeoutMs || 8000);
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
    // 第32弾-A-3-2：入る前に、その部屋を軽く覗く。
    // 返ってくるのは「あるかどうか・何のゲームか・何人いるか」だけ（名簿は来ない）。
    // 第35弾A：memberId を添えると「自分がまだ名簿にいるか（you）」も返る。
    // 「部屋」ボタンの在室判定はこれで行う（端末の記憶ではなくサーバーが権威）
    function peekRoom(code, memberId) {
      return call('room:peek', { code: code, memberId: memberId || undefined });
    }
    // 第35弾A：部屋の印を端末から落とす（サーバーに「もう無い」と言われた時用）。
    // lost と違って画面側が自分の文脈で使うので、ここでは何も報せない
    function dropRoom() {
      state.code = null; state.memberId = null; state.room = null; state.secret = null;
      emitLocal('status', state);
    }
    function setRole(role, memberId) {
      // 第32弾-E 第3部：進行役は memberId を付けて、他の人の表示モードも切り替えられる
      if (!memberId || memberId === state.memberId) {
        state.role = role; // 入り直す時にも同じ役割で戻れるように覚えておく
      }
      return call('room:setRole', { role: role, memberId: memberId || undefined });
    }
    function transferHost(memberId) { return call('room:transferHost', { memberId: memberId }); }
    // 第32弾-B-1：進行役が、その人を部屋から出す
    function kick(memberId) { return call('room:kick', { memberId: memberId }); }
    function leave() {
      // 自分から出た時は、つなぎ直しで戻らないように印も消す。
      // 第35弾A：code+memberId を添えて頼む。つなぎ直した直後は
      // サーバー側の socket が部屋の印を失っていて、空の頼みだと無視されるため
      var code = state.code, memberId = state.memberId;
      state.code = null; state.memberId = null; state.room = null; state.secret = null;
      return call('room:leave', { code: code, memberId: memberId });
    }
    // 第24弾-3-5：ホストだけが呼べる。部屋にいる全員を終わらせる
    function closeRoom() { return call('room:close', {}); }
    // 第26弾-3：部屋は残したまま、これから遊ぶゲームを選び直す。
    // ゲームが変わった時と reset を付けた時は、サーバー側で前の進行が捨てられる
    function pickGame(gameId, opts) {
      return call('room:setState', Object.assign({ phase: 'lobby', game: gameId || null }, opts || {}));
    }
    // 第37弾：ルールを読んだうえでの「準備OK」。取り消しは ready:false。
    // いまのゲームidを添えるのは、部屋の知らせと自分の操作がすれ違った時に
    // 「1つ前のゲームのつもりで押した」を、サーバー側で弾いてもらうため（落とし穴18の型）
    function setReady(on) {
      var room = state.room;
      var game = room && room.state && room.state.game;
      return call('room:ready', { ready: on !== false, game: game || null });
    }

    // ---- 1人1台の進行（人狼・ワードウルフ・爆弾解除で共通） ----
    // イベント名は wolf: のままだが、届く先は「その部屋でいま遊んでいるゲーム」。
    // サーバー側の約束（startGame / submitAction / submitVote / advance）が
    // 揃っているので、ゲームが増えてもここに関数は増えない。
    //   act  … 選ぶ・確認する（爆弾解除では「このコードを開ける」／null で閉じる）
    //   vote … 決める（爆弾解除では「3択の答え」）
    // 第27弾-3：extra を付けると、targetId だけでは足りない中身も一緒に送れる
    //   act('defuser', { caps })            … 役割と、その端末で読めるセンサー
    //   vote(null, { action:{type:'tilt'} }) … 傾き・振り・入力などの操作
    function startWolf(config) { return call('wolf:start', config || {}); }
    // 第32弾-E：リアクション・感謝・アルバム
    function react(emoji) { return call('room:react', { emoji: emoji }); }
    function thanks(memberId, kind) { return call('room:thanks', { memberId: memberId, kind: kind }); }
    function albumAdd(photo) { return call('album:add', { photo: photo }, 30000); }
    function albumRemove() { return call('album:remove', {}); }
    // アルバム本体は写真が全部入った大きな1枚なので、待ち時間を長めに取る
    function albumGet() { return call('album:get', {}, 60000); }
    function albumDone() { return call('album:done', {}); }
    function act(targetId, extra) {
      return call('wolf:act', Object.assign({ targetId: targetId }, extra || {}));
    }
    function vote(targetId, extra) {
      return call('wolf:vote', Object.assign({ targetId: targetId }, extra || {}));
    }
    function nextPhase() { return call('wolf:next', {}); }

    // 自分がホスト（進行を担当している端末）か
    function isHost() {
      return !!(state.room && state.memberId && state.room.hostMemberId === state.memberId);
    }
    function me() {
      if (!state.room || !state.memberId) return null;
      return (state.room.members || []).find(function (m) { return m.id === state.memberId; }) || null;
    }

    /**
     * つなぎ直す（第32弾-C：実機の不具合）。
     *
     * サーバーは socket.request.session を見る。これは「つないだ時」の
     * セッションで固定される。ログイン前につないだソケットは、あとで
     * ログインしても、サーバーからはずっと未ログインに見えたままだった。
     * そのせいで「画面はログイン済みなのに、部屋を立てると弾かれる」が起きていた。
     *
     * ログインした時・ログアウトした時に呼ぶ。
     * 部屋に入っている最中は、つなぎ直すと入り直しが走るので触らない。
     */
    function reconnect() {
      if (!available()) return false;
      if (state.code) return false;   // 部屋にいる時は触らない
      if (socket) {
        try { socket.close(); } catch (e) {}
        socket = null;
      }
      state.connected = false;
      return connect();
    }

    return {
      state: state, on: on, available: available, connect: connect, reconnect: reconnect,
      createRoom: createRoom, joinRoom: joinRoom, setRole: setRole, peekRoom: peekRoom, dropRoom: dropRoom,
      transferHost: transferHost, kick: kick, leave: leave, closeRoom: closeRoom, pickGame: pickGame,
      setReady: setReady,
      startWolf: startWolf, act: act, vote: vote, nextPhase: nextPhase,
      react: react, thanks: thanks,
      albumAdd: albumAdd, albumRemove: albumRemove, albumGet: albumGet, albumDone: albumDone,
      isHost: isHost, me: me,
      // テストから中身を差し替えられるように（socket.io本体は持たせない）
      _call: call
    };
  }

  return { create: create };
}));
