// tools/bot-play/wordwolf.js — bot がワードウルフ（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// 段階ごとにやることは3つだけ（wordwolf-room.js の expectedMembers が待つ段階）：
//   reveal  … お題を読んで「確認しました」（占い師なら、生きている誰かを1人占う）
//   preVote … のぞき見・まきこみ役なら誰かを1人選ぶ。ほかは「確認しました」
//   vote    … 自分以外から1人に投票（決選なら候補から）。**えらび方はくじ**——
//             bot は話し合いを聞けないので、人がする「怪しい人に入れる」を真似できない。
//             偏らせると結果が台本で決まってしまう（同数→決選投票の道も、実際に起きうるまま残す）
// 作戦会議・話し合い・結果は進行役が進める段階なので、bot は何もしない。
//
// **人が考える間を置く**（お題を読む 3〜5秒、投票 4〜7秒）。即答にすると、
// 人の役がお題を読む前に bot だけ「確認しました」が済み、待ちの画面（まだの人：…）が撮れない。
//
// **同じ段階で二度送らない。**部屋の知らせと本人の秘密は順番の保証が無い（落とし穴18）ので、
// 「段階が変わった回数」を bot が自分で数え、その回ごとに1度だけ送る。
// 投票→結果→投票（複数ウルフ）や、投票→決選投票（段階の名前は同じ vote）も別の回として数える。

module.exports = function 遊ぶ(bot, s) {
  // **脈に答える。**サーバーは10秒ごとに hb:ping を送り、25秒答えない人を「切れた」にする
  // （realtime.js の HEARTBEAT_TIMEOUT_MS）。本物の端末は rt-client.js が答えているが、
  // tools/room-bots.js は答えないので、bot は入って30秒ほどで切断扱いになり、
  // ワードウルフは**切れた人を待たない**（expectedMembers）——bot の確認も投票も
  // not_expected で弾かれ、人の役と進行役の2票だけで決着してしまう（1回目の試走で実際に起きた）。
  // ここで答えるのは、本物の端末と同じふるまいに揃えるため
  if (bot.sock && !bot.脈) { bot.脈 = true; bot.sock.on('hb:ping', () => bot.sock.emit('hb:pong')); }
  const 自分 = ((s.room && s.room.members) || []).find((m) => m.id === s.me);
  if (自分 && 自分.connected === false && !bot.切れ報告) { bot.切れ報告 = true; s.log('サーバーで切断扱いになっている（この後の操作は not_expected で弾かれる）'); }
  const v = s.view || {};
  const mine = s.mine;
  // **「もう一度」のあとの準備OK。**room-bots.js の --ready は、部屋のゲームが null に戻った時だけ
  // 押し直せる形（bot.ready）。「つぎは？→もう一度」はゲームを wordwolf のまま待合へ戻すので、
  // bot は2回目の準備OKを一度も押さず、2回目が始まらなかった（2回目の試走で実際に止まった）。
  // サーバーが「この人は準備OKではない」と言っていて、room-bots は押したつもりでいる時だけ、
  // 人がルールを読み直す間（2〜4秒）を置いて押し直す
  // 1回目は room-bots が押す（押した直後の知らせではまだ ready:false なので、ここで押すと二重になる）。
  // だから**一度決着を見たあと**だけ押し直す
  const 遊んでいる = ['reveal', 'meeting', 'discuss', 'preVote', 'vote', 'roundResult', 'ended'].indexOf(v.phase) !== -1;
  if (v.phase === 'ended') bot.決着を見た = true;
  if (自分 && !自分.ready && bot.ready && bot.決着を見た && !遊んでいる && s.room.state && s.room.state.game && !bot.準備中) {
    bot.準備中 = true;
    const game = s.room.state.game;
    s.later(2000 + Math.random() * 2000, () => s.emit('room:ready', { ready: true, game }, (r) => {
      bot.準備中 = false;
      s.log('準備OK（押し直し・' + game + '）（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
    }));
  }
  const pk = (v.phase || '') + (v.runoff ? ':決選' : '') + ':' + (v.turn || 0);
  if (pk !== bot.ww前) { bot.ww前 = pk; bot.ww回 = (bot.ww回 || 0) + 1; }
  if (['reveal', 'preVote', 'vote'].indexOf(v.phase) === -1) return;
  // 秘密が部屋の段階に追いつくまで何もしない（落とし穴18）
  if (!mine || mine.phase !== v.phase || mine.done) return;
  if (v.phase !== 'reveal' && mine.out) return;
  if (bot.考え中) return;
  if (!s.once('ww:' + bot.ww回)) return;

  const くじ = (a) => a[Math.floor(Math.random() * a.length)];
  const 選べる = (mine.choices || []).filter((c) => c.id !== s.me);
  bot.考え中 = true;
  if (v.phase === 'vote') {
    if (!選べる.length) { bot.考え中 = false; return; }
    const 先 = くじ(選べる);
    s.later(4000 + Math.random() * 3000, () => s.vote({ targetId: 先.id }, (r) => {
      bot.考え中 = false;
      s.log((v.runoff ? '決選投票' : '投票') + '：' + 先.name + '（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
    }));
    return;
  }
  // reveal / preVote：選ぶ役なら1人選ぶ。ほかは「確認しました」（targetId なし）
  const 先 = (mine.action && 選べる.length) ? くじ(選べる) : null;
  s.later(3000 + Math.random() * 2000, () => s.act({ targetId: 先 ? 先.id : null }, (r) => {
    bot.考え中 = false;
    s.log((v.phase === 'reveal' ? 'お題を確認（' + mine.topic + '）' : '投票のまえに') +
      (先 ? '：' + 先.name + ' を選んだ' : '') + '（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
  }));
};
