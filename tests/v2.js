// tests/v2.js — 新しい見た目（v2・指示66）の約束
//
// 指示66 は画面を新しい見た目に入れかえる。**古い画面をこわさずに**入れるのが 66-1 の芯で、
// 新しい規則は `.v2` の箱の中だけに効く（index.html の「指示66：新しい見た目（v2）」の節）。
// ここで見張るのは、CSS も JS もエラーを出さない形の事故（落とし穴23・27・30・37）：
//   ・新しい規則が古い画面に漏れる／古い規則が新しい画面に漏れる
//   ・規則と、それを着ている所が、名前でずれる（v2- の頭は dead-style の「頭が出る」でいつも通ってしまう）
//   ・動きの長さが「演出の速さ」をかけていない／くり返す動きが「なし」で止まらない（チカチカする）
//   ・見本データの入口が本番に出る
//   ・待合（見本 F3）の描き方：自分の札・名簿・候補・ルール3つ・TVの列の決まり・名前の escape
// 版組み（はみ出し・重なり・字の切れ・中心）は jsdom では測れないので、tools/v2-shot.js（check.js）と
// tools/v2-ink.js が本物の Chrome で測る。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, cssRules, launch, sleep, waitFor } = require('./harness');

const R = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(R, 'public', 'index.html'), 'utf8');
const KIT = fs.readFileSync(path.join(R, 'public', 'js', 'v2-kit.js'), 'utf8');
// 新しい見た目を組むファイルは v2-kit.js だけではない（指示66-2 の v2-fes.js など）。名前を並べず、置き場から導く（落とし穴4）
const V2JS = fs.readdirSync(path.join(R, 'public', 'js')).filter((n) => /^v2-.*\.js$/.test(n))
  .map((n) => fs.readFileSync(path.join(R, 'public', 'js', n), 'utf8')).join('\n');
const STYLE = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>'));
const 頭 = '指示66：新しい見た目（v2）';
const 尾 = '/* ---- v2 ここまで ---- */';
/** v2 の節（コメントは落とす。中括弧を含むコメントで規則の切り出しがずれないように） */
function v2の節(style) {
  const a = style.indexOf(頭), b = style.indexOf(尾);
  if (a < 0 || b < 0 || b < a) return null;
  return style.slice(style.lastIndexOf('/*', a), b).replace(/\/\*[\s\S]*?\*\//g, '');
}
const V2CSS = v2の節(STYLE);
const SCENES = require(path.join(R, 'tools', 'v2-lab', 'scenes.js'));
/** MODES は index.html の字から読む（画面の関数の答えを、同じ実装で確かめない・落とし穴10-a） */
function MODES() {
  const a = HTML.indexOf('var MODES = ['), b = HTML.indexOf('\n  ];', a);
  return new Function('return ' + HTML.slice(a + 'var MODES = '.length, b + 4))();
}

/**
 * v2 の規則の選択子が「v2 の箱の中だけ」を指しているか。
 * 許すのは、v2 の箱（.v2）か v2 の部品（.v2-◯◯）から始まるものと、
 * 入れ物の側の制限を外す4つ（.app／html／body の :has(.v2…)）、スキップの止め（:root.fx-skip .v2 …）だけ
 */
const 箱の外の許し = [/^\.app:has\(\.v2[.\-a-z0-9]*\.active\)$/, /^html:has\(\.v2\.active\)$/, /^body:has\(\.v2\.active\)$/];
function 漏れる選択子(css) {
  const bad = [];
  cssRules(css).forEach((r) => {
    r.sel.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
      if (/^(from|to|\d+%)$/.test(s)) return;   // @keyframes の段
      if (/^\.v2[\s.:\-]/.test(s) || s === '.v2') return;
      if (/^\.screen\.v2[\s.:]/.test(s)) return;
      if (/^:root\.fx-skip \.v2[\s.]/.test(s)) return;
      // 指示66-2：設定の文字サイズ「大」の印（:root.fs-large）も、箱の中を指す
      if (/^:root\.fs-large \.v2[\s.]/.test(s)) return;
      if (箱の外の許し.some((re) => re.test(s))) return;
      bad.push(s);
    });
  });
  return bad;
}

