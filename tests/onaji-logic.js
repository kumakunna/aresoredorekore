// tests/onaji-logic.js — 「みんなと同じ」の点の決め方（指示68-3 門2）
//
// 3つのモード × 並んだ時・全員ちがう時・選ばなかった人。点の決め方は public/js/onaji-logic.js の1か所だけ
const { createRunner, assert, assertEqual } = require('./harness');
const L = require('../public/js/onaji-logic');

const ids = ['a', 'b', 'c', 'd', 'e'];
const 点 = (r) => ids.map((id) => r.points[id]).join('');

(async function main() {
  const r = createRunner('onaji-logic：みんなと同じの点（指示68-3）');

  await r.test('門2 多い方：いちばん多い答えの人に1点・並んだら並んだ答えの人全員・全員ちがうなら「ばらばら」でだれも点なし・選ばなかった人は0点', async () => {
    let x = L.scoreRound('many', 3, { a: 0, b: 0, c: 0, d: 1, e: 2 }, ids);
    assertEqual(点(x), '11100', 'いちばん多い答え（3人）の人に1点');
    assertEqual(x.counts.join(','), '3,1,1', '答えごとの人数');
    x = L.scoreRound('many', 4, { a: 0, b: 0, c: 1, d: 1, e: 2 }, ids);
    assertEqual(点(x), '11110', '2人と2人で並んだら、並んだ答えの人全員');
    assertEqual(x.winners.join(','), '0,1', '並んだ答えが2つ');
    x = L.scoreRound('many', 4, { a: 0, b: 1, c: 2, d: 3 }, ids);
    assertEqual(x.scatter, true, '全員ちがう答え＝ばらばら');
    assertEqual(点(x), '00000', 'ばらばらなら、だれも点なし（選ばなかった e も0点）');
    x = L.scoreRound('many', 3, { a: 1, b: 1 }, ids);
    assertEqual(点(x), '11000', '選ばなかった人（c・d・e）は0点');
    x = L.scoreRound('many', 3, {}, ids);
    assertEqual(点(x) + x.winners.length, '000000', 'だれも選ばなければ、だれも点なし');
  });

  await r.test('門2 少ない方：いちばん少ない答え（だれも選ばなかった答えはのぞく）の人に1点・並んだら全員・ばらばらは点なし', async () => {
    let x = L.scoreRound('few', 4, { a: 0, b: 0, c: 0, d: 1, e: 1 }, ids);
    assertEqual(点(x), '00011', '少ない答え（2人）の人に1点（だれも選ばなかった答えはのぞく）');
    x = L.scoreRound('few', 4, { a: 0, b: 0, c: 0, d: 1, e: 2 }, ids);
    assertEqual(点(x), '00011', '1人と1人で並んだら、並んだ答えの人全員');
    x = L.scoreRound('few', 4, { a: 0, b: 1, c: 2, d: 3 }, ids);
    assertEqual(x.scatter + 点(x), 'true00000', 'ばらばらなら点なし');
    x = L.scoreRound('few', 3, { a: 0, b: 0, c: 1, d: 1 }, ids);
    assertEqual(点(x), '11110', '2人と2人で並んだら、並んだ答えの人全員（e は選ばなかったので0点）');
  });

  await r.test('門2 一致団結：点は付けず、そろい度＝いちばん多い答えの人数÷全員（選ばなかった人も数える）。全員そろったら together', async () => {
    let x = L.scoreRound('team', 3, { a: 0, b: 0, c: 0, d: 0, e: 0 }, ids);
    assertEqual(x.together, true, '全員そろった');
    assertEqual(x.ratio, 1, 'そろい度 100%');
    assertEqual(点(x), '00000', '一致団結は点を付けない');
    x = L.scoreRound('team', 3, { a: 0, b: 0, c: 0, d: 1 }, ids);
    assertEqual(x.ratio, 3 / 5, '選ばなかった e も分母に入る（3÷5）');
    assertEqual(x.together, false, '全員ではない');
  });

  await r.test('結果：順位（同点は同じ順位）・称号2つ（みんなと同じ・ひとりだけ）・一致団結は順位を出さずそろい度だけ', async () => {
    const H = [
      Object.assign({ answers: { a: 0, b: 0, c: 1, d: 0 } }, L.scoreRound('many', 3, { a: 0, b: 0, c: 1, d: 0 }, ['a', 'b', 'c', 'd'])),
      Object.assign({ answers: { a: 1, b: 1, c: 2, d: 1 } }, L.scoreRound('many', 3, { a: 1, b: 1, c: 2, d: 1 }, ['a', 'b', 'c', 'd'])),
      Object.assign({ answers: { a: 0, b: 2, c: 1, d: 0 } }, L.scoreRound('many', 3, { a: 0, b: 2, c: 1, d: 0 }, ['a', 'b', 'c', 'd']))
    ];
    const res = L.finalResult('many', H, ['a', 'b', 'c', 'd']);
    const 順 = res.ranking.map((x) => x.id + x.score + '/' + x.rank).join(' ');
    assertEqual(順, 'a3/1 d3/1 b2/3 c0/4', '点の多い順・同点は同じ順位（' + 順 + '）');
    assertEqual(res.awards.same.join(','), 'a,d', 'いちばんみんなと同じだった人');
    assertEqual(res.awards.solo.join(','), 'c', 'ひとりだけの答えをいちばん多く出した人');
    const team = L.finalResult('team', H, ['a', 'b', 'c', 'd']);
    assertEqual(team.ranking, undefined, '一致団結は順位を出さない');
    assert(team.sync > 0 && team.sync <= 100, 'そろい度（' + team.sync + '）');
  });

  await r.test('人数：端末の表（GAMES・MODES）とサーバーの RULES が一対（食い違うと、押せるのに始まらない）', async () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const g = /\{ id:'onaji',\s+title:'[^']+',\s+icon:'[^']+', sub:'[^']+', maxPlayers:(\d+) \}/.exec(html);
    assert(g, 'GAMES の onaji を読めた');
    assertEqual(+g[1], L.RULES.MAX_PLAYERS, 'GAMES の上限');
    const ms = Array.from(html.matchAll(/\{id:"onaji-\w+".*?game:'onaji', minPlayers:(\d+), maxPlayers:(\d+)/g));
    assertEqual(ms.length, L.MODES.length, 'モードの数（' + ms.length + '）');
    ms.forEach((m) => {
      assertEqual(+m[1], L.RULES.MIN_PLAYERS, 'MODES の下限');
      assertEqual(+m[2], L.RULES.MAX_PLAYERS, 'MODES の上限');
    });
  });

  r.finish();
})();
