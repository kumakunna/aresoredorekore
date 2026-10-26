// tests/soroe-logic.js — 「そろえて発射」の高さ・点・時計合わせの計算（指示68-4）
const { createRunner, assert, assertEqual } = require('./harness');
const L = require('../public/js/soroe-logic');

(async function main() {
  const r = createRunner('soroe-logic：そろえて発射の高さと点（指示68-4）');

  await r.test('高さ：0.05秒以内は宇宙100・0.10は月70・0.20は雲の上40・0.40はビルの上20・それより大きいとぽてっ5', async () => {
    assertEqual([0, 50, 51, 100, 200, 400, 401, 3000].map((s) => L.heightOf(s).id + L.heightOf(s).points).join(' '),
      'space100 space100 moon70 moon70 cloud40 building20 plop5 plop5', '差の境目');
  });

  await r.test('そろい＝いちばん早い人といちばん遅い人の差。押さなかった人は数えない。最後の回は2倍', async () => {
    const ids = ['a', 'b', 'c', 'd'];
    let x = L.scoreRound({ a: 1000, b: 1030, c: 1080, d: 1012 }, ids);
    assertEqual(x.spread + '/' + x.height + '/' + x.points, '80/moon/70', '差 80ms は月');
    assertEqual(x.together, true, '全員が押して 0.10秒以内なら「全員そろった！」');
    assertEqual(x.dots.join(','), '0,12,30,80', '点は最初の人からのミリ秒を並べただけ（名前なし）');
    x = L.scoreRound({ a: 1000, b: 1040, c: 1030 }, ids, true);
    assertEqual(x.spread + '/' + x.points + '/' + x.together, '40/200/false', '押さなかった d は数えない・2倍・全員ではないので「そろった」ではない');
  });

  await r.test('押した人が半分より少ない回は飛ばない（やり直しなし）。1人だけの回も飛ばない（差0で宇宙にしない）', async () => {
    assertEqual(L.scoreRound({ a: 1000 }, ['a', 'b', 'c']).flew, false, '3人中1人');
    assertEqual(L.scoreRound({ a: 1000, b: 1010 }, ['a', 'b', 'c', 'd']).flew, true, '4人中2人（ちょうど半分）は飛ぶ');
    const one = L.scoreRound({ a: 1000 }, ['a', 'b']);
    assertEqual(one.flew + '/' + one.points, 'false/0', '2人中1人は「半分」だが、1人ではそろいが測れないので飛ばない');
  });

  await r.test('5回の合図：カウント → 3・2で消える → せーの → 速いカウント → せーの（2倍）', async () => {
    assertEqual(L.ROUNDS.map((x) => x.signal + (x.double ? '×2' : '')).join(' '), 'count fade seeno count seeno×2', '指示書どおり');
    assert(L.ROUNDS[3].step < L.ROUNDS[0].step, '4回目は速いカウント');
    assertEqual(L.zeroAt(L.ROUNDS[2], 5000), null, 'せーのの回は 0 が無い');
    assertEqual(L.zeroAt(L.ROUNDS[0], 5000), 5000 + L.RULES.LEAD_MS + 3000, 'カウントの 0 の時刻');
  });

  await r.test('時計のずれ：往復がいちばん短かった回を使う（行きと帰りの遅れが同じとみなせる回）', async () => {
    // 端末は サーバー − 2000ms。1回目は行き10・帰り200（往復が長い）、2回目は行き20・帰り20
    const s = [{ t0: 0, server: 2010, t1: 210 }, { t0: 1000, server: 3020, t1: 1040 }];
    const o = L.offsetOf(s);
    assertEqual(o.rtt, 40, '往復の短い回');
    assertEqual(o.offset, 2000, 'ずれ（サーバー − 端末）');
    assertEqual(L.offsetOf([]), null, 'たずねていなければ決まらない');
  });

  await r.test('人数：端末の表（GAMES・MODES）とサーバーの RULES が一対（食い違うと、押せるのに始まらない）', async () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const g = /\{ id:'soroe',\s+title:'[^']+',\s+icon:'[^']+', sub:'[^']+', maxPlayers:(\d+) \}/.exec(html);
    assert(g, 'GAMES の soroe を読めた');
    assertEqual(+g[1], L.RULES.MAX_PLAYERS, 'GAMES の上限');
    const m = /\{id:"soroe".*?game:'soroe', minPlayers:(\d+), maxPlayers:(\d+)/.exec(html);
    assert(m, 'MODES の soroe を読めた');
    assertEqual(+m[1] + '〜' + m[2], L.RULES.MIN_PLAYERS + '〜' + L.RULES.MAX_PLAYERS, 'MODES の下限と上限');
  });

  r.finish();
})();
