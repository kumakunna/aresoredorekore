// tests/harness.js — 回帰テストの共通土台
//
// public/index.html を jsdom に読み込み、ブラウザ専用の機能を差し替えて
// アプリを動かせるようにする。各テストはここの helper を使う。
//
// 注意：jsdom はレイアウトを行わないため getBoundingClientRect() は常に 0 を返す。
// 「中央のカセット判定」のような座標依存の処理は、座標を偽装しないと検証できない。

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const TitleLogic = require('../public/js/titles');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'public', 'index.html');
// テスト中の長押しの溜め時間（本番は1000ms）。詳しくは launch() の置換部分を参照
const HOLD_MS_TEST = 60;

// ---------- 疑似サーバー ----------
// 本物のサーバーを立てずに /api/* を返す。失敗させたい時は opts で切り替える。
function makeApi(opts, titlePuts) {
  opts = opts || {};
  const topics = ['傘', '習字道具', '自動販売機', 'ヘリコプター', '目覚まし時計',
    '冷蔵庫', 'ペンギン', '遊園地', '信号機', 'ズッキーニ', 'パトカー', 'スマートフォン']
    .map((name, i) => ({ id: i + 1, name, yomi: '', ng_words: ['ヒント1', 'ヒント2'], is_default: true }));
  // opts.seedMatches：あらかじめ入っている対戦記録。
  // 「昔のIDで残っている記録が、いまも正しく表示されるか」を確かめるために使う
  const matches = (opts.seedMatches || []).map((m, i) => Object.assign({
    id: i + 1, player_names: [], rounds: [], final_scores: null,
    started_at: new Date().toISOString(), ended_at: new Date().toISOString()
  }, m));
  let nextId = matches.length + 1;
  // 第26弾-4：称号の預かり先（アカウントごとの持ち物）
  let titleStore = {
    stats: TitleLogic.emptyStats(),
    unlocked: TitleLogic.unlockedIds(null),
    equipped: TitleLogic.normalizeEquipped(null, [])
  };

  return async function fakeFetch(url, init) {
    init = init || {};
    const p = String(url).split('?')[0];
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (status, data) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data
    });

    if (p === '/api/auth/me') {
      // 第32弾-C：起動時のログイン確認が1回だけ失敗する状況を作る。
      // 本番のサーバーは2分ごとに git pull → pm2 restart で入れ替わるので、
      // ちょうどその瞬間にアプリを開いた人は、これを実際に踏む。
      // セッションのクッキーは生きているのに、確認だけが落ちる。
      if (opts.authFlaky && !fakeFetch.__authTried) {
        fakeFetch.__authTried = true;
        return json(503, { error: 'サーバーが再起動中です（テスト）' });
      }
      return opts.loggedOut ? json(401, { error: '未ログイン' }) : json(200, { id: 1, username: 'test' });
    }
    if (p === '/api/auth/login' || p === '/api/auth/register') return json(200, { id: 1, username: 'test' });
    if (p === '/api/auth/logout') return json(200, { ok: true });
    if (p === '/api/topics' && (init.method || 'GET') === 'GET') return json(200, topics);
    if (p === '/api/topics') { const t = { id: 900 + topics.length, name: body.name, yomi: body.yomi || '', ng_words: body.ng_words || [], is_default: false }; topics.push(t); return json(201, t); }
    if (p === '/api/ai-describe') {
      if (opts.failAI) return json(502, { error: 'AI呼び出しに失敗しました（テスト）' });
      if (body.hint) return json(200, { description: 'ヒント' + ((body.avoid || []).length + 1) });
      return json(200, { description: 'テスト用の説明文（' + (body.name || '') + '）' });
    }
    if (p === '/api/matches' && (init.method || 'GET') === 'GET') return json(200, matches.slice().reverse());
    if (p === '/api/matches') { const m = { id: nextId++, player_names: body.player_names || [], rounds: [], final_scores: null, started_at: new Date().toISOString(), ended_at: null }; matches.push(m); return json(201, { id: m.id }); }
    let mm;
    if ((mm = p.match(/^\/api\/matches\/(\d+)\/round$/))) {
      const m = matches.find(x => x.id == mm[1]);
      // 本番の server.js は opts と detail の両方を保存する。
      // 疑似APIが detail を捨てていると、記録画面の表示をテストできない
      if (m) {
        const rd = { mode: body.mode, score_deltas: body.score_deltas || {}, at: new Date().toISOString() };
        if (body.opts) rd.opts = body.opts;
        if (body.detail) rd.detail = body.detail;
        m.rounds.push(rd);
      }
      return json(200, { ok: true });
    }
    if ((mm = p.match(/^\/api\/matches\/(\d+)\/finish$/))) {
      const m = matches.find(x => x.id == mm[1]);
      if (m) { m.final_scores = body.final_scores || {}; m.ended_at = new Date().toISOString(); }
      return json(200, { ok: true });
    }
    if (p === '/api/matches/stats') return json(200, { name: 'test', play_count: 1, win_count: 1, win_rate: 100, total_score: 5, avg_score: 5 });
    // 第26弾-4：称号。本番のサーバーと同じく「持ち物は減らさない」ように預かる
    if (p === '/api/titles') {
      if (opts.loggedOut) return json(401, { error: '未ログイン' });
      // 第32弾-A 第4部：称号を「いつ・何回」預けにきたかを、テストから見られるようにする。
      // 二重に数えていないか／2回目がちゃんと数えられているかは、ここでしか分からない
      if ((init.method || 'GET') === 'PUT') titlePuts.push(body);
      if ((init.method || 'GET') === 'PUT') {
        const stats = TitleLogic.normalizeStats(body.stats);
        Object.keys(stats).forEach((cas) => {
          Object.keys(stats[cas]).forEach((k) => {
            stats[cas][k] = Math.max(titleStore.stats[cas][k], stats[cas][k]);
          });
        });
        const unlocked = TitleLogic.mergeUnlocked(titleStore.unlocked.concat(body.unlocked || []), stats);
        titleStore = {
          stats,
          unlocked,
          equipped: TitleLogic.normalizeEquipped(body.equipped || titleStore.equipped, unlocked)
        };
      }
      return json(200, JSON.parse(JSON.stringify(titleStore)));
    }
    return json(200, { ok: true });
  };
}

