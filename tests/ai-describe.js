// tests/ai-describe.js — AIの説明文づくりの共通層（第35弾B）
//
// 見るのは2つ：
//   ・エラーの「中身」（運用者向けの詳細）と「プレイヤーに見せる言葉」が分かれていること。
//     .env や pm2 のような運用の言葉が、遊んでいる人の画面に出てはいけない（誤表示）
//   ・エラーの種類（kind）と運用者向けの詳細そのものは今まで通り残ること（サーバーログ用）

const Ai = require('../ai-describe');
const { createRunner, assert, assertEqual } = require('./harness');

(async function main() {
  const r = createRunner('ai-describe：エラーの言葉の使い分け');

  await r.test('キーが無い時、プレイヤー向けの言葉に運用の用語が混ざらない', async () => {
    let err = null;
    try { await Ai.describe({ name: '傘' }, { apiKey: '' }); }
    catch (e) { err = e; }
    assert(err, 'キーが無ければ失敗する');
    assertEqual(err.kind, 'no_key', '種類は今まで通り');
    // 運用者向けの詳細は残る（サーバーログで原因が分かるように）
    assert(/GEMINI_API_KEY/.test(err.message), '内部メッセージには原因の詳細が残る');
    // プレイヤーに見せる言葉は別で取れて、運用の用語を含まない
    const msg = Ai.playerMessage(err);
    assert(/AIがいまつかえません/.test(msg), 'プレイヤーには「つかえない」ことだけ伝える（実際: ' + msg + '）');
    ['.env', 'pm2', 'GEMINI', 'API'].forEach((word) => {
      assert(msg.indexOf(word) === -1, 'プレイヤー向けに「' + word + '」を出さない（実際: ' + msg + '）');
    });
  });

  await r.test('APIの失敗・応答が空・通信エラーも、プレイヤーには同じやさしい言葉になる', async () => {
    ['api_error', 'empty', 'network'].forEach((kind) => {
      const msg = Ai.playerMessage({ kind, message: '内部の詳細' });
      assert(/AIがいまつかえません/.test(msg), kind + '：つかえないことだけ伝える');
      assert(msg.indexOf('API') === -1 && msg.indexOf('キー') === -1,
        kind + '：技術的な言葉を出さない（実際: ' + msg + '）');
    });
  });

  await r.test('お題が読めなかった時（bad_request）は、直し方が分かる言葉になる', async () => {
    const msg = Ai.playerMessage({ kind: 'bad_request', message: 'name is required' });
    assert(/お題/.test(msg), 'お題の話だと分かる（実際: ' + msg + '）');
    assert(msg.indexOf('name is required') === -1, '英語の内部メッセージをそのまま出さない');
  });

  await r.test('種類が無い想定外のエラーにも、プレイヤー向けの言葉が返る', async () => {
    const msg = Ai.playerMessage(new Error('boom'));
    assert(/AIがいまつかえません/.test(msg), '想定外でも同じやさしい言葉（実際: ' + msg + '）');
    assert(msg.indexOf('boom') === -1, '内部メッセージを漏らさない');
  });

  r.finish();
})();
