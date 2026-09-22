// tests/tier-gate.js — 指示58：「ナニソレシラナイ」「むりなんだが」は、既定で出さない
//
// 門は QuizBank.allowedTiers の1つ。端末もサーバーもそこを通る（docs/監査_指示58の門.md）。
// ここで見るのは:
//   A. ルール層：門・寄せ方・おまかせへの戻し方（両側の入力を必ず試す・落とし穴10-c）
//   B. サーバーの進行役：参加者が何を送っても、許していない層は出さない（X4・X5・X8 の芯）
//   C. 端末：本物の入口を何百回も回して、1問も出ない（X4）／片方だけ加わる（X5）／
//      親OFFで描かれない（X7）／途中で消えたら「おまかせ」へ（X8 の端末側）
//   D. 機械照合：入口の全部が門を通る。通らないものは理由つきで宣言する（X3・両方向）
//   E. 記録・称号は消えない（X9）
//
// 層の名前は**具体の文字で書く**（落とし穴10-a：実装の定数を検査の範囲に使うと、一緒に緩む）。

const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, launch, sleep, el } = require('./harness');
const QuizBank = require('../public/js/quiz-bank');
const QuizLogic = require('../public/js/quiz-logic');
const BombLogic = require('../public/js/bomb-logic');
const QuizRoom = require('../quiz-room');
const BombRoom = require('../bomb-room');
const TierScan = require('../tools/tier-scan');

const ROOT = path.join(__dirname, '..');
const マニアック = ['nanisore', 'muri'];
const ふだん = ['easy', 'normal', 'hard'];
const 数える = (list) => list.reduce((o, t) => { o[t] = (o[t] || 0) + 1; return o; }, {});
const マニアックの数 = (list) => list.filter((t) => マニアック.indexOf(t) >= 0).length;

// ---- サーバーの進行役を、socket 無しで直に動かすための部屋 ----
function fakeRoom(n) {
  const members = new Map();
  for (let i = 0; i < (n || 3); i++) {
    const id = 'm' + i;
    members.set(id, { id, name: 'P' + i, role: 'player', connected: true });
  }
  return { code: 'TEST00', members, hostMemberId: 'm0', state: { phase: 'lobby', game: null, data: {} } };
}
function startQuiz(game, cfg) {
  const room = fakeRoom(3);
  const res = QuizRoom.startGame(room, Object.assign({ game }, cfg || {}), {});
  return { room, res, w: room.quiz };
}