// ---------- アプリの起動 ----------
async function launch(opts) {
  opts = opts || {};
  let html = fs.readFileSync(HTML, 'utf8');
  // jsdom は <script src> を読み込まないので、public/js/*.js は中身を埋め込んでから起動する。
  // （本番のブラウザでは普通に外部ファイルとして読み込まれる）
  html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, function (m, src) {
    const p = path.join(ROOT, 'public', src);
    if (!fs.existsSync(p)) throw new Error('読み込めません: ' + src);
    return '<script>' + fs.readFileSync(p, 'utf8') + '</script>';
  });
  // 独立ゲーム（ワードウルフ・時限爆弾など）は hidden:true で棚から選べないようにしてある。
  // 復活させた時に壊れていないかを確かめたいので、テスト時だけ一時的に表示させる。
  // 変えるのは表示フラグだけで、ゲームのロジックには触れていない。
  if (opts.showHiddenModes) {
    const before = (html.match(/hidden:true/g) || []).length;
    html = html.replace(/hidden:true/g, 'hidden:false');
    if (before === 0) throw new Error('hidden:true が見つかりません（MODESの書式が変わった可能性があります）');
  }
  // 第21弾：1人1台モードの画面を jsdom で確かめるための疑似 socket.io。
  // 本番のブラウザはサーバーが配る /socket.io/socket.io.js を読むが、
  // jsdom は外部スクリプトを読まないので window.io が無い。
  // テストからサーバー→端末のイベントを流し込めるよう、最小の代役を差し込む。
  // 本番コードには一切手を入れていない（window.io があるかないかだけの違い）。
  if (opts.fakeSocket) {
    const fake = `<script>
      window.__rtFake = { emits: [], handlers: {}, connected: false };
      window.io = function(){
        var f = window.__rtFake;
        var s = {
          on: function(name, fn){ (f.handlers[name] = f.handlers[name] || []).push(fn); return s; },
          emit: function(name, payload, cb){
            f.emits.push({ name: name, payload: payload });
            var reply = f.replies && f.replies[name];
            if (!cb) return s;
            if (typeof reply === 'function') {
              // 第35弾A：reply(payload, cb) が undefined を返したら、その場では返事しない。
              // cb を受け取った側が、あとで呼ぶ（遅い返事）or 呼ばない（返事が来ない）を選べる。
              // 値を返す既存の書き方は今まで通りその場で返る
              var out = reply(payload, cb);
              if (out !== undefined) cb(out);
            } else {
              cb(reply || { ok: true });
            }
            return s;
          },
          close: function(){ s.disconnect(); },
          disconnect: function(){ f.connected = false; f.fire('disconnect'); }
        };
        f.socket = s;
        f.fire = function(name, payload){
          (f.handlers[name] || []).forEach(function(fn){ fn(payload); });
        };
        setTimeout(function(){ f.connected = true; f.fire('connect'); }, 0);
        return s;
      };
    </script>`;
    html = html.replace('<script src="/socket.io/socket.io.js"></script>', fake);
  }
  // 長押しボタンは本番で1秒かけて溜める。テストでは1回ごとに1秒待つのが積み上がり、
  // 第20弾で長押しが増えた結果、全体の実行時間が10分近くまで伸びた。
  // 押し心地の検証はテストの目的ではないので、待ち時間だけ縮める。
  // （リング演出・完了処理・イベントの流れは本番とまったく同じものが走る）
  {
    const before = html;
    html = html.replace('var HOLD_MS = 1000;', 'var HOLD_MS = ' + HOLD_MS_TEST + ';');
    if (html === before) throw new Error('HOLD_MS が見つかりません（長押しの実装が変わった可能性があります）');
  }
  // 第32弾-C：演出は「入りきってから次へ」進むので、待ちが入る。
  // そのままだと「押した直後に画面が変わる」前提のテストが全部ずれるので、
  // 演出そのものを見るテスト（opts.fx）以外では0にする。HOLD_MS と同じ考え方。
  // 本番のコードは、0のときは待ちを挟まずその場で進む
  //（＝「演出の速さ＝スキップ」を選んだ人と同じ動き）。
  {
    const src = 'var FX_MS = { warp:240, celebrate:800, flip:300 };';
    if (html.indexOf(src) < 0) {
      throw new Error('FX_MS が見つかりません（演出の実装が変わった可能性があります）');
    }
    if (!opts.fx) html = html.replace(src, 'var FX_MS = { warp:0, celebrate:0, flip:0 };');
  }
  // **演出の速さを「スキップ」にして始める。**
  // これはテスト専用の細工ではなく、**遊ぶ人が設定で選べるのと同じ状態**——
  // 保存された設定を先に置いておくだけで、本番のコードは何も変えていない。
  // 遊びの数字（カウントダウンの長さ・持ち時間）は一切縮めない（落とし穴24）。
  //
  // これを使わない検査を必ず1つ残すこと。**全部を早送りにすると、
  // 「ふつうの速さで本当に待つのか」を誰も見なくなる。**
  //   → tests/wolf-vote.js「集計は、票が集まりきってから処刑を発表する」
  if (opts.fxSkip) {
    const seed = '<script>try{localStorage.setItem("acac-app-prefs",' +
      'JSON.stringify({fxSpeed:"skip"}));}catch(e){}</script>';
    const marker = '<body>';
    if (html.indexOf(marker) < 0) throw new Error('<body> が見つかりません');
    html = html.replace(marker, marker + seed);
  }
  // 複数ゲームを持つカセットは本番にまだ無いので、テスト時だけ差し込む。
  // 本番のカセット構成は変えずに「ゲーム選択画面を通る経路」を確認するため。
  if (opts.testCassettes && opts.testCassettes.length) {
    const marker = '  var CASSETTES = [';
    if (html.indexOf(marker) < 0) throw new Error('CASSETTES が見つかりません（書式が変わった可能性があります）');
    const injected = opts.testCassettes.map(c => '    ' + JSON.stringify(c) + ',').join('\n');
    html = html.replace(marker, marker + '\n' + injected);
  }
  // setTimeout / rAF の中で投げられた例外は window の error イベントに乗らないことがあるので、
  // VirtualConsole の jsdomError も拾う（これを見ないとクラッシュを見逃す）
  const jsdomErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => jsdomErrors.push('jsdomError: ' + (e && e.message ? e.message : String(e))));
  virtualConsole.on('error', (...a) => jsdomErrors.push('console.error: ' + a.join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    // 第26弾-1：QRから来た人は ?room=コード 付きで開く
    url: opts.url || 'http://localhost/',
    virtualConsole
  });
  const win = dom.window;
  const doc = win.document;

  // 未捕捉の例外を全部集める（read_console_messages では拾えないため必須）
  const errors = jsdomErrors;
  win.addEventListener('error', e => errors.push('error: ' + (e.message || e.error)));
  win.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const origConsoleError = win.console.error;
  win.console.error = function (...a) { errors.push('console.error: ' + a.join(' ')); origConsoleError.apply(this, a); };

  // --- jsdom に無いブラウザ機能を埋める ---
  const titlePuts = [];
  win.fetch = makeApi(opts, titlePuts);
  win.__titlePuts = titlePuts; // 第32弾-A 第4部：称号を預けにきた回数と中身
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.speechSynthesis = { speak() {}, cancel() {} };
  win.SpeechSynthesisUtterance = function () {};
  win.navigator.vibrate = () => true;
  // 効果音（AudioContext）は鳴らす必要がないので黙らせる
  const silentNode = () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0, setValueAtTime() {} }, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, type: '' });
  win.AudioContext = win.webkitAudioContext = function () {
    return {
      createOscillator: silentNode, createGain: silentNode, destination: {},
      currentTime: 0, state: 'running', resume() {}, close() { return Promise.resolve(); }
    };
  };
  if (!win.PointerEvent) {
    win.PointerEvent = class PointerEvent extends win.MouseEvent {
      constructor(type, init) { super(type, init); this.pointerType = (init && init.pointerType) || 'mouse'; this.pointerId = 1; }
    };
  }
  if (!win.matchMedia) win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  // jsdom は Web Animations API（element.animate）を持たない。
  // 無いまま動かすと演出の途中で例外が飛び、その後の処理（スコア反映など）が実行されない。
  if (!win.Element.prototype.animate) {
    win.Element.prototype.animate = function () {
      const anim = {
        onfinish: null, oncancel: null,
        finished: Promise.resolve(),
        cancel() {}, finish() {}, play() {}, pause() {},
        addEventListener(type, fn) { if (type === 'finish') win.setTimeout(fn, 0); },
        removeEventListener() {}
      };
      win.setTimeout(() => { if (typeof anim.onfinish === 'function') anim.onfinish(); }, 0);
      return anim;
    };
  }

  await waitFor(win, () => doc.readyState === 'complete', 5000, '読み込み完了');
  // 第32弾-D 第4部：初回起動は、扉の前に安全の案内が出る。
  // テストのjsdomは毎回まっさらなlocalStorageなので、必ず初回になる。
  // この画面そのものを見たいテストは keepSafetyGate:true で止められる
  // （その場合は扉より先へ進まないので、ここで返す）
  if (opts.keepSafetyGate) return { dom, win, doc, errors };
  await waitFor(win, () => {
    const gate = doc.getElementById('safetyGate');
    if (gate && gate.style.display !== 'none') {
      const btn = doc.getElementById('sgStartBtn');
      if (btn) btn.click();
    }
    return !gate || gate.style.display === 'none';
  }, 5000, '安全の案内を通過');
  // 扉が自動で開くまで待つ（起動時は必ず扉を通る）
  await waitFor(win, () => activeScreen(doc) !== 'scr-door', 5000, '扉が開く');

  // 第32弾-A：扉の次に「あそびかたをえらぶ」が入った。
  // ほとんどのテストは、その先（棚・部屋）を見たいので、ここで1回だけ通す。
  // この画面そのものを見たいテストは playFlow:false を渡して止められる
  if (opts.playFlow !== false && activeScreen(doc) === 'scr-howto') {
    const flow = opts.playFlow || 'handoff';
    const btn = doc.querySelector('#scr-howto [data-howto="' + flow + '"]');
    if (btn) {
      btn.click();
      await waitFor(win, () => activeScreen(doc) !== 'scr-howto', 4000, 'あそびかたを選ぶ');
    }
  }

  return { dom, win, doc, errors };
}

