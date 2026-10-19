// tests/fixes63.js — 指示63 で直したこと（審査会の指摘の洗い出し＝指示62 から）
//
// 検体は**本物の進行役と本物の publicSnapshot**から作る（落とし穴25）。
// 手で書いた偽の状態を画面に流すと、サーバーが送らない形を画面が読めてしまう。
//
// ## 第5部：ワードウルフ（人狼カセットの既定）
//   ・お題を見たら、すぐ話し合い（人狼の「作戦会議」を通らない）
//   ・役職を使わない回は「あなたの役職」の欄を出さない（ウルフ本人に「シープ」と出ていた）
//   ・手元にも話し合いの時計（設定「常に表示」が手元にも効く）

const { createRunner, assert, assertEqual,
  launch, activeScreen, sleep, waitScreen, waitFor, el, click, openCassette,
  assertNoErrors } = require('./harness');
const { GAME_DRIVERS, publicSnapshot } = require('../realtime');
const { RT_START_MIN_CONFIG } = require('./inventory');

const NAMES = ['あき', 'びび', 'ちか', 'でん'];

/** 本物のワードウルフの部屋（進行役の状態つき）。cfg は RT_START_MIN_CONFIG に重ねる */
function wwRoom(cfg) {
  const d = GAME_DRIVERS.wordwolf.driver;
  const members = new Map();
  NAMES.forEach((n, i) => {
    const id = 'm' + (i + 1);
    members.set(id, { id, name: n, role: 'player', connected: true, joinedAt: i, readyGame: null, look: null });
  });
  const room = { code: 'WWW234', hostMemberId: 'm1', ownerUserId: 1, ownerUsername: 'kuma',
    members, state: { phase: 'lobby', game: 'wordwolf', data: {} } };
  const res = d.startGame(room, Object.assign({}, RT_START_MIN_CONFIG.wordwolf, cfg || {}), { notify() {} });
  assertEqual(res.ok, true, 'ワードウルフを始められる（' + (res.error || '') + '）');
  room.state.game = 'wordwolf';
  return { room, d, w: room.wordwolf };
}

/** 本物の部屋の状態を、本物の画面へ流す（自分は me） */
async function 画面へ(x, me) {
  const { win, doc, errors } = await launch({ fakeSocket: true });
  await waitScreen(win, doc, 'scr-shelf', 9000);
  await openCassette(win, doc, 'jinro');
  const way = doc.querySelector('#wayChoices [data-way="room"]');
  if (way) way.click();
  await waitScreen(win, doc, 'scr-rt-lobby', 5000);
  const fake = win.__rtFake;
  await waitFor(win, () => fake.connected, 5000, '疑似socket');
  fake.replies = { 'room:join': () => ({ ok: true, code: x.room.code, memberId: me, room: publicSnapshot(x.room) }) };
  el(doc, 'rtJoinCode').value = x.room.code;
  el(doc, 'rtJoinName').value = NAMES[0];
  click(doc, 'rtJoinBtn');
  const push = async () => {
    fake.fire('room:update', publicSnapshot(x.room));
    const mine = x.d.privateFor(x.room, me);
    if (mine) fake.fire('wolf:you', mine);
    await sleep(win, 90);
  };
  await waitFor(win, () => String(activeScreen(doc)).indexOf('scr-' + 'rt-') === 0, 8000, '部屋の画面へ');
  await push();
  await waitScreen(win, doc, 'scr-rt-play', 5000);
  return { win, doc, errors, push };
}

