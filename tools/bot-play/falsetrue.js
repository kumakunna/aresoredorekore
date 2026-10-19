// tools/bot-play/falsetrue.js — bot が False or True（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// 段階ごとに、自分の番の時だけ1回押す（同じ段階で二度送らない・s.once）。
//   pick   … 選ぶ人なら、残っているケースから1つを無作為に選ぶ
//   peek   … 持ち主なら、少し間を置いて「みた」
//   talk   … 対面の2人なら、しばらく話したことにして「話し終わった」
//   decide … 相手なら「奪う／奪わない」。FALSE が多い（1:3）ので、素の判断の「奪わない」を多めに（6割）
//
// **人が考える間を置く**（選ぶ 2〜4秒・見る 2.5〜4.5秒・話す 5〜9秒・決める 2.5〜5秒）——
// 即答だと、人の役が何も見ないうちに段階が流れて、導線が撮れない。
// 最初のケース選びだけは 3-2-1 の3秒を足す（数字が出ている間に選ぶ人はいない）。
// 秘密（wolf:you）と部屋の知らせ（room:update）は順不同で届くので（落とし穴18）、
// **秘密の段階と部屋の段階がそろった時だけ**判断する。
//
// ---- 心拍（この台本の中で足したもの） ----
// サーバー（realtime.js:1062）は10秒ごとに `hb:ping` を送り、25秒 `hb:pong` が来ない人を
// connected:false にする（realtime.js:1072）。tools/room-bots.js は pong を返さないので、
// **bot は入って25〜35秒で「切れた人」になる**——切れた人は待たれず（話し合いが片方だけで終わる）、
// 秘密（wolf:you）も届かなくなる（emitPrivate は socketId を見る）ので、bot は何もしなくなり、
// 段階は締め切り（45秒・30秒）まで止まる。本物の端末は pong を返すので、これは道具の穴。
// ここで ① ping に pong を返し、② もう切れた扱いになっていたら memberId つきで入り直す。

function 心拍をつなぐ(bot, s) {
  if (bot.心拍) return;
  bot.心拍 = true;
  bot.sock.on('hb:ping', () => bot.sock.emit('hb:pong'));
  bot.sock.emit('hb:pong');
}

function 切れていたら入り直す(bot, s) {
  const room = s.room || {};
  const me = (room.members || []).find((m) => m.id === s.me);
  if (!me || me.connected !== false) return;
  const 今 = Date.now();
  if (bot.入り直した && 今 - bot.入り直した < 3000) return;
  bot.入り直した = 今;
  s.emit('room:join', { code: room.code, name: bot.name, memberId: s.me, role: 'player' }, (r) => {
    s.log('切れた扱いだったので入り直した（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
  });
}

/**
 * 「もう一度」（同じゲームで再戦）のあと、準備OKを押し直す。
 * room-bots.js の --ready は「ゲームが変わった時」にしか押さない（bot.ready が立ったまま）。
 * 再戦ではゲームが変わらないので、サーバーが準備OKを落としても（realtime.js clearReady）押し直さない。
 * 心拍が切れていた頃は「切れた人は数えない」で始まっていたが、つながったままだと全員がそろうまで始まらない。
 * 人がルールを読み直す間（2〜4秒）を置いて押す
 */
function 再戦なら準備OK(bot, s) {
  const room = s.room || {};
  const st = room.state || {};
  const me = (room.members || []).find((m) => m.id === s.me);
  if (s.view && s.view.phase === 'ended') bot.決着を見た = true;
  if (!bot.決着を見た) return;   // 1試合目は room-bots.js の --ready が押す
  if (!me || me.ready || !st.game || (s.view && s.view.phase)) return;   // 始まっている（phase がある）間は押さない
  const 今 = Date.now();
  if (bot.押し直した && 今 - bot.押し直した < 6000) return;
  bot.押し直した = 今;
  s.later(2000 + Math.random() * 2000, () => s.emit('room:ready', { ready: true, game: st.game }, (r) => {
    s.log('もう一度：準備OK（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
  }));
}

module.exports = function 遊ぶ(bot, s) {
  心拍をつなぐ(bot, s);
  切れていたら入り直す(bot, s);
  再戦なら準備OK(bot, s);
  const v = s.view || {};
  const mine = s.mine;
  if (!mine || !v.phase || mine.phase !== v.phase || mine.round !== v.round) return;
  if (mine.fate || mine.gone) return;   // もう上がった人は何もしない
  const me = s.me;
  const 鍵 = v.phase + ':' + v.round;
  const 間 = (a, b) => a + Math.random() * (b - a);
  const 返事 = (what) => (r) => s.log(what + '（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');

  if (v.phase === 'pick' && v.holderId === me) {
    if (!s.once('pick:' + 鍵)) return;
    const cases = (v.cases || []).slice();
    if (!cases.length) return;
    const no = cases[Math.floor(Math.random() * cases.length)];
    s.later((v.round === 1 ? 3000 : 0) + 間(2000, 4000), () => s.act({ pick: no }, 返事(v.round + '回目：ケース ' + no + ' をえらんだ')));
    return;
  }
  if (v.phase === 'peek' && v.holderId === me) {
    if (!s.once('seen:' + 鍵)) return;
    s.later(間(2500, 4500), () => s.act({ seen: true }, 返事(v.round + '回目：中身をみた（' + (mine.myContent ? 'TRUE' : 'FALSE') + '）')));
    return;
  }
  if (v.phase === 'talk' && (v.holderId === me || v.oppId === me)) {
    if (mine.talkDone || !s.once('talk:' + 鍵)) return;
    s.later(間(5000, 9000), () => s.act({ talkDone: true }, 返事(v.round + '回目：話し終わった')));
    return;
  }
  if (v.phase === 'decide' && v.oppId === me) {
    if (mine.myChoice || !s.once('decide:' + 鍵)) return;
    const 奪う = Math.random() < 0.4;
    s.later(間(2500, 5000), () => s.act(奪う ? { take: true } : { keep: true }, 返事(v.round + '回目：' + (奪う ? '奪う' : '奪わない'))));
  }
};