// ---------- helper ----------
function activeScreen(doc) {
  const s = doc.querySelector('.screen.active');
  return s ? s.id : null;
}

function sleep(win, ms) {
  return new Promise(r => win.setTimeout(r, ms));
}

// 待っているあいだ、関門の画面は自動で通過させる。
//   keepNightfall=true …「夜になりました」を素通りさせない
//   keepMeeting=true   … 作戦会議を素通りさせない
// （その画面自体を調べたい時だけ立てる。関門ごとに分けているのは、
//   「夜になりました」を調べたい時でも作戦会議は通過させたいため）
async function waitFor(win, cond, timeout, label, keepNightfall, keepMeeting) {
  const limit = timeout || 4000;
  const start = Date.now();
  const doc = win.document;
  while (Date.now() - start < limit) {
    let ok = false;
    try { ok = cond(); } catch (e) { ok = false; }
    if (ok) return true;
    if (!keepNightfall) passNightfall(doc);
    if (!keepMeeting) passWrMeeting(win, doc);
    await sleep(win, 20);
  }
  throw new Error('待機がタイムアウトしました: ' + (label || cond.toString()));
}

// 第20弾-4-1で「夜になりました（全員伏せてください）」が挟まるようになった。
// 押すまで進まない関門なので、他の画面を待っている間は自動で通過させる。
// この画面そのものの中身は、専用のテストで確認している。
function passNightfall(doc) {
  if (activeScreen(doc) !== 'scr-nightfall') return false;
  const btn = doc.getElementById('nfNextBtn');
  if (!btn) return false;
  btn.click();
  return true;
}

