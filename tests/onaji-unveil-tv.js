// tests/onaji-unveil-tv.js — みんなと同じの「開く」（TV）を台本どおりに（指示68-S 2）
//
// 台本：0〜0.75 ため（札が横に並び、人数はまだ出さない）→ 0.75〜2.25 1人1つの玉が選んだ札に落ちて積み上がる（人数は1ずつ）
// → 2.25 いちばん高い山にスポットライトと冠 → 3.0 冠の山の玉が名前の札に変わる。ひとりだけの時は名前を大きく1枚。全部で6秒以内。
// 門4：開く前（選んでいる間）は、玉も人数も画面に無い（届いていない物からは描けない）。
// 見本は本物の進行役（onaji-room.js）を動かして作る（tools/v2-lab/onaji-scenes.js・落とし穴25）

const { createRunner, assert, assertEqual, launch } = require('./harness');
const S = require('../tools/v2-lab/onaji-scenes.js');

/** 見本の部屋の知らせを、TV が描く形（view）にする */
function viewOf(id, o) {
  const v = S.view(id, o || {});
  return { data: v.room.state.data, members: v.room.members, meId: 'tv', you: {}, fes: null, game: 'onaji', code: v.room.code };
}
function 描く(win, view) {
  const box = win.document.createElement('div');
  box.className = 'screen v2';
  box.innerHTML = win.V2Onaji.tv(view);
  win.document.body.appendChild(box);
  return box;
}

