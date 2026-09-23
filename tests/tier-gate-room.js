// tests/tier-gate-room.js — 指示58：部屋では、進行役の設定が全員に効く（実サーバー）
//
// 本物の realtime.js を立てて、socket.io の端末を複数つなぐ（X6・X8）。
//   X6：進行役が OFF なら、参加者の端末が何を送っても、サーバーは なにそれ・むり を出さない
//   X8：途中で OFF にしたら次の問題から効く。今出ている問題は取り消さない。
//       選んでいた難易度が消えたら「おまかせ」へ戻る
// 証拠として、断った・通ったを1行ずつ出す（報告の「ログ」）。

const { createRunner, assert, assertEqual } = require('./harness');
const { startTestServer, device, waitUntil, makeRoom, sleep } = require('./room-edge');

const マニアック = ['nanisore', 'muri'];
const quizOf = (srv, code) => srv.store.get(code).quiz;
const log = (s) => console.log('    [ログ] ' + s);

(async function main() {
  const r = createRunner('tier-gate-room：部屋では進行役の設定が効く（指示58・実サーバー）');

  await r.test('X6 進行役が OFF なら、参加者が何を送っても なにそれ・むり は出ない', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const guest = rm.guests[0];
      // 進行役は tierMix を送らない（＝既定の OFF。古い端末と同じ）
      const st = await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 120 });
      assertEqual(st.ok, true, 'クイズラッシュが始まる');
      await waitUntil(() => guest.you && guest.you.rush, '参加者に自分の状態が届く');
      assertEqual(guest.you.rush.tiers.join(','), 'easy,normal,hard', '参加者の端末に並ぶのは3つ');
      for (const t of マニアック) {
        const a = await guest.call('wolf:act', { targetId: t });
        log('参加者が ' + t + ' を送った → ok:' + a.ok + ' error:' + a.error);
        assertEqual(a.ok, false, t + ' は ok にしない（黙って通さない・落とし穴14）');
      }
      assertEqual(quizOf(srv, rm.code).rush.seats[guest.memberId].q, null, '問題は1つも出ていない');
      // 参加者が「設定」を送ってきても
      const o = await guest.call('game:options', { tierMix: { nanisore: true, muri: true } });
      log('参加者が game:options で両方ONを送った → ok:' + o.ok + ' error:' + o.error);
      assertEqual(o.error, 'not_host', '参加者は途中の設定を変えられない');
      assertEqual(quizOf(srv, rm.code).cfg.allowedTiers.join(','), 'easy,normal,hard', '部屋の許可は3つのまま');
      // 5層を順に頼み続ける。なにそれ・むりは毎回断られ、許された層だけが引ける
      // （許された層だけを頼むと、門を外しても緑のまま・型(b)）
      const 出た = [];
      let 断った = 0;
      for (let i = 0; i < 75; i++) {
        const t = ['easy', 'normal', 'hard', 'nanisore', 'muri'][i % 5];
        const a = await guest.call('wolf:act', { targetId: t });
        const q = quizOf(srv, rm.code).rush.seats[guest.memberId].q;
        if (マニアック.indexOf(t) >= 0) {
          assertEqual(a.ok, false, (i + 1) + '回目：' + t + ' は断る');
          assertEqual(q, null, (i + 1) + '回目：' + t + ' の問題は出ていない');
          断った++;
          continue;
        }
        assertEqual(a.ok, true, t + ' は選べる');
        出た.push(q.tier);
        await guest.call('wolf:vote', { targetId: q.correct });
      }
      assertEqual(断った, 30, 'なにそれ・むりを30回頼んだ（型(b)）');
      assertEqual(出た.length, 45, '許された層は45問引けた');
      assertEqual(出た.filter((t) => マニアック.indexOf(t) >= 0).length, 0, 'なにそれ・むりは0問');
      log('5層を順に75回頼んで、なにそれ・むりは30回とも断り、許された層を ' + 出た.length + '問引いた');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('X6 参加者は始められないし、古い端末の進行役が本数を送っても なにそれ・むりのコードは0本', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const ng = await rm.guests[0].call('wolf:start', { game: 'bomb', counts: { muri: 10 }, tierMix: { muri: true } });
      log('参加者が むり10本で始めようとした → ok:' + ng.ok + ' error:' + ng.error);
      assertEqual(ng.error, 'not_host', '参加者は始められない');
      // 進行役の端末が古く、tierMix を送らずに なにそれ・むり の本数だけ送ってきた
      const st = await rm.host.call('wolf:start', { game: 'bomb', mode: 'coop', counts: { easy: 2, nanisore: 4, muri: 4 } });
      assertEqual(st.ok, true, '始まる');
      const 層 = srv.store.get(rm.code).bomb.wires.map((w) => w.tier);
      log('クイズ解除のコード：' + 層.join(','));
      assertEqual(層.length, 10, '本数は保つ（寄せる）');
      assertEqual(層.filter((t) => マニアック.indexOf(t) >= 0).length, 0, 'なにそれ・むりのコードは0本');
      // 途中の変更は受け取らない（盤のコードはもう出ている＝次のゲームから）
      const o = await rm.host.call('game:options', { tierMix: { muri: true } });
      log('クイズ解除の途中で進行役が変えた → ok:' + o.ok + ' error:' + o.error);
      assertEqual(o.error, 'not_supported', 'クイズ解除は次のゲームから（黙って ok にしない）');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('X8 途中で OFF：今出ている問題はそのまま、次の問題から効く（ラッシュ）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      const guest = rm.guests[0];
      await rm.host.call('wolf:start', { game: 'quizrush', timerSec: 300, canChangeTier: false, tierMix: { muri: true } });
      await waitUntil(() => guest.you && guest.you.rush, '状態が届く');
      assertEqual(guest.you.rush.tiers.join(','), 'easy,normal,hard,muri', '前提：むり が並んでいる（型(b)）');
      const a = await guest.call('wolf:act', { targetId: 'muri' });
      assertEqual(a.ok, true, 'むり を選べる');
      await waitUntil(() => guest.you.rush.question, '問題が届く');
      const 出ていた = guest.you.rush.question.text;
      assertEqual(quizOf(srv, rm.code).rush.seats[guest.memberId].q.tier, 'muri', '前提：むり の問題が出ている');

      const o = await rm.host.call('game:options', { tierMix: {} });
      log('進行役が途中で OFF にした → ok:' + o.ok);
      assertEqual(o.ok, true, '進行役は途中で変えられる');
      await waitUntil(() => guest.you.rush.tiers.length === 3, '参加者の端末に並ぶ層が、すぐ3つになる');
      assertEqual(guest.you.rush.question && guest.you.rush.question.text, 出ていた, '今出ている問題は取り消さない');
      const q = quizOf(srv, rm.code).rush.seats[guest.memberId].q;
      await guest.call('wolf:vote', { targetId: q.correct });
      const again = await guest.call('wolf:act', { targetId: 'muri' });
      log('OFF のあと、参加者がまた むり を送った → ok:' + again.ok + ' error:' + again.error);
      assertEqual(again.ok, false, '次の問題からは むり を断る');
      const hard = await guest.call('wolf:act', { targetId: 'hard' });
      assertEqual(hard.ok, true, '難易度を固定していても、選び直せる（おまかせへ戻す＝選び直し）');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  await r.test('X8 途中で OFF：選んでいた むり は「ふつう」へ戻り、次の問題から出ない（とくとく）', async () => {
    const srv = await startTestServer();
    try {
      const rm = await makeRoom(srv, 3);
      await rm.host.call('wolf:start', { game: 'quizreveal', tier: 'muri', questionCount: 5, revealSec: 5,
        tierMix: { muri: true } });
      const w = quizOf(srv, rm.code);
      assertEqual(w.reveal.questions[0].tier, 'muri', '前提：むり で始まっている（型(b)）');
      const o = await rm.host.call('game:options', { tierMix: {} });
      log('とくとくの途中で OFF → ok:' + o.ok + ' 難易度 ' + (o.tierReset && o.tierReset.from) + '→' + (o.tierReset && o.tierReset.to));
      assertEqual(o.tierReset && o.tierReset.to, 'normal', '選んでいた むり は ふつう へ（黙って空にしない）');
      assertEqual(w.reveal.questions[0].tier, 'muri', '今出ている1問目は取り消さない');
      // 見回りで次の問題へ（全部見えた＋答える時間を過ぎた扱い）
      const 次に出た = [];
      for (let i = 1; i < 5; i++) {
        const before = w.reveal.index;
        w.reveal.askedAt = Date.now() - 60000;
        w.deadline = Date.now() - 1;
        await waitUntil(() => w.reveal.index !== before || w.phase !== 'play', (i + 1) + '問目へ進む', 3000);
        if (w.phase !== 'play') break;
        次に出た.push(w.reveal.questions[w.reveal.index].tier);
      }
      log('OFF のあとに出た問題の層：' + 次に出た.join(','));
      assert(次に出た.length >= 2, '2問以上進めた（型(b)）');
      assertEqual(次に出た.filter((t) => t === 'muri').length, 0, '次の問題からは むり が出ない');
      rm.all.forEach((d) => d.close());
    } finally { await srv.close(); }
  });

  r.finish();
})();
