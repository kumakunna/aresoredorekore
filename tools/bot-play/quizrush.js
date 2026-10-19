// tools/bot-play/quizrush.js — bot がクイズラッシュ（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// クイズラッシュは「全員が同時に、自分のペースで」解き続ける。1問ごとに難易度をえらび直す
// （quiz-room.js rushAnswer：正解でも不正解でも s.q = null に戻る）。
//
// **人らしくする所**
//   ・難易度をえらぶまで 1〜2.5秒、問題を読んで答えるまで 2.5〜5.5秒考える。
//     即答にすると、人の役が数問解くあいだに bot だけが何十問も解いてしまい、
//     順位も「他の人待ち」も本物とかけ離れる
//   ・難易度は ふつう が多め、ときどき かんたん／むずかしい（配られた rush.tiers の中から）
//   ・**ときどき外す**（だいたい5問に1問。むずかしいほど外しやすい）。外すと「おてつき」で
//     5秒は次を引けない（quiz-room.js RUSH_MISS_COOLDOWN_MS）——その待ちも人と同じに受ける
//   ・ごくたまにパスする（むずかしい問題の時だけ）
//
// **同じ段階で二度送らない**：部屋の知らせ（room:update）と本人の秘密（wolf:you）の
// どちらでも呼ばれ、届く順番の保証が無い（落とし穴18）。だから
// 「何問目か（answered）・のこりパス」で鍵を作って once で1回にする。

const path = require('path');
const QuizBank = require(path.join(__dirname, '..', '..', 'public', 'js', 'quiz-bank.js'));
const 全問 = [].concat.apply([], Object.keys(QuizBank.QUESTIONS).map((k) => QuizBank.QUESTIONS[k]));

const 外す率 = { easy: 0.1, normal: 0.2, hard: 0.35, nanisore: 0.5, muri: 0.6 };

function 難易度をえらぶ(tiers) {
  const ok = (tiers && tiers.length) ? tiers : ['easy', 'normal', 'hard'];
  const r = Math.random();
  const want = r < 0.25 ? 'easy' : r < 0.8 ? 'normal' : 'hard';
  return ok.indexOf(want) !== -1 ? want : ok[0];
}

/** 難易度を送る。おてつきの待ち中なら、明けるのを待って送り直す（知らせは来ないので自分で数える） */
function 引く(bot, s, tier, 回) {
  s.act({ targetId: tier }, (r) => {
    if (r && r.ok) { bot.考え中 = false; s.log('難易度：' + tier); return; }
    if (r && r.error === 'cooling' && (回 || 0) < 6) {
      s.later(1200, () => 引く(bot, s, tier, (回 || 0) + 1));
      return;
    }
    bot.考え中 = false;
    s.log('難易度をえらべなかった（' + (r && r.error) + '）');
  });
}

module.exports = function 遊ぶ(bot, s) {
  // **心音に返事をする**（本物の端末は rt-client.js:146 で hb:ping に hb:pong を返す）。
  // room-bots.js は返さないので、入って25秒ほどで部屋から「席を外しました」扱いになり、
  // 人の役の画面に「びびさんが席を外しました」が出て、名簿の bot が薄く表示される
  // ——本番の4人では起きないものが写る。ここで初めて呼ばれた時に1度だけ耳をつける
  // （ゲームが決まる前に25秒たつと間に合わない。台本は bot を入れてすぐゲームを選ぶ）
  if (bot.sock && !bot.心音) {
    bot.心音 = true;
    bot.sock.on('hb:ping', () => bot.sock.emit('hb:pong'));
    bot.sock.emit('hb:pong');
  }
  // それでも間に合わずに「切断」扱いになっていたら、同じ memberId で入り直す
  // （realtime.js room:join の「同じ端末が入り直した時は、前のメンバーとして復帰する」）。
  // **切断扱いのままだと、本人の秘密（wolf:you）が届かない**（emitPrivate は socketId を見る）
  // ——1問答えたあと次の状態が来ず、bot が2点で止まっていた（指示62 の1回目の通し）
  const 私 = ((s.room && s.room.members) || []).find((m) => m.id === bot.memberId);
  if (私 && 私.connected === false && !bot.入り直し中 && s.room.code) {
    bot.入り直し中 = true;
    s.emit('room:join', { code: s.room.code, name: bot.name, memberId: bot.memberId, role: 'player' }, (r) => {
      bot.入り直し中 = false;
      s.log('心音が途切れて切断扱いになっていたので、入り直した（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
    });
  }
  // **「もう一度」のあとの準備OK。**room-bots.js の --ready は「ゲームが空になったら押し直す」形で、
  // 同じゲームのまま「もう一度」になると押し直さない（2試合目が 準備できた人 2/4 のまま始まらなかった）。
  // ゲームが決まっていて、まだ始まっておらず、自分が準備OKでなければ、ルールを読む間をおいて押す
  const st = (s.room && s.room.state) || {};
  if (私 && 私.connected !== false && 私.ready === false && st.game && (!s.view.phase || s.view.phase === 'lobby') && !bot.準備中) {
    bot.準備中 = true;
    s.later(2000 + Math.random() * 2000, () => s.emit('room:ready', { ready: true, game: st.game }, (r) => {
      bot.準備中 = false;
      s.log('準備OK（もう一度）：' + (r && r.ok ? 'ok' : (r && r.error)));
    }));
  }
  const mine = s.mine;
  if (!mine || mine.variant !== 'quizrush' || !mine.rush) return;
  // 決着したら、鍵を捨てる——「もう一度」で始まる次の試合も answered=0 から数え直すので、
  // 前の試合の鍵が残っていると、2試合目は1問も解かなくなる
  if (mine.phase !== 'play') { if (mine.phase === 'ended' && bot.done) bot.done.clear(); return; }
  if (bot.考え中) return;
  const me = mine.rush;

  if (me.question) {
    if (!s.once('答え:' + me.answered + ':' + me.passesLeft + ':' + me.question.text)) return;
    const hit = 全問.find((q) => q.q === me.question.text);
    const 正解 = hit ? hit.choices[hit.correct] : null;
    const 正解の位置 = 正解 ? me.question.choices.indexOf(正解) : -1;
    const tier = me.question.tier || me.tier;
    bot.考え中 = true;
    // むずかしい問題で、まだパスが残っていれば、たまにパスする
    if (tier === 'hard' && me.passesLeft > 0 && Math.random() < 0.15) {
      s.later(2000 + Math.random() * 1500, () => s.act({ targetId: 'pass' }, (r) => {
        bot.考え中 = false;
        s.log('パスした（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
      }));
      return;
    }
    let 位置 = 正解の位置;
    if (位置 === -1 || Math.random() < (外す率[tier] || 0.2)) {
      const 外れ = me.question.choices.map((c, i) => i).filter((i) => i !== 正解の位置);
      位置 = 外れ[Math.floor(Math.random() * 外れ.length)];
    }
    s.later(2500 + Math.random() * 3000, () => s.vote({ targetId: 位置 }, (r) => {
      bot.考え中 = false;
      s.log('答えた：' + me.question.choices[位置] + (位置 === 正解の位置 ? '（正解のはず）' : '（外れのはず）') + '（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
    }));
    return;
  }

  // 問題が出ていない＝難易度をえらぶ番
  if (!s.once('難易度:' + me.answered + ':' + me.passesLeft)) return;
  const tier = 難易度をえらぶ(me.tiers);
  bot.考え中 = true;
  const 待ち = Math.max(0, me.coolMs || 0);
  s.later(待ち + 1000 + Math.random() * 1500, () => 引く(bot, s, tier, 0));
};