// 第24弾-2：役職確認のあとに「作戦会議」が入った。
// 朝と同じ scr-wr-day を使うので、長押しボタンの文言で見分ける。
// 押すのは1回だけでよい（長押しは HOLD_MS で勝手に完了する）。
// この画面そのものは専用のテストで確認している。
let wrMeetingPressed = false;
function passWrMeeting(win, doc) {
  const label = doc.getElementById('wrDayHoldLabel');
  const onMeeting = activeScreen(doc) === 'scr-wr-day' && label && /夜へ/.test(label.textContent);
  if (!onMeeting) { wrMeetingPressed = false; return false; }
  if (wrMeetingPressed) return false;
  const btn = doc.getElementById('wrToVoteBtn');
  if (!btn) return false;
  wrMeetingPressed = true;
  btn.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  return true;
}

async function waitScreen(win, doc, id, timeout) {
  // 第32弾-C-2：人が説明するモードは、遊びはじめる前に手渡しを1回はさむ。
  // 25か所のテストに同じタップを書き足すと必ずどこかを漏らすので、
  // 「遊ぶ画面を待っている時に手渡しに来たら通す」をここ1か所に置く。
  // 手渡しそのものは tests/aresore.js が正面から確かめている。
  if (id === 'scr-play') {
    await waitFor(win, () => activeScreen(doc) === id || activeScreen(doc) === 'scr-topic-pass',
      timeout, '画面 ' + id + ' へ遷移（現在: ' + activeScreen(doc) + '）');
    if (activeScreen(doc) === 'scr-topic-pass') {
      el(doc, 'topicPassBtn').click();
      await sleep(win, 30);
    }
  }
  await waitFor(win, () => activeScreen(doc) === id, timeout,
    '画面 ' + id + ' へ遷移（現在: ' + activeScreen(doc) + '）', id === 'scr-nightfall');
}

