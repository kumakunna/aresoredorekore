#!/usr/bin/env node
// tools/probe-rcard.js — ロシアンカードを、実サーバーで最後まで通す道具（指示55-①・門T5／T4／T9）
//
// 使い方:
//   node tools/probe-rcard.js          … 5人で生き残り戦を最後まで
//   node tools/probe-rcard.js 2        … 人数を変える（2〜8）
//   node tools/probe-rcard.js 5 leave  … 途中で1人抜ける（門T9）
//
// **なぜ単体の検査だけでは足りないか。**
// tests/rcard-room.js は進行役を直に叩くので、`realtime.js` の
// `publicSnapshot`（＝時計をそえる・白名簿）も、socket の配り分けも通らない。
// 「**端末に実際に届いた JSON に、爆弾の位置が入っていないか**」は、
// 実サーバーを立てて、届いたものを全部ためて見るしかない
//（tools/probe-big-clock.js が存在するのと同じ理由）。
//
// **この道具を書いて、実際に1つ見つけた。**
// 芯は `dr.submitAction(room, me.id, payload.targetId || null, payload)` の**4引数**で呼ぶ
// （realtime.js:1404）。進行役を3引数で書いていたので、payload が targetId の位置に入り、
// **実サーバーでは1つも操作が通らなかった**——単体の検査は「こちらの間違った呼び方」を
// そのまま写していたので、23/23 の緑のまま通っていた（落とし穴12）。
//
// 見るのは3つ：
//   ① 最後の1人が決まるまで進むか（止まらないか）
//   ② **部屋の知らせに、秘密の入れ物の名前が1つも出ないか**
//   ③ 時計の種類が場面どおりか（置く=play／めくる=turn／見せる=tick なので clock は null）

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { startTestServer, login, device, sleep } = require(path.join(ROOT, 'tests', 'room-edge.js'));

const 人数 = Math.max(2, Math.min(8, parseInt(process.argv[2], 10) || 5));
const 抜ける = process.argv[3] === 'leave';
const 名前 = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふみ', 'げん', 'はな'];

