// tests/clear-fx.js — クリア演出（指示60 A-2）
//
// 見るのは4つ：
//   ① 正本の照合（両方向）：棚に出ている全カセットに、クリア演出の世界の行がある／
//      行があるカセットは棚に実在する（落とし穴20）。行の中身が本当にその動きで出る
//   ② 部屋（本物の進行役を決着まで回す）：大画面には祝う相手の名前で出る。
//      スマホは**祝う相手の端末にだけ**出る（対戦は勝った人、協力は全員）。負けた人には出ない
//   ③ スキップ設定では出ない（すぐ結果）。称号は祝いの**あと**
//   ④ 手渡し（あれそれ・すごろく・ロシアンカードのいっきうち）
//   ⑤ 指示60 の見直しで見つけた3件（出てはいけない所に出ない）：
//      競争版の「もう一度」で前の試合の祝い／つぎつぎの時間切れ（勝者なし）で全員「優勝！」／
//      ロシアンカードの時間切れを大画面が「ばくだんをめくった」と言う
//
// **本物の進行役を動かし、本物の publicView / privateFor を本物の画面へ流す**（落とし穴25）。
// 進め方は tests/room-drive.js（tests/now-line.js と共有）。
// 出た・消えたは見張り（MutationObserver）に拾わせる——時々覗くと取りこぼす（落とし穴28）

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, el, click, openCassette,
        createRunner, assert, assertEqual, assertNoErrors, setupPlayers, autoDialog,
        passPlayWay, pickGame, fillPlayerForm } = H;
const { RT_START_MIN_CONFIG } = require('./inventory');
const { GAME_DRIVERS } = require('../realtime');
const { 部屋を作る, すすめる } = require('./room-drive');
const Bomb = require('../bomb-room');
const BombLogic = require('../public/js/bomb-logic');
const Rcard = require('../rcard-room');

// 部屋で遊ぶゲーム（爆弾解除は爆発と対の1本で別に見ている：fixes52・fx-probe）
const 対象 = [
  { game: 'rcard',    cart: 'rcard',    n: 3 },
  { game: 'shinka',   cart: 'shinka',   n: 3 },
  { game: 'falsetrue', cart: 'falsetrue', n: 4 },
  { game: 'auction',  cart: 'auction',  n: 3 },
  { game: 'sugotoll', cart: 'sugoroku', n: 3 },
  { game: 'sugograb', cart: 'sugoroku', n: 3 },
  { game: 'sugopair', cart: 'sugoroku', n: 4 },
  { game: 'sugohide', cart: 'sugoroku', n: 3 },
  { game: 'sugohand', cart: 'sugoroku', n: 3 },
  { game: 'quizrush', cart: 'quizou',   n: 3 },
  { game: 'quizlist', cart: 'quizou',   n: 3 },
  // 既定は協力形式。脱落形式（最後の1人が勝ち）も通す（型(c)：分岐のもう一方）
  { game: 'quizlist', cart: 'quizou',   n: 3, cfg: { style: 'survival' }, label: 'quizlist（脱落）' },
  { game: 'quizreveal', cart: 'quizou', n: 3 },
  { game: 'buzzer',   cart: 'quizou',   n: 4 }
];

/**
 * 進行役を決着まで回しながら、その端末で「祝い」と「称号」がいつ出たかを拾う。
 * @param {string} 自分 'm1'..（プレイヤー）か 'tv'（大画面）
 */
