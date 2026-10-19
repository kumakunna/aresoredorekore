// tools/bot-play/bomb.js — bot がクイズ解除（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// 空いているコードを1本開けて、問題バンクで正解を引いて答える。
// **人が考える間を置く**（開けるまで1.5〜3秒、答えるまで2.5〜5秒）——即答にすると、
// 人の役が1本も解かないうちに bot だけで終わってしまい、導線が撮れない。
// 外さない（協力版で外すとライフが減り、爆発の回か解除の回かが bot の運で決まる）。

const path = require('path');
const QuizBank = require(path.join(__dirname, '..', '..', 'public', 'js', 'quiz-bank.js'));
const 全問 = [].concat.apply([], Object.keys(QuizBank.QUESTIONS).map((k) => QuizBank.QUESTIONS[k]));

module.exports = function 遊ぶ(bot, s) {
  const mine = s.mine;
  if (!mine || mine.phase !== 'play' || mine.failed || mine.finished || mine.timedOut) return;
  if (bot.考え中) return;
  if (mine.open) {
    if (!s.once('答え:' + mine.open.uid)) return;
    const hit = 全問.find((q) => q.q === mine.open.description);
    const 答え = hit ? hit.choices[hit.correct] : mine.open.choices[0];
    bot.考え中 = true;
    s.later(2500 + Math.random() * 2500, () => s.vote({ targetId: 答え }, (r) => {
      bot.考え中 = false;
      s.log('答えた：' + 答え + '（' + (r && r.ok ? 'ok' : (r && r.error)) + '）');
    }));
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
