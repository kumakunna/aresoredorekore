// tests/version.js — アプリの版（指示68-1）
//
// 版は public/js/version.js の1か所だけ。サーバーと画面がそこから読み、⚙設定のいちばん下と係の画面に出る（TV には出さない）。
// 感想の記録に版が残る。版が変わったら、古い画面の端末は待合にいる時だけ読み込み直す（遊んでいる途中は読み込まない）
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { createRunner, assert, assertEqual, launch, sleep, click, activeScreen } = require('./harness');
const H = require('./harness');
const AppVersion = require('../public/js/version.js');
const { createFesStore } = require('../fes-store');
const FesScenes = require('../tools/v2-lab/fes-scenes');
const HomeScenes = require('../tools/v2-lab/home-scenes');

const ROOT = path.join(__dirname, '..');

(async function main() {
  const r = createRunner('version：アプリの版（指示68-1）');

  await r.test('門1：版は public/js/version.js の1か所だけ（ほかのファイルに版の数字を書かない）', async () => {
    assert(/^\d+\.\d\d$/.test(AppVersion.VERSION), '版は「2.00」の形：' + AppVersion.VERSION);
    assertEqual(AppVersion.name, 'あつまれ、あれこれ v' + AppVersion.VERSION, '出す文');
    const lit = new RegExp('v?' + AppVersion.VERSION.replace('.', '\\.') + '(?!\\d)');
    ['server.js', 'realtime.js', 'fes-store.js', 'public/index.html', 'public/js/v2-fes.js'].forEach((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert(!new RegExp("['\"]v?" + AppVersion.VERSION.replace('.', '\\.') + "['\"]").test(src), f + ' に版の数字をじかに書かない');
    });
    assert(lit.test(fs.readFileSync(path.join(ROOT, 'public/js/version.js'), 'utf8')), 'version.js に版がある');
    assert(/require\('\.\/public\/js\/version\.js'\)/.test(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')), 'サーバーが version.js から読む');
    assert(/<script src="js\/version\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8')), '画面が version.js を読む');
  });

  await r.test('門1：⚙設定のいちばん下と、係の画面に版が出る', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    click(t.doc, t.doc.querySelector('#scr-v2-home [data-v2-act="gear"]'));
    await sleep(t.win, 60);
    assertEqual(t.doc.getElementById('setVersion').textContent, AppVersion.name, '設定のいちばん下');
    assert(t.doc.getElementById('setVersion').style.display !== 'none', '見えている');
    t.win.V2Screens.fes(FesScenes.view('fes2-staff'));
    const ver = t.doc.querySelector('#scr-v2-fes-staff [data-fes-ver]');
    assert(ver && ver.textContent === AppVersion.name, '係の画面');
    t.win.close();
  });

  await r.test('門1：感想の記録に、その時の版が残る（前からある表にも列を足す）', async () => {
    const db = new Database(':memory:');
    // 版の列が無かった頃の表（もう本番にある表）にも、足せること
    db.exec('CREATE TABLE fes_feedback (key TEXT PRIMARY KEY, room TEXT NOT NULL, round INTEGER NOT NULL, mode TEXT NOT NULL, member TEXT NOT NULL, name TEXT NOT NULL, stars INTEGER, text TEXT, at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    const store = createFesStore(db);
    store.saveFeedback({ room: 'ABC234', round: 1, mode: 'bomb-coop', member: 'm1', name: 'ふう', stars: 4, ver: AppVersion.VERSION });
    store.saveFeedback({ room: 'ABC234', round: 1, mode: 'bomb-coop', member: 'm1', name: 'ふう', text: 'たのしい', ver: AppVersion.VERSION });
    const row = store.listFeedback()[0];
    assertEqual(row.ver, AppVersion.VERSION, '感想の行に版');
    assertEqual(row.text, 'たのしい', 'ひとことも残る');
    assert(/ver: APP_VERSION\.VERSION/.test(fs.readFileSync(path.join(ROOT, 'realtime.js'), 'utf8')), '部屋の感想を受け取る所が版を渡す');
  });

  await r.test('門2：版が変わったら、待合にいる時だけ読み込み直す（遊んでいる途中は読み込まず、待合にもどった時に）', async () => {
    const t = await launch({ fakeSocket: true, atEntry: true });
    let 読み込み直し = 0;
    t.win.__appReload = () => { 読み込み直し++; };
    t.win.V2Screens.home(HomeScenes.view('home-e3'));
    await sleep(t.win, 40);
    assertEqual(activeScreen(t.doc), 'scr-v2-room', '待合');
    t.win.__rtFake.fire('app:version', { v: AppVersion.VERSION });
    await sleep(t.win, 20);
    assertEqual(読み込み直し, 0, '同じ版なら読み込み直さない');
    // 遊んでいる途中（つぎは？ などの待合でない画面）に新しい版が届く
    t.win.goToScreen('scr-next');
    await sleep(t.win, 20);
    t.win.__rtFake.fire('app:version', { v: '9.99' });
    await sleep(t.win, 20);
    assertEqual(読み込み直し, 0, '待合でない時は読み込み直さない');
    // 待合にもどった時に読み込み直す
    t.win.V2Screens.home(HomeScenes.view('home-e3'));
    await sleep(t.win, 40);
    assertEqual(読み込み直し, 1, '待合にもどった時に1回だけ読み込み直す');
    // 読み込み直しても古いまま（届くファイルがまだ古い）の時に、くり返さない
    t.win.__rtFake.fire('app:version', { v: '9.99' });
    await sleep(t.win, 20);
    assertEqual(読み込み直し, 1, '同じ新しい版で、くり返し読み込み直さない');
    t.win.close();
  });

  r.finish();
})();
