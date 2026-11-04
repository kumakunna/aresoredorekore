// tests/fes-screens.js — 文化祭の部屋の画面（指示66-2）を jsdom で押して確かめる
//
// サーバーの側（投票が変わらない・票の数を配らない・感想の上書き…）は tests/fes.js が本物のサーバーで見る。
// ここは**画面の側**：押した時に何を送るか・届いたものをどう描くか。
// 部屋の知らせは、本物の進行役を動かして作った見本データ（tools/v2-lab/fes-scenes.js）をそのまま流す（落とし穴25）
const H = require('./harness');
const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');
const FesScenes = require('../tools/v2-lab/fes-scenes');

const URL = 'http://localhost/?room=TST754&fes=1';
const act = (doc) => (doc.querySelector('.screen.active') || {}).id;
const emits = (win, name) => win.__rtFake.emits.filter((e) => e.name === name);

/** QR（/fes）から開いて、入る画面まで。覗き見には「文化祭の部屋・6人」と答える */
async function 入る画面(o) {
  const { win, doc, errors } = await launch(Object.assign({ url: URL, fakeSocket: true }, o || {}));
  await waitFor(win, () => win.__rtFake && win.__rtFake.connected, 3000, '疑似socketがつながる');
  win.__rtFake.replies = { 'room:peek': () => ({ ok: true, code: 'TST754', playerCount: 6, fes: true }),
    'room:join': () => ({ ok: true, code: 'TST754', memberId: 'm1', room: FesScenes.view('fes2-lobby').room }) };
  await waitFor(win, () => act(doc) === 'scr-v2-fes-join' && doc.querySelector('[data-fes-name]'), 6000, '入る画面');
  return { win, doc, errors };
}
/** 見本データの場面を、部屋の知らせ（room:update）と本人だけのもの（fes:you）として流す */
function 流す(win, sceneId) {
  const lab = FesScenes.view(sceneId);
  win.__rtFake.fire('room:update', lab.room);
  win.__rtFake.fire('fes:you', lab.you);
  return lab;
}
async function 入った(o) {
  const t = await 入る画面(o);
  const { win, doc } = t;
  const n = doc.querySelector('[data-fes-name]');
  n.value = 'ふう'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
  doc.querySelector('[data-fes-diff="normal"]').click();
  doc.querySelector('[data-fes-act="join"]').click();
  await waitFor(win, () => act(doc) === 'scr-v2-fes-lobby', 4000, '待合へ');
  return t;
}

