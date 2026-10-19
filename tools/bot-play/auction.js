// tools/bot-play/auction.js — bot が相場オークション（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// **人の手でできることだけをする。**部屋の画面でできるのは
//   ・下見でアイテムを1つ選ぶ（3種のどれか）
//   ・鑑定眼を持っていたら、棚の品を1つ押して鑑定する
//   ・競りで入札する（せり上げ式＝いまの値+1／秘密入札＝金額を1回出す）
//   ・誰も値をつけなかった時に「見送る」
//   ・落札しなかった品の値踏み（上物／並物／偽物）
// だけなので、bot もそれだけにする（半額チケット・相場操作の「使う」は送らない——
// 画面に使う口が無いものを bot だけが使うと、人と bot で遊びが変わる）。
//
// **人らしく考える間を置く**（選ぶまで2.5〜5秒、入札まで2〜4.5秒、値踏みまで1.5〜3.5秒）。
// 品ごとに「ここまでなら出す」上限を決める（35%で見送り、それ以外は1〜6枚）。
// 上限があるので、せり上げ式でも値は必ず止まり、締め切り（入札+14秒）で落ちる。
// 人の役（参加者）は上限8〜9の品を作ってあるので、bot に競り負けない品が必ずある。

const 品質 = ['fine', 'plain', 'fake'];
const アイテム = ['appraise', 'halfticket', 'market'];
const 乱 = (a, b) => a + Math.random() * (b - a);
const 整数 = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

/** いま競っている品の鍵。流れて戻ってきた品は idx が違うので、別の鍵になる */
function 品の鍵(v) { return v.round + ':' + v.idx + ':' + (v.item ? v.item.no : '-'); }

function 上限を決める(bot, 鍵, chips, v) {
  bot.上限 = bot.上限 || {};
  // **最後のラウンドの6品目（と、それが流れて戻ってきた分）は、bot は手を出さない。**
  // 人の役もその品には出さないので、必ず「誰も値をつけない→最後のひと押し→見送る→流れる」を通る。
  // 運に任せると、この道を一度も撮れない回がある（1回目の通しでは12品とも誰かが値をつけた）
  if (v && v.round === v.totalRounds && v.idx >= 5) return 0;
  if (!(鍵 in bot.上限)) bot.上限[鍵] = Math.random() < 0.35 ? 0 : 整数(1, 6);
  return Math.min(bot.上限[鍵], chips || 0);
}

function いまの部屋(bot) { return (bot.room && bot.room.state && bot.room.state.data) || {}; }

