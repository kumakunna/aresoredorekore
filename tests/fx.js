// tests/fx.js — 演出の共通部品（第32弾-C）
//
// 見るのは4つ：
//   ・原則B：スキップできない演出が1つも無い（hold は必ず途中で終われる）
//   ・原則B：「演出の速さ」設定が、1か所（ms）で全部に効く
//   ・原則C：責める側から画面いっぱいの演出を出せない（banner に bad が無い）
//   ・原則E：切断の通知は、音も振動も鳴らさない
//
// 演出そのものの見た目はテストで見られないので、
// 「壊れ方をしない」ことと「決めごとを破れない」ことを見ている。

const { JSDOM } = require('jsdom');
const { createRunner, assert, assertEqual } = require('./harness');

function freshFx() {
  // require のキャッシュを外して、毎回まっさらな FxKit を作る
  delete require.cache[require.resolve('../public/js/fx')];
  const Fx = require('../public/js/fx');
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  const doc = dom.window.document;
  const log = { sounds: [], vibes: [] };
  Fx.init({
    doc,
    root: doc.getElementById('app'),
    ms: (n) => n,
    vibrate: (p) => log.vibes.push(p),
    sound: {
      good: () => log.sounds.push('good'),
      bad: () => log.sounds.push('bad'),
      tick: () => log.sounds.push('tick'),
      big: () => log.sounds.push('big')
    }
  });
  return { Fx, dom, doc, log, app: doc.getElementById('app') };
}