(async function main() {
  const r = createRunner('fes-screens：文化祭の部屋の画面（指示66-2）');

  await r.test('門5（画面）：むずかしさを選ぶまで「入る」は押せず、押しても送らない。選ぶと、むずかしさを添えて入る', async () => {
    const { win, doc, errors } = await 入る画面();
    const n = doc.querySelector('[data-fes-name]');
    n.value = 'ふう'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
    const btn = doc.querySelector('[data-fes-act="join"]');
    assert(btn.disabled, '選ぶまで「入る」は押せない');
    assert(/むずかしさを えらんでね/.test(btn.textContent), '押せないボタンに「むずかしさを えらんでね」');
    assertEqual(doc.querySelectorAll('.v2-diff.is-on').length, 0, '最初はどのむずかしさも選ばれていない');
    // くまくんの答え 2026-10-31：やさしい・ふつうの2つだけ
    assertEqual(Array.from(doc.querySelectorAll('[data-fes-diff]')).map((d) => d.getAttribute('data-fes-diff')).join(','), 'easy,normal', 'むずかしさは「やさしい」「ふつう」の2つ');
    assert(!/むずかしい/.test(doc.querySelector('.v2-diffs').textContent), '「むずかしい」の字が無い');
    btn.click();
    assertEqual(emits(win, 'room:join').length, 0, '押しても送らない');
    doc.querySelector('[data-fes-diff="easy"]').click();
    assert(!doc.querySelector('[data-fes-act="join"]').disabled, '選ぶと押せる');
    doc.querySelectorAll('.v2-diff').forEach((d) => assert(d.querySelector('.v2-diff-t span').textContent.length > 2, 'むずかしさに一言の説明がある'));
    doc.querySelector('[data-fes-act="join"]').click();
    await waitFor(win, () => emits(win, 'room:join').length === 1, 2000, '入る');
    assertEqual(emits(win, 'room:join')[0].payload.diff, 'easy', '選んだむずかしさを添えて入る');
    await waitFor(win, () => act(doc) === 'scr-v2-fes-lobby', 3000, '入ったら待合へ');
    assertEqual(errors.length, 0, '未捕捉の例外が無い');
    win.close();
  });

  await r.test('名前：使えない言葉は送る前に止め、入力欄にも残さない（●●●）・記録の知らせと本名の注意が出ている', async () => {
    const { win, doc } = await 入る画面();
    const scr = doc.getElementById('scr-v2-fes-join');
    assert(Array.from(scr.querySelectorAll('.v2-hint')).some((e) => /1か月記録します/.test(e.textContent)), '名前を記録することを、入る画面に出している');
    assert(Array.from(scr.querySelectorAll('.v2-hint')).some((e) => /本名は出さないでね/.test(e.textContent)), '「本名は出さないでね」');
    const n = doc.querySelector('[data-fes-name]');
    n.value = 'ハチイチゼロ'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.querySelector('[data-fes-diff="normal"]').click();
    doc.querySelector('[data-fes-act="join"]').click();
    await sleep(win, 50);
    assertEqual(emits(win, 'room:join').length, 0, '使えない言葉は送らない');
    assertEqual(doc.querySelector('[data-fes-name]').value, '', '入力欄に残さない');
    assertEqual(doc.querySelector('[data-fes-name]').getAttribute('placeholder'), '●●●', 'かわりに ●●●');
    assert(scr.querySelector('.v2-why'), '理由を出す');
    win.close();
  });

  // 2026-11-01 F2（くまくんの答え）：30秒をすぎて戻った時に満員なら「つぎの回」として待合で待つ
  await r.test('F2（画面）：「つぎの回」を待つ人のスマホは待つ画面（席が空いたら入れる）。人数に自分を数えず、待合の時計も出さない。空いたら待合へ', async () => {
    const { win, doc, errors } = await 入った();
    const lab = FesScenes.view('fes2-lobby');
    const 他 = lab.room.members.filter((m) => m.role !== 'bigscreen' && m.id !== 'm1').length;
    const room = JSON.parse(JSON.stringify(lab.room));
    if (!room.members.some((m) => m.id === 'm1')) room.members.push({ id: 'm1', name: 'ふう', role: 'waiting', connected: true, isHost: false, icon: '', title: '', ready: false });
    room.fes.hold = ['m1'];
    win.__rtFake.fire('room:update', room);
    win.__rtFake.fire('fes:you', Object.assign({}, lab.you, { bench: 'hold' }));
    await waitFor(win, () => /席が空いたら/.test((doc.querySelector('.screen.active') || {}).textContent || ''), 3000, '待つ画面');
    const scr = doc.querySelector('.screen.active');
    assert(/もどってきた時に満員だったので/.test(scr.textContent), 'なぜ待つのかを本人に言う');
    assertEqual(scr.querySelector('.v2-cbtn.is-who span span').textContent, String(他), '右上の人数は部屋の人（自分を数えない）');
    assertEqual(scr.querySelectorAll('.v2-band-end').length, 0, '待合の時計は出さない');
    // 席が空いた（遊ぶ人に戻った）→ 待合の画面へ
    win.__rtFake.fire('room:update', lab.room);
    win.__rtFake.fire('fes:you', lab.you);
    await waitFor(win, () => !/席が空いたら/.test((doc.querySelector('.screen.active') || {}).textContent || ''), 3000, '待合へ戻る');
    assertEqual(errors.length, 0, '画面の例外なし');
    win.close();
  });

  await r.test('門3（画面）：投票したあとに別のゲームを押しても、送り直さず・札も変わらない', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-vote');
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-vlist'), 2000, '投票の画面');
    doc.querySelector('[data-fes-pick="bomb-coop"]').click();
    doc.querySelector('[data-fes-act="vote"]').click();
    assertEqual(emits(win, 'fes:vote').length, 1, '投票を送る');
    assertEqual(emits(win, 'fes:vote')[0].payload.mode, 'bomb-coop', 'えらんだゲームに');
    win.__rtFake.fire('fes:you', { vote: 'bomb-coop', diff: 'normal', miss: 0 });
    await waitFor(win, () => doc.querySelector('.v2-vcard.is-voted'), 2000, '投票ずみの印');
    doc.querySelector('[data-fes-pick="rcard"]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:vote').length, 1, '別のゲームを押しても送り直さない');
    assertEqual(doc.querySelector('.v2-vcard.is-on').getAttribute('data-fes-pick'), 'bomb-coop', '選んでいる札も変わらない');
    assert(!doc.querySelector('[data-fes-act="vote"]'), '投票のボタンはもう無い（投票ずみ）');
    win.close();
  });

  // ---- 2026-10-29：サーバーが作り直された時（部屋が消えた）。調べもの docs/監査_文化祭の抜けて戻る.md の 6 ----
  /** つなぎ直し：切れて、またつながる（rt-client がつなぎ直しの入り直しを送る） */
  async function つなぎ直す(win) {
    const f = win.__rtFake;
    f.socket.disconnect();
    await sleep(win, 30);
    f.connected = true; f.fire('connect');
    await sleep(win, 80);
  }
  const 部屋が無い = () => ({ ok: false, error: 'room_not_found', message: 'その部屋コードは見つかりません' });

  await r.test('再起動（スマホ）：文化祭の待合で部屋が消えたら、ホームではなく「作り直しています」の画面へ移る', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-lobby');
    const 移った = []; win.fesNav = (u) => 移った.push(u);
    win.__rtFake.replies['room:join'] = 部屋が無い;
    await つなぎ直す(win);
    await waitFor(win, () => 移った.length, 2000, 'ページを移る');
    assertEqual(移った[0], '/?fes=1&wait=1', '作り直しを待つ画面へ（ホームではない）');
    // 消えた部屋の記憶を端末に残さない（残すと、読み込み直した時のつなぎ直しが前の部屋に入ろうとして、新しい部屋に入った TV の印を消した・写真で見つけた）
    const 記憶 = []; for (let i = 0; i < win.localStorage.length; i++) 記憶.push(win.localStorage.getItem(win.localStorage.key(i)) || '');
    assert(!記憶.some((v) => v.indexOf('TST754') !== -1), '消えた部屋（TST754）の記憶が残っていない');
    assert(act(doc) !== 'scr-v2-home', 'ホームに落ちない');
    win.close();
  });

  await r.test('再起動（TV）：文化祭の TV で部屋が消えたら、TV のまま「作り直しています」の画面へ移る', async () => {
    // 部屋にいる端末を、TV の画面にして確かめる（疑似の socket では TV の入口が返事を置く前に走るため。分かれ道は今の画面だけで決まる）
    const { win, doc } = await 入った();
    win.__rtFake.fire('room:update', FesScenes.view('fes2-tv-lobby').room);
    win.goToScreen('scr-v2-fes-tv');
    await waitFor(win, () => act(doc) === 'scr-v2-fes-tv', 2000, 'TV の画面');
    const 移った = []; win.fesNav = (u) => 移った.push(u);
    win.__rtFake.replies['room:join'] = 部屋が無い;
    await つなぎ直す(win);
    await waitFor(win, () => 移った.length, 2000, 'ページを移る');
    assertEqual(移った[0], '/?fes=1&wait=1&tv=1', 'TV は TV のまま、作り直しを待つ画面へ');
    // 消えた部屋の記憶を端末に残さない（残すと、読み込み直した時のつなぎ直しが前の部屋に入ろうとして、新しい部屋に入った TV の印を消した・写真で見つけた）
    const 記憶 = []; for (let i = 0; i < win.localStorage.length; i++) 記憶.push(win.localStorage.getItem(win.localStorage.key(i)) || '');
    assert(!記憶.some((v) => v.indexOf('TST754') !== -1), '消えた部屋（TST754）の記憶が残っていない');
    win.close();
  });

  // 2026-11-01 耐久（tools/fes-soak.js）で見つけた：係が部屋を作り直すと、TV が「名前を入れてね」（スマホの入口）に落ちていた。
  // rt-client は部屋の記憶を消してから closed を知らせるので、その時の rtIsBigScreen() はいつも偽だった
  await r.test('作り直し（TV）：係が部屋を作り直したら、TV は TV の入口（/fes?tv=1）へ。スマホは /fes へ', async () => {
    const room = FesScenes.view('fes2-tv-lobby').room;
    const seed = 'window.__rtFake.replies = { "room:join": function(p, cb){ setTimeout(function(){ cb({ ok: true, code: "TST754", memberId: "tv", room: ' + JSON.stringify(room) + ' }); }, 30); return undefined; } };';
    const t = await launch({ url: URL + '&tv=1', fakeSocket: true, rtSeed: seed, noDoorWait: true });
    await waitFor(t.win, () => act(t.doc) === 'scr-v2-fes-tv', 6000, 'TV の画面（いま ' + act(t.doc) + '）');
    const 移った = []; t.win.fesNav = (u) => 移った.push(u);
    t.win.__rtFake.fire('room:closed', { by: null, reason: 'fes_recreate' });
    await waitFor(t.win, () => 移った.length, 2000, 'ページを移る');
    assertEqual(移った[0], '/fes?tv=1', 'TV は TV の入口へ（スマホの入口に落ちない）');
    t.win.close();
    const p = await 入った();
    流す(p.win, 'fes2-lobby');
    const 移った2 = []; p.win.fesNav = (u) => 移った2.push(u);
    p.win.__rtFake.fire('room:closed', { by: null, reason: 'fes_recreate' });
    await waitFor(p.win, () => 移った2.length, 2000, 'ページを移る');
    assertEqual(移った2[0], '/fes', 'スマホは入る画面へ');
    p.win.close();
  });

  for (const tv of [false, true]) {
    await r.test('再起動のあと（' + (tv ? 'TV' : 'スマホ') + '）：「いま部屋を作り直しています。係の人を待ってね」を出し、部屋ができたら自動で /fes へ進む', async () => {
      const { win, doc } = await launch({ url: 'http://localhost/?fes=1&wait=1' + (tv ? '&tv=1' : ''), fakeSocket: true });
      const scr = tv ? 'scr-v2-fes-tv' : 'scr-v2-fes-join';
      await waitFor(win, () => act(doc) === scr, 6000, '待つ画面');
      assert(/いま部屋を作り直しています。係の人を待ってね/.test(doc.getElementById(scr).textContent), '作り直しを待つ文');
      const 移った = []; win.fesNav = (u) => 移った.push(u);
      let 見た = 0;
      win.fetch = async (u) => { 見た++; return { ok: true, json: async () => ({ code: 見た >= 2 ? 'NEW123' : null }) }; };
      await waitFor(win, () => 移った.length, 9000, '部屋ができたら移る');
      assertEqual(移った[0], tv ? '/fes?tv=1' : '/fes', tv ? 'TV は TV の入口へ' : '参加者は入る画面へ');
      assert(見た >= 2, '部屋ができるまで見つづける（' + 見た + '回）');
      win.close();
    });
  }

  await r.test('「いまは部屋がありません」の画面（スマホ）も、部屋ができたら自動で /fes へ進む', async () => {
    const { win, doc } = await launch({ url: 'http://localhost/?fes=1', fakeSocket: true });
    await waitFor(win, () => act(doc) === 'scr-v2-fes-join', 6000, '入る画面');
    // 指示71 追記2e：部屋が無い時は、名前の欄の赤い字ではなく「まもなく始まります。待ってね」の画面
    assert(/まもなく始まります/.test(doc.getElementById('scr-v2-fes-join').textContent), 'まもなく始まります');
    assert(!doc.querySelector('#scr-v2-fes-join .v2-why, #scr-v2-fes-join .is-bad'), '赤い字（名前のまちがいの形）では出さない');
    const 移った = []; win.fesNav = (u) => 移った.push(u);
    win.fetch = async () => ({ ok: true, json: async () => ({ code: 'NEW123' }) });
    await waitFor(win, () => 移った.length, 6000, '部屋ができたら移る');
    assertEqual(移った[0], '/fes', '入る画面へ');
    win.close();
  });

  await r.test('再起動（係）：つなぎ直したら見張りを入れ直し、部屋が消えていたら「部屋が消えました。作り直してください」と作るボタン', async () => {
    const { win, doc } = await launch({ url: 'http://localhost/?fes=1&staff=1', fakeSocket: true });
    await waitFor(win, () => win.__rtFake && win.__rtFake.connected, 3000, '疑似socketがつながる');
    const lab = FesScenes.view('fes2-lobby');
    win.__rtFake.replies = { 'fes:watch': () => ({ ok: true, role: 'staff', room: lab.room,
      staff: { code: 'TST754', fes: lab.room.fes, members: lab.room.members, tv: true } }) };
    await waitFor(win, () => act(doc) === 'scr-v2-fes-staff', 6000, '係の画面');
    await つなぎ直す(win);   // 入口は疑似の返事を置く前に走るので、1回つなぎ直して部屋を見る（これも つなぎ直しの見直しの確かめ）
    await waitFor(win, () => /TST754/.test(doc.getElementById('scr-v2-fes-staff').textContent), 3000, '係の画面に部屋');
    const n = emits(win, 'fes:watch').length;
    win.__rtFake.replies['fes:watch'] = () => ({ ok: false, error: 'no_room', message: '文化祭の部屋がありません' });
    await つなぎ直す(win);
    await waitFor(win, () => /部屋が消えました。作り直してください/.test(doc.getElementById('scr-v2-fes-staff').textContent), 3000, '部屋が消えました');
    assert(emits(win, 'fes:watch').length > n, 'つなぎ直したら見張りを入れ直した');
    assert(doc.querySelector('#scr-v2-fes-staff [data-fes-act="create"]'), '作るボタン');
    win.close();
  });

  await r.test('準備OK の取り消しは長押し（2026-10-29 くまくん）：押したあとのボタンは触っただけでは取り消さず、長押しで取り消しを送る', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-ready');
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby [data-fes-act="ready"]'), 2000, '準備OK のボタン');
    doc.querySelector('#scr-v2-fes-lobby [data-fes-act="ready"]').click();
    assertEqual(emits(win, 'room:ready').slice(-1)[0].payload.ready, true, '準備OK は1回押せば送る');
    流す(win, 'fes2-readied');
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby [data-fes-unready]'), 2000, '押したあとのボタン');
    const b = doc.querySelector('#scr-v2-fes-lobby [data-fes-unready]');
    assert(b.hasAttribute('data-v2-lp'), '長押しのボタン');
    assert(!b.hasAttribute('data-fes-act'), '触っただけで送る印は付いていない');
    assert(/長押しで とりけせます/.test(doc.getElementById('scr-v2-fes-lobby').textContent), '長押しで取り消せることを書いてある');
    const n = emits(win, 'room:ready').length;
    b.click();
    await sleep(win, 50);
    assertEqual(emits(win, 'room:ready').length, n, '触っただけでは何も送らない');
    b.dispatchEvent(new win.CustomEvent('v2:longpress', { bubbles: true, detail: { target: null } }));
    await sleep(win, 50);
    assertEqual(emits(win, 'room:ready').length, n + 1, '長押しで1回送る');
    assertEqual(emits(win, 'room:ready').slice(-1)[0].payload.ready, false, '送るのは取り消し');
    win.close();
  });

  await r.test('10/31：係の画面の「文化祭に出すゲーム」に「テスト中」の札を出さない（出すかどうかは入／切だけ）', async () => {
    const t = await launch({ fakeSocket: true });
    const html = t.win.V2Fes.staff({ staff: { code: 'TST754', fes: { phase: 'lobby', max: 16 }, members: [], tv: 1,
      games: [{ mode: 'bomb-coop', on: true, testing: false }, { mode: 'onaji-many', on: true, testing: true }, { mode: 'qhaya', on: false, testing: true }] },
      fb: [], canFb: true, canNames: true, info: (m) => ({ name: m, world: 'wait' }) });
    const box = t.doc.createElement('div'); box.innerHTML = html;
    const list = box.querySelector('[data-fes-games]');
    assert(list && list.querySelectorAll('[data-fes-game]').length === 3, '入／切の並びがある');
    assert(!/テスト中/.test(list.textContent), '「テスト中」の札は無い（' + list.textContent.trim() + '）');
    t.win.close();
  });

  await r.test('三の束2：待合の BGM は文化祭の TV の待合だけ・係が「入」にした時だけ（はじめは切）。スマホでは鳴らさない', async () => {
    const FesRoom = require('../fes-room');
    const room0 = FesScenes.view('fes2-lobby').room;
    assertEqual(room0.fes.bgm, false, 'はじめは切');
    // TV の端末（部屋の memberId 'tv'＝大画面）として入る（返事を先に置ける入口から）
    const tv = await launch({ fakeSocket: true });
    tv.win.__rtFake.replies = { 'room:create': () => ({ ok: true, code: 'TST754', memberId: 'tv', room: room0 }) };
    await H.makeRoomV2(tv.win, tv.doc);
    tv.win.__rtFake.fire('room:update', room0);
    await waitFor(tv.win, () => act(tv.doc) === 'scr-v2-fes-tv', 4000, 'TV の画面');
    assertEqual(tv.win.bgmWantProbe(), null, '切の間は鳴らさない');
    const on = JSON.parse(JSON.stringify(room0)); on.fes.bgm = true;
    tv.win.__rtFake.fire('room:update', on);
    assertEqual(tv.win.bgmWantProbe(), 'fesWait', '入にしたら、TV の待合で鳴らす');
    const vote = JSON.parse(JSON.stringify(FesScenes.view('fes2-vote').room)); vote.fes.bgm = true;
    tv.win.__rtFake.fire('room:update', vote);
    await waitFor(tv.win, () => act(tv.doc) === 'scr-v2-fes-tv', 2000, 'TV');
    assertEqual(tv.win.bgmWantProbe(), null, '投票になったら止める（待合だけ）');
    tv.win.close();
    const { win } = await 入った();
    win.__rtFake.fire('room:update', on);
    assertEqual(win.bgmWantProbe(), null, 'スマホでは鳴らさない');
    win.close();
    assert(FesRoom, '');
  });

  await r.test('二の束3：TV がいる部屋のスマホの決定は、TV のスポットライトが止まる時刻まで、世界の幕・印・名前を出さない（人数は TV の人数と同じ時刻）', async () => {
    const { win, doc } = await 入った();
    const lab = 流す(win, 'fes2-decide');
    await waitFor(win, () => !!doc.querySelector('#scr-v2-fes-lobby .v2-gname'), 2000, 'スマホの決定');
    const tl = win.V2Fes.decideTimeline({ fes: lab.room.fes });
    const nm = doc.querySelector('#scr-v2-fes-lobby .v2-gname');
    assertEqual(+nm.getAttribute('data-tvat'), +tl.stop.toFixed(2), 'ゲームの名前は TV のスポットライトが止まる秒');
    assert(nm.classList.contains('is-tvwait'), 'まだ隠れている（1.45秒で出ていた）');
    assert(doc.querySelector('#scr-v2-fes-lobby .v2-layer').classList.contains('is-tvwait'), 'ゲームの世界の幕も、まだ下りない（色でばれない）');
    assertEqual(+doc.querySelector('#scr-v2-fes-lobby .v2-who5').getAttribute('data-tvat'), +tl.who.toFixed(2), '人数は TV の人数の秒');
    assert(doc.getElementById('scr-v2-fes-lobby').classList.contains('is-play'), '本人だけの知らせ（fes:you）がすぐあとに来ても、決定の動きは消えない');
    win.close();
  });

  await r.test('門5（画面）：候補が1つで投票を飛ばした時は「このゲームで遊びます！」（スマホとTV）', async () => {
    const { win, doc } = await 入った();
    const lab = 流す(win, 'fes2-decide-one');
    assertEqual(lab.room.fes.pick && lab.room.fes.pick.lot, 'single', '見本は候補1つ（係がほかを切にした部屋）で投票を飛ばしている');
    await waitFor(win, () => /このゲームで遊びます！/.test(doc.getElementById('scr-v2-fes-lobby').textContent), 2000, 'スマホの決定のカード');
    assert(!/えらびました|くじ/.test(doc.getElementById('scr-v2-fes-lobby').textContent), '票やくじの言い方をしない');
    assert(!/自分の投票/.test(doc.getElementById('scr-v2-fes-lobby').textContent), '投票していないので「自分の投票」を出さない（fes-walk で見つけた）');
    win.V2Screens.fes(FesScenes.view('fes2-tv-decide-one'));
    await sleep(win, 60);
    const tv = doc.getElementById('scr-v2-fes-tv').textContent;
    assert(/このゲームで遊びます！/.test(tv), 'TVの決定のカード');
    assert(!/えらびました|くじ/.test(tv), 'TVも票やくじの言い方をしない');
    win.close();
  });

  await r.test('門4（画面）：投票中のスマホにもTVにも、票の数が出ない', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-voted');
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-vok'), 2000, '投票ずみ');
    const 字 = doc.getElementById('scr-v2-fes-lobby').querySelector('.v2-vlist').textContent;
    assert(!/\d+\s*(人|票)/.test(字), 'スマホの候補の札に、人数・票数が無い（' + 字.slice(0, 60) + '）');
    win.V2Screens.fes(FesScenes.view('fes2-tv-vote'));
    const tv = doc.getElementById('scr-v2-fes-tv').querySelector('.v2-vrows').textContent;
    assert(tv.length > 10 && !/\d+\s*(人|票)/.test(tv), 'TVの候補の行に、人数・票数が無い');
    win.close();
  });

  await r.test('門6（画面）：係が名前を隠すと、スマホの名簿は ●●●、TVの札と名前の壁から消える', async () => {
    const { win, doc } = await 入った();
    const lab = FesScenes.view('fes2-tv-lobby');
    // 本物の部屋の知らせと同じ形で「隠した」を作る（publicSnapshot は名前を ●●● にし、fes.hidden に id を入れる）
    const room = JSON.parse(JSON.stringify(lab.room));
    const target = room.members.find((m) => m.name === 'びび');
    target.name = '●●●'; room.fes.hidden = [target.id];
    win.__rtFake.fire('room:update', room);
    await sleep(win, 30);
    const roster = doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Roster"]').textContent;
    assert(roster.indexOf('●●●') !== -1 && roster.indexOf('びび') === -1, 'スマホの名簿は ●●●');
    win.V2Screens.fes(Object.assign({}, lab, { room }));
    const tv = doc.getElementById('scr-v2-fes-tv');
    assertEqual(Array.from(tv.querySelectorAll('.v2-tmem-nm')).filter((e) => /●●●|びび/.test(e.textContent)).length, 0, 'TVの札から消える');
    assert(tv.querySelector('.v2-wall').textContent.indexOf('●●●') === -1, 'TVの名前の壁にも出ない');
    win.close();
  });

  await r.test('門7（画面）：遊んで待合にもどると感想のカードが出て、★を押した時点で送る・開いている間は押し直せる', async () => {
    const { win, doc } = await 入った();
    // 遊んだ回のあとの待合（自分が遊んだ人に入っている）
    const lab = FesScenes.view('fes2-result');
    const room = JSON.parse(JSON.stringify(lab.room));
    room.fes.phase = 'lobby'; room.state.data = {};
    win.__rtFake.fire('room:update', room);
    await waitFor(win, () => doc.querySelector('[data-v2-id="v2FbPop"].is-open'), 2000, '感想のカード');
    win.__rtFake.replies['fes:feedback'] = () => ({ ok: true });
    doc.querySelector('[data-fes-star="4"]').click();
    assertEqual(emits(win, 'fes:feedback').length, 1, '★を押した時点で送る（送るボタンを待たない）');
    assertEqual(emits(win, 'fes:feedback')[0].payload.stars, 4, '★4');
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-sent'), 2000, '「送りました」');
    assert(doc.querySelector('[data-v2-id="v2FbPop"]').classList.contains('is-open'), 'カードは開いたまま');
    doc.querySelector('[data-fes-star="2"]').click();
    assertEqual(emits(win, 'fes:feedback').length, 2, '押し直すと、もう一度送る（サーバーが上書き）');
    assertEqual(emits(win, 'fes:feedback')[1].payload.stars, 2, '★2');
    // 同じゲームは1日1回だけ聞く：次の知らせが来ても、もう一度は開かない
    doc.querySelector('[data-fes-act="fbfold"]').click();
    win.__rtFake.fire('room:update', room);
    await sleep(win, 30);
    assert(!doc.querySelector('[data-v2-id="v2FbPop"]').classList.contains('is-open'), 'たたんだら、知らせが来ても勝手に開かない');
    win.close();
  });

  await r.test('F11（画面）：クイズ解除の解除中は新しい見た目。マスを押すと開き、3択で答え、閉じると手放す（今の画面と同じ送り方）', async () => {
    const { win, doc } = await 入った();
    const lab = 流す(win, 'fes2-play');
    win.__rtFake.fire('wolf:you', lab.secret);
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-bgrid'), 2000, '盤');
    const scr = doc.getElementById('scr-v2-fes-lobby');
    assertEqual(scr.querySelectorAll('.v2-bcell').length, lab.secret.board.length, 'マスの数は盤と同じ');
    assertEqual(scr.querySelectorAll('.v2-bcell.is-solved').length, lab.secret.board.filter((c) => c.solved).length, '解いたマス');
    assert(scr.querySelectorAll('.v2-bcell.is-try .v2-bcell-who').length >= 1, '挑戦中のマスは点線と名前（色ではなく形）');
    assert(scr.querySelector('.v2-bcell.is-miss'), '外したマスに ✕ の印');
    assert(scr.querySelector('[data-v2-id="v2Q"]').classList.contains('is-open'), '開いているコードの3択が出ている');
    const 空き = scr.querySelector('.v2-bcell:not(:disabled):not(.is-mine)');
    空き.click();
    assertEqual(emits(win, 'wolf:act').slice(-1)[0].payload.targetId, 空き.getAttribute('data-fes-cell'), 'マスを押すと、そのコードを開く');
    scr.querySelector('[data-fes-ans]').click();
    assertEqual(emits(win, 'wolf:vote').slice(-1)[0].payload.targetId, scr.querySelector('[data-fes-ans]').getAttribute('data-fes-ans'), '3択を押すと答える');
    scr.querySelector('[data-fes-act="bclose"]').click();
    assertEqual(emits(win, 'wolf:act').slice(-1)[0].payload.targetId, null, '閉じると手放す');
    assertEqual(scr.querySelectorAll('.v2-bcell.is-solved:not(:disabled)').length, 0, '解いたマスは押せない');
    win.close();
  });

  // ===================== 指示68-0b =====================
  await r.test('A4：係の「外す」は、1回押しただけでは外れない。たずねる枠（名前・外すとどうなるか）で「外す」を押して、はじめて送る', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    const lab = FesScenes.view('fes2-staff');
    win.V2Screens.fes(lab);
    const scr = doc.getElementById('scr-v2-fes-staff');
    const 人 = lab.staff.members.find((m) => m.id === 'm2');
    scr.querySelector('[data-fes-kick="m2"]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:kick').length, 0, '1回押しただけでは送らない');
    const dlg = scr.querySelector('[data-v2-id="v2Kick"]');
    assert(dlg && dlg.classList.contains('is-open'), 'たずねる枠が開く');
    assert(dlg.textContent.indexOf(人.name) !== -1, 'だれを外すか、名前が出る');
    assert(/スマホ/.test(dlg.textContent) && /もう一度/.test(dlg.textContent), '外すとどうなるか（その人のスマホ・もう一度入れるか）を書く');
    dlg.querySelector('[data-v2-close]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:kick').length, 0, '「やめる」なら送らない');
    scr.querySelector('[data-fes-kick="m2"]').click();
    await sleep(win, 30);
    scr.querySelector('[data-v2-id="v2Kick"] [data-v2-act="fes-kick-ok"]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:kick').length, 1, '枠の「外す」で1回だけ送る');
    assertEqual(emits(win, 'fes:kick')[0].payload.memberId, 'm2', '押した人を外す');
    // 「隠す」は今のまま（すぐもどせるので、たずねない）
    scr.querySelector('[data-fes-hide="m4"]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:hide').length, 1, '「隠す」はたずねずに送る');
    win.close();
  });

  await r.test('B2：文化祭の「入る」は、名前が空・8字より長い・はじかれた直後は押せない。字を入れるたびにボタンも変わる', async () => {
    const { win, doc } = await 入る画面();
    doc.querySelector('[data-fes-diff="normal"]').click();
    const btn = () => doc.querySelector('[data-fes-act="join"]');
    const 打つ = (v) => { const n = doc.querySelector('[data-fes-name]'); n.value = v; n.dispatchEvent(new win.Event('input', { bubbles: true })); };
    打つ('');
    assert(btn().disabled, '名前が空なら押せない');
    打つ('ふう');
    assert(!btn().disabled, '名前とむずかしさがそろえば押せる');
    打つ('あいうえおかきくけ');
    assert(btn().disabled, '8字より長いと押せない');
    打つ('ふう');
    assert(!btn().disabled, '8字にもどすと押せる');
    // はじかれた直後（●●●）：見本 F2b と同じ形を描く
    win.V2Screens.fes(FesScenes.view('fes2-join-bad'));
    assert(btn().disabled, 'はじかれた直後は押せない');
    win.close();
  });

  await r.test('B3：文化祭の画面のルールのシートの時間は、文化祭の値（投票の札と TV と同じ）', async () => {
    const { win, doc } = await 入った();
    const lab = 流す(win, 'fes2-vote');
    await sleep(win, 30);
    const 分 = win.UiText.FES.投票.分;
    // この場面の候補のゲーム（指示71 追記2a で、分の表に2.0 の5本も足した。候補でないゲームのシートは、この場面には無い）
    const modes = (lab.room.fes.candidates || []).filter((m) => 分[m] != null);
    assert(modes.length >= 3, '文化祭のゲームが3つ以上');
    modes.forEach((mode) => {
      const sheet = doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Rules-' + mode + '"]');
      assert(sheet, mode + '：ルールのシートがある');
      const t = sheet.textContent;
      assert(t.indexOf('約' + 分[mode] + '分') !== -1, mode + '：シートの時間が文化祭の値（約' + 分[mode] + '分）：' + t.slice(0, 60));
      assertEqual((t.match(/約\d+分/g) || []).length, 1, mode + '：時間はひとつだけ');
    });
    win.close();
  });

  // 指示68-T 1・2：投票の ⓘ は、投票する前でもシートを開く（4本とも）。中身はくわしい説明（札の3行ではない）
  const 文化祭の4本 = ['bomb-coop', 'onaji-many', 'pittari', 'soroe'];
  const くわしく = (win, mode) => (win.modeProbe(mode).bullets || []).filter((t) => !/^1人1台・部屋が必要|^部屋を立てて遊ぶと/.test(t));
  const シートの文 = (sheet) => Array.from(sheet.querySelectorAll('.v2-rl-t')).map((e) => e.textContent);
  await r.test('68-T 1・2：投票する前に ⓘ を押すとシートが開く（4本とも）。えらばない。中身はくわしい説明', async () => {
    const { win, doc } = await 入った();
    const lab = FesScenes.view('fes2-vote');
    lab.room.fes.candidates = 文化祭の4本.slice();
    win.__rtFake.fire('room:update', lab.room);
    win.__rtFake.fire('fes:you', lab.you);
    await sleep(win, 40);
    const scr = doc.getElementById('scr-v2-fes-lobby');
    assert(!(lab.you || {}).vote, '前提：まだ投票していない');
    for (const mode of 文化祭の4本) {
      const i = scr.querySelector('[data-fes-pick="' + mode + '"] [data-v2-open]');
      assert(i, mode + '：札に ⓘ がある');
      i.click();
      const sheet = scr.querySelector('[data-v2-id="v2Rules-' + mode + '"]');
      assert(sheet && sheet.classList.contains('is-open'), mode + '：ⓘ でシートが開いた');
      assertEqual(scr.querySelectorAll('.v2-vcard.is-on').length, 0, mode + '：ⓘ を押しても札はえらばれない');
      const 期待 = くわしく(win, mode);
      assert(期待.length >= 4, mode + '：くわしい説明が4行以上ある（札の3行より多い）');
      assertEqual(シートの文(sheet).join('｜'), 期待.join('｜'), mode + '：シートの中はくわしい説明');
      assert(!/部屋が必要/.test(sheet.textContent), mode + '：「部屋が必要です」は出さない');
      // 知らせが来て描き直しても、開いたまま
      win.__rtFake.fire('room:update', lab.room);
      await sleep(win, 20);
      assert(scr.querySelector('[data-v2-id="v2Rules-' + mode + '"]').classList.contains('is-open'), mode + '：描き直しても開いたまま');
      scr.querySelector('[data-v2-id="v2Rules-' + mode + '"] .v2-sfoot [data-v2-close]').click();
      assert(!scr.querySelector('[data-v2-id="v2Rules-' + mode + '"]').classList.contains('is-open'), mode + '：閉じる で閉じる');
    }
    // 札そのものを押せば、今までどおりえらべる
    scr.querySelector('[data-fes-pick="pittari"]').click();
    await sleep(win, 20);
    assertEqual(doc.querySelector('#scr-v2-fes-lobby .v2-vcard.is-on').getAttribute('data-fes-pick'), 'pittari', '札を押すとえらべる');
    // 投票したあとも ⓘ で開く
    const voted = FesScenes.view('fes2-voted');
    voted.room.fes.candidates = 文化祭の4本.slice();
    win.__rtFake.fire('room:update', voted.room);
    win.__rtFake.fire('fes:you', voted.you);
    await sleep(win, 40);
    doc.querySelector('#scr-v2-fes-lobby [data-fes-pick="soroe"] [data-v2-open]').click();
    assert(doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Rules-soroe"]').classList.contains('is-open'), '投票したあとも ⓘ で開く');
    win.close();
  });

  await r.test('68-T 1：長押しでルールを開いた時、指を離した click で札をえらばない（開いたまま）', async () => {
    const { win, doc } = await 入った();
    const lab = FesScenes.view('fes2-vote');
    lab.room.fes.candidates = 文化祭の4本.slice();
    win.__rtFake.fire('room:update', lab.room);
    win.__rtFake.fire('fes:you', lab.you);
    await sleep(win, 40);
    const card = doc.querySelector('#scr-v2-fes-lobby [data-fes-pick="onaji-many"]');
    const r0 = card.getBoundingClientRect();
    const ev = (type) => new win.PointerEvent(type, { bubbles: true, clientX: r0.left + 10, clientY: r0.top + 10 });
    card.dispatchEvent(ev('pointerdown'));
    await sleep(win, 600);
    assert(doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Rules-onaji-many"]').classList.contains('is-open'), '長押しで開いた');
    card.dispatchEvent(ev('pointerup'));
    card.click();
    await sleep(win, 30);
    assertEqual(doc.querySelectorAll('#scr-v2-fes-lobby .v2-vcard.is-on').length, 0, '長押しのあとの click ではえらばない');
    assert(doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Rules-onaji-many"]').classList.contains('is-open'), '開いたまま');
    win.close();
  });

  await r.test('68-T 5：文化祭の TV は、端末に残っている演出の速さ（なし）を使わず「ふつう」。スマホとふだんの部屋は設定のまま', async () => {
    const { win } = await 入った({ prefs: { fxSpeed: 'skip' } });
    const lab = FesScenes.view('fes2-lobby');
    const 送る = async (room) => { win.__rtFake.fire('room:update', room); await sleep(win, 30); return win.fxSpeedProbe(); };
    let p = await 送る(lab.room);
    assertEqual(p.speed + '/' + p.ms, 'skip/0', '文化祭のスマホは設定のまま（なし）');
    const tvRoom = JSON.parse(JSON.stringify(lab.room));
    tvRoom.members.forEach((m) => { if (m.id === 'm1') m.role = 'bigscreen'; });
    p = await 送る(tvRoom);
    assertEqual(p.speed + '/' + p.ms + '/' + p.scale, 'normal/1000/1', '文化祭の TV は「ふつう」（--fx-scale も 1）');
    assert(!win.document.documentElement.classList.contains('fx-skip'), 'TV では「なし」の印も外れる');
    assertEqual(p.pref, 'skip', '端末の設定そのものは変えない');
    const ふだん = JSON.parse(JSON.stringify(tvRoom)); delete ふだん.fes;
    p = await 送る(ふだん);
    assertEqual(p.speed + '/' + p.ms + '/' + p.scale, 'skip/0/0', 'ふだんの部屋の TV は設定のまま');
    win.close();
  });

  await r.test('68-T 2：準備OK の「くわしく見る」も、くわしい説明', async () => {
    const { win, doc } = await 入った();
    const lab = 流す(win, 'fes2-ready');
    await sleep(win, 40);
    const mode = lab.room.fes.pick.mode;
    const more = doc.querySelector('#scr-v2-fes-lobby .v2-rmore[data-v2-open]');
    assert(more, '「くわしく見る」がある');
    more.click();
    const sheet = doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Rules-' + mode + '"]');
    assert(sheet.classList.contains('is-open'), '開いた');
    assertEqual(シートの文(sheet).join('｜'), くわしく(win, mode).join('｜'), 'シートの中はくわしい説明');
    win.close();
  });

  await r.test('68-2 第1節：文化祭のクイズ解除の終わりの演出は1回だけ（決着の瞬間の今までの画面と、結果の段階の新しい画面の両方が呼んでも）', async () => {
    const { win, doc } = await 入った();
    const 数 = [];
    const mo = new win.MutationObserver((recs) => recs.forEach((rec) => Array.from(rec.addedNodes).forEach((n) => {
      if (n.classList && n.classList.contains('fx-finale')) 数.push(n.getAttribute('data-fx-finale'));
    })));
    mo.observe(doc.body, { childList: true, subtree: true });
    // 解除中（新しい画面）を見てから
    const 遊ぶ = FesScenes.view('fes2-play');
    win.__rtFake.fire('room:update', 遊ぶ.room);
    win.__rtFake.fire('fes:you', 遊ぶ.you);
    win.__rtFake.fire('wolf:you', 遊ぶ.secret);
    await sleep(win, 150);
    const lab = FesScenes.view('fes2-boom');
    // 決着の瞬間：クイズ解除は終わったが、文化祭はまだ「遊ぶ」（今までの画面にもどる）
    const 瞬間 = JSON.parse(JSON.stringify(lab.room));
    瞬間.fes.phase = 'play';
    const d = 瞬間.state.data;
    win.__rtFake.fire('room:update', 瞬間);
    win.__rtFake.fire('fes:you', lab.you);
    win.__rtFake.fire('wolf:you', { phase: 'ended', mode: 'coop', total: d.board.length, board: d.board, result: d.result, lives: 0, livesMax: 3 });
    await sleep(win, 150);
    // 結果の段階（新しい画面）
    win.__rtFake.fire('room:update', lab.room);
    await sleep(win, 150);
    mo.disconnect();
    assertEqual(数.join(','), 'boom', '終わりの演出は1回（' + 数.join(',') + '）');
    win.close();
  });

  // 指示71-2 で見つけた：文化祭の待合の「アイコン・二つ名をかえる」（data-v2-open と data-fes-act="look" の両方）を押しても、シートが開かなかった。
  // 文化祭の押した時の処理が先に待合を描き直し、そのあと v2 の部品が、もう無いボタンからシートを探していた（本物の Chrome で見た）
  await r.test('F5 着替え：文化祭の待合で「アイコン・二つ名をかえる」を押すと、着替えのシートが開く', async () => {
    const { win, doc, errors } = await 入った();
    流す(win, 'fes2-lobby');
    await sleep(win, 200);
    doc.querySelector('#scr-v2-fes-lobby [data-fes-act="look"]').click();
    const look = () => doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Look"]');
    await waitFor(win, () => look() && look().classList.contains('is-open'), 2000, '着替えのシートが開く');
    H.assertNoErrors(errors, '着替えで未捕捉の例外');
    win.close();
  });

  await r.test('指示71-2：文化祭の待合で ⚙ → アプリの設定 →「アイコン・二つ名」→ 新しい見た目の着替えのシート（古い scr-titles へ行かない）', async () => {
    const { win, doc, errors } = await 入った();
    流す(win, 'fes2-lobby');
    await sleep(win, 200);
    doc.querySelector('#scr-v2-fes-lobby [data-v2-act="gear"]').click();
    await sleep(win, 150);
    const ov = doc.getElementById('settingsOverlay');
    assert(ov.classList.contains('show') && ov.classList.contains('v2'), '⚙ の設定が、新しい見た目（v2）で開く');
    doc.querySelector('#settingsOverlay [data-setpage="app"]').click();
    await sleep(win, 100);
    doc.querySelector('#settingsOverlay [data-setact="titles"]').click();
    const look = () => doc.querySelector('#scr-v2-fes-lobby [data-v2-id="v2Look"]');
    await waitFor(win, () => look() && look().classList.contains('is-open'), 2000, '着替えのシートが開く');
    assertEqual(act(doc), 'scr-v2-fes-lobby', '古い scr-titles へ行かない');
    assert(!ov.classList.contains('show'), '設定は閉じる');
    H.assertNoErrors(errors, '⚙ から着替えで未捕捉の例外');
    win.close();
  });

  // ===== 指示71 追記1・71-6：予約を取っておく・「どうぞ」に気づける =====
  /** 満員で入れない → 予約する（返事の合い札・何番目は reply で決める） */
  async function 予約した(reserveReply, o) {
    const t = await 入る画面(o);
    const { win, doc } = t;
    win.__rtFake.replies['room:join'] = () => ({ ok: false, error: 'room_full', message: '満員です' });
    win.__rtFake.replies['fes:reserve'] = reserveReply;
    const n = doc.querySelector('[data-fes-name]');
    n.value = 'まち'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.querySelector('[data-fes-diff="normal"]').click();
    doc.querySelector('[data-fes-act="join"]').click();
    await waitFor(win, () => doc.querySelector('[data-fes-act="reserve"]'), 3000, '満員 → 予約のボタン');
    doc.querySelector('[data-fes-act="reserve"]').click();
    await waitFor(win, () => /予約しました/.test(doc.getElementById('scr-v2-fes-join').textContent), 3000, '予約しました');
    return t;
  }
  const 予約中につなぎ直す = (win) => { win.__rtFake.fire('disconnect'); win.__rtFake.connected = true; win.__rtFake.fire('connect'); };

  await r.test('追記1：予約の合い札を覚え、つなぎ直したら合い札で予約にもどる（何番目も今のものに合わせる）', async () => {
    let n = 0;
    const { win, doc, errors } = await 予約した((p) => (++n === 1 ? { ok: true, pos: 3, token: 'tok123abc', etaMs: 4 * 60000 } : { ok: true, pos: 2, token: 'tok123abc' }));
    const sv = JSON.parse(win.localStorage.getItem('acac-fes-reserve'));
    assertEqual(sv && sv.token, 'tok123abc', '合い札を端末に覚えた');
    assert(/あと約s*4s*分/.test(doc.getElementById('scr-v2-fes-join').textContent), '「あと約4分」');
    予約中につなぎ直す(win);
    await waitFor(win, () => emits(win, 'fes:reserve').some((e) => e.payload.resume === 'tok123abc'), 2000, 'つなぎ直したら合い札を添えて聞く');
    await waitFor(win, () => /予約しました（2番目/.test(doc.getElementById('scr-v2-fes-join').textContent), 2000, '今の順番（2番目）に合わせる');
    H.assertNoErrors(errors, '予約のつなぎ直しで未捕捉の例外');
    win.close();
  });

  await r.test('追記1：60秒をすぎて予約が消えていた → 「順番が消えました。もう一度予約してね」（「予約しました」のままにしない）・予約のボタンにもどる', async () => {
    let n = 0;
    const { win, doc, errors } = await 予約した(() => (++n === 1 ? { ok: true, pos: 1, token: 'tokgone1' } : { ok: false, error: 'reserve_gone', message: '順番が消えました' }));
    予約中につなぎ直す(win);
    const txt = () => doc.getElementById('scr-v2-fes-join').textContent;
    await waitFor(win, () => /順番が消えました。もう一度予約してね/.test(txt()), 2000, '消えたと出る');
    assert(!/予約しました/.test(txt()), '「予約しました」は消える');
    assert(doc.querySelector('[data-fes-act="reserve"]'), 'もう一度予約できる');
    assertEqual(win.localStorage.getItem('acac-fes-reserve'), null, '合い札は忘れる');
    H.assertNoErrors(errors, '消えた予約で未捕捉の例外');
    win.close();
  });

  await r.test('71-6：「どうぞ」が届くと、ふるえる・音（TV がいる部屋でもこの端末で）・画面いっぱいの「どうぞ！ 20秒以内に入ってね」と残りの秒数', async () => {
    const { win, doc, errors } = await 予約した(() => ({ ok: true, pos: 1, token: 'tokturn1' }));
    const ふるえ = [], 音 = [];
    win.navigator.vibrate = (p) => { ふるえ.push(p); return true; };
    const play = win.Sound.play; win.Sound.play = (id, opt) => { 音.push(id + ':' + !!(opt && opt.force)); return play.call(win.Sound, id, opt); };
    win.__rtFake.replies['room:join'] = () => undefined;   // 入る返事はまだ来ない（その間の画面を見る）
    win.__rtFake.fire('fes:turn', { code: 'TST754', token: 'tokturn1' });
    await sleep(win, 150);
    const t = doc.querySelector('#scr-v2-fes-join .v2-turn');
    assert(t && /どうぞ！/.test(t.textContent) && /20秒以内に入ってね/.test(t.textContent), '画面いっぱいの「どうぞ！」');
    assertEqual(t.querySelector('[data-fes-turnsec]').textContent, '20', '残り20秒');
    await sleep(win, 1200);
    assert(+t.querySelector('[data-fes-turnsec]').textContent <= 19, '秒が減る（' + t.querySelector('[data-fes-turnsec]').textContent + '）');
    assert(ふるえ.length >= 1, 'ふるえた');
    assert(音.indexOf('decide:true') !== -1, 'この端末で音を鳴らす（force・' + 音.join(',') + '）');
    assert(emits(win, 'room:join').some((e) => e.payload.reserve === 'tokturn1' || e.payload.reserve === undefined), 'そのまま自分で入りにいく');
    H.assertNoErrors(errors, '「どうぞ」で未捕捉の例外');
    win.close();
  });

  await r.test('71-6：設定の「振動」が切なら、「どうぞ」でもふるえない（音と画面は出る）', async () => {
    const { win, doc } = await 予約した(() => ({ ok: true, pos: 1, token: 'tokturn2' }), { prefs: { vibrate: false } });
    const ふるえ = [];
    win.navigator.vibrate = (p) => { ふるえ.push(p); return true; };
    win.__rtFake.replies['room:join'] = () => undefined;
    win.__rtFake.fire('fes:turn', { code: 'TST754', token: 'tokturn2' });
    await sleep(win, 200);
    assertEqual(ふるえ.length, 0, 'ふるえない');
    assert(doc.querySelector('#scr-v2-fes-join .v2-turn'), '画面は出る');
    win.close();
  });

  await r.test('追記1：予約したまま開き直した端末は、合い札で予約にもどり、名前とむずかしさも元にもどる（「どうぞ」でそのまま入れる）', async () => {
    const sv = JSON.stringify({ code: 'TST754', token: 'tokre1', name: 'まち', diff: 'easy' });
    const t = await launch({ url: URL, fakeSocket: true, storage: { 'acac-fes-reserve': sv },
      rtSeed: 'window.__rtFake.replies = { "room:peek": function(){ return { ok: true, code: "TST754", playerCount: 16, fes: true }; }, "fes:reserve": function(p){ return p.resume === "tokre1" ? { ok: true, pos: 1, token: "tokre1" } : { ok: false, error: "x" }; } };' });
    const { win, doc, errors } = t;
    await waitFor(win, () => /予約しました（1番目/.test((doc.getElementById('scr-v2-fes-join') || {}).textContent || ''), 6000, '開き直しても予約しました（1番目）');
    assertEqual(doc.querySelector('[data-fes-name]').value, 'まち', '名前がもどる');
    assert(doc.querySelector('[data-fes-diff="easy"].is-on'), 'むずかしさがもどる');
    win.__rtFake.replies['room:join'] = () => undefined;
    win.__rtFake.fire('fes:turn', { code: 'TST754', token: 'tokre1' });
    await waitFor(win, () => emits(win, 'room:join').some((e) => e.payload.name === 'まち' && e.payload.diff === 'easy' && e.payload.reserve === 'tokre1'), 2000, '「どうぞ」で、名前とむずかしさと合い札を添えて入りにいく');
    H.assertNoErrors(errors, '開き直した予約で未捕捉の例外');
    win.close();
  });

  // ===== 指示71 追記2 =====
  await r.test('追記2h・2i：TV の準備OK の帯は、待っている人を名前ではなく人数で。全員押したら「そろいました！」', async () => {
    const lab = FesScenes.view('fes2-tv-ready');
    const room = JSON.parse(JSON.stringify(lab.room));
    const { win, doc } = await launch({ url: 'http://localhost/?room=TST754&fes=1&tv=1', fakeSocket: true, noDoorWait: true,
      rtSeed: 'window.__rtFake.replies = { "room:join": function(p, cb){ setTimeout(function(){ cb({ ok: true, code: "TST754", memberId: "tv", room: ' + JSON.stringify(room) + ' }); }, 30); return undefined; } };' });
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-tv .v2-tband'), 8000, 'TV の準備OK');
    const ps = room.members.filter((m) => m.role !== 'bigscreen');
    const send = () => win.__rtFake.fire('room:update', JSON.parse(JSON.stringify(room)));
    ps.forEach((m, i) => { m.ready = i >= 1; });   // 1人だけまだ
    send(); await sleep(win, 150);
    const band = () => doc.querySelector('#scr-v2-fes-tv .v2-tband').textContent;
    assert(/1人を待っています/.test(band()), '人数で（' + band() + '）');
    assert(!ps.some((m) => band().indexOf(m.name) !== -1), '帯に名前を出さない');
    ps.forEach((m) => { m.ready = true; });
    send(); await sleep(win, 150);
    assert(/そろいました！/.test(band()) && !/準備中/.test(band()), '全員押したら「そろいました！」（' + band() + '）');
    win.close();
  });

  await r.test('追記2f：部屋が無い朝の TV は「まもなく始まります」。作り直しの途中（wait=1）だけ「作り直しています」', async () => {
    for (const [url, want, no] of [['http://localhost/?fes=1&tv=1', /まもなく始まります/, /作り直して/], ['http://localhost/?fes=1&tv=1&wait=1', /作り直して/, /まもなく始まります/]]) {
      const { win, doc } = await launch({ url, fakeSocket: true });
      await waitFor(win, () => /まもなく|作り直して/.test((doc.getElementById('scr-v2-fes-tv') || {}).textContent || ''), 6000, 'TV の待つ画面');
      const t = doc.getElementById('scr-v2-fes-tv').textContent;
      assert(want.test(t) && !no.test(t), url + '：' + t.slice(0, 60));
      win.close();
    }
  });

  await r.test('追記2e：満員は、名前の欄の赤い字ではなく、赤を使わない札（予約のボタンも出る）', async () => {
    const t = await 入る画面();
    const { win, doc } = t;
    win.__rtFake.replies['room:join'] = () => ({ ok: false, error: 'room_full', message: '満員です' });
    const n = doc.querySelector('[data-fes-name]');
    n.value = 'まち'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.querySelector('[data-fes-diff="normal"]').click();
    doc.querySelector('[data-fes-act="join"]').click();
    await waitFor(win, () => doc.querySelector('[data-fes-act="reserve"]'), 3000, '予約のボタン');
    assert(!doc.querySelector('#scr-v2-fes-join .v2-why, #scr-v2-fes-join .is-bad'), '赤い字（名前のまちがいの形）では出さない');
    assert(/満員/.test(doc.querySelector('#scr-v2-fes-join .v2-note').textContent), '赤を使わない札で満員と出す');
    win.close();
  });

  await r.test('追記2j：クイズ解除の結果の時間は言葉で（「23秒で解除！」）', async () => {
    const { win } = await launch({});
    assertEqual([23, 83, 120, 0].map((x) => win.V2Fes.clearTimeText(x)).join('｜'), '23秒で解除！｜1分23秒で解除！｜2分で解除！｜0秒で解除！', '言葉で');
    win.close();
  });

  await r.test('追記2k：入る画面の「いま◯人」は、人数が変わったら書きかわる（名前を打っている途中は描き直さない）', async () => {
    const { win, doc } = await 入る画面();
    const pill = () => doc.querySelector('#scr-v2-fes-join [data-fes-n]').textContent;
    assert(!/16人/.test(pill()), 'はじめは16人ではない（' + pill() + '）');
    const n = doc.querySelector('[data-fes-name]');
    n.value = 'うち'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
    win.__rtFake.replies['room:peek'] = () => ({ ok: true, code: 'TST754', playerCount: 16, fes: true });
    await waitFor(win, () => /16人/.test(pill()), 12000, '16人に書きかわる');
    assertEqual(doc.querySelector('[data-fes-name]'), n, '名前の欄はそのまま（描き直していない）');
    win.close();
  });

  r.finish();
})();