async function run() {
  const r = createRunner('fixes63：指示63（審査会の指摘から）');

  // ===================== 第5部：ワードウルフ =====================

  await r.test('63-5：ワードウルフはお題を見たら、すぐ話し合い（作戦会議を通らない）', async () => {
    const x = wwRoom({ discussSec: 180, meetingSec: 180 });
    assertEqual(x.w.phase, 'reveal', 'お題を見る段階から始まる');   // 型(b)
    NAMES.forEach((n, i) => x.d.submitAction(x.room, 'm' + (i + 1), null, {}));
    x.d.advance(x.room);
    assertEqual(x.w.phase, 'discuss', 'お題の確認のあとは、話し合い（meeting ではない）');
    assert(x.w.deadline && x.w.deadline - Date.now() > 170000, '話し合いの時計（3分）が動き出す');
  });

  await r.test('63-5：役職を使わない回は「あなたの役職」を出さない（ウルフにも、シープにも）', async () => {
    const x = wwRoom({ roles: {}, wolfAware: false });
    assertEqual(Object.keys(x.w.roles).length, 0, '役職を使わない回になっている');   // 型(b)
    const ウルフ = x.w.wolfIds[0];
    const シープ = x.w.playerIds.find((id) => x.w.wolfIds.indexOf(id) === -1);
    for (const me of [ウルフ, シープ]) {
      const g = await 画面へ(x, me);
      try {
        const box = g.doc.getElementById('rtYouBox');
        assert(box.textContent.indexOf(x.d.privateFor(x.room, me).topic) !== -1, 'お題は出ている（型(b)：描けている）');
        assert(box.textContent.indexOf('あなたの役職') === -1, (me === ウルフ ? 'ウルフ' : 'シープ') + 'の手元に役職の欄が無い');
        assert(box.textContent.indexOf('シープ🐑') === -1, '「シープ」のうそが出ていない');
        assertNoErrors(g.errors, '役職なしの描画で未捕捉の例外');
      } finally { g.win.close(); }
    }
  });

  await r.test('63-5：役職を使う回は、手渡しと同じ言い方（自覚のあるウルフは「ウルフ🐺」）', async () => {
    // 型(c)：もう一方の分岐。役職ありの回は欄を出す
    const x = wwRoom({ roles: { peek: 1 }, wolfAware: true });   // 1回勝負の役職（wordwolf-logic ROLE_SETS.single）
    assert(Object.keys(x.w.roles).length > 0, '役職を使う回になっている');
    const ウルフ = x.w.wolfIds[0];
    const g = await 画面へ(x, ウルフ);
    try {
      const box = g.doc.getElementById('rtYouBox');
      assert(box.textContent.indexOf('あなたの役職') !== -1, '役職ありの回は欄がある');
      assert(box.textContent.indexOf('ウルフ🐺') !== -1, '自覚のあるウルフには「ウルフ🐺」と出る');
    } finally { g.win.close(); }
  });

  await r.test('63-5：手元にも話し合いの時計が出る（設定の「常に表示」が手元にも効く）', async () => {
    const x = wwRoom({ discussSec: 180 });
    NAMES.forEach((n, i) => x.d.submitAction(x.room, 'm' + (i + 1), null, {}));
    x.d.advance(x.room);
    assertEqual(x.w.phase, 'discuss', '話し合いの段階');               // 型(b)
    assert(publicSnapshot(x.room).state.data.clock, '芯が共通の時計を配っている');
    const g = await 画面へ(x, 'm1');
    try {
      const chip = g.doc.getElementById('rtPlayTimer');
      assert(chip, '時計の置き場がある');
      await waitFor(g.win, () => chip.style.display !== 'none' && /^0[23]:\d\d$/.test(chip.textContent), 3000,
        '時計が出て、残り（2〜3分）を数えている（いま「' + chip.textContent + '」）');
      assert(chip.hasAttribute('data-timer'), '「時間の見せ方」の設定が効く印（data-timer）がある');
    } finally { g.win.close(); }
  });

  // ===================== くまくんの判断1：ゲストの称号は、その日のうちは端末に残す =====================

  /**
   * 取った一覧・着けた姿・NEW の印を、日本時間の日付つきで端末に置く。
   * **同じ日に読み込み直しても残る／日付が変わったら消える**（完成の門に足した2行）。
   * 「日付が変わった」は、前の日の日付で書かれた記録を置いて立ち上げることで作る
   *（端末の時計を進めるのと同じ：読む側は「今日の日付と違えば捨てる」しか見ない）
   */
  const 日付 = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const 記録 = (day) => JSON.stringify({
    day, stats: { bakudan: { plays: 1 } }, unlocked: ['icon-bomb-1'],
    equipped: { icon: 'icon-bomb-1', first: 'first-hajime', joiner: 'joiner-no', last: 'last-ippo' },
    newIds: ['icon-bomb-1']
  });

  await r.test('63（判断1）：ゲストの称号は、同じ日に読み込み直しても残る（取った一覧・姿・NEW）', async () => {
    const t = await launch({ loggedOut: true, browse: true, storage: { 'acac-guest-titles': 記録(日付(Date.now())) } });
    try {
      const p = t.win.titleProbe();
      assert(p.unlocked.indexOf('icon-bomb-1') !== -1, '取った称号が持ち物に残っている');
      assertEqual(p.equipped.icon, 'icon-bomb-1', '着けた姿のまま');
      assert(p.newIds.indexOf('icon-bomb-1') !== -1, 'NEW の印も残っている');
      assert(t.win.localStorage.getItem('acac-guest-titles'), '端末の記録は消えていない');
    } finally { t.win.close(); }
  });

  await r.test('63（判断1）：日付が変わったら、ゲストの称号は消える（端末からも）', async () => {
    const きのう = 日付(Date.now() - 24 * 3600 * 1000);
    const t = await launch({ loggedOut: true, browse: true, storage: { 'acac-guest-titles': 記録(きのう) } });
    try {
      const p = t.win.titleProbe();
      assert(p.unlocked.indexOf('icon-bomb-1') === -1, '前の日に取った称号は、持ち物から消える');
      assertEqual(p.equipped.icon, 'icon-default', '姿は初期にもどる');
      assertEqual(t.win.localStorage.getItem('acac-guest-titles'), null, '端末の記録も消える');
    } finally { t.win.close(); }
  });

  r.finish();
}

module.exports = { run };
if (require.main === module) run();