/** その長さの書き方が「演出の速さ」をかけているか（押した合図 0.15秒・長押し 0.45秒は例外） */
function 速さをかけていない(css) {
  const bad = [];
  cssRules(css).forEach((r) => {
    r.body.split(';').forEach((decl) => {
      const m = /^\s*(transition|animation|transition-duration|animation-duration|animation-delay)\s*:\s*(.+)$/.exec(decl);
      if (!m) return;
      // calc( … * var(--fx-scale)) の中の秒は、かけてある
      const 外 = m[2].replace(/calc\([^()]*(\([^()]*\))*[^()]*\)/g, (c) => (/var\(--fx-scale\)/.test(c) ? '' : c));
      (外.match(/(^|[\s,(])(\d*\.?\d+)s\b/g) || []).forEach((t) => {
        const v = parseFloat(t.replace(/[^\d.]/g, ''));
        if (v === 0.15 && /transform/.test(m[2])) return;                 // 押した合図
        if (v === 0.45 && /v2-lpfill/.test(m[2])) return;                  // 長押し（押す人の手の時間）
        bad.push(r.sel + ' { ' + m[1] + ':' + m[2].trim() + ' }');
      });
    });
  });
  return bad;
}

/** くり返す動き（infinite）を持つ部品と、それを「なし」で止める規則が対になっているか */
function 止まらない(css) {
  const rules = cssRules(css);
  const 回る = [], 止め = new Set(), 静か = new Set();
  rules.forEach((r) => {
    if (/infinite/.test(r.body)) r.sel.split(',').forEach((s) => 回る.push(s.trim()));
    if (/animation\s*:\s*none/.test(r.body)) r.sel.split(',').forEach((s) => {
      s = s.trim();
      if (s.indexOf(':root.fx-skip ') === 0) 止め.add(s.slice(':root.fx-skip '.length));
      else 静か.add(s);
    });
  });
  const bad = [];
  回る.forEach((s) => {
    const base = s.replace(/:nth-child\([^)]*\)/g, '');
    if (!止め.has(base)) bad.push(s + '（演出「なし」で止まらない）');
    if (!静か.has(base)) bad.push(s + '（動きを減らす設定で止まらない）');
  });
  return { 回る, bad };
}

/** v2 の節が持つクラス名 */
function v2のクラス(css) {
  const out = new Set();
  cssRules(css).forEach((r) => (r.sel.match(/\.v2-[a-z0-9-]+/g) || []).forEach((c) => out.add(c.slice(1))));
  return out;
}