(async function main() {
  const srv = await startTestServer();
  try {
    const cookie = await login(srv.url, 971);
    const host = await device(srv.url, cookie);
    const c = await host.call('room:create', { name: 名前[0] });
    const code = c.code;
    const 端末 = [host];
    for (let i = 1; i < 人数; i++) {
      const d = await device(srv.url);
      await d.call('room:join', { code, name: 名前[i] });
      端末.push(d);
    }
    await sleep(200);

    const s = await host.call('wolf:start', {
      game: 'rcard', lives: 2, bombs: 3, finalBombs: 5, turnSec: 15
    });
    console.log('はじめた:', s && s.ok, '／', 人数 + '人');
    if (!s || !s.ok) { console.log('  理由:', s && (s.message || s.error)); return; }
    await sleep(300);

    const 見た段階 = [];
    const 時計 = {};
    let 回 = 0, 送った = 0, 通った = 0, 抜けた = false;

    // **部屋の知らせと、本人だけの秘密を分けてためる。**
    // 混ぜると `bombsIPlaced`（本人には正当に届く）で必ず引っかかり、
    // 「漏れている」と嘘を言う道具になる
    const 部屋の知らせ = [], 本人の秘密 = [];

    const 公開 = () => {
      const st = (端末[1].room && 端末[1].room.state) || {};
      return st.data || {};
    };

    while (公開().phase !== 'ended' && 回 < 200) {
      回++;
      const v = 公開();
      if (v.phase && 見た段階[見た段階.length - 1] !== v.phase) {
        見た段階.push(v.phase);
        時計[v.phase] = v.clock ? v.clock.kind : null;
      }
      端末.forEach((d) => {
        if (d.room) 部屋の知らせ.push(JSON.stringify(d.room));
        if (d.you) 本人の秘密.push(JSON.stringify(d.you));
      });

      if (v.phase === 'place') {
        for (const d of 端末) {
          const you = d.you;
          if (!you || you.isBye || (v.placed || {})[d.memberId]) continue;
          const n = v.bombsPerBoard || 3;
          const 場所 = [1, 2, 3, 4, 5, 6, 7, 8, 9].slice(0, n);
          // **端末と同じ形で送る**（rt-client の act(targetId, extra) は
          // `{targetId, ...extra}` を送る）。ここを `{payload:{…}}` にすると
          // サーバーは受け取るが中身が読めず、締め切りまで何も起きない
          const r = await d.call('wolf:act', { targetId: null, place: 場所 }).catch(() => ({}));
          送った++; if (r && r.ok) 通った++;
        }
        await sleep(200);
        continue;
      }
      if (v.phase === 'turn') {
        for (const d of 端末) {
          const you = d.you;
          if (!you || !you.isMyTurn) continue;
          const 盤 = (v.boards || {})[d.memberId] || { flipped: [] };
          const 空き = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((x) => (盤.flipped || []).indexOf(x) === -1);
          if (!空き.length) continue;
          const r = await d.call('wolf:act', { targetId: null, flip: 空き[0] }).catch(() => ({}));
          送った++; if (r && r.ok) 通った++;
        }
        if (抜ける && !抜けた && 回 > 2) {
          抜けた = true;
          await 端末[人数 - 1].call('room:leave', {}).catch(() => {});
          console.log('  （' + 名前[人数 - 1] + ' が退室しました）');
        }
        await sleep(200);
        continue;
      }
      await sleep(250);   // show / round は時間で進む
    }

    const v = 公開();
    console.log('');
    console.log('送った操作:', 送った, '件 ／ 通った:', 通った, '件',
      通った === 0 ? '  ← **1つも通っていない。締め切りだけで進んでいる**' : '');
    console.log('通った段階:', 見た段階.join(' → '));
    console.log('時計の種類:', Object.keys(時計).map((k) => k + '=' + 時計[k]).join(' / '),
      '（show / round は tick なので null が正しい）');
    console.log('終わったか:', v.phase === 'ended' ? 'はい（回:' + 回 + '）' : 'いいえ ← **止まった**');
    if (v.result) {
      console.log('勝った人:', v.result.winner);
      console.log('順位:', (v.result.ranking || [])
        .map((x) => x.rank + '位 ' + x.name + '（体力' + x.lives + '・勝ち抜き' + x.rounds + '）').join(' / '));
    }

    // ---- ② 届いたものに、秘密の入れ物が混ざっていないか ----
    // **値では針を張れない**（位置は 1〜9 の整数で、盤の番号として正当に出る）。
    // だから**入れ物の名前**を見る。名前を変えた日は grep をかけること（落とし穴5）
    const 部屋 = 部屋の知らせ.join('\n');
    const 秘密 = 本人の秘密.join('\n');
    const 部屋に漏れた = ['bombsOnBoard', 'bombsIPlaced'].filter((k) => 部屋.indexOf(k) !== -1);
    // 本人の秘密には `bombsIPlaced`（自分が置いた位置）が正当に出る。
    // **出てはいけないのは `bombsOnBoard`**（自分の盤の答え）だけ
    const 本人に漏れた = ['bombsOnBoard'].filter((k) => 秘密.indexOf(k) !== -1);
    console.log('');
    console.log('部屋の知らせ ' + 部屋の知らせ.length + ' 件：',
      部屋に漏れた.length ? '**' + 部屋に漏れた.join('・') + '** ← 漏れている' : '秘密の入れ物は1つも出ていない');
    console.log('本人の秘密 ' + 本人の秘密.length + ' 件：',
      本人に漏れた.length ? '**' + 本人に漏れた.join('・') + '** ← 自分の盤の答えが返っている' : '自分の盤の答えは返っていない');
    // 型(b)：**そもそも秘密が配られていたか。**0件なら「漏れていない」は自明に成立する
    console.log('  （bombsIPlaced が本人に届いた回数:',
      (秘密.match(/bombsIPlaced/g) || []).length, '件 ← 0 なら、そもそも配られていない）');
  } finally { await srv.close(); process.exit(0); }
})();
