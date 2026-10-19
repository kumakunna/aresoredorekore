// tools/bot-play/rcard.js — bot がロシアンカード（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// 段階は2つだけ動く（rcard-room.js の PHASE）：
//   place … 相手の9まいから、言われた数（v.bombsPerBoard）をランダムにえらんで しかける
//   turn  … 自分の番（mine.isMyTurn）なら、まだめくっていない1まいをランダムにめくる
// **人が考える間を置く**（しかけるまで 2.5〜5.5秒、めくるまで 2.5〜5.5秒）——
// 即答にすると、人の役が しかけ終わる前に bot が全部終わり、「待つ」画面が撮れない。
// 持ち時間（既定15秒）より短くしてある：時間切れで体力が減るのは bot の都合であって、遊びの形ではない。
//
// **部屋の知らせと秘密の phase がそろうまで何もしない**（落とし穴18）。
// 同じ手番で二度めくらないように「この番はもう動いた」を持つ（下の bot.この番）。

const 全部 = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function いくつかえらぶ(n) {
  const 残り = 全部.slice();
  const 出 = [];
  for (let i = 0; i < n && 残り.length; i++) 出.push(残り.splice(Math.floor(Math.random() * 残り.length), 1)[0]);
  return 出;
}

/**
 * **bot を「席を外した」ことにさせない**（道具の側の穴の手当て。アプリには触らない）。
 *
 * サーバーは socket.io の ping とは別に、アプリの `hb:ping` に `hb:pong` で答えない端末を
 * 25秒で `connected:false` にし、`socketId` を消す（realtime.js markDisconnected）。
 * 本物の端末は rt-client.js:146 が答えるが、tools/room-bots.js は答えない。
 * そうなると **本人の秘密（wolf:you）が届かなくなり**、bot は自分の番が来たことを知れず、
 * 毎回の時間切れで負ける——しかも人の役の画面には「〇〇さんが席を外しました」が出る。
 * 第1回の通しはこれで、bot が一度もめくらずに終わった（記録.json で確かめた）。
 *
 * ここでは①`hb:ping` に答える ②名簿で自分が切れていたら、memberId を添えて入り直す
 * （realtime.js room:join の「同じ端末が入り直した時」の道。人がスマホを開き直すのと同じ）。
 * room-bots.js は共有の道具なので変えない（報告の harness_notes に書く）。
 */
function つなぎとめる(bot, s) {
  if (!bot.sock) return;
  if (!bot.心音) {
    bot.心音 = true;
    bot.sock.on('hb:ping', () => bot.sock.emit('hb:pong'));
  }
  const 私 = ((s.room && s.room.members) || []).find((m) => m.id === s.me);
  if (私 && 私.connected === false && (!bot.入り直した || Date.now() - bot.入り直した > 3000)) {
    bot.入り直した = Date.now();
    bot.sock.emit('room:join', { code: s.room.code, name: bot.name, memberId: bot.memberId, role: 'player' }, (r) => {
      s.log('切れていたので入り直した（' + (r && r.ok ? 'ok' : (r && r.message)) + '）');
    });
  }
}

/**
 * **「もう一度」のあとの準備OKを押し直す**（これも道具の側の穴の手当て）。
 * room-bots.js の --ready は「ゲームが null に戻ったら、また押せるようにする」作りなので、
 * つぎは？→「もう一度」（同じゲームのまま、サーバーは readyGame だけ消す）では押し直さない。
 * 人は2回目のルール画面で「準備OK」を押すので、bot も名簿で自分が未準備なら押す。
 * 試合が動いている間（s.view.phase がある）は押さない（サーバーも already_started で断る）
 */
function 準備OKを押し直す(bot, s) {
  const st = (s.room && s.room.state) || {};
  if (!st.game || (s.view && s.view.phase)) return;
  const 私 = ((s.room && s.room.members) || []).find((m) => m.id === s.me);
  if (!私 || 私.ready !== false || 私.connected === false) return;
  if (bot.押し直した && Date.now() - bot.押し直した < 3000) return;
  bot.押し直した = Date.now();
  s.later(1500 + Math.random() * 1500, () => s.emit('room:ready', { ready: true, game: st.game }, (r) => {
    s.log('準備OKを押し直した（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
  }));
}

module.exports = function 遊ぶ(bot, s) {
  つなぎとめる(bot, s);
  準備OKを押し直す(bot, s);
  const v = s.view, mine = s.mine, me = s.me;
  // **1つの番に1まいだけ。**めくり終わっても、ほかの組がめくるまでは段階が turn のまま・
  // isMyTurn も真のまま（rcard-room.js は手番を「見せる間」のあとでしか入れ替えない）。
  // そこで鍵を「めくった枚数」で作ると、めくった直後に鍵が変わって2まい目をめくってしまう
  // （サーバーも受けてしまう＝報告した不具合。bot がそれを踏むと測りが濁る）。
  // だから「この番はもう動いた」を、turn 以外の段階を見るまで持っておく
  if (!v || v.phase !== 'turn' || (mine && mine.phase === 'turn' && !mine.isMyTurn)) bot.この番 = null;
  if (!v || !mine || !v.phase) return;
  if (mine.phase !== v.phase || mine.round !== v.round) return;   // 秘密が部屋に追いつくまで待つ
  if (mine.out || mine.isBye || !mine.opponentId) return;

  if (v.phase === 'place') {
    if ((v.placed || {})[me]) return;
    if (!s.once('place:' + v.round)) return;
    const n = v.bombsPerBoard || 3;
    s.later(2500 + Math.random() * 3000, () => {
      const cur = bot.room && bot.room.state && bot.room.state.data;
      if (!cur || cur.phase !== 'place' || cur.round !== v.round) return;
      const 位置 = いくつかえらぶ(n);
      s.act({ place: 位置 }, (r) => s.log(v.round + '回目：' + 位置.join(',') + ' にしかけた（' + (r && r.ok ? 'ok' : (r && r.error)) + '）'));
    });
    return;
  }

  if (v.phase === 'turn') {
    if (!mine.isMyTurn || bot.この番) return;
    bot.この番 = '考え中';
    s.later(2500 + Math.random() * 3000, () => {
      const cur = bot.room && bot.room.state && bot.room.state.data;
      if (!cur || cur.phase !== 'turn' || !(bot.mine && bot.mine.isMyTurn && bot.mine.phase === 'turn')) {
        if (bot.この番 === '考え中') bot.この番 = null;   // 番が過ぎていた（時間切れ等）。次の番でまた考える
        return;
      }
      const めくった = (((cur.boards || {})[me]) || { flipped: [] }).flipped;
      const 残り = 全部.filter((x) => めくった.indexOf(x) === -1);
      if (!残り.length) return;
      const no = 残り[Math.floor(Math.random() * 残り.length)];
      bot.この番 = 'めくった';
      s.act({ flip: no }, (r) => s.log(cur.round + '回目：' + no + ' をめくった（' + (r && r.ok ? 'ok' : (r && r.error)) + '）'));
    });
  }
};
