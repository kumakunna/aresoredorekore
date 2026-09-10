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
let 部屋コード = CODE;

/** 1人つなぐ。入れたら解決する */
function つなぐ(name, i) {
  return new Promise((resolve) => {
    const sock = io(URL, { transports: ['websocket', 'polling'] });
    const bot = { name, sock, memberId: null, ready: false, 大画面: false };
    bots.push(bot);

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
    sock.on('room:update', (p) => {
      const room = (p && p.room) || p;
      const game = room && room.state && room.state.game;
      if (READY && game && !bot.ready) {
        bot.ready = true;
        sock.emit('room:ready', { ready: true, game }, () => {
          console.log('[' + name + '] 準備OK（' + game + '）');
        });
      }
      if (!game) bot.ready = false;   // えらび直したら、また押せるようにする
    });
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
