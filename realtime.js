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
const WordwolfRoom = require('./wordwolf-room.js');
const BombRoom = require('./bomb-room.js');
const DefuseRoom = require('./defuse-room.js');
const QuizRoom = require('./quiz-room.js');
const AuctionRoom = require('./auction-room.js');
const SugorokuRoom = require('./sugoroku-room.js');

// 第24弾：部屋で遊べるゲームの一覧。
// どのゲームも同じ形（startGame / publicView / privateFor / submitAction /
// submitVote / isAllDone / advance / expectedMembers）を持つので、
// 通信の側はゲームごとに分岐せず、ここで引いた1つを呼ぶだけでよい。
// 新しいゲームをリアルタイム化する時は、ここに1行足す。
const GAME_DRIVERS = {
  wolfrole: { driver: WolfRoom, key: 'wolf' },
  wordwolf: { driver: WordwolfRoom, key: 'wordwolf' },
  // 第27弾：爆弾解除（クイズ解除）。約束の形が同じなので、足したのはこの1行だけ
  bomb: { driver: BombRoom, key: 'bomb' },
  // 第27弾-3：爆弾解除（実物解除）。センサーを使うが、約束の形は変わらない
  defuse: { driver: DefuseRoom, key: 'defuse' },
  // 第30弾：カセット「クイズ王」の4ゲーム。
  // 得点・順番・時間の扱いが同じなので、進行役は1つ（quiz-room.js）を共有し、
  // 部屋に置く状態も1つ（room.quiz）にまとめてある。
  // 4つ別々に書くと、片方だけ直してもう片方に反映し忘れる事故が必ず起きるため。
  quizrush: { driver: QuizRoom, key: 'quiz' },
  quizlist: { driver: QuizRoom, key: 'quiz' },
  quizreveal: { driver: QuizRoom, key: 'quiz' },
  buzzer: { driver: QuizRoom, key: 'quiz' },
  // 第31弾：オークションバトル（作り直し）。約束の形は変わらない
  auction: { driver: AuctionRoom, key: 'auction' },
  // 第36弾：カセット「すごろく」。5ゲームで進行役1つ・部屋に置く状態も1つ（room.sugoroku）。
  // クイズ王が4ゲームで quiz-room.js を共有しているのと同じ形。
  // 遊べるようになったゲームだけを、ここに1行ずつ足していく
  sugotoll: { driver: SugorokuRoom, key: 'sugoroku' },
  sugograb: { driver: SugorokuRoom, key: 'sugoroku' }
};
// その部屋でいま動いているゲームの進行役。始まっていなければ null
function driverOf(room) {
  for (const id of Object.keys(GAME_DRIVERS)) {
    const g = GAME_DRIVERS[id];
    if (room[g.key]) return g.driver;
  }
  return null;
}
function driverStateOf(room) {
  for (const id of Object.keys(GAME_DRIVERS)) {
    const g = GAME_DRIVERS[id];
    if (room[g.key]) return room[g.key];
  }
  return null;
}
/**
 * 第26弾-3：部屋はカセットに紐づかない箱。
 * 遊ぶゲームが変わったら、前のゲームの進行状態は意味を持たないので必ず捨てる。
 * 端末に任せると「片方の端末にだけ前の役職が残る」形の事故になるので、
 * サーバー側で落とす。記録は決着した時点で済んでいるので、ここで消えるものはない。
 */
function clearGameState(room) {
  for (const id of Object.keys(GAME_DRIVERS)) delete room[GAME_DRIVERS[id].key];
  room.state.phase = 'lobby';
  room.state.data = {};
}

// 紛らわしい文字（0/O, 1/I/L など）を除いた部屋コード用の文字
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

const ROLE_PLAYER = 'player';
const ROLE_BIGSCREEN = 'bigscreen';

// 第32弾-E 第4部：リアクションで使える絵文字。
// 数を絞る（多いと選ぶのに時間がかかり、ゲームの邪魔になる）。
// 端末側の一覧と食い違わないよう、サーバーはこの一覧しか通さない
const REACTION_EMOJI = ['👏', '😂', '😮', '❤️', '🔥'];

// 第32弾-E 第5部：感謝の項目。勝敗と関係のないものだけを並べる
const THANKS_KINDS = {
  help: '今日、いちばん助かった',
  laugh: '今日、いちばん笑わせてくれた',
  close: '今日、いちばんおしかった'
};

// 第32弾-E 第6部：アルバムの現在地（公開してよい範囲だけ）。写真そのものは入れない
function albumStatus(room) {
  const a = room.album;
  return {
    count: a ? a.photos.size : 0,
    names: a ? Array.from(a.photos.values()).map((p) => p.name) : []
  };
}

/**
 * 第32弾-E 第6部：アルバム本体。写真を埋め込んだ1枚のHTMLにまとめる。
 * ・外部への読み込みが無い「自己完結のファイル」なので、保存すればオフラインでも開ける
 * ・AIによる解析・加工・タグ付けは一切しない（ただ並べるだけ）
 */
