// tests/big-screen.js — 正本 §11「大画面」の見張り（指示55）
//
// 大画面は「1台を全員で同時に見る唯一の画面」で、
// スマホの規則をそのまま持ってくると**共通のものが人数分ならぶ**。
// 指示55の棚卸しで、9モードすべてに同じ穴が出ていた。
//
// ここで見るのは、**ブラウザを立てずに確かめられる決まり**だけ：
//   ・共通の時計を、全進行役が名乗っているか（§11-4）
//   ・その名乗りが、実際の締め切りの意味と合っているか
// 見た目（文字の大きさ・主役の大きさ）は 1280×720 の実測で別に見る。
//
// **手書きの一覧を持たない**（落とし穴4）。ゲームの一覧は GAME_DRIVERS から導く。

const { GAME_DRIVERS } = require('../realtime');
const { createRunner, assert, assertEqual } = require('./harness');

(async function main() {
  const r = createRunner('big-screen：正本§11の見張り');

  // 進行役は4ゲームで1つを共有していたりするので、実体で重複を畳む
  function 進行役たち() {
    const out = [];
    Object.keys(GAME_DRIVERS).forEach((gameId) => {
      const d = GAME_DRIVERS[gameId].driver;
      const 既に = out.find((x) => x.driver === d);
      if (既に) { 既に.games.push(gameId); return; }
      out.push({ driver: d, games: [gameId] });
    });
    return out;
  }

  await r.test('§11-4：全部の進行役が、時計の種類を名乗る', async () => {
    // **不在で表さない**（落とし穴36）。名乗らない進行役があると、
    // realtime.js の 時計をそえる() が安全側（時計を出さない）に倒れて、
    // 「締め切りがあるのに大画面に時計が出ない」が静かに戻る
    const 名乗らない = 進行役たち()
      .filter((x) => typeof x.driver.clockKind !== 'function')
      .map((x) => x.games.join('／'));
    assertEqual(名乗らない.length, 0,
      '時計の種類を名乗っていない進行役がある：' + 名乗らない.join('・'));
    console.log('    進行役：' + 進行役たち().length + '本（ゲーム ' + Object.keys(GAME_DRIVERS).length + '個）');
  });

  await r.test('§11-4：時計の種類は play・turn・tick の3つだけ（指示55-①）', async () => {
    // **正本は realtime.js の CLOCK_KINDS。**ここに一覧を手で並べない（落とし穴4）
    const { CLOCK_KINDS } = require('../realtime.js');
    assertEqual(CLOCK_KINDS.join(','), 'play,turn,tick', '種類は3つ');
    進行役たち().forEach((x) => {
      const got = x.driver.clockKind({});
      assert(CLOCK_KINDS.indexOf(got) !== -1,
        x.games.join('／') + '：知らない種類「' + got + '」を返した');
    });
  });

  await r.test('§11-4：どの進行役も、既定では時計を消さない（逆向き・落とし穴20）', async () => {
    // もとは「tick を返すのはとくとくクイズだけ」と書いていた。
    // 指示55-① で すごろくも（結果を見せる間に）tick を返すようになったので、
    // **守りたかった性質そのもの**に書き直した——
    // 「そのゲームの時計が丸ごと消える」を止めたいのであって、
    // 「tick を返す進行役は1本だけ」を守りたいわけではない（落とし穴10-d の親戚）。
    //
    // 空の部屋＝段階がまだ無い状態で tick を返すなら、
    // それは段階によらず消しているということ
    const 消す = 進行役たち()
      .filter((x) => x.driver.clockKind({}) === 'tick')
      .map((x) => x.games.join('／'));
    assertEqual(消す.length, 0,
      '段階によらず時計を消している進行役がある：' + 消す.join('・'));
  });

  await r.test('§11-4：すごろくの手番は turn、結果を見せる間は tick（指示55-①）', async () => {
    // **具体の段階名で書く**（落とし穴10-a：実装の一覧を借りない）。
    // 手番（turnSec）は押されているのが1人だけなので、420pxの数字で盤を覆わない。
    // 結果・イベント・判定は 2800〜3200ms なので、数えると毎回「2」「1」が全面に出る
    const sg = GAME_DRIVERS.sugotoll.driver;
    assertEqual(sg.clockKind({ sugoroku: { phase: 'turn' } }), 'turn', '手番は turn');
    assertEqual(sg.clockKind({ sugoroku: { phase: 'buy' } }), 'turn', '売り札を買うのも turn');
    assertEqual(sg.clockKind({ sugoroku: { phase: 'result' } }), 'tick', '駒が動くのを見る間は tick');
    assertEqual(sg.clockKind({ sugoroku: { phase: 'event' } }), 'tick', 'イベントを見る間は tick');
    assertEqual(sg.clockKind({ sugoroku: { phase: 'judge' } }), 'tick', '申告の判定を見る間は tick');
    // **もう一方の入力も必ず与える**（落とし穴10-c）
    assertEqual(sg.clockKind({ sugoroku: { phase: 'roll' } }), 'play', '全組が同時に振る段階は play');
    assertEqual(sg.clockKind({ sugoroku: { phase: 'split' } }), 'play', '分け合う段階は play');
    assertEqual(sg.clockKind({}), 'play', '段階がまだ無ければ play');
  });

  await r.test('§11-4：とくとくクイズの「次の1文字」は、数えない', async () => {
    // ここは**具体の値で書く**（落とし穴10-a：実装側の定数を借りると、
    // 定数を緩めた日に検査も一緒に緩む）。
    //
    // 数えてしまうと何が起きるか：とくとくの締め切りは「次の1文字が出る時刻」で
    // 1文字あたり 870〜2222ms。Math.ceil(ms/1000) が常に 1 か 2 になるので、
    // 420px の巨大カウントダウンが、伏せ字の問題文の上に1〜2秒ごとに出続ける
    const quiz = GAME_DRIVERS.quizreveal.driver;
    assertEqual(quiz.clockKind({ quiz: { variant: 'quizreveal', reveal: { buzzed: null } } }),
      'tick', '押される前は数えない');
    // **もう一方の入力も必ず与える**（落とし穴10-c：分岐を書いたら両側を試す）。
    // 押されたあとは「答える持ち時間」なので、人が待っている＝数えてよい
    assertEqual(quiz.clockKind({ quiz: { variant: 'quizreveal', reveal: { buzzed: 'm1' } } }),
      'play', '押されたあとは数える');
    ['quizrush', 'quizlist', 'buzzer'].forEach((v) => {
      assertEqual(quiz.clockKind({ quiz: { variant: v, reveal: { buzzed: null } } }),
        'play', v + ' は数える');
    });
  });

  await r.test('§11-4：巨大カウントダウンを出すのは play だけ（端末が当てにいかない）', async () => {
    // **種類は進行役が言う。**端末が「15秒より短ければ手番だろう」と
    // 締め切りの中身を当てにいくと、意味を変えた日に遠くで壊れる（正本 §11-4）。
    // だから画面側は `v.clock.kind` だけを見ていること、を実装の文字列で固定する
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const 本体 = html.slice(html.indexOf('function bigCountdownTick'),
      html.indexOf('setInterval(bigCountdownTick'));
    assert(本体.length > 200, 'bigCountdownTick の本体を切り出せている（実際:' + 本体.length + '文字）');
    assert(本体.indexOf("kind !== 'play'") !== -1,
      '巨大カウントダウンが種類を見ていない（turn でも出てしまう）');
  });

  // ---- §11-2：協力と対戦で画面を分ける ----

  await r.test('§11-2：MODES の宣言と、進行役が名乗る性質が一致する（両方向）', async () => {
    // 画面が読むのは**サーバーの `v.coop`**（modeId はゲーム中に届かないため）。
    // `MODES.coopLayout` は棚・設定の側の宣言なので、**ずれたら赤くする**（落とし穴20）。
    // 片方だけ直すと「協力版なのに対戦版の画面が出る」が、エラーも出さずに起きる
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const 宣言 = {};
    // 正規表現は使わない——エスケープで静かに潰れると、
    // 「読めていないのに0件で緑」になる（落とし穴10-e）。行を切って読む
    html.split('{id:"').slice(1).forEach((chunk) => {
      const 行 = chunk.split(String.fromCharCode(10))[0].split(String.fromCharCode(13))[0];
      const id = chunk.slice(0, chunk.indexOf('"'));
      const m = 行.indexOf('coopLayout:');
      if (m === -1) return;
      宣言[id] = 行.slice(m + 'coopLayout:'.length).trim().startsWith('true');
    });
    assert(Object.keys(宣言).length >= 2,
      'MODES から coopLayout を読み出せていない（index.html の書式が変わった？）');

    const Bomb = require('../bomb-room.js');
    const BombLogic = require('../public/js/bomb-logic.js');
    const 実際 = {};
    [['bomb-coop', BombLogic.MODE.COOP], ['bomb-race', BombLogic.MODE.RACE]].forEach(([modeId, mode]) => {
      const room = {
        code: 'TEST01', state: { phase: 'playing', game: 'bomb', data: {} },
        members: new Map([
          ['m1', { id: 'm1', name: 'あき', role: 'player', connected: true }],
          ['m2', { id: 'm2', name: 'びび', role: 'player', connected: true }]
        ])
      };
      const res = Bomb.startGame(room, {
        mode: mode, counts: { easy: 2 }, lives: 3, timerSec: 0,
        topics: Array.from({ length: 6 }, (_, i) => ({ name: 'お題' + i, desc: 'せつめい' + i }))
      }, {});
      assert(res.ok, modeId + ' が始められない：' + JSON.stringify(res));
      実際[modeId] = Bomb.publicView(room).coop;
    });

    // 行き：宣言した通りに名乗っているか
    Object.keys(宣言).forEach((modeId) => {
      assert(実際[modeId] !== undefined, modeId + '：進行役が coop を名乗っていない');
      assertEqual(実際[modeId], 宣言[modeId],
        modeId + '：MODES の宣言（' + 宣言[modeId] + '）と、進行役の名乗り（' + 実際[modeId] + '）が食い違う');
    });
    // 帰り：名乗っているのに宣言が無いモードが無いか
    Object.keys(実際).forEach((modeId) => {
      assert(宣言[modeId] !== undefined, modeId + '：MODES に coopLayout の宣言が無い');
    });
    // **不在で表さない**（落とし穴36）：false も明示で書いてあること
    assertEqual(宣言['bomb-race'], false, '競争版にも false を明示で書く');
    console.log('    照合したモード：' + Object.keys(宣言).join('・'));
  });

  // ---- §11-3：一番大きい枠に、知らない段階名を書かせない ----

  await r.test('§11-3：すごろくの「手番のある段階」が、実在する段階だけを指している', async () => {
    // **除く側を数えるのをやめ、言ってよい側を並べた**（落とし穴4）。
    // ただし並べた名前が幽霊だと、静かに1つも当たらなくなる（落とし穴32の型）
    const fs2 = require("fs");
    const path2 = require("path");
    const html = fs2.readFileSync(path2.join(__dirname, "..", "public", "index.html"), "utf8");
    const 取る = (名) => {
      const i = html.indexOf("var " + 名 + " = ");
      assert(i > 0, 名 + " が index.html に無い");
      const j = html.indexOf(名 === "SUGO_TURN_PHASES" ? "]" : "}", i);
      return html.slice(i, j);
    };
    const 段階 = 取る("SUGO_BIG_PHASE");
    const 手番 = 取る("SUGO_TURN_PHASES");
    const 名前 = (手番.match(/'[a-z]+'/g) || []).map((x) => x.replace(/'/g, ""));
    assert(名前.length >= 2, "手番のある段階を読み出せていない（書式が変わった？）");
    const 幽霊 = 名前.filter((n) => 段階.indexOf(n + ":") === -1);
    assertEqual(幽霊.length, 0, "段階の表に無い名前を指している：" + 幽霊.join("・"));
    console.log("    手番のある段階：" + 名前.join("・"));
  });

  // ---- §11-6：大画面に秘密を映さない ----

  await r.test('§11-6：どの進行役も、大画面には秘密を1つも配らない', async () => {
    /**
     * 棚卸しで (3) は9モードとも「可」だったが、**守っているのは実装であって
     * 見張りではなかった**。tests/secrecy-gates.js は手渡しの3画面しか見ておらず、
     * 大画面については realtime-*.js に散らばった「privateFor が null」が
     * 4つあるだけで、**8本の進行役を横断して確かめる門が無かった**。
     *
     * 画面の側で「秘密の語が出ていないか」を掃く形は採らない——
     * 語を並べる一覧が要り、必ず腐る（落とし穴4）。
     * **配られていなければ、画面がどう作られていても映りようがない。**
     * だから元栓の側を見る。
     */
    const 配る = [];
    進行役たち().forEach((x) => {
      const dr = x.driver;
      if (typeof dr.privateFor !== 'function') {
        配る.push(x.games.join('／') + '：privateFor が無い');
        return;
      }
      // 部屋に「その進行役の状態が無い」＝まだ始まっていない形で呼ぶ。
      // **どの進行役も、知らない memberId には何も返さないのが正しい**
      const 空の部屋 = { code: 'TEST01', state: { phase: 'lobby', game: null, data: {} }, members: new Map() };
      let got;
      try { got = dr.privateFor(空の部屋, 'tv'); } catch (e) { got = '（例外：' + e.message + '）'; }
      if (got !== null && got !== undefined) {
        配る.push(x.games.join('／') + '：' + JSON.stringify(got).slice(0, 60));
      }
    });
    assertEqual(配る.length, 0,
      '大画面（プレイヤーでない端末）に何かを配っている進行役がある：' + 配る.join('・'));
  });

  await r.test('§11-6：大画面は「あなた」を使わない（卓の全員が同じ1枚を見ている）', async () => {
    // 48-2 の結論。大画面には「あなた」が居ない——見ているのは全員で、誰のことか決まらない。
    // **markup と、大画面の描画が組む文字列の両方**を見る
    const fs2 = require('fs');
    const path2 = require('path');
    const html = fs2.readFileSync(path2.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // 大画面の器（#scr-rt-big）の中の地の文
    const i = html.indexOf('id="scr-rt-big"');
    assert(i > 0, '大画面の器が見つからない（書式が変わった？）');
    const j = html.indexOf('<div class="screen"', i + 10);
    const 器 = html.slice(i, j > 0 ? j : i + 4000);
    assertEqual(器.indexOf('あなた'), -1, '大画面の器に「あなた」がある');
    // 描画関数の中（renderRtBig* が組む文字列）
    const 描画 = [];
    // **renderRtBig そのものを忘れない**——人狼はどの分岐にも入らず、
    // この関数の素通り本体が大画面になる。最初これを落として、
    // わざと「あなた」を混ぜた変異が素通りした（落とし穴10-f）
    ['renderRtBig', 'renderRtBigFalsetrue', 'renderRtBigRcard', 'renderRtBigShinka', 'renderRtBigSugoroku',
      'renderRtBigQuiz', 'renderRtBigAuction',
      'renderRtBigWordwolf', 'renderRtBigBomb', 'renderRtBigDefuse',
      // 指示64：待合（A3・B2）・名簿の1行・順位表・入場の知らせも、TVに字を組む
      'renderBigLobby', 'bigRosterHtml', 'bigRuleCardsHtml', 'bigRowHtml', 'bigRankHtml', 'bigEntryShow'].forEach((fn) => {
      const a = html.indexOf('function ' + fn + '(');
      assert(a > 0, fn + ' が見つからない（名前が変わった？）');
      // 次の function まで
      const b = html.indexOf('\n  function ', a + 10);
      const 本体 = html.slice(a, b > 0 ? b : a + 6000);
      if (本体.indexOf('あなた') !== -1) 描画.push(fn);
    });
    assertEqual(描画.join('・'), '', '大画面の描画が「あなた」を組み立てている');
  });

  // ===================== 指示64 =====================
  const fs64 = require('fs');
  const path64 = require('path');
  // **行末をそろえてから読む**。git が CRLF で取り出した作業ツリーでは「改行＋  }＋改行」が見つからず、
  // 関数の切り出しが壊れて全部赤になった（変異の作業ツリーで分かった）
  const html64 = fs64.readFileSync(path64.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  /** index.html の中の関数を、その本文のまま取り出して動かす（実装の写しを書かない・落とし穴10-a） */
  function 関数を取り出す(名前, 前置き) {
    const a = html64.indexOf('function ' + 名前 + '(');
    assert(a > 0, 名前 + ' が見つからない（名前が変わった？）');
    const b = html64.indexOf('\n  }\n', a);
    return new Function((前置き || '') + html64.slice(a, b + 4) + '\nreturn ' + 名前 + ';')();
  }
  /** 関数1つの字だけを切り出す（動かさない）。見つからなければ赤にする（読めなかったものを黙って通さない・落とし穴10-e） */
  function 関数の字(名前) {
    const a = html64.indexOf('function ' + 名前 + '(');
    assert(a > 0, 名前 + ' が見つからない（名前が変わった？）');
    return html64.slice(a, html64.indexOf('\n  }\n', a) + 4);
  }
  function MODESを読む() {
    const a = html64.indexOf('var MODES = [');
    const b = html64.indexOf('\n  ];', a);
    assert(a > 0 && b > a, 'MODES が見つからない');
    return new Function('return ' + html64.slice(a + 'var MODES = '.length, b + 4))();
  }

  await r.test('64 B2：部屋で遊べるモードには、TVのルールの札がちょうど3枚ある（両方向）', async () => {
    // 札は「遠くから一目で分かる」ための3つだけ。細かいことは手元のルール（MODES.bullets）に任せる。
    // **部屋で遊べるモード ⇔ 札がある** を両方向で見る（落とし穴20）：
    //   行き：遊べるのに札が無い → B2 の札の場所が空く
    //   帰り：遊べないモード（手渡しだけ・隠しモード）に札がある → 誰も見ない文言が腐っていく（落とし穴33）
    const MODES = MODESを読む();
    const 部屋で遊べる = (m) => !m.hidden && !!m.game && !!GAME_DRIVERS[m.game];
    const 足りない = [], 余り = [], 形 = [];
    MODES.forEach((m) => {
      if (部屋で遊べる(m) && !m.tv) 足りない.push(m.id);
      if (!部屋で遊べる(m) && m.tv) 余り.push(m.id);
      if (!m.tv) return;
      if (!Array.isArray(m.tv) || m.tv.length !== 3) { 形.push(m.id + '：3枚でない'); return; }
      m.tv.forEach((c, i) => {
        const 字 = Array.from(String(c[1] || ''));
        if (!c[0]) 形.push(m.id + '#' + i + '：絵が無い');
        // 18字まで：TVの札1枚に、32px で2行に収まる長さ（実測は tools/big-census.js）
        if (!字.length || 字.length > 18) 形.push(m.id + '#' + i + '：' + 字.length + '字（' + c[1] + '）');
        if (/あなた|じぶん|自分/.test(c[1])) 形.push(m.id + '#' + i + '：二人称（' + c[1] + '）');
        if (/[０-９]/.test(c[1])) 形.push(m.id + '#' + i + '：全角数字（' + c[1] + '）');
      });
    });
    assert(MODES.filter(部屋で遊べる).length >= 20, '前提：部屋で遊べるモードが拾えている（' + MODES.filter(部屋で遊べる).length + '）');   // 型(b)
    assertEqual(足りない.join('・'), '', '部屋で遊べるのに、TVの札が無いモード');
    assertEqual(余り.join('・'), '', '部屋で遊べないのに、TVの札があるモード');
    assertEqual(形.join(' ／ '), '', 'TVの札の形');
  });

  await r.test('64 C2：表彰台に乗る人の決まり（1位のならびは全員上へ・5枚まで・6人以上なら C1）', async () => {
    const 台 = 関数を取り出す('bigPodiumRows', 'var BIG_PODIUM_MAX = 5;\n');
    const 行 = (順位) => 順位.map((x, i) => ({ id: 'p' + i, rank: x }));
    const 何人 = (順位) => { const t = 台(行(順位)); return t ? t.length : null; };
    // ふつう：1〜3位の3枚
    assertEqual(何人([1, 2, 3, 4, 5, 6]), 3, 'ふつうは1〜3位の3枚');
    // 1位が2人ならぶ：2人とも上の段（3位も上の段に入る＝同着を割らない）
    assertEqual(何人([1, 1, 3, 4, 5]), 3, '1位がならんでも、1〜3位までを上へ');
    // 1位が4人：全員上の段（札を縮めて4枚）
    assertEqual(何人([1, 1, 1, 1, 5, 6]), 4, '1位が4人ならんだら4枚');
    assertEqual(何人([1, 1, 1, 1, 1, 6]), 5, '1位が5人ならんだら5枚');
    // 1位が6人以上：C1（上の段を作らない）
    assertEqual(何人([1, 1, 1, 1, 1, 1, 7]), null, '1位が6人以上ならんだら C1');
    // 3位までで5人を超える時は、同着を割らずに2位までに狭める
    assertEqual(何人([1, 2, 3, 3, 3, 3, 7]), 2, '3位のならびが多い時は2位まで（同着を上と下に割らない）');
    assertEqual(何人([1, 2, 3, 3, 3, 6]), 5, '3位までで5人なら5枚');
    // 記録なし（rank null）だけ・人が少ない
    assertEqual(何人([null, null]), null, '全員が記録なしなら表彰台は作らない');
    assertEqual(何人([1, 2]), 2, '2人なら2枚');
    // **割らない**：上の段に入った順位は、下の段に1人も残らない
    const ならび = 行([1, 2, 2, 2, 5, 6, 7]);
    const 上 = 台(ならび);
    const 上の順位 = 上.map((x) => x.rank);
    ならび.filter((x) => 上.indexOf(x) === -1).forEach((x) => {
      assert(上の順位.indexOf(x.rank) === -1, x.rank + '位が上と下に割れている');
    });
  });

  await r.test('64 C2：順位表の置き方（C2／C1・下の段の列の数）', async () => {
    const 前置き = 'var BIG_PODIUM_MAX = 5;\n' +
      'function rankingHtml(rows){ return "<div class=\\"rk-view\\"><div class=\\"rk-list\\">" + rows.map(function(r){ return "<div class=\\"rk-row\\"></div>"; }).join("") + "</div></div>"; }\n' +
      // bigRankHtml が呼ぶ関数は、全部ここで一緒に切り出す（a9f0d14 で bigRankCols を足した時に
      // ここへ足し忘れ、「bigRankCols is not defined」のまま赤かった。変異の結果にも紛れていた）
      ['bigPodiumRows', 'bigRankCols'].map(関数の字).join('\n') + '\n';
    const 表 = 関数を取り出す('bigRankHtml', 前置き);
    const 行 = (順位) => 順位.map((x, i) => ({ id: 'p' + i, rank: x, name: 'n' + i }));
    const c2 = 表(行([1, 2, 3, 4, 5, 6, 7, 8]));
    assert(/data-shape="c2"/.test(c2) && /--rk-pod:3/.test(c2), '8人：表彰台3枚の C2（' + c2.slice(0, 80) + '）');
    assert(/data-cols="2"/.test(c2), '8人：下の段は2列');
    const 十六 = 表(行(Array.from({ length: 16 }, (_, i) => i + 1)));
    assert(/data-cols="3"/.test(十六) && /--rk-rows:5/.test(十六), '16人：下の13人は3列×5段（' + 十六.slice(0, 120) + '）');
    const c1 = 表(行([1, 1, 1, 1, 1, 1, 1, 1]));
    assert(/data-shape="c1"/.test(c1) && /--rk-rows:4/.test(c1) && !/rk-podium/.test(c1), '1位が8人ならぶ：C1 の2列×4段');
    const 二十 = 表(行(Array.from({ length: 20 }, () => 1)));
    assert(/data-cols="3"/.test(二十), '20人が全員ならぶ：C1 を3列に');
  });

  await r.test('64 見直し：順位表の数字だけが数字の段（単位は添えの字）・「あがり」は短い言葉', async () => {
    // 「9本」「体力0」「12点」「1位」を丸ごと48pxのドットで組むと、「位・点・本・体力」が名前より重い
    // ドットの漢字になっていた。**数字だけを .rk-n に**、前後の言葉は .rk-vpre／.rk-vpost に分ける
    const 前置き = 'function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }\n' +
      'function faceOf(){ return ""; }\n';
    const 表 = 関数を取り出す('rankingHtml', 前置き);
    const html = 表([
      { id: 'a', rank: 1, name: 'あき', main: 'あがり' },
      { id: 'b', rank: 2, name: 'ひろ', main: '9本' },
      { id: 'c', rank: 3, name: 'ゆい', main: '体力0' },
      { id: 'd', rank: 10, name: 'ゆう', main: '36/40' },
      { id: 'e', rank: 11, name: 'まり', main: '🐤 ひよこ' }
    ]);
    // 型(b)：行が5つ組まれたことを先に見る
    assertEqual((html.match(/class="rk-row/g) || []).length, 5, '行が5つ');
    assert(/<span class="rk-n">9<\/span><span class="rk-vpost">本<\/span>/.test(html), '「9本」は数字だけが .rk-n、本は添え');
    assert(/<span class="rk-vpre">体力<\/span><span class="rk-n">0<\/span>/.test(html), '「体力0」は体力が添え、0 が .rk-n');
    assert(/<span class="rk-n">36\/40<\/span>/.test(html), '「36/40」は丸ごと数字');
    assert(/<span class="rk-n">10<\/span><span class="rk-vpost">位<\/span>/.test(html), '「10位」は 10 が数字、位は添え');
    assert(/class="rk-main is-word is-short">あがり</.test(html), '「あがり」（3字まで）は短い言葉');
    assert(/class="rk-main is-word">🐤 ひよこ</.test(html), '「🐤 ひよこ」は言葉（短くない）');
    // 端末と同じ部品なので、escape は分けた字ごとに（落とし穴43）
    const 毒 = 表([{ id: 'x', rank: 1, name: 'x', main: '<b>5</b>点' }]);
    assert(!/<b>/.test(毒), '数の欄の字は escape する（' + 毒.slice(0, 160) + '）');
  });

  await r.test('64 見直し：順位の欄の幅は表ぜんぶで1つ・内訳を落とせば2列に入るなら2列', async () => {
    const 前置き = 'var BIG_PODIUM_MAX = 5;\n' +
      'function rankingHtml(rows){ return "<div class=\\"rk-view\\"><div class=\\"rk-list\\">" + rows.map(function(r){ return "<div class=\\"rk-row\\"></div>"; }).join("") + "</div></div>"; }\n' +
      ['bigPodiumRows', 'bigRankCols'].map(関数の字).join('\n') + '\n';
    const 表 = 関数を取り出す('bigRankHtml', 前置き);
    const 行 = (順位, 内訳) => 順位.map((x, i) => ({ id: 'p' + i, rank: x, name: 'n' + i, note: 内訳 || null }));
    // 欄の幅：10位があれば表ぜんぶ2桁（表彰台も含む）、9位までなら1桁（分岐の両側・落とし穴10-c）
    assert(/data-pw="2"/.test(表(行(Array.from({ length: 16 }, (_, i) => i + 1)))), '16人（10位から下がある）：2桁');
    assert(/data-pw="1"/.test(表(行([1, 2, 3, 4, 5, 6, 7, 8]))), '8人：1桁');
    // 1位が10人ならび（C1）で内訳が長い（7字）：3列にしても内訳は落とすので、**内訳を落として2列**
    const 長い内訳 = 行([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 11, 12, 13, 14, 15, 16], '🟠 むずかしい');
    const c1 = 表(長い内訳);
    assert(/data-shape="c1"/.test(c1), 'C1 の形になっている（型b：' + c1.slice(0, 80) + '）');
    assert(/data-cols="2"/.test(c1) && /data-note="none"/.test(c1) && /--rk-rows:8/.test(c1),
      '内訳を落とせば2列×8段に入るので2列（いま：' + c1.slice(0, 120) + '）');
    // 2列に入らない時（17人以上のC1）は、これまでどおり3列
    const 二十 = 表(行(Array.from({ length: 20 }, () => 1), '🟠 むずかしい'));
    assert(/data-cols="3"/.test(二十), '20人ならび：3列');
  });

  await r.test('64 見直し：一枚看板の名前は .tv-nm で包む（字の節点をたどる・escape をほどかない）', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="m"></div>');
    const doc = dom.window.document;
    const 包む = new Function('document', 関数の字('bigWrapNames') + '\nreturn bigWrapNames;')(doc);
    const m = doc.getElementById('m');
    m.textContent = 'あき　VS　たかはしゆういちろう';
    包む(m, ['あき', 'たかはしゆういちろう', 'あきら', 'ひ']);
    const 包み = Array.from(m.querySelectorAll('.tv-nm')).map((x) => x.textContent);
    assertEqual(包み.join('|'), 'あき|たかはしゆういちろう', '2人の名前が包まれる（1字の名前は包まない）');
    assertEqual(m.textContent, 'あき　VS　たかはしゆういちろう', '字は変わらない');
    // 長い名前から先に当てる：「あきら」の中の「あき」を包まない
    m.textContent = 'あきら さんの番';
    包む(m, ['あき', 'あきら']);
    assertEqual(Array.from(m.querySelectorAll('.tv-nm')).map((x) => x.textContent).join('|'), 'あきら', '「あきら」を1つとして包む');
    // escape をほどかない：名前に < > があっても、要素にならない（落とし穴43）
    m.textContent = '<img src=x> さんの番';
    包む(m, ['<img src=x>']);
    assertEqual(m.querySelectorAll('img').length, 0, '名前の字が HTML にならない');
    assertEqual(m.querySelector('.tv-nm').textContent, '<img src=x>', '名前は字のまま包まれる');
    // すでに包んだ所は二重に包まない
    包む(m, ['<img src=x>']);
    assertEqual(m.querySelectorAll('.tv-nm').length, 1, '二重に包まない');
  });

  await r.test('64 見直し2：一枚看板の「数＋助数詞」だけを数字の段に（問題文・名前の数字は触らない）', async () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="m"></div>');
    const doc = dom.window.document;
    const 包む = new Function('document', 'var BIG_COUNTERS = ' + JSON.stringify(
      /var BIG_COUNTERS = '([^']+)'/.exec(html64)[1]) + ';\n' + 関数の字('bigWrapCounts') + '\nreturn bigWrapCounts;')(doc);
    const m = doc.getElementById('m');
    const 見る = (字, 前) => { m.innerHTML = ''; if (前) m.innerHTML = 前; else m.textContent = 字; 包む(m);
      return { n: Array.from(m.querySelectorAll('.tv-n')).map((x) => x.textContent), u: Array.from(m.querySelectorAll('.tv-unit')).map((x) => x.textContent), t: m.textContent }; };
    let r1 = 見る('3人 生きのこり');
    assertEqual(r1.n.join('|') + '/' + r1.u.join('|'), '3/人', '「3人 生きのこり」は 3 が数字、人が助数詞');
    assertEqual(r1.t, '3人 生きのこり', '字は変わらない');
    r1 = 見る('🔨 25枚');
    assertEqual(r1.n.join('|') + '/' + r1.u.join('|'), '25/枚', '「🔨 25枚」も包む');
    r1 = 見る('0 / 5個');
    assertEqual(r1.n.join('|'), '0 / 5', '「0 / 5個」は「0 / 5」を1つの数に');
    // 分岐の反対側：数のすぐ後ろに助数詞が無い数字は包まない（落とし穴10-c）
    assertEqual(見る('1年は何日？').n.length, 0, '問題文「1年は何日？」の数字は包まない');
    assertEqual(見る('日本で2番目に高い山は？').n.length, 0, '「2番目」も包まない');
    assertEqual(見る('', '<span class="tv-nm">kensho34</span> さんの番').n.length, 0, '名前の中の数字は包まない');
    // escape をほどかない（落とし穴43）
    m.textContent = '<img src=x>3人';
    包む(m);
    assertEqual(m.querySelectorAll('img').length, 0, '字が HTML にならない');
  });

  await r.test('64 見直し2：すごろくの決着の行は「あと◯」の1回だけ（距離を2回言わない）・共有の駒があがった回はコインで', async () => {
    const 行 = 関数を取り出す('sugoRankRows', '');
    const rows = 行({ cells: 40, coinsUsed: true, players: [
      { id: 'a', rank: 1, name: 'ゆい', goaled: true, pos: 40, coins: 22 },
      { id: 'b', rank: 2, name: 'まりこ', goaled: false, pos: 36, coins: 6 },
      { id: 'c', rank: 3, name: 'そうた', goaled: false, pos: 40, coins: 9 }
    ] });
    assertEqual(rows.map((x) => x.main).join('|'), 'あがり|あと4|🪙9', '数：あがり／あと4／（あと0なら）コイン');
    assertEqual(rows.map((x) => x.note).join('|'), '🪙22|🪙6|', '内訳はコインだけ（数に出したコインは言い直さない）');
    assert(!rows.some((x) => /のこり|\/40/.test(String(x.main) + String(x.note))), '「のこり◯マス」「/40」を出さない');
    const なし = 行({ cells: 30, coinsUsed: false, players: [{ id: 'a', rank: 2, name: 'あき', goaled: false, pos: 30, coins: null }] });
    assertEqual(なし[0].main + '/' + なし[0].note, 'あと0/null', 'コインを使わないゲームで0の時は「あと0」・内訳なし');
  });

  await r.test('64 見直し2：対戦の一枚看板（bigVsHtml）は名前を escape し、名前を折らない箱に入れる', async () => {
    const vs = 関数を取り出す('bigVsHtml', 'function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }\n');
    const h = vs('<b>あ</b>', 'VS', 'ひろ');
    assert(!/<b>/.test(h), '名前を escape する（' + h + '）');
    assertEqual((h.match(/class="tv-nm"/g) || []).length, 2, '2人の名前を .tv-nm で包む');
    assert(/class="vs-mid">VS</.test(h), '間の印（VS）');
    // 対戦の一枚看板を「名前　VS　名前」の字のまま組む所が残っていない（5か所目を作ったら赤くなる）
    assertEqual((html64.match(/'　VS　'|'　×　'/g) || []).length, 0, '「　VS　」「　×　」を字でつなぐ一枚看板が無い');
  });

  await r.test('64：大画面の段階の札は、表（RT_PHASE_LABEL）を読むゲームの段階と両方向で合う（英語の段階名を出さない）', async () => {
    // 実物解除の大画面に「roles」「brief」「consent」が英語のまま出ていた（表に無い段階は生のidを出していた）。
    // **どのゲームがこの表を読むかを、手で並べない**（落とし穴4）：
    //   realtime.js の GAME_DRIVERS → 進行役のファイル → その PHASE。
    //   index.html の振り分け（描いてから(renderRtBig◯◯)）→ その描画が札を自分の表で書くか。
    //   描画が札に触れない（共通の行が表を読む）か、表を読んで書くなら「表を読むゲーム」
    const fs = require('fs'), path = require('path');
    const rtSrc = fs.readFileSync(path.join(__dirname, '..', 'realtime.js'), 'utf8').replace(/\r\n/g, '\n');
    const 進行役のファイル = {};
    for (const m of rtSrc.matchAll(/^const (\w+) = require\('\.\/([\w-]+-room)\.js'\);/gm)) 進行役のファイル[m[1]] = m[2];
    const 表a = rtSrc.indexOf('const GAME_DRIVERS = {');
    const 表b = rtSrc.indexOf('\n};', 表a);
    const ゲーム = {};
    for (const m of rtSrc.slice(表a, 表b).matchAll(/^\s*(\w+):\s*\{\s*driver:\s*(\w+)/gm)) ゲーム[m[1]] = 進行役のファイル[m[2]];
    assert(Object.keys(ゲーム).length >= 15, 'GAME_DRIVERS を読めた（' + Object.keys(ゲーム).length + 'ゲーム）');
    const 段階を読む = (file) => {
      const src = fs.readFileSync(path.join(__dirname, '..', file + '.js'), 'utf8');
      const m = /const PHASE = \{([\s\S]*?)\n\};/.exec(src);
      assert(m, file + '.js の PHASE を読めた');
      return Array.from(m[1].matchAll(/:\s*'(\w+)'/g)).map((x) => x[1]);
    };
    // 振り分け：ゲーム → 大画面の描画
    const 一覧 = (名) => new Function('return ' + html64.slice(html64.indexOf('var ' + 名 + ' = '), html64.indexOf(';', html64.indexOf('var ' + 名 + ' = '))).replace('var ' + 名 + ' = ', ''))();
    const 描画 = {};
    for (const m of html64.matchAll(/if\(rtRoomGameId\(\) === '(\w+)'\) return 描いてから\(function\(\)\{ (renderRtBig\w+)\(v\)/g)) 描画[m[1]] = m[2];
    一覧('RT_QUIZ_GAMES').forEach((g) => { 描画[g] = 'renderRtBigQuiz'; });
    Object.keys(ゲーム).filter((g) => /^sugo/.test(g)).forEach((g) => { 描画[g] = 'renderRtBigSugoroku'; });
    描画.wordwolf = 'renderRtBigWordwolf';
    const 表を読む = Object.keys(ゲーム).filter((g) => {
      if (!描画[g]) return true;   // 振り分けに無い（人狼）：共通の行が表を読む
      const 本文 = 関数の字(描画[g]);
      return !/el\('bigPhase'\)/.test(本文) || /RT_PHASE_LABEL/.test(本文);
    });
    // 型(b)：分け方が効いていることを先に見る（全部が「読む」でも「読まない」でもない）
    assert(表を読む.indexOf('defuse') !== -1 && 表を読む.indexOf('wolfrole') !== -1, '実物解除と人狼は表を読む（' + 表を読む.join('・') + '）');
    assert(表を読む.indexOf('quizrush') === -1 && 表を読む.indexOf('auction') === -1 && 表を読む.indexOf('sugotoll') === -1,
      'クイズ・オークション・すごろくは自分の表で札を書く');
    const 表a2 = html64.indexOf('var RT_PHASE_LABEL = {');
    const 表 = new Function('return ' + html64.slice(表a2 + 'var RT_PHASE_LABEL = '.length, html64.indexOf('\n  };', 表a2) + 4))();
    const 出る段階 = new Set();
    const 足りない = [];
    表を読む.forEach((g) => {
      段階を読む(ゲーム[g]).filter((ph) => ph !== 'lobby').forEach((ph) => {
        出る段階.add(ph);
        if (!Object.prototype.hasOwnProperty.call(表, ph) || !表[ph]) 足りない.push(g + ' の ' + ph);
      });
    });
    assertEqual(足りない.join('・'), '', '表に札が無い段階（大画面に英語が出る）');
    // 帰り：表の札は、どれも表を読むゲームの段階（読まれない札は腐る・落とし穴20）
    const 余り = Object.keys(表).filter((k) => !出る段階.has(k));
    assertEqual(余り.join('・'), '', '表にあるのに、表を読むゲームのどの段階でもない札');
    // 表に無い段階は、生のidではなく空の札にする。**「同じ1行があるか」では見ない**——
    // 進化じゃんけん・ロシアンカードにも同じ1行があるので、共通の行を壊しても緑のままになる（落とし穴10-a）。
    // 「生のidに落ちる書き方がどこにも無い」という性質で見る（大画面・手元とも）
    const 生のid = html64.match(/RT_PHASE_LABEL\[v\.phase\]\s*\|\|\s*v\.phase/g) || [];
    assertEqual(生のid.length, 0, '段階の表に無い時に、生のid（v.phase）を出す書き方が無い');
  });

  await r.test('64：TVに「タップで…」を出さない（TVは無人で回す）', async () => {
    const css = html64.slice(html64.indexOf('<style>'), html64.indexOf('</style>')).replace(/\s+/g, ' ');
    assert(/:root\.big-screen \.fx-banner-skip, :root\.big-screen \.fx-banner-skip\.is-always\{display:none;\}/.test(css),
      ':root.big-screen で「タップでとばす／タップで結果へ」を消す規則がある');
    // 打ち消しより後ろにあること（スキップ設定の人の is-always より強い）
    assert(css.indexOf(':root.big-screen .fx-banner-skip') > css.indexOf(':root.fx-skip .fx-banner-skip.is-always{display:block;}'),
      'スキップ設定の is-always より後ろで消している');
  });

  r.finish();
})();