(async function main() {
  const r = createRunner('onaji-unveil-tv：みんなと同じの開く（TV・指示68-S の台本）');
  const t = await launch({ fakeSocket: true });
  const W = t.win;

  await r.test('門4：選んでいる間の TV に、玉も人数も無い（開いてから届く「答えごとの名前」だけで描く）', async () => {
    const v = viewOf('onaji-tv-choose16');
    assertEqual(v.data.reveal, null, '選んでいる間の知らせに、開いた中身は入っていない');
    const box = 描く(W, v);
    assertEqual(box.querySelectorAll('.v2-oball, .v2-ocn, .v2-otag').length, 0, '玉・人数・名前の札は無い');
    box.remove();
  });

  await r.test('16人：玉は1人1つ・選んだ札の上に、その人の印。人数の字は最後に人数と同じ', async () => {
    const v = viewOf('onaji-tv-unveil16');
    const rv = v.data.reveal, box = 描く(W, v);
    const cols = Array.from(box.querySelectorAll('.v2-ocol'));
    assertEqual(cols.length, rv.choices.length, '札は選択肢の数');
    assertEqual(box.querySelectorAll('.v2-oball').length, 16, '玉は16個');
    cols.forEach((c, k) => {
      assertEqual(c.querySelectorAll('.v2-oball').length, rv.counts[k], KEYS(k) + 'の山の玉＝人数');
      assertEqual(c.querySelector('.v2-ocn.is-last').textContent, String(rv.counts[k]), KEYS(k) + 'の最後の字＝人数');
    });
    const 顔 = {}; v.members.forEach((m) => { 顔[m.name] = m.icon; });
    const 山0 = Array.from(cols[0].querySelectorAll('.v2-oball')).map((b) => b.textContent);
    assertEqual(山0.join(''), rv.names[0].map((n) => 顔[n]).join(''), '玉はその人の印');
    assertEqual(box.querySelectorAll('.v2-onames').length, 0, '下に並べていた名前のチップは無い');
    const 札 = Array.from(box.querySelectorAll('.v2-otag')).map((x) => x.querySelector('.v2-cut').textContent);
    assertEqual(札.sort().join(','), rv.crowned.slice().sort().join(','), '名前の札は冠の山の人だけ');
    assertEqual(box.querySelectorAll('.v2-ocrown2').length, rv.winners.length, '冠はいちばん高い山に');
    box.remove();
  });

  await r.test('時間割：ため0.75秒は人数を出さない → 玉は2.25秒までに落ちきる → 冠2.25 → 名前3.0 → 6秒以内', async () => {
    ['onaji-tv-unveil16', 'onaji-tv-unveil', 'onaji-tv-solo', 'onaji-tv-team', 'onaji-tv-scatter'].forEach((id) => {
      const v = viewOf(id), tl = W.V2Onaji.timeline(v);
      assert(tl.drops.length > 0, id + '：玉がある');
      assert(tl.drops.every((o) => o.at >= 0.75 - 1e-9), id + '：玉は ため のあと');
      assert(Math.max.apply(null, tl.drops.map((o) => o.land)) <= 2.25 + 1e-9, id + '：2.25秒までに落ちきる');
      assertEqual([tl.crown, tl.tags].join(','), '2.25,3', id + '：冠と名前の時刻');
      assert(tl.end <= 6, id + '：全部で6秒以内（' + tl.end + '）');
      // 人数の字：最初の字は、その山の最初の玉が落ちた時から（ため の間は出ない）
      const box = 描く(W, v);
      box.querySelectorAll('.v2-ocn').forEach((n) => {
        const d = n.getAttribute('style') || '';
        if (n.classList.contains('is-last')) assert(/animation-duration:calc\((\d|\.)/.test(d), id + '：最後の字は落ちるまで隠す');
      });
      box.remove();
    });
  });

  await r.test('ひとりだけ：その1人の名前を大きく1枚（一致団結・ばらばらは冠も名前の札も無く、帯）', async () => {
    const solo = 描く(W, viewOf('onaji-tv-solo'));
    assert(W.V2Onaji.timeline(viewOf('onaji-tv-solo')).solo, 'ひとりだけの回');
    assertEqual(solo.querySelectorAll('.v2-otags.is-solo .v2-otag').length, 1, '名前の札は1枚・大きく');
    solo.remove();
    ['onaji-tv-team', 'onaji-tv-scatter'].forEach((id) => {
      const b = 描く(W, viewOf(id));
      assertEqual(b.querySelectorAll('.v2-otag, .v2-ocrown2').length, 0, id + '：冠も名前の札も無い');
      assert(b.querySelector('.v2-oban-at .v2-oban'), id + '：帯');
      b.remove();
    });
  });

  t.win.close();
  await r.test('68-S の残り4：名前の札の「+1点！」が、となりや上の段の札に重ならない（段の間 60px・上がるのは少しだけ）', async () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 指示71 追記2l：52px・top -44px では上の段の札とのすき間が 1.4px しかなく、端末によって重なった（11/4 の検査レポート）
    // → 60px・top -38px（すき間 15.5px・tools/onaji-plus-overlap.js で 8px 未満を赤にして測る）
    assert(/\.v2 \.v2-otags\{[^}]*gap:60px 22px;/.test(css), '段の間は「+1点！」が入る 60px');
    assert(/\.v2 \.v2-otag \.v2-oplus\{position:absolute;right:-6px;top:-38px;line-height:1;/.test(css), '「+1点！」は札のすぐ上（段の間の中）');
    assert(css.indexOf('@keyframes v2-oplus{0%{opacity:0;transform:translateY(12px);}25%{opacity:1;transform:none;}75%{opacity:1;}100%{opacity:0;transform:translateY(-6px);}}') !== -1, '上がるのは少しだけ（上の段にかからない）');
    // 実際の重なり（止めた時計で 2.8〜4.2秒・8人と16人）は 10/31 に測って0（直す前は 8人で2か所・16人で9か所）
  });

  await r.test('指示76 2-6（A9）：冠は勝った答えの札の上（人の札の横に浮かない・名前の札の下にもぐらない）。名前の札の場所は、ほかの答えの玉の山より上だけ', async () => {
    const t2 = await launch({ fakeSocket: true });
    ['onaji-tv-unveil16', 'onaji-tv-solo', 'onaji-tv-unveil16-14'].forEach((id) => {
      const v = viewOf(id), rv = v.data.reveal;
      const box = 描く(t2.win, v);
      const cols = Array.from(box.querySelectorAll('.v2-ocol'));
      rv.winners.forEach((k) => {
        assert(cols[k].querySelector('.v2-ocard .v2-ocrown2'), id + '：' + KEYS(k) + ' の冠は答えの札の上');
      });
      assertEqual(box.querySelectorAll('.v2-opile .v2-ocrown2').length, 0, id + '：玉の山の中に冠を置かない');
      // ほかの答えの玉の山の段の数（--lp）。名前の札の場所の下の端は、その段の上（CSS は .has-otags）
      const per = Math.max(1, Math.floor(((1728 - 28 * (cols.length - 1)) / cols.length - 6) / 94));
      let lp = 1;
      cols.forEach((c, k) => { if (rv.winners.indexOf(k) === -1) lp = Math.max(lp, Math.ceil(rv.counts[k] / per)); });
      const stg = box.querySelector('.v2-ostg');
      assert(stg.classList.contains('has-otags'), id + '：名前の札がある印');
      assertEqual(stg.style.getPropertyValue('--lp').trim(), String(lp), id + '：玉の山の段の数');
      box.remove();
    });
    t2.win.close();
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(css.indexOf('.v2 .v2-ounv.is-tv .v2-ostg.has-otags .v2-otags{bottom:calc(218px + var(--lp) * 94px);align-content:end;}') !== -1, '名前の札の場所の下の端を、玉の山の上に');
  });
  r.finish();
})();

function KEYS(k) { return 'ABCD'.charAt(k); }
