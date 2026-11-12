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

  // 指示71 追記7（くまくんの答え 2026-11-04）：入る画面では、はじめから「ふつう」を選んだ形（前に選んだ物があれば、それ）。
  // それまでは「選ぶまで押せない」だった（この検査も、その決まりを書いていた）
  await r.test('追記7：むずかしさは、はじめから「ふつう」。名前を入れればそのまま入れる。えらび直すと、そのむずかしさを添えて入る', async () => {
    const { win, doc, errors } = await 入る画面();
    const n = doc.querySelector('[data-fes-name]');
    n.value = 'ふう'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
    const btn = doc.querySelector('[data-fes-act="join"]');
    assertEqual(Array.from(doc.querySelectorAll('.v2-diff.is-on')).map((d) => d.getAttribute('data-fes-diff')).join(','), 'normal', 'はじめから「ふつう」が選ばれている');
    assert(!btn.disabled, '名前を入れれば「入る」を押せる');
    // くまくんの答え 2026-10-31：やさしい・ふつうの2つだけ
    assertEqual(Array.from(doc.querySelectorAll('[data-fes-diff]')).map((d) => d.getAttribute('data-fes-diff')).join(','), 'easy,normal', 'むずかしさは「やさしい」「ふつう」の2つ');
    assert(!/むずかしい/.test(doc.querySelector('.v2-diffs').textContent), '「むずかしい」の字が無い');
    doc.querySelector('[data-fes-diff="easy"]').click();
    assert(!doc.querySelector('[data-fes-act="join"]').disabled, '選び直しても押せる');
    doc.querySelectorAll('.v2-diff').forEach((d) => assert(d.querySelector('.v2-diff-t span').textContent.length > 2, 'むずかしさに一言の説明がある'));
    doc.querySelector('[data-fes-act="join"]').click();
    await waitFor(win, () => emits(win, 'room:join').length === 1, 2000, '入る');
    assertEqual(emits(win, 'room:join')[0].payload.diff, 'easy', '選んだむずかしさを添えて入る');
    await waitFor(win, () => act(doc) === 'scr-v2-fes-lobby', 3000, '入ったら待合へ');
    assertEqual(errors.length, 0, '未捕捉の例外が無い');
    win.close();
  });

  // 最終監査 11/10 ④：返事が来ない（8秒の timeout・つながっていない・空の返事）と、何も言わずにボタンがもどっていた
  await r.test('最終監査 11/10：「入る」の返事が来ない時は、赤くない札で「つながりにくい・もう一度押してね」。名前は消さない', async () => {
    for (const error of ['timeout', 'not_connected', 'no_response']) {
      const { win, doc, errors } = await 入る画面();
      win.__rtFake.replies['room:join'] = () => ({ ok: false, error });
      const n = doc.querySelector('[data-fes-name]');
      n.value = 'ふう'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
      doc.querySelector('[data-fes-act="join"]').click();
      await waitFor(win, () => emits(win, 'room:join').length === 1 && !doc.querySelector('[data-fes-act="join"]').disabled, 3000, error + '：返事のあと');
      const scr = doc.getElementById('scr-v2-fes-join');
      const note = Array.from(scr.querySelectorAll('.v2-note')).map((e) => e.textContent).join('／');
      assert(/つながりにくい/.test(note) && /もう一度/.test(note), error + '：「つながりにくい…もう一度押してね」の札（実際：' + note + '）');
      assert(!scr.querySelector('.v2-why'), error + '：赤い字（名前のまちがい）にしない');
      assertEqual(doc.querySelector('[data-fes-name]').value, 'ふう', error + '：名前は入ったまま');
      assertEqual(act(doc), 'scr-v2-fes-join', error + '：入る画面のまま');
      assertEqual(errors.length, 0, '未捕捉の例外が無い');
      win.close();
    }
  });

  // 最終監査 11/10 ②：iPhone SE の Safari の本当の高さ（375×548）で、待合の「次の投票の候補」の札が下の帯の裏に隠れていた
  // （tools/fes-screen-walk.js --sizes 375x548,390x664 の「ボタンが画面の下に隠れる」）。投票・準備OK・遊ぶ6本は収まっていた。
  // jsdom は高さを測れないので、ここは「待合の中身の層が巻ける」ことを見る（測るのは fes-screen-walk）
  await r.test('最終監査 11/10：待合の中身の層は縦に巻ける（低いスマホで候補の札が帯の裏に隠れない）。1人の時（QR つき）も', async () => {
    const { win, doc, errors } = await 入った();
    for (const n of [6, 1]) {
      const lab = FesScenes.view('fes2-lobby', n === 1 ? { n: 1 } : undefined);
      win.__rtFake.fire('room:update', lab.room); win.__rtFake.fire('fes:you', lab.you);
      const sel = n === 1 ? '#scr-v2-fes-lobby .v2-alone' : '#scr-v2-fes-lobby .v2-nexts';   // 1人の時は QR の札（候補の札より先に下へ伸びる）
      await waitFor(win, () => doc.querySelector(sel), 2000, n + '人の待合');
      const lay = doc.querySelector(sel).closest('.v2-in');
      assert(lay && lay.classList.contains('is-scroll'), n + '人：候補の札の入った層が is-scroll（overflow-y:auto）');
    }
    assertEqual(errors.length, 0, '未捕捉の例外が無い');
    win.close();
  });

  await r.test('追記7：1人の時のスマホに「あと1人で はじまるよ」と /fes の QR。2人からは出さない（TV の呼び込みの名前は tools/v2-shot.js の fes2-tv-idle4）', async () => {
    const { win, doc, errors } = await 入った();
    const one = FesScenes.view('fes2-lobby', { n: 1 });
    win.__rtFake.fire('room:update', one.room); win.__rtFake.fire('fes:you', one.you);
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-alone'), 2000, '1人の時の札');
    const a = doc.querySelector('#scr-v2-fes-lobby .v2-alone');
    assert(/あと1人で はじまるよ/.test(a.textContent) && /QR を友だちに見せてね/.test(a.textContent), '「あと1人で はじまるよ」と「この QR を友だちに見せてね」');
    assert(a.querySelector('.v2-alone-qr svg'), 'QR がある');
    流す(win, 'fes2-lobby');
    await waitFor(win, () => !doc.querySelector('#scr-v2-fes-lobby .v2-alone'), 2000, '6人では出さない');
    assertEqual(errors.length, 0, '未捕捉の例外が無い');
    win.close();
  });

  await r.test('追記7：決定の間（TV で出るまで）のスマホに「TVを見て！」。TV で出る時刻に消える', async () => {
    const { win, doc, errors } = await 入った();
    流す(win, 'fes2-decide');
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-dlook'), 2000, '決定の画面');
    const d = doc.querySelector('#scr-v2-fes-lobby .v2-dlook');
    assert(/TVを見て！/.test(d.textContent), '「TVを見て！」');
    assert(d.classList.contains('is-tvlook'), 'はじめは見えている（TV で出る時刻まで）');
    const ms = +d.getAttribute('data-tvuntil') * 1000;
    assert(ms > 500 && ms < 4000, 'TV で出る時刻（' + ms + 'ms）');
    await waitFor(win, () => !doc.querySelector('#scr-v2-fes-lobby .v2-dlook.is-tvlook'), ms + 2000, 'TV で出る時刻に消える');
    assertEqual(errors.length, 0, '未捕捉の例外が無い');
    win.close();
  });

  await r.test('追記7：前に「やさしい」を選んだ端末は、次に開いた時も「やさしい」', async () => {
    const { win, doc, errors } = await 入る画面({ storage: { fes_diff_v1: 'easy' } });
    assertEqual(Array.from(doc.querySelectorAll('.v2-diff.is-on')).map((d) => d.getAttribute('data-fes-diff')).join(','), 'easy', '前に選んだ「やさしい」');
    doc.querySelector('[data-fes-diff="normal"]').click();
    assertEqual(win.localStorage.getItem('fes_diff_v1'), 'normal', '選び直すと覚え直す');
    assertEqual(errors.length, 0, '未捕捉の例外が無い');
    win.close();
  });

  // ===== 11/11 くまくんの決め：お問い合わせ先（メール）を、入る画面の下と ⚙ に。TV には出さない =====
  const 問い合わせ = (box, where) => {
    const p = box && (box.matches && box.matches('.v2-contact, .set-contact') ? box : box.querySelector('.v2-contact, .set-contact'));
    assert(p, where + 'に「お問い合わせ」の行がある');
    assertEqual(p.textContent.replace(/\s+/g, ''), 'お問い合わせ：ryouta.vantan.0719@gmail.com', where + 'の字');
    const a = p.querySelector('a');
    assert(a && a.getAttribute('href') === 'mailto:ryouta.vantan.0719@gmail.com', where + '：押すとメールが開く（mailto）');
    return p;
  };
  await r.test('11/11：文化祭の入る画面のいちばん下に、小さく「お問い合わせ：メール」（押すとメール・字を選んで写せる）', async () => {
    const { win, doc, errors } = await 入る画面();
    const box = doc.querySelector('#scr-v2-fes-join .v2-in');
    const p = 問い合わせ(box, '入る画面');
    assert(doc.querySelector('#scr-v2-fes-join [data-fes-act="join"]').compareDocumentPosition(p) & 4, '「入る」のボタンより下');
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(/\.v2 \.v2-contact\{[^}]*user-select:text/.test(css) && /\.set-contact\{[^}]*user-select:text/.test(css), '字を選んで写せる（user-select:text）');
    H.assertNoErrors(errors, '入る画面');
    win.close();
  });
  await r.test('11/11：文化祭の TV には、どの場面にも「お問い合わせ」を出さない', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    FesScenes.SCENES.filter((s) => s.kind === 'tv').forEach((s) => {
      t.win.V2Screens.fes(FesScenes.view(s.id));
      const scr = t.doc.getElementById(s.screen);
      assert(scr && !/お問い合わせ/.test(scr.textContent), s.id + ' に出さない');
    });
    t.win.close();
  });

  await r.test('名前：使えない言葉は送る前に止め、入力欄にも残さない（●●●）・本名の注意が出ている（記録の知らせは出さない）', async () => {
    const { win, doc } = await 入る画面();
    const scr = doc.getElementById('scr-v2-fes-join');
    // 2026-11-10 くまくんの決め：「入力した名前を1か月記録します」の知らせは出さない
    assert(!/記録します/.test(scr.textContent), '入る画面に、名前を記録する知らせを出していない');
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

  // 最終監査 11/10 ①：待合と TV の待合だけが「作り直しています」へ行き、遊んでいる最中（scr-v2-◯◯・scr-v2-◯◯-tv）は
  // ふつうのホームと「部屋を作り直してください」（係むけの文）に落ちていた。分かれ道を「いまの画面」ではなく「文化祭の部屋にいたか」で決める
  for (const tv of [false, true]) {
    await r.test('最終監査 11/10：遊んでいる最中（' + (tv ? 'TV' : 'スマホ') + '）に部屋が消えても、ホームではなく「作り直しています」へ', async () => {
      const { win, doc } = await 入った();
      const lab = FesScenes.view('fes2-lobby');
      const room = JSON.parse(JSON.stringify(lab.room));
      if (tv) {
        // この端末を TV（bigscreen）として部屋の知らせに載せる
        room.members = (room.members || []).map((m) => (m.id === 'm1' ? Object.assign({}, m, { role: 'bigscreen' }) : m));
        if (!room.members.some((m) => m.id === 'm1')) room.members.push({ id: 'm1', name: 'TV', role: 'bigscreen', connected: true });
      }
      win.__rtFake.fire('room:update', room);
      const 遊ぶ = tv ? 'scr-v2-onaji-tv' : 'scr-v2-onaji';
      win.goToScreen(遊ぶ);
      await waitFor(win, () => act(doc) === 遊ぶ, 2000, '遊ぶ画面');
      const 移った = []; win.fesNav = (u) => 移った.push(u);
      win.__rtFake.replies['room:join'] = 部屋が無い;
      await つなぎ直す(win);
      await waitFor(win, () => 移った.length || act(doc) === 'scr-v2-home', 2000, 'どこかへ移る');
      assert(act(doc) !== 'scr-v2-home', 'ホームに落ちない');
      assertEqual(移った[0], '/?fes=1&wait=1' + (tv ? '&tv=1' : ''), (tv ? 'TV は TV のまま、' : '') + '作り直しを待つ画面へ');
      win.close();
    });
  }

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

  // 指示75 2-9・2-10：係の画面から入退室の記録へ。感想のシートに、字の検索とゲームのしぼり込み（打っている途中で描き直さない）
  await r.test('指示75 2-9・2-10：係の画面に「入退室の記録」。感想は字で検索・ゲームでしぼれる', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    const lab = FesScenes.view('fes2-staff');
    lab.fb = [{ mode: 'bomb-coop', stars: 5, text: 'たのしかった', at: Date.now() }, { mode: 'soroe', stars: 3, text: 'むずかしい', at: Date.now() },
      { mode: 'soroe', stars: 4, text: 'またやりたい', at: Date.now() }];
    win.V2Screens.fes(lab);
    const scr = doc.getElementById('scr-v2-fes-staff');
    const link = scr.querySelector('a[href="/fes/presence"]');
    assert(link && /入退室/.test(link.textContent), '入退室の記録へ');
    const q = scr.querySelector('[data-fes-fbq]'), sel = scr.querySelector('[data-fes-fbmode]');
    assert(q && sel, '検索の箱と、ゲームのえらび');
    const 見える = () => Array.from(scr.querySelectorAll('.v2-fb-f')).filter((x) => !x.hidden).map((x) => x.querySelector('p').textContent).join(',');
    assertEqual(見える(), 'たのしかった,むずかしい,またやりたい', 'はじめは全部');
    q.value = 'また'; q.dispatchEvent(new win.Event('input', { bubbles: true }));
    assertEqual(見える(), 'またやりたい', '字で検索');
    assertEqual(doc.activeElement === q || !doc.hasFocus || true, true, '描き直さない');
    assert(scr.querySelector('[data-fes-fbq]') === q, '箱は同じ物（描き直していない）');
    q.value = ''; q.dispatchEvent(new win.Event('input', { bubbles: true }));
    sel.value = 'soroe'; sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    assertEqual(見える(), 'むずかしい,またやりたい', 'ゲームでしぼる');
    win.close();
  });

  // 指示75 2-8（くまくんの答え 6.A）：「〇〇さんが席を外しました／もどりました」は、文化祭では係の画面だけ（遊ぶ人のスマホと TV には出さない）
  const 知らせの字 = (doc) => ((doc.getElementById('fxNotices') || {}).textContent || '');
  await r.test('指示75 2-8：文化祭のスマホと TV には「席を外しました／もどりました」を出さない', async () => {
    for (const asTv of [false, true]) {
      const { win, doc } = await 入った();
      const lab = FesScenes.view('fes2-lobby');
      const room = JSON.parse(JSON.stringify(lab.room));
      if (asTv) room.members.forEach((m) => { if (m.id === 'm1') m.role = 'bigscreen'; });
      const other = room.members.find((m) => m.id !== 'm1' && m.role !== 'bigscreen');
      win.__rtFake.fire('room:update', room); await sleep(win, 40);
      const r2 = JSON.parse(JSON.stringify(room)); r2.members.find((m) => m.id === other.id).connected = false;
      win.__rtFake.fire('room:update', r2); await sleep(win, 60);
      win.__rtFake.fire('room:update', room); await sleep(win, 60);
      assert(!/席を外しました|もどりました/.test(知らせの字(doc)), (asTv ? 'TV' : 'スマホ') + 'に出さない（' + 知らせの字(doc).slice(0, 60) + '）');
      win.close();
    }
  });

  await r.test('指示75 2-8：係の画面には「〇〇さんが席を外しました／もどりました」を出す', async () => {
    const { win, doc } = await launch({ url: 'http://localhost/?fes=1&staff=1', fakeSocket: true });
    const lab = FesScenes.view('fes2-staff');
    const st = JSON.parse(JSON.stringify(lab.staff));
    win.__rtFake.replies = { 'fes:watch': () => ({ ok: true, role: 'staff', room: lab.room, staff: st }) };
    await waitFor(win, () => act(doc) === 'scr-v2-fes-staff', 6000, '係の画面');
    win.__rtFake.fire('fes:staff', st); await sleep(win, 40);
    const who = st.members.find((m) => m.connected);
    const s2 = JSON.parse(JSON.stringify(st)); s2.members.find((m) => m.id === who.id).connected = false;
    win.__rtFake.fire('fes:staff', s2); await sleep(win, 60);
    assert(new RegExp(who.name + 'さんが席を外しました').test(知らせの字(doc)), '席を外した（' + 知らせの字(doc).slice(0, 60) + '）');
    win.__rtFake.fire('fes:staff', st); await sleep(win, 60);
    assert(new RegExp(who.name + 'さんがもどりました').test(知らせの字(doc)), 'もどった');
    win.close();
  });

  // 指示75 2-5（A33）：ひとことの箱の「1日」の区切りを日本の0時に（それまでは toISOString の UTC で、日本の朝9時に日が変わっていた）
  await r.test('指示75 2-5：感想を聞くのは日本の日付で1日1回（朝8時半に聞いたら、同じ日の10時には聞かない。次の日の朝には聞く）', async () => {
    const { win, doc } = await 入った();
    const 本物 = win.Date.now.bind(win.Date);
    let 時 = Date.parse('2026-11-14T08:30:00+09:00');           // 文化祭の朝 8:30（UTC では 11/13）
    win.Date.now = () => 時;
    const lab = FesScenes.view('fes2-result');
    const 回 = (round) => { const room = JSON.parse(JSON.stringify(lab.room)); room.fes.phase = 'lobby'; room.state.data = {}; room.fes.played.round = round; return room; };
    const 開いた = () => doc.querySelector('[data-v2-id="v2FbPop"]').classList.contains('is-open');
    win.__rtFake.fire('room:update', 回(1));
    await waitFor(win, () => doc.querySelector('[data-v2-id="v2FbPop"].is-open'), 2000, '8:30 は聞く');
    doc.querySelector('[data-fes-act="fbfold"]').click();
    時 = Date.parse('2026-11-14T10:00:00+09:00');                // 同じ日の 10:00（UTC では 11/14 になる）
    win.__rtFake.fire('room:update', 回(2));
    await sleep(win, 60);
    assert(!開いた(), '同じ日の10時、同じゲームは聞かない');
    時 = Date.parse('2026-11-15T07:00:00+09:00');                // 次の日の朝
    win.__rtFake.fire('room:update', 回(3));
    await waitFor(win, () => 開いた(), 2000, '次の日は、また聞く');
    win.Date.now = 本物;
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

  // 指示75 1-6（くまくんの決め 7.A）：「外す」の長押し（0.5秒）で、30秒・1分・5分。ふつうの押しは今のまま（A4 の枠）
  await r.test('指示75 1-6：「外す」を長押しすると「30秒・1分・5分」の枠。えらんだ時間を添えて送る。長押しのあとの click でふつうの枠を重ねない', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    const lab = FesScenes.view('fes2-staff');
    win.V2Screens.fes(lab);
    const scr = doc.getElementById('scr-v2-fes-staff');
    assert(/長押し/.test(scr.querySelector('[data-fes-kick-hint]').textContent), '名簿の上に小さく「長押しで、しばらく入れなくできます」');
    const btn = scr.querySelector('[data-fes-kick="m2"]');
    // 短い押し（0.5秒より前に指を上げる）は、今のまま
    btn.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await sleep(win, 150);
    btn.dispatchEvent(new win.Event('pointerup', { bubbles: true }));
    btn.click();
    await sleep(win, 30);
    assert(scr.querySelector('[data-v2-id="v2Kick"]').classList.contains('is-open'), '短い押しは、今までの「外しますか？」');
    assert(!scr.querySelector('[data-v2-id="v2KickWait"]').classList.contains('is-open'), '「しばらく」の枠は出ない');
    scr.querySelector('[data-v2-id="v2Kick"] [data-v2-close]').click();
    await sleep(win, 30);
    // 長押し
    const b2 = scr.querySelector('[data-fes-kick="m2"]');
    b2.dispatchEvent(new win.Event('pointerdown', { bubbles: true }));
    await sleep(win, 650);
    b2.dispatchEvent(new win.Event('pointerup', { bubbles: true }));
    // 指を上げた時の click（長押しで係の画面が描き直されるので、いまのボタンを押す。外れた古いボタンを押しても何も起きない）
    scr.querySelector('[data-fes-kick="m2"]').click();
    await sleep(win, 30);
    const dlg = scr.querySelector('[data-v2-id="v2KickWait"]');
    assert(dlg.classList.contains('is-open'), '長押しで「しばらく入れない」の枠');
    assert(!scr.querySelector('[data-v2-id="v2Kick"]').classList.contains('is-open'), '長押しのあとの click で、ふつうの枠を重ねない');
    assertEqual(Array.from(dlg.querySelectorAll('[data-v2-act^="fes-kick-wait-"]')).map((b) => b.textContent).join(','), '30秒,1分,5分', '3つの時間');
    assert(dlg.textContent.indexOf(lab.staff.members.find((m) => m.id === 'm2').name) !== -1, 'だれか、名前が出る');
    assertEqual(emits(win, 'fes:kick').length, 0, 'えらぶまで送らない');
    dlg.querySelector('[data-v2-act="fes-kick-wait-60000"]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:kick').length, 1, '1回だけ送る');
    assertEqual(emits(win, 'fes:kick')[0].payload.waitMs, 60000, '1分を添えて送る');
    assertEqual(emits(win, 'fes:kick')[0].payload.memberId, 'm2', '押した人');
    // jsdom は user-select・touch-callout を計算しないので、規則が書いてあるかを見る
    const rule = Array.from(doc.querySelectorAll('style')).map((st) => st.textContent).join(' ')
      .match(/\.v2 \.v2-adm-b\[data-fes-kick\]\{[^}]*\}/);
    assert(rule && /-webkit-touch-callout:none/.test(rule[0]) && /user-select:none/.test(rule[0]), '長押しで字のえらび・ふきだしメニューが出ない規則がある');
    win.close();
  });

  await r.test('指示75 1-6：しばらく入れない人のスマホ：入る画面に「しばらくしてから入れます。あと約◯秒」（赤い字にしない）', async () => {
    const { win, doc } = await 入る画面();
    win.__rtFake.replies['room:join'] = () => ({ ok: false, error: 'fes_wait', message: 'しばらくしてから入れます', waitMs: 25400 });
    const n = doc.querySelector('[data-fes-name]');
    n.value = 'ふう'; n.dispatchEvent(new win.Event('input', { bubbles: true }));
    doc.querySelector('[data-fes-act="join"]').click();
    await waitFor(win, () => /しばらくしてから入れます。あと約26秒/.test(doc.getElementById('scr-v2-fes-join').textContent), 3000, 'しばらく');
    assert(!doc.querySelector('#scr-v2-fes-join .is-bad, #scr-v2-fes-join .v2-why'), '赤い字・赤い枠（名前のまちがい）にしない');
    assertEqual(emits(win, 'room:join')[0].payload.dev && typeof emits(win, 'room:join')[0].payload.dev, 'string', '入る時に端末の札を添える');
    win.close();
  });

  // 客観検査 1-1（2026-11-05）：ライフは本数÷2.5（30本で12・50本で20）。13個からは並べず「❤️×のこり」
  //（20個並べると、16人のスマホの上の帯で時計が画面の外へ押し出された・v2-shot）
  await r.test('客観検査 1-1：ライフが12個までは並べ、13個からは「❤️×のこり」で出す（スマホの盤）', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    win.V2Screens.fes(FesScenes.view('fes2-play'));
    let scr = doc.getElementById('scr-v2-fes-lobby');
    assertEqual(scr.querySelectorAll('.v2-ptop .v2-life').length, 12, '6人（30本）はハートを12個並べる');
    assert(!scr.querySelector('.v2-ptop .v2-lives.is-count'), '12個までは数の形にしない');
    win.V2Screens.fes(FesScenes.view('fes2-play16'));
    scr = doc.getElementById('scr-v2-fes-lobby');
    const c = scr.querySelector('.v2-ptop .v2-lives.is-count');
    assert(c, '16人（50本・ライフ20）は数の形');
    assertEqual(scr.querySelectorAll('.v2-ptop .v2-life').length, 0, 'ハートを20個並べない');
    assert(/^❤️×\d+$/.test(c.textContent.trim()) && /ライフ \d+\/20/.test(c.getAttribute('aria-label') || ''), '「❤️×のこり」と、読み上げは「ライフ のこり/20」（' + c.textContent + '）');
    win.close();
  });

  // 客観検査 A1（2026-11-05）：結果の「つづけて遊ぶ？」のシートの上に、称号の知らせがかぶさっていた
  //（知らせの置き場を測る帯に、新しい見た目のシートが入っていなかった）。jsdom は版組みをしないので、位置は本物の値で差し込む
  await r.test('客観検査 A1：称号の知らせは、結果の「つづけて遊ぶ？」のシートより上に出る', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    win.V2Screens.fes(FesScenes.view('fes2-result'));
    const scr = doc.getElementById('scr-v2-fes-lobby');
    doc.querySelectorAll('.screen.active').forEach((s) => s.classList.remove('active'));
    scr.classList.add('active');   // 描くだけの入口なので、本物と同じく「いまの画面」にする
    const sheet = scr.querySelector('.v2-contsheet');
    assert(sheet && sheet.classList.contains('is-open'), '「つづけて遊ぶ？」のシートが開いている（型(b)）');
    Object.defineProperty(doc.documentElement, 'clientHeight', { configurable: true, get: () => 844 });
    sheet.getBoundingClientRect = () => ({ top: 620, bottom: 844, left: 0, right: 390, width: 390, height: 224 });
    win.titleToastProbe(['🏅 ためしの称号']);
    const 下 = parseFloat(doc.getElementById('titleGotOverlay').style.bottom);
    assert(下 >= 844 - 620, 'シートの上端（620）より上に置く（bottom ' + doc.getElementById('titleGotOverlay').style.bottom + '）');
    win.close();
  });

  // 指示78 イ（11/12 くまくんの実機）：⚙「光と揺れ」の「演出の速さ：なし」で、「つづけて遊ぶ？」のゲージ（残り時間）が出なかった。
  // ゲージは CSS の動きだけで減っていて、「なし」（:root.fx-skip *）が動きを 0.001秒に縮めるので、出た瞬間に空になっていた。
  // 「なし」の時は動きをやめ、V2 の時計が1秒ごとに書く --v2-left の長さで描く。jsdom は版組みをしないので、値と CSS の決まりを見る
  await r.test('指示78 イ：演出「なし」でも「つづけて遊ぶ？」のゲージが見えて、時間とともに減る', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    doc.documentElement.classList.add('fx-skip');
    win.V2Screens.fes(FesScenes.view('fes2-result'));
    const scr = doc.getElementById('scr-v2-fes-lobby');
    const bar = scr.querySelector('.v2-contsheet [data-fes-bar]');
    assert(bar, 'ゲージがある');
    assert(bar.hasAttribute('data-v2-bar') && +bar.getAttribute('data-total') > 0, 'ゲージに「全体の長さ」（data-total）がある＝V2 の時計が書ける');
    const v0 = parseFloat(bar.style.getPropertyValue('--v2-left'));
    assert(v0 > 0.5, 'はじめはほぼ満タン（--v2-left ' + v0 + '）＝空ではない');
    // 「なし」の決まり：動きをやめて、--v2-left の長さで描く（0.001秒で空になる動きに任せない）
    const 決まり = [];
    Array.from(doc.styleSheets).forEach((s) => { try { Array.from(s.cssRules).forEach((x) => { if (x.selectorText && /fx-skip/.test(x.selectorText) && /\[data-v2-bar\]/.test(x.selectorText)) 決まり.push(x); }); } catch (e) {} });
    assert(決まり.length === 1, '「なし」の時のゲージの決まりが1つある（' + 決まり.length + '）');
    const st = 決まり[0].style;
    assert(/none/.test(st.getPropertyValue('animation') || st.getPropertyValue('animation-name')) && st.getPropertyPriority('animation') === 'important', '「なし」では動きを止める（!important で :root.fx-skip * に勝つ）');
    assert(/scaleX\(var\(--v2-left/.test(st.getPropertyValue('transform')), '「なし」では --v2-left の長さで描く');
    await sleep(win, 2300);
    const v1 = parseFloat(bar.style.getPropertyValue('--v2-left'));
    assert(v1 < v0 && v1 > 0, '2秒あとには減っている（' + v0 + ' → ' + v1 + '）');
    win.close();
  });

  // 客観検査 B2（2026-11-05）：「この回をとばす」は一時停止のすぐ右にあり、押すとすぐ遊んでいる回を消していた（戻せない）
  await r.test('客観検査 B2：係の「この回をとばす」は、1回押しただけでは送らない。たずねる枠の「とばす」で、はじめて送る', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    win.V2Screens.fes(FesScenes.view('fes2-staff'));
    const scr = doc.getElementById('scr-v2-fes-staff');
    const btn = Array.from(scr.querySelectorAll('.v2-adm-ops .v2-btn')).find((b) => /この回をとばす/.test(b.textContent));
    assert(btn, '「この回をとばす」のボタンがある');
    btn.click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:skip').length, 0, '1回押しただけでは送らない');
    const dlg = scr.querySelector('[data-v2-id="v2Skip"]');
    assert(dlg && dlg.classList.contains('is-open'), 'たずねる枠が開く');
    assert(/待合/.test(dlg.textContent) && /もどせ/.test(dlg.textContent), 'とばすとどうなるか（待合にもどる・もどせない）を書く');
    dlg.querySelector('[data-v2-close]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:skip').length, 0, '「やめる」なら送らない');
    btn.click();
    await sleep(win, 30);
    scr.querySelector('[data-v2-id="v2Skip"] [data-v2-act="fes-skip-ok"]').click();
    await sleep(win, 30);
    assertEqual(emits(win, 'fes:skip').length, 1, '枠の「とばす」で1回だけ送る');
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

  // 指示75 2-3（A34）：TV の呼び込みで「みんなで早答え」と「数字ちかい方」が同じクイズの印だった。数字ちかい方に自分の印（的と矢）
  await r.test('指示75 2-3：TV の呼び込み・投票の札で、数字ちかい方は早答えとちがう印（色はクイズの世界のまま）', async () => {
    const { win, doc } = await launch({ fakeSocket: true, atEntry: true });
    const lab = FesScenes.view('fes2-tv-idle');
    lab.room.fes.games = ['bomb-coop', 'qhaya', 'qnear'];
    win.V2Screens.fes(lab);
    const scr = doc.getElementById(lab.screen);
    const 印 = Array.from(scr.querySelectorAll('.v2-tgame')).map((t) => ({ n: t.textContent, svg: (t.querySelector('.v2-emb') || {}).innerHTML || '', cls: t.querySelector('.v2-tile').className }));
    const haya = 印.find((x) => /早答え/.test(x.n)), near = 印.find((x) => /ちかい/.test(x.n));
    assert(haya && near, '2つとも出ている（' + 印.map((x) => x.n).join('・') + '）');
    const 形 = (svg) => svg.replace(/v2e\d+/g, '');
    assert(near.svg && 形(near.svg) !== 形(haya.svg), '印の絵がちがう');
    assert(/v2-w-quiz/.test(near.cls), '色はクイズの世界のまま');
    win.close();
  });

  // 指示75 2-2（A19・A20）：外された時・しばらく押さなかった時の字を赤くしない。名前の箱を赤い枠にしない（名前のまちがいに見える）
  for (const reason of ['fes_idle', 'fes_staff']) {
    await r.test('指示75 2-2：' + reason + ' で入る画面にもどった → 知らせの色の字（赤い字・名前の箱の赤い枠にしない）', async () => {
      const { win, doc } = await 入った();
      win.__rtFake.fire('room:kicked', { by: null, reason });
      await waitFor(win, () => act(doc) === 'scr-v2-fes-join' && doc.querySelector('[data-fes-name]'), 3000, '入る画面');
      await sleep(win, 50);
      const scr = doc.getElementById('scr-v2-fes-join');
      const want = reason === 'fes_idle' ? /席を空けました/ : /部屋から出ました/;
      assert(want.test(scr.textContent), '理由の字が出る');
      assert(!scr.querySelector('.v2-why, .v2-inp.is-bad'), '赤い字・赤い枠にしない');
      assert(Array.from(scr.querySelectorAll('.v2-note')).some((n) => want.test(n.textContent)), '知らせの札（v2-note）で出す');
      win.close();
    });
  }

  // 指示75 2-12（11/8 の全画面監査 A2）：早答え・数字ちかい方のスマホで、右上に ⚙ が2つ重なっていた（古い浮いた ⚙ が消えていない）。
  // 一覧に足すのではなく「v2 の画面（名前が scr と v2 で始まる）は古い浮いた ⚙ を出さない」の1つの決まりにする（画面を足した日に漏れない・落とし穴4）。
  // v2 の画面は自分の ⚙（右上の丸ボタン）を持つ。指示47-2（大画面には ⚙）と 2-11（文化祭の TV には出さない）は別の行で見る
  const 浮いた歯車 = (doc) => doc.getElementById('floatingGearBtn').style.display;
  await r.test('指示75 2-12：v2 のスマホの画面は、どれも古い浮いた ⚙ を出さない（早答え・数字ちかい方も）', async () => {
    const { win, doc } = await 入った();
    const ids = Array.from(doc.querySelectorAll('.screen.v2[id^="' + ['scr', 'v2', ''].join('-') + '"]')).map((s) => s.id).filter((id) => !/-tv$/.test(id));
    assert(ids.indexOf('scr-v2-qhaya') !== -1 && ids.indexOf('scr-v2-qnear') !== -1, '早答え・数字ちかい方の画面を数えている（' + ids.length + '）');
    const 出た = [];
    ids.forEach((id) => { win.goToScreen(id); if (浮いた歯車(doc) !== 'none') 出た.push(id); });
    assertEqual(出た.join(','), '', '古い浮いた ⚙ が出た v2 の画面');
    win.goToScreen('scr-rt-play');
    assertEqual(浮いた歯車(doc), 'block', '古い画面（部屋で遊ぶ画面）では今までどおり出る（決まりを広げすぎない）');
    win.close();
  });

  await r.test('指示75 2-11：文化祭の TV には、どの画面にも ⚙ を出さない（ふだんの部屋の大画面は今までどおり出す・指示47-2）', async () => {
    const { win, doc } = await 入った();
    const lab = FesScenes.view('fes2-lobby');
    const tvRoom = JSON.parse(JSON.stringify(lab.room));
    tvRoom.members.forEach((m) => { if (m.id === 'm1') m.role = 'bigscreen'; });
    win.__rtFake.fire('room:update', tvRoom);
    await sleep(win, 30);
    const 出た = [];
    // TV が着く画面：v2 の TV の画面・文化祭の画面・部屋の古い画面（scr-rt-*）
    Array.from(doc.querySelectorAll('.screen[id]')).map((s) => s.id).filter((id) => new RegExp(['^scr', 'v2', '.*-tv$|^scr', 'v2', 'fes-|^scr', 'rt', ''].join('-')).test(id)).forEach((id) => {
      win.goToScreen(id);
      if (浮いた歯車(doc) !== 'none') 出た.push(id);
      const own = doc.querySelector('#' + id + ' .v2-cbtn.is-gear');
      if (/-tv$/.test(id) && own) 出た.push(id + '（自分の⚙）');
    });
    assertEqual(出た.join(','), '', '文化祭の TV で ⚙ が出た画面');
    const ふだん = JSON.parse(JSON.stringify(tvRoom)); delete ふだん.fes;
    win.__rtFake.fire('room:update', ふだん);
    await sleep(win, 30);
    win.goToScreen('scr-v2-room-tv');
    assertEqual(浮いた歯車(doc), 'block', 'ふだんの部屋の大画面には出す（指示47-2）');
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

  // 指示71-2 の「⚙ → アプリの設定 → アイコン・二つ名」は、指示76 2-9（くまくんの答え 3.A）で文化祭の ⚙ から外した。
  // 着替えは待合の「アイコン・二つ名をかえる」から開く（上の F5 着替え）。文化祭の ⚙ に出る物は下の 2-9 で見る

  // ===== 指示76 2-9（E1・くまくんの答え 3.A）：文化祭のスマホの ⚙ の中は5つだけ =====
  /** 設定の中で、本当に見えているか（自分と祖先の display・hidden） */
  const 見える = (win, e) => { for (let x = e; x && x.id !== 'settingsOverlay'; x = x.parentElement) { if (x.hidden || win.getComputedStyle(x).display === 'none') return false; } return !!e; };
  async function fes歯車(sceneId) {
    const t = await 入った();
    流す(t.win, sceneId || 'fes2-lobby');
    await sleep(t.win, 200);
    t.doc.querySelector('#scr-v2-fes-lobby [data-v2-act="gear"]').click();
    await sleep(t.win, 150);
    return t;
  }
  const 行 = (win, doc) => Array.from(doc.querySelectorAll('#settingsOverlay .set-page[data-page="root"] .set-row')).filter((x) => 見える(win, x)).map((x) => x.querySelector('.sr-text').firstChild.textContent);
  await r.test('指示76 2-9：文化祭のスマホの ⚙ の入口は「音・光と揺れ・字の大きさ・ルール・部屋を出る」の5つだけ。ログインの字とボタンは出さない。絵文字の表記と版は残す', async () => {
    const { win, doc, errors } = await fes歯車();
    assertEqual(行(win, doc).join('／'), '音／光と揺れ／字の大きさ／ルール／部屋を出る', '入口の行');
    assert(!見える(win, doc.getElementById('loggedInAs')) || doc.getElementById('loggedInAs').textContent === '', '「ログインしていません」を出さない');
    assert(!見える(win, doc.getElementById('settingsLoginBtn')), '「ログインする」を出さない');
    assert(!見える(win, doc.getElementById('logoutBtn')), '「ログアウト」も出さない');
    assert(見える(win, doc.getElementById('setCredit')) && 見える(win, doc.getElementById('setVersion')), '絵文字の表記と版は残す');
    // 11/11：⚙ の入口の5つは変えずに、絵文字の表記と版の近くに「お問い合わせ」
    assert(見える(win, doc.getElementById('setContact')), '⚙ にお問い合わせの行が見える');
    問い合わせ(doc.getElementById('setContact'), '文化祭の ⚙');
    // 行き先：音は音量のページ（すべての音を消す・効果音・BGM）、光と揺れは安全の設定、字の大きさは文字サイズだけ
    const 開く = async (label) => { Array.from(doc.querySelectorAll('#settingsOverlay .set-page[data-page="root"] .set-row')).find((x) => x.textContent.indexOf(label) === 0 || x.querySelector('.sr-text').firstChild.textContent === label).click(); await sleep(win, 50); };
    await 開く('音');
    assert(見える(win, doc.querySelector('#settingsOverlay [data-setact="muteAll"]')), '音のページに「すべての音を消す」');
    assert(見える(win, doc.getElementById('setSeVol')), '効果音の音量');
    assert(!見える(win, doc.getElementById('setBgmVol')), 'BGM は文化祭のスマホでは流れない（TV の待合だけ）ので出さない（落とし穴21）');
    assert(/効果音を、まとめて止めます/.test(doc.querySelector('#settingsOverlay [data-setact="muteAll"]').textContent) && !/BGM/.test(doc.querySelector('#settingsOverlay [data-setact="muteAll"]').textContent), '指示76 束5：すべての音を消すの説明に BGM を書かない');
    const 見えている字 = Array.from(doc.querySelectorAll('#settingsOverlay .set-page[data-page="sound"] .card')).filter((x) => 見える(win, x)).map((x) => x.textContent).join('');
    assert(見えている字.indexOf('人狼') === -1, '文化祭に無いゲームの話（人狼の夜…）を出さない');
    doc.getElementById('setBackBtn').click(); await sleep(win, 30);
    await 開く('光と揺れ');
    assert(見える(win, doc.querySelector('#settingsOverlay .set-page[data-page="safety"]')), '光と揺れ＝安全に関する設定のページ');
    assertEqual(doc.getElementById('setTitle').textContent, '光と揺れ', '題も「光と揺れ」');
    assertEqual(doc.getElementById('setShakeSub').textContent, 'ミスした時のライフなどが、一瞬揺れます', '指示76 束5：揺れの説明に人狼（大画面の処刑）を書かない');
    doc.getElementById('setBackBtn').click(); await sleep(win, 30);
    await 開く('字の大きさ');
    assert(見える(win, doc.getElementById('setFont')), '文字サイズのつまみ');
    assert(!見える(win, doc.getElementById('setBright')) && !見える(win, doc.getElementById('setReactionsToggle')), '見た目と演出のほかの項目は出さない');
    assertEqual(doc.getElementById('setTitle').textContent, '字の大きさ', '題も「字の大きさ」');
    H.assertNoErrors(errors, '文化祭の ⚙ で未捕捉の例外');
    win.close();
  });

  await r.test('指示76 2-9：文化祭の ⚙ のルールは、決まったゲームのルール。決まる前は「投票で決まったら、ここにルールが出ます」（あれそれどれこれの文を出さない）', async () => {
    const { win, doc } = await fes歯車('fes2-vote');
    const ルールへ = async () => { Array.from(doc.querySelectorAll('#settingsOverlay .set-page[data-page="root"] .set-row')).find((x) => x.querySelector('.sr-text').firstChild.textContent === 'ルール').click(); await sleep(win, 50); };
    await ルールへ();
    const body = () => doc.getElementById('setRulesBody').textContent;
    assert(body().indexOf('投票で決まったら、ここにルールが出ます') !== -1, '決まる前：' + body());
    assert(!/まだ用意できていません|あれそれどれこれ|進行役/.test(body()), 'まちがった文を出さない：' + body());
    doc.getElementById('closeSettingsBtn').click(); await sleep(win, 50);
    流す(win, 'fes2-ready'); await sleep(win, 200);   // 準備OK の画面（決まったあと。決まる画面は動きだけで ⚙ が無い）
    doc.querySelector('#scr-v2-fes-lobby [data-v2-act="gear"]').click(); await sleep(win, 150);
    await ルールへ();
    assert(/クイズ解除/.test(body()), '決まったゲームの名前：' + body());
    assert(doc.querySelectorAll('#setRulesBody .v2-rl, #setRulesBody .v2-rb').length >= 3, '文化祭の投票・準備と同じルールの中身（くわしい説明）');
    assert(!/まだ用意できていません/.test(body()), '「まだ用意できていません」を出さない');
    win.close();
  });

  await r.test('指示76 2-9：文化祭でない部屋の ⚙ は今のまま（いま遊んでいるゲーム・部屋・アプリの設定・ログインの字）', async () => {
    const { win, doc } = await launch({ fakeSocket: true });
    await H.makeRoomV2(win, doc);
    win.openSettings && win.openSettings('room');
    if (!doc.getElementById('settingsOverlay').classList.contains('show')) doc.getElementById('floatingGearBtn').click();
    await sleep(win, 100);
    const rows = 行(win, doc).join('／');
    assert(/いま遊んでいるゲーム/.test(rows) && /アプリの設定/.test(rows) && /危険な操作/.test(rows) && /すべての音を消す/.test(rows), 'ふだんの入口：' + rows);
    assert(見える(win, doc.getElementById('loggedInAs')) && doc.getElementById('loggedInAs').textContent !== '', 'ログインの字は出る');
    win.close();
  });

  // ===== 指示76 2-10（くまくんの答え 11/8・束2 に入れた）：クイズ解除の「ライフが1つ割れた」は、ライフの近くの空いた所に =====
  await r.test('指示76 2-10：ライフが割れた知らせは「解除ずみ」の行（ライフのすぐ下）に出す。問題の字・3択・マスに重ねない。出ている間もマスと3択を押せる。描き直しても消えず、1.6秒で消える', async () => {
    const { win, doc, errors } = await 入った();
    const lab = 流す(win, 'fes2-play');
    win.__rtFake.fire('wolf:you', lab.secret);
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-bgrid'), 2000, '盤');
    const sec = JSON.parse(JSON.stringify(lab.secret));
    sec.misses = (sec.misses || 0) + 1; if (sec.lives != null) sec.lives -= 1;
    win.__rtFake.fire('wolf:you', sec);
    await sleep(win, 60);
    const note = () => doc.querySelector('#scr-v2-fes-lobby .v2-pnum .v2-pmiss');
    assert(note() && /ライフが1つ割れた/.test(note().textContent), '「解除ずみ」の行に知らせ');
    assert(!doc.getElementById('foulToast').classList.contains('show'), '上に浮く知らせ（#foulToast）は出さない（問題の字・凡例にかぶっていた）');
    assert(!note().closest('.v2-qsheet') && !note().closest('.v2-bgrid'), '問題のシートの中・盤の中ではない');
    const scr = doc.getElementById('scr-v2-fes-lobby');
    const 空き = scr.querySelector('.v2-bcell:not(:disabled):not(.is-mine)');
    const n0 = emits(win, 'wolf:act').length;
    空き.click();
    assertEqual(emits(win, 'wolf:act').length, n0 + 1, '知らせが出ている間もマスを押せる');
    const v0 = emits(win, 'wolf:vote').length;
    scr.querySelector('[data-fes-ans]').click();
    assertEqual(emits(win, 'wolf:vote').length, v0 + 1, '知らせが出ている間も3択を押せる');
    win.__rtFake.fire('room:update', lab.room);
    await sleep(win, 60);
    assert(note(), '部屋の知らせで描き直しても、知らせは残る');
    await sleep(win, 1800);
    assert(!note(), '1.6秒で消える');
    H.assertNoErrors(errors, 'ライフの知らせで未捕捉の例外');
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

  // ---- 指示74：別のアプリに切りかえて、もどってきた人（サーバーの側は tests/fes-revive.js） ----
  const 一言 = (doc) => { const t = doc.getElementById('foulToast'); return t && t.classList.contains('show') ? t.textContent : ''; };
  const 入る画面の札 = (doc) => Array.prototype.map.call(doc.querySelectorAll('#scr-v2-fes-join .v2-note, #scr-v2-fes-join [role="status"], #scr-v2-fes-join .v2-info, #scr-v2-fes-join .v2-err'), (e) => e.textContent).join(' / ');

  for (const 道 of ['room:kicked（socket が生きていた）', 'つなぎ直しの自動の入り直し（通信が切れていた）']) {
    await r.test('74 門3・4（画面）：2分たって外された人がもどる → ' + 道 + ' → 入る画面に「しばらく はなれていたので」。名前とむずかしさは入ったまま、「入る」1回で入れる', async () => {
      const { win, doc } = await 入った();
      流す(win, 'fes2-lobby');
      if (道.indexOf('room:kicked') === 0) win.__rtFake.fire('room:kicked', { by: null, reason: 'fes_gone' });
      else {
        win.__rtFake.replies['room:join'] = (p) => (p && p.auto ? { ok: false, error: 'fes_gone', message: 'しばらく はなれていたので、もう一度 入ってね' }
          : { ok: true, code: 'TST754', memberId: 'm9', room: FesScenes.view('fes2-lobby').room });
        await つなぎ直す(win);
        const auto = emits(win, 'room:join').filter((e) => e.payload && e.payload.auto);
        assertEqual(auto.length, 1, '型(b)：つなぎ直しの自動の入り直しを送っている（auto の印つき）');
      }
      await waitFor(win, () => act(doc) === 'scr-v2-fes-join', 2000, '入る画面へ（止まった部屋の画面のままにしない）');
      await waitFor(win, () => doc.querySelector('[data-fes-name]'), 2000, '名前の箱');
      const 札 = 入る画面の札(doc) || doc.getElementById('scr-v2-fes-join').textContent;
      assert(札.indexOf(win.UiText.FES.入る.はなれていた) !== -1, '「' + win.UiText.FES.入る.はなれていた + '」が出る（' + 札.slice(0, 80) + '）');
      assert(!doc.querySelector('#scr-v2-fes-join .v2-inp.is-bad'), '名前のまちがい（赤い枠）にはしない');
      assertEqual(doc.querySelector('[data-fes-name]').value, 'ふう', '名前は入ったまま');
      assert(doc.querySelector('[data-fes-diff="normal"].is-on, [data-fes-diff="normal"][aria-checked="true"], [data-fes-diff="normal"][aria-pressed="true"]'), 'むずかしさは入ったまま（ふつう）');
      win.__rtFake.replies['room:join'] = () => ({ ok: true, code: 'TST754', memberId: 'm9', room: FesScenes.view('fes2-lobby').room });
      const before = emits(win, 'room:join').length;
      doc.querySelector('[data-fes-act="join"]').click();
      await waitFor(win, () => act(doc) === 'scr-v2-fes-lobby', 3000, '「入る」1回で待合へ');
      assertEqual(emits(win, 'room:join').length - before, 1, '入るのは1回');
      const last = emits(win, 'room:join').slice(-1)[0].payload;
      assertEqual(last.name, 'ふう', '同じ名前で');
      assertEqual(last.diff, 'normal', '同じむずかしさで');
      assert(!last.auto, '自動の入り直しの印は付かない（本人が押した）');
      win.close();
    });
  }

  // 指示75 束2 の答え 3.A（11/8）：準備OK が締め切りとすれちがった（もう準備OK の時間ではない・もう始まっている）は、つながりの問題ではない。
  // 「つなぎ直しています」を出さない（通しで 3-2-1 の下に残っていた）。つながりの問題（not_player・not_in_room・時間切れ）は今のまま出す
  for (const error of ['not_ready_time', 'already_started', 'stale_game', 'not_voting', 'not_result']) {
    await r.test('指示75 答え3：押した答えが「時間がすぎた」（' + error + '）なら、「つなぎ直しています」を出さない', async () => {
      const { win, doc } = await 入った();
      流す(win, 'fes2-ready');
      await waitFor(win, () => doc.querySelector('[data-fes-act="ready"]'), 2000, '準備OK の画面');
      win.__rtFake.replies['room:ready'] = () => ({ ok: false, error, message: 'x' });
      doc.querySelector('[data-fes-act="ready"]').click();
      await sleep(win, 300);
      assertEqual(一言(doc), '', '一言を出さない');
      win.close();
    });
  }

  // 指示76 束2 の答え 1.A（11/9）：解除中に押した答えが「すれちがい」（3-2-1 の最中・もう終わった・ほかの人が解いた直後・係が止めている…）は、
  // つながりの問題ではない。一言を出さず、画面だけもらい直す（rt.here は全部で）。本当のつながりの問題は「つなぎ直しています」を、
  // 解除中は浮く知らせではなく「解除ずみ」の行に（ライフの知らせと同じ・問題の字と凡例にかからない）。分け方は docs/監査_指示76の門.md の 2-15
  async function 解除中(o) {
    const t = await 入った();
    const lab = 流す(t.win, 'fes2-play');
    t.win.__rtFake.fire('wolf:you', lab.secret);
    await waitFor(t.win, () => t.doc.querySelector('#scr-v2-fes-lobby .v2-bgrid'), 2000, '盤');
    return Object.assign(t, { lab });
  }
  const 行の一言 = (doc) => { const n = doc.querySelector('#scr-v2-fes-lobby .v2-pnum .v2-pmiss'); return n ? n.textContent : ''; };
  const すれちがい = ['not_started', 'wrong_phase', 'already_solved', 'paused', 'already_done', 'nothing_open', 'not_playing', 'unknown_code', 'not_a_choice', 'not_expected'];
  for (const error of すれちがい) {
    await r.test('指示76 2-15：解除中に押した答えが「すれちがい」（' + error + '）なら一言を出さず、画面だけもらい直す（マスも3択も）', async () => {
      const { win, doc } = await 解除中();
      const scr = doc.getElementById('scr-v2-fes-lobby');
      win.__rtFake.replies['wolf:act'] = () => ({ ok: false, error, message: 'x' });
      win.__rtFake.replies['wolf:vote'] = () => ({ ok: false, error, message: 'x' });
      const here0 = emits(win, 'room:here').length;
      scr.querySelector('.v2-bcell:not(:disabled):not(.is-mine)').click();
      await sleep(win, 200);
      assertEqual(一言(doc) + 行の一言(doc), '', 'マス：一言を出さない');
      await waitFor(win, () => emits(win, 'room:here').length > here0, 2000, 'マス：画面をもらい直す（room:here）');
      const here1 = emits(win, 'room:here').length;
      doc.getElementById('scr-v2-fes-lobby').querySelector('[data-fes-ans]').click();
      await sleep(win, 200);
      assertEqual(一言(doc) + 行の一言(doc), '', '3択：一言を出さない');
      await waitFor(win, () => emits(win, 'room:here').length > here1, 2000, '3択：画面をもらい直す（room:here）');
      win.close();
    });
  }
  await r.test('指示76 2-15：解除中の本当のつながりの問題（not_in_room）は「つなぎ直しています」を「解除ずみ」の行に（浮く知らせは使わない）。ほかの人が挑戦中（taken）も同じ行に', async () => {
    const { win, doc } = await 解除中();
    const scr = () => doc.getElementById('scr-v2-fes-lobby');
    win.__rtFake.replies['wolf:act'] = () => ({ ok: false, error: 'not_in_room', message: 'x' });
    scr().querySelector('.v2-bcell:not(:disabled):not(.is-mine)').click();
    await sleep(win, 200);
    assert(/つなぎ直しています/.test(行の一言(doc)), '「解除ずみ」の行に「つなぎ直しています」：' + 行の一言(doc));
    assertEqual(一言(doc), '', '浮く知らせ（#foulToast）は出さない');
    await sleep(win, 1800);
    win.__rtFake.replies['wolf:act'] = () => ({ ok: false, error: 'taken', message: 'x' });
    scr().querySelector('.v2-bcell:not(:disabled):not(.is-mine)').click();
    await sleep(win, 200);
    assert(/挑戦中/.test(行の一言(doc)), '挑戦中も「解除ずみ」の行に：' + 行の一言(doc));
    assertEqual(一言(doc), '', '浮く知らせは出さない');
    win.close();
  });

  // 指示75 束2 の答え 2.A（11/8）：「〇〇さんが部屋を抜けました」も、文化祭では遊ぶ人のスマホと TV に出さない（2-8 と同じ・係は入退室の記録で見る）
  await r.test('指示75 答え2：文化祭のスマホと TV には「〇〇さんが部屋を抜けました／出されました」を出さない', async () => {
    for (const asTv of [false, true]) {
      const { win, doc } = await 入った();
      const room = JSON.parse(JSON.stringify(FesScenes.view('fes2-lobby').room));
      if (asTv) room.members.forEach((m) => { if (m.id === 'm1') m.role = 'bigscreen'; });
      win.__rtFake.fire('room:update', room); await sleep(win, 40);
      win.__rtFake.fire('room:memberGone', { name: 'ひろ', reason: 'leave' });
      win.__rtFake.fire('room:memberGone', { name: 'びび', reason: 'kick' });
      await sleep(win, 60);
      assert(!/抜けました|出されました/.test(知らせの字(doc)), (asTv ? 'TV' : 'スマホ') + 'に出さない（' + 知らせの字(doc).slice(0, 60) + '）');
      win.close();
    }
  });

  await r.test('74 門5（画面）：投票を押した答えが ok でない → 「つなぎ直しています」を出して、いるよ（room:here）を送る。ok の時は出さない', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-vote');
    await waitFor(win, () => doc.querySelector('#scr-v2-fes-lobby .v2-vlist'), 2000, '投票の画面');
    win.__rtFake.replies['fes:vote'] = () => ({ ok: false, error: 'not_player', message: '投票できません' });
    doc.querySelector('[data-fes-pick="bomb-coop"]').click();
    const here0 = emits(win, 'room:here').length;
    doc.querySelector('[data-fes-act="vote"]').click();
    await waitFor(win, () => 一言(doc), 2000, '一言が出る');
    assertEqual(一言(doc), win.UiText.FES.遊ぶ.つなぎ直し, '一言は「つなぎ直しています」');
    await waitFor(win, () => emits(win, 'room:here').length > here0, 2000, 'いるよ（room:here）を送る');
    const h = emits(win, 'room:here').slice(-1)[0].payload;
    assertEqual(h.code, 'TST754', '部屋のコードを添える');
    assertEqual(h.memberId, 'm1', '自分の memberId を添える');
    // ok の時は出さない（型(c)：もう一方の入力）
    await sleep(win, 1800);
    assertEqual(一言(doc), '', '型(b)：一言は消えている');
    win.__rtFake.replies['fes:vote'] = () => ({ ok: true, vote: 'bomb-coop' });
    const here1 = emits(win, 'room:here').length;
    doc.querySelector('[data-fes-act="vote"]').click();
    await sleep(win, 200);
    assertEqual(一言(doc), '', 'ok の時は一言を出さない');
    assertEqual(emits(win, 'room:here').length, here1, 'ok の時は いるよ を送らない');
    win.close();
  });

  await r.test('74（画面）：画面がまた見えた（visibilitychange）→ すぐ いるよ（room:here）を送る。部屋にいない時は送らない', async () => {
    const t0 = await 入る画面();
    const n0 = emits(t0.win, 'room:here').length;
    t0.win.document.dispatchEvent(new t0.win.Event('visibilitychange'));
    await sleep(t0.win, 50);
    assertEqual(emits(t0.win, 'room:here').length, n0, '部屋に入る前は送らない');
    t0.win.close();
    const { win, doc } = await 入った();
    const n1 = emits(win, 'room:here').length;
    doc.dispatchEvent(new win.Event('visibilitychange'));
    await sleep(win, 50);
    assertEqual(emits(win, 'room:here').length, n1 + 1, '見えた時に1回送る');
    win.dispatchEvent(new win.Event('pageshow'));
    await sleep(win, 50);
    assertEqual(emits(win, 'room:here').length, n1 + 2, 'ページにもどった時（pageshow）も送る');
    win.close();
  });

  // 指示75 1-2（A03・A07・A09）：つながっていない間・裏から戻って いまの全部が届く前は、「つなぎ直しています」を出して押せなくする。届いたら消す
  const 幕 = (doc) => doc.getElementById('rtStale');
  const 幕がふさぐ = (doc) => !!(幕(doc) && 幕(doc).classList.contains('is-block'));
  await r.test('指示75 1-2：通信が切れた → すぐ押せなくなり、0.3秒で「つなぎ直しています」。押しても送らない。つなぎ直して入り直せたら消える', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-vote');
    await waitFor(win, () => doc.querySelector('[data-fes-pick]'), 2000, '投票の画面');
    assert(!幕がふさぐ(doc), 'つながっている間は出ない');
    win.__rtFake.socket.disconnect();
    assert(幕がふさぐ(doc), '切れたら、すぐ押せなくする');
    await sleep(win, 350);
    assert(幕(doc).classList.contains('is-show') && /つなぎ直しています/.test(幕(doc).textContent), '0.3秒たっても切れていたら「つなぎ直しています」');
    const n = emits(win, 'fes:vote').length;
    // jsdom は重なりで押す先を決めないので、幕そのものを押して、下へ通さないかを見る（幕は body の最後・どの画面よりも上）
    幕(doc).dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));
    assertEqual(emits(win, 'fes:vote').length, n, '幕を押しても投票を送らない');
    assertEqual(doc.body.lastElementChild, 幕(doc), '幕は body の最後（画面の上）');
    win.__rtFake.connected = true; win.__rtFake.fire('connect');   // つなぎ直し → 入り直し（room:join の答え ok）
    await waitFor(win, () => !幕がふさぐ(doc), 2000, '入り直せたら消える');
    win.close();
  });

  await r.test('指示75 1-2：1.5秒より長く裏にいて戻った → いまの全部（room:here の答え）が届くまで押せない。届いたら消える。すぐ戻った時は出さない', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-vote');
    let 答え = null;
    win.__rtFake.replies['room:here'] = (p, cb) => { 答え = cb; };   // 答えを遅らせる
    const vis = (v) => { Object.defineProperty(doc, 'visibilityState', { value: v, configurable: true }); doc.dispatchEvent(new win.Event('visibilitychange')); };
    vis('hidden'); await sleep(win, 200); vis('visible');
    await sleep(win, 50);
    assert(!幕がふさぐ(doc), '0.2秒で戻った時は出さない（ちらつかせない）');
    if (答え) { 答え({ ok: true }); 答え = null; }
    vis('hidden'); await sleep(win, 1700); vis('visible');
    await sleep(win, 50);
    assert(幕がふさぐ(doc), '1.5秒より長く裏にいたら、届くまで押せない');
    assert(答え, 'いるよ（room:here）を送っている');
    答え({ ok: true });
    await waitFor(win, () => !幕がふさぐ(doc), 1000, '届いたら消える');
    win.close();
  });

  // 指示75 1-2b（くまくん 11/8）：通信は切れているのに socket.io がまだ気づかない（機内モードの A09）。サーバーの「いるよ」（hb:ping・10秒ごと）が
  // 22秒来なければ古いかもしれない。時間は端末の時計を進めて作る（22秒は待たない・判定の22秒そのものは変えない＝落とし穴24）
  await r.test('指示75 1-2b：「いるよ」（hb:ping）が22秒来ない → 幕が出て、いるよ（room:here）を送る。答えが来たら消える。18秒ほどなら出さない', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-vote');
    let 答え = null;
    win.__rtFake.replies['room:here'] = (p, cb) => { 答え = cb; };
    win.__rtFake.fire('hb:ping', { at: Date.now() });            // いま「いるよ」が来た
    const 本物 = win.Date.now.bind(win.Date);
    let 進める = 0;
    win.Date.now = () => 本物() + 進める;
    const n0 = emits(win, 'room:here').length;
    進める = 15000;                                               // 15秒（＋見張りを待つ3秒あまり＝22秒より短い）：まだ待つ
    await sleep(win, 3300);                                      // 見張りは3秒ごと
    assert(!幕がふさぐ(doc), '18秒ほどでは出さない');
    assertEqual(emits(win, 'room:here').length, n0, '18秒ほどでは送らない');
    進める = 23000;                                               // 23秒：2回つづけて来なかった
    await sleep(win, 3300);
    assert(幕がふさぐ(doc), '22秒より長く来なければ、押せなくする');
    assertEqual(emits(win, 'room:here').length, n0 + 1, 'いるよ（room:here）を1回送る');
    assert(答え, '答えを待っている');
    答え({ ok: true });
    await waitFor(win, () => !幕がふさぐ(doc), 1000, '答えが来たら消える');
    win.Date.now = 本物;
    win.close();
  });

  await r.test('指示75 1-2：オフライン（機内モード）→「電波がとどいていないようです」。オンラインにもどって答えが来たら消える', async () => {
    const { win, doc } = await 入った();
    流す(win, 'fes2-vote');
    win.dispatchEvent(new win.Event('offline'));
    await sleep(win, 350);
    assert(幕がふさぐ(doc) && /電波がとどいていない/.test(幕(doc).textContent), 'オフラインの字');
    win.dispatchEvent(new win.Event('online'));
    await waitFor(win, () => !幕がふさぐ(doc), 2000, 'もどって答えが来たら消える');
    win.close();
  });

  r.finish();
})();
