#!/usr/bin/env node
// tools/probe-big-clock.js — 大画面の「共通の時計」が本当に配られるかを見る道具（指示55）
//
// 使い方: node tools/probe-big-clock.js
//
// **なぜ fx-probe では足りないか**：あちらは `Bomb.publicView(room)` を直接呼ぶので、
// `realtime.js` の `publicSnapshot`（＝時計をそえる）を通らない。
// 時計は publicSnapshot で締め切りから導いているので、**実サーバーを立てないと見えない**。
//
// 見るのは2つ：
//   ・人が待っている締め切り（協力版クイズ解除・3分）→ clock が出る
//   ・画面が変わるだけの時刻（とくとくクイズの「次の1文字」）→ clock は null
// 後者を数えると、420px の巨大カウントダウンが伏せ字の問題文の上に
// 1〜2秒ごとに出続ける（指示55の実測：6秒間に6回）。
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { startTestServer, login, device, sleep } = require(path.join(ROOT, 'tests', 'room-edge.js'));

(async function main() {
  const srv = await startTestServer();
  try {
    const cookie = await login(srv.url, 991);
    const host = await device(srv.url, cookie);
    const c = await host.call('room:create', { name: 'あき' });
    const code = c.code;
    const g2 = await device(srv.url); await g2.call('room:join', { code, name: 'びび' });
    const g3 = await device(srv.url); await g3.call('room:join', { code, name: 'ちか' });
    await sleep(150);
    const 見る = (tag) => {
      const st = (g2.room && g2.room.state) || {};
      const d = st.data || {};
      console.log(tag, '| game=' + st.game, '| clock=' + JSON.stringify(d.clock),
        '| shared=' + JSON.stringify(d.shared));
    };
    // 協力版クイズ解除（時計あり・共有ライフあり）
    const s = await host.call('wolf:start', {
      game: 'bomb', mode: 'coop', counts: { easy: 3 }, lives: 3, timerSec: 180,
      topics: Array.from({ length: 8 }, (_, i) => ({ name: 'お題' + i, desc: 'せつめい' + i }))
    });
    console.log('start:', s && s.ok);
    await sleep(400);
    見る('bomb coop  ');
    await host.call('room:setState', { phase: 'lobby', game: null, reset: true }).catch(() => {});
    await sleep(250);

    // とくとくクイズ（時計は tick なので出ない）
    const s2 = await host.call('wolf:start', {
      game: 'quizreveal', variant: 'quizreveal', tier: 'normal', revealSec: 20, timerSec: 120
    });
    console.log('start:', s2 && s2.ok);
    await sleep(400);
    見る('quizreveal ');
  } finally { await srv.close(); process.exit(0); }
})();
