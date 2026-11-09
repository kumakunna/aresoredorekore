// tests/tv-short.js — 指示76 束3（くまくんの答え 4.B・5.A・7.A）と 11/9 の答え 4
//
// 3-1 遊んでいる最中の TV は1語・説明はスマホに大きく。投票・準備・結果の TV は短く（（…）の説明を外す）
// 3-2 英語の小見出しを消す（YOU は「あなた」）
// 3-3 意味のない光の点とガラスの板をやめる（下の帯のすりガラス・早答えの TV の答えの札・決まる画面の3枚の札）
// 11/9 の答え 4：TV の早答えで、同じ問題の札（選択肢・開いた時の答えの札）の字の大きさは、いちばん小さい札にそろえる
// 見本は本物の進行役で作った場面（tools/v2-lab・落とし穴25）。字の行や大きさは jsdom では測れないので、本物の Chrome の測りは
// tools/quiz-fit-shot.js（そろっていない札の数）と 検査_1107_道具/audit-lab.js（英語・長い文・すりガラス）で見る
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, launch } = require('./harness');
const Btn = require('../tools/v2-lab/button-scenes');
const Onaji = require('../tools/v2-lab/onaji-scenes');
const Q2 = require('../tools/v2-lab/quiz2-scenes');
const FesScenes = require('../tools/v2-lab/fes-scenes');
const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

