// tests/home-screens.js — ふだんの画面（指示66-3：入口・部屋に入る・待合・ゲームをえらぶ・決めた時・つぎは？）
//
// 見本は docs/指示66/見本/entry.html（E1〜E5）と select.html（決定・S4〜S6）。門は docs/指示66/66-3_ふだんの画面.md。
// **部屋の知らせは本物の部屋の箱から作る**（realtime.js の RoomStore と publicSnapshot。落とし穴25）。
// 見た目（大きさ・はみ出し）は tools/v2-shot.js が実ブラウザで測る。ここで見るのは、出るもの・押した時の動き・出てはいけないもの

const H = require('./harness');
const { launch, activeScreen, sleep, waitFor, waitScreen, click, createRunner, assert, assertEqual, assertNoErrors } = H;
const RT = require('../realtime.js');

/** 本物の部屋の箱に n 人（と TV 1台）を入れた知らせ。m1 が進行役 */
function 部屋(n, o) {
  o = o || {};
  const store = new RT.RoomStore();
  const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
  room.code = 'ABC234';
  const 名前 = ['ふう', 'ひろ', 'びび', 'ちか', 'でん', 'くまくん', 'えみ', 'あき', 'りん', 'けん', 'ゆい', 'そうた', 'まりこ', 'たかはし', 'こうへい', 'みさき'];
  const t0 = Date.now() - 60000;
  for (let i = 0; i < n; i++) {
    room.members.set('m' + (i + 1), { id: 'm' + (i + 1), name: 名前[i % 16], role: RT.ROLE_PLAYER, socketId: null, connected: true,
      joinedAt: t0 + i * 1000, lastSeen: Date.now(), readyGame: null, userId: null, look: { icon: '🙂', title: '' } });
  }
  if (o.tv !== false) room.members.set('tv', { id: 'tv', name: 'TV', role: RT.ROLE_BIGSCREEN, socketId: null, connected: true, joinedAt: t0, lastSeen: Date.now(), readyGame: null, userId: null, look: null });
  room.hostMemberId = 'm1';
  if (o.game) { room.state.game = o.game; room.state.data = { modeId: o.mode || o.game }; }
  return JSON.parse(JSON.stringify(RT.publicSnapshot(room)));
}
/** 部屋をつくった進行役（m1）か、入った人（memberId）として、待合まで進める */
async function 部屋に入る(t, snap, memberId) {
  const fake = t.win.__rtFake;
  fake.replies = {
    'room:create': () => ({ ok: true, code: snap.code, memberId: 'm1', room: snap }),
    'room:join': () => ({ ok: true, code: snap.code, memberId: memberId, room: snap }),
    'room:peek': () => ({ ok: true, code: snap.code, game: null, phase: 'lobby', playerCount: snap.playerCount, fes: false })
  };
  if (!memberId || memberId === 'm1') await H.makeRoomV2(t.win, t.doc);
  else await H.joinRoomV2(t.win, t.doc, snap.code, 'くまくん');
  return fake;
}
const 一覧の札 = (doc) => Array.from(doc.querySelectorAll('#scr-v2-pick [data-home-card]'));

