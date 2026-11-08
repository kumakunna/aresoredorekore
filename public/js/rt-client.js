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
      // 第42弾 門E6：名簿に出す自分の姿（アイコン・二つ名）。
      // **持ち物や達成数は入れない**——ここに入れた日から、全員の名簿に序列が出る
      look: null,
      room: null,        // 公開スナップショット（全員に配られるもの）
      secret: null,      // 自分だけに届いた情報（役職など）
      rejoining: false,
      error: null
    };
    var socket = null;
    var listeners = {};
    var lagPending = {};   // 11/7 の検査の準備 6：知らせの名前 → サーバーが出した時刻（lag:t）

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

    /**
     * 指示75 1-2（A03・A07・A09）：**いまの画面が古いかもしれない間**（stale）。画面はこの間、押せなくして「つなぎ直しています」を出す（index.html）。
     * 11/7、Android を40秒裏に回して戻すと、古い画面（0秒の問題など）が押せそうな見た目のまま 1.3〜5.5秒。機内モードでも数字が動き続けた。
     * 古いかもしれないのは：通信が切れた／裏から戻って、いまの全部を受け取る前／オフライン／サーバーの「いるよ」（hb:ping・10秒ごと）が来ない。
     * 消えるのは：いまの全部が届いた時（入り直し・room:here の答え）。部屋にいない時は出さない
     */
    var STALE_HB_MS = 22000;   // hb:ping は10秒ごと。2回つづけて来なければ、通信が死んでいる（socket.io が気づくのは約35秒）
    var lastHb = 0, hiddenAt = 0;
    function setStale(on, why) {
      on = !!on && !!state.code;
      // 古いまま理由だけ変わった（切れた → オフラインと分かった）時も知らせる（画面の字を変える）。オフラインの字は、もどるまで残す
      if (!!state.stale === on && (!on || state.staleWhy === (why || '') || state.staleWhy === 'offline')) return;
      state.stale = on; state.staleWhy = on ? (why || '') : '';
      emitLocal('stale', { on: on, why: state.staleWhy });
    }
    function freshNow() { lastHb = Date.now(); setStale(false); }

    // socket.io が読み込めていない環境（テストのjsdomなど）では何もしない。
    // 手渡し方式に影響を出さないため、ここで例外を投げない。
    function available() { return !!io; }

    function connect() {
      if (!available()) { state.error = 'socket.io が読み込めていません'; return false; }
      if (socket) return true;
      socket = io({ withCredentials: true });

      socket.on('connect', function () {
        state.connected = true;
        // 10/31：つながった回数（2回目からが「つなぎ直し」）。TV が着かない時の手がかりに送る（index.html fesTvWatch）
        state.connects = (state.connects || 0) + 1;
        emitLocal('status', state);
        // スマホの画面を消すと、しばらくして接続が切れる（JSが止まって
        // ハートビートに応えられなくなるため）。socket.io は自動でつなぎ直すが、
        // それだけではサーバーから見て「切断したまま」なので、
        // 前と同じメンバーとして入り直す。新しい参加者として増えないよう
        // memberId を必ず添える。
        rejoin();
      });
      socket.on('disconnect', function () {
        state.connected = false;
        setStale(true, 'disconnect');   // 指示75 1-2
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
      // 指示66-2：文化祭の部屋の、本人だけのもの（自分の投票・むずかしさ・押し忘れの数）と、係の画面の名簿
      socket.on('fes:you', function (p) { state.fes = p || null; emitLocal('fes', p || null); });
      socket.on('fes:staff', function (p) { emitLocal('fesStaff', p || null); });
      // 指示66-3：満員の時の予約。何番目か（fes:queue）と、席が空いた「どうぞ」（fes:turn）
      socket.on('fes:queue', function (p) { emitLocal('fesQueue', p || null); });
      socket.on('fes:turn', function (p) { emitLocal('fesTurn', p || null); });
      // 指示68-1：サーバーの版（つながるたびに届く）。画面の版と違えば、待合にいる時だけ読み込み直す（index.html）
      socket.on('app:version', function (p) { emitLocal('version', p || null); });
      // 第24弾-3-5：ホストがゲームを終了すると、部屋ごと畳まれる。
      // 全員がここで抜ける（ホストだけ終わって他が置き去りにならないように）
      // 第32弾-B-1：部屋から出された。理由を伝えて、画面が固まらないようにする
      socket.on('room:kicked', function (p) { 出された(p); });
      socket.on('room:closed', function (p) {
        // 2026-11-01：記憶を消すと自分の役も分からなくなる。TV だったかを先に読んで知らせに添える
        //（文化祭の作り直しで、TV がスマホの入口へ飛んでいた・tools/fes-soak.js で見つけた）
        var mine = me();
        var wasBig = !!(mine && mine.role === 'bigscreen');
        forgetLastRoom();
        state.code = null; state.memberId = null; state.room = null; state.secret = null;
        部屋を覚える();   // 閉じられたら忘れる
        emitLocal('closed', Object.assign({}, p || {}, { wasBigScreen: wasBig }));
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
      socket.on('hb:ping', function () { lastHb = Date.now(); socket.emit('hb:pong'); });
      // 11/7 の検査の準備 6：遅れの印（サーバーが PROBE=lag の時だけ届く）。lag:t のあとに来た同じ名前の知らせと組にして、
      // 受け取った時刻（ふだんの受け口より前＝onAny）と、受け口が全部終わった時刻（そのあとのマイクロタスク）を画面側（public/js/probe.js）へ渡す
      if (socket.onAny) socket.onAny(function (ev, p) {
        if (ev === 'lag:t') { if (p && p.e) lagPending[p.e] = p.t; return; }
        var t = lagPending[ev];
        if (t == null) return;
        delete lagPending[ev];
        var recv = Date.now();
        Promise.resolve().then(function () { emitLocal('lag', { e: ev, t: t, recv: recv, done: Date.now() }); });
      });
      return true;
    }

    /**
     * 部屋から出された（進行役の kick・文化祭の「席を空ける」「外す」・2分たって外された）。
     * サーバーからの room:kicked と、もどった時の答え（fes_gone）の両方がここを通る（指示74）。
     * 2回届いても、知らせるのは1回（部屋の印が残っている時だけ）
     */
    function 出された(p) {
      if (!state.code && !state.memberId) return;
      forgetLastRoom();
      state.code = null; state.memberId = null; state.room = null; state.secret = null; state.fes = null;
      部屋を覚える();   // 出されたら忘れる
      emitLocal('kicked', p || {});
      emitLocal('status', state);
    }

    /**
     * つなぎ直した時の入り直し（socket.io が通信をつなぎ直した＝45秒より長く離れていた時など）。
     *
     * スマホの画面を消すと、しばらくして接続が切れる（JSが止まって
     * ハートビートに応えられなくなるため）。socket.io は自動でつなぎ直すが、
     * それだけではサーバーから見て「切断したまま」なので、
     * 前と同じメンバーとして入り直す。新しい参加者として増えないよう
     * memberId を必ず添える。
     */
    function rejoin() {
      if (!state.code || !state.memberId || state.rejoining) return;
      state.rejoining = true;
      call('room:join', {
        code: state.code, name: state.name, role: state.role, memberId: state.memberId,
        // 第42弾 門E6：つなぎ直しでも姿を添える。
        // ここを忘れると、画面を消して戻った人だけ名簿から顔が消える（落とし穴1）
        look: state.look || null,
        dev: devId(),   // 指示75 1-4・1-6：端末の札
        // 指示74：自動の入り直しの印。文化祭で2分たって外されていたら、新しい人として黙って入らず fes_gone が返る
        auto: true
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
          freshNow();   // 指示75 1-2：いまの全部が届いた
          emitLocal('rejoined', state);
        } else if (res && res.error === 'room_not_found') {
          部屋が無い(res);
        } else if (res && res.error === 'fes_gone') {
          // 指示74（案A）：2分より長く離れて、名簿から外されていた。入る画面へ（名前とむずかしさは入ったまま）
          出された({ by: null, reason: 'fes_gone' });
        }
        emitLocal('status', state);
      });
    }
    // 第27弾-1：入り直そうとしたら、その部屋がもう無かった。
    // サーバーが再起動した（メモリ上の部屋は消える仕様）か、
    // 誰も繋がっていない時間が続いて片付けられたか、のどちらか。
    //
    // ここで黙っていたのが、実機で起きた「全員が固まって、
    // ブラウザを立ち上げ直すまで直らない」の正体。
    // 画面は前のままなのに、押しても何も起きない状態になっていた。
    // 部屋の印を落として、画面側に知らせる。
    function 部屋が無い(res) {
      if (!state.code) return;
      state.code = null; state.memberId = null;
      state.room = null; state.secret = null;
      setStale(false);   // 指示75 1-2
      emitLocal('lost', { reason: 'room_not_found', message: (res && res.message) || '' });
      emitLocal('status', state);
    }

    /**
     * 指示74：「いるよ」をすぐ知らせる（画面がまた見えた時・押して失敗した時）。10秒の hb:ping を待たない。
     *
     * 別のアプリに切りかえて25秒〜45秒でもどると、通信は生きたまま、サーバーからは「つながっていない」に
     * なっている。答え（room:here）が来れば、サーバーがいまの全部を送り直す。
     * 名簿から外されていたら（2分）、文化祭は入る画面へ（fes_gone）・ふつうの部屋はつなぎ直しと同じ入り直し。
     * 通信が切れていたら、つなぎ直しを急がせる（つながったら rejoin が走る）
     */
    var hereBusy = false;
    function here() {
      if (!socket || !state.code || !state.memberId || hereBusy) return Promise.resolve({ ok: false, error: 'skip' });
      if (!socket.connected) {
        try { socket.connect(); } catch (e) { /* つなぎ直しは socket.io にまかせる */ }
        return Promise.resolve({ ok: false, error: 'not_connected' });
      }
      hereBusy = true;
      var code = state.code, memberId = state.memberId;
      // 送った時の通信。答えを待つ間に socket.io が自分でつなぎ直していたら、新しい通信は切らない（レビューで見つけた）
      var engine = socket.io && socket.io.engine;
      return call('room:here', { code: code, memberId: memberId }, 5000).then(function (res) {
        hereBusy = false;
        // 往復の間に、本人が出た・別の部屋に入った時は何もしない
        if (state.code !== code || state.memberId !== memberId) return res;
        if (res && res.ok) freshNow();   // 指示75 1-2：サーバーが いまの全部を送り直した（答えより先に届いている）
        if (res && res.error === 'fes_gone') 出された({ by: null, reason: 'fes_gone' });
        else if (res && res.error === 'room_not_found') 部屋が無い(res);
        else if (res && res.error === 'not_in_room') rejoin();
        // 答えが来ない＝通信が切れているのに、socket.io はまだ気づいていない（iPhone で長く裏にいたあと、よく起きる）。
        // socket.io の見張り（約35秒）を待たずに、いまつなぎ直す（つながったら rejoin が同じ人として入り直す）
        else if (res && res.error === 'timeout' && engine && socket && socket.io && socket.io.engine === engine) {
          try { engine.close(); } catch (e) { /* つなぎ直しは socket.io にまかせる */ }
        }
        return res;
      });
    }
    // 画面がまた見えるようになった時（別のアプリからもどった・戻るボタンでページにもどった）
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
        // 指示75 1-2：1.5秒より長く裏にいたら、いまの全部が届くまで古いかもしれない（押せなくする）
        if (hiddenAt && Date.now() - hiddenAt > 1500) setStale(true, 'back');
        hiddenAt = 0;
        here();
      });
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pageshow', function () { here(); });
      // 指示75 1-2：オフライン（機内モードなど）。もどったら、すぐ「いるよ」
      window.addEventListener('offline', function () { setStale(true, 'offline'); });
      window.addEventListener('online', function () { here(); });
    }
    // 指示75 1-2：hb:ping が来ない（通信は切れているのに、socket.io がまだ気づいていない）。3秒ごとに見る
    // ブラウザの中だけ（Node の検査で require した時は回さない＝プロセスが終われなくなる）
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      var hbWatch = setInterval(function () {
        if (!state.code || !socket || !socket.connected || !lastHb || document.visibilityState === 'hidden') return;
        if (Date.now() - lastHb > STALE_HB_MS) { setStale(true, 'silent'); lastHb = Date.now(); here(); }
      }, 3000);
      if (hbWatch && hbWatch.unref) hbWatch.unref();
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

    /**
   * **どの部屋を持っていたかだけを、端末に覚えておく**（第41弾 2-12）。
   *
   * 2-12 は「部屋を持ったままアプリを閉じて開き直す →「いま開いている部屋」に来る
   *（サーバーが正）」と決めている。**開き直すと state は空になる**ので、
   * 覚えておかないと「どの部屋のことを聞けばいいか」すら分からない。
   *
   * 覚えるのは**部屋コードと memberId だけ**で、部屋があるかどうかは覚えない——
   * 判断はサーバーに聞く（落とし穴14-b：古い記憶のまま消えた部屋へ飛ばさない）。
   * 端末が持つのは「何を聞くか」、答えるのはサーバー、という分け方。
   *
   * どちらも秘密ではない：部屋コードは画面とQRに出ているし、
   * memberId は部屋の全員に配られる部屋内共有ID（第35弾Aで確認した事実）。
   */
    var 記憶の鍵 = 'acac-room';
    function 部屋を覚える() {
      try {
        if (state.code && state.memberId) {
          localStorage.setItem(記憶の鍵, JSON.stringify({
            code: state.code, memberId: state.memberId, name: state.name, role: state.role,
            look: state.look || null
          }));
        } else localStorage.removeItem(記憶の鍵);
      } catch (e) {}
      if (!state.code) setStale(false);   // 指示75 1-2：部屋から出た（出された・とじた・無かった）ら、合図は消す
    }
    function 部屋を思い出す() {
      try {
        var v = JSON.parse(localStorage.getItem(記憶の鍵) || 'null');
        if (v && v.code && v.memberId) {
          state.code = v.code; state.memberId = v.memberId;
          state.name = v.name || null; state.role = v.role || 'player';
          state.look = v.look || null;
        }
      } catch (e) {}
    }
    部屋を思い出す();

    /**
     * 指示63 2-1：**自分から出た部屋を、その日のうちは覚えておく。**
     *
     * 「部屋を出る」は上の記憶（acac-room）を消す——開き直しても勝手に戻らないため。
     * それとは別に、**戻りたくなった時の手がかり**だけをここに残す：
     * 棚の「さっきの部屋にもどる（コード ◯◯）」と、同じQRを読み直した時に、
     * 前と同じ memberId と名前で入る（サーバーが控えから同じ人として戻す）。
     * 戻れるかどうかはサーバーに聞く（peek の canReturn）。端末は「何を聞くか」だけを持つ。
     * 出された（kick）・閉じられた時は残さない。日付が変わったら使わない（日本時間）
     */
    var 出た部屋の鍵 = 'acac-last-room';
    function 今日() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
    function 出た部屋を覚える(code, memberId) {
      try {
        if (code && memberId) {
          localStorage.setItem(出た部屋の鍵, JSON.stringify({
            code: code, memberId: memberId, name: state.name, role: state.role, look: state.look || null, day: 今日()
          }));
        } else localStorage.removeItem(出た部屋の鍵);
      } catch (e) {}
    }
    function lastRoom() {
      try {
        var v = JSON.parse(localStorage.getItem(出た部屋の鍵) || 'null');
        if (v && v.code && v.memberId && v.day === 今日()) return v;
      } catch (e) {}
      return null;
    }
    function forgetLastRoom() { 出た部屋を覚える(null, null); }

    async function createRoom(name, role, look) {
      connect();
      if (look !== undefined) state.look = look || null;
      var res = await call('room:create', { name: name, role: role, look: state.look || null });
      if (res.ok) {
        state.code = res.code; state.memberId = res.memberId; state.room = res.room;
        state.name = name; state.role = role || 'player';
        部屋を覚える();
        freshNow();   // 指示75 1-2
      } else state.error = res.message || res.error;
      emitLocal('status', state);
      return res;
    }
    /**
     * 指示75 1-4・1-6：この端末のブラウザの札（でたらめな字・ブラウザに1つ）。文化祭の部屋に入る時に添える。
     * 「入る」の返事が届く前に読み込み直しても同じ席にもどる（A15）・係がしばらく入れなくした端末を見分ける。
     * 名前でも memberId でもない（部屋の知らせには出ない・サーバーのメモリにだけ）。読めない端末（プライベートなど）は毎回ちがう札
     */
    var 端末の鍵 = 'acac-dev', 端末の札 = null;
    function devId() {
      if (端末の札) return 端末の札;
      try { 端末の札 = localStorage.getItem(端末の鍵); } catch (e) {}
      if (!端末の札) {
        端末の札 = 'd' + Math.floor(Math.random() * 1e12).toString(36) + Date.now().toString(36);
        try { localStorage.setItem(端末の鍵, 端末の札); } catch (e) {}
      }
      return 端末の札;
    }
    async function joinRoom(code, name, role, look, diff, reserve) {
      connect();
      if (look !== undefined) state.look = look || null;
      // 指示63 2-1：いまの記憶が無く、その日に自分から出た部屋に入り直すなら、前の memberId を添える
      var 前 = (!state.memberId && lastRoom()) || null;
      var 添える = state.memberId || ((前 && 前.code === String(code || '').toUpperCase().trim()) ? 前.memberId : null);
      // 指示66-2：文化祭の部屋は、むずかしさ（easy／normal／hard）を添えて入る。ふつうの部屋は送らない
      var res = await call('room:join', { code: code, name: name, role: role, memberId: 添える,
        look: state.look || null, diff: diff || undefined, reserve: reserve || undefined, dev: devId() });
      if (res.ok) {
        state.code = res.code; state.memberId = res.memberId; state.room = res.room;
        state.name = name; state.role = role || 'player';
        部屋を覚える();
        forgetLastRoom();   // 戻れた（または別の部屋に入った）。もう手がかりは要らない
        freshNow();   // 指示75 1-2
      } else state.error = res.message || res.error;
      emitLocal('status', state);
      return res;
    }
    /**
     * 姿を変える（第42弾 門E6）。
     *
     * **部屋の中でも外でも、姿を覚えるのはここ1か所。**
     * 部屋にいなければ state に持っておくだけで、次に入る時にそのまま送られる——
     * 「入る前に変えた人」と「入ってから変えた人」で経路が割れないようにする
     *（落とし穴1：並走する経路の片方だけ直す事故を、経路を1本にして防ぐ）
     */
    function setLook(look) {
      state.look = look || null;
      部屋を覚える();
      if (!state.code || !state.memberId) return Promise.resolve({ ok: true, offline: true });
      return call('room:setLook', { look: state.look });
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
      部屋を覚える();   // サーバーに「もう無い」と言われたら忘れる
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
      出た部屋を覚える(code, memberId);   // 指示63 2-1：戻りたくなった時の手がかりだけ残す
      state.code = null; state.memberId = null; state.room = null; state.secret = null;
      部屋を覚える();   // 自分から出たら忘れる（開き直しても戻らない）
      return call('room:leave', { code: code, memberId: memberId });
    }
    // 第24弾-3-5：ホストだけが呼べる。部屋にいる全員を終わらせる
    function closeRoom() { return call('room:close', {}); }
    // 第26弾-3：部屋は残したまま、これから遊ぶゲームを選び直す。
    // ゲームが変わった時と reset を付けた時は、サーバー側で前の進行が捨てられる
    /**
     * ゲームを決め直す（`reset:true` で前の進行を捨てる）。
     *
     * 第45弾 45-3：**同じゲームのまま作り直す時は、モードを引き継ぐ。**
     * サーバーの `clearGameState` は `state.data` を空にするので、
     * 「もう一度」で作り直すと `modeId` が落ちていた。
     * その結果、再戦のルール画面が**モードではなくゲーム**を出し、
     * 「クイズ解除（協力版）」の6行が「このゲームの説明は、まだ用意できていません」
     * に化けていた（実サーバーで再現）。
     *
     * 引き継ぎは**呼ぶ側ではなくここに置く**。呼ぶ側に書くと、
     * 経路が5つあるので必ずどれかで書き忘れる（落とし穴1・4）。
     * ゲームを変える時（gameId が違う・null）は引き継がない——
     * 別のゲームのモードidを持ち越すのがいちばん危ない形（大切なこと9）
     */
    function pickGame(gameId, opts) {
      var o = opts || {};
      var st = (state.room && state.room.state) || {};
      var いまのモード = (st.data && st.data.modeId) || null;
      if (gameId && gameId === st.game && いまのモード && !(o.data && o.data.modeId)) {
        o = Object.assign({}, o, { data: Object.assign({ modeId: いまのモード }, o.data || {}) });
      }
      return call('room:setState', Object.assign({ phase: 'lobby', game: gameId || null }, o));
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
    // ---- 指示66-2：文化祭の部屋 ----
    // 投票は一度入れたら変わらない（サーバーが門）。感想は「やめた人」も送れるよう、code と memberId を添える
    function fesVote(mode) { return call('fes:vote', { mode: mode }); }
    function fesContinue() { return call('fes:continue', {}); }
    function fesFeedback(p, code, memberId) {
      return call('fes:feedback', Object.assign({}, p || {}, { code: code || state.code, memberId: memberId || state.memberId }));
    }
    // 係（くまくんと先生）だけ。サーバーがログインしたアカウントで門を持つ
    function fesCreate(recreate) { connect(); return call('fes:create', { recreate: !!recreate }); }
    function fesWatch(code) { connect(); return call('fes:watch', { code: code || null }); }
    function fesHide(code, memberId, hidden) { return call('fes:hide', { code: code, memberId: memberId, hidden: hidden !== false }); }
    // 指示75 1-6：waitMs（30000・60000・300000）を添えると、その間は同じ端末と同じ名前で入れない（長押しの「外す」）
    function fesKick(code, memberId, waitMs) { return call('fes:kick', { code: code, memberId: memberId, waitMs: waitMs || undefined }); }
    // 指示68-T 二の束1：係（くまくん）のゲームごとの入／切（「テスト中を入れる」を置きかえた）
    function fesGame(code, mode, on) { return call('fes:game', { code: code, mode: mode, on: !!on }); }
    // 指示68-T 三の束2：待合の BGM の入／切（係）
    function fesBgm(code, on) { return call('fes:bgm', { code: code, on: !!on }); }
    function fesInset(code, inset) { return call('fes:inset', { code: code, inset: inset }); }
    function fesPause(code, on) { return call('fes:pause', { code: code, on: on !== false }); }
    function fesSkip(code) { return call('fes:skip', { code: code }); }
    // 指示71 追記1：resume に合い札を添えると、切れる前の予約にもどる（消えていたら reserve_gone）
    function fesReserve(code, resume) { connect(); return call('fes:reserve', { code: code, resume: resume || undefined }); }
    function fesUnreserve(code) { return call('fes:unreserve', { code: code }); }
    // 第32弾-E：リアクション・感謝・アルバム
    function react(emoji) { return call('room:react', { emoji: emoji }); }
    /**
     * 指示68-4：時計合わせ。サーバーに n 回「いまの時刻」をたずねる（1回ずつ順に）。
     * 返すのは [{ t0, t1, server }]（t0・t1 は local() の時刻）。ずれの計算は SoroeLogic.offsetOf
     */
    function clockSync(n, local) {
      local = local || Date.now;
      var samples = [], i = 0;
      return new Promise(function (resolve) {
        (function next() {
          if (i++ >= n) { resolve(samples); return; }
          var t0 = local();
          call('clock:sync', {}, 3000).then(function (r) {
            var t1 = local();
            if (r && typeof r.now === 'number') samples.push({ t0: t0, t1: t1, server: r.now });
            next();
          });
        })();
      });
    }
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
    /**
     * 指示58：試合の途中で、進行役がゲームの設定を変える（いまは「マニアックな問題」だけ）。
     * 受け取れない進行役（クイズ解除など）は not_supported を返す＝次のゲームから効く
     */
    function gameOptions(opts) { return call('game:options', opts || {}); }
    /**
     * 第48弾 48-5：ポーズ。席を外すための安全弁。
     * 止められるのは進行役だけ（サーバーが門番する）。
     * もどせるのは、止めた本人か進行役
     */
    function pause(on) { return call('room:pause', { on: on !== false }); }

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
      state: state, on: on, available: available, connect: connect, reconnect: reconnect, here: here,
      createRoom: createRoom, joinRoom: joinRoom, setRole: setRole, setLook: setLook,
      peekRoom: peekRoom, dropRoom: dropRoom,
      transferHost: transferHost, kick: kick, leave: leave, closeRoom: closeRoom, pickGame: pickGame,
      lastRoom: lastRoom, forgetLastRoom: forgetLastRoom,
      setReady: setReady,
      startWolf: startWolf, act: act, vote: vote, nextPhase: nextPhase, pause: pause,
      gameOptions: gameOptions,
      react: react, thanks: thanks, clockSync: clockSync,
      isStale: function () { return !!state.stale; },
      albumAdd: albumAdd, albumRemove: albumRemove, albumGet: albumGet, albumDone: albumDone,
      isHost: isHost, me: me,
      fesVote: fesVote, fesContinue: fesContinue, fesFeedback: fesFeedback,
      fesCreate: fesCreate, fesWatch: fesWatch, fesHide: fesHide, fesKick: fesKick, fesGame: fesGame, fesBgm: fesBgm, fesInset: fesInset, fesPause: fesPause, fesSkip: fesSkip, fesReserve: fesReserve, fesUnreserve: fesUnreserve,
      // テストから中身を差し替えられるように（socket.io本体は持たせない）
      _call: call
    };
  }

  return { create: create };
}));
