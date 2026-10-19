// tools/bot-play/sugograb.js — bot が「すごろく：こまはひとつ」（部屋）を遊ぶ（指示62。tools/room-bots.js --play が読む）
//
// 段階ごとに、人がしそうなことを1つだけする（sugoroku-room.js の GAME_RULES.sugograb に合わせる）。
//   ready … 盤を見て「じゅんびOK」（1.5〜3秒）
//   mini  … ミニゲームの説明を読んで「じゅんびOK」（2〜4秒。人は説明の幕を読んで閉じてから押す）
//   play  … サーバーが配る startAt（3つ数え終わる時刻）を過ぎてから出す。
//           れんだ：18〜30回（満タンに届く人も届かない人もいる）
//           じゃんけん：ランダム
//           ゆびのかずあて：0〜5のランダム
//           はやおしクイズ：問題バンクで答えを引き、7割は正解・3割は外す（人は全問わかるわけではない）
//           考える間：れんだは6秒の持ち時間を叩き切る形（4〜5.5秒後に出す）、ほかは 1.5〜5秒
//   grab  … 自分がミニゲームで勝った時だけ、サイコロを振る（1.5〜3秒）
// **即答にしない**——人の役（参加者・進行役）が何もしないうちに段階が進むと、導線が撮れない。
// 段階・ミニゲーム・締め切りの組を鍵にして、同じ場面で二度送らない（s.once）。

const path = require('path');
const QuizBank = require(path.join(__dirname, '..', '..', 'public', 'js', 'quiz-bank.js'));
const 全問 = [].concat.apply([], Object.keys(QuizBank.QUESTIONS).map((k) => QuizBank.QUESTIONS[k]));
const r = (a, b) => a + Math.random() * (b - a);

module.exports = function 遊ぶ(bot, s) {
  /**
   * **ハートビートに返事をする。**tools/room-bots.js は `hb:ping` に答えないので、
   * つないで25秒たつとサーバーが bot を「切断中」にする（realtime.js:317 HEARTBEAT_TIMEOUT_MS）。
   * 切断中の人は待たれない（sugoroku-room.js expectedMembers）——ミニゲームの前の「じゅんびOK」も、
   * 勝った bot のサイコロも**サーバーが代わりにやってしまい**、待ち時間が実際より短く出る。
   * 1回目の通しでそうなっていた（bot が見た待ちの名簿に、自分たちが一度も載っていなかった）。
   * 共有の道具は変えない約束なので、ここで1回だけ足す（harness_notes に書く）
   */
  if (!bot.__はーと && bot.sock) {
    bot.__はーと = true;
    bot.sock.on('hb:ping', () => bot.sock.emit('hb:pong'));
    const me = ((s.room && s.room.members) || []).find((m) => m.id === s.me);
    s.log('ハートビートに返事をしはじめた（この時点で connected=' + (me ? me.connected : '?') + '）');
  }
  /**
   * **「もう一度」のあとの準備OK。**room-bots.js の --ready は「ゲームが決まった時に1回」だけ押す
   * （`bot.ready` は game が空になるまで戻らない）。「もう一度」は同じゲームのまま待合に戻るので、
   * bot は2回目の準備OKを押さず、部屋が始まらない（3回目の通しでそこで止まった）。
   * 人と同じように、ルールを読む間（2〜4秒）を置いて押す
   */
  const st = (s.room && s.room.state) || {};
  const 私 = ((s.room && s.room.members) || []).find((m) => m.id === s.me);
  if (st.phase !== 'lobby') bot.__待合で押した = false;
  if (st.phase === 'lobby' && st.game && 私 && !私.ready && !bot.__待合で押した) {
    bot.__待合で押した = true;
    s.later(r(2000, 4000), () => s.emit('room:ready', { ready: true, game: st.game }, (res) => s.log('待合で 準備OK（' + (res && res.ok ? 'ok' : res && res.error) + '）')));
    return;
  }
  const v = s.view || {};
  if (st.phase === 'lobby') return;
  if (!v.phase || v.phase === 'ended') return;
  const 鍵 = v.phase + ':' + ((v.mini && v.mini.id) || '') + ':' + (v.deadline || 0) + ':' + (v.startAt || 0);
  if (process.env.SUGO_BOT_DEBUG) s.log('見た(' + s.from + ')：' + 鍵 + ' 待ち=' + JSON.stringify(v.waiting) + ' 番=' + JSON.stringify(v.turn));

  if (v.phase === 'ready') {
    if (!(v.waiting || []).includes(bot.name)) return;
    if (!s.once(鍵)) return;
    s.later(r(1500, 3000), () => s.act({ act: 'ready' }, (res) => s.log('盤を見て じゅんびOK（' + (res && res.ok ? 'ok' : res && res.error) + '）')));
    return;
  }
  if (v.phase === 'mini' && v.mini) {
    if (!(v.waiting || []).includes(bot.name)) return;
    if (!s.once(鍵)) return;
    s.later(r(2000, 4000), () => s.act({ act: 'ready' }, (res) => s.log(v.mini.title + ' の説明を読んで じゅんびOK（' + (res && res.ok ? 'ok' : res && res.error) + '）')));
    return;
  }
  if (v.phase === 'play' && v.mini) {
    // 確かめの実験だけで使う：bot はミニゲームで何も出さない（人だけの部屋と同じ形を作る）
    if (process.env.SUGO_BOT_SILENT_PLAY === '1') { if (s.once('黙る:' + 鍵)) s.log('（実験）ミニゲームで何も出さない'); return; }
    if ((v.answered || []).includes(bot.name)) return;
    if (v.mini.id === 'quiz' && !v.question) return;
    if (!s.once(鍵)) return;
    const 始まり = Math.max(0, (v.startAt || Date.now()) - Date.now());
    let 出す, 間;
    if (v.mini.id === 'tap') { 出す = { count: Math.round(r(18, 30)) }; 間 = r(4000, 5500); }
    else if (v.mini.id === 'janken') { 出す = { hand: ['g', 'c', 'p'][Math.floor(Math.random() * 3)] }; 間 = r(1500, 4000); }
    else if (v.mini.id === 'fingers') { 出す = { fingers: Math.floor(Math.random() * 6) }; 間 = r(2000, 5000); }
    else if (v.mini.id === 'quiz') {
      const hit = 全問.find((q) => q.q === v.question.q);
      const 正解 = hit ? v.question.choices.indexOf(hit.choices[hit.correct]) : -1;
      const 当てる = 正解 >= 0 && Math.random() < 0.7;
      const ほか = v.question.choices.map((c, i) => i).filter((i) => i !== 正解);
      出す = { choice: 当てる ? 正解 : ほか[Math.floor(Math.random() * ほか.length)] };
      間 = r(2500, 5000);
    } else return;
    // 時刻（t=）を残す：flow-walk の台本が「3-2-1 のあと、人の画面に入力が出た時刻」と突き合わせる
    s.later(始まり + 間, () => { const t = Date.now(); s.act(出す, (res) => s.log(v.mini.title + '：' + JSON.stringify(出す) + ' を出した（' + (res && res.ok ? 'ok' : res && res.error) + '）t=' + t + ' 数え終わりから+' + (t - (v.startAt || t)) + 'ms')); });
    return;
  }
  if (v.phase === 'grab') {
    if (!v.turn || v.turn.id !== s.me) return;
    if (!s.once(鍵)) return;
    s.later(r(1500, 3000), () => s.act({ act: 'roll' }, (res) => s.log('ミニゲームに勝ったので、サイコロを振った（' + (res && res.ok ? 'ok' : res && res.error) + '）')));
  }
};
