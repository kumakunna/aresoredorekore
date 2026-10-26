// tests/pittari-logic.js — 「ぴったり10秒」の点と時間の決め方（指示68-4 門2）
//
// 点の決め方は public/js/pittari-logic.js の1か所だけ。同じ差・2倍・押さなかった人・ありえない値・称号
const { createRunner, assert, assertEqual } = require('./harness');
const L = require('../public/js/pittari-logic');

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const 点 = (r) => ids.map((id) => r.points[id]).join(',');

(async function main() {
  const r = createRunner('pittari-logic：ぴったり10秒の点（指示68-4）');

  await r.test('門2：近い順に5・4・3・2・1点、6位から0点。差は100分の1秒で比べ、同じなら同じ順位', async () => {
    let x = L.scoreRound({ a: 10000, b: 10120, c: 9850, d: 10300, e: 11000, f: 8000, g: 12500 }, 10, ids);
    assertEqual(点(x), '5,4,3,2,1,0,0', '近い順');
    x = L.scoreRound({ a: 10120, b: 9880, c: 10004, d: 9996 }, 10, ids);
    // c と d は差 4ms・-4ms → どちらも 0.00秒（100分の1秒で同じ）＝同じ1位。a と b も ±0.12 で同じ3位
    assertEqual(点(x), '3,3,5,5,0,0,0', '同じ差は同じ順位（1位2人・3位2人）');
    assertEqual(x.perfect.sort().join(','), 'c,d', '0.00秒の人');
  });

  await r.test('門2：最後の回は2倍・押さなかった人は記録なしで0点・ありえない値は数えない', async () => {
    let x = L.scoreRound({ a: 20050, b: 19000 }, 20, ids, true);
    assertEqual(点(x), '10,8,0,0,0,0,0', '2倍（押さなかった c〜g は0点）');
    assertEqual(x.rows.length, 2, '押さなかった人は記録に入れない');
    x = L.scoreRound({ a: -5, b: 30001, c: 'x', d: 10000 }, 10, ids);
    assertEqual(点(x), '0,0,0,5,0,0,0', 'ありえない値（0より小さい・目標＋10秒より大きい・数でない）は数えない');
    assert(L.validMs(0, 10) && L.validMs(20000, 10) && !L.validMs(20001, 10) && !L.validMs(-1, 10), '受け取れる範囲は 0〜目標＋10秒');
  });

  await r.test('差の字：「+0.12秒」「-1.05秒」「±0.00秒」', async () => {
    assertEqual([120, -1050, 0].map(L.diffText).join(' '), '+0.12秒 -1.05秒 ±0.00秒', '形');
    assertEqual(L.roundDiff(10006, 10), 10, '100分の1秒にまるめる');
  });

  await r.test('5回の目標：10 → 5 → 15 → 10（時計が見えない）→ 20（2倍）', async () => {
    assertEqual(L.ROUNDS.map((t) => t.target + (t.show ? '' : '見えない') + (t.double ? '×2' : '')).join(' '), '10 5 15 10見えない 20×2', '指示書どおり');
  });

  await r.test('時計は端末の中：出した時から押した時まで（2回押しても最初の値）', async () => {
    const sw = new L.Stopwatch();
    assertEqual(sw.stop(500), null, '始まる前は測らない');
    sw.start(1000);
    sw.start(1300);   // 2回目の start は無視（描き直しで頭から測り直さない）
    assertEqual(sw.stop(11012), 10012, '1000 → 11012 で 10012ms');
    assertEqual(sw.stop(12000), 10012, '2回目の stop は最初の値のまま');
  });

  await r.test('結果：点の順位・称号（ぴったりの人・体内時計の名人＝5回とも押して差の合計がいちばん小さい）', async () => {
    const R = (stops, t, dbl) => L.scoreRound(stops, t, ['a', 'b', 'c'], dbl);
    const H = [R({ a: 10000, b: 10200, c: 9500 }, 10), R({ a: 5300, b: 5100 }, 5), R({ a: 15100, b: 15050, c: 15000 }, 15, true)];
    const res = L.finalResult(H, ['a', 'b', 'c']);
    assertEqual(res.ranking.map((x) => x.id + x.score + '/' + x.rank).join(' '), 'b17/1 a15/2 c13/3', '点の順位（a 5+4+6・b 4+5+8・c 3+0+10）');
    assertEqual(res.awards.perfect.sort().join(','), 'a,c', 'ぴったりの人（0.00秒を1回でも）');
    assertEqual(res.awards.master.join(','), 'b', '体内時計の名人（3回とも押した a と b のうち、差の合計が小さい b。c は1回押していない）');
  });

  await r.test('人数：端末の表（GAMES・MODES）とサーバーの RULES が一対（食い違うと、押せるのに始まらない）', async () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const g = /\{ id:'pittari',\s+title:'[^']+',\s+icon:'[^']+', sub:'[^']+', maxPlayers:(\d+) \}/.exec(html);
    assert(g, 'GAMES の pittari を読めた');
    assertEqual(+g[1], L.RULES.MAX_PLAYERS, 'GAMES の上限');
    const m = /\{id:"pittari".*?game:'pittari', minPlayers:(\d+), maxPlayers:(\d+)/.exec(html);
    assert(m, 'MODES の pittari を読めた');
    assertEqual(+m[1] + '〜' + m[2], L.RULES.MIN_PLAYERS + '〜' + L.RULES.MAX_PLAYERS, 'MODES の下限と上限');
  });

  r.finish();
})();