async function 決着まで(t, 自分, launchOpt) {
  const entry = GAME_DRIVERS[t.game];
  const d = entry.driver;
  const { win, doc, errors } = await launch(Object.assign({ fakeSocket: true }, launchOpt || {}));
  try {
    win.TitleLogic.seasonFor = () => null;
    await waitScreen(win, doc, 'scr-shelf', 9000);
    await openCassette(win, doc, t.cart);
    const way = doc.querySelector('#wayChoices [data-way="room"]');
    if (way) way.click();
    await waitScreen(win, doc, 'scr-rt-lobby', 5000);
    const fake = win.__rtFake;
    await waitFor(win, () => fake.connected, 5000, '疑似socket');

    const room = 部屋を作る(t.n);
    if (自分 === 'tv') room.members.set('tv', { id: 'tv', name: 'テレビ', role: 'bigscreen', connected: true });
    const res = d.startGame(room, Object.assign({}, RT_START_MIN_CONFIG[t.game], t.cfg || {}), { notify() {} });
    assertEqual(res.ok, true, t.game + '：進行役を始められる（' + JSON.stringify(res) + '）');
    room.state.game = t.game;
    room.state.phase = 'playing';
    const 名簿 = () => Array.from(room.members.values()).map((m) => ({
      id: m.id, name: m.name, role: m.role, connected: true, isHost: m.id === 'm1', ready: true }));
    const snap = () => ({
      code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1',
      playerCount: t.n, memberCount: 名簿().length,
      ready: { count: t.n, total: t.n, waitingNames: [], all: true },
      members: 名簿(),
      state: { phase: room.state.phase, game: t.game,
               data: room[entry.key] ? d.publicView(room) : room.state.data }
    });
    fake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 自分, room: snap() }) };
    el(doc, 'rtJoinCode').value = 'ABC234';
    el(doc, 'rtJoinName').value = 自分 === 'tv' ? 'テレビ' : 'あき';
    click(doc, 'rtJoinBtn');
    const 部屋の前置き = 'scr-' + 'rt-';   // 幽霊の画面idとして拾われないよう組み立てる（落とし穴32）
    await waitFor(win, () => String(activeScreen(doc)).indexOf(部屋の前置き) === 0, 8000, '部屋の画面');

    // 見張り：祝い（.fx-cel）の出入りと、称号の幕
    const 記録 = [];
    const t0 = Date.now();
    const mo = new win.MutationObserver((recs) => recs.forEach((rec) => {
      Array.from(rec.addedNodes).forEach((n) => {
        if (n.classList && n.classList.contains('fx-cel')) {
          記録.push({ ms: Date.now() - t0, 何: '祝い', 文: ((n.querySelector('.fx-cel-text') || {}).textContent || '') +
            ' / ' + ((n.querySelector('.fx-cel-sub') || {}).textContent || ''), 形: n.className });
        }
      });
      if (rec.type === 'attributes' && rec.target.id === 'titleGotOverlay' &&
          rec.target.classList.contains('show')) 記録.push({ ms: Date.now() - t0, 何: '称号' });
    }));
    mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    const push = async () => {
      fake.fire('room:update', snap());
      if (room[entry.key] && d.privateFor) {
        const mine = d.privateFor(room, 自分);
        if (mine) fake.fire('wolf:you', mine);
      }
      await sleep(win, 60);
    };
    await push();
    const w = room[entry.key];
    for (let step = 0; step < 400 && w.phase !== d.PHASE.ENDED; step++) {
      const 前 = w.phase;
      if (t.全体の時間切れ && w.list) {
        // 1人ずつの持ち時間は進めず、**全体の時間だけ**を来させる（2人以上が残ったまま終わる）
        w.list.overallEndsAt = Date.now() - 1;
        try { d.advance(room); } catch (e) {}
      } else {
        すすめる(d, room, t.game, w);
      }
      await push();
      if (w.phase === 前 && step > 80) break;
    }
    assertEqual(w.phase, d.PHASE.ENDED, t.game + '：決着まで回せた');   // 型(b)
    await push();
    // 祝い（1.7秒）と、そのあとの称号まで待つ
    await sleep(win, 2600);
    mo.disconnect();
    return { win, doc, errors, 記録, v: d.publicView(room) };
  } catch (e) { win.close(); throw e; }
}