function el(doc, id) {
  const e = doc.getElementById(id);
  if (!e) throw new Error('要素が見つかりません: #' + id);
  return e;
}

function click(doc, idOrEl) {
  const e = typeof idOrEl === 'string' ? el(doc, idOrEl) : idOrEl;
  e.click();
  return e;
}

// jsdom はレイアウトしないので、座標が要る処理のために矩形を偽装する。
// あわせて scrollIntoView でスクロール位置も動かす。これをしないと、
// アプリが後から中央を再計算した時に「スクロールしていない」と判定して元に戻ってしまう。
function fakeRects(win, doc, rail) {
  const carts = Array.from(rail.querySelectorAll('.cart'));
  const W = 124, GAP = 8, PAD = 167, RAIL_W = 458;
  rail.getBoundingClientRect = () => ({ left: 0, right: RAIL_W, width: RAIL_W, top: 0, bottom: 140, height: 140 });
  carts.forEach((c, i) => {
    c.getBoundingClientRect = () => {
      const left = i * (W + GAP) - (rail.scrollLeft || 0) + PAD;
      return { left, right: left + W, width: W, top: 0, bottom: 136, height: 136 };
    };
    // 中央に寄せる＝そのカセットが真ん中に来るスクロール位置にする
    c.scrollIntoView = () => { rail.scrollLeft = i * (W + GAP); };
  });
  return carts;
}

