#!/usr/bin/env node
// tools/room-bots.js — 実サーバーの部屋に、bot を複数つなぐ（第41弾）
//
// **なぜリポジトリに置くか。**
// 第37弾・第38弾で、同じことをする台本をセッションの中で書いて使い、
// リポジトリに残さなかった。その結果、第41弾の新しいセッションが
// 「実サーバーで複数端末をつなぐ道具が無い」と報告して止まった——**3回目**。
// セッションの中で見つけた道具は、リポジトリに書かないと次のセッションで消える
// （CLAUDE.md 落とし穴29）。
//
// ── 使い方 ────────────────────────────────────────
//   node tools/dev-server.js                       # 検証用サーバー（/dev-login 付き）
//   node tools/room-bots.js --code ABC123 --n 3    # 部屋に3人入れる
//   node tools/room-bots.js --code ABC123 --n 3 --ready   # 入って「準備OK」まで押す
//
//   --code   入る部屋のコード（ブラウザ側で /dev-login → 部屋をつくる で出たもの）
//   --n      入れる人数（既定 2）
//   --ready  ゲームが決まったら「準備OK」を自動で押す
//   --play   **遊ぶ。**進化じゃんけん（shinka）はこの中に、ほかは tools/bot-play/<ゲームid>.js（指示62）。
//            進化じゃんけんは——手を出す段階になったら
//            グー／チョキ／パーをランダムに1つ出す。
//            **これが無いと、bot は「準備OK」までで手を出さないので、**
//            相手も出さず引き分けが続き、**優勝も10分の打ち切りも実サーバーで見られない**
//            （指示55-② の門U9 がそこで止まっていた）。
//            ゲームを足す時は、下の `手を出す` に1本 else if を書く
//   --big    最後の1人を大画面にする
//   --leave  終わる時に「部屋を出る」を送る（既定は切断だけ）。
//            切断は名簿に残るので playerCount は減らない。**減る側を見たい時はこれ**
//   --url    サーバー（既定 http://localhost:3001）
//   --hold   何秒つないだままにするか（既定 600）
//
// **同じ名前で入り直すと、切れている同名の枠を引き継ぐ**（realtime.js の第24弾-3）。
// bot を2回走らせると、2回目は1回目の枠に入るので人数が増えない。
// 増やしたい時は名前がぶつからないように --n を大きくするか、
// 先の bot を --leave で片付けてから走らせる。
// 人数を確かめる時は、画面の数字だけでなく **room:peek の playerCount** と
// 突き合わせる（落とし穴28：測る側が壊れていないかを1つ測る）。
//
// bot は「入って、名簿に載って、準備OKを押す」だけ。
// **ゲームの中身は操作しない**——進行そのものを bot に任せると、
// 何を確かめているのかが分からなくなる。

const io = require('socket.io-client');

// ---- 引数 ----
const argv = process.argv.slice(2);
function opt(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}
const URL = String(opt('url', 'http://localhost:3001'));
const CODE = opt('code', null);
const N = parseInt(opt('n', 2), 10) || 2;
const READY = !!opt('ready', false);
const BIG = !!opt('big', false);
const LEAVE = !!opt('leave', false);
const PLAY = !!opt('play', false);
const HOLD = (parseInt(opt('hold', 600), 10) || 600) * 1000;
const NAMES = ['びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん', 'はな', 'いと', 'うみ', 'えだ'];
// 第42弾 門E6：名簿に出る「その人の姿」。**bot ごとに違う顔にする**——
// 全員同じだと『届いている』のか『1人分が5回出ている』のか見分けが付かない
const LOOKS = [
  { icon: '🌙', title: 'なつまつりの一歩' },
  { icon: '🐺', title: 'しゅんそくの遠吠え' },
  { icon: '🎈', title: 'はくしきの案内人' },
  { icon: '💣', title: 'こだわりの導火線' },
  { icon: '🎊', title: 'なつまつりの主役' }
];

// **部屋を立てるのはログインが要る**（サーバーが弾く）ので、bot はやらない。
// ブラウザ側（/dev-login 済み）で立てて、出たコードをここへ渡す
if (!CODE) {
  console.error('部屋コード（--code）が要ります。ブラウザで部屋を立ててから渡してください');
  process.exit(1);
}

const bots = [];
// 指示62：ゲームごとの遊び方（tools/bot-play/<ゲームid>.js）。無いゲームでは何もしない
const 台本の棚 = {};
function 台本(game) {
  if (game in 台本の棚) return 台本の棚[game];
  let f = null;
  try { f = require(require('path').join(__dirname, 'bot-play', game + '.js')); } catch (e) {
    if (!/Cannot find module/.test(String(e && e.message))) console.log('台本 ' + game + ' を読めません：' + e.message);
  }
  台本の棚[game] = f;
  return f;
}
let 部屋コード = CODE;

