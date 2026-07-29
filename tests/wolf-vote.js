// tests/wolf-vote.js — 投票の集計が、アプリ全体で1つのルールになっているか（第22弾-6）
//
// 直したバグ：
//   ワードウルフのウルフ1人の時だけ「過半数（50%超）の票を集めないと捕まらない」
//   という別のルールが残っていて、一番多く投票されたウルフが逃げ切ってしまっていた。
//   同じアプリの中に、多数決のルールが2つ（実装は3つ）あった。
//
// ここでは「1つになったこと」を、次の3方向から確かめる。
//   ① WolfLogic.tally が、票の割れ方を変えても常に同じ規則で動く
//   ② 人狼側の処刑（executeVote）も、同じ tally の結論をそのまま使っている
//   ③ 画面側に、独自の集計を書き直した箇所が残っていない

const fs = require('fs');
const path = require('path');
const WolfLogic = require('../public/js/wolf-logic.js');
const WolfRoom = require('../wolf-room.js');
const {
  createRunner, assert, assertEqual, assertNoErrors,
  launch, activeScreen, sleep, waitFor, waitScreen, el, click, fillPlayerForm, pickGame, holdPress
} = require('./harness');

// 「誰が誰に入れたか」の形に組み立てる。['A','A','B'] → 3人がそれぞれ A,A,B に入れた
function votesFrom(list) {
  const v = {};
  list.forEach((target, i) => { v['voter' + i] = target; });
  return v;
}