/** 決着の知らせから「祝う相手（のid）」を読む。**具体の形で**書く（実装の関数を借りない・落とし穴10-a） */
function 祝う相手(t, v) {
  const r = v.result || {};
  if (t.game === 'falsetrue') return (v.survivors || []).map((x) => x.id);
  if (t.cart === 'sugoroku') {
    const 上 = (r.players || []).filter((x) => x.rank === 1);
    if (r.pairs) {
      const 組 = (v.groups || []).filter((g) => 上.some((x) => x.id === g.id));
      const 名 = [].concat.apply([], 組.map((g) => g.names || []));
      return ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].filter((id, i) => 名.indexOf(['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう'][i]) !== -1);
    }
    return 上.map((x) => x.id);
  }
  if (t.cart === 'quizou') {
    const rows = r.ranking || [];
    if (r.variant === 'quizlist' && r.style === 'coop') return r.success ? rows.map((x) => x.id) : [];
    // 脱落形式は「最後の1人」だけが勝ち。**勝者なしの時間切れ（2人以上が残った）は誰も祝わない**
    if (r.variant === 'quizlist') return r.winner ? rows.filter((x) => x.name === r.winner).slice(0, 1).map((x) => x.id) : [];
    if (r.variant === 'buzzer' && r.champion) return rows.filter((x) => x.name === r.champion).slice(0, 1).map((x) => x.id);
    // 点で決まるもの：1位でも**0点なら祝わない**
    return rows.filter((x) => x.rank === 1 && x.score !== 0).map((x) => x.id);
  }
  return ((r.ranking) || []).filter((x) => x.rank === 1 && !x.out && !x.failed).map((x) => x.id);
}