(async function main() {
  const r = createRunner('fx：演出の共通部品');

  // ---------- 原則B：スキップできない演出を作れない ----------
  await r.test('原則B：長い演出でも、スキップすれば即座に終わる', async () => {
    const { Fx } = freshFx();
    const t0 = Date.now();
    const p = Fx.hold(60000); // 1分の演出。待っていたらテストが終わらない
    assert(Fx.busy(), '待っている演出があることが分かる');
    assertEqual(Fx.skipNow(), 1, '飛ばした演出の数が返る');
    const skipped = await p;
    assertEqual(skipped, true, 'スキップされたことが呼んだ側に分かる');
    assert(Date.now() - t0 < 1000, '1分待たされない');
    assert(!Fx.busy(), '飛ばしたあとは何も待っていない');
  });

  await r.test('原則B：連なった演出は、一度のタップで全部飛ぶ', async () => {
    // 2周目の人が、演出を1つずつ叩いて飛ばすはめにならないこと
    const { Fx } = freshFx();
    const ps = [Fx.hold(60000), Fx.hold(60000), Fx.hold(60000)];
    assertEqual(Fx.skipNow(), 3, '3つまとめて飛ぶ');
    const all = await Promise.all(ps);
    assertEqual(all.filter(Boolean).length, 3, '3つとも「スキップされた」で返る');
  });

  await r.test('原則B：画面を触ればスキップされる（タップの経路）', async () => {
    const { Fx, doc } = freshFx();
    const p = Fx.hold(60000);
    const ev = new doc.defaultView.Event('pointerdown', { bubbles: true });
    doc.getElementById('app').dispatchEvent(ev);
    assertEqual(await p, true, 'どこを触っても飛ぶ');
  });

  await r.test('原則B：演出中でない時に触っても、何も起きない', async () => {
    const { Fx, doc } = freshFx();
    const ev = new doc.defaultView.Event('pointerdown', { bubbles: true });
    doc.getElementById('app').dispatchEvent(ev);
    assert(!Fx.busy(), '普段のタップが演出の仕組みに触らない');
  });

  await r.test('原則B：「演出の速さ」は ms 1か所で全部に効く', async () => {
    // 速さの設定を足した時、当て忘れる画面が出ないように、
    // 待ち時間は必ず ms() を通る形にしてある
    delete require.cache[require.resolve('../public/js/fx')];
    const Fx = require('../public/js/fx');
    const dom = new JSDOM('<!doctype html><div id="app"></div>');
    const seen = [];
    Fx.init({
      doc: dom.window.document,
      root: dom.window.document.getElementById('app'),
      ms: (n) => { seen.push(n); return 0; } // スキップ設定と同じ扱い
    });
    await Fx.hold(800);
    await Fx.flash('good');
    await Fx.banner({ text: 'やった', ms: 900 });
    assert(seen.indexOf(800) >= 0, 'hold が ms を通る');
    assert(seen.indexOf(420) >= 0, 'flash が ms を通る');
    assert(seen.indexOf(900) >= 0, 'banner が ms を通る');
    assert(seen.length >= 3, '待つところは全部 ms を通っている');
  });

  await r.test('原則B：速さを0にしても、演出の後片付けは必ず終わる', async () => {
    // スキップの人だけ、演出のかけらが画面に残る、という壊れ方をさせない
    delete require.cache[require.resolve('../public/js/fx')];
    const Fx = require('../public/js/fx');
    const dom = new JSDOM('<!doctype html><div id="app"></div>');
    const app = dom.window.document.getElementById('app');
    Fx.init({ doc: dom.window.document, root: app, ms: () => 0 });
    await Fx.flash('good');
    await Fx.banner({ text: 'やった' });
    assertEqual(app.querySelectorAll('.fx-flash').length, 0, 'フラッシュが残らない');
    assertEqual(app.querySelectorAll('.fx-banner').length, 0, '画面いっぱいの演出が残らない');
  });

  // ---------- 原則C：褒める時は全力で、責める時は静かに ----------
  await r.test('原則C：責める側から画面いっぱいの演出を出せない', async () => {
    // banner に 'bad' を作らないことで、うっかり「不正解！」を
    // 画面いっぱいに出す実装ができないようにしてある
    const src = require('fs').readFileSync(require.resolve('../public/js/fx'), 'utf8');
    assert(!/fx-banner-bad/.test(src), 'banner に bad の見た目が無い');
    const css = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(!/\.fx-banner-bad\b/.test(css), 'CSSにも bad の見た目が無い');
  });

  await r.test('原則C：不正解のフラッシュは0.15秒、正解より短い', async () => {
    delete require.cache[require.resolve('../public/js/fx')];
    const Fx = require('../public/js/fx');
    const dom = new JSDOM('<!doctype html><div id="app"></div>');
    const seen = [];
    Fx.init({
      doc: dom.window.document, root: dom.window.document.getElementById('app'),
      ms: (n) => { seen.push(n); return 0; }
    });
    await Fx.flash('bad');
    const bad = seen[0];
    seen.length = 0;
    await Fx.flash('good');
    const good = seen[0];
    assertEqual(bad, 150, '責める時は0.15秒');
    assert(good > bad, '褒める時の方が長い');
  });

  await r.test('原則C：正解では音が鳴り、不正解では控えめな音だけ', async () => {
    const { Fx, log } = freshFx();
    await Fx.banner({ text: 'せいかい', kind: 'good' });
    assert(log.sounds.indexOf('big') >= 0, '褒める時は大きい音');
    log.sounds.length = 0;
    await Fx.flash('bad');
    assertEqual(log.sounds.join(','), 'bad', '責める時は短い音1つだけ');
  });

  // ---------- 原則E：切断・復帰 ----------
  await r.test('原則E：切断の通知は、音も振動も鳴らさない', async () => {
    // 慌てさせないため。ゲームは普通に続いている
    const { Fx, log, app } = freshFx();
    Fx.notice('たろうさんが席を外しました');
    assertEqual(log.sounds.length, 0, '音は鳴らさない');
    assertEqual(log.vibes.length, 0, '振動もしない');
    assertEqual(app.querySelectorAll('.fx-notice').length, 1, '画面には出る');
  });

  await r.test('原則E：通知は画面を埋め尽くさない', async () => {
    // 同時に何人も落ちた時に、画面が通知で埋まらないこと
    const { Fx, app } = freshFx();
    for (let i = 0; i < 8; i++) Fx.notice('だれか' + i + 'さんが席を外しました');
    assert(app.querySelectorAll('.fx-notice').length <= 3, '出しっぱなしにしない');
  });

  await r.test('原則E：通知は進行を止めない（待たせない）', async () => {
    const { Fx } = freshFx();
    assertEqual(Fx.notice('たろうさんが戻りました', 'back'), undefined,
      '待つものを返さない＝呼んだ側が止まりようがない');
  });

  // ---------- 部品そのもの ----------
  await r.test('カウントアップ：スキップされても最終値になる', async () => {
    const { Fx, doc } = freshFx();
    const n = doc.createElement('div');
    const p = Fx.countUp(n, 0, 120, 60000);
    Fx.skipNow();
    await p;
    assertEqual(n.textContent, '120', '途中で止めても点数は正しい');
    assert(!n.classList.contains('fx-counting'), '数えている印が残らない');
  });

  await r.test('カウントアップ：変わらない時は動かさない', async () => {
    const { Fx, doc } = freshFx();
    const n = doc.createElement('div');
    await Fx.countUp(n, 7, 7, 600);
    assertEqual(n.textContent, '7', '同じ値ならそのまま出す');
  });

  await r.test('順に出す：スキップされても、全部が最後まで出る', async () => {
    // 順位発表を飛ばしたら3位以下が消えていた、という壊れ方をさせない
    const { Fx, doc } = freshFx();
    const box = doc.createElement('div');
    ['1', '2', '3', '4'].forEach(function (t) {
      const c = doc.createElement('div'); c.textContent = t; box.appendChild(c);
    });
    // stagger は1件ずつ順に待つので、待ちが登録されるたびに飛ばす
    //（実機で言えば、連打ではなく「1回タップしたら残り全部が飛ぶ」に当たる）
    const p = Fx.stagger(box.children, 60000);
    const tapping = setInterval(function () { Fx.skipNow(); }, 5);
    await p;
    clearInterval(tapping);
    assertEqual(box.querySelectorAll('.fx-in').length, 4, '4件とも出ている');
  });

  await r.test('順に出す：たくさん並ぶ時は、1つずつ音を鳴らさない', async () => {
    // 30個のコードが点灯するだけで30回鳴ると、うるさいだけで何も伝わらない
    const { Fx, doc, log } = freshFx();
    function box(n) {
      const b = doc.createElement('div');
      for (let i = 0; i < n; i++) b.appendChild(doc.createElement('div'));
      return b;
    }
    await Fx.stagger(box(5).children, 0);
    const few = log.sounds.filter(s => s === 'tick').length;
    assert(few > 0, '数えられる数なら、1つずつ鳴らす');
    log.sounds.length = 0;
    await Fx.stagger(box(30).children, 0);
    assertEqual(log.sounds.filter(s => s === 'tick').length, 0,
      'たくさん並ぶ時は鳴らさない');
  });

  await r.test('カードめくり：中身の差し替えは、裏を向いてからになる', async () => {
    // 先に差し替えると、めくる前に答えが見えてしまう
    const { Fx, doc } = freshFx();
    const card = doc.createElement('div');
    card.textContent = 'うら';
    let whenSwapped = null;
    const p = Fx.flip(card, function () {
      whenSwapped = card.className;   // 差し替えの瞬間、どの向きだったか
      card.textContent = 'おもて';
    }, 300);
    await p;
    assert(/fx-flip-a/.test(whenSwapped || ''), '裏を向ききった所で差し替わる');
    assertEqual(card.textContent, 'おもて', '中身が変わっている');
    assertEqual(card.className, '', 'めくり終わったら印が残らない');
  });

  await r.test('票が飛ぶ：位置が取れない環境でも落ちない', async () => {
    // jsdom には見た目が無い。実機以外で落ちないことを見ておく
    const { Fx, doc } = freshFx();
    const a = doc.createElement('div');
    const b = doc.createElement('div');
    doc.getElementById('app').appendChild(a);
    doc.getElementById('app').appendChild(b);
    await Fx.fly(a, b, '1');
    await Fx.fly(null, b, '1');
    assertEqual(doc.querySelectorAll('.fx-fly').length, 0, '飛ばしたものが残らない');
  });

  await r.test('待機演出：付けたり外したりできる', async () => {
    const { Fx, doc } = freshFx();
    const n = doc.createElement('div');
    Fx.alive(n);
    assert(n.classList.contains('fx-alive'), '止まっていないことを見せる');
    Fx.alive(n, false);
    assert(!n.classList.contains('fx-alive'), '外せる');
    Fx.alive(null); // 落ちないこと
  });

  await r.test('名前に < > が入っていても、そのまま文字として出る', async () => {
    const { Fx, app } = freshFx();
    Fx.notice('<b>わる</b>さんが席を外しました');
    assertEqual(app.querySelector('.fx-notice').querySelectorAll('b').length, 0,
      '名前がHTMLとして効いてしまわない');
  });

  await r.test('土台が無くても落ちない（画面より先に呼ばれた時）', async () => {
    delete require.cache[require.resolve('../public/js/fx')];
    const Fx = require('../public/js/fx');
    // init を呼ばないまま使う
    await Fx.flash('good');
    await Fx.banner({ text: 'やった' });
    Fx.notice('だれか');
    assert(true, '落ちない');
  });

  // ---------- 第32弾-D：揺れ・紙吹雪・コールアウト・振動 ----------

  await r.test('画面の揺れ：0.2秒以内に1回だけで、終わったら消える', async () => {
    const { Fx, app } = freshFx();
    const p = Fx.shake();
    assert(app.classList.contains('fx-shake'), '揺れている');
    await p;
    assert(!app.classList.contains('fx-shake'), '揺れは残らない（繰り返さない）');
  });

  await r.test('画面の揺れ：「画面の揺れをつかう」を切っている人には出さない', async () => {
    const { Fx, app } = freshFx();
    Fx.init({ can: { shake: () => false } });
    await Fx.shake('big');
    assert(!app.classList.contains('fx-shake') && !app.classList.contains('fx-shake-big'),
      '設定を切っていれば揺れない');
  });

  await r.test('紙吹雪：舞って、終わったら片付く。歓声も重なる', async () => {
    const { Fx, app, log } = freshFx();
    Fx.init({ sound: { cheer: () => log.sounds.push('cheer') } });
    const p = Fx.confetti(['#f0c44a']);
    const box = app.querySelector('.fx-confetti');
    assert(box && box.children.length > 20, '紙吹雪が舞う');
    assert(log.sounds.indexOf('cheer') >= 0, '歓声が重なる（4-3）');
    Fx.skipNow();
    await p;
    assert(!app.querySelector('.fx-confetti'), '終わったら残らない');
  });

  await r.test('コールアウト：短い英単語が出て、消える', async () => {
    const { Fx, app } = freshFx();
    const p = Fx.callout('TIEBREAKER', { kind: 'danger' });
    const n = app.querySelector('.fx-callout');
    assert(n && /TIEBREAKER/.test(n.textContent), '言葉が出る');
    assert(n.classList.contains('fx-callout-danger'), '場面に合わせた色になる');
    Fx.skipNow();
    await p;
    assert(!app.querySelector('.fx-callout'), '出しっぱなしにならない');
  });

  await r.test('3-2-1：数字が出て、タップで飛ばせて、あとに残らない（第34弾 2-1）', async () => {
    const { Fx, app } = freshFx();
    const p = Fx.countdown(3);
    const box = app.querySelector('.fx-countdown');
    assert(box && /3/.test(box.textContent), '3から数え始める');
    Fx.skipNow();   // 原則B：タップで飛ばせる
    await p;
    assert(!app.querySelector('.fx-countdown'), '飛ばしたら残らない');
  });

  await r.test('場面に合わせた振動：名前で呼べて、パターンで震える', async () => {
    const { Fx, log } = freshFx();
    Fx.vibe('rise');
    assert(Array.isArray(log.vibes[0]) && log.vibes[0].length > 4, '鼓動が速くなるパターン');
    Fx.vibe('sold');
    assert(log.vibes.length === 2, '木槌の1回');
    Fx.vibe('しらないなまえ');
    assert(log.vibes.length === 3, '知らない名前でも落ちずに短く震える');
  });

  r.finish();
})();