(async function main() {
  const r = createRunner('tier-gate：なにそれ・むりは既定で出さない（指示58）');

  // ================= A. ルール層 =================

  await r.test('A1 門：何も足さなければ3層。true と書いた層だけが足される', async () => {
    assertEqual(QuizBank.allowedTiers({}).join(','), 'easy,normal,hard', '空の設定は3層');
    assertEqual(QuizBank.allowedTiers(null).join(','), 'easy,normal,hard', '設定が無い時も3層');
    assertEqual(QuizBank.allowedTiers('muri').join(','), 'easy,normal,hard', '壊れた設定も3層（出さない側）');
    assertEqual(QuizBank.allowedTiers({ nanisore: true }).join(','), 'easy,normal,hard,nanisore', 'なにそれだけ');
    assertEqual(QuizBank.allowedTiers({ muri: true }).join(','), 'easy,normal,hard,muri', 'むりだけ');
    assertEqual(QuizBank.allowedTiers({ muri: true, nanisore: true }).join(','),
      'easy,normal,hard,nanisore,muri', '両方でも、並びは易しい順');
    // true 以外は足さない（'yes'・1・'true' は「送り手が何か送ってきた」だけ）
    assertEqual(QuizBank.allowedTiers({ nanisore: 'yes', muri: 1 }).join(','), 'easy,normal,hard', 'true 以外は足さない');
    // 3層は外せない（false を送っても消えない）
    assertEqual(QuizBank.allowedTiers({ easy: false, hard: false }).join(','), 'easy,normal,hard', 'ふだんの3層は外せない');
  });

  await r.test('A2 クイズ王：その遊びで選べる層は、許された層のうち問題（お題）がある層だけ', async () => {
    const 全部 = QuizBank.allowedTiers({ nanisore: true, muri: true });
    // つぎつぎには「むり」のお題が無い——並べると、選んだ瞬間に始まらない（落とし穴21）
    assertEqual(QuizBank.listTopicsOf('muri').length, 0, '前提：つぎつぎに むり のお題は0件（型(b)：条件が本当に起きているか）');
    assert(QuizLogic.tiersFor('quizlist', 全部).indexOf('muri') < 0, 'つぎつぎに むり は並ばない');
    assert(QuizLogic.tiersFor('quizlist', 全部).indexOf('nanisore') >= 0, 'つぎつぎに なにそれ は並ぶ（お題がある）');
    ['quizrush', 'quizreveal', 'buzzer'].forEach((v) => {
      assertEqual(QuizLogic.tiersFor(v, 全部).join(','), 'easy,normal,hard,nanisore,muri', v + '：両方ONなら5つ');
      assertEqual(QuizLogic.tiersFor(v, QuizBank.allowedTiers({})).join(','), 'easy,normal,hard', v + '：既定は3つ');
    });
    // 許されていない層は、おまかせへ戻す（つぎつぎは null、ほかは ふつう）
    assertEqual(QuizLogic.fitTier('quizlist', 'nanisore', QuizBank.allowedTiers({})), null, 'つぎつぎ→おまかせ');
    assertEqual(QuizLogic.fitTier('quizreveal', 'muri', QuizBank.allowedTiers({})), 'normal', 'とくとく→ふつう');
    assertEqual(QuizLogic.fitTier('buzzer', 'muri', QuizBank.allowedTiers({ muri: true })), 'muri', '許されていれば、そのまま');
    assertEqual(QuizLogic.fitTier('quizreveal', 'hard', QuizBank.allowedTiers({})), 'hard', 'ふだんの層はそのまま');
  });

  await r.test('A3 クイズ王の設定：tierMix が無ければ3層。許されていない難易度は戻される', async () => {
    const c1 = QuizLogic.normalizeConfig({ variant: 'quizreveal', tier: 'muri' });
    assertEqual(c1.allowedTiers.join(','), 'easy,normal,hard', 'tierMix を送らない（古い端末）→3層');
    assertEqual(c1.tier, 'normal', 'むり は ふつう へ');
    const c2 = QuizLogic.normalizeConfig({ variant: 'quizreveal', tier: 'muri', tierMix: { muri: true } });
    assertEqual(c2.tier, 'muri', '許されていれば むり のまま');
    const c3 = QuizLogic.normalizeConfig({ variant: 'quizlist', tier: 'nanisore' });
    assertEqual(c3.tier, null, 'つぎつぎは おまかせ（null）へ');
    const c4 = QuizLogic.normalizeConfig({ variant: 'quizlist', tier: 'muri', tierMix: { muri: true } });
    assertEqual(c4.tier, null, 'つぎつぎの むり はお題が無いので、許されていても おまかせ へ');
  });

  await r.test('A4 クイズ解除：本数は許された一番上の層へ寄せる（合計は保つ）', async () => {
    const 三層 = QuizBank.allowedTiers({});
    const f = BombLogic.fitCounts({ easy: 12, normal: 10, hard: 6, nanisore: 2, muri: 0 }, 三層);
    assertEqual(JSON.stringify(f.counts), JSON.stringify({ easy: 12, normal: 10, hard: 8, nanisore: 0, muri: 0 }), '旧既定→新既定');
    assertEqual(f.moved, 2, '寄せた本数');
    // もう片方の入力（寄せない場合）も試す（落とし穴10-c）
    const g = BombLogic.fitCounts({ easy: 1, normal: 0, hard: 0, nanisore: 3, muri: 4 }, QuizBank.allowedTiers({ nanisore: true }));
    assertEqual(g.counts.muri, 0, 'むり は0');
    assertEqual(g.counts.nanisore, 7, 'なにそれ が許されていれば、そこが一番上（3＋4）');
    assertEqual(g.moved, 4, '寄せたのは むり の4本だけ');
    let 投げた = false;
    try { BombLogic.fitCounts({ easy: 1 }); } catch (e) { 投げた = true; }
    assert(投げた, '許された層を渡さないと投げる（黙って5層で通さない）');
    // normalizeConfig も同じ規則
    const c = BombLogic.normalizeConfig({ counts: { easy: 1, nanisore: 5, muri: 5 } }, 三層);
    assertEqual(c.counts.nanisore + c.counts.muri, 0, 'サーバーの整えでも、なにそれ・むりは0');
    assertEqual(c.counts.hard, 10, '10本は むずかしい へ');
    assertEqual(c.total, 11, '合計は保つ');
  });

  await r.test('A5 クイズ解除：最後の関所は、許された層を渡し忘れても3層で引く', async () => {
    let 出た = [];
    for (let i = 0; i < 50; i++) {
      const wires = BombLogic.pickQuestionWires(QuizBank, { easy: 1, nanisore: 3, muri: 3 }, null, {});
      出た = 出た.concat(wires.map((w) => w.tier));
    }
    assert(出た.length > 0, '1本は引けている（型(b)）');
    assertEqual(マニアックの数(出た), 0, '渡し忘れても、なにそれ・むりは0本');
    // もう片方：許されていれば引ける
    const ok = BombLogic.pickQuestionWires(QuizBank, { muri: 2 }, null, {}, QuizBank.allowedTiers({ muri: true }));
    assertEqual(ok.filter((w) => w.tier === 'muri').length, 2, '許されていれば むり を2本引く');
  });

  // ================= B. サーバーの進行役（X4・X5・X8 のサーバー側） =================

  await r.test('B1 ラッシュ：参加者が むり・なにそれ を送っても、許していなければ ok にしない（X6の芯）', async () => {
    const { room, res } = startQuiz('quizrush', { timerSec: 60 });
    assertEqual(res.ok, true, '始まる');
    for (const t of マニアック) {
      const a = QuizRoom.submitAction(room, 'm1', t, { targetId: t });
      assertEqual(a.ok, false, t + ' は断る');
      assertEqual(a.error, 'tier_not_allowed', t + '：理由は「許されていない」');
      assertEqual(room.quiz.rush.seats.m1.q, null, t + '：問題は出ていない');
    }
    // 画面に並べる層も3つだけ
    assertEqual(QuizRoom.privateFor(room, 'm1').rush.tiers.join(','), 'easy,normal,hard', '配る層は3つ');
    assertEqual(QuizRoom.publicView(room).allowedTiers.join(','), 'easy,normal,hard', '公開の許可も3つ');
  });

  await r.test('B2 ラッシュ：許された層を何百問解いても、なにそれ・むりは1問も出ない（X4）', async () => {
    const { room, w } = startQuiz('quizrush', { timerSec: 600 });
    const 出た = [];
    for (let i = 0; i < 300; i++) {
      const t = ふだん[i % 3];
      const a = QuizRoom.submitAction(room, 'm1', t, { targetId: t });
      assertEqual(a.ok, true, t + ' は選べる');
      const q = w.rush.seats.m1.q;
      出た.push(q.tier);
      QuizRoom.submitVote(room, 'm1', q.correct, { targetId: q.correct });   // 正解してから次へ（おてつき待ちを避ける）
    }
    assertEqual(出た.length, 300, '300問引けた（型(b)）');
    assertEqual(マニアックの数(出た), 0, 'なにそれ・むりは0問');
  });

  await r.test('B3 つぎつぎ・とくとく・早押し：おまかせ／許されていない難易度でも、1問も出ない（X4）', async () => {
    // つぎつぎのおまかせ：以前は 1/11 でナニソレのお題が出た
    const お題 = [];
    for (let i = 0; i < 400; i++) {
      const { room } = startQuiz('quizlist', { timerSec: 60 });
      お題.push(room.quiz.list.topic.tier);
    }
    assertEqual(マニアックの数(お題), 0, 'つぎつぎのおまかせ400回で、なにそれのお題は0');
    // 端末が なにそれ を送ってきても
    const { room: lr } = startQuiz('quizlist', { tier: 'nanisore' });
    assert(lr.quiz.list.topic.tier !== 'nanisore', 'つぎつぎに なにそれ を送っても、おまかせ で始まる');
    // とくとく：全問を始めにまとめて引く
    const { w: rw } = startQuiz('quizreveal', { tier: 'muri', questionCount: 30 });
    assertEqual(rw.reveal.questions.length, 30, '30問引けた');
    assertEqual(マニアックの数(rw.reveal.questions.map((q) => q.tier)), 0, 'とくとくに むり を送っても0問');
    // 早押し
    const { w: bw } = startQuiz('buzzer', { tier: 'nanisore' });
    assertEqual(bw.cfg.tier, 'normal', '早押しに なにそれ を送っても ふつう');
    assertEqual(bw.buzzer.q.tier, 'normal', '最初の1問も ふつう');
  });

  await r.test('B4 片方だけONなら、その層だけが加わる（X5）', async () => {
    const { room } = startQuiz('quizrush', { timerSec: 60, tierMix: { nanisore: true } });
    assertEqual(QuizRoom.submitAction(room, 'm1', 'nanisore', { targetId: 'nanisore' }).ok, true, 'なにそれ は選べる');
    assertEqual(room.quiz.rush.seats.m1.q.tier, 'nanisore', 'なにそれ の問題が出る');
    assertEqual(QuizRoom.submitAction(room, 'm2', 'muri', { targetId: 'muri' }).error, 'tier_not_allowed', 'むり は断る');
    // つぎつぎのおまかせにも なにそれ が加わる（何回か引けば出る）
    let 出た = false;
    for (let i = 0; i < 300 && !出た; i++) {
      出た = startQuiz('quizlist', { tierMix: { nanisore: true } }).room.quiz.list.topic.tier === 'nanisore';
    }
    assert(出た, 'なにそれ をONにすると、つぎつぎのおまかせにも加わる');
  });

  await r.test('B5 クイズ解除（部屋）：送られた本数は寄せられ、なにそれ・むりのコードは0本（X4・X5）', async () => {
    const room = fakeRoom(3);
    const res = BombRoom.startGame(room, { mode: 'coop', counts: { easy: 1, nanisore: 5, muri: 5 } }, {});
    assertEqual(res.ok, true, '始まる');
    const 層 = room.bomb.wires.map((x) => x.tier);
    assertEqual(層.length, 11, '合計11本（寄せても本数は変わらない）');
    assertEqual(マニアックの数(層), 0, 'なにそれ・むりは0本');
    const room2 = fakeRoom(3);
    BombRoom.startGame(room2, { mode: 'coop', counts: { easy: 1, nanisore: 2, muri: 3 }, tierMix: { muri: true } }, {});
    const 層2 = 数える(room2.bomb.wires.map((x) => x.tier));
    assertEqual(層2.nanisore || 0, 0, 'むり だけONなら なにそれ は0本');
    assertEqual(層2.muri, 5, 'なにそれ の2本は むり（許された一番上）へ');
  });

  await r.test('B6 途中で変えた：次の問題から効く。今出ている問題は取り消さない（X8 のサーバー側）', async () => {
    // ラッシュ：むり に挑んでいる最中に OFF
    const { room, w } = startQuiz('quizrush', { timerSec: 600, canChangeTier: false, tierMix: { muri: true } });
    QuizRoom.submitAction(room, 'm1', 'muri', { targetId: 'muri' });
    const 出ていた = w.rush.seats.m1.q;
    assertEqual(出ていた.tier, 'muri', '前提：むり の問題が出ている（型(b)）');
    const u = QuizRoom.updateOptions(room, { tierMix: {} });
    assertEqual(u.ok, true, '変えられる');
    assertEqual(w.rush.seats.m1.q, 出ていた, '今出ている問題は取り消さない');
    assertEqual(w.rush.seats.m1.tier, null, '挑んでいた層は空く（選び直し）');
    assertEqual(QuizRoom.submitAction(room, 'm1', 'muri', { targetId: 'muri' }).error, 'tier_not_allowed', '次からは むり を断る');
    // canChangeTier:false でも、ほかの層を選び直せる（固定がほどける）
    QuizRoom.submitVote(room, 'm1', 出ていた.correct, { targetId: 出ていた.correct });
    assertEqual(QuizRoom.submitAction(room, 'm1', 'hard', { targetId: 'hard' }).ok, true, '固定されていても選び直せる');
    // パス：層が空いた席のパスは、1回使わせずに選び直しへ
    const { room: r2, w: w2 } = startQuiz('quizrush', { timerSec: 600, passLimit: 3, tierMix: { muri: true } });
    QuizRoom.submitAction(r2, 'm1', 'muri', { targetId: 'muri' });
    QuizRoom.updateOptions(r2, { tierMix: {} });
    QuizRoom.submitAction(r2, 'm1', 'pass', { targetId: 'pass' });
    assertEqual(w2.rush.seats.m1.q, null, 'パスしても むり は引き直さない（選ぶ画面へ）');
    assertEqual(w2.rush.seats.m1.passesLeft, 3, 'パスは減らない');

    // とくとく：まとめて引いた残りを、出す直前に照らし直す
    const { room: rr, w: rw } = startQuiz('quizreveal', { tier: 'muri', questionCount: 6, tierMix: { muri: true } });
    assertEqual(rw.reveal.questions[0].tier, 'muri', '前提：むり の問題で始まっている');
    const u2 = QuizRoom.updateOptions(rr, { tierMix: {} });
    assertEqual(u2.tierReset && u2.tierReset.to, 'normal', '難易度は ふつう へ戻る');
    assertEqual(rw.reveal.questions[0].tier, 'muri', '今出ている1問目はそのまま');
    for (let i = 1; i < 6; i++) {
      rw.deadline = Date.now() - 1;
      // 見回りで次へ進める（全部見えた扱いにして）
      rw.reveal.shown = 9999; rw.reveal.askedAt = 0;
      QuizRoom.advance(rr);
      if (rw.phase !== 'play') break;
      assert(rw.reveal.questions[rw.reveal.index].tier !== 'muri', (i + 1) + '問目は むり ではない');
    }
    assert(rw.reveal.index >= 2, '2問目より先まで進めた（型(b)：条件が作れているか）');
  });

  await r.test('B7 途中の変更は、進行役（updateOptions を持つもの）だけが受け取る', async () => {
    assertEqual(typeof QuizRoom.updateOptions, 'function', 'クイズ王の進行役は受け取る');
    assertEqual(typeof BombRoom.updateOptions, 'undefined', 'クイズ解除は受け取らない＝次のゲームから（盤のコードはもう出ている）');
    const { room } = startQuiz('quizrush', {});
    assertEqual(QuizRoom.updateOptions(room, {}).ok, false, '中身の無い頼みは ok にしない');
    // drawQuestion は本当に中で fitTier を通っているか（tools/tier-scan.js が「門」と数える根拠）
    const src = fs.readFileSync(path.join(ROOT, 'quiz-room.js'), 'utf8');
    const at = src.indexOf('function drawQuestion(');
    const body = src.slice(at, src.indexOf('\n}', at));
    assert(/QuizLogic\.fitTier\(/.test(body), 'drawQuestion の中で fitTier を通っている');
  });

  // ================= C. 端末（手渡し・設定画面） =================

  await r.test('C1 手渡しの全入口：親OFFのまま何百回引いても、なにそれ・むりは1問も出ない（X4）', async () => {
    const { win, errors } = await launch({ showHiddenModes: true });
    const P = win.tierProbe;
    assertEqual(P.allowed().join(','), 'easy,normal,hard', '既定は3層');
    const 表 = [];
    const 回す = (名前, 入口, n) => {
      const 出た = P.draw(入口, n);
      表.push({ 名前, 回数: 出た.length, マニアック: マニアックの数(出た) });
      assert(出た.length > 0, 名前 + '：1つは引けている（型(b)）');
      assertEqual(マニアックの数(出た), 0, 名前 + '：なにそれ・むりは0');
      return 出た;
    };
    // あれそれ：おまかせ（まだ絞っていない）・ごちゃまぜ・手動の全選択肢
    P.setup({ topicDifficulties: null, topicMix: false });
    const 出た = 回す('あれそれ おまかせ', 'aresore', 300);
    assertEqual(Object.keys(数える(出た)).sort().join(','), 'easy,hard,normal', '3層とも出る（絞りすぎていない）');
    P.setup({ topicMix: true });
    回す('あれそれ ごちゃまぜ', 'aresore', 300);
    P.setup({ topicMix: false });
    ふだん.forEach((t) => { P.setup({ topicDifficulties: [t] }); 回す('あれそれ 手動 ' + t, 'aresore', 60); });
    // 古い選択（むり を選んだまま）が残っていても
    P.setup({ topicDifficulties: ['muri', 'nanisore'] });
    回す('あれそれ 手動 むり・なにそれ（許されていない）', 'aresore', 60);
    assertEqual(P.effective().join(','), 'easy,normal,hard', '選べない層だけの選択は、おまかせへ');
    P.setup({ topicDifficulties: null });
    // hidden の手渡し3つ
    回す('手渡し早押し', 'buzzerHandoff', 200);
    回す('手渡しオークション（ランダムに層を選ぶ）', 'auctionHandoff', 300);
    回す('手渡しクイズ王（並んだボタン全部）', 'quizkingHandoff', 30);
    回す('はずれの選択肢の逃げ道', 'decoys', 20);
    // クイズ解除：既定の配分・古い配分（なにそれ2本）
    回す('手渡しクイズ解除 既定', 'bombHandoff', 20);
    P.setup({ bombCounts: { easy: 1, normal: 0, hard: 0, nanisore: 5, muri: 5 } });
    const 解除 = 回す('手渡しクイズ解除 なにそれ・むりの本数が残っていても', 'bombHandoff', 5);
    assertEqual(解除.length, 5 * 11, '本数は寄せられて保たれる（11本×5回）');
    console.log('    X4 表：' + 表.map((x) => x.名前 + ' ' + x.回数 + '件/' + x.マニアック).join('｜'));
    // 手渡しクイズ王は説明文を頼みに行く（jsdom では失敗して catch に落ちる）。
    // それが片付く前に閉じると、閉じた窓で DOM を触って落ちるので待つ
    await sleep(win, 400);
    assertEqual(errors.length, 0, '未捕捉のエラーが無い：' + errors.join(' / '));
    win.close();
  });

  await r.test('C2 クイズ解除：🎲 残りを自動で決める を何度押しても、なにそれ・むりに本数が入らない（X4 ランダム）', async () => {
    const { win, doc } = await launch();
    const P = win.tierProbe;
    P.render('bomb-coop');
    for (let i = 0; i < 100; i++) {
      el(doc, 'bombAutoFillBtn').click();
      const c = P.peek().bombCounts;
      assertEqual(c.nanisore + c.muri, 0, (i + 1) + '回目：なにそれ・むりは0本');
    }
    const c = P.peek().bombCounts;
    assertEqual(c.easy + c.normal + c.hard, 30, '合計は上限（30本）どおり');
    win.close();
  });

  await r.test('C3 親OFFの時、なにそれ・むりは画面に描かれない（X7）', async () => {
    const { win, doc } = await launch({ showHiddenModes: true });
    const P = win.tierProbe;
    const 数 = (sel) => doc.querySelectorAll(sel).length;
    const マニアック要素 = () =>
      数('#difficultyChips [data-tier="nanisore"],#difficultyChips [data-tier="muri"]') +
      数('#bombCount-nanisore,#bombCount-muri,#bombTierRows [data-tier="nanisore"],#bombTierRows [data-tier="muri"]') +
      数('#qkTierSeg [data-tier="nanisore"],#qkTierSeg [data-tier="muri"]') +
      数('#quizTierButtons [data-tier="nanisore"],#quizTierButtons [data-tier="muri"]');
    // 描かれていることを先に確かめる（型(b)：空の画面を数えて0と言わない）
    P.render('normal');
    assertEqual(数('#difficultyChips [data-tier]'), 3, '難易度のチップは3つ');
    P.render('bomb-coop');
    assertEqual(数('#bombTierRows .bomb-tier-row'), 3, 'クイズ解除の行は3つ');
    for (const m of ['quizlist', 'quizreveal', 'buzzer-rt']) {
      P.render(m);
      assert(数('#qkTierSeg [data-tier]') >= 3, m + '：難易度のボタンがある');
      assertEqual(マニアック要素(), 0, m + '：なにそれ・むりのボタンは0');
    }
    P.draw('quizkingHandoff', 1);
    assertEqual(数('#quizTierButtons [data-tier]'), 3, '手渡しクイズ王のボタンは3つ');
    assertEqual(マニアック要素(), 0, 'どの画面にも なにそれ・むりは0');
    await sleep(win, 400);
    win.close();
  });

  await r.test('C4 設定：親OFFなら子は描かれない。親をONにしても子は2つともOFFから（X7・2-1）', async () => {
    const { win, doc } = await launch();
    const toTiers = async () => {
      if (!el(doc, 'settingsOverlay').classList.contains('show')) { el(doc, 'shelfGearBtn').click(); await sleep(win, 100); }
      doc.querySelector('#settingsOverlay [data-setpage="tiers"]').click();
      await sleep(win, 60);
    };
    await toTiers();
    const 子 = () => doc.querySelectorAll('#setTiersBody [data-tierpref="tierNanisore"],#setTiersBody [data-tierpref="tierMuri"]');
    assert(el(doc, 'setTierToggle-tierExtra'), '親のトグルがある');
    assertEqual(子().length, 0, '親OFF：子のトグルは0個（押せない見た目でも並べない）');
    el(doc, 'setTierToggle-tierExtra').click();
    await sleep(win, 30);
    assertEqual(子().length, 2, '親ON：子が2つ出る');
    assertEqual(doc.querySelectorAll('#setTiersBody .switch.on').length, 1, '親だけON（子は2つともOFF）');
    assertEqual(win.tierProbe.allowed().join(','), 'easy,normal,hard', '親をONにしただけでは増えない');
    // 子を片方だけ（X5）
    el(doc, 'setTierToggle-tierMuri').click();
    await sleep(win, 30);
    assertEqual(win.tierProbe.allowed().join(','), 'easy,normal,hard,muri', 'むり だけが加わる');
    // 親を入れ直しても、前の子は復活しない
    el(doc, 'setTierToggle-tierExtra').click();
    await sleep(win, 30);
    assertEqual(子().length, 0, '親OFF：子はまた描かれない');
    el(doc, 'setTierToggle-tierExtra').click();
    await sleep(win, 30);
    assertEqual(win.tierProbe.allowed().join(','), 'easy,normal,hard', '入れ直しただけで むり は戻らない');
    // 保存される（立ち上げ直しても残る）
    el(doc, 'setTierToggle-tierNanisore').click();
    await sleep(win, 30);
    const saved = win.localStorage.getItem('acac-app-prefs');
    win.close();
    const b = await launch({ storage: { 'acac-app-prefs': saved } });
    assertEqual(b.win.tierProbe.allowed().join(','), 'easy,normal,hard,nanisore', '立ち上げ直しても なにそれ ON のまま');
    const 印 = JSON.parse(saved)._chosen;
    assertEqual(印.tierExtra && 印.tierNanisore, true, '「本人が選んだ」の印が付く（落とし穴34）');
    b.win.close();
  });

  await r.test('C5 片方だけONで、手渡しの入口にもその層だけが加わる（X5）', async () => {
    const prefs = JSON.stringify({ tierExtra: true, tierNanisore: true, tierMuri: false });
    const { win } = await launch({ showHiddenModes: true, storage: { 'acac-app-prefs': prefs } });
    const P = win.tierProbe;
    assertEqual(P.allowed().join(','), 'easy,normal,hard,nanisore', 'なにそれ だけ');
    const 出た = P.draw('aresore', 400).concat(P.draw('auctionHandoff', 300));
    const 数 = 数える(出た);
    assert(数.nanisore > 0, 'なにそれ が出る');
    assertEqual(数.muri || 0, 0, 'むり は出ない');
    P.draw('quizkingHandoff', 1);
    assertEqual(Array.from(win.document.querySelectorAll('#quizTierButtons [data-tier]')).map((b) => b.dataset.tier).join(','),
      'easy,normal,hard,nanisore', '手渡しクイズ王のボタンも なにそれ まで');
    // 親OFFなら、子の値が残っていても読まない
    const off = await launch({ storage: { 'acac-app-prefs': JSON.stringify({ tierExtra: false, tierNanisore: true, tierMuri: true }) } });
    assertEqual(off.win.tierProbe.allowed().join(','), 'easy,normal,hard', '親OFFなら、子がONのまま保存されていても3層');
    off.win.close();
    await sleep(win, 400);   // 手渡しクイズ王の説明文の頼みが片付くのを待つ
    win.close();
  });

  await r.test('C6 途中で消えた：選んでいた層が無くなったら「おまかせ」へ戻して知らせる（X8 の端末側・2-3）', async () => {
    const prefs = JSON.stringify({ tierExtra: true, tierNanisore: true, tierMuri: true });
    const { win, doc } = await launch({ storage: { 'acac-app-prefs': prefs } });
    const P = win.tierProbe;
    P.setup({ topicDifficulties: ['muri'], qkTier: 'muri',
              bombCounts: { easy: 10, normal: 0, hard: 0, nanisore: 3, muri: 2 },
              bombLocked: { easy: false, normal: false, hard: false, nanisore: true, muri: true } });
    assertEqual(P.effective().join(','), 'muri', '前提：むり だけを選んでいる（型(b)）');
    // 設定の画面から、親を OFF にする（本物の道）
    el(doc, 'shelfGearBtn').click(); await sleep(win, 100);
    doc.querySelector('#settingsOverlay [data-setpage="tiers"]').click(); await sleep(win, 60);
    el(doc, 'setTierToggle-tierExtra').click(); await sleep(win, 60);
    const s = P.peek();
    assertEqual(s.topicDifficulties, null, 'あれそれ：おまかせ（null）へ');
    assertEqual(P.effective().join(','), 'easy,normal,hard', 'おまかせ＝許された層ぜんぶ');
    assertEqual(s.qkTier, null, 'クイズ王：おまかせへ');
    assertEqual(s.bombCounts.nanisore + s.bombCounts.muri, 0, 'クイズ解除：なにそれ・むりは0本');
    assertEqual(s.bombCounts.hard, 5, '5本は むずかしい へ（合計15本を保つ）');
    assertEqual(s.bombLocked.nanisore || s.bombLocked.muri, false, '寄せた層の「手で決めた」印も外れる');
    // 知らせ（出ている最中に数える・落とし穴10-g）
    const 文 = Array.from(doc.querySelectorAll('#fxNotices .fx-notice')).map((x) => x.textContent).join('｜');
    assert(文.indexOf('おまかせ') >= 0, '「おまかせ」にもどしたと知らせる：' + 文);
    assert(文.indexOf('5本') >= 0, '寄せた本数を知らせる：' + 文);
    // もう片方：何も失っていない時は知らせない
    const b = await launch();
    const n = b.win.tierProbe.changed();
    assertEqual(n.length, 0, '何も失っていない時は、何も言わない');
    b.win.close();
    win.close();
  });

  await r.test('C7 48-7：一周の数え方は、使ってよい層の中で数える', async () => {
    const { win } = await launch();
    const P = win.tierProbe;
    assertEqual(P.ring(), 18 + 14 + 8, '親OFF：40件で一周（なにそれ5・むり5を数えない）');
    const on = await launch({ storage: { 'acac-app-prefs': JSON.stringify({ tierExtra: true, tierNanisore: true, tierMuri: true }) } });
    assertEqual(on.win.tierProbe.ring(), 50, '両方ON：50件');
    on.win.close();
    win.close();
  });

  // ================= D. 機械照合（X3） =================

  /**
   * 門を通らない「語が出てくる関数」の宣言表。**理由のないものは置かない。**
   * 行き（掃き出した通らない関数が全部ここにある）と帰り（ここにあるものが実在して、
   * しかも本当に門を通っていない）の両方で照合する（落とし穴20）
   */
  const 通らなくてよい = {
    'public/index.html#（関数の外）#BOMB_TIERS': '層のラベルの辞書そのもの（5層のまま持つ。並べる時は tierRows を通す）',
    'public/index.html#（関数の外）#QUIZ_BANK': 'お題のデータそのもの（消さない・2-4）',
    'public/index.html#getPool': '生の50件を作ってキャッシュする。門を焼き込むと途中の変更が効かない。呼び手が通す',
    'public/index.html#poolByTier': '下請け。層を名指す呼び手が門を通す',
    'public/index.html#poolForTiers': '下請け。渡す層の一覧を呼び手が門に通す',
    'public/index.html#window.topicProbe': '検査の窓（48-7 のデータ側・生のプールを数える）',
    'public/index.html#draw': '検査の窓（tierProbe）。getPool はお題名から層を引くためだけ',
    'public/index.html#peek': '検査の窓（tierProbe）。いまの値を読むだけ',
    'public/index.html#setup': '検査の窓（tierProbe）。「選んでいた層が消えた」を組み立てるために値を置くだけ',
    'public/index.html#qzBody:click': 'ラッシュの層をサーバーへ送るだけ。権威はサーバー（rushAction）で、並ぶボタンもサーバーが配る',
    'public/index.html#quizTierButtons:click': '受け手の startQuizQuestion が門を持つ（呼び手が増えても通る）',
    'public/index.html#rtBombTierLabel': '引いたあとの層名を映すだけ',
    'public/index.html#openBombWire': '引いたあとの層名を映すだけ',
    'public/index.html#enterAuctionBid': '引いたあとの層名を映すだけ',
    'public/index.html#enterAuctionQuestion': '引いたあとの層名を映すだけ',
    'public/index.html#renderSetTiers': '設定画面の子トグルの名札（ラベルの辞書を引くだけ）',
    'public/index.html#sugoMiniBegin': 'すごろくのミニクイズ。ふつう（normal）固定',
    'sugoroku-room.js#startPlay': 'すごろくのミニクイズ（部屋）。ふつう（normal）固定'
  };
  const 鍵 = (s) => s.file + '#' + s.name + (s.name === '（関数の外）' ? '#' + s.sources.join('+') : '');

  await r.test('D1 X3：語が出てくる関数は全部、門を通るか、理由つきで宣言されている（両方向）', async () => {
    const r0 = TierScan.scan();
    assertEqual(r0.unread, 0, '読めなかった関数は0（落とし穴10-e）');
    assertEqual(r0.files, TierScan.FILES.length, '全ファイルを読んだ');
    const 通らない = r0.sites.filter((s) => !s.gated);
    const 通る = r0.sites.filter((s) => s.gated);
    // 型(b)：掃き出しが本当に効いているか——門を通る入口が、知っている名前で見つかる
    ['effectiveTiers', 'nextTopic', 'initBombRound', 'startAuctionRound', 'rushAction', 'startGame', 'onTiersChanged']
      .forEach((n) => assert(通る.some((s) => s.name === n), n + ' が「門を通る」として見つかる'));
    // 行き
    通らない.forEach((s) => assert(通らなくてよい[鍵(s)],
      '門を通らない入口：' + s.file + ':' + s.line + ' ' + s.name + ' [' + s.sources.join(' ') + ']'));
    // 帰り
    Object.keys(通らなくてよい).forEach((k) => assert(通らない.some((s) => 鍵(s) === k),
      '宣言表の ' + k + ' は、もう無いか、門を通るようになった（表から消す）'));
    console.log('    X3：語が出てくる関数 ' + r0.sites.length + '（門を通る ' + 通る.length +
      '・理由つきで通らない ' + 通らない.length + '）');
  });

  await r.test('D2 X3：層の名前を書いてよいのは、データの表だけ（手書きの filter が0）', async () => {
    const raw = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const js = TierScan.scriptOnly(raw).split('\n');
    // 表として許すもの（行の形で見分ける）
    const 表 = [/^\s*bombCounts:/, /^\s*bombLocked:/, /^\s*\{ id:'(nanisore|muri)', label:/, /var QUIZ_POINTS =/,
      /var AUCTION_MULT =/, /^\s*(nanisore|muri): \[\s*$/, /var TIER_PREF_KEY =/, /var BOMB_TIER_CLASS =/];
    let 見た = 0;
    const 外れ = [];
    js.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      if (!/\bnanisore\b|\bmuri\b/.test(l)) return;
      見た++;
      if (!表.some((re) => re.test(l))) 外れ.push((i + 1) + ': ' + l.trim().slice(0, 120));
    });
    assert(見た >= 8, '表の行を拾えている（型(b)）：' + 見た);
    assertEqual(外れ.length, 0, '表の外で層の名前を書いている：\n' + 外れ.join('\n'));
    // サーバーの進行役には、層の名前を書かない（ルール層から受け取る）
    ['quiz-room.js', 'bomb-room.js', 'realtime.js'].forEach((f) => {
      const src = TierScan.stripCode(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      assert(!/\bnanisore\b|\bmuri\b/.test(src), f + ' のコードに層の名前が無い');
    });
    // 「全部」を意味していた一覧は消えた（残すと OFF でも5層へ戻る道になる）
    assert(!/\bALL_TIERS\b/.test(TierScan.stripCode(TierScan.scriptOnly(raw))), 'ALL_TIERS は無い');
  });

  await r.test('D3 足せる層の表（TIER_PREF_KEY）は、5層から外せない3層を引いたものと一致する（両方向）', async () => {
    const raw = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const m = raw.match(/var TIER_PREF_KEY = (\{[^}]+\});/);
    assert(m, 'TIER_PREF_KEY が読める');
    const 表 = Function('return ' + m[1])();
    const 足せる = QuizBank.TIERS.filter((t) => QuizBank.BASE_TIERS.indexOf(t) < 0);
    assertEqual(Object.keys(表).sort().join(','), 足せる.slice().sort().join(','), '足せる層と表が一致');
    足せる.forEach((t) => assert(QuizBank.TIER_HINT[t], t + ' の説明（目安）がある'));
  });

  await r.test('D4 ルール文に、設定しだいで嘘になる数（段階の数・点の上限）を書かない（落とし穴33）', async () => {
    const raw = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const 本体 = raw.slice(raw.indexOf('var MODES = ['), raw.indexOf('];', raw.indexOf('var MODES = [')));
    assert(本体.length > 1000, 'MODES が読める');
    ['5段階', '1〜8点', '8点'].forEach((w) => assert(本体.indexOf(w) < 0, 'ルール文に「' + w + '」がある'));
  });

  // ================= E. 記録・称号（X9） =================

  await r.test('E1 記録・称号は消えない：設定を切り替えても、なにそれ・むりで遊んだ記録は残る（X9）', async () => {
    // 称号の目録：なにそれ・むりの称号は id も条件もそのまま
    const Titles = require('../public/js/titles');
    const 全部 = [].concat.apply([], Object.keys(Titles.CATALOG).map((k) => Titles.CATALOG[k]));
    const 難問 = 全部.find((x) => x.id === 'icon-quiz-muri');
    assert(難問, '「難問撃破の証」は目録に残っている');
    assertEqual(難問.need((c, k) => (k === 'muriHits' ? 1 : 0)), true, '条件はそのまま（むりを1問正解）');
    const 残る = Titles.mergeUnlocked(['icon-quiz-muri'], Titles.emptyStats());
    assert(残る.indexOf('icon-quiz-muri') >= 0, '持っている人の分は消えない');
    // 端末の記録：お題の成績・履歴に、むり のお題が入っている端末
    // 保存先は saveLocalPrefs の1つ（aresoredorekore-prefs）
    const keys = { 'aresoredorekore-prefs': JSON.stringify({
      topicStats: { '火吹き竹': { plays: 3, miss: 2 } },
      topicHistory: [{ name: '火吹き竹', tier: 'muri' }],
      autoSaveRecords: true }) };
    const { win, doc } = await launch({ storage: keys });
    const 前 = {};
    Object.keys(keys).forEach((k) => { 前[k] = win.localStorage.getItem(k); });
    el(doc, 'shelfGearBtn').click(); await sleep(win, 100);
    doc.querySelector('#settingsOverlay [data-setpage="tiers"]').click(); await sleep(win, 60);
    el(doc, 'setTierToggle-tierExtra').click(); await sleep(win, 30);
    el(doc, 'setTierToggle-tierMuri').click(); await sleep(win, 30);
    el(doc, 'setTierToggle-tierExtra').click(); await sleep(win, 30);
    Object.keys(keys).forEach((k) => {
      const 後 = JSON.parse(win.localStorage.getItem(k) || '{}');
      const 元 = JSON.parse(前[k] || '{}');
      assertEqual(JSON.stringify(後.topicStats), JSON.stringify(元.topicStats), 'お題の成績は変わらない');
      assertEqual(JSON.stringify(後.topicHistory), JSON.stringify(元.topicHistory), 'お題の履歴は変わらない');
    });
    assert(JSON.parse(前['aresoredorekore-prefs']).topicStats['火吹き竹'], '前提：むり のお題の成績が読めている（型(b)）');
    win.close();
  });

  await r.test('E2 称号の数え：正解した層から「むずかしい以上」「むりなんだが」を作る（2-4）', async () => {
    const Titles = require('../public/js/titles');
    assertEqual(JSON.stringify(Titles.quizTierStats({ easy: 5, normal: 2, hard: 2, nanisore: 1, muri: 3 })),
      JSON.stringify({ hardHits: 6, muriHits: 3 }), 'むずかしい以上＝hard＋nanisore＋muri');
    // もう片方の入力：ふだんの層だけ・何も無い・壊れた値（落とし穴10-c）
    assertEqual(JSON.stringify(Titles.quizTierStats({ easy: 9, normal: 9 })), '{}', 'ふだんの層だけなら何も足さない');
    assertEqual(JSON.stringify(Titles.quizTierStats(null)), '{}', '無ければ何も足さない');
    assertEqual(JSON.stringify(Titles.quizTierStats({ muri: -4, hard: 'x' })), '{}', '壊れた値は0として読む');
    // 一言（条件は変えない）
    const 全部 = [].concat.apply([], Object.keys(Titles.CATALOG).map((k) => Titles.CATALOG[k]));
    const 難問 = 全部.find((x) => x.id === 'icon-quiz-muri');
    assert(/マニアックな問題/.test(難問.hint), '取り方の一言がある：' + 難問.hint);
  });

  await r.test('E3 サーバーは、正解した問題の層を本人の分だけ数える（ラッシュ・とくとく・早押しの3か所）', async () => {
    // ラッシュ
    const a = startQuiz('quizrush', { timerSec: 600, tierMix: { nanisore: true } });
    QuizRoom.submitAction(a.room, 'm1', 'nanisore', { targetId: 'nanisore' });
    const q1 = a.w.rush.seats.m1.q;
    QuizRoom.submitVote(a.room, 'm1', q1.correct, { targetId: q1.correct });
    assertEqual(QuizRoom.privateFor(a.room, 'm1').hitsByTier.nanisore, 1, 'ラッシュ：なにそれ の正解が1');
    assertEqual(JSON.stringify(QuizRoom.privateFor(a.room, 'm2').hitsByTier), '{}', 'ほかの人には配らない');
    // 外した時は数えない（もう片方の入力）
    QuizRoom.submitAction(a.room, 'm2', 'hard', { targetId: 'hard' });
    const q2 = a.w.rush.seats.m2.q;
    QuizRoom.submitVote(a.room, 'm2', (q2.correct + 1) % q2.choices.length, { targetId: (q2.correct + 1) % q2.choices.length });
    assertEqual(JSON.stringify(QuizRoom.privateFor(a.room, 'm2').hitsByTier), '{}', '外した問題は数えない');
    // とくとく
    const b = startQuiz('quizreveal', { tier: 'muri', questionCount: 3, tierMix: { muri: true } });
    QuizRoom.submitAction(b.room, 'm1', 'buzz', { targetId: 'buzz' });
    const rq = b.w.reveal.questions[b.w.reveal.index];
    QuizRoom.submitVote(b.room, 'm1', rq.correct, { targetId: rq.correct });
    assertEqual(QuizRoom.privateFor(b.room, 'm1').hitsByTier.muri, 1, 'とくとく：むり の正解が1');
    // 早押し
    const c = startQuiz('buzzer', { tier: 'hard' });
    const pair = c.w.buzzer.pair;
    QuizRoom.submitAction(c.room, pair[0], 'buzz', { targetId: 'buzz' });
    const bq = c.w.buzzer.q;
    QuizRoom.submitVote(c.room, pair[0], bq.correct, { targetId: bq.correct });
    assertEqual(QuizRoom.privateFor(c.room, pair[0]).hitsByTier.hard, 1, '早押し：むずかしい の正解が1');
  });

  r.finish();
})();