(async function main() {
  const r = createRunner('clear-fx：クリア演出（指示60 A-2）');

  // ===================== ① 正本の照合 =====================
  await r.test('① 棚に出ている全カセットに、クリア演出の行がある（両方向・落とし穴20）', async () => {
    const { win, doc } = await launch();
    try {
      const p = win.clearLookProbe();
      const 棚 = p.棚;
      // 型(b)：棚が本当に読めている
      assert(棚.length >= 8, '棚のカセットが読める（実際:' + 棚.length + '）');
      /**
       * **ここにだけ、行を持たない理由を書く。**理由の無い除外は置かない。
       * 除外に書いた id も、棚に実在しなければ赤くする（腐った除外を残さない）
       */
      const 別の形 = {
        bakudan: '爆発と対になる1本（bombClearSequence）を3面が呼ぶ（fixes52・fx-probe --clear）'
      };
      const 行 = Object.keys(p.look);
      const 足りない = 棚.filter((id) => 行.indexOf(id) === -1 && !別の形[id]);
      assertEqual(足りない.join('・'), '', 'クリア演出の行が無いカセット');
      const 幽霊 = 行.concat(Object.keys(別の形)).filter((id) => 棚.indexOf(id) === -1);
      assertEqual(幽霊.join('・'), '', '棚に無いカセットの行・除外');
      // 行の中身が、本当にその動きで出る（知らない名前は 'pop' に落ちるので、落ちていないかを見る）
      行.forEach((id) => {
        win.FxKit.skipNow(); win.FxKit.stageClear();
        const look = p.look[id];
        win.FxKit.celebrate(Object.assign({}, look, { text: 'たしかめ', ms: 300 }));
        // **いま出したもの**を見る（前のカセットの祝いは、飛ばされたあと片付く途中で残っている）
        const 全部 = doc.querySelectorAll('.fx-cel');
        const n = 全部[全部.length - 1];
        assert(n, id + '：祝いが出る');
        assert(n.classList.contains('fx-cel-' + look.motion), id + '：主役の出方が「' + look.motion + '」で出る');
        assert(look.pieces, id + '：舞うものがある（紙吹雪の色を変えるだけにしない・§5）');
        // 地は**不透明**（0.97 でも、実サーバーのスクショで後ろの結果の字が読めた・指示60 B-2）
        const 地 = [].concat(look.bg || [], ...Object.values(look.陣営 || {}).map((x) => x.bg || []));
        assert(地.length >= 2, id + '：地の色がある');
        地.forEach((c) => assert(/^rgb\(/.test(c) || /,\s*1\)$/.test(c),
          id + '：地が透けない（' + c + '）'));
        assert(n.querySelectorAll('.fx-cel-p-' + look.pieces).length > 0, id + '：舞うもの（' + look.pieces + '）が並ぶ');
        win.FxKit.skipNow();
      });
    } finally { win.close(); }
  });

  // ===================== ②③ 部屋 =====================
  for (const t of 対象) {
    await r.test('② ' + (t.label || t.game) + '：大画面には、祝う相手の名前でクリア演出が出る（1回だけ）', async () => {
      const g = await 決着まで(t, 'tv');
      try {
        const 相手 = 祝う相手(t, g.v);
        const 祝い = g.記録.filter((x) => x.何 === '祝い');
        if (!相手.length) {
          // 祝う相手がいない決着（協力の失敗・生きのこり0人）は、静かに（原則C）
          assertEqual(祝い.length, 0, t.game + '：祝う相手がいない時は出さない');
          return;
        }
        assertEqual(祝い.length, 1, t.game + '：大画面にクリア演出が1回出る（' + JSON.stringify(g.記録) + '）');
        assert(!/あなた|じぶん|自分/.test(祝い[0].文), t.game + '：大画面は二人称を使わない（' + 祝い[0].文 + '）');
        assertEqual(g.記録.filter((x) => x.何 === '称号').length, 0, t.game + '：大画面に称号は出ない');
        assertNoErrors(g.errors, t.game + '（大画面）');
      } finally { g.win.close(); }
    });

    await r.test('② ' + (t.label || t.game) + '：スマホは祝う相手の端末にだけ出る。称号は祝いのあと', async () => {
      const g = await 決着まで(t, 'm1');
      try {
        const 相手 = 祝う相手(t, g.v);
        const 祝い = g.記録.filter((x) => x.何 === '祝い');
        if (相手.indexOf('m1') !== -1) {
          assertEqual(祝い.length, 1, t.game + '：勝った人（この端末）に出る（' + JSON.stringify(g.記録) + '）');
          const 称号 = g.記録.find((x) => x.何 === '称号');
          if (称号) assert(称号.ms > 祝い[0].ms, t.game + '：称号は祝いのあと（' + JSON.stringify(g.記録) + '）');
        } else {
          assertEqual(祝い.length, 0, t.game + '：勝っていない端末には出さない（責める時は静かに）');
        }
        assertNoErrors(g.errors, t.game + '（スマホ）');
      } finally { g.win.close(); }
    });
  }

  await r.test('③ スキップ設定の大画面では、クリア演出は出ない（すぐ結果）', async () => {
    // 1つのゲームで十分（部品の門は fx.js の1か所。tests/fx.js が部品として見ている）。
    // 祝う相手が必ずいるゲームで見る（型(b)：相手がいなければ「出ない」は自明）
    const t = 対象.find((x) => x.game === 'auction');
    const ふつう = await 決着まで(t, 'tv');
    const 出た = ふつう.記録.filter((x) => x.何 === '祝い').length;
    ふつう.win.close();
    assertEqual(出た, 1, '前提：ふつうの速さなら出る');
    const g = await 決着まで(t, 'tv', { fxSkip: true });
    try {
      assertEqual(g.記録.filter((x) => x.何 === '祝い').length, 0, 'スキップ設定では描かない');
    } finally { g.win.close(); }
  });

  // ===================== ④ 手渡し =====================
  await r.test('④ あれそれ（手渡し）：スコア画面で、そのラウンドのいちばんを杏色の札で祝う。称号はそのあと', async () => {
    const { win, doc, errors } = await launch();
    autoDialog(win, doc);
    win.TitleLogic.seasonFor = () => null;
    const 記録 = [];
    const mo = new win.MutationObserver((recs) => recs.forEach((rec) => {
      Array.from(rec.addedNodes).forEach((n) => {
        if (n.classList && n.classList.contains('fx-cel')) {
          記録.push('祝い@' + activeScreen(doc) + ':' + ((n.querySelector('.fx-cel-text') || {}).textContent || '') +
            (n.classList.contains('fx-cel-stamp') ? '(判子)' : '') +
            (n.querySelector('.fx-cel-p-card') ? '(札)' : ''));
        }
      });
      if (rec.type === 'attributes' && rec.target.id === 'titleGotOverlay' &&
          rec.target.classList.contains('show')) 記録.push('称号');
    }));
    mo.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    try {
      await setupPlayers(win, doc);
      await waitScreen(win, doc, 'scr-mode', 3000);
      click(doc, 'modeAutoBtn');
      await sleep(win, 80);
      if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
      await waitScreen(win, doc, 'scr-ready', 3000);
      el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
      await waitScreen(win, doc, 'scr-play', 8000);
      click(doc, 'btnCorrect');
      await sleep(win, 80);
      const who = doc.querySelectorAll('#pickerGrid button[data-id]');
      assert(who.length > 0, '前提：正解した人を選べる');   // 型(b)：0点のラウンドは祝わない
      const 名 = who[0].textContent.trim();
      who[0].click();
      await sleep(win, 120);
      click(doc, 'endRoundBtn');
      await waitScreen(win, doc, 'scr-score', 8000);
      await waitFor(win, () => 記録.indexOf('称号') !== -1, 6000, '称号');
      assert(/^祝い@scr-score:/.test(記録[0] || ''), 'スコア画面で祝う（' + 記録.join(' → ') + '）');
      assert(記録[0].indexOf(名) !== -1 || 名.indexOf(記録[0].split(':')[1].replace(/\(.*$/, '')) !== -1,
        '点を取った人の名前で祝う（' + 記録[0] + ' / ' + 名 + '）');
      assert(/\(判子\)\(札\)/.test(記録[0]), 'あれそれの世界（判子と札）で祝う（' + 記録[0] + '）');
      assertEqual(記録.indexOf('称号'), 1, '称号は祝いのあと（' + 記録.join(' → ') + '）');
      assertNoErrors(errors);
    } finally { mo.disconnect(); win.close(); }
  });

  await r.test('④ ロシアンカード（いっきうち・手渡し）：「けっかを見る」のあと🃏→🏆で祝い、祝いの後ろで結果へ', async () => {
    const { win, doc, errors } = await launch();
    try {
      const cart = doc.querySelector('.cart[data-cart="rcard"]');
      cart.click();
      if (activeScreen(doc) === 'scr-shelf') cart.click();
      await sleep(win, 100);
      passPlayWay(doc);
      await sleep(win, 80);
      if (activeScreen(doc) === 'scr-game') { pickGame(doc, 'rcard'); await sleep(win, 80); }
      if (activeScreen(doc) === 'scr-setup') await fillPlayerForm(win, doc, ['あき', 'びび']);
      await waitScreen(win, doc, 'scr-mode', 4000);
      click(doc, doc.querySelector('.mode-card[data-id="rcard-duel"]'));
      click(doc, 'modeNextBtn');
      await sleep(win, 80);
      for (let i = 0; i < 10; i++) {
        const cur = activeScreen(doc);
        if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
        const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
        if (!next) break;
        next.click();
        await sleep(win, 40);
      }
      if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 80); }
      await waitScreen(win, doc, 'scr-ready', 4000);
      el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
      await waitScreen(win, doc, 'scr-rc-pass', 8000);
      // 2人ぶん、しかける（盤の頭から）
      for (let 人 = 0; 人 < 2; 人++) {
        click(doc, 'rcPassRevealBtn');
        await sleep(win, 50);
        for (let i = 1; i <= 9; i++) {
          if (!el(doc, 'rcPassDoneBtn').disabled) break;
          const b = doc.querySelector('#rcPassBoard [data-rc-cell="' + i + '"]');
          if (b) { b.click(); await sleep(win, 15); }
        }
        click(doc, 'rcPassDoneBtn');
        await sleep(win, 60);
      }
      await waitScreen(win, doc, 'scr-rc-turn', 4000);
      // めくり合う（頭から＝爆弾）。どちらかの体力が0になるまで
      for (let 手 = 0; 手 < 30; 手++) {
        if (el(doc, 'rcTurnBody').style.display === 'none') { click(doc, 'rcTurnRevealBtn'); await sleep(win, 50); }
        const b = doc.querySelector('#rcTurnBoard [data-rc-cell]:not(:disabled)');
        if (b) { b.click(); await sleep(win, 450); }
        if (/けっか/.test(el(doc, 'rcTurnNextBtn').textContent)) break;
        click(doc, 'rcTurnNextBtn');
        await sleep(win, 80);
      }
      assert(/けっか/.test(el(doc, 'rcTurnNextBtn').textContent), '前提：決着した（「けっかを見る」が出た）');  // 型(b)
      const 記録 = [];
      const mo = new win.MutationObserver((recs) => recs.forEach((rec) => {
        Array.from(rec.addedNodes).forEach((n) => {
          if (n.classList && n.classList.contains('fx-cel')) 記録.push('出た@' + activeScreen(doc) +
            (n.querySelector('.fx-cel-card') ? '(札)' : ''));
        });
        Array.from(rec.removedNodes).forEach((n) => {
          if (n.classList && n.classList.contains('fx-cel')) 記録.push('消えた@' + activeScreen(doc));
        });
      }));
      mo.observe(doc.body, { childList: true, subtree: true });
      click(doc, 'rcTurnNextBtn');
      await waitScreen(win, doc, 'scr-rc-done', 6000);
      await waitFor(win, () => 記録.some((x) => /^消えた/.test(x)), 4000, '祝いが片付く');
      mo.disconnect();
      assertEqual(記録.join(' / '), '出た@scr-rc-turn(札) / 消えた@scr-rc-done',
        '盤の上で🃏の札がめくれ、祝いが消えた時にはもう結果画面');
      assertNoErrors(errors);
    } finally { win.close(); }
  });

  // ===================== ⑤ 指示60 の見直しで見つけたもの =====================
  await r.test('⑤ つぎつぎ（脱落形式）が時間切れで終わると、誰にも「優勝！」を出さない（大画面・スマホ）', async () => {
    // 既定は協力形式なので、②の quizlist は脱落形式を一度も通っていなかった（型(b)で分かった）
    const t = Object.assign({}, 対象.find((x) => x.game === 'quizlist'), { cfg: { style: 'survival' }, 全体の時間切れ: true });
    for (const 自分 of ['tv', 'm1']) {
      const g = await 決着まで(t, 自分);
      try {
        const r0 = g.v.result || {};
        // 型(b)：本当に「勝者なしの時間切れ・2人以上が残った」を作れているか
        assert(r0.variant === 'quizlist' && r0.style !== 'coop', '前提：脱落形式（' + r0.style + '）');
        assert(!r0.winner, '前提：勝者なし（' + r0.winner + '）');
        assert((r0.ranking || []).filter((x) => x.rank === 1).length >= 2, '前提：同率1位が2人以上（全員0点）');
        assertEqual(g.記録.filter((x) => x.何 === '祝い').length, 0,
          自分 + '：勝った人がいないので祝わない（' + JSON.stringify(g.記録) + '）');
        assertNoErrors(g.errors, 自分);
      } finally { g.win.close(); }
    }
  });

  await r.test('⑤ 競争版の「もう一度」：前の試合で全部解いた人に、始まった瞬間の「解除成功！」が出ない（落とし穴18）', async () => {
    const { win, doc, errors } = await launch({ fakeSocket: true });
    try {
      win.TitleLogic.seasonFor = () => null;
      await waitScreen(win, doc, 'scr-shelf', 9000);
      await openCassette(win, doc, 'bakudan');
      click(doc, doc.querySelector('#wayChoices [data-way="room"]'));
      await waitScreen(win, doc, 'scr-rt-lobby', 5000);
      const fake = win.__rtFake;
      await waitFor(win, () => fake.connected, 5000, 'socket');

      const members = new Map();
      ['m1', 'm2'].forEach((id, i) => members.set(id, { id, name: ['あき', 'びび'][i], role: 'player', connected: true, socketId: 's' + id }));
      const room = { code: 'ABC234', members, state: { phase: 'playing', game: 'bomb', data: {} } };
      const 始める = () => {
        const res = Bomb.startGame(room, { mode: 'race', counts: { easy: 4 }, lives: 3, timerSec: 0 }, {});
        assertEqual(res.ok, true, '進行役を始められる（' + JSON.stringify(res) + '）');
        room.state.phase = 'playing';
      };
      const 行 = () => ['m1', 'm2'].map((id, i) => ({ id, name: ['あき', 'びび'][i], role: 'player', connected: true, isHost: i === 0, ready: true }));
      const snap = () => ({
        code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1', playerCount: 2, memberCount: 2,
        ready: { count: 2, total: 2, waitingNames: [], all: true }, members: 行(),
        state: { phase: room.state.phase, game: 'bomb', data: room.bomb ? Bomb.publicView(room) : {} }
      });
      fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: 'm1', room: snap() }) };
      始める();
      el(doc, 'rtCreateName').value = 'あき';
      click(doc, 'rtCreateBtn');
      await sleep(win, 300);
      const 部屋 = () => fake.fire('room:update', snap());
      const 秘密 = () => fake.fire('wolf:you', Bomb.privateFor(room, 'm1'));
      部屋(); 秘密();
      await waitScreen(win, doc, 'scr-rt-bomb', 6000);

      // 試合1：あきが全部解く。びびは外し続けて脱落（決着させる）
      for (let i = 0; i < 20; i++) {
        const e = room.bomb.entries.m1;
        const uid = e.order.find((u) => !e.solved[u]);
        if (!uid || room.bomb.phase === 'ended') break;
        const wire = room.bomb.wires.find((x) => x.uid === uid);
        Bomb.submitAction(room, 'm1', uid);
        Bomb.submitVote(room, 'm1', (e.choices[uid] || []).find((c) => BombLogic.isCorrect(wire, c)));
        部屋(); 秘密();
        await sleep(win, 30);
      }
      for (let i = 0; i < 10 && room.bomb.phase !== 'ended'; i++) {
        const e = room.bomb.entries.m2;
        const uid = e.order.find((u) => !e.solved[u]);
        if (!uid) break;
        const wire = room.bomb.wires.find((x) => x.uid === uid);
        Bomb.submitAction(room, 'm2', uid);
        Bomb.submitVote(room, 'm2', (e.choices[uid] || []).find((c) => !BombLogic.isCorrect(wire, c)));
        部屋(); 秘密();
        await sleep(win, 30);
      }
      assertEqual(room.bomb.phase, 'ended', '前提：試合1が決着した');   // 型(b)
      const 前の秘密 = Bomb.privateFor(room, 'm1');
      assert(前の秘密.total > 0 && 前の秘密.solvedCount >= 前の秘密.total, '前提：あきの手元の秘密は「全部解いた」のまま');
      await sleep(win, 2600);   // 試合1の祝いが済むのを待つ

      // 「もう一度」：いったん待合（秘密は送り直されない）→ 新しい試合。**部屋の知らせが先、秘密が後**
      room.state.phase = 'lobby';
      room.bomb = null;
      fake.fire('room:update', snap());
      await sleep(win, 200);
      let 祝い = 0;
      const mo = new win.MutationObserver((recs) => recs.forEach((rec) => Array.from(rec.addedNodes).forEach((n) => {
        if (n.classList && (n.classList.contains('fx-cel') || n.classList.contains('fx-blackout'))) 祝い++;
      })));
      mo.observe(doc.body, { childList: true, subtree: true });
      始める();
      部屋();
      await waitScreen(win, doc, 'scr-rt-bomb', 6000);   // 型(b)：古い秘密のまま、新しい試合の盤へ移った
      await sleep(win, 300);
      const 秘密より前 = 祝い;
      秘密();
      await sleep(win, 300);
      mo.disconnect();
      assertEqual(秘密より前, 0, '新しい秘密が届く前に、前の試合の祝い・幕が出ない');
      assertEqual(祝い, 0, '新しい秘密が届いたあとも出ない');
      assertNoErrors(errors);
    } finally { win.close(); }
  });

  for (const 時間切れ of [true, false]) {
    await r.test('⑤ ロシアンカードの大画面：' + (時間切れ ? '時間切れは「⏱ 時間切れ」（めくっていない）' : 'めくって爆弾なら「💣 ばくだんをめくった」'), async () => {
      const { win, doc, errors } = await launch({ fakeSocket: true });
      try {
        await waitScreen(win, doc, 'scr-shelf', 9000);
        await openCassette(win, doc, 'rcard');
        const way = doc.querySelector('#wayChoices [data-way="room"]');
        if (way) click(doc, way);
        await waitScreen(win, doc, 'scr-rt-lobby', 5000);
        const fake = win.__rtFake;
        await waitFor(win, () => fake.connected, 5000, 'socket');
        const members = new Map();
        ['m1', 'm2'].forEach((id, i) => members.set(id, { id, name: ['あき', 'びび'][i], role: 'player', connected: true, socketId: 's' + id }));
        members.set('tv', { id: 'tv', name: 'TV', role: 'bigscreen', connected: true, socketId: 'stv' });
        const room = { code: 'ABC234', members, state: { phase: 'playing', game: 'rcard', data: {} } };
        let x = 7;
        const rand = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
        Rcard.startGame(room, { game: 'rcard', lives: 3, finalBombs: 3, turnSec: 15, _rand: rand }, {});
        const w = room.rcard;
        w.placed = { m1: true, m2: true };
        w.bombsOnBoard = { m1: [1, 2, 3], m2: [1, 2, 3] };
        Rcard.advance(room);   // place → turn
        const snap = () => ({
          code: 'ABC234', ownerUserId: 1, ownerUsername: 'kuma', hostMemberId: 'm1', playerCount: 2, memberCount: 3,
          ready: { count: 2, total: 2, waitingNames: [], all: true },
          members: [{ id: 'tv', name: 'TV', role: 'bigscreen', connected: true, isHost: false, ready: true }]
            .concat(['m1', 'm2'].map((id, i) => ({ id, name: ['あき', 'びび'][i], role: 'player', connected: true, isHost: i === 0, ready: true }))),
          state: { phase: 'playing', game: 'rcard', data: Rcard.publicView(room) }
        });
        fake.replies = { 'room:create': () => ({ ok: true, code: 'ABC234', memberId: 'tv', room: snap() }) };
        el(doc, 'rtCreateName').value = 'TV';
        click(doc, 'rtCreateBtn');
        await sleep(win, 300);
        fake.fire('room:update', snap());
        await waitScreen(win, doc, 'scr-rt-big', 6000);
        const m = w.matches[0];
        const 手番 = m.turn === 'a' ? m.a : m.b;
        if (!時間切れ) Rcard.submitAction(room, 手番, null, { flip: 1 });   // 1 は爆弾
        Rcard.advance(room);   // turn → show（めくらなければ、時間切れで体力−1）
        // 型(b)：本当にその場面になったか
        assertEqual(w.phase, 'show', '前提：めくった結果を見せる段階');
        assertEqual(!!(w.last && w.last.timeout), 時間切れ, '前提：' + (時間切れ ? '時間切れ' : 'めくった'));
        assert(w.last.hit, '前提：体力が減る回');
        fake.fire('room:update', snap());
        await sleep(win, 120);
        const 行 = Array.from(doc.querySelectorAll('#bigList .bl-item'));
        const 名 = 手番 === 'm1' ? 'あき' : 'びび';
        const その人 = 行.find((n) => (n.querySelector('.bl-name') || {}).textContent === 名);
        assert(その人, '名簿にその人の行がある');
        const 印 = (その人.querySelector('.bl-sub') || { textContent: '' }).textContent;
        if (時間切れ) {
          assertEqual(印, '⏱ 時間切れ', '時間切れの人の行');
          assert(!行.some((n) => /ばくだんをめくった/.test(n.textContent)), 'めくっていない人を「めくった」と言わない');
        } else {
          assertEqual(印, '💣 ばくだんをめくった', 'めくった人の行');
        }
        assertNoErrors(errors);
      } finally { win.close(); }
    });
  }

  r.finish();
})();
