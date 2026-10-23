// tests/fes-screens.js — 文化祭の部屋の画面（指示66-2）を jsdom で押して確かめる
//
// サーバーの側（投票が変わらない・票の数を配らない・感想の上書き…）は tests/fes.js が本物のサーバーで見る。
// ここは**画面の側**：押した時に何を送るか・届いたものをどう描くか。
// 部屋の知らせは、本物の進行役を動かして作った見本データ（tools/v2-lab/fes-scenes.js）をそのまま流す（落とし穴25）
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

  r.finish();
})();