// プレイヤーを登録してモード選択まで進む（多くのテストの前準備）
async function setupPlayers(win, doc, names) {
  names = names || ['あき', 'びび'];
  if (activeScreen(doc) === 'scr-shelf') {
    const cart = doc.querySelector('.cart[data-cart="aresoredorekore"]');
    cart.click();
    // 第32弾-C-1：カセットに入る演出が入ったので、押した直後はまだ棚にいることがある。
    // 「中央でなければ2回目で選択」と区別するため、演出が始まっていないときだけ押し直す
    await sleep(win, 20);
    if (activeScreen(doc) === 'scr-shelf' && !doc.querySelector('.cassette-warp')) cart.click();
    await waitFor(win, () => activeScreen(doc) !== 'scr-shelf', 4000, 'カセットの中に入る');
  }
  await fillPlayerForm(win, doc, names);
}

// プレイヤー設定画面が出ていれば、名前を入れて次へ進む
async function fillPlayerForm(win, doc, names) {
  if (activeScreen(doc) !== 'scr-setup') return false;
  // 入力欄は初期2行なので、必要な人数まで「＋」を押して増やす。
  // 人狼カセットは人数無制限なので、押す回数の上限は人数ぶん確保する
  let guard = 0;
  while (doc.querySelectorAll('#scr-setup input.draft-name').length < names.length && guard++ < names.length + 4) {
    el(doc, 'playerPlusBtn').click();
    await sleep(win, 10);
  }
  const inputs = doc.querySelectorAll('#scr-setup input.draft-name');
  if (inputs.length < names.length) throw new Error('プレイヤー入力欄が足りません（' + inputs.length + '/' + names.length + '）');
  names.forEach((n, i) => {
    inputs[i].value = n;
    inputs[i].dispatchEvent(new win.Event('input', { bubbles: true }));
  });
  click(doc, 'setupNextBtn');
  await waitScreen(win, doc, 'scr-mode', 4000);
  return true;
}

// ウィザードを最後まで進めて play 画面まで到達させる
async function runWizardToPlay(win, doc, opts) {
  opts = opts || {};
  click(doc, opts.auto === false ? 'modeNextBtn' : 'modeAutoBtn');
  for (let i = 0; i < 10; i++) {
    const cur = activeScreen(doc);
    if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
    const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
    if (!next) break;
    next.click();
    await sleep(win, 30);
  }
  if (activeScreen(doc) === 'scr-mode-rules') {
    click(doc, 'rulesStartBtn');
    await sleep(win, 60);
  }
  await waitScreen(win, doc, 'scr-ready', 4000);
  // 長押しスタート
  el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
}