(async function main() {
  const r = createRunner('home-screens：ふだんの画面（指示66-3）');

  // ===================== E1 入口 =====================
  await r.test('E1 入口：押せるのは「部屋をつくる」「部屋に入る」「1台で遊ぶ」の3つだけ。ログインと設定は右上の⚙の中', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    assertEqual(activeScreen(t.doc), 'scr-v2-home', '扉のあとは新しい入口');
    const acts = Array.from(t.doc.querySelectorAll('#scr-v2-home .v2-in [data-home-act]')).map((b) => b.dataset.homeAct);
    assertEqual(acts.join(','), 'make,join,one', '入口のボタンは3つだけ（部屋を持っていない時）');
    assert(!/ログイン/.test(t.doc.querySelector('#scr-v2-home .v2-in').textContent.replace(/さんでログインしています/, '')), '入口の本文にログインのボタンは出さない');
    click(t.doc, t.doc.querySelector('#scr-v2-home [data-v2-act="gear"]'));
    await sleep(t.win, 60);
    assert(t.doc.getElementById('settingsOverlay').classList.contains('show'), '⚙で設定が開く（ログインもこの中）');
    assertNoErrors(t.errors, '入口');
    t.win.close();
  });

  await r.test('E1 入口：「1台で遊ぶ」はログインしていなくても、ゲームをえらぶ一覧まで行ける（見本 S5）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true, loggedOut: true });
    click(t.doc, t.doc.querySelector('#scr-v2-home [data-home-act="one"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    assert(一覧の札(t.doc).length >= 9, '一覧が出ている（実際:' + 一覧の札(t.doc).length + '枚）');
    t.win.close();
  });

  // ===================== E2 部屋に入る =====================
  await r.test('E2：コードは6文字。ボタンに「あと何文字か」、そろったら「入る」。名前は前に使ったものが入っている', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true, storage: { home_name_v1: 'くまくん' } });
    click(t.doc, t.doc.querySelector('#scr-v2-home [data-home-act="join"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-join', 3000);
    const inp = t.doc.querySelector('#scr-v2-join [data-home-code]');
    const btn = () => t.doc.querySelector('#scr-v2-join [data-home-act="code-go"]');
    assertEqual(btn().textContent, 'あと6文字', 'はじめは あと6文字');
    assert(btn().disabled, 'そろうまで押せない');
    inp.value = 'abc23'; inp.dispatchEvent(new t.win.Event('input', { bubbles: true }));
    assertEqual(btn().textContent, 'あと1文字', '5文字で あと1文字');
    assertEqual(Array.from(t.doc.querySelectorAll('#scr-v2-join .v2-code6 b')).map((b) => b.textContent).join(''), 'ABC23', '箱に大文字で入る');
    inp.value = 'abc234'; inp.dispatchEvent(new t.win.Event('input', { bubbles: true }));
    assertEqual(btn().textContent, '入る', 'そろったら「入る」');
    assert(!btn().disabled, 'そろったら押せる');
    t.win.__rtFake.replies = { 'room:peek': () => ({ ok: true, code: 'ABC234', game: null, phase: 'lobby', playerCount: 3, fes: false }) };
    click(t.doc, btn());
    await waitFor(t.win, () => t.doc.querySelector('#scr-v2-join [data-home-name]'), 3000, '名前の画面');
    assertEqual(t.doc.querySelector('#scr-v2-join [data-home-name]').value, 'くまくん', '前に使った名前が入っている');
    assert(/ABC234 に入る/.test(t.doc.querySelector('#scr-v2-join [data-home-act="join-go"]').textContent), 'ボタンにコードが出る');
    assertNoErrors(t.errors, '部屋に入る');
    t.win.close();
  });

  await r.test('E2：QR で来た人は、コードを飛ばして名前から（?room= の時に扉が呼ぶ openV2Join と同じ関数）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    t.win.__rtFake.replies = { 'room:peek': () => ({ ok: true, code: 'ABC234', game: null, phase: 'lobby', playerCount: 3, fes: false }) };
    t.win.homeOpenJoin({ code: 'ABC234' });
    await waitFor(t.win, () => activeScreen(t.doc) === 'scr-v2-join' && t.doc.querySelector('#scr-v2-join [data-home-name]'), 5000, 'QR から名前の画面');
    // 扉がそうしていること（?room= を見て openV2Join を呼ぶ）も、書いてある所を照らす
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/openV2Join\(\{ code: invited \|\| '', tv: asTv \}\)/.test(html), '扉は QR のコードを openV2Join に渡す');
    assert(!t.doc.querySelector('#scr-v2-join [data-home-code]'), 'コードの欄は出さない');
    t.win.close();
  });

  // ===================== E3・E4 待合 =====================
  await r.test('E3：進行役のスマホは「コード」「TVに映す」「ゲームをえらぶ」の3つ。人を外すのは札の長押し（たずねてから外す）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const fake = await 部屋に入る(t, 部屋(6));
    assertEqual(activeScreen(t.doc), 'scr-v2-room', '待合');
    const scr = t.doc.getElementById('scr-v2-room');
    assert(scr.querySelector('.v2-ecode b').textContent === 'ABC234', 'コードが大きく出る');
    assert(scr.querySelector('.v2-in [data-v2-open="#v2RoomTv"]'), 'TVに映す');
    assert(scr.querySelector('.v2-in [data-home-act="room-pick"]'), 'ゲームをえらぶ');
    assertEqual(scr.querySelectorAll('.v2-in .v2-mem').length, 6, '入った人の札（TV の端末は数えない）');
    const 長押し = scr.querySelectorAll('.v2-in .v2-mem[data-v2-lp]');
    assertEqual(長押し.length, 5, '自分以外の札だけ長押しできる');
    // 外す：シートの「外す」→ たずねる枠 →「外す」で送る
    V2open(t, '#v2Mem-m3');
    click(t.doc, scr.querySelector('[data-v2-id="v2Mem-m3"] [data-home-act="room-kick"]'));
    await sleep(t.win, 40);
    const ask = scr.querySelector('[data-v2-id="v2Ask"]');
    assert(ask && ask.classList.contains('is-open'), '外す前にたずねる');
    assert(/びび/.test(ask.textContent), 'だれを外すか書いてある');
    fake.replies['room:kick'] = () => ({ ok: true });
    click(t.doc, ask.querySelector('[data-v2-act="home-ask-ok"]'));
    await sleep(t.win, 60);
    assert(fake.emits.some((x) => x.name === 'room:kick' && x.payload && x.payload.memberId === 'm3'), '外すを送った');
    assertNoErrors(t.errors, '待合（進行役）');
    t.win.close();
  });

  await r.test('E3：だれかが入ると、札がポンと増える（その時だけ）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const fake = await 部屋に入る(t, 部屋(5));
    assertEqual(t.doc.querySelectorAll('#scr-v2-room .v2-mem.v2-born').length, 0, '最初は動かない');
    fake.fire('room:update', 部屋(6));
    await sleep(t.win, 40);
    const born = t.doc.querySelectorAll('#scr-v2-room .v2-mem.v2-born');
    assertEqual(born.length, 1, '入った1人だけポンと出る');
    assert(/くまくん/.test(born[0].textContent), '入った人の札');
    fake.fire('room:update', 部屋(6));
    await sleep(t.win, 40);
    assertEqual(t.doc.querySelectorAll('#scr-v2-room .v2-mem.v2-born').length, 0, '次の知らせでは動かない');
    t.win.close();
  });

  await r.test('E4：参加者は待つだけ。自分の札が上に大きく、着替えは文化祭と同じシート。ゲームをえらぶボタンは無い', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    await 部屋に入る(t, 部屋(6), 'm6');
    const scr = t.doc.getElementById('scr-v2-room');
    assertEqual(activeScreen(t.doc), 'scr-v2-room', '待合');
    assert(/くまくん/.test(scr.querySelector('.v2-me').textContent), '自分の札');
    assert(!scr.querySelector('[data-home-act="room-pick"]'), 'えらぶのは進行役だけ');
    assert(scr.querySelector('[data-v2-id="v2Look"]'), '着替えのシート（文化祭と同じ部品）');
    assert(scr.querySelector('[data-v2-id="v2LookIcon"]') && scr.querySelector('[data-v2-id="v2LookName"]'), 'アイコンと二つ名は別のシート');
    t.win.close();
  });

  // ===================== ゲームをえらぶ =====================
  await r.test('一覧：分類ごとに縦にならぶ（上のチップで飛ぶ）。どのゲームも1回だけ出る', async () => {
    const t = await launch({ fakeSocket: true });
    assertEqual(activeScreen(t.doc), 'scr-v2-pick', '1台で遊ぶ一覧');
    const 分類 = Array.from(t.doc.querySelectorAll('#scr-v2-pick [data-home-g]')).map((g) => g.dataset.homeG);
    assertEqual(分類.join(','), 'brain,deal,hide,word', '分類の順（見本と同じ）');
    const チップ = Array.from(t.doc.querySelectorAll('#scr-v2-pick [data-home-chip]')).map((g) => g.dataset.homeChip);
    assertEqual(チップ.join(','), 'all,brain,deal,hide,word', 'チップ');
    const ids = 一覧の札(t.doc).map((c) => c.dataset.homeId);
    assertEqual(new Set(ids).size, ids.length, '同じゲームは1回だけ');
    const 遊べる = t.win.homeProbe().ready;
    assertEqual(ids.slice().sort().join(','), 遊べる.slice().sort().join(','), '遊べるカセットが全部ならぶ');
    assert(/近日/.test(t.doc.querySelector('#scr-v2-pick .v2-ssoon').textContent), 'まだ遊べない分類は「近日とどきます」');
    t.win.close();
  });

  await r.test('開き直すと、前回あそんだゲームの札に「前回」の印（前の棚の 2-2・門D13 の後継）', async () => {
    const t = await launch({ fakeSocket: true, storage: { 'acac-last-cassette': 'rcard' } });
    const 印 = Array.from(t.doc.querySelectorAll('#scr-v2-pick .v2-last')).map((x) => x.closest('[data-home-card]').dataset.homeId);
    assertEqual(印.join(','), 'rcard', '前回のゲームにだけ印');
    t.win.close();
  });

  await r.test('人が入って人数が変わっても、開いているページと一覧の巻いた所はそのまま（前の棚の「見ているカセットを失わない」の後継）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const fake = await 部屋に入る(t, 部屋(4));
    click(t.doc, t.doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    click(t.doc, 一覧の札(t.doc)[5]);
    await sleep(t.win, 30);
    fake.fire('room:update', 部屋(9));
    await sleep(t.win, 60);
    const ov = t.doc.querySelector('#scr-v2-pick [data-home-ov]');
    assert(ov.classList.contains('is-open'), 'ページは開いたまま');
    assert(/6 \/ /.test(t.doc.querySelector('#scr-v2-pick [data-home-gname]').textContent), '同じページ（6枚目）');
    assert(/いま9人/.test(t.doc.querySelector('#scr-v2-pick .v2-pills').textContent), '人数は新しくなる');
    t.win.close();
  });

  await r.test('門3：いまの人数で遊べないゲームは、消さずに点線と理由で出る（部屋の人数 2・9・13 の3通り）', async () => {
    for (const n of [2, 9, 13]) {
      const t = await launch({ fakeSocket: true, atEntry: true });
      await 部屋に入る(t, 部屋(n));
      click(t.doc, t.doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
      await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
      const 札 = 一覧の札(t.doc);
      const 遊べる = t.win.homeProbe().ready.length;
      assertEqual(札.length, 遊べる, n + '人：遊べないものも消さない');
      let 理由つき = 0;
      札.forEach((c) => {
        const m = t.win.shelfMeta(c.dataset.homeId), ways = t.win.cassetteWays(c.dataset.homeId);
        let want = null;
        if (!ways.room) want = '1台で遊ぶゲーム';
        else if (m.max && n > m.max) want = m.max + '人まで（いま' + n + '人）';
        else if (m.min && n < m.min) want = m.min + '人から（いま' + n + '人）';
        const why = c.querySelector('.v2-swhy');
        if (want) {
          理由つき++;
          assert(c.classList.contains('is-no'), n + '人・' + c.dataset.homeId + '：点線でうすく');
          assertEqual(why && why.textContent, want, n + '人・' + c.dataset.homeId + '：理由');
        } else {
          assert(!c.classList.contains('is-no') && !why, n + '人・' + c.dataset.homeId + '：遊べるものは理由なし');
        }
      });
      // **0件でも成り立つ検査にしない**（型b）：どの人数でも、遊べないものが1つはある
      assert(理由つき > 0, n + '人：理由つきの札が出ている（実際:' + 理由つき + '）');
      // ページでも、ボタンの所に理由（押せない）。下の点は白ぬきの輪
      const no = 札.filter((c) => c.classList.contains('is-no'))[0];
      click(t.doc, no);
      await sleep(t.win, 40);
      const cta = t.doc.querySelector('#scr-v2-pick [data-home-cta] [data-home-why]');
      assert(cta && cta.disabled, n + '人：ページの主ボタンは押せない');
      const dots = t.doc.querySelectorAll('#scr-v2-pick [data-home-dots] i');
      assertEqual(Array.from(dots).filter((d) => d.classList.contains('is-no')).length, 理由つき, n + '人：遊べないページの点だけ白ぬき');
      t.win.close();
    }
  });

  await r.test('門2：一覧 → ページ → 指で送る → ‹ で一覧（さっき見ていたゲームの所）', async () => {
    const t = await launch({ fakeSocket: true });
    const scr = t.doc.getElementById('scr-v2-pick');
    const 札 = 一覧の札(t.doc);
    // jsdom には版組みが無いので、札の高さだけ置く（一覧が戻る位置を測るため）
    札.forEach((c, k) => Object.defineProperty(c, 'offsetTop', { configurable: true, get: () => 100 + k * 90 }));
    const list = scr.querySelector('[data-home-list]');
    Object.defineProperty(list, 'offsetTop', { configurable: true, get: () => 100 });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 300 });
    click(t.doc, 札[2]);
    await sleep(t.win, 40);
    const ov = scr.querySelector('[data-home-ov]');
    assert(ov.classList.contains('is-open'), '押すとページが開く');
    assert(/3 \/ /.test(scr.querySelector('[data-home-gname]').textContent), '3枚目');
    const 世界 = t.win.homeProbe().cards[2].world;
    assert(ov.classList.contains('v2-w-' + 世界), '画面いっぱいがそのゲームの色');
    // 指で左へ送る
    const pager = scr.querySelector('[data-home-pager]');
    const ev = (type, x) => pager.dispatchEvent(new t.win.PointerEvent(type, { bubbles: true, clientX: x, clientY: 400, pointerId: 7 }));
    ev('pointerdown', 300); ev('pointermove', 260); ev('pointermove', 120); ev('pointerup', 120);
    await sleep(t.win, 40);
    assert(/4 \/ /.test(scr.querySelector('[data-home-gname]').textContent), '指で送ると次のゲーム（4枚目）');
    assert(scr.querySelector('[data-home-track]').children[3].classList.contains('is-cur'), '4枚目のページが今のページ');
    // 少しだけ動かしてはなすと、その場に戻る
    ev('pointerdown', 300); ev('pointermove', 280); ev('pointermove', 270); ev('pointerup', 270);
    await sleep(t.win, 40);
    assert(/4 \/ /.test(scr.querySelector('[data-home-gname]').textContent), '少しだけでは送らない');
    // 縦に動かした時は送らない（ページの中を巻く）
    ev('pointerdown', 300); pager.dispatchEvent(new t.win.PointerEvent('pointermove', { bubbles: true, clientX: 290, clientY: 300, pointerId: 7 })); ev('pointerup', 100);
    await sleep(t.win, 40);
    assert(/4 \/ /.test(scr.querySelector('[data-home-gname]').textContent), '縦の動きでは送らない');
    // ‹ で一覧へ。一覧は、さっき見ていたゲーム（4枚目）の所
    click(t.doc, scr.querySelector('[data-home-act="pick-back"]'));
    await sleep(t.win, 40);
    assert(!ov.classList.contains('is-open'), '‹ でページを閉じる');
    assertEqual(list.scrollTop, Math.max(0, (100 + 3 * 90) - 100 - 100), '一覧は4枚目の札が見える所');
    assertNoErrors(t.errors, '一覧とページ');
    t.win.close();
  });

  await r.test('ページの順は一覧と同じ。遊べないゲームもとばさない（‹ › で端まで）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    await 部屋に入る(t, 部屋(10));
    click(t.doc, t.doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    const 一覧 = 一覧の札(t.doc).map((c) => c.dataset.homeId);
    click(t.doc, 一覧の札(t.doc)[0]);
    const ページ = [];
    for (let k = 0; k < 一覧.length; k++) {
      ページ.push((function(p){ return p.cards[p.cur].id; })(t.win.homeProbe()));
      click(t.doc, t.doc.querySelector('#scr-v2-pick [data-home-act="pick-next"]'));
    }
    assertEqual(ページ.join(','), 一覧.join(','), 'ページの順＝一覧の順（遊べないものも入る）');
    t.win.close();
  });

  await r.test('S5：ログインしていない時は、ページの主ボタンに「ログインすると はじめられます」と「ログイン」', async () => {
    const t = await launch({ fakeSocket: true, loggedOut: true });
    const 札 = 一覧の札(t.doc).filter((c) => c.dataset.homeId === 'jinro')[0];
    click(t.doc, 札);
    await sleep(t.win, 40);
    const cta = t.doc.querySelector('#scr-v2-pick [data-home-cta]');
    assert(/ログインすると はじめられます/.test(cta.textContent), 'できることを言う');
    click(t.doc, cta.querySelector('[data-home-act="pick-login"]'));
    await waitScreen(t.win, t.doc, 'scr-login', 3000);
    t.win.close();
  });

  await r.test('S5：部屋にいるのに1台で遊ぶゲーム（あれそれどれこれ）は、部屋をとじれば遊べると伝える', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    await 部屋に入る(t, 部屋(4));
    click(t.doc, t.doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    click(t.doc, 一覧の札(t.doc).filter((c) => c.dataset.homeId === 'aresoredorekore')[0]);
    await sleep(t.win, 40);
    const cta = t.doc.querySelector('#scr-v2-pick [data-home-cta]');
    assert(/1台で遊ぶゲームです/.test(cta.textContent) && /部屋をとじると/.test(cta.textContent), '理由と、次にできること');
    assert(cta.querySelector('[data-home-act="pick-leave"]'), '部屋をとじて 1台で遊ぶ');
    t.win.close();
  });

  await r.test('S4：カセットの中のゲーム。人数で遊べないものは点線で理由・押せない。えらんだ物だけ縁と ✓', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    await 部屋に入る(t, 部屋(7));
    click(t.doc, t.doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    await H.openCassette(t.win, t.doc, 'sugoroku');
    await waitScreen(t.win, t.doc, 'scr-game', 3000);
    const off = Array.from(t.doc.querySelectorAll('#gameCards .v2-opt.is-off'));
    assert(off.length >= 1, '7人では遊べないゲームがある（実際:' + off.length + '）');
    off.forEach((o) => {
      assertEqual(o.tagName, 'DIV', o.dataset.homeOpt + '：押せない（ボタンにしない）');
      assert(/人まで（いま7人）/.test(o.textContent), o.dataset.homeOpt + '：理由');
    });
    const on = t.doc.querySelectorAll('#gameCards .v2-opt.is-on');
    assertEqual(on.length, 1, 'えらんでいるのは1つ');
    t.win.close();
  });

  // ===================== TV と決めた時 =====================
  await r.test('門4：進行役がえらんでいる間、TV は変わらない（見ているゲームを送らない・QR はずっと出ている）', async () => {
    const tv = await launch({ fakeSocket: true, atEntry: true });
    const ft = tv.win.__rtFake;
    ft.replies = { 'room:peek': () => ({ ok: true, code: 'ABC234', game: null, phase: 'lobby', playerCount: 6, fes: false }),
      'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'tv', room: 部屋(6) }) };
    await H.joinRoomV2(tv.win, tv.doc, 'ABC234', '', { tv: true });
    await waitScreen(tv.win, tv.doc, 'scr-v2-room-tv', 3000);
    const 前 = tv.doc.getElementById('scr-v2-room-tv').innerHTML;
    assert(tv.doc.querySelector('#scr-v2-room-tv .v2-tqr svg'), 'TV に QR');
    // 進行役のスマホ：一覧を開いて、ページを何枚も送る
    const host = await launch({ fakeSocket: true, atEntry: true });
    const fh = await 部屋に入る(host, 部屋(6));
    const 送った前 = fh.emits.length;
    click(host.doc, host.doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
    await waitScreen(host.win, host.doc, 'scr-v2-pick', 3000);
    click(host.doc, 一覧の札(host.doc)[0]);
    for (let k = 0; k < 4; k++) click(host.doc, host.doc.querySelector('#scr-v2-pick [data-home-act="pick-next"]'));
    click(host.doc, host.doc.querySelector('#scr-v2-pick [data-home-act="pick-back"]'));
    await sleep(host.win, 60);
    const 送った = fh.emits.slice(送った前).map((x) => x.name).filter((n) => !/^hb|ping/.test(n));
    assertEqual(送った.join(','), '', 'えらんでいる間、進行役のスマホは何も送らない（TV に出す道が無い）');
    // TV に部屋の知らせ（人数は同じ）がもう一度届いても、同じ形のまま
    ft.fire('room:update', 部屋(6));
    await sleep(tv.win, 40);
    assertEqual(tv.doc.getElementById('scr-v2-room-tv').innerHTML.replace(/v2-born /g, ''), 前.replace(/v2-born /g, ''), 'TV は変わらない');
    assertEqual(activeScreen(tv.doc), 'scr-v2-room-tv', 'TV は待合のまま');
    tv.win.close(); host.win.close();
  });

  await r.test('門5：決めた時、進行役・参加者・TV が同じ知らせで、同じゲームの色のカードを出す（1.5秒）', async () => {
    const who = [['m1', 'phone'], ['m3', 'phone'], ['tv', 'tv']];
    const ts = [];
    for (const [id] of who) {
      const t = await launch({ fakeSocket: true, atEntry: true });
      if (id === 'tv') {
        t.win.__rtFake.replies = { 'room:peek': () => ({ ok: true, code: 'ABC234', game: null, phase: 'lobby', playerCount: 6, fes: false }),
          'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'tv', room: 部屋(6) }) };
        await H.joinRoomV2(t.win, t.doc, 'ABC234', '', { tv: true });
      } else await 部屋に入る(t, 部屋(6), id);
      ts.push(t);
    }
    ts.forEach((t) => assert(!t.doc.getElementById('v2Decided'), '決まる前はカードが無い'));
    const 決まった = 部屋(6, { game: 'falsetrue', mode: 'falsetrue' });
    ts.forEach((t) => t.win.__rtFake.fire('room:update', 決まった));
    await sleep(ts[0].win, 30);
    ts.forEach((t, k) => {
      const card = t.doc.getElementById('v2Decided');
      assert(card, who[k][0] + '：カードが出る');
      assert(card.classList.contains('v2-w-falsetrue'), who[k][0] + '：そのゲームの色');
      assert(/False or True/.test(card.textContent), who[k][0] + '：ゲームの名前');
      assertEqual(card.classList.contains('v2-tv'), who[k][1] === 'tv', who[k][0] + '：TV は TV の大きさ');
    });
    assert(/ふう が えらびました/.test(ts[2].doc.getElementById('v2Decided').textContent), 'TV には、だれがえらんだか');
    // 同じ知らせがもう一度届いても、出し直さない
    const 前 = ts[1].doc.getElementById('v2Decided');
    ts[1].win.__rtFake.fire('room:update', 決まった);
    await sleep(ts[1].win, 30);
    assert(ts[1].doc.getElementById('v2Decided') === 前, '同じ決定で2回出さない');
    await sleep(ts[0].win, 1600);
    ts.forEach((t) => assert(!t.doc.getElementById('v2Decided'), '1.5秒で消える'));
    // 指示68-0b B6：消えたあとに届く同じ部屋の知らせ（だれかが準備OK を押した等）でも、見た人にはもう出さない
    const 準備した = 部屋(6, { game: 'falsetrue', mode: 'falsetrue' });
    準備した.members.find((m) => m.id === 'm2').readyGame = 'falsetrue';
    ts.forEach((t) => { t.win.__rtFake.fire('room:update', 準備した); t.win.__rtFake.fire('room:update', 決まった); });
    await sleep(ts[0].win, 30);
    ts.forEach((t, k) => assert(!t.doc.getElementById('v2Decided'), who[k][0] + '：見たあとの知らせでは、カードを出し直さない'));
    ts.forEach((t) => t.win.close());
  });

  await r.test('指示68-0b B6：見本データの「決定のカードを見たあと」（home-e3-picked）は、カードを出さずに待合を出す', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const HomeScenes = require('../tools/v2-lab/home-scenes');
    t.win.V2Screens.home(HomeScenes.view('home-e3-picked'));
    await sleep(t.win, 40);
    assert(!t.doc.getElementById('v2Decided'), '見たあとの形にカードは無い（撮った写真が決定のカードになっていた）');
    assertEqual(activeScreen(t.doc), 'scr-v2-room', '待合が出ている');
    t.win.close();
  });

  await r.test('決めた時のカードは、入った時にもう決まっていた部屋では出さない', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    // 入る途中で一瞬だけ出て消えても見のがさないよう、入る前から見張る（カードは1.5秒で消えるので、終わってから見ただけでは分からない）
    let 出た = 0;
    const mo = new t.win.MutationObserver((recs) => recs.forEach((rec) => Array.from(rec.addedNodes).forEach((n) => { if (n.id === 'v2Decided') 出た++; })));
    mo.observe(t.doc.body, { childList: true, subtree: true });
    await 部屋に入る(t, 部屋(6, { game: 'falsetrue', mode: 'falsetrue' }), 'm3');
    await sleep(t.win, 40);
    // 入ったあとに届く、同じ部屋の知らせ（だれかが準備OKを押した等）。これを「決まった」と取りちがえない
    t.win.__rtFake.fire('room:update', 部屋(6, { game: 'falsetrue', mode: 'falsetrue' }));
    await sleep(t.win, 40);
    mo.disconnect();
    assertEqual(出た, 0, '途中から入った人には出さない');
    t.win.close();
  });

  // ===================== E5 遊び終わった後 =====================
  await r.test('E5：つぎを決めるのは進行役だけ。「部屋をとじる」は押した後にたずねる。参加者は待つ', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const fake = await 部屋に入る(t, 部屋(6, { game: 'quizrush', mode: 'quizrush' }));
    t.win.goToScreen('scr-next');
    await sleep(t.win, 40);
    const scr = t.doc.getElementById('scr-next');
    assert(scr.querySelector('[data-next="again"]') && scr.querySelector('[data-next="shelf"]'), 'もう一回・ほかのゲームにする');
    click(t.doc, scr.querySelector('[data-home-act="next-close"]'));
    await sleep(t.win, 40);
    const ask = scr.querySelector('[data-v2-id="v2Ask"]');
    assert(ask && ask.classList.contains('is-open'), 'とじる前にたずねる');
    click(t.doc, ask.querySelector('[data-v2-act="home-ask-no"]'));
    await sleep(t.win, 40);
    assert(!fake.emits.some((x) => x.name === 'room:close'), '「やめる」ではとじない');
    const g = await launch({ fakeSocket: true, atEntry: true });
    await 部屋に入る(g, 部屋(6, { game: 'quizrush', mode: 'quizrush' }), 'm4');
    g.win.goToScreen('scr-next');
    await sleep(g.win, 40);
    assert(!g.doc.querySelector('#scr-next [data-next]'), '参加者には選ぶボタンが無い');
    assert(/進行役が つぎを えらんでいます/.test(g.doc.querySelector('#scr-next .v2-band').textContent), '待っていると分かる');
    t.win.close(); g.win.close();
  });

  // ===================== 門7 古い画面 =====================
  await r.test('門7：古い入口・棚・部屋の画面には、どこからも入れない（どの名前で呼んでも、新しい画面になる）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const 古い = ['scr-entry', 'scr-shelf', 'scr-cassette', 'scr-play-way', 'scr-room-open', 'scr-rt-lobby', 'scr-rt-room'];
    // 走っている間に一度でも古い画面が出たら数える（見張り）
    let 出た = [];
    const mo = new t.win.MutationObserver(() => { 古い.forEach((id) => { const e = t.doc.getElementById(id); if (e && e.classList.contains('active')) 出た.push(id); }); });
    古い.forEach((id) => { const e = t.doc.getElementById(id); if (e) mo.observe(e, { attributes: true, attributeFilter: ['class'] }); });
    for (const id of 古い) {
      t.win.goToScreen(id);
      await sleep(t.win, 20);
      assert(/^scr-v2/.test(activeScreen(t.doc)), id + '：呼んでも新しい画面（いま ' + activeScreen(t.doc) + '）');
    }
    // ふつうの道を一通り歩く：入口 → 1台 → 一覧 → カセット → もどる → 入口 → 部屋をつくる → えらぶ → 決める → 出る
    t.win.goToScreen('scr-v2-home'); await sleep(t.win, 20);
    click(t.doc, t.doc.querySelector('#scr-v2-home [data-home-act="one"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    await H.openCassette(t.win, t.doc, 'jinro');
    await waitScreen(t.win, t.doc, 'scr-game', 3000);
    click(t.doc, t.doc.querySelector('#scr-game [data-go-shelf]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    await 部屋に入る(t, 部屋(6));
    click(t.doc, t.doc.querySelector('#scr-v2-room [data-home-act="room-pick"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-pick', 3000);
    click(t.doc, t.doc.querySelector('#scr-v2-pick [data-home-act="pick-exit"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-room', 3000);
    // 待合の ⚙ →「部屋をとじる」→ たずねる枠 →「とじる」
    t.win.__rtFake.replies['room:close'] = () => ({ ok: true });
    click(t.doc, t.doc.querySelector('#scr-v2-room [data-home-act="room-close"]'));
    await sleep(t.win, 30);
    click(t.doc, t.doc.querySelector('#scr-v2-room [data-v2-act="home-ask-ok"]'));
    await waitScreen(t.win, t.doc, 'scr-v2-home', 3000);
    assertEqual(activeScreen(t.doc), 'scr-v2-home', '部屋を出たら入口');
    mo.disconnect();
    assertEqual(出た.join(','), '', '古い画面は一度も出ていない');
    // **見張りが効くか**（落とし穴10）：古い画面を直に出すと、見張りが数える
    const 見張り = new t.win.MutationObserver(() => { const e = t.doc.getElementById('scr-shelf'); if (e.classList.contains('active')) 出た.push('scr-shelf'); });
    見張り.observe(t.doc.getElementById('scr-shelf'), { attributes: true, attributeFilter: ['class'] });
    t.doc.getElementById('scr-shelf').classList.add('active');
    await sleep(t.win, 10);
    assert(出た.length === 1, '見張りは古い画面を見つけられる');
    見張り.disconnect();
    t.win.close();
  });

  function V2open(t, sel) { t.win.V2.open(t.doc.querySelector('#scr-v2-room [data-v2-id="' + sel.slice(1) + '"]')); }

  // ===================== 指示68-0b =====================
  await r.test('A5：ゲームをえらぶ一覧の、棚に出る全部のカセットのページに、ルールがちょうど3つ（あれそれどれこれにも）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const HomeScenes = require('../tools/v2-lab/home-scenes');
    t.win.V2Screens.home(HomeScenes.view('pick-page-one'));
    await sleep(t.win, 40);
    const pages = Array.from(t.doc.querySelectorAll('#scr-v2-pick .v2-page'));
    assert(pages.length >= 8, 'カセットのページが並ぶ（' + pages.length + '）');
    const 札 = 一覧の札(t.doc);
    assertEqual(pages.length, 札.length, '一覧の札とページの数が同じ（棚に出る全部）');
    pages.forEach((p, i) => {
      const 名 = (p.querySelector('.v2-pn') || {}).textContent;
      const rs = Array.from(p.querySelectorAll('.v2-rule .v2-rule-t')).map((x) => x.textContent.trim());
      assertEqual(rs.length, 3, 名 + '：ルールが3つ');
      rs.forEach((x) => assert(x.length > 2, 名 + '：ルールの文が空でない'));
    });
    const あれそれ = pages.find((p) => /あれそれどれこれ/.test((p.querySelector('.v2-pn') || {}).textContent));
    assert(あれそれ, 'あれそれどれこれのページがある');
    assert(/言葉だけ/.test(あれそれ.textContent), 'あれそれどれこれは見本 S5 の3つ（出題者がお題を、言葉だけで説明する…）');
    t.win.close();
  });

  await r.test('B10：つぎは？のボタンは行き先の名前で言う（同じ言葉が2つない）。さっきのゲームに人数と時間。とじる確認の主ボタンは赤', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const HomeScenes = require('../tools/v2-lab/home-scenes');
    t.win.V2Screens.home(HomeScenes.view('home-e5a'));
    await sleep(t.win, 40);
    const scr = t.doc.getElementById('scr-next');
    const 字 = Array.from(scr.querySelectorAll('#nextChoices button')).map((b) => b.textContent.trim());
    assertEqual(new Set(字).size, 字.length, '同じ言葉のボタンが2つない：' + 字.join(' / '));
    const N = t.win.UiText.HOME.つぎ;
    assertEqual(scr.querySelector('[data-next="shelf"]').textContent.trim(), N.ほか, '一覧へは「一覧から えらぶ」');
    if (scr.querySelector('[data-next="mode"]')) assertEqual(scr.querySelector('[data-next="mode"]').textContent.trim(), N.ルール, 'モードは「ルールを変える」');
    const g = scr.querySelector('[data-next="game"]');
    assert(g && /クイズ王 の中で えらぶ|にする$/.test(g.textContent.trim()), '同じカセットの別のゲームは行き先の名前：' + (g && g.textContent));
    assert(!/変える.*変える|ほかのゲームにする|別のゲームへ/.test(字.join('|')), '「変える」に読める言葉が並ばない');
    assert(/人・約\d+分/.test(scr.querySelector('.v2-epick').textContent), 'さっきのゲームに人数と時間：' + scr.querySelector('.v2-epick').textContent);
    t.win.V2Screens.home(HomeScenes.view('home-e5-close'));
    await sleep(t.win, 40);
    const ok = t.doc.querySelector('#scr-next [data-v2-id="v2Ask"] [data-v2-act="home-ask-ok"]');
    assert(ok && ok.classList.contains('v2-danger'), '「とじる」の主ボタンは赤（v2-danger）');
    t.win.close();
  });

  await r.test('つぎは？ →「ルールを変える」→ モードの画面の左上の ← で「つぎは？」にもどる（くまくんの決め 2026-10-25）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const fake = await 部屋に入る(t, 部屋(6, { game: 'bomb', mode: 'bomb-coop' }));
    fake.replies['room:setState'] = () => ({ ok: true });
    t.win.goToScreen('scr-next');
    await sleep(t.win, 40);
    const mode = t.doc.querySelector('#scr-next [data-next="mode"]');
    assert(mode, '「ルールを変える」がある（爆弾解除はモードが2つ）');
    click(t.doc, mode);
    await waitScreen(t.win, t.doc, 'scr-mode', 3000);
    click(t.doc, t.doc.getElementById('backToShelfBtn'));
    await sleep(t.win, 60);
    assertEqual(activeScreen(t.doc), 'scr-next', '← で「つぎは？」にもどる（一覧ではなく）');
    // 「つぎは？」を通らずに来たモードの画面の ← は、今までどおり（ゲームの札か一覧）
    t.win.goToScreen('scr-mode');
    await sleep(t.win, 40);
    click(t.doc, t.doc.getElementById('backToShelfBtn'));
    await sleep(t.win, 60);
    assert(activeScreen(t.doc) !== 'scr-next', 'ふつうに来た時は「つぎは？」へは行かない（いま ' + activeScreen(t.doc) + '）');
    t.win.close();
  });

  await r.test('B13：TV で /tv を開いた画面のコードの下の一言は、TV 自身の言葉（進行役のスマホに出ている6文字）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    const HomeScenes = require('../tools/v2-lab/home-scenes');
    t.win.V2Screens.home(HomeScenes.view('home-e2tv'));
    await sleep(t.win, 40);
    const hint = t.doc.querySelector('#scr-v2-join .v2-field .v2-hint').textContent;
    assertEqual(hint, t.win.UiText.HOME.入る.TVのヒント, 'TV の時の一言');
    assert(/進行役のスマホ/.test(hint), '進行役のスマホに出ている6文字：' + hint);
    // スマホで入る人の一言はそのまま
    t.win.V2Screens.home(HomeScenes.view('home-e2a'));
    await sleep(t.win, 40);
    assert(/TVの下/.test(t.doc.querySelector('#scr-v2-join .v2-field .v2-hint').textContent), 'スマホの時は今のまま（TVの下に出ている6文字）');
    t.win.close();
  });

  r.finish();
})();