(async function main() {
  const r = createRunner('tv-short：TV は1語・英語の小見出しなし・ガラスの板なし（指示76 束3）');
  const t = await launch({ fakeSocket: true });
  const W = t.win, D = t.doc;
  const 描く = (html, tv) => { const b = D.createElement('div'); b.className = 'screen v2' + (tv ? ' v2-tv' : ''); b.innerHTML = html; D.body.appendChild(b); return b; };
  const 場面 = (S, id) => { const v = S.view(id); return { data: v.room.state.data, members: v.room.members, meId: v.me || 'm1', you: v.you || {}, local: v.local || {}, fes: null, end: Date.now() + 8000 }; };

  await r.test('3-1 ぴったり10秒：TV のよーいは「よーい……」と「10秒」だけ（見えない回は1語の札）。説明はスマホに大きく', async () => {
    const tv = 描く(W.V2Pittari.tv(Object.assign(場面(Btn, 'pt-tv-set'), { meId: 'tv' })), true);
    assert(tv.textContent.indexOf(W.UiText.PITTARI.三秒で消える) === -1, 'TV に「時計は3秒で消えます…」が無い');
    const blind = 描く(W.V2Pittari.tv(Object.assign(場面(Btn, 'pt-tv-set-blind'), { meId: 'tv' })), true);
    assert(blind.textContent.indexOf(W.UiText.PITTARI.見えない回) === -1, 'TV に「この回は、時計が最初から見えません」が無い');
    assertEqual((blind.querySelector('.v2-ptword') || {}).textContent, W.UiText.PITTARI.見えない回TV, '見えない回の TV は1語の札');
    const ph = 描く(W.V2Pittari.phone(場面(Btn, 'pt-set')));
    assertEqual((ph.querySelector('.v2-ptguide') || {}).textContent, W.UiText.PITTARI.三秒で消える, 'スマホに大きく');
  });
  await r.test('3-1 ぴったり10秒：数えている間の TV に「心の中で…」が無い。スマホは時計とボタンのあいだに大きく（A17）', async () => {
    const tv = 描く(W.V2Pittari.tv(Object.assign(場面(Btn, 'pt-tv-run'), { meId: 'tv' })), true);
    assert(tv.textContent.indexOf(W.UiText.PITTARI.心の中で) === -1, 'TV に無い');
    const ph = 描く(W.V2Pittari.phone(場面(Btn, 'pt-run')));
    const g = ph.querySelector('.v2-ptguide'), btn = ph.querySelector('[data-pt-stop]');
    assert(g && g.textContent === W.UiText.PITTARI.心の中で, 'スマホに大きく');
    assert(g.compareDocumentPosition(btn) & 4, 'ボタンより上（画面のいちばん下ではない）');
  });
  await r.test('3-1 数字ちかい方：TV の問題文に「いちばん近い人の勝ち」が無い（ほかの説明は残す）。スマホはそのまま', async () => {
    const g = 場面(Q2, 'qn-tv-guess'), q = g.data.topic.q;
    assert(/いちばん近い人の勝ち/.test(q), '見本の問題文に入っている：' + q);
    const tv = 描く(W.V2Quiz2.near.tv(Object.assign(g, { meId: 'tv' })), true);
    assert(!/いちばん近い人の勝ち/.test(tv.textContent), '答えている間の TV に無い');
    const open = 描く(W.V2Quiz2.near.tv(Object.assign(場面(Q2, 'qn-tv-open'), { meId: 'tv' })), true);
    assert(!/いちばん近い人の勝ち/.test(open.textContent), '開いた TV に無い');
    assertEqual(W.V2.tvLabel('札幌の年の平均気温は約何度？（1991〜2020年の平年値・いちばん近い人の勝ち）'.replace(/・いちばん近い人の勝ち/, ''), false).indexOf('平年値') !== -1, true, 'ほかの説明は残す');
    const ph = 描く(W.V2Quiz2.near.phone(場面(Q2, 'qn-guess')));
    assert(/いちばん近い人の勝ち/.test(ph.textContent), 'スマホはそのまま');
  });
  await r.test('3-1 みんなと同じ：ばらばらの TV は「ばらばら！」だけ', async () => {
    const tv = 描く(W.V2Onaji.tv(Object.assign(場面(Onaji, 'onaji-tv-scatter'), { meId: 'tv', game: 'onaji' })), true);
    const ban = tv.querySelector('.v2-oban.is-scatter');
    assertEqual(ban && ban.textContent, W.UiText.ONAJI ? W.UiText.ONAJI.ばらばら : 'ばらばら！', '1語');
  });
  await r.test('3-1 結果の賞：TV は（…）の説明を外す・スマホはそのまま', async () => {
    const v = 場面(Btn, 'pt-tv-result16');
    const tv = 描く(W.V2Pittari.tv(Object.assign({}, v, { meId: 'tv' })), true);
    const ts = Array.from(tv.querySelectorAll('.v2-oaw-t')).map((x) => x.textContent);
    assert(ts.length && ts.every((x) => x.indexOf('（') === -1), 'TV：' + ts.join('／'));
    const ph = 描く(W.V2Pittari.resultBody(Object.assign({}, v, { meId: 'm1' }), false));
    assert(Array.from(ph.querySelectorAll('.v2-oaw-t')).some((x) => x.textContent.indexOf('（') !== -1), 'スマホは説明つき');
  });

  await r.test('3-2 英語の小見出しが無い（見出しの部品・ページの中・言葉の表）。YOU は「あなた」', async () => {
    assert(W.V2.hdHtml('Vote!', '投票', true).indexOf('Vote') === -1 && W.V2.hdHtml('Next', 'つぎ').indexOf('Next') === -1, '見出しの部品は英語を出さない');
    assert(!/v2-hd-en|v2-thd-en|v2-sdec-en/.test(css), 'ページの中に英語の小見出しの部品が無い');
    ['v2-fes.js', 'v2-home.js', 'v2-kit.js', 'v2-onaji.js', 'v2-pittari.js', 'v2-quiz2.js', 'v2-soroe.js'].forEach((f) => {
      assert(!/v2-t?hd-en|v2-sdec-en/.test(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8')), f + ' に英語の小見出しの部品が無い（準備の画面が自分で組み立てていた）');
    });
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'js', 'ui-text.js'), 'utf8');
    assert(!/^\s*[^\s:]*英: '/m.test(ui), '言葉の表に「英」が残っていない');
    assertEqual(W.UiText.V2.あなた, 'あなた', 'YOU は「あなた」');
    const lab = FesScenes.view('fes2-tv-vote');
    const tv = 描く(W.V2Fes.tv(Object.assign({}, lab, { info: () => ({ name: 'x', world: 'quiz' }) })), true);
    assert(!/\b(Room|Ready|Vote!|Waiting)\b/.test(tv.textContent), 'TV の投票に英語が無い：' + tv.textContent.slice(0, 80));
  });

  await r.test('3-3 ガラスの板をやめる：下の帯にすりガラス（backdrop-filter）が無い・早答えの TV の答えの札と決まる画面の札は透けない色', async () => {
    assert(!/backdrop-filter/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'backdrop-filter が無い');
    // 規則は複数の行にまたがるので、選択子から } までを取る（同じ選択子が2つあれば両方）
    const rules = (sel) => css.split(sel + '{').slice(1).map((x) => x.slice(0, x.indexOf('}')));
    ['.v2 .v2-dcard', '.v2 .v2-q2tv .v2-och', '.v2 .v2-q2tv .v2-ocard'].forEach((sel) => {
      const bg = rules(sel).map((x) => (x.match(/background:([^;]*)/) || [])[1]).filter(Boolean);
      assert(bg.length && bg.every((v) => !/rgba\([^)]*,\s*0?\.\d+\)|var\(--wc2?\)/.test(v)), sel + ' の地の色が透けない：' + bg.join(' ／ '));
    });
  });
  await r.test('3-3 意味のない光の点をやめる：早答え・数字ちかい方の問題の箱の点・そろえて発射の宇宙の名前の上の点', async () => {
    const g = 描く(W.V2Quiz2.haya.tv(Object.assign(場面(Q2, 'qh-tv-choose'), { meId: 'tv' })), true);
    assertEqual(g.querySelectorAll('.v2-q2spark i').length, 0, '早答えの問題の箱に点が無い');
    const so = 描く(W.V2Soroe.tv(Object.assign(場面(Btn, 'so-tv-film-space'), { meId: 'tv' })), true);
    assertEqual(so.querySelectorAll('.v2-sospk').length, 0, '宇宙の名前の上の点が無い（銀河は残す）');
    assert(so.querySelector('.v2-sogalaxy'), '銀河は残す');
  });

  await r.test('11/9 の答え 4：TV の早答えの札（選択肢・開いた時の答えの札）は、同じ問題の中で字の大きさをそろえる印（data-v2-words-group）', async () => {
    const g = 描く(W.V2Quiz2.haya.tv(Object.assign(場面(Q2, 'qh-tv-choose'), { meId: 'tv' })), true);
    const chs = Array.from(g.querySelectorAll('.v2-och-t'));
    assert(chs.length >= 3 && chs.every((x) => x.getAttribute('data-v2-words') === 'ch'), '選択肢は同じ組');
    const o = 描く(W.V2Quiz2.haya.tv(Object.assign(場面(Q2, 'qh-tv-open'), { meId: 'tv' })), true);
    assert(Array.from(o.querySelectorAll('.v2-ocard-t')).every((x) => x.getAttribute('data-v2-words') === 'ch'), '開いた時の答えの札も同じ組');
  });

  await r.test('束3 の答え（11/9）：早答えの TV の帯は「早答え・やさしい」・数字ちかい方の投票の TV の説明・見えない回は「時計なし」', async () => {
    const g = 描く(W.V2Quiz2.haya.tv(Object.assign(場面(Q2, 'qh-tv-choose'), { meId: 'tv' })), true);
    assertEqual(g.querySelector('.v2-omode').textContent, '早答え・' + W.UiText.QUIZ2.層[場面(Q2, 'qh-tv-choose').data.tier], '帯');
    assertEqual(W.UiText.FES.投票.一言TV.qnear, 'いちばん近い数を当てる', '数字ちかい方の説明');
    assertEqual(W.UiText.PITTARI.見えない回TV, '時計なし', '見えない回の1語');
  });
  await r.test('束3 の答え（11/9）：そろえて発射の飛ばなかった回は、TV は「プスッ」だけ・説明はスマホ', async () => {
    const v = 場面(Btn, 'so-tv-notflew');
    const tv = 描く(W.V2Soroe.tv(Object.assign({}, v, { meId: 'tv' })), true);
    const a = tv.querySelector('.v2-soarrive');
    assert(a && !a.querySelector('small') && /プスッ/.test(a.textContent), 'TV は1語：' + (a && a.textContent));
    const ph = 描く(W.V2Soroe.phone(Object.assign({}, v, { meId: 'm1' })));
    const S = W.UiText.SOROE || {};
    assert(ph.textContent.indexOf(S.飛ばなかった || '押した人が少なくて') !== -1 || ph.textContent.indexOf(S.ひとりでは || 'ひとりでは') !== -1, 'スマホに説明：' + ph.textContent.slice(0, 80));
  });

  // ===== 束4（くまくんの答え 6.B・11/9 の案B）：文化祭の6本のルールの札は線の絵。ほかのゲームは今のまま（1枚の中で絵文字と線の絵をまぜない） =====
  const FES6 = ['bomb-coop', 'onaji-many', 'pittari', 'soroe', 'qhaya', 'qnear'];
  // 遊び方の表（index.html の MODES）から、id と札（tv）を読む（tests/inventory.js と同じ読み方）
  const MODESX = css.slice(css.indexOf('var MODES = ['), css.indexOf('function modeById')).split(/\n\s*\{id:"/).slice(1).map((blk) => {
    const id = (blk.match(/^([a-z0-9-]+)"/) || [])[1];
    const m = blk.match(/\btv:(\[\[[^\n]*\]\])/);
    return { id, tv: m ? JSON.parse(m[1]) : null };
  }).filter((x) => x.id);
  const 絵文字 = /\p{Extended_Pictographic}/u;
  await r.test('束4：文化祭の6本のルールの札に絵文字 0（準備のスマホ・TV・ゲームの紹介は同じ部品）。ほかのゲームの札は絵文字のまま', async () => {
    FES6.forEach((id) => {
      const m = MODESX.find((x) => x.id === id);
      assert(m && m.tv.length === 3, id + '：札が3つ');
      m.tv.forEach((c) => assert(/^ic:[a-z]+$/.test(c[0]), id + '：線の絵の印（' + c[0] + '）'));
      const ph = 描く(W.V2.rulesHtml(m.tv));
      assertEqual(ph.querySelectorAll('.v2-rule-ri svg').length, 3, id + '：スマホの札に線の絵が3つ');
      assert(!絵文字.test(ph.textContent), id + '：スマホの札に絵文字が無い');
    });
    const other = MODESX.filter((x) => x.tv && FES6.indexOf(x.id) === -1);
    other.forEach((m) => {
      const n = m.tv.filter((c) => /^ic:/.test(c[0])).length;
      assert(n === 0 || n === m.tv.length, m.id + '：1枚の中で絵文字と線の絵がまざらない');
    });
    assert(other.some((m) => m.tv.some((c) => 絵文字.test(c[0]))), 'ほかのゲームは絵文字のまま');
    // TV の準備（v2-fes.js tvReady）も同じ部品で描く
    const lab = FesScenes.view('fes2-tv-ready-pittari');
    void lab;
    assert(/V\.ruleIc\(r\[0\]\)/.test(fs.readFileSync(path.join(ROOT, 'public', 'js', 'v2-fes.js'), 'utf8')), 'TV の準備の札も V2.ruleIc');
  });
  await r.test('束4：「📸 きょうのアルバム」は絵文字を消す（絵が2つ並んでいた）', async () => {
    assert(W.UiText && !/📸/.test(JSON.stringify(W.UiText)), '言葉の表に📸が無い');
    assert(!/📸 きょうのアルバム/.test(css), 'ページの中にも無い');
  });

  // ===== 束5 =====
  await r.test('束5 5-10（D2）：みんなと同じ（一致団結）の結果で、0問の時は「0問で全員そろった」を出さない', async () => {
    const v = 場面(Onaji, 'onaji-team-result');
    v.data.result.together = 0;
    const ph = 描く(W.V2Onaji.resultBody(Object.assign({}, v, { meId: 'm1' }), false));
    assert(!/0問で全員そろった/.test(ph.textContent), '0問の文が無い：' + ph.textContent.slice(0, 80));
    v.data.result.together = 2;
    const ph2 = 描く(W.V2Onaji.resultBody(Object.assign({}, v, { meId: 'm1' }), false));
    assert(/2問で全員そろった/.test(ph2.textContent), '1問以上は出す');
  });
  await r.test('束5 5-11（D3）：早答えでまちがえた時は「正解は C だんご」と「つぎはきっと！」を分ける（つながって読めない）', async () => {
    const v = 場面(Q2, 'qh-open');
    const you = Object.assign({}, v.you, { myRight: false, myPoints: 0 });
    const ph = 描く(W.V2Quiz2.haya.phone(Object.assign({}, v, { you })));
    const box = ph.querySelector('.v2-q2mine');
    const a = box.querySelector('.v2-q2mine-a').textContent, s = (box.querySelector('small') || {}).textContent || '';
    assert(/^正解は /.test(a), '正解の行は「正解は」から：' + a);
    assertEqual(s, 'つぎはきっと！', 'はげましは別の行');
  });
  await r.test('束5（11/9 の答え 5）：文化祭のスマホの ⚙ の説明に、文化祭で起きないことを書かない（ふだんの部屋は今のまま）', async () => {
    assertEqual(W.UiText.SET.音を消すの補足文化祭, '効果音を、まとめて止めます', '音（BGM は流れない）');
    assertEqual(W.UiText.SET.揺れの補足文化祭, 'ミスした時のライフなどが、一瞬揺れます', '光と揺れ（人狼をしない）');
    assert(/大画面の処刑の瞬間/.test(css), 'ふだんの部屋の文は残す');
  });

  await r.test('束5 5-5・5-12・5-13：数字ちかい方の入れる前は「―」・名前の札の前の見出し・TV の線の外', async () => {
    const v = 場面(Q2, 'qn-guess');
    const ph = 描く(W.V2Quiz2.near.phone(Object.assign({}, v, { local: { digits: '' } })));
    assertEqual(ph.querySelector('[data-qn-disp]').textContent, '―', '入れる前は「―」（km² だけが浮かない）');
    const tv = 描く(W.V2Quiz2.haya.tv(Object.assign(場面(Q2, 'qh-tv-open'), { meId: 'tv' })), true);
    assertEqual((tv.querySelector('.v2-otags-h') || {}).textContent, W.UiText.QUIZ2.正解した人, '早答えの TV の名前の札の見出し');
    const on = 描く(W.V2Onaji.phone(Object.assign(場面(Onaji, 'onaji-unveil'), { meId: 'm1' })));
    const h = on.querySelector('.v2-onames-h');
    assert(!on.querySelector('.v2-onames') || (h && h.textContent === W.UiText.ONAJI ? true : !!h), 'みんなと同じの名前の札に見出し');
    const far = 描く(W.V2Quiz2.near.tv(Object.assign(場面(Q2, 'qn-tv-open'), { meId: 'tv' })), true);
    const f = far.querySelector('.v2-q2far');
    assert(!f || (f.querySelector('small') || {}).textContent === W.UiText.QUIZ2.線の外, '線の外の人数に「線の外」');
  });
  await r.test('束5 5-2・5-9：シートの黒い「とじる」はまん中・⚙ の部屋コードの QR は札の中（svg を行の外に）', async () => {
    assert(css.indexOf('.v2 .v2-catbtns .v2-btn.is-pri{justify-content:center;}') !== -1, 'とじるはまん中');
    assert(css.indexOf('.v2.v2-setov .qr-box svg{display:block;') !== -1, 'QR は札の中');
  });

  await r.test('束5 5-7（A18）：係の記録のページ（名前・回ごと）は、日付や部屋コードを1字ずつ折らない（word-break:break-all をやめる）', async () => {
    const page = require('../fes-routes.js').namesPage('回ごとの記録', '<table><tr><td>11/9 01:57</td><td>64REF4</td></tr></table>');
    assert(!/break-all/.test(page), 'break-all が無い');
    assert(/overflow-wrap:anywhere/.test(page), '入らない時だけ字の中で折る');
  });

  W.close();
  r.finish();
})();
