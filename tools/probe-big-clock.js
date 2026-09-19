#!/usr/bin/env node
// tools/probe-big-clock.js — 大画面の「共通の時計」が本当に配られるかを見る道具（指示55）
//
// 使い方: node tools/probe-big-clock.js
//
// **なぜ fx-probe では足りないか**：あちらは `Bomb.publicView(room)` を直接呼ぶので、
// `realtime.js` の `publicSnapshot`（＝時計をそえる）を通らない。
// 時計は publicSnapshot で締め切りから導いているので、**実サーバーを立てないと見えない**。
//
// 見るのは3つ（指示55-① で2つから増やした）：
//   ・卓のみんなが待つ締め切り（協力版クイズ解除・3分）→ clock.kind = 'play'
//   ・手番の人だけの締め切り（すごろく「つうこうりょう」の手番）→ clock.kind = 'turn'
//   ・誰も待っていない時刻（とくとくクイズの「次の1文字」）→ clock は null
//
// **kind まで見る。**`clock` が出ているかどうかだけでは、
// 'play' と 'turn' の取り違えが見えない——取り違えると、
// 420px の巨大カウントダウンが**手番のたびに盤を覆う**（正本 §11-4）。
// とくとくを数えてしまう方の実害は、伏せ字の問題文の上に
// 1〜2秒ごとに数字が出続けること（指示55の実測：6秒間に6回）。
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
    await host.call('room:setState', { phase: 'lobby', game: null, reset: true }).catch(() => {});
    await sleep(250);

    // すごろく「つうこうりょう」（手番制 → kind は 'turn'。巨大カウントダウンは出さない）
    const s3 = await host.call('wolf:start', {
      game: 'sugotoll', turnSec: 30, goal: 20
    });
    console.log('start:', s3 && s3.ok);
    await sleep(400);
    見る('sugotoll ready');   // READY は締め切りを置かないので clock は null
    // **手番まで進めないと、見たい状況が作れていない**（落とし穴10-b）。
    // READY は「全員が1回押す」段階なので、3人とも押す
    for (const d of [host, g2, g3]) { await d.call('wolf:act', { act: 'ready' }).catch(() => {}); }
    await sleep(500);
    見る('sugotoll turn');
    const 段階 = ((g2.room && g2.room.state) || {}).phase;
    console.log('        （いまの段階：' + 段階 + '。turn でなければ、下の読み方は当てにならない）');
    console.log('');
    console.log('読み方：clock が null なら時計そのものが出ない（tick）。');
    console.log('        clock.kind が "play" なら巨大カウントダウンも出る。');
    console.log('        "turn" なら帯の時計だけで、盤は覆われない。');
  } finally { await srv.close(); process.exit(0); }
})();
