// tests/result-reveal.js — 結果の見せ場（Claude チャットの台本・くまくん 10/31）
//
// 順位のあるゲーム（ぴったり10秒・みんなと同じ・クイズ王2）の終わり。TV：
//   0〜0.8 少し暗く → 0.8〜2.0 下の順位から1行ずつ下から（1行0.2秒・多い時は詰める）→ 2.0〜2.8 1位の所が空いて光る・短いドラムロール →
//   2.8 1位の名前が大きく・冠・紙ふぶき・決まった音。全部で4秒以内。演出「なし」は最後の形がすぐ。
// スマホ：TV がいる部屋では、TV で1位が出る時刻（2.8秒）まで順位・自分の点・賞を出さない。TV の大きな祝いは出さない（見せ場が祝う）
// 部品は1か所（V2.rankRevealHtml）を3つのゲームが使う（写しを持たない・落とし穴1）。見本は本物の進行役で作る（落とし穴25）
const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');
const H = require('./harness');
const ButtonScenes = require('../tools/v2-lab/button-scenes');
const OnajiScenes = require('../tools/v2-lab/onaji-scenes');
const Quiz2Scenes = require('../tools/v2-lab/quiz2-scenes');

const act = (doc) => (doc.querySelector('.screen.active') || {}).id;
async function 場面(lab, screen, me) {
  const t = await launch({ fakeSocket: true });
  const room = JSON.parse(JSON.stringify(lab.room));
  t.win.__rtFake.replies = { 'room:create': () => ({ ok: true, code: room.code, memberId: me, room }) };
  await H.makeRoomV2(t.win, t.doc);
  t.win.__rtFake.fire('room:update', room);
  if (me !== 'tv' && lab.you) t.win.__rtFake.fire('wolf:you', lab.you);
  await waitFor(t.win, () => act(t.doc) === screen, 3000, screen);
  return t;
}