/**
 * 第32弾-C-3：人狼の手渡し画面で選択肢を押す。
 * 投票は「選ぶ → 確認 → 決定」の2手になったので、確認が出ていれば通す。
 * 各テストがこの手順を書き写すと、確認をもう1つ足した時に全部直すことになる。
 *   target … 番号 / 表示名 / 要素そのもの
 */
async function wolfPick(win, doc, target) {
  const btns = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'));
  let b = target;
  if (typeof target === 'number') b = btns[target];
  else if (typeof target === 'string') {
    b = btns.find(x => x.dataset.choice === target || x.textContent.trim() === target);
  }
  if (!b) throw new Error('選択肢が見つかりません: ' + target);
  b.click();
  await sleep(win, 20);
  const ok = doc.getElementById('wrVoteOkBtn');
  if (ok) { ok.click(); await sleep(win, 20); }
  return b;
}

/**
 * 第32弾-C-7：結果のあとは、共通の「つぎは？」画面で行き先を選ぶ。
 * カセットごとに出口のボタンが別々だったのをやめたので、
 * テスト側も「どのボタンか」ではなく「どこへ行きたいか」で書く。
 *   again … もう一度（同じ設定でそのまま）
 *   mode  … モードを変える
 *   game  … 別のゲームへ
 *   shelf … 別のカセットへ（棚にもどる／ここで記録が残る）
 */
async function chooseNext(win, doc, id) {
  if (activeScreen(doc) === 'scr-score') {
    click(doc, 'toNextBtn');
    await sleep(win, 40);
  }
  await waitScreen(win, doc, 'scr-next', 3000);
  const b = doc.querySelector('#nextChoices [data-next="' + id + '"]');
  if (!b) {
    const have = Array.from(doc.querySelectorAll('#nextChoices [data-next]')).map(x => x.dataset.next);
    throw new Error('「つぎは？」に選択肢がありません: ' + id + '（あるのは: ' + have.join(',') + '）');
  }
  b.click();
  await sleep(win, 60);
}

// ゲーム選択画面でゲームを選んで確定する。
// 第20弾-3-1でタップ即決定をやめ、「選ぶ→つぎへ」の2手になった。
function pickGame(doc, gameId) {
  const card = doc.querySelector('#gameCards .mode-card[data-game="' + gameId + '"]');
  if (!card) throw new Error('ゲームカードが見つかりません: ' + gameId);
  card.click();
  el(doc, 'gameNextBtn').click();
  return card;
}

// 長押しボタンを押す（第20弾で準備OK以外にも増えた）。
// 途中でもう一度押すと計測が振り出しに戻るので、溜まりきる時間をここで確保してから返す。
// テストでは HOLD_MS_TEST まで縮めてあるので、本番の1秒を待つ必要はない。
async function holdPress(win, doc, id) {
  el(doc, id).dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  await sleep(win, HOLD_MS_TEST + 60);
}

// ---------- テストランナー ----------
function createRunner(title) {
  const results = [];
  // 遅い検査を探すための計測。**ふだんの出力は変えない**（環境変数を付けた時だけ）。
  //   ACAC_TIME=1 node tests/〇〇.js
  // 速さを直す時、まず「どこが遅いか」を測る。勘で縮めると、
  // 遊びの数字の方を歪めたくなる（落とし穴24）
  const 計測 = !!process.env.ACAC_TIME;
  return {
    async test(name, fn) {
      const t0 = Date.now();
      try {
        await fn();
        results.push({ name, ok: true, ms: Date.now() - t0 });
      } catch (e) {
        results.push({ name, ok: false, err: e && e.message ? e.message : String(e), ms: Date.now() - t0 });
      }
    },
    finish() {
      const failed = results.filter(r => !r.ok);
      console.log('\n■ ' + title);
      results.forEach(r => console.log('  ' + (r.ok ? '✅' : '❌') + ' ' + r.name +
        (計測 ? '  [' + r.ms + 'ms]' : '') + (r.ok ? '' : '\n       → ' + r.err)));
      if (計測) {
        const 合計 = results.reduce((s, r) => s + r.ms, 0);
        console.log('  ── 合計 ' + (合計 / 1000).toFixed(1) + '秒。遅い順:');
        results.slice().sort((a, b) => b.ms - a.ms).slice(0, 5)
          .forEach((r) => console.log('     ' + (r.ms + 'ms').padStart(8) + '  ' + r.name));
      }
      console.log('  ' + (results.length - failed.length) + '/' + results.length + ' 件成功');
      if (failed.length) {
        console.log('\n' + title + ' は ' + failed.length + ' 件失敗しました。');
        process.exit(1);
      }
    }
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'アサーションに失敗しました');
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || '値が一致しません') + '（期待: ' + JSON.stringify(expected) + ' / 実際: ' + JSON.stringify(actual) + '）');
  }
}
// 未捕捉例外が出ていないことを確認する。過去にこれを見ずにクラッシュを見逃した
function assertNoErrors(errors, label) {
  if (errors.length) {
    throw new Error((label || '未捕捉のエラーが発生しました') + ': ' + errors.join(' / '));
  }
}

