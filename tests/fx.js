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

// opt で init の中身を差し替えられる（速さ設定を「スキップ」にした時の検査に使う）
function freshFx(opt) {
  // require のキャッシュを外して、毎回まっさらな FxKit を作る
  delete require.cache[require.resolve('../public/js/fx')];
  const Fx = require('../public/js/fx');
  const dom = new JSDOM('<!doctype html><div id="app"></div>');
  const doc = dom.window.document;
  const log = { sounds: [], vibes: [] };
  Fx.init({
    doc,
    root: doc.getElementById('app'),
    ms: (opt && opt.ms) || ((n) => n),
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
    // 待つ長さは「いちばん長い問い合わせ」で見る。
    // 先頭で見ていた頃は、flash が待つ前に別の用で速さ設定を1回聞くだけで
    // （第39弾で振動がスキップに従うようにした時に、実際にそうなった）
    // 「0.15秒待っているか」ではなく「1回目に何を聞いたか」を見る検査になっていた
    await Fx.flash('bad');
    const bad = Math.max.apply(null, seen);
    seen.length = 0;
    await Fx.flash('good');
    const good = Math.max.apply(null, seen);
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

  // 第36弾 36-1：ここは原則Bの唯一の例外。
  // 3-2-1は演出ではなく「全員が同じ瞬間に始まるための合図」なので、飛ばせない。
  // 実機では、途中を叩くと自分だけ先に進んでしまっていた。
  await r.test('36-1：ゲーム開始の3-2-1は、タップでも設定でも飛ばせない（第34弾 2-1／第36弾 36-1）', async () => {
    // ms を 0 にする＝「演出の速さ＝スキップ」を選んだ人と同じ設定。
    // 合図はこの設定にも従わない（従うと、その人だけ先に始まる）
    const { Fx, app } = freshFx();
    Fx._cfg.ms = () => 0;
    const t0 = Date.now();
    const p = Fx.countdown(3);
    const box = app.querySelector('.fx-countdown');
    assert(box && /3/.test(box.textContent), '3から数え始める');   // 条件が作れている
    assertEqual(Fx.busy(), false, '飛ばせる演出の列に積まれない');
    assertEqual(Fx.skipNow(), 0, 'タップしても、飛ばせるものが1つも無い');
    await new Promise((r2) => setTimeout(r2, 200));
    assert(app.querySelector('.fx-countdown'), 'タップしても消えない');
    await p;
    // 3秒ぶん数える。実装の定数ではなく、守りたい約束そのものを数字で書いている
    assert(Date.now() - t0 >= 2800, '3秒ぶん数える（速さの設定でも縮まない）');
    assert(!app.querySelector('.fx-countdown'), '数え終わったら、あとに残らない');
  });

  await r.test('36-1：本当に飛ばしてよい場面のための逃げ道は残してある', async () => {
    // その人ひとりのための合図（手渡し）まで縛ると、待たせるだけになる。
    // 既定は飛ばせない・明示した時だけ飛ばせる、という向きにしてある
    const { Fx, app } = freshFx();
    const p = Fx.countdown(9, { skippable: true });
    assert(Fx.busy(), '飛ばせる待ちとして積まれる');
    Fx.skipNow();
    await p;
    assert(!app.querySelector('.fx-countdown'), '飛ばしたら残らない');
  });

  await r.test('振動の型は4つだけで、手の感じで名前が付いている（第39弾）', async () => {
    // それまでは rise / win / miss / sold / count1-3 の7つあり、
    // 名前が「その場面の気持ち」で付いていた。そのせいで
    // **人狼の襲撃と処刑に 'win'（勝ち）が鳴っていた**（落とし穴2）。
    // 気持ちは画面が伝えるもので、手は「短いか長いか・1回か2回か」しか伝えられない
    const { Fx, log } = freshFx();
    assertEqual(Fx.vibe.NAMES.join(','), 'tick,ok,warn,boom', '型は4つだけ');

    assertEqual(Fx.vibe('tick'), true, 'tick は鳴る');
    assertEqual(log.vibes[0].join(','), '12', 'tick はごく短く1回');
    Fx.vibe('ok');    assertEqual(log.vibes[1].join(','), '30', 'ok は短く1回');
    Fx.vibe('warn');  assertEqual(log.vibes[2].join(','), '25,60,25', 'warn は短く2回');
    Fx.vibe('boom');  assertEqual(log.vibes[3].join(','), '200', 'boom は長く1回');

    // **知らない名前は鳴らさない。**鳴らしてしまうと、
    // 型を増やしたつもりが無いのに、勝手な振動が増えていく
    assertEqual(Fx.vibe('しらないなまえ'), false, '知らない名前では鳴らない');
    assertEqual(log.vibes.length, 4, '鳴らなかったぶんは記録にも増えない');
  });

  await r.test('振動も「スキップ」に従う（第39弾で見つけた食い違い）', async () => {
    // ここは演出の速さ設定を通っていなかったので、
    // 「スキップ」にしても振動だけ元の長さで鳴っていた。
    // 画面は止まっているのに手だけ震える形で、
    // 原則「すべての演出はスキップできる」に反していた
    const { Fx, log } = freshFx();
    Fx.vibe('boom');
    assertEqual(log.vibes.length, 1, 'ふつうの速さでは鳴る');  // 型(b)：条件が作れている

    const skipped = freshFx({ ms: function(){ return 0; } });
    assertEqual(skipped.Fx.vibe('boom'), false, 'スキップ中は鳴らない');
    assertEqual(skipped.log.vibes.length, 0, '手も震えない');
  });

  r.finish();
})();
