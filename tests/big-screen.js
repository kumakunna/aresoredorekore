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

  await r.test('§11-4：時計の種類は play か tick の2つだけ', async () => {
    進行役たち().forEach((x) => {
      const got = x.driver.clockKind({});
      assert(got === 'play' || got === 'tick',
        x.games.join('／') + '：知らない種類「' + got + '」を返した');
    });
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

  await r.test('§11-4：とくとく以外のゲームは、無条件に数える', async () => {
    // 逆向き（落とし穴20）。「tick を返すのはとくとくだけ」を確かめる——
    // 別のゲームが黙って tick を返すと、そのゲームの時計が丸ごと消える
    const tickを返す = 進行役たち()
      .filter((x) => x.driver !== GAME_DRIVERS.quizreveal.driver)
      .filter((x) => x.driver.clockKind({}) === 'tick')
      .map((x) => x.games.join('／'));
    assertEqual(tickを返す.length, 0,
      'とくとくクイズ以外で時計が消えている：' + tickを返す.join('・'));
  });

  r.finish();
})();