/** 1人つなぐ。入れたら解決する */
function つなぐ(name, i) {
  return new Promise((resolve) => {
    const sock = io(URL, { transports: ['websocket', 'polling'] });
    const bot = { name, sock, memberId: null, ready: false, 大画面: false };
    bots.push(bot);

    // 指示62：**心拍に答える。**サーバー（realtime.js）は10秒ごとに hb:ping を送り、
    // 25秒 hb:pong が無い人を connected:false にして socketId を外す（本人の秘密が届かなくなる）。
    // ここで答えていなかったので、bot は入って25〜35秒で「席を外した」人になり、
    // 手元に「びびさんが席を外しました」が出て、待ちの数からも外れていた。
    // メモリに「bot はバックグラウンドで切れる」とあった本当の原因はこれ
    sock.on('hb:ping', () => sock.emit('hb:pong'));
    sock.on('connect', () => {
      sock.emit('room:join', { code: 部屋コード, name, role: 'player', look: LOOKS[i % LOOKS.length] }, (res) => {
        if (!res || !res.ok) {
          console.log('[' + name + '] 入れませんでした：' + ((res && res.message) || '返事なし'));
          resolve(bot);
          return;
        }
        bot.memberId = res.memberId;
        console.log('[' + name + '] 入りました（memberId=' + res.memberId + '）');
        if (BIG && i === N - 1) {
          // 大画面は「役割」ではなく表示モード。サーバー側の入口は room:setRole
          sock.emit('room:setRole', { role: 'bigscreen' }, (r2) => {
            bot.大画面 = !!(r2 && r2.ok);
            console.log('[' + name + '] 大画面' + (bot.大画面 ? 'になりました' : 'にできませんでした'));
          });
        }
        resolve(bot);
      });
    });

    // 部屋の知らせ。**ゲームが決まったら準備OKを押す**（--ready の時だけ）
    //
    // 指示62：**「押したか」は自分で覚えず、部屋の名簿（members[自分].ready）から読む。**
    // それまでは bot.ready を立てて「ゲームが空に戻るまで」押し直さなかったので、
    // 「つぎは？ → もう一度」（同じゲームのまま待合へ戻り、サーバーが全員の準備OKを落とす）で
    // bot だけ押さず、2試合目が始まらなかった（8カセットの台本づくりで4人が踏んだ）。
    // 名簿を正にすれば、待合にいて未準備なら押す、で済む。始まっていれば already_started で弾かれるだけ
    sock.on('room:update', (p) => {
      const room = (p && p.room) || p;
      const st = room && room.state;
      const game = st && st.game;
      if (!READY || !game || bot.準備を送った === game + ':' + (st.phase || '')) return;
      const 自分 = (room.members || []).find((m) => m.id === bot.memberId);
      if (!自分 || 自分.ready || (st.phase && st.phase !== 'lobby')) return;
      bot.準備を送った = game + ':' + (st.phase || '');
      sock.emit('room:ready', { ready: true, game }, (r) => {
        if (r && r.ok) console.log('[' + name + '] 準備OK（' + game + '）');
        bot.準備を送った = null;   // 返事が来たら、次の知らせでまた見直す（名簿が正）
      });
    });
    /**
     * **遊ぶ**（--play）。いまは進化じゃんけんだけ。
     *
     * 芯が呼ぶ形に合わせて `wolf:act` へ送る（realtime.js:1404 の4引数と同じ道）。
     * **同じ段階で二度送らない**——`w.封じた手` があると `already` で弾かれるが、
     * 弾かれること自体は正しいので、こちらで数えて黙らせる。
     */
    sock.on('room:update', (p) => {
      if (!PLAY) return;
      const room = (p && p.room) || p;
      const st = room && room.state;
      if (!st || st.game !== 'shinka') return;
      const v = st.data || {};
      const 鍵 = v.phase + ':' + v.round + ':' + (v.matches || []).filter((m) => !m.done).length;
      if (v.phase !== 'throw') { bot.出した = null; return; }
      if (bot.出した === 鍵) return;
      bot.出した = 鍵;
      const 手 = ['g', 'c', 'p'][Math.floor(Math.random() * 3)];
      送る('wolf:act', { hand: 手 }, (res) => {
        if (res && res.ok) console.log('[' + name + '] ' + 手 + ' を出した（' + v.round + '回戦）');
      });
    });
    /**
     * 指示62：**shinka 以外のゲームも遊ぶ。**台本は tools/bot-play/<ゲームid>.js に1本ずつ置く
     * （ここに else if を積むと、9カセット分がこの1ファイルに混ざる）。
     * 台本は「部屋の知らせ」と「本人の秘密（wolf:you）」の両方で呼ばれる——
     * 届く順番の保証が無いので（落とし穴18）、どちらが来ても今ある材料で判断させる。
     * 同じ段階で二度送らないための `once(鍵)` を渡す
     */
    /**
     * 指示63 第4部：**3-2-1 の最中に送ると not_started で断られる**（芯が止める）。
     * 人は数字の幕で押せないが、bot は盤が届いた瞬間に送るので、断られたまま黙っていた
     *（すごろくの「じゅんびOK」で、全員が bot を待ち続けた）。断られたら、少し待って送り直す
     */
    const 送る = (ev, payload, cb, 残り) => {
      sock.emit(ev, payload || {}, (r) => {
        const あと = 残り == null ? 12 : 残り;
        if (r && r.error === 'not_started' && あと > 0) return setTimeout(() => 送る(ev, payload, cb, あと - 1), 400);
        if (cb) cb(r);
      });
    };
    const 台本を呼ぶ = (from) => {
      if (!PLAY || !bot.room) return;
      const st = bot.room.state;
      if (!st || !st.game || st.game === 'shinka') return;
      const play = 台本(st.game);
      if (!play) return;
      if (!bot.done) bot.done = new Set();
      try {
        play(bot, {
          from, game: st.game, room: bot.room, view: st.data || {}, mine: bot.mine || null, me: bot.memberId,
          once: (k) => { if (bot.done.has(k)) return false; bot.done.add(k); return true; },
          act: (payload, cb) => 送る('wolf:act', payload, cb),
          vote: (payload, cb) => 送る('wolf:vote', payload, cb),
          emit: (ev, payload, cb) => 送る(ev, payload, cb),
          later: (ms, f) => setTimeout(f, ms),
          log: (m) => console.log('[' + name + '] ' + m)
        });
      } catch (e) { console.log('[' + name + '] 台本で失敗：' + (e && e.message)); }
    };
    sock.on('room:update', (p) => { bot.room = (p && p.room) || p; 台本を呼ぶ('room'); });
    sock.on('wolf:you', (mine) => { bot.mine = mine; 台本を呼ぶ('you'); });
    sock.on('room:closed', (p) => {
      console.log('[' + name + '] 部屋が閉じました' + (p && p.by ? '（' + p.by + ' さん）' : ''));
    });
    sock.on('room:kicked', () => console.log('[' + name + '] 部屋から出されました'));
    sock.on('disconnect', () => console.log('[' + name + '] 切れました'));
  });
}