(async function main() {
  const r = createRunner('v2：新しい見た目（指示66）の約束');

  await r.test('新しい規則は、最初の <style> の中・「第28弾-2 第2部」より上にある（ほかの検査が読む所）', async () => {
    assert(V2CSS, 'v2 の節が最初の <style> の中にある');
    // テーマ専用の節の印は、smoke.js と同じく「1つ目」を読む。**1つ目が v2 の節の後ろ、かつ v2 の節の中に無い**こと
    //（v2 の節のコメントに印の字を写したら、smoke.js がそこから読んで v2 を全部「テーマの外」と数えた。
    // この確かめもその写しを拾って自明に通っていた——落とし穴10-a・45）
    const 印 = '第28弾-2 ' + '第2部';
    const 印の位置 = STYLE.indexOf(印), 尾の位置 = STYLE.indexOf(尾);
    assert(印の位置 > 尾の位置 && 尾の位置 > STYLE.indexOf(頭), 'テーマ専用の節（smoke.js が読む）の印の1つ目は、v2 の節より後ろ');
    assert(cssRules(V2CSS).length > 120, 'v2 の規則を集められている（実際:' + cssRules(V2CSS).length + '件）');   // 型(b)
  });

  await r.test('古い画面に漏れない：v2 の規則は、どれも v2 の箱の中だけを指す', async () => {
    assertEqual(漏れる選択子(V2CSS).join('\n       '), '', 'v2 の箱の外を指している選択子');
    // この検査が本当に赤くなるか（落とし穴10）：箱の外を指す規則を1つ混ぜる
    const 汚 = V2CSS + '\n  .btn{color:red;}\n  .v2,.card{color:red;}\n';
    assertEqual(漏れる選択子(汚).join('・'), '.btn・.card', '箱の外を指す規則を混ぜると、それだけを言う');
  });

  await r.test('古い規則が新しい画面に漏れない：v2 の画面の札は v2- の名前か、v2 の名前と組んだ印（is-）だけ', async () => {
    const { win, doc } = await launch({});
    const view = SCENES.view('fes-lobby', { n: 6 });
    view.joinUrl = 'https://example.org/?room=' + view.code;
    win.V2Screens.fesLobby(view); win.V2Screens.fesTv(view); win.V2Screens.parts({ world: 'bomb' });
    const 許す = /^(v2|v2-[a-z0-9-]+|screen|active|scr-in-fwd|scr-in-back|is-[a-z0-9-]+|emj|emj-[a-z]+)$/;
    const 見た = new Set(), 外 = new Set(), is = new Set();
    doc.querySelectorAll('.screen.v2, .screen.v2 *').forEach((e) => {
      (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || '')).split(/\s+/).filter(Boolean).forEach((c) => {
        見た.add(c);
        if (!許す.test(c)) 外.add(c);
        if (/^is-/.test(c)) is.add(c);
      });
    });
    assert(見た.size > 60, 'v2 の画面の札を集められている（実際:' + 見た.size + '）');   // 型(b)
    assertEqual([...外].sort().join('・'), '', 'v2 の画面に、古い名前の札が付いている');
    // is- の印だけで当たる古い規則があると、v2 の画面に漏れる（例：.is-on{…} が古い CSS にあったら）
    const 古いCSS = STYLE.replace(V2CSS, '');
    const 当たる = [];
    cssRules(古いCSS.replace(/\/\*[\s\S]*?\*\//g, '')).forEach((x) => x.sel.split(',').forEach((s) => {
      s.trim().split(/[\s>+~]+/).forEach((part) => {
        const cls = part.match(/\.[a-z0-9-]+/g) || [];
        if (cls.length && cls.every((c) => is.has(c.slice(1))) && !/^[a-z]/.test(part)) 当たる.push(s.trim());
      });
    }));
    assertEqual(当たる.join('・'), '', 'is- の印だけで当たる古い規則（v2 の画面に漏れる）');
    win.close();
  });

  await r.test('名前そのもので照らす：v2 の規則のクラスは着ている所があり、着ている札には規則がある（両方向）', async () => {
    // dead-style.js の「頭が出れば着られている」は、v2- の頭がどこにでもあるので v2 には効かない。ここで名前そのもので見る
    const 規則 = v2のクラス(V2CSS);
    assert(規則.size > 80, 'v2 の規則のクラスを集められている（実際:' + 規則.size + '）');   // 型(b)
    const SRC = HTML.replace(STYLE, '') + '\n' + V2JS;
    assert(V2JS.indexOf('V2Fes') >= 0 && V2JS.indexOf('root.V2 =') >= 0, 'v2-kit.js と v2-fes.js の両方を読めている（型(b)）');
    const 世界 = new Set(['v2-w-wait', 'v2-w-aresore', 'v2-w-sugoroku', 'v2-w-shinka', 'v2-w-wolf', 'v2-w-bomb', 'v2-w-quiz', 'v2-w-auction', 'v2-w-falsetrue', 'v2-w-rcard']);
    const 着ない = [...規則].filter((c) => !世界.has(c) && !new RegExp('[\'"` ]' + c.replace(/-/g, '\\-') + '[\'"` ]').test(SRC));
    assertEqual(着ない.sort().join('・'), '', 'v2 の規則があるのに、名前そのものが書かれた所が無いクラス');
    // 世界の名前は V2.WORLDS から組む（V2.WORLDS と CSS の世界が同じであること）
    const V2 = require('../public/js/v2-kit.js');
    assertEqual(V2.WORLDS.map((w) => 'v2-w-' + w).sort().join('・'), [...世界].sort().join('・'), 'V2.WORLDS と、CSS の世界の名前が同じ');
    // 帰り：描いた画面の v2- の札に、規則がある
    const { win, doc } = await launch({});
    const view = SCENES.view('fes-lobby', { n: 9 });
    view.joinUrl = 'https://example.org/?room=' + view.code;
    win.V2Screens.fesLobby(view); win.V2Screens.fesTv(view); win.V2Screens.parts({ world: 'quiz' });
    const 裸 = new Set();
    doc.querySelectorAll('.screen.v2 [class*="v2-"]').forEach((e) => (e.getAttribute('class') || '').split(/\s+/)
      .filter((c) => /^v2-/.test(c) && !規則.has(c)).forEach((c) => 裸.add(c)));
    assertEqual([...裸].sort().join('・'), '', '描いた札なのに、規則の無い v2- のクラス');
    win.close();
  });

  await r.test('動き：v2 の長さは、押した合図（0.15秒）と長押し（0.45秒）のほかは全部「演出の速さ」をかける', async () => {
    assertEqual(速さをかけていない(V2CSS).join('\n       '), '', '演出の速さ（--fx-scale）をかけていない長さ');
    // 値の正本も見る：切りかえ 0.25・見せ場 0.75・順位 0.4 がかけてある
    ['--v2-move:calc(.25s * var(--fx-scale))', '--v2-show:calc(.75s * var(--fx-scale))', '--v2-rank:calc(.4s * var(--fx-scale))', '--v2-press:.15s']
      .forEach((t) => assert(V2CSS.indexOf(t) >= 0, '値の正本：' + t));
    assert(!/var\(--fx\)/.test(V2CSS), '見本の --fx（アプリには無い）を使っていない');
    // 赤くなるか（落とし穴10）
    const 汚 = V2CSS + '\n  .v2 .v2-x{transition:opacity .3s ease;}\n';
    assertEqual(速さをかけていない(汚).length, 1, 'かけていない長さを混ぜると、それを言う');
  });

  await r.test('くり返す動きは、演出「なし」と「動きを減らす」で止まる（アプリのスキップは回数を止めないので、チカチカする）', async () => {
    const { 回る, bad } = 止まらない(V2CSS);
    assert(回る.length >= 2, 'くり返す動きを集められている（実際:' + 回る.join('・') + '）');   // 型(b)
    assertEqual(bad.join('\n       '), '', '止まらないくり返し');
    const 汚 = V2CSS.replace(/:root\.fx-skip \.v2 \.v2-circles i,/, '');
    assert(止まらない(汚).bad.length > 0, '止めの規則を外すと、それを言う');
  });

  await r.test('見本データの入口は本番に無い（public/ に台本も入口も置かない）', async () => {
    const pub = [];
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return walk(p);
        if (/\.(html|js|css|json)$/.test(e.name)) pub.push(p);
      });
    })(path.join(R, 'public'));
    assert(pub.length >= 20, 'public/ を読めている（実際:' + pub.length + '）');   // 型(b)
    const 入口 = pub.filter((p) => /v2lab|V2LAB|v2-lab/.test(fs.readFileSync(p, 'utf8')));
    assertEqual(入口.map((p) => path.relative(R, p)).join('・'), '', 'public/ に見本データの入口がある');
    const server = fs.readFileSync(path.join(R, 'server.js'), 'utf8');
    assert(!/v2-lab|v2lab/.test(server), '本番の server.js は見本データの道を持たない');
    const dev = fs.readFileSync(path.join(R, 'tools', 'dev-server.js'), 'utf8');
    // **門の { … } の中にあるか**を括弧を数えて見る。「門の字より後ろ」だけだと、} の外へ出しても通る
    //（変異 66-N が素通りして分かった）
    const g = dev.indexOf("process.env.NODE_ENV !== 'production'"), m = dev.indexOf("require('./v2-lab/serve').mount(app)");
    const 開き = dev.indexOf('{', g);
    let 深さ = 0, 閉じ = -1;
    for (let i = 開き; i < dev.length; i++) {
      if (dev[i] === '{') 深さ++;
      else if (dev[i] === '}' && --深さ === 0) { 閉じ = i; break; }
    }
    assert(g > 0 && 開き > g && 閉じ > 開き, '検証用サーバーに「本番でない時だけ」の門がある');
    assert(m > 開き && m < 閉じ, '検証用サーバーが、本番でない時だけ /v2lab を足す（門の { … } の中）');
    // 本番と同じ入り方（?scene= を付けても）では、新しい見た目の画面へは行かない
    const { win, doc } = await launch({ url: 'http://localhost/?scene=fes-lobby&n=6' });
    assert(!/^scr-v2-/.test((doc.querySelector('.screen.active') || {}).id || ''), 'URL だけでは新しい見た目の画面に入れない');
    assert(!win.__V2LAB_VIEW && !win.V2Lab, '見本データは読み込まれていない');
    win.close();
  });

  await r.test('待合のスマホ（見本 F3）：自分の札・名簿・候補・ルール3つ・名前の escape', async () => {
    const { win, doc } = await launch({});
    const view = SCENES.view('fes-lobby', { n: 6, me: 3 });
    view.joinUrl = 'https://example.org/?room=' + view.code;
    // 名前に HTML を入れても要素にならない（落とし穴43）
    const 危 = view.members.find((m) => m.id === 'm2');
    危.name = '<img src=x onerror=window.__xss=1>';
    win.V2Screens.fesLobby(view);
    win.goToScreen('scr-v2-fes-lobby');
    await sleep(win, 30);
    const s = doc.getElementById('scr-v2-fes-lobby');
    assert(s.classList.contains('active'), '画面に入った');
    assert(!s.querySelector('img[onerror]') && !win.__xss, '名前の HTML は字のまま');
    const ps = view.members.filter((m) => m.role !== 'bigscreen');
    assertEqual(s.querySelector('.v2-me-nm').textContent, ps.find((m) => m.id === 'm3').name, '大きな札は自分（meId）');
    assertEqual(s.querySelectorAll('.v2-roster .v2-rrow').length, ps.length, '名簿は遊ぶ人だけ（大画面の端末は出さない）');
    assert(s.querySelector('.v2-rrow.is-me .v2-rrow-st').textContent.length > 0, '名簿の自分に印');
    assert(/さっき/.test(s.querySelector('[data-v2-id="v2Roster"]').textContent), 'さっき入った人に印（fresh）');
    assertEqual(s.querySelector('.v2-cbtn.is-who').textContent.replace(/\D/g, ''), String(ps.length), '右上の人数');
    // 候補：名前とルールは MODES・GAMES から（手で書かない）
    const 名 = Array.from(s.querySelectorAll('.v2-nx-nm')).map((e) => e.textContent);
    const 期待 = view.candidates.map((id) => win.V2Screens.modeInfo(id).name);
    assertEqual(名.join('・'), 期待.join('・'), '候補の名前');
    view.candidates.forEach((id) => {
      const sheet = s.querySelector('[data-v2-id="v2Rules-' + id + '"]');
      assert(sheet, id + '：長押しで開くルールのシートがある');
      const 文 = Array.from(sheet.querySelectorAll('.v2-rb-t')).map((e) => e.textContent);
      const tv = MODES().find((m) => m.id === id).tv.map((x) => x[1]);
      assertEqual(文.join('｜'), tv.join('｜'), id + '：ルールの3つは MODES[].tv と同じ文');
      assert(sheet.classList.contains('v2-w-' + win.V2Screens.modeInfo(id).world), id + '：シートはそのゲームの世界');
    });
    // のこり時間：数字は1桁ずつの箱
    win.V2.freeze(23); win.V2.tick();
    assertEqual(s.querySelectorAll('.v2-band .v2-cd-n i').length, 2, 'のこり 23 は2つの箱');
    // 押すもの：data-v2-act はどれも行き先がある
    const acts = Array.from(s.querySelectorAll('[data-v2-act]')).map((e) => e.getAttribute('data-v2-act'));
    acts.forEach((a) => assert(/^(gear|look)$/.test(a), a + '：押した時の行き先がある'));
    win.close();
  });

  await r.test('待合のTV（見本 F3）：6人までは二つ名つき・7〜8人は名前だけ2列・9人から3列。押すものが無く、二人称も無い', async () => {
    const { win, doc } = await launch({});
    const 形 = {};
    for (const n of [1, 6, 7, 8, 9, 16]) {
      const view = SCENES.view('fes-tv', { n });
      view.joinUrl = 'https://example.org/?room=' + view.code;
      win.V2Screens.fesTv(view);
      const t = doc.getElementById('scr-v2-fes-tv');
      const g = t.querySelector('.v2-tgrid');
      形[n] = (g.classList.contains('is-c3') ? 'c3' : 'c2') + (t.querySelector('.v2-tmem.is-two') ? '+二つ名' : '') + (t.querySelector('.v2-tmem.is-sm') ? '+小' : '');
      assertEqual(t.querySelectorAll('.v2-tmem').length, n, n + '人：札の数');
      assert(t.querySelector('.v2-tqr svg'), n + '人：QR が出ている');
      assert(!t.querySelector('button, a[href], [role=button], [data-v2-act]'), n + '人：TV に押すものが無い');
      assert(!/あなた|YOU/.test(t.textContent), n + '人：TV に二人称が無い');
      assert(new RegExp('^' + n + '/').test(t.querySelector('.v2-tnum').textContent.replace(/\s/g, '')), n + '人：帯の人数');
    }
    assertEqual(JSON.stringify(形), JSON.stringify({ 1: 'c2+二つ名', 6: 'c2+二つ名', 7: 'c2', 8: 'c2', 9: 'c3+小', 16: 'c3+小' }), 'TV の列の決まり');
    win.close();
  });

  await r.test('のこり時間：5秒以下は赤い札。札の大きさはふだんと同じ（色だけ変わる）', async () => {
    const lo = cssRules(V2CSS).filter((x) => /\.v2-cd\.is-lo \.v2-cd-n/.test(x.sel));
    assert(lo.length >= 1, '赤い札の規則がある');
    lo.forEach((x) => x.body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean)
      .forEach((p) => assert(/^(background|background-color|color)$/.test(p), '赤い札で変えてよいのは色だけ（' + p + '）')));
    const { win, doc } = await launch({});
    const view = SCENES.view('fes-lobby', { n: 3 });
    view.joinUrl = 'x';
    win.V2Screens.fesLobby(view);
    const cd = doc.querySelector('#scr-v2-fes-lobby .v2-band .v2-cd');
    const 見る = (sec) => { win.V2.freeze(sec); win.V2.tick(); return (cd.classList.contains('is-lo') ? 'lo' : '-') + (cd.classList.contains('is-one') ? '1' : '2'); };
    assertEqual([23, 9, 6, 5, 4, 0].map(見る).join(' '), '-2 -1 -1 lo1 lo1 lo1', '23・9・6・5・4・0 秒');
    win.V2.freeze(null);
    win.close();
  });

  await r.test('重なりは「もどる」と ESC で先に閉じる（正本 §8）。確認の枠は ESC では閉じない', async () => {
    const { win, doc } = await launch({});
    const view = SCENES.view('fes-lobby', { n: 3 });
    view.joinUrl = 'x';
    win.V2Screens.fesLobby(view);
    win.goToScreen('scr-v2-fes-lobby');
    const sheet = doc.querySelector('[data-v2-id="v2Roster"]');
    doc.querySelector('#scr-v2-fes-lobby .v2-facesbtn').click();
    assert(sheet.classList.contains('is-open'), '「いま部屋にいる人」を押すと名簿が開く');
    assert(doc.querySelector('#scr-v2-fes-lobby > .v2-scrim:not(.is-dlg)').classList.contains('is-open'), 'うしろの幕も開く');
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!sheet.classList.contains('is-open'), 'ESC で名簿がとじる');
    assertEqual(doc.querySelector('.screen.active').id, 'scr-v2-fes-lobby', '後ろの画面は動かない');
    win.V2Screens.parts({ world: 'wait' });
    win.goToScreen('scr-v2-parts');
    const dlg = doc.querySelector('[data-v2-id="v2PartsDlg"]');
    win.V2.open(dlg);
    doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(dlg.classList.contains('is-open'), '確認の枠は ESC ではとじない（押し間違いで消えると困る）');
    doc.querySelector('#scr-v2-parts > .v2-scrim.is-dlg').click();
    assert(dlg.classList.contains('is-open'), '確認の枠は、外を押してもとじない');
    win.close();
  });

  await r.test('長押しは 0.45秒。演出「なし」でも変わらない（押す人の手の時間）', async () => {
    for (const fxSkip of [false, true]) {
      const { win, doc } = await launch({ fxSkip });
      const view = SCENES.view('fes-lobby', { n: 3 });
      view.joinUrl = 'x';
      win.V2Screens.fesLobby(view);
      win.goToScreen('scr-v2-fes-lobby');
      const nx = doc.querySelector('#scr-v2-fes-lobby .v2-nx');
      const sheet = doc.querySelector('[data-v2-id="' + nx.getAttribute('data-v2-lp').slice(1) + '"]');
      nx.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      await sleep(win, 300);
      assert(!sheet.classList.contains('is-open'), (fxSkip ? 'なし' : 'ふつう') + '：0.3秒ではまだ開かない');
      await sleep(win, 250);
      assert(sheet.classList.contains('is-open'), (fxSkip ? 'なし' : 'ふつう') + '：0.45秒で、そのゲームのルールが開く');
      assertEqual(win.V2.LP_MS, 450, '長押しの長さは 450ms');
      win.close();
    }
  });

  await r.test('書体と字の決まり：M PLUS 1 と League Spartan を読み込み、字の箱を詰める・折ってよい所だけで折る', async () => {
    // 指示66-2：2つの書体はアプリのサーバーから配る（会場の通信が弱くても字が変わらない）。Google Fonts には頼らない
    assert(/<link rel="stylesheet" href="fonts\/fonts\.css">/.test(HTML), '書体は public/fonts/fonts.css から読む');
    assert(!/family=M\+PLUS\+1|family=League\+Spartan/.test(HTML), 'M PLUS 1 と League Spartan を Google Fonts から読まない');
    const FCSS = fs.readFileSync(path.join(R, 'public', 'fonts', 'fonts.css'), 'utf8');
    const faces = (FCSS.match(/@font-face\{[^}]*\}/g) || []);
    ['M PLUS 1|700', 'M PLUS 1|800', 'M PLUS 1|900', 'League Spartan|800', 'League Spartan|900'].forEach((k) => {
      const [fam, w] = k.split('|');
      assert(faces.some((f) => f.indexOf('"' + fam + '"') >= 0 && f.indexOf('font-weight:' + w + ';') >= 0), 'v2 が使う太さの書体がある：' + k);
    });
    faces.forEach((f) => { const u = /url\(([^)]+)\)/.exec(f)[1]; assert(fs.existsSync(path.join(R, 'public', 'fonts', u)), '書体のファイルがある：' + u); });
    // アプリの字は全部、どれかの束に入っている（字を足したのに書体を作り直し忘れると、その字だけ端末の書体になる）
    const { execFileSync } = require('child_process');
    let 照合 = '';
    try { 照合 = execFileSync(process.execPath, [path.join(R, 'tools', 'gen-fonts.js'), '--check'], { encoding: 'utf8' }); }
    catch (e) { 照合 = String(e.stdout || '') + String(e.stderr || ''); }
    assert(/✔ アプリの字は全部、書体の束にある/.test(照合), 'アプリの字が書体の束にそろっている（node tools/gen-fonts.js で作り直す）：' + 照合.trim().split('\n').pop());
    assert(/Yuji\+Syuku/.test(HTML), '人狼の筆（Yuji Syuku）は残っている');
    assert(/\.v2 \*\{text-box:trim-both cap alphabetic;\}/.test(V2CSS), '字の箱を詰める決まりは1か所（.v2 *）');
    assert(/word-break:keep-all;overflow-wrap:anywhere;line-break:strict/.test(V2CSS), '改行：keep-all・anywhere・strict');
    // 詰めた箱で overflow:hidden を使うと、字の頭と足が欠ける。v2 の節に hidden で字を切る所が無いこと
    const 欠ける = cssRules(V2CSS).filter((x) => /text-overflow/.test(x.body) && /overflow(-y)?\s*:\s*hidden/.test(x.body)).map((x) => x.sel);
    assertEqual(欠ける.join('・'), '', '字の頭と足を切る overflow:hidden');
    // BudouX の写しが本物と同じ（tools/gen-budoux.js が書き出したもの）
    require('../public/js/budoux-ja.js');
    let real = null;
    try { real = new (require(path.join(R, 'node_modules', 'budoux', 'dist', 'parser.js')).Parser)(require(path.join(R, 'node_modules', 'budoux', 'dist', 'data', 'models', 'ja.js')).model); } catch (e) {}
    const 文 = ['出題者がお題を、言葉だけで説明する', 'コードを全部切ればみんなの勝ち', '参加者を待っています…'];
    文.forEach((t) => {
      const mine = globalThis.BudouxJa.parse(t);
      assertEqual(mine.join(''), t, '切っても元の文にもどる');
      if (real) assertEqual(mine.join('|'), real.parse(t).join('|'), '本物の BudouX と同じ切れ目：' + t);
    });
  });

  await r.test('ゲームの印は9つの世界ぶんそろい、題字の画像のファイルがある', async () => {
    // 題字の画像を置き忘れたまま、部品の見本の印が「壊れた画像」で出ていた（指示66-1 の途中で踏んだ）。
    // check.js も撮る道具も、画像が読めないことは数えない——ここでファイルがあることを見る
    const V2 = require('../public/js/v2-kit.js');
    // 待合（wait）はゲームではないので印が無い。ゲームの世界9つに印がある
    const 空 = V2.WORLDS.filter((w) => w !== 'wait' && !V2.emblem(w));
    assertEqual(空.join('・'), '', '印が空の世界');
    const 画像 = [];
    V2.WORLDS.forEach((w) => { const m = /src="([^"]+)"/.exec(V2.emblem(w)); if (m) 画像.push(m[1]); });
    assert(画像.length >= 1, '題字の画像を使う印がある（あれそれどれこれ）');   // 型(b)
    const 無い = 画像.filter((src) => !fs.existsSync(path.join(R, 'public', src)));
    assertEqual(無い.join('・'), '', 'public/ に無い画像');
  });

  await r.test('縦の英字は、画面いっぱいの塗り（幕）より上・TV では端から少し内側', async () => {
    const z = (sel) => { const x = cssRules(V2CSS).find((y) => y.sel === sel); const m = x && /z-index:(\d+)/.exec(x.body); return m ? +m[1] : null; };
    assert(z('.v2 .v2-brand') > z('.v2 .v2-scrim'), 'スマホの縦の字は幕より上');
    assert(z('.v2 .v2-tbrand') > 3, 'TV の縦の字は中身より上');
    const tb = cssRules(V2CSS).find((y) => y.sel === '.v2 .v2-tbrand');
    assert(/right:60px/.test(tb.body), 'TV の縦の字は端ぴったりにしない（安全な枠の近く）');
    assert(/mix-blend-mode:difference/.test(tb.body), 'どの色の上でも読める合成');
  });

  r.finish();
})();
