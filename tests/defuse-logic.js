// tests/defuse-logic.js — 実物解除のルール層（第27弾-3）
//
// 9種のモジュールそれぞれについて、同じ3つを必ず見る:
//   ・正しい操作をしたら解除できる
//   ・違う操作をしたらミスになる（か、少なくとも解除されない）
//   ・対応表（manual）だけで答えにたどり着ける＝口で伝え合えば解ける
//
// 3つめが一番大事。ここが崩れていると、マニュアル役が正しく読み上げても
// 解除役が解けない「詰み」のモジュールができてしまう。
//
// センサーそのもの（傾き・方位・振り・カメラ）は実機でしか確かめられない。
// ここで見ているのは「端末が値を送ってきたあと」の判定だけ。

const D = require('../public/js/defuse-logic');
const { createRunner, assert, assertEqual } = require('./harness');

// 呼ぶたびに違う値を返す、決まった並びの乱数（回ごとに違う問題を作らせる）
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
function gen(id, rnd, ctx) {
  const def = D.moduleById(id);
  const inst = def.generate(rnd || seeded(7), ctx || { manualHolders: 2 });
  inst.uid = 'u1'; inst.type = id; inst.solved = false;
  return inst;
}
function judge(inst, action) { return D.moduleById(inst.type).judge(inst, action); }

