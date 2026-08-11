// tests/pairs.js — 2人組の記録（第32弾-E 第1部・第2部）
//
// 見るのは3つ：
//   ・1ゲームで、その場の全部の2人組に+1される（5人なら10組）
//   ・新しい人が加わっても、既存の組の記録は減らない（0から静かに始まるだけ）
//   ・「一番長い付き合い」と「今日はじめての組み合わせ」だけが一言のもとになる
//
// 実物の db.js を使う（ここで動かないなら本番でも動かない）。
// テスト専用のユーザーIDで書き、終わったら必ず消す。

const db = require('../db');
const { createRunner, assert, assertEqual } = require('./harness');

const TEST_USER = 987654321; // 通常の連番と衝突しないID。ここ以外のデータには触らない

function rows() {
  return db.prepare('SELECT a, b, count FROM pairs WHERE user_id = ? ORDER BY a, b').all(TEST_USER);
}
function setup() {
  // pairs.user_id は users を参照している（外部キー）。テスト用のユーザーを1人作る
  db.prepare('INSERT OR IGNORE INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(TEST_USER, '__test_pairs_user__', 'x');
}
function cleanup() {
  db.prepare('DELETE FROM pairs WHERE user_id = ?').run(TEST_USER);
  db.prepare('DELETE FROM users WHERE id = ?').run(TEST_USER);
}

(async function main() {
  const r = createRunner('pairs：2人組の記録');
  cleanup();
  setup();
  try {
    await r.test('1ゲームで、その場の全部の2人組に+1される', async () => {
      db.countPairs(TEST_USER, ['あき', 'びび', 'ちか', 'でん', 'えみ']);
      assertEqual(rows().length, 10, '5人なら10組');
      assert(rows().every((x) => x.count === 1), 'どの組も1回');
    });

    await r.test('もう1回遊ぶと、同じ組に+1される（並び順は関係ない）', async () => {
      db.countPairs(TEST_USER, ['びび', 'あき']); // 前と逆順で渡す
      const ab = rows().find((x) => x.a === 'あき' && x.b === 'びび');
      assertEqual(ab.count, 2, '(あき,びび) が2回になる');
    });

    await r.test('新しい人が加わっても、既存の組の記録は減らない', async () => {
      db.countPairs(TEST_USER, ['あき', 'びび', 'ふゆ']); // ふゆが初参加
      const ab = rows().find((x) => x.a === 'あき' && x.b === 'びび');
      assertEqual(ab.count, 3, '既存の組はそのまま積み上がる');
      const af = rows().find((x) => x.b === 'ふゆ' || x.a === 'ふゆ');
      assertEqual(af.count, 1, '新しい組が0から静かに始まる');
    });

    await r.test('一言のもとは「一番長い付き合い」と「今日はじめて」だけ', async () => {
      const info = db.pairInfo(TEST_USER, ['あき', 'びび', 'ふゆ']);
      assertEqual(info.top.a, 'あき', '一番の組のa');
      assertEqual(info.top.b, 'びび', '一番の組のb');
      assertEqual(info.top.count, 3, '回数');
      // このテストで数えた組は全部「今日」なので、初めての組として出る
      assert(info.fresh.some((f) => f.a === 'あき' && f.b === 'ふゆ'), '今日はじめての組が入る');
      // 一覧そのものは返さない（疎外感を生む表示を作らせない）
      assertEqual(Object.keys(info).sort().join(','), 'fresh,top', '返すのは top と fresh だけ');
    });

    await r.test('1回しか遊んでいない組は「一番長い付き合い」にならない', async () => {
      db.countPairs(TEST_USER, ['はな', 'ゆず']);
      const info = db.pairInfo(TEST_USER, ['はな', 'ゆず']);
      assertEqual(info.top, null, '2回以上のときだけ出す');
    });

    await r.test('その場にいない人の組は、一言に混ざらない', async () => {
      const info = db.pairInfo(TEST_USER, ['あき', 'はな']);
      assertEqual(info.top, null, '(あき,びび)の3回は、びびが居ない場では出ない');
    });

    await r.test('1人だけ・空っぽでは何も起きない', async () => {
      const before = rows().length;
      db.countPairs(TEST_USER, ['あき']);
      db.countPairs(TEST_USER, []);
      db.countPairs(TEST_USER, null);
      assertEqual(rows().length, before, '組は増えない');
      assertEqual(db.pairInfo(TEST_USER, ['あき']).top, null, '一言も出ない');
    });
  } finally {
    cleanup();
  }
  r.finish();
})();
