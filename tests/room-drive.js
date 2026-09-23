// tests/room-drive.js — 本物の進行役を、決着まで回す（指示60 で now-line.js から切り出した）
//
// **これはスイートではない**（createRunner を持たない）。
// tests/now-line.js（いま何をするかの帯）と tests/clear-fx.js（クリア演出）が**同じこれを使う**——
// 写すと、ゲームを足した日に片方だけ進め方が古びる（落とし穴1）。
//
// 本物の進行役（*-room.js）を本物の操作で進め、締め切りは w.deadline を過去へずらして追い越す
//（実時間を待たない・落とし穴24）。判定も進行も本物のまま（落とし穴25）。

const NAMES = ['あき', 'びび', 'ちか', 'でん', 'えみ', 'ふう'];

function 部屋を作る(n) {
  const members = new Map();
  for (let i = 0; i < n; i++) {
    const id = 'm' + (i + 1);
    members.set(id, { id, name: NAMES[i], role: 'player', connected: true, socketId: 's' + id });
  }
  return { code: 'ABC234', members, state: { phase: 'lobby', game: null, data: {} } };
}

/**
 * 進行役を1手ぶん進める。
 *
 * **ゲームごとに、本物の操作で進める。**「誰かが何かする」を総当たりで送るだけだと、
 * クイズ王の4つは `play` から一歩も動かない（答えも早押しも送っていないので当然）。
 * そこで止めると「段階を2つ以上通れている」の見張りが赤くなる——
 * **それは実装ではなく、進め方が足りないという赤**（落とし穴10-b）。
 *
 * 締め切りは `w.deadline` を過去にずらして追い越す。**進行役は本物のまま**で、
 * 「時間が来た」という事実だけを先に作る（実時間を待つと1件で数分かかる・落とし穴24）。
 */
function すすめる(d, room, gameId, w) {
  const ids = Array.from(room.members.keys()).filter((id) => id !== 'tv');
  const v = d.publicView(room);

  if (gameId === 'quizrush') {
    ids.forEach((id) => {
      const mine = d.privateFor(room, id) || {};
      const s = mine.rush || {};
      // 難易度を選んでいなければ選ぶ。問題が出ていれば答える（正解でなくてよい）
      if (!s.question) { try { d.submitAction(room, id, null, { targetId: 'easy' }); } catch (e) {} }
      else { try { d.submitVote(room, id, null, { targetId: 0 }); } catch (e) {} }
    });
  } else if (gameId === 'quizlist') {
    ids.forEach((id) => {
      const mine = d.privateFor(room, id) || {};
      if (mine.list && mine.list.yourTurn) {
        try { d.submitVote(room, id, null, { targetId: 'こたえ' + Math.min(9, ids.indexOf(id)) }); } catch (e) {}
      }
    });
  } else if (gameId === 'quizreveal' || gameId === 'buzzer') {
    // 早押し系：押してから答える。
    // **正解を送る。**外し続けると勝ち数が伸びず、早押しトーナメントは
    // `play` から一歩も出ない（対戦が終わらないので break にも決着にも行かない）。
    // 正解の位置は進行役の中にしか無いので、検査からは中を覗く——
    // **判定するのは本物の進行役のまま**（検体を手で作るのとは違う）
    const 押した = (v.reveal && v.reveal.buzzedId) || (v.buzzer && v.buzzer.buzzedId);
    if (!押した) {
      for (const id of ids) {
        const r = (function () { try { return d.submitAction(room, id, null, {}); } catch (e) { return null; } })();
        if (r && r.ok) break;
      }
    } else {
      const q = (w.buzzer && w.buzzer.q) || (w.reveal && w.reveal.questions
        && w.reveal.questions[w.reveal.index]) || null;
      const 正解 = q && q.correct != null ? q.correct : 0;
      try { d.submitVote(room, 押した, null, { targetId: 正解 }); } catch (e) {}
    }
  } else if (gameId === 'falsetrue') {
    /**
     * False or True は、**段階ごとに押す人と押すものが違う**。
     * 既定の枝（全員に空の submitAction）では一歩も進まないので、
     * ここで本物の操作を送る（落とし穴10-c：分岐があるなら、その入力を作りに行く）。
     * 判定も進行も本物の進行役のまま
     */
    if (v.phase === 'pick' && v.holderId) {
      try { d.submitAction(room, v.holderId, null, { pick: (v.cases || [])[0] }); } catch (e) {}
    } else if (v.phase === 'peek' && v.holderId) {
      try { d.submitAction(room, v.holderId, null, { seen: true }); } catch (e) {}
    } else if (v.phase === 'talk') {
      [v.holderId, v.oppId].filter(Boolean).forEach((id) => {
        try { d.submitAction(room, id, null, { talkDone: true }); } catch (e) {}
      });
    } else if (v.phase === 'decide' && v.oppId) {
      try { d.submitAction(room, v.oppId, null, { keep: true }); } catch (e) {}
    }
    // face と open は誰も待っていない。下の締め切り追い越しにまかせる
  } else if (gameId === 'shinka') {
    /**
     * 進化じゃんけんは「優勝か10分」まで終わらない。手を出さないと、
     * 締め切りの追い越しだけでは段が動かず、永久に回り続ける（決着に届かない）。
     * **1人目はグー、ほかはチョキ**——1人目が勝ち上がって優勝する（判定は本物の進行役のまま）
     */
    if (v.phase === 'throw') {
      ids.forEach((id, i) => { try { d.submitAction(room, id, null, { hand: i === 0 ? 'g' : 'c' }); } catch (e) {} });
    }
    // 上の段でAIと当たると、グーが負けることがある（AIの手は本物の進行役が決める）。
    // 60手で優勝に届かなければ「10分が来た」という事実を先に作る——締め切りの追い越しと同じ形。
    // これで時間切れの決着（いちばん上の段の人）の道も通る
    w.__手数 = (w.__手数 || 0) + 1;
    if (w.__手数 > 60 && w.endsAt > Date.now()) w.endsAt = Date.now() - 1;
  } else {
    ids.forEach((id) => { try { d.submitAction(room, id, null, {}); } catch (e) {} });
  }

  /**
   * 締め切りを追い越す（実時間を待たない・落とし穴24）。
   *
   * **ただし、押した直後は追い越さない。** 押した人の答えの締め切りまで
   * 一緒に過去へ送ると、`advance` が「押したのに答えなかった」と見なして
   * その人を締め出す——**答えが一度も数えられず、早押しは永久に `play` のまま**になる。
   * 押されている間は、時間を進めずに答えさせる
   */
  const 誰か押している = !!((w.reveal && w.reveal.buzzed) || (w.buzzer && w.buzzer.buzzed));
  if (!誰か押している && w.deadline && w.deadline > Date.now()) w.deadline = Date.now() - 1;
  // つぎつぎクイズは、協力形式だと時間切れでも脱落しない。
  // **全体の締め切り**まで追い越さないと `play` から出ない
  if (w.list) { w.list.turnEndsAt = Date.now() - 1; w.list.overallEndsAt = Date.now() - 1; }
  try { if (d.advance) d.advance(room); } catch (e) {}
}

module.exports = { NAMES, 部屋を作る, すすめる };