(async function main() {
  const r = createRunner('wolf-vote：投票集計の統一');

  // ---------- ① tally そのもの ----------

  await r.test('一番多く票を集めた人が処刑される（過半数は必要ない）', async () => {
    // これが今回のバグそのもの。6人で、ウルフに2票・ほかは1票ずつ。
    // 2票は過半数（4票）に遠く届かないが、単独最多なので処刑される。
    const t = WolfLogic.tally(votesFrom(['W', 'W', 'a', 'b', 'c', 'd']));
    assertEqual(t.max, 2, '最多は2票');
    assertEqual(t.executedId, 'W', '過半数に届かなくても、最多なら処刑される');
    // 古いルール（過半数を要求）なら、ここで W は逃げ切っていた
    assert(t.max < Object.keys(t.counts).reduce((n, k) => n + t.counts[k], 0) / 2,
      'この票の割れ方は、たしかに過半数に届いていない');
  });

  await r.test('過半数を集めた場合も、当然その人が処刑される', async () => {
    const t = WolfLogic.tally(votesFrom(['W', 'W', 'W', 'W', 'a']));
    assertEqual(t.executedId, 'W', '4/5票で処刑');
    assertEqual(t.tie, false, '同数ではない');
  });

  await r.test('全員が同じ人に入れたら、その人が処刑される', async () => {
    const t = WolfLogic.tally(votesFrom(['W', 'W', 'W', 'W', 'W']));
    assertEqual(t.executedId, 'W', '満場一致');
    assertEqual(t.max, 5, '5票');
  });

  await r.test('同数で並んだら、誰も処刑しない', async () => {
    const two = WolfLogic.tally(votesFrom(['a', 'a', 'b', 'b']));
    assertEqual(two.tie, true, '2人が同数');
    assertEqual(two.executedId, null, '処刑なし');
    const three = WolfLogic.tally(votesFrom(['a', 'b', 'c']));
    assertEqual(three.tie, true, '3人が1票ずつでも同数');
    assertEqual(three.executedId, null, '処刑なし');
  });

  await r.test('1票も入っていなければ、処刑なし', async () => {
    ['空', '棄権'].forEach(() => {});
    assertEqual(WolfLogic.tally({}).executedId, null, '票が無い');
    assertEqual(WolfLogic.tally({ a: null, b: undefined, c: '' }).executedId, null, '棄権だけ');
    assertEqual(WolfLogic.tally(null).executedId, null, 'そもそも渡されていない');
  });

  await r.test('棄権が混じっても、入っている票だけで数える', async () => {
    const t = WolfLogic.tally({ v1: 'a', v2: 'a', v3: null, v4: 'b' });
    assertEqual(t.counts.a, 2, 'aは2票');
    assertEqual(t.counts.b, 1, 'bは1票');
    assertEqual(t.executedId, 'a', '棄権は数に入れない');
  });

  await r.test('票の入れ方を総当たりしても、規則が崩れない', async () => {
    // 3〜7人が、3〜5人の候補にどう入れても
    //   ・max は本当の最大票数
    //   ・top は max を持つ人ぜんぶ
    //   ・executedId は「max を単独で持つ人」だけ
    // が必ず成り立つ。特定の割れ方だけ別扱いされていないことの確認。
    const names = ['a', 'b', 'c', 'd', 'e'];
    let checked = 0;
    for (let voters = 3; voters <= 7; voters++) {
      for (let cands = 2; cands <= 5; cands++) {
        const total = Math.pow(cands, voters);
        for (let n = 0; n < total; n++) {
          const list = [];
          let x = n;
          for (let i = 0; i < voters; i++) { list.push(names[x % cands]); x = Math.floor(x / cands); }
          const t = WolfLogic.tally(votesFrom(list));
          const counts = {};
          list.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
          const trueMax = Math.max.apply(null, Object.keys(counts).map(k => counts[k]));
          const winners = Object.keys(counts).filter(k => counts[k] === trueMax);
          assertEqual(t.max, trueMax, list.join(',') + '：最大票数');
          assertEqual(t.top.length, winners.length, list.join(',') + '：最多の人数');
          assertEqual(t.tie, winners.length > 1, list.join(',') + '：同数かどうか');
          assertEqual(t.executedId, winners.length === 1 ? winners[0] : null,
            list.join(',') + '：処刑される人');
          checked++;
        }
      }
    }
    assert(checked > 5000, '十分な数の割れ方を試した（' + checked + '通り）');
  });

  await r.test('「同数なら処刑なし」の境目が、人数の偶奇で変わらない', async () => {
    // 偶数人でぴったり割れる時だけ挙動が違う、という取りこぼしが無いこと
    for (let n = 2; n <= 10; n += 2) {
      const list = [];
      for (let i = 0; i < n / 2; i++) list.push('a');
      for (let i = 0; i < n / 2; i++) list.push('b');
      assertEqual(WolfLogic.tally(votesFrom(list)).executedId, null, n + '人でぴったり半々：処刑なし');
    }
    for (let n = 3; n <= 11; n += 2) {
      const list = ['a'];
      for (let i = 1; i < n; i++) list.push(i % 2 ? 'a' : 'b');
      const t = WolfLogic.tally(votesFrom(list));
      assertEqual(t.executedId, 'a', n + '人で a が1票多い：a が処刑');
    }
  });

  // ---------- ①-2 決選投票の判断（第23弾-1） ----------

  await r.test('同数なら決選投票、並んだ人だけが候補になる', async () => {
    const o = WolfLogic.voteOutcome(votesFrom(['a', 'a', 'b', 'b', 'c']));
    assertEqual(o.kind, 'runoff', '同数なので決選投票');
    assertEqual(o.candidates.slice().sort().join(','), 'a,b', '並んだ2人だけが候補');
    assertEqual(o.targetId, null, 'この時点では処刑しない');
  });

  await r.test('決選投票は1回まで。2回目の同数はそこで処刑なし', async () => {
    const votes = votesFrom(['a', 'a', 'b', 'b']);
    assertEqual(WolfLogic.voteOutcome(votes).kind, 'runoff', '1回目の同数は決選投票へ');
    const second = WolfLogic.voteOutcome(votes, { isRunoff: true });
    assertEqual(second.kind, 'none', '決選投票でも同数なら、そこで打ち切る');
    assertEqual(second.targetId, null, '誰も処刑しない');
  });

  await r.test('決着がついている投票は、決選投票に入らない', async () => {
    assertEqual(WolfLogic.voteOutcome(votesFrom(['a', 'a', 'b'])).kind, 'execute', '最多が1人なら即決');
    assertEqual(WolfLogic.voteOutcome({}).kind, 'none', '票が無ければ何もしない');
    assertEqual(WolfLogic.voteOutcome({ v1: null }).kind, 'none', '棄権だけでも決選投票にしない');
  });

  await r.test('3人以上が並んだ時も、その全員が候補になる', async () => {
    const o = WolfLogic.voteOutcome(votesFrom(['a', 'b', 'c']));
    assertEqual(o.kind, 'runoff', '3人が1票ずつでも決選投票');
    assertEqual(o.candidates.slice().sort().join(','), 'a,b,c', '3人とも候補');
  });

  // ---------- ② 人狼側も同じ結論を使っている ----------

  await r.test('人狼の処刑も、tally の結論をそのまま使う', async () => {
    const patterns = [
      ['p2', 'p2', 'p3', 'p4', 'p5'],   // p2 が2票で最多（過半数ではない）
      ['p2', 'p2', 'p3', 'p3', 'p4'],   // 同数
      ['p2', 'p2', 'p2', 'p2', 'p2']    // 満場一致
    ];
    patterns.forEach(list => {
      const game = WolfLogic.createGame({
        players: ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => ({ id, name: id })),
        counts: { wolf: 1 }, turnLimit: 3
      });
      game.phase = 'vote';
      ['p1', 'p2', 'p3', 'p4', 'p5'].forEach((id, i) => {
        if (list[i]) WolfLogic.setVote(game, id, list[i]);
      });
      const expected = WolfLogic.tally(game.votes).executedId;
      const res = WolfLogic.executeVote(game);
      assertEqual(res.executed ? res.executed.id : null, expected,
        list.join(',') + '：処刑される人が tally と一致する');
    });
  });

  await r.test('決選投票で人を指定した時だけ、集計より指定が優先される', async () => {
    const game = WolfLogic.createGame({
      players: ['p1', 'p2', 'p3', 'p4'].map(id => ({ id, name: id })),
      counts: { wolf: 1 }, turnLimit: 3
    });
    game.phase = 'vote';
    WolfLogic.setVote(game, 'p1', 'p2');
    WolfLogic.setVote(game, 'p2', 'p1');   // 同数＝本来は処刑なし
    assertEqual(WolfLogic.tally(game.votes).executedId, null, '集計では処刑なし');
    const res = WolfLogic.executeVote(game, 'p3');
    assertEqual(res.executed.id, 'p3', '指定した人が処刑される');
  });

  // ---------- ③ 画面側に別実装が残っていない ----------

  await r.test('画面側に、古い集計ルールが残っていない', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 過半数ルールで使っていた名前。復活したら、また2つのルールが並ぶことになる
    ['majorityCount', 'correctVotesAgainst', 'wolfTallyTop', 'wolfMultiCaught'].forEach(name => {
      assert(html.indexOf(name) === -1, name + ' が残っている（集計がまた分かれている可能性）');
    });
    // ワードウルフ側も、集計と「同数のときどうするか」を WolfLogic に任せている
    assert(/WolfLogic\.voteOutcome\(/.test(html), 'ワードウルフも WolfLogic.voteOutcome を呼んでいる');
  });

  await r.test('脱落者の記録も1か所だけになっている', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // wmOut（2〜ターン版）と wwExec.elim（複数ウルフ）の二重管理をやめた。
    // 二重にあると、片方だけ消し忘れて前の試合の脱落が持ち越される
    // 説明のコメントには名前が出るので、コードとして使われていないかを見る
    assert(!/play\.wmOut/.test(html), 'play.wmOut が残っている（脱落の記録が2か所ある）');
    assert(!/\.elim\[/.test(html), 'wwExec.elim が残っている（脱落の記録が2か所ある）');
    assert(/play\.wolfExecutedIds/.test(html), '脱落の記録が1か所にまとまっている');
  });

  // ---------- ④ 実際の画面で確かめる ----------
  // 上のテストは「ルールが1つになったこと」を確かめている。
  // ここでは、そのルールが本当に画面の結果まで届いているかを見る。

  // ワードウルフを、人数とウルフの人数を指定して始める（タイマーは切る）
  async function startWordwolf(win, doc, modeId, players, wolfCount, wmOpts, opts) {
    opts = opts || {};
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wordwolf');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="' + modeId + '"]'));
    click(doc, 'modeNextBtn');
    for (let i = 0; i < 8; i++) {
      const cur = activeScreen(doc);
      if (cur === 'scr-ready' || cur === 'scr-mode-rules') break;
      if (cur === 'scr-set-wolfmulti' && wmOpts) {
        const minus = doc.querySelector('#scr-set-wolfmulti [data-wmturn="-1"]');
        for (let k = 0; k < 10; k++) minus.click();
        const plus = doc.querySelector('#scr-set-wolfmulti [data-wmturn="1"]');
        for (let k = 2; k < wmOpts.turnLimit; k++) plus.click();
        if (el(doc, 'wmChangeToggle').classList.contains('on') !== !!wmOpts.changeTopic) {
          click(doc, 'wmChangeToggle');
        }
      }
      if (cur === 'scr-set-wolf' && wolfCount) {
        const sl = el(doc, 'wolfCountSlider');
        sl.value = String(wolfCount);
        sl.dispatchEvent(new win.Event('input', { bubbles: true }));
      }
      if (cur === 'scr-set-timer' && el(doc, 'timerEnableToggle').classList.contains('on')) {
        click(doc, 'timerEnableToggle');
        await sleep(win, 30);
      }
      const next = doc.querySelector('#' + cur + ' [data-wiz-next]');
      if (!next) break;
      next.click();
      await sleep(win, 30);
    }
    // ルール画面そのものを調べたい時は、ここで止める
    if (opts.stopAtRules) {
      await waitScreen(win, doc, 'scr-mode-rules', 4000);
      return;
    }
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));
  }

  // お題を配る手渡しを回し、「誰がどのお題だったか」を持ち帰る。
  // 少数派＝そのお題を持つのが少ない方＝ウルフ
  async function revealTopics(win, doc) {
    await waitScreen(win, doc, 'scr-wolf-pass', 8000);
    const topics = {};
    let guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 20) {
      const who = el(doc, 'wolfHandoffName').textContent.trim();
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      topics[who] = el(doc, 'wolfTopicText').textContent.trim();
      click(doc, 'wolfNextRevealBtn');
      await sleep(win, 50);
    }
    const per = {};
    Object.keys(topics).forEach(n => { (per[topics[n]] = per[topics[n]] || []).push(n); });
    const words = Object.keys(per).sort((a, b) => per[a].length - per[b].length);
    return { topics: topics, words: words, wolves: per[words[0]], sheep: per[words[1]] };
  }

  // 投票の1周を回す。voteFor(自分の名前) が投票先の名前（または希望の順の配列）を返す
  async function castVotes(win, doc, voteFor, strict) {
    let guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 20) {
      const who = el(doc, 'wolfHandoffName').textContent.trim();
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const btns = Array.from(doc.querySelectorAll('#wolfVoteGrid button'));
      if (!btns.length) break;
      const want = [].concat(voteFor(who));
      let target = null;
      for (const n of want) { target = btns.find(b => b.textContent.trim() === n); if (target) break; }
      if (strict) assert(target, who + ' が ' + want.join('/') + ' に投票できる');
      (target || btns[0]).click();
      await sleep(win, 50);
    }
  }

  // 話し合いを終え、投票して集計まで進める。
  // 第23弾-1：同数だと決選投票に入るので、その1周も面倒を見る。
  // opts.runoffFor(名前) が決選投票での投票先を返す（省略すると最初の候補）。
  async function voteAndTally(win, doc, voteFor, opts) {
    opts = opts || {};
    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    await castVotes(win, doc, voteFor, true);
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    // 結果へ行くか、決選投票のためにもう一周するか
    await waitFor(win, () => ['scr-wolf-result', 'scr-wolf-pass'].indexOf(activeScreen(doc)) >= 0,
      8000, '結果 または 決選投票');
    if (activeScreen(doc) === 'scr-wolf-pass') {
      if (opts.onRunoff) opts.onRunoff();
      await castVotes(win, doc, opts.runoffFor || (() => []), false);
      await waitScreen(win, doc, 'scr-wolf-gather', 5000);
      click(doc, 'wolfTallyBtn');
      await waitScreen(win, doc, 'scr-wolf-result', 8000);
    }
  }

  // 結果一覧から、名前 → 加点表示 を取り出す
  function deltasOf(doc) {
    const out = {};
    doc.querySelectorAll('#wolfResultList .reveal-row').forEach(row => {
      const name = row.querySelector('.rn').textContent.replace(/🐺|💀/g, '').trim();
      const rd = row.querySelector('.rd');
      out[name] = rd ? rd.textContent.trim() : '';
    });
    return out;
  }

  await r.test('実機：最多票が過半数に届かなくても、ウルフは捕まる', async () => {
    // これが実際に起きていたバグ。6人でウルフに2票（過半数は4票）。
    // 直す前は、ここで「ウルフの逃げ切り」になっていた。
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう'];
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf', players, 1);
    const { wolves, sheep } = await revealTopics(win, doc);
    assertEqual(wolves.length, 1, 'ウルフは1人');
    const w = wolves[0];
    // ウルフに2票、ほかの4人に1票ずつ散らす（＝最多2票だが過半数ではない）
    const plan = {};
    plan[sheep[0]] = w;
    plan[sheep[1]] = w;
    plan[sheep[2]] = sheep[0];
    plan[sheep[3]] = sheep[1];
    plan[sheep[4]] = sheep[2];
    plan[w] = sheep[3];
    await voteAndTally(win, doc, name => plan[name]);

    const text = el(doc, 'wolfResultTopics').textContent;
    assert(/ウルフをあぶり出しました/.test(text), 'ウルフが捕まったと出る（' + text.slice(0, 60) + '）');
    assert(!/逃げ切り/.test(text), '逃げ切り扱いになっていない');
    assert(text.indexOf(w + ' が処刑されました') >= 0, '誰が処刑されたかが出る');
    assertEqual(deltasOf(doc)[w], '', '捕まったウルフに逃げ切りの加点は入らない');

    // 画面に出る票数も、処刑を決めたのと同じ集計から来ていること
    await sleep(win, 1000); // 数字が数え上がるのを待つ
    const shown = {};
    doc.querySelectorAll('#wolfResultList .reveal-row').forEach(row => {
      const n = row.querySelector('.rn').textContent.replace(/🐺|💀/g, '').trim();
      shown[n] = row.querySelector('.rs').textContent.trim();
    });
    assertEqual(shown[w], '2', 'ウルフの得票が2票と表示される');
    [sheep[0], sheep[1], sheep[2], sheep[3]].forEach(n => {
      assertEqual(shown[n], '1', n + ' は1票');
    });
    assertEqual(shown[sheep[4]], '0', '票が入らなかった人は0票');
    assertNoErrors(errors, '過半数未満の最多票で未捕捉の例外');
    win.close();
  });

  await r.test('実機：同数なら決選投票に入り、そこでも同数なら逃げ切る', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう'];
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf', players, 1);
    const { wolves, sheep } = await revealTopics(win, doc);
    const w = wolves[0];
    // ウルフに3票、シープの1人に3票 → 同数
    const plan = {};
    plan[sheep[0]] = w; plan[sheep[1]] = w; plan[sheep[2]] = w;
    plan[sheep[3]] = sheep[0]; plan[sheep[4]] = sheep[0]; plan[w] = sheep[0];
    // 決選投票でも同じ割れ方にして、処刑なしで確定させる
    const runoffPlan = {};
    runoffPlan[w] = sheep[0]; runoffPlan[sheep[0]] = w;
    runoffPlan[sheep[1]] = w; runoffPlan[sheep[2]] = w;
    runoffPlan[sheep[3]] = sheep[0]; runoffPlan[sheep[4]] = sheep[0];
    let sawRunoff = false;
    let candidates = null;
    await voteAndTally(win, doc, name => plan[name], {
      runoffFor: name => runoffPlan[name],
      onRunoff: () => {
        sawRunoff = true;
        candidates = Array.from(doc.querySelectorAll('#wolfVoteGrid button'));
      }
    });
    assert(sawRunoff, '同数だったので決選投票に入る');

    const text = el(doc, 'wolfResultTopics').textContent;
    assert(/逃げ切り/.test(text), '決選投票でも同数なら逃げ切り（' + text.slice(0, 70) + '）');
    assert(/決選投票でも同数だったので/.test(text), '決選投票を経たことが伝わる');
    assert(text.indexOf('決選投票を行いました') >= 0, '誰で決選投票したかが出る');
    assertEqual(deltasOf(doc)[w], '+1', '逃げ切ったウルフに加点が入る');
    assertNoErrors(errors, '決選投票でも同数の時に未捕捉の例外');
    win.close();
  });

  await r.test('実機：決選投票では、並んだ人だけが候補になる', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう'];
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf', players, 1);
    const { wolves, sheep } = await revealTopics(win, doc);
    const w = wolves[0];
    const plan = {};
    plan[sheep[0]] = w; plan[sheep[1]] = w; plan[sheep[2]] = w;
    plan[sheep[3]] = sheep[0]; plan[sheep[4]] = sheep[0]; plan[w] = sheep[0];
    const tied = [w, sheep[0]];       // 3票ずつで並ぶ2人

    await waitScreen(win, doc, 'scr-play', 5000);
    click(doc, 'endRoundBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 6000);
    await castVotes(win, doc, name => plan[name], true);
    await waitScreen(win, doc, 'scr-wolf-gather', 5000);
    click(doc, 'wolfTallyBtn');
    await waitScreen(win, doc, 'scr-wolf-pass', 8000);

    // 決選投票の1周を、全員ぶん中身を見ながら回す
    let guard = 0;
    const seen = [];
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 20) {
      const who = el(doc, 'wolfHandoffName').textContent.trim();
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const btns = Array.from(doc.querySelectorAll('#wolfVoteGrid button')).map(b => b.textContent.trim());
      seen.push({ who: who, btns: btns });
      assertEqual(el(doc, 'wolfVoteTitle').textContent, '⚖️ 決選投票', who + '：決選投票だと分かる');
      assert(el(doc, 'wolfVoteNote').style.display !== 'none', who + '：説明が出ている');
      // 候補以外は選べない。自分が候補なら自分は出ない
      const want = tied.filter(n => n !== who);
      assertEqual(btns.slice().sort().join(','), want.slice().sort().join(','),
        who + ' の選択肢は並んだ人だけ（' + btns.join('/') + '）');
      const btn = Array.from(doc.querySelectorAll('#wolfVoteGrid button'))[0];
      btn.click();
      await sleep(win, 50);
    }
    assertEqual(seen.length, players.length, '決選投票も全員に回る');
    assertNoErrors(errors, '決選投票の候補しぼりこみで未捕捉の例外');
    win.close();
  });

  await r.test('実機：全員がウルフに入れたら、当てた人みんなに加点される', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf', players, 1);
    const { wolves, sheep } = await revealTopics(win, doc);
    const w = wolves[0];
    const plan = {};
    sheep.forEach(n => { plan[n] = w; });
    plan[w] = sheep[0];
    await voteAndTally(win, doc, name => plan[name]);

    const d = deltasOf(doc);
    sheep.forEach(n => assertEqual(d[n], '+1', n + ' は当てたので +1'));
    assertEqual(d[w], '', 'ウルフは捕まったので加点なし');
    assert(/ウルフをあぶり出しました/.test(el(doc, 'wolfResultTopics').textContent), '満場一致で捕まる');
    assertNoErrors(errors, '満場一致の投票で未捕捉の例外');
    win.close();
  });

  await r.test('実機：同じお題のまま続くターンでは、お題もウルフも明かさない', async () => {
    // 第22弾-6で見つかった別の不具合。集計と結果表示がそれぞれ別に
    // 「もう終わったか」を判断していたため、まだ2ターン目があるのに
    // 1ターン目の結果画面がお題とウルフを出してしまっていた。
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf-multi', players, 1, { turnLimit: 3, changeTopic: false });
    const { wolves, sheep, words } = await revealTopics(win, doc);
    const w = wolves[0];
    // 全員でシープの1人を吊る＝ウルフは残るので、まだ続く
    const plan = {};
    players.forEach(n => { plan[n] = (n === sheep[0]) ? sheep[1] : sheep[0]; });
    await voteAndTally(win, doc, name => plan[name]);

    const topics = el(doc, 'wolfResultTopics').textContent;
    const list = el(doc, 'wolfResultList').textContent;
    words.forEach(word => {
      assert(topics.indexOf(word) === -1, '途中でお題「' + word + '」を出さない（' + topics + '）');
    });
    assert(list.indexOf('🐺') === -1, '途中で誰がウルフかを出さない（' + list + '）');
    assert(topics.indexOf(sheep[0] + ' が処刑されました') >= 0, '誰が処刑されたかは伝える');
    // ウルフ1人の設定では「まだ続く＝外した」がルール上すぐ分かるので、そこは書いてよい。
    // 逆に「ウルフでした」は、書いた時点でゲームが終わっていなければならない
    assert(!/ウルフでした/.test(topics), 'まだ続くのに、ウルフを当てたとは出さない');
    assert(/つぎのターンへ/.test(el(doc, 'wolfResultNextBtn').textContent), '次のターンに続く');

    // 2ターン目：今度はウルフを吊って決着させる。ここで初めて明かされる
    click(doc, 'wolfResultNextBtn');
    await waitScreen(win, doc, 'scr-play', 6000);
    const plan2 = {};
    players.forEach(n => { plan2[n] = (n === w) ? sheep[1] : w; });
    await voteAndTally(win, doc, name => plan2[name]);
    const done = el(doc, 'wolfResultTopics').textContent;
    assert(done.indexOf(words[0]) >= 0 && done.indexOf(words[1]) >= 0, '決着したら両方のお題を出す');
    assertNoErrors(errors, '同じお題の2〜ターン版で未捕捉の例外');
    win.close();
  });

  await r.test('実機：前の試合の脱落者が、次の試合に持ち越されない', async () => {
    // 脱落の記録が2か所にあった頃は、2〜ターン版で脱落した人が
    // そのまま次の1ターン版でも投票に参加できなかった
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf-multi', players, 1, { turnLimit: 2, changeTopic: false });
    const first = await revealTopics(win, doc);
    const plan = {};
    players.forEach(n => { plan[n] = (n === first.sheep[0]) ? first.sheep[1] : first.sheep[0]; });
    await voteAndTally(win, doc, name => plan[name]);
    assert(/つぎのターンへ/.test(el(doc, 'wolfResultNextBtn').textContent), '1人脱落して続く');

    // 2ターン目で決着させ、スコア画面まで進んで試合を終える
    click(doc, 'wolfResultNextBtn');
    await waitScreen(win, doc, 'scr-play', 6000);
    const w1 = first.wolves[0];
    await voteAndTally(win, doc, name => (name === w1 ? first.sheep[1] : w1));
    for (let i = 0; i < 4 && activeScreen(doc) !== 'scr-score'; i++) {
      click(doc, 'wolfResultNextBtn');
      await sleep(win, 200);
    }
    await waitScreen(win, doc, 'scr-score', 6000);
    // 「記録して終わりますか？」→はい、「つぎはプレイヤーを変更しますか？」→いいえ
    let asked = 0;
    win.confirm = (msg) => { asked++; return /記録して終わり/.test(msg); };
    click(doc, 'finishMatchBtn');
    await sleep(win, 200);
    assert(asked >= 1, '終了の確認が出る');
    await waitScreen(win, doc, 'scr-shelf', 8000);

    // 同じ人たちで、1ターン版を始め直す
    await startWordwolf(win, doc, 'wordwolf', players, 1);
    const second = await revealTopics(win, doc);
    assertEqual(Object.keys(second.topics).length, players.length,
      '新しい試合では全員にお題が配られる');
    await voteAndTally(win, doc, name => (name === second.sheep[0] ? second.sheep[1] : second.sheep[0]));
    const rows = doc.querySelectorAll('#wolfResultList .reveal-row').length;
    assertEqual(rows, players.length, '新しい試合では全員が結果に並ぶ');
    assertNoErrors(errors, '試合をまたいだ時に未捕捉の例外');
    win.close();
  });

  await r.test('ワードウルフの画面に、人狼ゲームの言葉が混ざっていない', async () => {
    // 第18弾から続いている方針：このゲームの陣営はシープ🐑とウルフ🐺。
    // 役職や勝敗の表示に「村人」「人狼」が出ると、借りてきた実装がそのまま
    // 残っている合図になる（実際、役職カードにだけ残っていた）。
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const { win, doc, errors } = await launch();
    // 役職を使う設定でないと役職カードが出ないので、のぞき見ワードウルフで見る
    await startWordwolf(win, doc, 'wordwolf-peek', players, 1);
    const seen = [];
    await waitScreen(win, doc, 'scr-wolf-pass', 8000);
    let guard = 0;
    while (activeScreen(doc) === 'scr-wolf-pass' && guard++ < 20) {
      click(doc, 'wolfRevealBtn');
      await sleep(win, 40);
      const box = el(doc, 'wolfRoleBox');
      if (box.style.display !== 'none') seen.push(box.textContent.replace(/\s+/g, ' '));
      click(doc, 'wolfNextRevealBtn');
      await sleep(win, 50);
    }
    assertEqual(seen.length, players.length, '全員に役職カードが出る');
    seen.forEach(t => {
      assert(!/村人/.test(t), '役職カードに「村人」が出ない（' + t.slice(0, 60) + '）');
      assert(!/人狼/.test(t), '役職カードに「人狼」が出ない（' + t.slice(0, 60) + '）');
    });
    assert(seen.some(t => /シープ🐑|ウルフ🐺/.test(t)), 'シープ🐑／ウルフ🐺という言い方になっている');
    assertNoErrors(errors, 'ワードウルフの用語チェック');
    win.close();
  });

  // ---------- ⑤ 人数と票の割れ方を変えて、総当たりで通す（第22弾-7） ----------
  // 今回のバグは「特定の割れ方の時だけ」起きていた。
  // 1回通っただけで終わらせず、人数×割れ方の組み合わせで
  // 「画面に出る結論」と「WolfLogic.tally の結論」が必ず一致することを確かめる。

  // 投票の割り当てを作る。自分には投票できないので、そこだけ避ける
  function makePlan(kind, w, sheep) {
    const plan = {};
    if (kind === 'unanimous') {
      sheep.forEach(n => { plan[n] = w; });
      plan[w] = sheep[0];
    } else if (kind === 'plurality') {
      // ウルフに2票だけ集め、残りは1票ずつばらけさせる
      plan[sheep[0]] = w;
      plan[sheep[1]] = w;
      for (let i = 2; i < sheep.length; i++) plan[sheep[i]] = sheep[i - 2];
      plan[w] = sheep[sheep.length - 1];
    } else if (kind === 'tie') {
      // ウルフとシープの1人がぴったり同数で並ぶように配る。
      // ウルフ自身の1票がどちらかに乗るので、人数の偶奇で組み方が変わる
      const n = sheep.length + 1;
      if (n % 2 === 0) {
        // 偶数：ウルフに n/2 票、残りのシープ＋ウルフ本人の票で sheep[0] も n/2 票
        const a = n / 2;
        sheep.forEach((x, i) => { plan[x] = (i < a) ? w : sheep[0]; });
        plan[w] = sheep[0];
      } else {
        // 奇数：シープだけで両者 (n-1)/2 票ずつに割り、ウルフの票は第三者へ逃がす
        const m = (n - 1) / 2;
        sheep.forEach((x, i) => { plan[x] = (i < m) ? w : sheep[0]; });
        plan[w] = sheep[1];
      }
    } else { // sheep：シープの1人に票が集まる
      sheep.forEach((n, i) => { plan[n] = (i === 0) ? sheep[1] : sheep[0]; });
      plan[w] = sheep[0];
    }
    return plan;
  }

  // 決選投票での投票先。候補以外には入れられないので、
  // 各自「自分を除いた候補」から順に選ぶ（人数によって決まったり同数のままだったりする）
  function makeRunoffPlan(candidates, players) {
    const plan = {};
    players.forEach((n, i) => {
      const opts = candidates.filter(c => c !== n);
      plan[n] = opts[i % opts.length];
    });
    return plan;
  }

  const PATTERNS = [
    { id: 'unanimous', label: '全員がウルフに入れる' },
    { id: 'plurality', label: 'ウルフが最多だが過半数に届かない' },
    { id: 'tie', label: '同数で並ぶ（決選投票に入る）' },
    { id: 'sheep', label: 'シープに票が集まる' }
  ];
  const ALL_NAMES = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう', 'げん', 'はな'];

  for (const count of [4, 5, 6, 8]) {
    await r.test(count + '人：票の割れ方を変えても、画面の結論が集計と一致する', async () => {
      for (const pat of PATTERNS) {
        const players = ALL_NAMES.slice(0, count);
        const { win, doc, errors } = await launch();
        await startWordwolf(win, doc, 'wordwolf', players, 1);
        const { wolves, sheep } = await revealTopics(win, doc);
        const w = wolves[0];
        const plan = makePlan(pat.id, w, sheep);
        assertEqual(Object.keys(plan).length, count, pat.label + '：全員ぶんの投票を決めた');

        // 集計側が出すはずの答えを、先に計算しておく（名前をそのままIDとして扱う）
        const first = WolfLogic.voteOutcome(plan);
        const where = count + '人／' + pat.label;
        // 意図した形になっているかも、ここで確かめる
        if (pat.id === 'plurality' && count >= 5) {
          assert(first.kind === 'execute' && first.targetId === w && first.tally.max * 2 < count,
            where + '：ウルフが最多だが過半数未満（' + JSON.stringify(first.tally.counts) + '）');
        }
        if (pat.id === 'tie') assertEqual(first.kind, 'runoff', where + '：決選投票に入る');
        if (pat.id === 'unanimous') assertEqual(first.targetId, w, where + '：満場一致でウルフ');

        // 決選投票に入る場合は、その1周ぶんの投票先も決めておく
        const runoffPlan = (first.kind === 'runoff')
          ? makeRunoffPlan(first.candidates, players) : null;
        const second = runoffPlan ? WolfLogic.voteOutcome(runoffPlan, { isRunoff: true }) : null;
        const executedId = second ? second.targetId : first.targetId;
        const caught = executedId === w;

        let sawRunoff = false;
        await voteAndTally(win, doc, name => plan[name], {
          runoffFor: name => (runoffPlan ? runoffPlan[name] : []),
          onRunoff: () => { sawRunoff = true; }
        });
        assertEqual(sawRunoff, first.kind === 'runoff', where + '：決選投票の有無が一致する');

        const text = el(doc, 'wolfResultTopics').textContent;
        if (caught) {
          assert(/ウルフをあぶり出しました/.test(text), where + '：捕まる（' + text.slice(0, 50) + '）');
          assertEqual(deltasOf(doc)[w], '', where + '：捕まったウルフに加点なし');
        } else {
          assert(/ウルフの逃げ切り/.test(text), where + '：逃げ切る（' + text.slice(0, 50) + '）');
          assertEqual(deltasOf(doc)[w], '+1', where + '：逃げ切ったウルフに加点');
        }
        // 誰が処刑されたかも、集計と食い違わない
        if (executedId) {
          assert(text.indexOf(executedId + ' が処刑されました') >= 0,
            where + '：処刑された人が一致する（' + text.slice(0, 80) + '）');
        } else {
          assert(/同数だったので、だれも処刑されませんでした|決選投票でも同数だったので/.test(text),
            where + '：処刑なしと出る（' + text.slice(0, 80) + '）');
        }
        if (sawRunoff) {
          assert(text.indexOf('決選投票を行いました') >= 0, where + '：決選投票をしたことが残る');
        }
        assertNoErrors(errors, where);
        win.close();
      }
    });
  }

  await r.test('ウルフを増やしても、票の割れ方によらず必ず決着する', async () => {
    // 複数ウルフは投票をくり返す。回数を使い切る／同数が続く場合も含めて、
    // 画面が止まらずスコアまで到達することを確かめる
    for (const wolfCount of [2, 3]) {
      for (const kind of ['unanimous', 'tie']) {
        const players = ALL_NAMES.slice(0, 8);
        const { win, doc, errors } = await launch();
        await startWordwolf(win, doc, 'wordwolf', players, wolfCount);
        const { wolves, sheep } = await revealTopics(win, doc);
        assertEqual(wolves.length, wolfCount, 'ウルフが' + wolfCount + '人いる');
        // unanimous … 生きているウルフに集中させ、順にあぶり出していく
        // tie       … シープ2人で毎回きれいに割り、誰も処刑できないまま回数を使い切る
        const pick = (me) => (kind === 'tie')
          ? [(me === sheep[0]) ? sheep[1] : sheep[0]]
          : wolves.filter(n => n !== me).concat(sheep.filter(n => n !== me));
        let guard = 0;
        while (activeScreen(doc) !== 'scr-score' && guard++ < 30) {
          const cur = activeScreen(doc);
          if (cur === 'scr-play') { click(doc, 'endRoundBtn'); await sleep(win, 1000); }
          else if (cur === 'scr-wolf-pass') { await castVotes(win, doc, pick); }
          else if (cur === 'scr-wolf-gather') { click(doc, 'wolfTallyBtn'); await sleep(win, 2600); }
          else if (cur === 'scr-wolf-result') { click(doc, 'wolfResultNextBtn'); await sleep(win, 250); }
          else await sleep(win, 100);
        }
        assertEqual(activeScreen(doc), 'scr-score',
          'ウルフ' + wolfCount + '人／' + kind + ' でも決着する');
        assertNoErrors(errors, 'ウルフ' + wolfCount + '人／' + kind);
        win.close();
      }
    }
  });

  // ---------- ④-2 ルール説明が、実際の挙動と食い違っていないか（第23弾-3） ----------

  function modesOf(html) {
    const m = html.match(/var MODES = \[([\s\S]*?)\n {2}\];/);
    assert(m, 'MODES が見つかる');
    return m[1].split(/(?=\{id:")/).filter(b => b.trim().startsWith('{id:')).map(b => ({
      id: b.match(/\{id:"([^"]+)"/)[1],
      src: b,
      bullets: (function () {
        const bl = b.match(/bullets:\[([^\]]*)\]/);
        return bl ? bl[1].split('","').map(s => s.replace(/^"|"$/g, '')) : [];
      })()
    }));
  }

  await r.test('rules: は残っていない（表示されない死んだ説明文だった）', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert(!/^\s*rules:"/m.test(html), 'rules: フィールドが残っている');
    // 画面側も rules を読みに行かない
    assert(!/m\.rules/.test(html), 'm.rules を読んでいる箇所が残っている');
    modesOf(html).forEach((mode) => {
      assert(mode.bullets.length >= 3, mode.id + ' に説明が3つ以上ある');
    });
  });

  await r.test('投票があるモードは、ルール説明に投票の決まりが書いてある', async () => {
    // 第23弾-3：ルールに書いていない決まりでプレイヤーが不意打ちされないように。
    // 決選投票を足したので、なおさら食い違わせない。
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const voting = modesOf(html).filter(m => /wolf:true|wolfRole:true/.test(m.src.replace(/\s/g, '')));
    assert(voting.length >= 11, '投票のあるモードが揃っている（' + voting.length + '件）');
    voting.forEach((mode) => {
      const text = mode.bullets.join('｜');
      assert(/票が一番多い人が処刑される/.test(text), mode.id + '：最多得票のルールが書いてある');
      assert(/過半数でなくてよい/.test(text), mode.id + '：過半数は要らないと書いてある');
      assert(/同数なら決選投票/.test(text), mode.id + '：同数なら決選投票と書いてある');
      assert(/それでも同数なら処刑なし/.test(text), mode.id + '：決選投票でも同数なら処刑なしと書いてある');
    });
  });

  await r.test('ワードウルフのルール説明に、人狼ゲームの言葉が混ざっていない', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const ww = modesOf(html).filter(m => /game:'wordwolf'/.test(m.src));
    assert(ww.length >= 5, 'ワードウルフのモードが揃っている（' + ww.length + '件）');
    ww.forEach((mode) => {
      mode.bullets.forEach((b) => {
        assert(!/村人/.test(b), mode.id + '：ルールに「村人」が出ない（' + b + '）');
      });
    });
  });

  await r.test('ルール説明の画面に、そのモードの説明が全部出る', async () => {
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf', ['あき', 'びび', 'ちか', 'でん'], 1, null, { stopAtRules: true });
    const items = Array.from(doc.querySelectorAll('#rulesBody li')).map(li => li.textContent);
    assert(items.length >= 5, 'ルールが箇条書きで出る（' + items.length + '件）');
    const joined = items.join('｜');
    assert(/票が一番多い人が処刑される/.test(joined), '投票のルールが実際に画面に出る');
    assert(/同数なら決選投票/.test(joined), '決選投票のことも画面に出る');
    assertNoErrors(errors, 'ルール画面で未捕捉の例外');
    win.close();
  });

  // ---------- ⑤-2 人狼（手渡し）でも同じ決選投票（第23弾-1） ----------

  await r.test('実機・人狼：同数なら決選投票に入り、候補だけが選択肢になる', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう'];
    const { win, doc, errors } = await launch();
    // 役職の少ないカジュアル人狼で、投票の道筋だけを見る
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    if (el(doc, 'timerEnableToggle').classList.contains('on')) click(doc, 'timerEnableToggle');
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    // 手渡しを1周ぶん流す（役職確認 → 夜）
    async function runPass(pick) {
      // 段階の変わり目には「夜になりました」の関門が入る（第20弾-4-1）
      await waitScreen(win, doc, 'scr-wr-pass', 8000);
      const seen = [];
      let i = 0;
      while (i++ < players.length && activeScreen(doc) === 'scr-wr-pass') {
        const who = el(doc, 'wrHandoffName').textContent.trim();
        click(doc, 'wrRevealBtn');
        await sleep(win, 40);
        let g = 0;
        while (g++ < 4 && activeScreen(doc) === 'scr-wr-pass' && el(doc, 'wrContent').style.display !== 'none') {
          const choices = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'));
          if (g === 1) seen.push({ who: who, body: el(doc, 'wrContentBody').textContent, choices: choices.map(c => c.textContent.trim()) });
          if (choices.length) (pick ? (pick(who, choices) || choices[0]) : choices[0]).click();
          else click(doc, 'wrNextBtn');
          await sleep(win, 45);
        }
      }
      return seen;
    }
    await runPass();                       // 役職確認
    await runPass();                       // 夜
    await waitScreen(win, doc, 'scr-wr-day', 8000);
    await holdPress(win, doc, 'wrToVoteBtn');
    await waitScreen(win, doc, 'scr-wr-pass', 8000);

    // 生きている人の名前を、最初の投票画面の選択肢から拾う
    const firstName = el(doc, 'wrHandoffName').textContent.trim();
    click(doc, 'wrRevealBtn');
    await sleep(win, 40);
    const opts = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]')).map(b => b.textContent.trim());
    const alive = [firstName].concat(opts);
    const a = alive[0], b = alive[1];
    // きっちり半分ずつに割って同数にする
    let n = 0;
    const want = (who) => {
      const t = (n++ % 2 === 0) ? a : b;
      return (t === who) ? (t === a ? b : a) : t;
    };
    // いま開いている1人目から投票させる
    let target = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'))
      .find(x => x.textContent.trim() === want(firstName));
    (target || doc.querySelector('#wrChoiceGrid button[data-choice]')).click();
    await sleep(win, 50);
    let guard = 0;
    while (activeScreen(doc) === 'scr-wr-pass' && guard++ < 12) {
      const who = el(doc, 'wrHandoffName').textContent.trim();
      click(doc, 'wrRevealBtn');
      await sleep(win, 40);
      const btns = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'));
      if (!btns.length) break;
      const w2 = want(who);
      (btns.find(x => x.textContent.trim() === w2) || btns[0]).click();
      await sleep(win, 50);
    }
    await waitScreen(win, doc, 'scr-wr-gather', 6000);
    click(doc, 'wrTallyBtn');
    await waitFor(win, () => ['scr-wr-result', 'scr-wr-pass'].indexOf(activeScreen(doc)) >= 0,
      8000, '結果 または 決選投票');

    if (activeScreen(doc) === 'scr-wr-pass') {
      // 決選投票の1周：候補だけが選択肢で、決選投票だと分かる
      let g2 = 0;
      while (activeScreen(doc) === 'scr-wr-pass' && g2++ < 12) {
        const who = el(doc, 'wrHandoffName').textContent.trim();
        click(doc, 'wrRevealBtn');
        await sleep(win, 40);
        const body = el(doc, 'wrContentBody').textContent;
        assert(/決選投票/.test(body), who + '：決選投票だと分かる（' + body.slice(0, 40) + '）');
        const btns = Array.from(doc.querySelectorAll('#wrChoiceGrid button[data-choice]'));
        if (!btns.length) break;
        const names = btns.map(x => x.textContent.trim());
        assert(names.length <= 2, who + '：候補だけに絞られている（' + names.join('/') + '）');
        assert(names.indexOf(who) === -1, who + '：自分は選択肢に出ない');
        btns[0].click();
        await sleep(win, 50);
      }
      await waitScreen(win, doc, 'scr-wr-gather', 6000);
      click(doc, 'wrTallyBtn');
      await waitScreen(win, doc, 'scr-wr-result', 8000);
      assert(/決選投票を行いました/.test(el(doc, 'wrResultSummary').textContent),
        '結果に決選投票のことが残る');
    }
    assertNoErrors(errors, '人狼の決選投票で未捕捉の例外');
    win.close();
  });

  // ---------- ⑥ 1人1台モードでも、まったく同じ決選投票（第23弾-1） ----------
  // 手渡しだけ直して1人1台が取り残される、という事故を防ぐために
  // サーバー側の進行（wolf-room.js）も直接動かして確かめる。

  function fakeRoom(names) {
    const members = new Map();
    names.forEach((n, i) => members.set('m' + i, { id: 'm' + i, name: n, role: 'player', connected: true }));
    return { members: members, state: {} };
  }

  await r.test('1人1台：同数なら決選投票に入り、候補以外には投票できない', async () => {
    const room = fakeRoom(['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう']);
    const started = WolfRoom.startGame(room, { roles: ['wolf'], turnLimit: 5, revealRoleOnDeath: true });
    assert(started.ok, 'ゲームが始まる');
    const ids = Array.from(room.members.keys());

    // 役職確認 → 作戦会議 → 夜 → 朝 → 投票 まで進める
    ids.forEach((id) => WolfRoom.submitAction(room, id, null));
    WolfRoom.advance(room);                       // ROLE → MEETING
    WolfRoom.advance(room);                       // MEETING → NIGHT
    WolfRoom.expectedMembers(room).forEach((id) => {
      const v = WolfRoom.privateFor(room, id);
      WolfRoom.submitAction(room, id, (v.choices && v.choices.length) ? v.choices[0].id : null);
    });
    WolfRoom.advance(room);                       // NIGHT → DAY
    if (room.wolf.phase === 'ended') { assert(true, '初日で決着したので確認を省略'); return; }
    WolfRoom.advance(room);                       // DAY → VOTE
    assertEqual(room.wolf.phase, 'vote', '投票の段階になる');

    // 生きている人を2人に絞って、きっちり半分ずつ入れる
    const alive = WolfRoom.expectedMembers(room);
    const a = alive[0], b = alive[1];
    alive.forEach((id, i) => {
      const want = (i % 2 === 0) ? a : b;
      // 自分には入れられないので、その時は相手側へ
      WolfRoom.submitVote(room, id, want === id ? (want === a ? b : a) : want);
    });
    const before = JSON.stringify(room.wolf.game.votes);
    WolfRoom.advance(room);

    if (room.wolf.runoff) {
      assertEqual(room.wolf.phase, 'vote', '決選投票なので、もう一度投票の段階');
      const cands = room.wolf.runoff.candidates;
      assert(cands.length >= 2, '候補が2人以上いる');
      // 候補以外は選択肢に出ない
      WolfRoom.expectedMembers(room).forEach((id) => {
        const v = WolfRoom.privateFor(room, id);
        assertEqual(v.runoff, true, '端末に決選投票だと伝わる');
        (v.choices || []).forEach((c) => {
          assert(cands.indexOf(c.id) !== -1, '候補以外は選択肢に出ない');
        });
        assert((v.choices || []).every((c) => c.id !== id), '自分は選択肢に出ない');
      });
      // 候補以外への投票は、サーバー側で弾く
      const outsider = WolfRoom.expectedMembers(room).find((id) => cands.indexOf(id) === -1);
      if (outsider) {
        const bad = WolfRoom.submitVote(room, WolfRoom.expectedMembers(room)[0], outsider);
        assertEqual(bad.ok, false, '候補以外への投票は拒否される');
        assertEqual(bad.error, 'not_candidate', '理由が分かる');
      }
      // 大画面にも候補が出る（誰が投票したかは出ない）
      const pub = WolfRoom.publicView(room);
      assert(pub.runoff && pub.runoff.candidates.length === cands.length, '大画面に候補が出る');
      assert(!JSON.stringify(pub).includes('"votes"'), '公開情報に投票先そのものは入らない');

      // 決選投票を済ませて、ちゃんと先に進むこと
      WolfRoom.expectedMembers(room).forEach((id) => {
        const v = WolfRoom.privateFor(room, id);
        if (v.choices && v.choices.length) WolfRoom.submitVote(room, id, v.choices[0].id);
      });
      WolfRoom.advance(room);
      assert(['turnResult', 'ended'].indexOf(room.wolf.phase) >= 0,
        '決選投票のあとは結果へ進む（現在: ' + room.wolf.phase + '）');
      // 記録に残るのは1回目の投票
      const log = (room.wolf.game.log || []).filter((e) => e.type === 'vote');
      assert(log.length >= 1, '投票が記録される');
      assertEqual(JSON.stringify(log[log.length - 1].votes), before,
        '記録に残るのは、絞り込む前の1回目の投票');
    } else {
      assertEqual(room.wolf.phase, 'turnResult', '同数にならなかった回は、そのまま結果へ');
    }
  });

  await r.test('1人1台：投票の段階に入るたび、前の決選投票は消える', async () => {
    // 前のターンの候補が残っていると、次のターンで選択肢が絞られてしまう
    const room = fakeRoom(['あき', 'びび', 'ちか', 'でん', 'えみ']);
    WolfRoom.startGame(room, { roles: ['wolf'], turnLimit: 5, revealRoleOnDeath: true });
    room.wolf.runoff = { candidates: ['m0'], firstTally: null, firstVotes: {} };
    room.wolf.phase = 'day';
    room.wolf.game.phase = 'day';
    WolfRoom.advance(room);  // DAY → VOTE（決選投票ではない）
    assertEqual(room.wolf.phase, 'vote', '投票の段階になる');
    assertEqual(room.wolf.runoff, null, '前の決選投票の状態が消えている');
  });

  await r.test('1人1台：投票の中身は、決着するまで公開情報に入らない', async () => {
    // 大画面には公開情報しか届かない。ここに投票先が混ざると全員に見えてしまう
    const room = fakeRoom(['あき', 'びび', 'ちか', 'でん', 'えみ']);
    WolfRoom.startGame(room, { roles: ['wolf'], turnLimit: 3, revealRoleOnDeath: true });
    let guard = 0;
    let sawVote = false;
    while (room.wolf.phase !== 'ended' && guard++ < 40) {
      const pub = WolfRoom.publicView(room);
      assert(!pub.result || !pub.result.voteLog || room.wolf.phase === 'ended',
        '決着前の公開情報に投票の中身が入らない');
      assert(JSON.stringify(pub).indexOf('だれに') === -1, '公開情報に投票の中身が混ざらない');
      if (room.wolf.phase === 'vote') sawVote = true;
      WolfRoom.expectedMembers(room).forEach((id) => {
        const v = WolfRoom.privateFor(room, id);
        if (room.wolf.phase === 'vote') {
          if (v.choices && v.choices.length) WolfRoom.submitVote(room, id, v.choices[0].id);
        } else {
          WolfRoom.submitAction(room, id, (v.choices && v.choices.length) ? v.choices[0].id : null);
        }
      });
      WolfRoom.advance(room);
    }
    assert(sawVote, '途中で投票の段階を通っている');
    assertEqual(room.wolf.phase, 'ended', '決着する');
    const done = WolfRoom.publicView(room);
    assert(done.result && Array.isArray(done.result.voteLog) && done.result.voteLog.length,
      '決着したら投票の中身が届く');
    const row = done.result.voteLog[0].rows[0];
    assert(row && row.from && row.to, 'だれが→だれに の形で届く');
  });

  // ---------- ⑧ 役職確認のあとの作戦会議（第24弾-2） ----------

  await r.test('1人1台：役職確認のあとは作戦会議。ホストが進めると夜になる', async () => {
    const room = fakeRoom(['あき', 'びび', 'ちか', 'でん', 'えみ']);
    WolfRoom.startGame(room, { roles: ['wolf', 'seer'], turnLimit: 5, meetingSec: 180 });
    assertEqual(room.wolf.phase, 'roleReveal', 'まず役職確認');
    WolfRoom.expectedMembers(room).forEach((id) => WolfRoom.submitAction(room, id, null));
    WolfRoom.advance(room);
    assertEqual(room.wolf.phase, 'meeting', '役職確認のあとは作戦会議');
    assert(room.wolf.deadline, '話し合いの持ち時間が設定される');

    const pub = WolfRoom.publicView(room);
    assertEqual(pub.phase, 'meeting', '全員に作戦会議だと伝わる');
    assert(pub.deadline, '残り時間も全員に伝わる');
    // まだ誰も欠けていないので、朝の知らせは出ない
    assert(!pub.morning, '作戦会議に朝の知らせは出ない');
    // この段階では、誰も個別の操作を求められない
    WolfRoom.expectedMembers(room).forEach((id) => {
      const v = WolfRoom.privateFor(room, id);
      assert(!v.action, '作戦会議では誰も操作しない（' + id + '）');
    });

    WolfRoom.advance(room);
    assertEqual(room.wolf.phase, 'night', '作戦会議のあとは夜');
  });

  await r.test('1人1台：1ターン戦でも、作戦会議のあとに投票前の行動へ進む', async () => {
    const room = fakeRoom(['あき', 'びび', 'ちか', 'でん', 'えみ']);
    WolfRoom.startGame(room, { roles: ['wolf', 'peek'], turnLimit: 1 });
    WolfRoom.expectedMembers(room).forEach((id) => WolfRoom.submitAction(room, id, null));
    WolfRoom.advance(room);
    assertEqual(room.wolf.phase, 'meeting', '1ターン戦でも作戦会議は入る');
    assertEqual(room.wolf.deadline, null, '持ち時間を渡さなければ時間制限なし');
    WolfRoom.advance(room);
    assertEqual(room.wolf.phase, 'preVote', '夜が無い遊び方では投票前の行動へ');
  });

  await r.test('実機・人狼：役職確認のあとに作戦会議が入り、長押しで夜へ進む', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const { win, doc, errors } = await launch();
    const cart = doc.querySelector('.cart[data-cart="jinro"]');
    cart.click();
    if (activeScreen(doc) === 'scr-shelf') cart.click();
    await waitScreen(win, doc, 'scr-game', 3000);
    pickGame(doc, 'wolfrole');
    await sleep(win, 60);
    await fillPlayerForm(win, doc, players);
    await waitScreen(win, doc, 'scr-mode', 3000);
    click(doc, doc.querySelector('.mode-card[data-id="wolf-casual"]'));
    click(doc, 'modeNextBtn');
    await waitScreen(win, doc, 'scr-set-wolfrole', 3000);
    click(doc, doc.querySelector('#scr-set-wolfrole [data-wiz-next]'));
    await waitScreen(win, doc, 'scr-set-timer', 3000);
    // タイマーはONのまま（作戦会議にも時間が出ることを確かめたい）
    click(doc, doc.querySelector('#scr-set-timer [data-wiz-next]'));
    await sleep(win, 60);
    if (activeScreen(doc) === 'scr-mode-rules') { click(doc, 'rulesStartBtn'); await sleep(win, 60); }
    await waitScreen(win, doc, 'scr-ready', 3000);
    el(doc, 'holdBtn').dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true }));

    // 役職確認を全員ぶん
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    for (let i = 0; i < players.length; i++) {
      click(doc, 'wrRevealBtn');
      await sleep(win, 40);
      click(doc, 'wrNextBtn');
      await sleep(win, 45);
    }
    // 作戦会議（自動で通過させずに、その画面自体を見る）
    await waitFor(win, () => activeScreen(doc) === 'scr-wr-day', 6000, '作戦会議', false, true);
    assert(/作戦会議/.test(el(doc, 'wrDayTurn').textContent), '作戦会議だと分かる');
    assert(/役職を配りました/.test(el(doc, 'wrDayNews').textContent), '何が起きたのかが出る');
    assert(!/欠けました|襲われた/.test(el(doc, 'wrDayNews').textContent),
      'まだ誰も欠けていないので、朝の知らせは出ない');
    assert(/夜へ/.test(el(doc, 'wrDayHoldLabel').textContent), '長押しで夜へ進むと分かる');
    assertEqual(el(doc, 'wrDayTimer').style.display, 'block', '話し合いの時間が出る');
    assert(el(doc, 'wrDayPauseBtn').style.display !== 'none', '一時停止もできる');

    // 時間が動いていること（朝と同じ仕組みを使っている）
    const t0 = el(doc, 'wrDayTimer').textContent;
    await sleep(win, 1200);
    assert(el(doc, 'wrDayTimer').textContent !== t0, '作戦会議でも時間が進む');

    await holdPress(win, doc, 'wrToVoteBtn');
    await waitScreen(win, doc, 'scr-wr-pass', 9000);
    assert(el(doc, 'app').classList.contains('phase-night'), '作戦会議のあとは夜になる');
    assertNoErrors(errors, '作戦会議で未捕捉の例外');
    win.close();
  });

  // ---------- ⑦ 決着後だけ、誰が誰に入れたかを開示する（第23弾-2） ----------

  await r.test('実機：決着した回だけ、だれが だれに 入れたかが出る', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const { win, doc, errors } = await launch();
    // 同じお題のまま続く2〜ターン版：1ターン目は途中なので出さない
    await startWordwolf(win, doc, 'wordwolf-multi', players, 1, { turnLimit: 2, changeTopic: false });
    const { wolves, sheep } = await revealTopics(win, doc);
    const w = wolves[0];
    const plan = {};
    players.forEach(n => { plan[n] = (n === sheep[0]) ? sheep[1] : sheep[0]; });
    await voteAndTally(win, doc, name => plan[name]);
    assert(/つぎのターンへ/.test(el(doc, 'wolfResultNextBtn').textContent), 'まだ続く');
    assert(el(doc, 'wolfResultTopics').textContent.indexOf('だれが だれに 入れたか') === -1,
      '途中のターンでは投票の中身を出さない');

    // 2ターン目でウルフを吊って決着させる
    click(doc, 'wolfResultNextBtn');
    await waitScreen(win, doc, 'scr-play', 6000);
    await voteAndTally(win, doc, name => (name === w ? sheep[1] : w));
    const done = el(doc, 'wolfResultTopics').textContent;
    assert(done.indexOf('だれが だれに 入れたか') >= 0, '決着したら投票の中身が出る');
    // 1ターン目・2ターン目の両方が残っていること
    assert(done.indexOf('1ターン目') >= 0 && done.indexOf('2ターン目') >= 0,
      'ターンごとに分けて出る（' + done.slice(-160) + '）');
    players.forEach(n => {
      assert(done.indexOf(n + ' → ') >= 0, n + ' の投票先が出ている');
    });
    assertNoErrors(errors, '投票内容の公開で未捕捉の例外');
    win.close();
  });

  await r.test('実機：投票1回で終わる遊び方でも、決着後に投票の中身が出る', async () => {
    const players = ['あき', 'びび', 'ちか', 'でん', 'えみ'];
    const { win, doc, errors } = await launch();
    await startWordwolf(win, doc, 'wordwolf', players, 1);
    const { wolves, sheep } = await revealTopics(win, doc);
    const w = wolves[0];
    await voteAndTally(win, doc, name => (name === w ? sheep[0] : w));
    const text = el(doc, 'wolfResultTopics').textContent;
    assert(text.indexOf('だれが だれに 入れたか') >= 0, '投票の中身が出る');
    assert(text.indexOf('1ターン目') === -1 && text.indexOf('1回目') === -1,
      '1回しかないので、回の見出しは出さない（' + text.slice(-120) + '）');
    assert(text.indexOf(w + ' → ' + sheep[0]) >= 0, 'ウルフの投票先も出る');
    assertNoErrors(errors, '1ターン版の投票公開で未捕捉の例外');
    win.close();
  });

  r.finish();
})();
