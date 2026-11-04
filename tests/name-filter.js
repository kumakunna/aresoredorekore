// tests/name-filter.js — 名前の決まり（public/js/name-filter.js）の言葉（2026-10-27 に足した語）
//
// 止まる：足した語を、全角・半角・大文字・間にスペース・カタカナにした形でも
// 止まらない：ふつうの名前（足した語の一部を含む名前も）
const { createRunner, assert, assertEqual } = require('./harness');
const F = require('../public/js/name-filter');

const 止まる = (s) => F.check(s).reason === 'blocked';
// 全角にする（英数字だけ）
const 全角 = (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
const 間 = (s) => Array.from(s).join(' ');
const カナ = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const CONTAINS = ['unko', 'unchi', 'chinko', 'chinchin', 'manko', 'oppai', 'sekkusu', 'korosu', 'kimoi', 'uzai', 'fuck', 'shit', 'bitch', 'porn',
  '死ね', '氏ね', '殺す', '糞', '馬鹿', '阿呆', '変態', '基地外', '売春'];
// 指示71 追記3（くまくんの答え 11/04）：「shine」（英語の「かがやく」）は止まりすぎなので通す（下の検査）。カタカナの「シネ」は「しね」で止まる
const EXACT = ['baka', 'aho', 'kuso', 'kasu', 'gomi', 'busu', 'debu', 'hage', 'ero', 'sex', 'dick', 'kill', '屑', '障害'];
// カタカナで打った時（ローマ字の語の読み・漢字の語の読み）
const 読み = { unko: 'うんこ', unchi: 'うんち', chinko: 'ちんこ', chinchin: 'ちんちん', manko: 'まんこ', oppai: 'おっぱい', sekkusu: 'せっくす',
  korosu: 'ころす', kimoi: 'きもい', uzai: 'うざい', fuck: 'ふぁっく', shit: 'しっと', bitch: 'びっち', porn: 'ぽるの', 死ね: 'しね', 氏ね: 'しね', 殺す: 'ころす',
  糞: 'くそ', 馬鹿: 'ばか', 阿呆: 'あほ', 変態: 'へんたい', 基地外: 'きちがい', 売春: 'ばいしゅん',
  baka: 'ばか', aho: 'あほ', kuso: 'くそ', kasu: 'かす', gomi: 'ごみ', busu: 'ぶす', debu: 'でぶ', hage: 'はげ', ero: 'えろ', shine: 'しね', sex: 'せっくす',
  dick: 'でぃっく', kill: 'きる', 屑: 'くず', 障害: 'しょうがい' };

(async function main() {
  const r = createRunner('name-filter：名前の決まりの言葉（2026-10-27）');

  await r.test('止まる：含んでいたら止める語（そのまま・全角・大文字・間にスペース・前後に字をつけても）', async () => {
    const 抜けた = [];
    CONTAINS.forEach((w) => {
      const 形 = [w, 全角(w), w.toUpperCase(), 全角(w.toUpperCase()), 間(w), 'あ' + w, w + 'z'];
      形.forEach((x) => { if (x.length <= 8 && !止まる(x)) 抜けた.push(x); });
    });
    assertEqual(抜けた.join('・'), '', '止まらなかった形');
  });

  await r.test('止まる：名前がそれだけの時に止める語（そのまま・全角・大文字・間にスペース）', async () => {
    const 抜けた = [];
    // 9字をこえる形（「s h i n e」）は、言葉より先に「8字まで」で止まる（reason が long）ので数えない
    EXACT.forEach((w) => { [w, 全角(w), w.toUpperCase(), 間(w)].forEach((x) => { if (Array.from(x).length <= 8 && !止まる(x)) 抜けた.push(x); }); });
    assertEqual(F.check('s h i n e').ok, false, '9字の形も入れない（8字まで）');
    assertEqual(抜けた.join('・'), '', '止まらなかった形');
  });

  await r.test('止まる：カタカナで打った形（読み）', async () => {
    const 抜けた = Object.keys(読み).map((w) => カナ(読み[w])).filter((x) => !止まる(x));
    assertEqual(抜けた.join('・'), '', '止まらなかったカタカナ');
    assert(止まる('ハゲ') && 止まる('ﾊｹﾞ'), 'ハゲ（全角・半角カナ）');
  });

  await r.test('止まらない：ふつうの名前（足した語の一部を含む名前も）', async () => {
    const 名前 = ['hero', 'たかし', 'まなみ', 'さくら', 'はげみ', 'かすみ', 'くずは', 'しんじ', 'sunshine', 'sexton'];
    const 止まった = 名前.filter(止まる);
    assertEqual(止まった.join('・'), '', '止まってしまった名前');
    // 型(b)：見張りが効いている（足した語は止まる）
    assert(止まる('unko') && 止まる('はげ') && 止まる('sex'), '足した語は止まる');
  });

  await r.test('「はげ」「sex」「dick」は名前がそれだけの時だけ（含んでいるだけでは止めない）', async () => {
    assert(!止まる('はげみ') && !止まる('sexton') && !止まる('dickens'), '含んでいるだけの名前は通る');
    assert(止まる('はげ') && 止まる('SEX') && 止まる('Dick'), 'それだけの名前は止まる');
  });

  // 2026-11-01 いじわるなテスト（tools/fes-mean.js）で見つけた：見えない字をはさむと門を通り、TV には「しね」と見えていた。
  // 向きを逆にする字（U+202E）は、逆さに打った言葉を TV で正しい向きに見せる
  await r.test('見えない字（ゼロ幅・向きの字・制御文字）をはさんでも止まる。名前からは消える。絵文字の ZWJ はそのまま', async () => {
    const 見えない = ['​', '‌', '‍', '⁠', '­', '‎', '‮', '⁦', '\u0000', '\n'];
    const 抜けた = 見えない.filter((c) => !止まる('し' + c + 'ね') || !止まる('う' + c + 'んこ')).map((c) => 'U+' + c.charCodeAt(0).toString(16));
    assertEqual(抜けた.join('・'), '', 'すり抜けた見えない字');
    assertEqual(F.check('‮ねし').name, 'ねし', '逆さに打って向きの字で戻す形は、向きの字が消えて打った順のまま（TV で逆さに見えない）');
    assertEqual(F.check('ゼ​ロ').name, 'ゼロ', '通る名前からも見えない字は消える');
    assertEqual(F.check('a‮bc').name, 'abc', '向きの字も消える');
    assertEqual(F.check('👨‍👩‍👧‍👦').name, '👨‍👩‍👧‍👦', '家族の絵文字（ZWJ でつないだ1つ）はそのまま');
    assertEqual(F.check('​​').reason, 'empty', '見えない字だけの名前は空');
  });

  // ===== 指示71 追記3（くまくんの答え 2026-11-04）=====
  await r.test('追記3：足した言葉が止まる（そのまま・カタカナ・ひらがな・全角・記号や空白をはさんでも・前後に字をつけても）', async () => {
    const 足した = ['タヒね', '4ね', 'しんで', 'ガイジ', '池沼', 'きんたま', '金玉', 'ちくび', 'ヒトラー', 'ナチス', 'ㄘんこ'];
    const ひら = (x) => x.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    const 抜けた = [];
    足した.forEach((w) => {
      const 形 = [w, カナ(w), ひら(w), 全角(w), Array.from(w).join('・'), Array.from(w).join(' ')];
      if (w !== 'しんで') 形.push('あ' + w, w + 'z');   // しんで は名前そのものの時だけ（「しんでれら」を止めない）
      形.forEach((x) => { if (Array.from(x).length <= 8 && !止まる(x)) 抜けた.push(x); });
    });
    assertEqual(抜けた.join('・'), '', '止まらなかった形');
    ['しんでね', 'シンデクレ', 'ヒトラ', 'ちんこ'.replace('ち', 'ㄘ')].forEach((x) => assert(止まる(x), x + ' も止まる'));
  });

  await r.test('追記3：止めない名前（先生・校長・shine・言葉の一部を含むふつうの名前）', async () => {
    const 通す = ['先生', '校長', 'shine', 'Shine', 'ＳＨＩＮＥ', 'しんでれら', 'シンデレラ', 'しんでん', 'ちくわ', 'きんた', 'がいこつ', 'なちゅ', 'ひとみ'];
    const 止まった = 通す.filter((x) => !F.check(x).ok);
    assertEqual(止まった.join('・'), '', '止まってしまった名前');
  });

  r.finish();
})();