/**
 * 共通ダイアログ（UiKit）に、出るたび自動で答える（第39弾）。
 *
 * それまでは `win.confirm = () => true` でブラウザ標準を握りつぶしていた。
 * 標準ダイアログを全廃したので、**本物の部品が出て、それを押す**形にする。
 * 流れを確かめる検査は、ダイアログの中身までは見ない——
 * 部品そのものの約束は tests/ui-kit.js が、
 * どの場面がどの種類で出るかは tests/ui-text.js が見ている。
 *
 * @param answer  true＝主ボタン（既定）／false＝逃げ道
 * @returns 止める関数
 */
function autoDialog(win, doc, answer) {
  // 閉じる動きのあいだ、パネルはまだDOMに残っている。
  // 見張りはその間も動くので、**同じパネルに二度答えない**ようにする
  // （答えを数えていると、1回の問いが3回に見えた）
  const 答えた = new WeakSet();
  const press = () => {
    const dlg = openDialog(doc);
    if (!dlg || 答えた.has(dlg.node)) return;
    答えた.add(dlg.node);
    // 答えは、真偽値でも「見出しを見て決める関数」でもよい。
    // 一律 OK にすると「終了しますか？」まで通してしまう場面がある
    const yes = (typeof answer === 'function') ? answer(dlg) : (answer !== false);
    const which = yes ? 'ok' : 'cancel';
    const b = dlg.node.querySelector('[data-ui="' + which + '"]')
           || dlg.node.querySelector('[data-ui="ok"]');
    if (b) b.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  };
  // **見張りは間隔ではなく、増えた時だけ動かす。**
  // 10msごとに回す形にしたら、窓を閉じても止まらない見張りが
  // 検査のぶんだけ積み上がって、smoke が落ちた（segmentation fault）
  //
  // **見る先は body。** 重なりは #app の外（#uiLayerRoot）に移したので、
  // #app を見張っていると、ダイアログが増えても一度も動かない（第39弾）
  const mo = new win.MutationObserver(press);
  mo.observe(doc.body, { childList: true, subtree: true });
  press();   // すでに出ているものにも答える
  return () => mo.disconnect();
}

/** いま出ているダイアログ（無ければ null） */
function openDialog(doc) {
  const p = doc.querySelector('.ui-layer .ui-panel');
  if (!p) return null;
  return {
    種類: p.querySelector('.ui-dialog-in.is-danger') ? 'danger'
        : p.querySelector('[data-ui="cancel"]') ? 'confirm' : 'info',
    見出し: (p.querySelector('.ui-head') || {}).textContent || '',
    本文: (p.querySelector('.ui-body') || {}).textContent || '',
    node: p
  };
}

module.exports = {
  launch, activeScreen, sleep, waitFor, waitScreen, el, click, fakeRects,
  autoDialog, openDialog,
  setupPlayers, fillPlayerForm, runWizardToPlay, pickGame, holdPress, passNightfall, passWrMeeting,
  chooseNext, wolfPick,
  createRunner, assert, assertEqual, assertNoErrors
};