function buildAlbumHtml(room) {
  const a = room.album;
  if (!a || !a.photos.size) return null;
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const d = new Date();
  const date = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  const shots = Array.from(a.photos.values()).map((p) =>
    '<figure><img src="' + p.photo + '" alt="">' +
    '<figcaption>' + esc(p.name) + '</figcaption></figure>'
  ).join('\n');
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>あつまれ、あれこれ アルバム ' + esc(date) + '</title>' +
    '<style>' +
    'body{font-family:sans-serif;background:#faf6ef;color:#333;margin:0;padding:24px;text-align:center;}' +
    'h1{font-size:20px;}p{color:#8a8378;font-size:13px;}' +
    'main{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;max-width:1100px;margin:20px auto;}' +
    'figure{margin:0;background:#fff;padding:10px 10px 6px;border-radius:10px;' +
    'box-shadow:0 2px 10px rgba(0,0,0,.12);}' +
    'img{max-width:320px;max-height:320px;border-radius:6px;display:block;}' +
    'figcaption{font-size:13px;padding:6px 0 2px;}' +
    '</style></head><body>' +
    '<h1>あつまれ、あれこれ</h1>' +
    '<p>' + esc(date) + '　みんなで集まった記念（' + a.photos.size + '枚）</p>' +
    '<main>' + shots + '</main>' +
    '</body></html>';
}

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