(async function main() {
  const r = createRunner('result-reveal：結果の見せ場（10/31 の台本）');
  const W = await launch();
  const V2 = W.win.V2;
  W.doc = W.doc || W.win.document;

  await r.test('TV：下の順位から 0.8秒〜2.0秒に1行ずつ（1行0.2秒より短く詰める）・1位は 2.8秒・冠・暗くする幕がある・全部で4秒以内', async () => {
    const lab = ButtonScenes.view('pt-tv-result16');
    const box = W.doc.createElement('div'); box.className = 'screen v2 v2-tv'; W.doc.body.appendChild(box);
    box.innerHTML = W.win.V2Pittari.tv({ data: lab.room.state.data, members: lab.room.members, meId: 'tv', you: {}, fes: { inset: 0 }, end: 0 });
    const list = box.querySelector('.v2-oranks.is-reveal');
    assert(list, '見せ場の印がある');
    assert(list.querySelector('.v2-rkdim'), '少し暗くする幕');
    const rows = Array.prototype.slice.call(list.querySelectorAll('.v2-rk'));
    const top = rows.filter((x) => x.classList.contains('is-top'));
    assert(top.length >= 1 && top.every((x) => x.querySelector('.v2-rk-crown')), '1位の行に冠');
    const 秒 = (x) => +(/calc\(([\d.]+)s/.exec(x.style.animationDelay || '') || [])[1];
    const 下から = rows.filter((x) => !x.classList.contains('is-top')).reverse().map(秒);
    assertEqual(下から[0], 0.8, 'いちばん下の行は 0.8秒');
    assert(下から.every((v, i) => i === 0 || v > 下から[i - 1]), '下の順位から順に');
    assert(下から[下から.length - 1] <= 2.0, '2.0秒までに出そろう（' + 下から[下から.length - 1] + '）');
    assertEqual(V2.RANK_TL.top, 2.8, '1位は 2.8秒');
    assert(V2.RANK_TL.end <= 4, '全部で4秒以内');
    box.remove();
  });

  await r.test('みんなと同じ・クイズ王2 も同じ部品（V2.rankRevealHtml）を使う', async () => {
    for (const [mod, lab] of [[W.win.V2Onaji, OnajiScenes.view('onaji-tv-result16')], [W.win.V2Quiz2.haya, Quiz2Scenes.view('qh-tv-ended16')], [W.win.V2Quiz2.near, Quiz2Scenes.view('qn-tv-ended16')]]) {
      const html = mod.tv({ data: lab.room.state.data, members: lab.room.members, meId: 'tv', you: {}, fes: { inset: 0 }, end: 0 });
      assert(/v2-oranks is-reveal/.test(html) && /v2-rk-crown/.test(html), lab.screen + '：見せ場の印と冠');
    }
  });

  await r.test('スマホ：TV がいる部屋では、順位・自分の点・賞は TV の1位（2.8秒）まで出さない。文化祭の結果の画面（描き直し）では待たない', async () => {
    const lab = ButtonScenes.view('pt-result');
    const t = await 場面(lab, 'scr-v2-pittari', lab.meId);
    const list = t.doc.querySelector('#scr-v2-pittari .v2-oranks');
    assertEqual(+list.getAttribute('data-tvat'), 2.8, '順位は 2.8秒');
    assert(list.classList.contains('is-tvwait'), 'まだ見えない');
    const aws = t.doc.querySelector('#scr-v2-pittari .v2-oaws');
    if (aws) assertEqual(+aws.getAttribute('data-tvat'), 2.8, '賞（1位の名前が出る）も 2.8秒');
    t.win.close();
    const html = W.win.V2Pittari.phone({ data: lab.room.state.data, members: lab.room.members, meId: lab.meId, you: lab.you || {}, fes: { phase: 'result' }, end: 0 });
    assert(!/data-tvat/.test(html.slice(html.indexOf('v2-oranks') - 40)), '文化祭の結果の画面では待たない（同じ中身の描き直し）');
  });

  await r.test('TV の音：2.0〜2.8秒に短いドラムロール、2.8秒に決まった音。前のファンファーレは鳴らさない。TV の大きな祝いは出さない', async () => {
    const lab = ButtonScenes.view('pt-tv-result16');
    lab.room.state.data = JSON.parse(JSON.stringify(lab.room.state.data));
    const t = await 場面(lab, 'scr-v2-pittari-tv', 'tv');
    await sleep(t.win, 3300);
    const log = t.win.sfxProbe().log.map((x) => x.id);
    assert(log.filter((x) => x === 'tick').length >= 6, 'ドラムロール（' + log.join(',') + '）');
    assert(log.indexOf('decide') !== -1, '決まった音');
    assert(log.indexOf('fanfare') === -1, 'ファンファーレは鳴らさない');
    assert(!t.doc.querySelector('.fx-cel'), '大きな祝いの幕は出ない（見せ場が1位を祝う）');
    t.win.close();
  });

  await r.test('指示76 2-2（A5）：9人以上の2列の順位は縦の順（左の列が 1〜8位・右の列が 9〜16位）。出る動き（下から・1位は最後）はそのまま', async () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const rule = (css.match(/\.v2 \.v2-otv \.v2-oranks\.is-c2\{[^}]*\}/) || [''])[0];
    assert(/grid-auto-flow:column/.test(rule) && /grid-template-rows:repeat\(var\(--rk-rows\),\s*auto\)/.test(rule), '列ごとに上から下へ並べる：' + rule);
    [[16, 8], [9, 5], [11, 6]].forEach(([n, rows]) => {
      const html = V2.rankRevealHtml({ meId: 'tv' }, Array.from({ length: n }, (_, i) => ({ id: 'm' + i, name: 'p' + i, rank: i + 1, score: 10 - i })), true, '点');
      const box = W.doc.createElement('div'); box.innerHTML = html;
      const list = box.querySelector('.v2-oranks.is-c2');
      assert(list, n + '人は2列');
      assertEqual(list.style.getPropertyValue('--rk-rows').trim(), String(rows), n + '人：左の列は ' + rows + '行');
      // 並べる順は順位の順のまま（列の中で上から）。出る遅れも前と同じ（下の順位ほど早い）
      const ranks = Array.from(list.querySelectorAll('.v2-rk .v2-rk-n')).map((x) => x.textContent);
      assertEqual(ranks.join(','), Array.from({ length: n }, (_, i) => String(i + 1)).join(','), '順位の順');
    });
  });

  W.win.close();
  r.finish();
})();