(async function main() {
  const r = createRunner('defuse-logic：実物解除のルール');

  // ---- 全モジュール共通の約束 ----

  await r.test('どのモジュールも hint・answer を持ち、答えは hint に混ざらない', async () => {
    // 例外：イエスノー解錠だけは、答えが4つの選択肢の中に必ず入っている。
    // 「どれか」を絞り込むのが遊びの中身なので、これは漏れではなく仕様。
    // ほかのモジュールで同じことが起きたら、対応表を読む意味が無くなる
    const ANSWER_IS_VISIBLE = ['yesno'];
    D.MODULES.forEach((def) => {
      const inst = gen(def.id);
      assert(inst.hint, def.name + '：解除役に見せるものがある');
      assert(inst.answer, def.name + '：答えがある');
      if (ANSWER_IS_VISIBLE.indexOf(def.id) >= 0) return;
      const hint = JSON.stringify(inst.hint);
      Object.keys(inst.answer).forEach((k) => {
        const v = inst.answer[k];
        if (typeof v === 'string' && v.length >= 2) {
          assert(hint.indexOf('"' + v + '"') === -1,
            def.name + '：答え（' + k + '）が解除役の画面に出ていない');
        }
      });
    });
  });

  await r.test('イエスノー解錠の答えは選択肢に見えるが、どれかは絞り込むしかない', async () => {
    // 上の例外が「うっかり」ではなく意図であることを、ここで固定しておく
    const inst = gen('yesno');
    assert(inst.hint.choices.indexOf(inst.answer.name) >= 0, '答えは選択肢の中にある');
    assert(inst.hint.choices.length >= 3, '1つに絞られてはいない');
    // 質問しないと、どれが正解かの手がかりは何も無い
    assertEqual(inst.progress.asked.length, 0, '最初は手がかり0');
    assertEqual(JSON.stringify(inst.hint).indexOf('facts'), -1, '答え合わせの表は渡らない');
  });

  await r.test('マニュアルなしにすると対応表が解除役に渡り、ありなら渡らない', async () => {
    D.MODULES.forEach((def) => {
      const inst = gen(def.id);
      const withManual = D.openView(inst, true);
      const without = D.openView(inst, false);
      assertEqual(withManual.manual, undefined, def.name + '：マニュアルありでは渡さない');
      if (inst.manual) {
        assert(without.manual, def.name + '：マニュアルなしでは渡す');
      }
      // どちらの渡し方でも、答えは載らない
      assertEqual(withManual.answer, undefined, def.name + '：答えは載らない（あり）');
      assertEqual(without.answer, undefined, def.name + '：答えは載らない（なし）');
    });
  });

  await r.test('マニュアル役に渡すのは対応表だけ（答えも進み具合も渡さない）', async () => {
    D.MODULES.forEach((def) => {
      const inst = gen(def.id);
      const view = D.manualView(inst);
      if (!inst.manual) { assertEqual(view, null, def.name + '：対応表を持たない'); return; }
      assert(view.manual, def.name + '：対応表がある');
      assertEqual(view.answer, undefined, def.name + '：答えは渡さない');
      assertEqual(view.progress, undefined, def.name + '：進み具合も渡さない');
    });
  });

  // ---- ① 面認証 ----

  await r.test('面認証：4面を順番どおりに正しく押すと解除できる', async () => {
    const inst = gen('face');
    for (let i = 0; i < 4; i++) {
      const res = judge(inst, { type: 'press', face: inst.hint.order[i], color: inst.answer.buttons[i] });
      assertEqual(!!res.miss, false, (i + 1) + '面目：ミスにならない');
      assertEqual(!!res.solved, i === 3, (i + 1) + '面目：4面目で解除');
    }
  });

  await r.test('面認証：違う色を押すとミスになる', async () => {
    const inst = gen('face');
    const right = inst.answer.buttons[0];
    const wrong = D.COLORS.find((c) => c.id !== right).id;
    const res = judge(inst, { type: 'press', face: inst.hint.order[0], color: wrong });
    assertEqual(res.miss, true, 'ミスになる');
    assertEqual(inst.progress.step, 0, '進まない');
  });

  await r.test('面認証：順番でない面を押しても、ミスにはしない', async () => {
    // 端末を回している最中にたまたま別の面が出るのは、間違いではない
    const inst = gen('face');
    const res = judge(inst, { type: 'press', face: inst.hint.order[2], color: inst.answer.buttons[2] });
    assertEqual(!!res.miss, false, 'ミスにならない');
    assertEqual(res.note, 'wrongFace', '順番が違うと分かる');
    assertEqual(inst.progress.step, 0, '進まない');
  });

  await r.test('面認証：対応表だけで答えにたどり着ける', async () => {
    // マニュアル役が読み上げる手順を、そのままなぞる
    const inst = gen('face');
    inst.hint.faces.forEach((f, i) => {
      const row = inst.manual.rows.find((x) => x.mark === f.mark);
      assert(row, '記号「' + f.mark + '」の行が対応表にある');
      const cell = row.map.find((x) => x.from === f.color);
      assert(cell, '面の色の欄がある');
      assertEqual(cell.to, inst.answer.buttons[i], '対応表の答えが正解と一致する');
    });
  });

  // ---- ② 傾け迷路 ----

  await r.test('傾け迷路：壁には進めず、罠を踏むとミスでスタートに戻る', async () => {
    const inst = gen('maze');
    // 罠のとなりまで手で運ぶのは大変なので、状態を直接置いて判定だけを見る
    const trapKey = inst.manual.traps[0];
    const [tx, ty] = trapKey.split(',').map(Number);
    inst.progress.at = { x: tx - 1, y: ty };
    if (tx - 1 < 0) { inst.progress.at = { x: tx, y: ty - 1 }; }
    const dir = (inst.progress.at.x === tx) ? 'down' : 'right';
    const res = judge(inst, { type: 'step', dir });
    assertEqual(res.miss, true, '罠でミスになる');
    assertEqual(inst.progress.at.x, inst.hint.start.x, 'スタートに戻る（詰みを作らない）');
    assertEqual(inst.progress.at.y, inst.hint.start.y, 'スタートに戻る');
  });

  await r.test('傾け迷路：ゴールに着けば解除できる', async () => {
    const inst = gen('maze');
    const g = inst.answer.goal;
    inst.progress.at = { x: g.x - 1, y: g.y };
    const res = judge(inst, { type: 'step', dir: 'right' });
    // ゴールの手前が壁のこともあるので、壁だった場合は上から入る
    if (res.note === 'wall') {
      inst.progress.at = { x: g.x, y: g.y - 1 };
      assertEqual(judge(inst, { type: 'step', dir: 'down' }).solved, true, 'ゴールで解除');
    } else {
      assertEqual(res.solved, true, 'ゴールで解除');
    }
  });

  await r.test('傾け迷路：盤の外へは出られない', async () => {
    const inst = gen('maze');
    inst.progress.at = { x: 0, y: 0 };
    assertEqual(judge(inst, { type: 'step', dir: 'left' }).note, 'wall', '外に出ない');
    assertEqual(inst.progress.at.x, 0, '位置も動かない');
  });

  await r.test('傾け迷路：対応表には地図があり、解除役の画面には無い', async () => {
    const inst = gen('maze');
    assert(inst.manual.blocked.length > 0, '対応表に壁がある');
    assertEqual(inst.hint.blocked, undefined, '解除役には壁が見えない');
    assertEqual(inst.hint.traps, undefined, '解除役には罠も見えない');
    assert(inst.hint.goal, 'ゴールの場所だけは見える（向かう先が分からないと動けない）');
  });

  // ---- ③ 振ってアクション ----

  await r.test('振ってアクション：回数もテンポも合えば解除できる', async () => {
    const inst = gen('shake');
    const gaps = [];
    for (let i = 1; i < inst.answer.count; i++) gaps.push(inst.answer.tempo === 'fast' ? 300 : 1200);
    assertEqual(judge(inst, { type: 'shakes', count: inst.answer.count, gaps }).solved, true, '解除できる');
  });

  await r.test('振ってアクション：回数が違うとミス、テンポが違ってもミス', async () => {
    const a = gen('shake');
    assertEqual(judge(a, { type: 'shakes', count: a.answer.count + 1, gaps: [300] }).miss, true, '回数違い');
    const b = gen('shake');
    const badGap = b.answer.tempo === 'fast' ? 2000 : 100;
    const gaps = [];
    for (let i = 1; i < b.answer.count; i++) gaps.push(badGap);
    const res = judge(b, { type: 'shakes', count: b.answer.count, gaps });
    assertEqual(res.miss, true, 'テンポ違い');
    assertEqual(res.note, 'tempo', '理由が分かる');
  });

  await r.test('振ってアクション：対応表だけで回数とテンポが分かる', async () => {
    const inst = gen('shake');
    const row = inst.manual.rows.find((x) => x.mark === inst.hint.mark);
    assert(row, '画面に出ている記号の行がある');
    assertEqual(row.count, inst.answer.count, '回数が一致');
    assertEqual(row.tempo, inst.answer.tempo, 'テンポが一致');
  });

  // ---- ④ コンパス方角 ----

  await r.test('コンパス方角：合った方角で待てば解除、外れると溜まりが戻る', async () => {
    const inst = gen('compass');
    const target = D.dirById(inst.answer.dir).deg;
    judge(inst, { type: 'heading', deg: target, dtMs: 500 });
    assert(inst.progress.holdMs > 0, '溜まりはじめる');
    judge(inst, { type: 'heading', deg: (target + 180) % 360, dtMs: 500 });
    assertEqual(inst.progress.holdMs, 0, '外れたら振り出しに戻る');
    let res;
    for (let i = 0; i < 6; i++) res = judge(inst, { type: 'heading', deg: target, dtMs: 500 });
    assertEqual(res.solved, true, '待ちきれば解除');
  });

  await r.test('コンパス方角：少しのずれは許す（きっちり真北でなくてよい）', async () => {
    const inst = gen('compass');
    const target = D.dirById(inst.answer.dir).deg;
    judge(inst, { type: 'heading', deg: (target + D.COMPASS_TOLERANCE_DEG - 2 + 360) % 360, dtMs: 500 });
    assert(inst.progress.holdMs > 0, '許容の内側なら溜まる');
  });

  await r.test('コンパス方角：359度と1度を「2度差」として扱う', async () => {
    assertEqual(D.degDiff(359, 1), 2, '北をまたいでも近いと分かる');
    assertEqual(D.degDiff(10, 350), 20, '逆向きでも同じ');
    assertEqual(D.degDiff(0, 180), 180, '真反対は180度');
  });

  await r.test('コンパス方角：対応表だけで方角が分かる', async () => {
    const inst = gen('compass');
    const base = inst.manual.base.find((x) => x.color === inst.hint.color);
    assert(base, '色の行がある');
    const shift = inst.manual.shiftMarks.indexOf(inst.hint.mark) >= 0 ? 1 : 0;
    const at = D.DIRS.findIndex((d) => d.id === base.dir);
    assertEqual(D.DIRS[(at + shift) % D.DIRS.length].id, inst.answer.dir, '対応表の答えが正解と一致');
  });

  // ---- ⑤ 水平キープ ----

  await r.test('水平キープ：範囲内で目標秒数だけ保てば解除できる', async () => {
    const inst = gen('level');
    let res;
    for (let i = 0; i < 20 && !(res && res.solved); i++) {
      res = judge(inst, { type: 'tilt', deg: 0, dtMs: 500 });
    }
    assertEqual(res.solved, true, '解除できる');
  });

  await r.test('水平キープ：範囲から外れると溜まりが戻る（ミスにはしない）', async () => {
    const inst = gen('level');
    judge(inst, { type: 'tilt', deg: 0, dtMs: 500 });
    assert(inst.progress.holdMs > 0, '溜まる');
    const res = judge(inst, { type: 'tilt', deg: inst.answer.toleranceDeg + 10, dtMs: 500 });
    assertEqual(inst.progress.holdMs, 0, '振り出しに戻る');
    assertEqual(!!res.miss, false, '手が揺れただけでミスにはしない');
  });

  await r.test('水平キープ：対応表だけで秒数と範囲が分かる', async () => {
    const inst = gen('level');
    const row = inst.manual.rows.find((x) => x.mark === inst.hint.mark);
    assert(row, '記号の行がある');
    assertEqual(row.seconds, inst.answer.seconds, '秒数が一致');
    assertEqual(row.toleranceDeg, inst.answer.toleranceDeg, '範囲が一致');
  });

  // ---- ⑥ リズム合わせ ----

  await r.test('リズム合わせ：決められた拍だけを叩けば解除できる', async () => {
    const inst = gen('rhythm');
    assertEqual(judge(inst, { type: 'taps', beats: inst.answer.beats.slice() }).solved, true, '解除できる');
  });

  await r.test('リズム合わせ：叩く拍が違うとミス（多すぎても少なすぎても）', async () => {
    const a = gen('rhythm');
    assertEqual(judge(a, { type: 'taps', beats: [0, 1, 2, 3, 4, 5, 6, 7] }).miss, true, '全部叩いたらミス');
    const b = gen('rhythm');
    assertEqual(judge(b, { type: 'taps', beats: [] }).miss, true, '1つも叩かなくてもミス');
  });

  await r.test('リズム合わせ：叩く順番が前後しても、拍が合っていれば解除', async () => {
    // 拍そのものが合っていればよい（送られてくる順番に意味は持たせない）
    const inst = gen('rhythm');
    const shuffledBeats = inst.answer.beats.slice().reverse();
    assertEqual(judge(inst, { type: 'taps', beats: shuffledBeats }).solved, true, '解除できる');
  });

  await r.test('リズム合わせ：対応表だけで叩く拍が分かる', async () => {
    const inst = gen('rhythm');
    const row = inst.manual.rows.find((x) => x.mark === inst.hint.mark);
    assert(row, '記号の行がある');
    assertEqual(row.beats.join(','), inst.answer.beats.join(','), '叩く拍が一致');
  });

  // ---- ⑧ ポーズ指定 ----

  await r.test('ポーズ指定：指示のポーズなら解除、違えばミス', async () => {
    const inst = gen('pose');
    const other = D.POSES.find((p) => p.id !== inst.answer.pose).id;
    assertEqual(judge(inst, { type: 'pose', pose: other }).miss, true, '違うポーズはミス');
    assertEqual(judge(inst, { type: 'pose', pose: inst.answer.pose }).solved, true, '合えば解除');
  });

  await r.test('ポーズ指定：対応表だけでポーズが分かる', async () => {
    const inst = gen('pose');
    const row = inst.manual.rows.find((x) => x.color === inst.hint.color);
    assert(row, '色の行がある');
    assertEqual(row.pose, inst.answer.pose, 'ポーズが一致');
  });

  // ---- ⑨ 分割暗号 ----

  await r.test('分割暗号：マニュアル役の数だけ暗号が分かれる', async () => {
    const inst = gen('cipher', seeded(3), { manualHolders: 3 });
    assertEqual(inst.manual.parts.length, 3, '3人ぶんに分かれる');
    const joined = inst.manual.parts.map((p) => p.text).join('');
    assertEqual(joined, inst.answer.code, 'つなげると答えになる');
    // 1人ぶんだけでは答えにならない＝相談が必須
    inst.manual.parts.forEach((p) => {
      assert(p.text.length < inst.answer.code.length, '1人ぶんでは足りない');
    });
  });

  await r.test('分割暗号：正しいコードで解除、違えばミス。小文字でも通る', async () => {
    const inst = gen('cipher', seeded(4), { manualHolders: 2 });
    assertEqual(judge(inst, { type: 'code', text: 'ZZZZ' }).miss, true, '違うコードはミス');
    assertEqual(judge(inst, { type: 'code', text: inst.answer.code.toLowerCase() }).solved, true,
      '小文字で打っても通る（打ち間違いで理不尽に減らさない）');
  });

  await r.test('分割暗号：紛らわしい文字を使わない', async () => {
    // 0とO、1とIを口で伝えるのは事故のもと。部屋コードと同じ方針
    for (let i = 0; i < 20; i++) {
      const inst = gen('cipher', seeded(100 + i), { manualHolders: 2 });
      assert(!/[0OIL1]/.test(inst.answer.code), '0・O・I・L・1 を使わない：' + inst.answer.code);
    }
  });

  // ---- ⑩ イエスノー解錠 ----

  await r.test('イエスノー解錠：質問すると はい／いいえ／わからない が返る', async () => {
    const inst = gen('yesno');
    const q = inst.hint.questions[0];
    const res = judge(inst, { type: 'ask', question: q });
    assertEqual(res.ok, true, '質問できる');
    assertEqual(inst.progress.asked.length, 1, '聞いたことが残る');
    assert(['yes', 'no', 'unknown'].indexOf(inst.progress.asked[0].a) >= 0, '3つのどれかで答える');
    assertEqual(inst.progress.left, D.YESNO_MAX_QUESTIONS - 1, '聞ける回数が減る');
  });

  await r.test('イエスノー解錠：同じ質問を繰り返しても回数は減らない', async () => {
    const inst = gen('yesno');
    const q = inst.hint.questions[0];
    judge(inst, { type: 'ask', question: q });
    const before = inst.progress.left;
    const res = judge(inst, { type: 'ask', question: q });
    assertEqual(res.note, 'alreadyAsked', '聞いた質問だと分かる');
    assertEqual(inst.progress.left, before, '回数は減らない');
  });

  await r.test('イエスノー解錠：聞ける回数を使い切ったら、それ以上は聞けない', async () => {
    const inst = gen('yesno');
    inst.hint.questions.slice(0, D.YESNO_MAX_QUESTIONS).forEach((q) => {
      judge(inst, { type: 'ask', question: q });
    });
    assertEqual(inst.progress.left, 0, '使い切る');
    const res = judge(inst, { type: 'ask', question: inst.hint.questions[D.YESNO_MAX_QUESTIONS] });
    assertEqual(res.note, 'noMoreQuestions', 'もう聞けないと分かる');
    // それでも答えは出せる（詰みにしない）
    assertEqual(judge(inst, { type: 'guess', name: inst.answer.name }).solved, true, '答えは出せる');
  });

  await r.test('イエスノー解錠：選択肢に正解が必ず入っている', async () => {
    for (let i = 0; i < 20; i++) {
      const inst = gen('yesno', seeded(200 + i));
      assert(inst.hint.choices.indexOf(inst.answer.name) >= 0, '正解が選択肢にある');
      assert(inst.hint.choices.length >= 3, '選択肢が3つ以上ある');
    }
  });

  await r.test('イエスノー解錠：マニュアル役がいなくても遊べる', async () => {
    const inst = gen('yesno');
    assertEqual(inst.manual, null, '対応表を持たない（答えるのはアプリ）');
    assertEqual(D.moduleById('yesno').noManualNeeded, true, 'マニュアル不要の印が付いている');
  });

  // ---- 設定とモジュールの選ばれ方 ----

  await r.test('設定は端末の言い値を鵜呑みにせず、枠に収める', async () => {
    const c = D.normalizeConfig({ moduleCount: 99, strikes: 99, timerSec: 999999, mode: 'なにこれ' });
    assertEqual(c.moduleCount, D.MAX_MODULES, 'モジュール数は8まで');
    assertEqual(c.strikes, D.MAX_STRIKES, 'ミス上限も枠に収まる');
    assertEqual(c.mode, D.MODE.NORMAL, '知らない遊び方は通常に寄せる');
    assertEqual(D.normalizeConfig({ moduleCount: 1 }).moduleCount, D.MIN_MODULES, '4個より少なくできない');
    assertEqual(D.normalizeConfig({}).strikes, 3, '既定のミス上限は3回');
  });

  await r.test('同じ種類ばかりが並ばない（全種類を1周してから2周目に入る）', async () => {
    const cfg = D.normalizeConfig({ moduleCount: 5, allowPhysical: true, allowCamera: true });
    for (let i = 0; i < 20; i++) {
      const mods = D.pickModules(cfg, 2, seeded(300 + i));
      const kinds = new Set(mods.map((m) => m.type));
      assertEqual(kinds.size, mods.length, '5個とも違う種類になる');
    }
  });

  await r.test('選べる種類より多く頼まれたら、2周目で埋める', async () => {
    // マニュアル役0人・マニュアルありだと候補が1種類しかない
    const cfg = D.normalizeConfig({ moduleCount: 4, manual: true });
    const mods = D.pickModules(cfg, 0);
    assertEqual(mods.length, 4, '頼まれた数はそろえる');
    assert(mods.every((m) => m.type === 'yesno'), '候補の中から埋める');
    // 同じ種類でも、問題は1つずつ作り直される
    assertEqual(new Set(mods.map((m) => m.uid)).size, 4, 'それぞれ別のモジュールとして載る');
  });

  await r.test('対応表は、マニュアル役みんなで分け合う', async () => {
    const split = D.splitManual(['a', 'b', 'c', 'd', 'e'], ['m1', 'm2']);
    assertEqual(split.m1.length + split.m2.length, 5, '全部どちらかに配られる');
    assert(split.m1.length > 0 && split.m2.length > 0, '1人に偏らせない');
    // 誰も持っていない対応表があると、そのモジュールは詰む
    const all = split.m1.concat(split.m2).sort().join(',');
    assertEqual(all, 'a,b,c,d,e', '取りこぼしがない');
  });

  await r.test('公開してよい進み具合には、中身が一切入らない', async () => {
    const cfg = D.normalizeConfig({ moduleCount: 5, allowPhysical: true, allowCamera: true });
    const mods = D.pickModules(cfg, 2);
    const pub = D.publicProgress(mods, 2, 3);
    assertEqual(pub.total, 5, '本数は出す');
    pub.modules.forEach((m) => {
      assertEqual(m.hint, undefined, 'hint は出さない');
      assertEqual(m.manual, undefined, '対応表も出さない');
      assertEqual(m.answer, undefined, '答えも出さない');
      assert(m.name, '名前だけは出す（大画面で「何に挑んでいるか」が分かるように）');
    });
  });

  r.finish();
})();