// 第27弾：爆弾解除は、試合が始まる前にサーバー側だけで説明文を作る。
// 端末に頼むと、作った端末（＝進行役も1人のプレイヤー）に中身が見えてしまうため。
// プロンプトは /api/ai-describe と共通（ai-describe.js）。
function safeRequireAi() {
  try {
    const Ai = require('./ai-describe');
    return (input) => Ai.describe(input);
  } catch (e) {
    console.warn('[realtime] ai-describe を読み込めませんでした:', e.message);
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
// 第35弾D（レビュー決定 8/18）：部屋はプレイヤー20人まで。
// 技術上は30人でも余裕（実測：配布20ms・同時操作66ms）だが、話し合い・投票が
// 成立する体験の実用域として20人に区切る。1クラス（30〜40人）は「2部屋＋大画面2台」の
// 分割運用が濃い（docs/運用メモ.md）。上限を広げる場合は配役バランスの大人数調整が前提。
// 大画面表示は playerCount に数えないため、この門はプレイヤー枠だけを見る
const ROOM_MAX_PLAYERS = 20;

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
    // 第32弾-E 第1部：待機画面に出す控えめな一言のもと。
    // 「一番長い付き合いの2人」と「今日が初めての組み合わせ」だけ
    //（回数の一覧は出さない。少ない人が疎外感を持つ表示を作らない）
    pairNote: room.pairNote || null,
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
      // ゲームが始まっていれば、公開してよい範囲だけを載せる。
      // 役職・お題・投票先などの秘密は publicView が一切通さない
      data: driverOf(room) ? driverOf(room).publicView(room) : room.state.data
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
  // AIの説明文づくり。テストからは network を使わないものに差し替えられる
  const describe = (opts.describe !== undefined) ? opts.describe : safeRequireAi();
  // 掃除の間隔と猶予はテストから短くできるようにする（本番は既定値のまま）
  const sweepIntervalMs = opts.sweepIntervalMs || SWEEP_INTERVAL_MS;
  const emptyRoomTtlMs = opts.emptyRoomTtlMs != null ? opts.emptyRoomTtlMs : EMPTY_ROOM_TTL_MS;
  // 第32弾-E 第6部：アルバムを自動で消すまでの時間（1時間）
  const albumTtlMs = opts.albumTtlMs != null ? opts.albumTtlMs : 60 * 60 * 1000;

  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    // engine.io 自身の死活監視。アプリ側のハートビートとは別に、これも効かせておく
    pingInterval: HEARTBEAT_INTERVAL_MS,
    pingTimeout: HEARTBEAT_TIMEOUT_MS,
    // 第32弾-E 第6部：アルバムの写真（縮小済みJPEGのdataURL）を受け取るため、
    // 既定の1MBから広げる。写真は端末側で縮小してから送る約束
    maxHttpBufferSize: 3 * 1024 * 1024
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
    broadcast(room); // 公開情報（publicSnapshot → その部屋のゲームの publicView）
    const driver = driverOf(room);
    const w = driverStateOf(room);
    if (!driver || !w) return;
    for (const m of room.members.values()) {
      const mine = driver.privateFor(room, m.id);
      if (mine) emitPrivate(room, m.id, 'wolf:you', mine);
    }
    if (w.phase === driver.PHASE.ENDED && !w.recorded) {
      w.recorded = true;
      recordMatch(room);
      io.to('room:' + room.code).emit('wolf:ended', driver.publicView(room));
    }
  }
  // 決着したら記録に残す。ゲームごとに残す中身が違うので、ここで振り分ける
  function recordMatch(room) {
    if (room.wolf) return recordWolfMatch(room);
    if (room.wordwolf) return recordWordwolfMatch(room);
    if (room.bomb) return recordBombMatch(room);
    if (room.defuse) return recordDefuseMatch(room);
    if (room.quiz) return recordQuizMatch(room);
    if (room.auction) return recordAuctionMatch(room);
    if (room.sugoroku) return recordSugorokuMatch(room);
  }

  // 第36弾：すごろく。あがった順と、進んだ距離・残りコインがそのまま成績
  function recordSugorokuMatch(room) {
    if (!db || !room.ownerUserId || !room.sugoroku) return;
    try {
      const w = room.sugoroku;
      const view = SugorokuRoom.resultView(room);
      const names = view.players.map((p) => p.name);
      const finalScores = {};
      // 「何マス進んだか」を得点として残す。あがった人は満点（盤の長さ）
      view.players.forEach((p) => { finalScores[p.name] = p.goaled ? view.cells : p.pos; });
      const rounds = [{
        mode: w.preset || w.game,
        game: w.game,
        style: 'realtime',
        cells: view.cells,
        laps: view.lap,
        ranking: view.players.map((p) => ({
          name: p.name, rank: p.rank, tied: p.tied, pos: p.pos, coins: p.coins, goaled: p.goaled
        })),
        deltas: finalScores
      }];
      saveMatchRecord(room, names, rounds, finalScores);
    } catch (e) { /* 記録に失敗しても、遊びは終わっている */ }
  }

  /**
   * 第32弾-E 第1部：対戦履歴の保存は、全ゲームここを通す。
   * あわせて「その場にいた全部の2人組」に+1し、待機画面の一言（pairNote）を作り直す。
   * ゲームごとにINSERTを書いていた時の形だと、新しいゲームで数え忘れる（落とし穴4）。
   */
  function saveMatchRecord(room, names, rounds, finalScores) {
    db.prepare(
      'INSERT INTO matches (user_id, player_names, rounds, final_scores, ended_at) ' +
      "VALUES (?, ?, ?, ?, datetime('now'))"
    ).run(
      room.ownerUserId,
      JSON.stringify(names),
      JSON.stringify(rounds),
      JSON.stringify(finalScores)
    );
    try {
      if (db.countPairs) db.countPairs(room.ownerUserId, names);
      refreshPairNote(room);
      // 決着時の配信は saveMatchRecord より先に済んでいるので、
      // 作り直した一言はもう一度配らないと誰にも届かない
      if (room.pairNote) broadcast(room);
    } catch (e) { /* 2人組の記録に失敗しても、対戦履歴は残っている */ }
  }
  // 待機画面に出す控えめな一言のもと。部屋に人が入った時と、遊び終わった時に作り直す
  function refreshPairNote(room) {
    if (!db || !db.pairInfo || !room.ownerUserId) return;
    try {
      room.pairNote = db.pairInfo(room.ownerUserId, playerMembers(room).map((m) => m.name));
    } catch (e) { /* 一言が出ないだけ。進行は止めない */ }
  }

  // 第31弾：オークションバトル。最後に持っていたチップがそのまま成績
  function recordAuctionMatch(room) {
    if (!db || !room.ownerUserId || !room.auction) return;
    try {
      const w = room.auction;
      const view = AuctionRoom.resultView(room);
      const names = w.playerIds.map((id) => w.names[id]);
      const deltas = {}, finalScores = {};
      view.ranking.forEach((row) => {
        deltas[row.name] = row.chips;
        finalScores[row.name] = row.chips;
      });
      const detail = Object.assign({}, view, {
        game: 'auction',
        style: 'realtime',
        variant: w.mode,            // 'open'（せり上げ式）| 'sealed'（秘密入札）
        preset: w.preset || null,
        startChips: w.cfg.startChips
      });
      const rounds = [{
        mode: w.preset || 'auction',
        score_deltas: deltas,
        at: new Date().toISOString(),
        detail
      }];
      saveMatchRecord(room, names, rounds, finalScores);
    } catch (e) {
      console.warn('[realtime] 対戦履歴の保存に失敗しました:', e.message);
    }
  }

  // 第30弾：クイズ王。4ゲームとも「順位と得点」という同じ形で終わるので、
  // 記録の作り方も1つで足りる。どのゲームだったかは detail.game に残す
  function recordQuizMatch(room) {
    if (!db || !room.ownerUserId || !room.quiz) return;
    try {
      const w = room.quiz;
      const view = QuizRoom.resultView(room);
      const names = w.playerIds.map((id) => w.names[id]);
      const deltas = {}, finalScores = {};
      view.ranking.forEach((row) => {
        deltas[row.name] = row.score;
        finalScores[row.name] = row.score;
      });
      const detail = Object.assign({}, view, {
        game: w.variant,
        style: 'realtime',
        preset: w.preset || null,
        timerSec: w.cfg.timerSec
      });
      const rounds = [{
        mode: w.preset || w.variant,
        score_deltas: deltas,
        at: new Date().toISOString(),
        detail
      }];
      saveMatchRecord(room, names, rounds, finalScores);
    } catch (e) {
      console.warn('[realtime] 対戦履歴の保存に失敗しました:', e.message);
    }
  }

  // 第27弾-3：実物解除。協力プレイなので、成功したら全員に同じ点を入れる。
  // 誰が解除役でマニュアル役だったかは、あとから見返した時に効くので残す
  function recordDefuseMatch(room) {
    if (!db || !room.ownerUserId || !room.defuse) return;
    try {
      const w = room.defuse;
      if (!w.modules.length) return; // 始まる前に畳まれた試合は記録しない
      const view = DefuseRoom.resultView(room);
      const names = w.playerIds.map((id) => w.names[id]);
      const deltas = {}, finalScores = {};
      w.playerIds.forEach((id) => {
        const pts = view.success ? 1 : 0;
        deltas[w.names[id]] = pts;
        finalScores[w.names[id]] = pts;
      });
      const detail = {
        game: 'defuse',
        style: 'realtime',
        variant: w.mode,               // 'normal' | 'focus'（集中解除）
        withManual: !!w.manual,
        preset: w.preset || null,
        modules: view.modules.map((m) => ({ name: m.name, solved: m.solved })),
        solved: view.solved,
        total: view.total,
        strikesMax: w.strikesMax,
        strikesLeft: w.strikesLeft,
        timerSec: w.timerSec,
        elapsedSec: view.elapsedSec,
        success: view.success,
        cause: view.cause,
        roles: view.roles
      };
      const rounds = [{
        mode: w.preset || 'defuse',
        score_deltas: deltas,
        at: new Date().toISOString(),
        detail
      }];
      saveMatchRecord(room, names, rounds, finalScores);
    } catch (e) {
      console.warn('[realtime] 対戦履歴の保存に失敗しました:', e.message);
    }
  }

  /**
   * 第27弾：ゲームを始める時にドライバーへ渡す入り口。
   * ここに載せるのは「サーバーにしかできないこと」だけ:
   *   describe … AIに説明文を作らせる（端末に見せずに作るため）
   *   notify   … 途中の進み具合を部屋の全員へ流す
   * 人狼・ワードウルフは受け取っても使わない（引数を無視するだけ）。
   */
  function driverContext() {
    return {
      describe: describe,
      notify: (room) => pushWolfState(room)
    };
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
      saveMatchRecord(room, g.players.map((p) => p.name), rounds, finalScores);
    } catch (e) {
      // 記録に失敗しても、遊んでいる人の進行は止めない
      console.warn('[realtime] 対戦履歴の保存に失敗しました:', e.message);
    }
  }

  // 第24弾：1人1台のワードウルフも同じ形で記録に残す。
  // 手渡し方式の logRound('wordwolf' / 'wordwolf-multi') と揃えて、
  // あとから記録画面でどちらの遊び方だったか見分けられるようにする。
  function recordWordwolfMatch(room) {
    if (!db || !room.ownerUserId || !room.wordwolf) return;
    try {
      const w = room.wordwolf;
      const names = w.playerIds.map((id) => w.names[id]);
      const deltas = {}, finalScores = {};
      w.playerIds.forEach((id) => {
        const pts = w.scores[id] || 0;
        deltas[w.names[id]] = pts;
        finalScores[w.names[id]] = pts;
      });
      const detail = {
        game: 'wordwolf',
        style: 'realtime',
        variant: w.multiTurn ? (w.changeTopic ? 'newTopic' : 'sameTopic') : 'single',
        preset: w.preset || null,
        turnLimit: w.turnLimit,
        turnsPlayed: w.turn,
        wolfCount: w.wolfIds.length,
        winner: w.winner,
        topics: { majority: w.majorityTopic, minority: w.minorityTopic },
        players: w.playerIds.map((id) => ({
          name: w.names[id],
          wolf: w.wolfIds.indexOf(id) !== -1,
          role: w.roles[id] || null
        }))
      };
      const rounds = [{
        mode: w.preset || (w.multiTurn ? 'wordwolf-multi' : 'wordwolf'),
        score_deltas: deltas,
        at: new Date().toISOString(),
        detail
      }];
      saveMatchRecord(room, names, rounds, finalScores);
    } catch (e) {
      console.warn('[realtime] 対戦履歴の保存に失敗しました:', e.message);
    }
  }

  // 第27弾：1人1台の爆弾解除（クイズ解除）も同じ形で記録に残す。
  // 手渡し方式の logRound('bomb') と揃えて、あとから遊び方を見分けられるようにする。
  //   通常版は協力プレイなので、成功したら全員に同じ点を入れる（手渡しと同じ +1点）。
  //   競争版は順位が出るので、解けた本数をそのまま点にする。
  function recordBombMatch(room) {
    if (!db || !room.ownerUserId || !room.bomb) return;
    try {
      const w = room.bomb;
      if (w.result && w.result.aborted) return; // 始まらなかった試合は記録しない
      const view = BombRoom.resultView(room);
      const names = w.playerIds.map((id) => w.names[id]);
      const deltas = {}, finalScores = {};
      if (w.mode === 'coop') {
        w.playerIds.forEach((id) => {
          const pts = view.success ? 1 : 0;
          deltas[w.names[id]] = pts;
          finalScores[w.names[id]] = pts;
        });
      } else {
        (view.ranking || []).forEach((row) => {
          // ライフを0にした人は「記録なし・最下位扱い」なので0点にする
          const pts = row.failed ? 0 : row.solved;
          deltas[row.name] = pts;
          finalScores[row.name] = pts;
        });
      }
      const detail = {
        game: 'bomb',
        style: 'realtime',
        variant: w.mode,                    // 'coop'（通常版・全員スマホ）| 'race'（競争版）
        preset: w.preset || null,
        endWhen: w.mode === 'race' ? w.endWhen : null,
        codes: w.wires.length,
        livesMax: w.lives,
        timerSec: w.timerSec,
        elapsedSec: view.elapsedSec,
        success: (w.mode === 'coop') ? !!view.success : null,
        cause: view.cause || null,
        ranking: (view.ranking || []).map((r) => ({
          name: r.name, rank: r.rank, solved: r.solved,
          misses: r.misses, failed: !!r.failed, timedOut: !!r.timedOut
        }))
      };
      const rounds = [{
        mode: w.preset || 'bomb',
        score_deltas: deltas,
        at: new Date().toISOString(),
        detail
      }];
      saveMatchRecord(room, names, rounds, finalScores);
    } catch (e) {
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

  /**
   * 誰かが居なくなった（切断・退室・kick）あとの共通処理。
   * 残っている人だけで全員済みになっていれば、ここで先へ進める。
   * 第21弾で切断にだけ入れていた数え直しを、第35弾Bで退室・kickにも通す
   * （退室では数え直しておらず、最後の待ち相手が抜けると全員が待ちっぱなしだった。
   *  時間制限の無い段階では無期限に止まる。実機報告のバグ）。
   */
  function settleAfterMemberGone(room) {
    const dr = driverOf(room);
    if (dr && dr.isAllDone(room)) {
      dr.advance(room);
      pushWolfState(room);
      return true;
    }
    broadcast(room);
    return false;
  }

  function markDisconnected(member, room) {
    if (!member.connected) return;
    member.connected = false;
    member.socketId = null;
    const changed = ensureHost(room, 'disconnect');
    if (!connectedMembers(room).length) room.emptySince = Date.now();
    // 第21弾：切れた人は待たない。数え直さないと、最後の1人が切れた時に止まったままになる
    settleAfterMemberGone(room);
    return changed;
  }

  /**
   * 第27弾-1：部屋ごとの見回り。1つの部屋で例外が飛んでも、
   * 他の部屋とサーバー本体は巻き添えにしない。
   *
   * setInterval の中で投げた例外は誰も受け取らないので、Node はプロセスごと終了する。
   * そうなるとメモリ上の部屋が「全部」消え、遊んでいる全員が同時に切断される
   * （実機で起きた症状と一致する）。あるゲームの取りこぼしが、
   * 別のゲームを遊んでいる部屋まで巻き込むのは、どう考えても割に合わない。
   */
  function eachRoom(label, fn) {
    for (const [code, room] of store.rooms) {
      try { fn(room, code); }
      catch (e) { console.error('[realtime] ' + label + '（部屋 ' + code + '）で例外:', e); }
    }
  }

  // ---- ハートビート ----
  // socket.io 自身の ping/pong とは別に、アプリ側でも疎通を確認する。
  // 「接続は張られているが応答が返らない」端末を切断扱いにするため。
  const timers = [];
  timers.push(setInterval(() => {
    const now = Date.now();
    eachRoom('ハートビート送信', (room) => {
      for (const m of room.members.values()) {
        if (!m.connected) continue;
        const s = socketOf(m.id, room);
        if (s) s.emit('hb:ping', { at: now });
      }
    });
  }, HEARTBEAT_INTERVAL_MS));

  timers.push(setInterval(() => {
    const now = Date.now();
    eachRoom('切断の見回り', (room, code) => {
      for (const m of room.members.values()) {
        if (!m.connected) continue;
        if (now - m.lastSeen > HEARTBEAT_TIMEOUT_MS) markDisconnected(m, room);
      }
      // 誰も繋がっていない状態が続いた部屋は片付ける（メモリを永久に食わないように）。
      // サーバーはpushするまで動き続けるので、ここが無いと遊び終わった部屋が溜まり続ける。
      // 保険として、emptySince の付け忘れがあってもここで拾い直す。
      if (!connectedMembers(room).length && !room.emptySince) room.emptySince = now;
      if (room.emptySince && now - room.emptySince > emptyRoomTtlMs) store.delete(code);
      // 第32弾-E 第6部：アルバムは一定時間さわられなければ自動で消す。
      // ホストが操作せずに部屋を閉じた場合に、写真がサーバーに残り続けない保険
      if (room.album && now - room.album.updatedAt > albumTtlMs) {
        delete room.album;
        io.to('room:' + room.code).emit('album:update', albumStatus(room));
      }
    });
  }, sweepIntervalMs));

  // 第21弾-7：制限時間で締める。全員そろわなくても先へ進めるようにする
  // （夜の持ち時間・作戦会議・話し合い。どのゲームでも deadline の扱いは同じ）
  timers.push(setInterval(() => {
    const now = Date.now();
    eachRoom('時間切れの見回り', (room) => {
      const dr = driverOf(room);
      const w = driverStateOf(room);
      if (!dr || !w || !w.deadline || now < w.deadline) return;
      dr.advance(room);
      pushWolfState(room);
    });
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

    // ---- 第32弾-A-3-2：入る前に、その部屋を軽く覗く ----
    // 「部屋に入る」画面で、何のゲームの部屋なのかを先に出すため。
    // コードを当てずっぽうで入れた人に名簿まで見せる必要は無いので、
    // 返すのは「あるかどうか・何のゲームか・何人いるか・始まっているか」だけにする。
    socket.on('room:peek', (payload, cb) => {
      if (typeof cb !== 'function') return;
      const room = store.get(payload && payload.code);
      if (!room) return cb({ ok: false, error: 'room_not_found' });
      const res = {
        ok: true,
        code: room.code,
        game: (room.state && room.state.game) || null,
        phase: (room.state && room.state.phase) || 'lobby',
        playerCount: playerMembers(room).length
      };
      // 第35弾A：「部屋」ボタンの在室判定用。memberId を添えて覗くと、
      // 部屋があるかどうかに加えて「自分がまだ名簿にいるか」も返す。
      // 在室判定は端末の記憶ではなく、必ずこの返事で決める（サーバーが権威）
      if (payload && payload.memberId) res.you = room.members.has(payload.memberId);
      cb(res);
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
      // 第24弾-3：memberId を持っていない入り直し（ページを読み込み直した、
      // 一度出てからコードを入れ直した、など）でも、同じ名前の人が2人に増えないようにする。
      // 切れている同名の枠があれば、それをそのまま引き継ぐ。
      // つながったままの同名は「別人が同じ名前で入ってきた」なので、増やす方が正しい。
      if (!member) {
        member = Array.from(room.members.values()).find(
          (m) => !m.connected && m.name === name
        ) || null;
      }
      if (member) {
        member.name = name;
        if (payload && payload.role) member.role = normalizeRole(payload.role);
      } else {
        // 新しい枠が要る時だけ満員を見る（既存メンバーの復帰は満員でも締め出さない）。
        // 数えるのは「接続中のプレイヤー」＝いま同時に遊ぶ人数。名簿の枠数（切断中含む）で
        // 数えると、入れ替わりの切断枠が溜まった部屋で実人数が少なくても新規が弾かれる
        // （実機報告「QRが使えない」の真因・8/18修正）。
        // なお切断→新規→復帰の順で一時的に21人接続になり得るが、稀で自己制限的
        // （22人目の新規はここで止まる）なので許容する
        const liveCount = playerMembers(room).filter((m) => m.connected).length;
        if (liveCount >= ROOM_MAX_PLAYERS) {
          return fail(cb, 'room_full', '満員です（20人まで）');
        }
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
      refreshPairNote(room);    // 第32弾-E 第1部：顔ぶれが変わったら一言を作り直す

      if (typeof cb === 'function') {
        cb({ ok: true, code: room.code, memberId: member.id, room: publicSnapshot(room) });
      }
      broadcast(room);
      // 第21弾：画面ロックなどで一度切れた人が戻ってきた時、
      // 自分の役職と今の局面をすぐ受け取れるようにする。
      // これが無いと、戻ってきても画面が止まったままになる。
      const rejoinDriver = driverOf(room);
      if (rejoinDriver) {
        const mine = rejoinDriver.privateFor(room, member.id);
        if (mine) emitPrivate(room, member.id, 'wolf:you', mine);
      }
    });

    // ---- 第2部-3：役割の変更（自動判定はあくまで初期値。最後は本人が選ぶ） ----
    socket.on('room:setRole', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      // 第32弾-E 第3部：ホストは、待機画面から他の人の表示モードも切り替えられる。
      // memberId を付けなければ今まで通り自分（既存の呼び出しに影響しない）
      let target = me;
      const targetId = payload && payload.memberId;
      if (targetId && targetId !== me.id) {
        if (room.hostMemberId !== me.id) return fail(cb, 'not_host', '進行役だけが操作できます');
        target = room.members.get(targetId);
        if (!target) return fail(cb, 'member_not_found', 'その人は部屋にいません');
      }
      target.role = normalizeRole(payload && payload.role);
      if (typeof cb === 'function') cb({ ok: true, role: target.role, room: publicSnapshot(room) });
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
      // 第26弾-3：ゲームが変わった時と、明示的にやり直す時は前の進行を捨てる。
      // 同じゲームをもう一度遊ぶ時は game が変わらないので reset を見る
      const gameChanged = (p.game !== undefined && p.game !== room.state.game);
      if (gameChanged || p.reset) clearGameState(room);
      if (typeof p.phase === 'string') room.state.phase = p.phase;
      if (p.game !== undefined) room.state.game = p.game;
      if (p.data && typeof p.data === 'object') {
        room.state.data = Object.assign({}, room.state.data, p.data);
      }
      if (typeof cb === 'function') cb({ ok: true, room: publicSnapshot(room) });
      broadcast(room);
    });

    // ---- 第21弾 第7部：1人1台の進行（第24弾でワードウルフにも対応） ----
    // 進行・役職判定・勝敗判定はすべてサーバー側の進行役が持つ。
    //   人狼         … wolf-room.js     → wolf-logic.js
    //   ワードウルフ … wordwolf-room.js → wordwolf-logic.js（集計は wolf-logic）
    // 端末は「自分の情報を受け取って表示し、操作を送る」だけ。
    // イベント名は wolf: のままだが、中身は「その部屋のゲーム」に届く。
    socket.on('wolf:start', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', 'ホストだけが始められます');
      if (driverOf(room)) return fail(cb, 'already_started', 'もう始まっています');

      const gameId = (payload && payload.game) || 'wolfrole';
      const entry = GAME_DRIVERS[gameId];
      if (!entry) return fail(cb, 'unknown_game', 'そのゲームには対応していません');
      const res = entry.driver.startGame(room, payload || {}, driverContext());
      if (!res.ok) return fail(cb, res.error, res.message);
      if (typeof cb === 'function') cb({ ok: true, room: publicSnapshot(room) });
      // 第34弾 2-1：始まる合図。全員の端末に同じ放送が届いた瞬間から
      // 3-2-1を数えるので、そろって見える（ゲームの状態はその下に描かれて待つ）
      io.to('room:' + room.code).emit('room:countdown', { seconds: 3 });
      pushWolfState(room);
    });

    // 役職・お題の確認、夜の行動、投票の直前の行動。
    // targetId が無ければ「確認しただけ」。行動が無い人も必ずここを通るので、
    // 外からは誰が能力持ちか分からない。
    socket.on('wolf:act', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      const dr = room && driverOf(room);
      if (!room || !me || !dr) return fail(cb, 'not_in_room', '部屋に入っていません');
      // 第27弾-3：4つめの引数は payload まるごと。
      // 実物解除は「傾き何度」「何回振った」のように、targetId 1つでは足りない操作がある。
      // 人狼・ワードウルフ・爆弾解除は受け取っても使わない（無視するだけ）。
      const res = dr.submitAction(room, me.id, (payload && payload.targetId) || null, payload);
      if (!res.ok) return fail(cb, res.error, '今はその操作ができません');
      if (typeof cb === 'function') cb({ ok: true });
      if (res.allDone) dr.advance(room);
      pushWolfState(room);
    });

    socket.on('wolf:vote', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      const dr = room && driverOf(room);
      if (!room || !me || !dr) return fail(cb, 'not_in_room', '部屋に入っていません');
      const res = dr.submitVote(room, me.id, (payload && payload.targetId) || null, payload);
      if (!res.ok) return fail(cb, res.error, '今は投票できません');
      // 第27弾-3：実物解除は「いま当たったか外れたか」をその場で返す
      // （画面が音と演出をすぐ出せるように）。他のゲームは ok だけ見ている
      if (typeof cb === 'function') cb({ ok: true, solved: !!res.solved, miss: !!res.miss, note: res.note || null });
      if (res.allDone) dr.advance(room);
      pushWolfState(room);
    });

    // 作戦会議・話し合いを終える、結果を見終わる、はホストが進める
    socket.on('wolf:next', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      const dr = room && driverOf(room);
      if (!room || !me || !dr) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', 'ホストだけが進められます');
      dr.advance(room);
      if (typeof cb === 'function') cb({ ok: true });
      pushWolfState(room);
    });

    // ---- 第24弾-3-5：ホストが終了したら、部屋ごと終わらせる ----
    // ホストの端末だけ終了して、他の人が置き去りになっていた。
    // 部屋にいる全員に伝えてから部屋を畳む。
    socket.on('room:close', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', 'ホストだけが終了できます');
      io.to('room:' + room.code).emit('room:closed', { by: me.name });
      store.delete(room.code);
      if (typeof cb === 'function') cb({ ok: true });
    });

    // ---- 第32弾-B-1：メンバー管理。進行役が、その人を部屋から出す ----
    // 出された人には理由を伝えて、黙って画面が固まらないようにする。
    // 自分は出せない（進行役がいなくなると、誰も進められなくなる）。
    socket.on('room:kick', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', '進行役だけが操作できます');
      const targetId = payload && payload.memberId;
      const target = targetId ? room.members.get(targetId) : null;
      if (!target) return fail(cb, 'member_not_found', 'その人は部屋にいません');
      if (target.id === me.id) return fail(cb, 'cannot_kick_self', '自分は出せません');

      const s = socketOf(target.id, room);
      room.members.delete(target.id);
      if (s) {
        s.emit('room:kicked', { by: me.name });
        s.leave('room:' + room.code);
        s.data.roomCode = null;
        s.data.memberId = null;
      }
      // 第35弾B：出されたことを残った人に言葉で伝える（出された本人には room:kicked が届く）
      io.to('room:' + room.code).emit('room:memberGone', { name: target.name, reason: 'kick' });
      ensureHost(room, 'kick');
      if (!connectedMembers(room).length) room.emptySince = Date.now();
      if (typeof cb === 'function') cb({ ok: true, room: publicSnapshot(room) });
      // 出した人が最後の待ち相手だったら、残った人の待ちをここで解く（第35弾B）
      settleAfterMemberGone(room);
    });

    socket.on('room:leave', (payload, cb) => {
      let room = currentRoom();
      let me = currentMember();
      // 第35弾A：スリープ復帰などでsocketがつなぎ直ると、socket.data の部屋の印は空になる。
      // その状態で「部屋を出る」と、今までは ok と返すのに名簿から消えない嘘の応答だった。
      // 端末が覚えている code+memberId で本人の枠を確かめて出す。
      // memberId は推測できない乱数で、room:join の入り直しと同じ信頼モデル。
      if ((!room || !me) && payload && payload.code && payload.memberId) {
        const r2 = store.get(payload.code);
        const m2 = r2 ? r2.members.get(payload.memberId) : null;
        if (r2 && m2) { room = r2; me = m2; }
      }
      if (room && me) {
        room.members.delete(me.id);
        socket.leave('room:' + room.code);
        // 第35弾B：抜けたことを残った人に言葉で伝える（理由つき。kickと文言を分けるため）。
        // socket.leave の後に放送するので、抜けた本人には届かない
        io.to('room:' + room.code).emit('room:memberGone', { name: me.name, reason: 'leave' });
        ensureHost(room, 'leave');
        if (!connectedMembers(room).length) room.emptySince = Date.now();
        // 抜けた人が最後の待ち相手だったら、残った人の待ちをここで解く（第35弾B）
        settleAfterMemberGone(room);
      }
      socket.data.roomCode = null;
      socket.data.memberId = null;
      if (typeof cb === 'function') cb({ ok: true });
    });

    // ---- 第32弾-E 第4部：リアクション ----
    // ゲームの進行に一切関係しない、一瞬の絵文字。サーバーは状態を持たず撒くだけ。
    // 連打で全員の画面が埋まらないよう、1人あたり0.5秒に1回まで
    socket.on('room:react', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      const emoji = String((payload && payload.emoji) || '');
      if (REACTION_EMOJI.indexOf(emoji) === -1) {
        return fail(cb, 'unknown_emoji', 'その絵文字は使えません');
      }
      const now = Date.now();
      if (me.lastReactAt && now - me.lastReactAt < 500) {
        if (typeof cb === 'function') cb({ ok: true, throttled: true });
        return;
      }
      me.lastReactAt = now;
      io.to('room:' + room.code).emit('room:reacted', { name: me.name, emoji });
      if (typeof cb === 'function') cb({ ok: true });
    });

    // ---- 第32弾-E 第5部：感謝を贈る ----
    // 勝敗と関係のない項目で、誰か1人に一言。届くのは本人にだけ（見せびらかさない）
    socket.on('room:thanks', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      const kind = THANKS_KINDS[payload && payload.kind] ? payload.kind : null;
      if (!kind) return fail(cb, 'unknown_kind', 'その項目はありません');
      const target = room.members.get(payload && payload.memberId);
      if (!target) return fail(cb, 'member_not_found', 'その人は部屋にいません');
      if (target.id === me.id) return fail(cb, 'cannot_thank_self', '自分には贈れません');
      emitPrivate(room, target.id, 'room:thanked', {
        from: me.name, kind, label: THANKS_KINDS[kind]
      });
      if (typeof cb === 'function') cb({ ok: true, toName: target.name });
    });

    // ---- 第32弾-E 第6部：アルバム ----
    // 写真は一番デリケートなデータ。約束：
    //   ・入れるのは本人の操作だけ（同意の確認は端末側で必ず挟む）
    //   ・サーバーはまとめて渡すまでの一時置き場。AIには一切渡さない
    //   ・ホストが「保存しました」と言うか、1時間さわられなければ消す
    socket.on('album:add', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      const photo = String((payload && payload.photo) || '');
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo)) {
        return fail(cb, 'bad_photo', '写真の形式が読めません');
      }
      if (photo.length > 1.6 * 1024 * 1024) {
        return fail(cb, 'too_large', '写真が大きすぎます（端末側で縮小してから送ってください）');
      }
      room.album = room.album || { photos: new Map(), updatedAt: Date.now() };
      room.album.photos.set(me.id, { name: me.name, photo, at: Date.now() });
      room.album.updatedAt = Date.now();
      io.to('room:' + room.code).emit('album:update', albumStatus(room));
      if (typeof cb === 'function') cb({ ok: true, count: room.album.photos.size });
    });
    // 参加をやめる（自分の写真を箱から出す）
    socket.on('album:remove', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.album) {
        room.album.photos.delete(me.id);
        room.album.updatedAt = Date.now();
        if (!room.album.photos.size) delete room.album;
      }
      io.to('room:' + room.code).emit('album:update', albumStatus(room));
      if (typeof cb === 'function') cb({ ok: true });
    });
    // ホストがアルバムを受け取る。写真が全部入った自己完結の1枚（HTML）を渡す。
    // ここでは消さない。「受け取り始めた＝保存できた」ではないため。
    // 消すのは、ホストが「保存しました」を押した時（album:done）か、1時間の自動削除
    socket.on('album:get', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', '進行役だけが受け取れます');
      const html = buildAlbumHtml(room);
      if (!html) return fail(cb, 'no_album', 'アルバムに写真がありません');
      if (typeof cb === 'function') cb({ ok: true, html, count: room.album.photos.size });
    });
    // ホストが保存を終えた（またはやめた）。ここで初めてサーバーから消す
    socket.on('album:done', (payload, cb) => {
      const room = currentRoom();
      const me = currentMember();
      if (!room || !me) return fail(cb, 'not_in_room', '部屋に入っていません');
      if (room.hostMemberId !== me.id) return fail(cb, 'not_host', '進行役だけが操作できます');
      delete room.album;
      // 消したことは、はっきり全員に伝える
      io.to('room:' + room.code).emit('album:update', Object.assign(albumStatus(room), { cleared: true }));
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
  ROOM_MAX_PLAYERS,
  // 第35弾：監査の正本（tests/inventory.js）がゲーム一覧を自動導出するために公開。
  // 手書きの一覧は登録漏れの温床になる（落とし穴4）ので、必ずここから引く
  GAME_DRIVERS,
  // 第32弾-E：アルバムのHTML生成（server.js の受け渡しルートが使う）と、
  // リアクション絵文字の一覧（端末側と食い違っていないかテストが見張る）
  buildAlbumHtml,
  albumStatus,
  REACTION_EMOJI,
  THANKS_KINDS,
  randomCode,
  CODE_ALPHABET,
  CODE_LENGTH,
  ROLE_PLAYER,
  ROLE_BIGSCREEN,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS
};