/**
 * 終わり方は2つあり、**サーバーでの扱いが違う**（指示44 G5 で要った）。
 *
 *   ・切断（既定）… socket を閉じるだけ。名簿には `connected:false` で残るので
 *                    `playerCount` は減らない（電波が切れた人も席にはいる）
 *   ・退室（--leave）… `room:leave` を送る。`members.delete` で名簿から消え、
 *                    `playerCount` が減る
 *
 * 「人数が変わった時に画面が追随するか」を見るには**後者が要る**。
 * 切断だけで試すと、減らないのが正しいのに「追随していない」と読んでしまう。
 */
function 終わる() {
  if (!LEAVE) { bots.forEach((b) => b.sock.close()); process.exit(0); return; }
  let 残り = bots.length;
  if (!残り) process.exit(0);
  bots.forEach((b) => {
    b.sock.emit('room:leave', { code: 部屋コード, memberId: b.memberId }, () => {
      console.log('[' + b.name + '] 部屋を出ました');
      b.sock.close();
      if (--残り === 0) process.exit(0);
    });
  });
  // 返事が来ない時でも、いつかは終わる
  setTimeout(() => process.exit(0), 3000);
}

(async function main() {
  console.log('つなぎ先: ' + URL + ' / 部屋: ' + 部屋コード + ' / 人数: ' + N);
  for (let i = 0; i < N; i++) {
    await つなぐ(NAMES[i % NAMES.length] + (i >= NAMES.length ? String(i) : ''), i);
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log('--- ' + bots.filter((b) => b.memberId).length + '人つながりました。'
    + (HOLD / 1000) + '秒つないだままにします（Ctrl+C で終了）---');
  setTimeout(() => { 終わる(); }, HOLD);
})();
