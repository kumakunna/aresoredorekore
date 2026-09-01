// tests/register-code.js — 新規登録の合言葉（登録コード）
//
// 見るのは3つ：
//   ・`.env` の REGISTER_CODE に**カンマ区切りで複数**書けて、そのどれでも登録できる
//   ・空白・大文字小文字のゆれで弾かれない（スマホのキーボードが勝手に直してしまうため）
//   ・合言葉の入力欄が、他の認証欄と同じく自動大文字化を切ってある
//     （認証欄の並びで1つだけ設定が漏れる、という型の再発防止）
//
// 注意：期待値は実装側の定数を持ってこず、**具体の文字列**で書く（落とし穴10-a）。

const fs = require('fs');
const path = require('path');
const { parseRegisterCodes, matchesRegisterCode } = require('../register-code');
const { createRunner, assert, assertEqual } = require('./harness');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// ログイン画面（scr-login）の中身だけを切り出す
function loginScreenHtml() {
  const start = HTML.indexOf('<div class="screen" id="scr-login">');
  assert(start >= 0, 'ログイン画面（scr-login）が見つからない');
  const next = HTML.indexOf('class="screen"', start + 10);
  return HTML.slice(start, next < 0 ? HTML.length : next);
}

(async function main() {
  const r = createRunner('register-code：登録の合言葉');

  await r.test('カンマ区切りで複数の合言葉になる', () => {
    const codes = parseRegisterCodes('kumakunn,claude,test');
    assertEqual(codes.length, 3, '3つに分かれる');
    assertEqual(codes.join('|'), 'kumakunn|claude|test', '並びも中身もそのまま');
  });

  await r.test('前後の空白と空の要素は落ちる', () => {
    assertEqual(parseRegisterCodes('  あ , , い ,').join('|'), 'あ|い', '空白と空要素を落とす');
    assertEqual(parseRegisterCodes('').length, 0, '空文字なら0個');
    assertEqual(parseRegisterCodes(null).length, 0, 'null でも落ちない');
  });

  await r.test('複数のとき、そのどれでも通る', () => {
    const codes = ['kumakunn', 'claude', 'test'];
    ['kumakunn', 'claude', 'test'].forEach((c) => {
      assert(matchesRegisterCode(c, codes), c + ' は通る');
    });
  });

  await r.test('1つだけのときも、これまで通り動く（分岐の反対側）', () => {
    const one = parseRegisterCodes('onlyone');
    assertEqual(one.length, 1, '1つ');
    assert(matchesRegisterCode('onlyone', one), '書いた合言葉は通る');
    assert(!matchesRegisterCode('claude', one), '書いていない合言葉は通らない');
  });

  await r.test('違う言葉・空は通らない', () => {
    const codes = ['kumakunn', 'claude', 'test'];
    ['kumakun', 'claudee', 'tes', 'change-me-in-env', '', '   ', null, undefined]
      .forEach((c) => {
        assert(!matchesRegisterCode(c, codes), JSON.stringify(c) + ' は通らない');
      });
    assert(!matchesRegisterCode('claude', []), '合言葉が1つも無ければ誰も通らない');
  });

  await r.test('空白・大文字小文字のゆれは受け入れる', () => {
    const codes = ['kumakunn', 'claude', 'test'];
    ['Claude', 'CLAUDE', ' claude ', 'KumaKunn', ' TEST '].forEach((c) => {
      assert(matchesRegisterCode(c, codes), JSON.stringify(c) + ' は通る');
    });
  });

  await r.test('ログイン画面の文字入力欄は、全部が自動大文字化を切っている', () => {
    const inputs = loginScreenHtml().match(/<input[^>]*type="text"[^>]*>/g) || [];
    assert(inputs.length >= 3, '文字入力欄が3つ以上ある（実際: ' + inputs.length + '）');
    inputs.forEach((tag) => {
      const id = (tag.match(/id="([^"]+)"/) || [])[1] || tag;
      assert(/autocapitalize="off"/.test(tag), id + ' に autocapitalize="off" が無い');
    });
  });

  await r.test('.env のひな形が、複数書けることを説明している', () => {
    const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
    assert(/REGISTER_CODE=/.test(example), 'REGISTER_CODE の行がある');
    assert(/カンマ/.test(example), '複数書けること（カンマ区切り）が書いてある');
  });

  r.finish();
})();