module.exports = function 遊ぶ(bot, s) {
  // **心拍に答える。**サーバーは10秒ごとに hb:ping を送り、25秒 hb:pong が無い人を
  // 「席を外した（connected:false）」にする（realtime.js:1072）。tools/room-bots.js は
  // hb:pong を返さないので、bot は入って30秒ほどで切断扱いになり、
  // **本人の秘密（wolf:you）が届かなくなって、下見のあと何もしなくなる**（1回目の通しで実際に起きた）。
  // 本物の端末（rt-client）は答えているので、bot も答える。room-bots.js は共有の道具なのでここに置く
  if (!bot.鼓動) {
    const pong = () => s.emit('hb:pong', {});
    pong();
    bot.鼓動 = setInterval(pong, 8000);
  }
  // **「もう一度」のあとも準備OKを押す。**room-bots.js の --ready は「ゲームidが変わったら押す」形なので、
  // 同じゲームの再戦（ゲームidは auction のまま、サーバーは全員の準備OKを落とす）では押し直さない。
  // そのままだと、人が2人とも準備OKを押しても bot 待ちで2回目が始まらない（1回目の通しで実際に止まった）
  const st = s.room && s.room.state;
  if (st && st.phase === 'lobby' && st.game) {
    const 自分 = (s.room.members || []).find((m) => m.id === s.me);
    if (自分 && !自分.ready && !bot.準備中) {
      bot.準備中 = true;
      s.later(乱(1500, 3000), () => {
        const r2 = bot.room || {};
        const 今の自分 = (r2.members || []).find((m) => m.id === s.me);
        if (!r2.state || r2.state.phase !== 'lobby' || (今の自分 && 今の自分.ready)) { bot.準備中 = false; return; }
        s.emit('room:ready', { ready: true, game: r2.state.game }, (r) => { bot.準備中 = false; s.log('準備OK（もう一度）（' + (r && r.ok ? 'ok' : r && r.error) + '）'); });
      });
    }
    return;
  }
  const v = s.view, mine = s.mine;
  if (!v || !v.phase || !mine) return;
  // 秘密が部屋の段階に追いつくまで何もしない（落とし穴18）
  if (mine.phase !== v.phase || mine.round !== v.round) return;
  if (v.phase === 'ended' || v.phase === 'lobby') return;

  // ---- 下見：アイテムを選ぶ → 鑑定眼なら1品鑑定する ----
  if (v.phase === 'preview') {
    if (!mine.power) {
      if (!s.once('えらぶ:' + v.round)) return;
      const p = アイテム[整数(0, アイテム.length - 1)];
      s.later(乱(2500, 5000), () => s.act({ pick: p }, (r) => s.log('アイテム：' + p + '（' + (r && r.ok ? 'ok' : r && r.error) + '）')));
      return;
    }
    if (mine.power === 'appraise' && !mine.powerUsed) {
      if (!s.once('鑑定:' + v.round)) return;
      const no = 整数(1, (v.lineup || []).length || 6);
      s.later(乱(1500, 3000), () => s.act({ use: true, targetNo: no }, (r) => s.log('鑑定：' + no + '番（' + (r && r.ok ? 'ok' : r && r.error) + '）')));
    }
    return;
  }

  // ---- 競り・最後のひと押し ----
  if (v.phase === 'bid' || v.phase === 'confirm') {
    if (!v.item) return;
    const 鍵 = 品の鍵(v);
    if (v.phase === 'confirm') {
      // 誰も値をつけなかった。bot は見送る
      if (mine.passed || !s.once('見送る:' + 鍵)) return;
      s.later(乱(2000, 4000), () => {
        const v2 = いまの部屋(bot);
        if (v2.phase !== 'confirm' || 品の鍵(v2) !== 鍵) return;
        s.act({ pass: true }, (r) => s.log('見送る（' + (r && r.ok ? 'ok' : r && r.error) + '）'));
      });
      return;
    }
    const 上限 = 上限を決める(bot, 鍵, mine.chips, v);
    if (v.mode === 'open') {
      if (v.highest && v.highest.name === bot.name) return;
      const 今 = v.highest ? v.highest.amount : 0;
      if (今 + 1 > 上限) return;
      if (bot.考え中) return;
      if (!s.once('せる:' + 鍵 + ':' + 今)) return;
      bot.考え中 = true;
      s.later(乱(2000, 4500), () => {
        bot.考え中 = false;
        const v2 = いまの部屋(bot);
        if (v2.phase !== 'bid' || 品の鍵(v2) !== 鍵) return;
        if (v2.highest && v2.highest.name === bot.name) return;
        const 額 = (v2.highest ? v2.highest.amount : 0) + 1;
        if (額 > 上限) return;
        bot.考え中 = true;
        s.vote({ amount: 額 }, (r) => { bot.考え中 = false; s.log('入札 ' + 額 + '枚（' + (r && r.ok ? 'ok' : r && r.error) + '）'); });
      });
      return;
    }
    // 秘密入札：1回だけ出す（0＝降りる）
    if (mine.myBid != null || !s.once('封:' + 鍵)) return;
    s.later(乱(2500, 5000), () => {
      const v2 = いまの部屋(bot);
      if (v2.phase !== 'bid' || 品の鍵(v2) !== 鍵) return;
      s.vote({ amount: 上限 }, (r) => s.log('秘密入札 ' + 上限 + '枚（' + (r && r.ok ? 'ok' : r && r.error) + '）'));
    });
    return;
  }

  // ---- 値踏み（落札しなかった人だけ） ----
  if (v.phase === 'guess') {
    if (mine.canGuess === false || mine.myGuess) return;
    const 鍵 = 品の鍵(v);
    if (!s.once('値踏み:' + 鍵)) return;
    const g = 品質[整数(0, 品質.length - 1)];
    s.later(乱(1500, 3500), () => {
      const v2 = いまの部屋(bot);
      if (v2.phase !== 'guess' || 品の鍵(v2) !== 鍵) return;
      s.vote({ guess: g }, (r) => s.log('値踏み：' + g + '（' + (r && r.ok ? 'ok' : r && r.error) + '）'));
    });
  }
};
