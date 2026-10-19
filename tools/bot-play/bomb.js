// tools/bot-play/bomb.js — bot がクイズ解除（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// 空いているコードを1本開けて、問題バンクで正解を引いて答える。
// **人が考える間を置く**（開けるまで1.5〜3秒、答えるまで2.5〜5秒）——即答にすると、
// 人の役が1本も解かないうちに bot だけで終わってしまい、導線が撮れない。
// 外さない（協力版で外すとライフが減り、爆発の回か解除の回かが bot の運で決まる）。
//
// **本人の秘密（wolf:you）が届いた時だけ動く。**部屋の知らせ（room:update）の時の s.mine は
// ひとつ前の秘密のままなので、それで「まだ何も開けていない」と読むと、開けている最中に
// 別のコードを開け直して、考えていた答えを違うコードに送ってしまう（not_a_choice。落とし穴18の形）。
// 送る直前にも「まだ同じコードを開けているか」を見る。失敗したら手放す——
// 開けたまま握っていると、協力版ではほかの誰もそのコードに挑めず、ゲームが終わらない。

const path = require('path');
const QuizBank = require(path.join(__dirname, '..', '..', 'public', 'js', 'quiz-bank.js'));
const 全問 = [].concat.apply([], Object.keys(QuizBank.QUESTIONS).map((k) => QuizBank.QUESTIONS[k]));

/** 開けているコードの3択から、正解を選ぶ（問題文と3択の両方が合う問題を引く） */
function 正解(open) {
  const hit = 全問.find((q) => q.q === open.description && open.choices.indexOf(q.choices[q.correct]) !== -1);
  return hit ? hit.choices[hit.correct] : open.choices[0];
}

module.exports = function 遊ぶ(bot, s) {
  if (s.from !== 'you') return;
  const mine = s.mine;
  if (!mine || mine.phase !== 'play' || mine.failed || mine.finished || mine.timedOut) return;
  if (bot.考え中) return;
  if (mine.open) {
    const uid = mine.open.uid;
    const 答え = 正解(mine.open);
    bot.考え中 = true;
    s.later(2500 + Math.random() * 2500, () => {
      // 考えている間に、開けているコードが変わっていないか
      if (!bot.mine || !bot.mine.open || bot.mine.open.uid !== uid) { bot.考え中 = false; return; }
      s.vote({ targetId: 答え }, (r) => {
        s.log('答えた：' + 答え + '（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
        if (r && r.ok) { bot.考え中 = false; return; }
        // 受け付けられなかったら、手放してから次へ
        s.act({ targetId: null }, () => { bot.考え中 = false; });
      });
    });
    return;
  }
  const 空き = (mine.board || []).filter((c) => !c.solved && !c.by);
  if (!空き.length) return;
  const 選ぶ = 空き[Math.floor(Math.random() * 空き.length)];
  bot.考え中 = true;
  s.later(1500 + Math.random() * 1500, () => s.act({ targetId: 選ぶ.uid }, (r) => {
    bot.考え中 = false;
    if (!r || !r.ok) s.log('開けられなかった（' + (r && r.error) + '）');
  }));
};
