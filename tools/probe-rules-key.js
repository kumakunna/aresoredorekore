#!/usr/bin/env node
// tools/probe-rules-key.js — 「このゲームのルールを読んだか」の鍵が、経路で変わることを見る道具（第48弾）
//
// 使い方: node tools/probe-rules-key.js
// 本物の realtime.js を立てて、棚から選ぶ／再戦／強制終了／別モードの各経路で
// 部屋の state.data.modeId がどうなるかを並べる。
// 端末側の鍵は rtRulesKey() = modeId ?? gameId（public/index.html:11304）なので、
// modeId が消える経路では鍵がゲームidに落ちる＝別の記憶になる。
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { startTestServer, login, device, sleep } = require(path.join(ROOT, 'tests', 'room-edge.js'));
const fs = require('fs');

// モード表は index.html が正本。端末と同じ判定をするために読み出す
const MODES = Array.from(
  fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
    .matchAll(/\{id:"([a-z0-9-]+)"[^\r\n]*?game:\s*'([a-z]+)'/g)
).map((m) => ({ id: m[1], game: m[2] }));
if (!MODES.length) throw new Error('モード表を読み出せませんでした（index.html の書式が変わった？）');

(async function main() {
  const srv = await startTestServer();
  try {
    const cookie = await login(srv.url, 4321);
    const host = await device(srv.url, cookie);
    const created = await host.call('room:create', { name: 'あき' });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const code = created.code;
    const guest = await device(srv.url);
    const j = await guest.call('room:join', { code, name: 'びび' });
    if (!j.ok) throw new Error(JSON.stringify(j));
    const guestId = j.memberId;
    await sleep(120);

    const line = (tag) => {
      const st = (guest.room && guest.room.state) || {};
      const data = st.data || {};
      const me = ((guest.room && guest.room.members) || []).find((m) => m.id === guestId) || {};
      // **端末と同じ規則で鍵を出す。**ここで手を抜いて `modeId || game` と書くと、
      // 「そのゲームのモードか」を確かめる rtPickedMode の門（index.html:11502付近）を
      // 飛ばすので、道具の方が嘘をつく（落とし穴28）
      const モード = MODES.find((m) => m.id === data.modeId);
      const 鍵 = (モード && モード.game === st.game) ? モード.id : (st.game || null);
      console.log('  ', tag.padEnd(32),
        '| game', String(st.game).padEnd(8),
        '| data.modeId', String(data.modeId).padEnd(10),
        '| 読んだかの鍵 →', String(鍵 || '(無し)').padEnd(11),
        '| ゲストのready', me.ready ? '★true' : 'false');
    };

    console.log('== 経路ごとに「読んだか」の鍵がどうなるか（ゲストに届いた部屋の知らせ）==\n');

    // (1) 棚→モード→ウィザードの道。backToRoomWithGame だけが modeId を載せる
    //     （public/index.html:11266）
    await host.call('room:setState', { game: 'bomb', reset: true, data: { modeId: 'bomb-coop' } });
    await sleep(150); line('(1) 棚から協力版をえらんだ');

    await host.call('room:ready', { ready: true });
    await guest.call('room:ready', { ready: true });
    await sleep(150); line('(1) 二人とも準備OKを押した');

    const s = await host.call('wolf:start', {
      game: 'bomb', mode: 'coop', counts: { easy: 2 }, lives: 3, timerSec: 0 });
    console.log('    wolf:start →', s.ok ? 'ok' : JSON.stringify(s));
    await sleep(200); line('(1) ゲーム中');

    // (2) 再戦：doNextChoiceInRoom('again') は data を付けない（public/index.html:21710）
    await host.call('room:setState', { game: 'bomb', reset: true });
    await sleep(200); line('(2) 「もう一度」のあと');

    // (3) 強制終了：actEndGame も data を付けない（public/index.html:22417）
    await host.call('room:ready', { ready: true });
    await guest.call('room:ready', { ready: true });
    await host.call('wolf:start', {
      game: 'bomb', mode: 'coop', counts: { easy: 2 }, lives: 3, timerSec: 0 });
    await sleep(150);
    await host.call('room:setState', { game: 'bomb', reset: true });
    await sleep(200); line('(3) 「みんなを待合にもどす」のあと');

    // (4) 同じゲームの別モードへ（backToRoomWithGame 経由なので modeId が載る）
    await host.call('room:setState', { game: 'bomb', reset: true, data: { modeId: 'bomb-race' } });
    await sleep(200); line('(4) 競争版にえらび直した');

    // (5) いったんゲームを外して、また協力版へ
    await host.call('room:setState', { game: null, reset: true });
    await sleep(150); line('(5a) ゲームをえらび直し（null）');
    await host.call('room:setState', { game: 'bomb', reset: true, data: { modeId: 'bomb-coop' } });
    await sleep(200); line('(5b) また協力版をえらんだ');

    console.log('\n   サーバーが持っている部屋の state:',
      JSON.stringify(srv.store.get(code).state));

    host.close(); guest.close();
  } finally {
    await srv.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
