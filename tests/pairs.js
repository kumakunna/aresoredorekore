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
      // このテストで数えた組は全部「今日はじめて」なので、初めての組として出る。
      // 第35弾B：今日はじめての組は top（長い付き合い）としては出さない（矛盾表示の防止）
      assertEqual(info.top, null, '今日はじめての組しか居なければ、長い付き合いは出さない');
      assert(info.fresh.some((f) => f.a === 'あき' && f.b === 'ふゆ'), '今日はじめての組が入る');
      // 一覧そのものは返さない（疎外感を生む表示を作らせない）
      assertEqual(Object.keys(info).sort().join(','), 'fresh,top', '返すのは top と fresh だけ');
    });

    await r.test('今日はじめての組は「一番長い付き合い」と同時に出ない（矛盾表示の防止）', async () => {
      // 実機（第35弾B）で出た矛盾の再現：今日はじめて遊んだ2人が同じ日に5回重ねると、
      // 「今日が初めての組み合わせ✨」と「いちばん長い付き合い（5回）🤝」が
      // 同じ2人に同時に表示されていた。初めての日の相手は「初めて」として祝い、
      // 「付き合いの長さ」は前の日から続く組にだけ言う
      for (let i = 0; i < 5; i++) db.countPairs(TEST_USER, ['そら', 'うみ']);
      const info = db.pairInfo(TEST_USER, ['そら', 'うみ']);
      assert(info.fresh.some((f) =>
        (f.a === 'うみ' && f.b === 'そら') || (f.a === 'そら' && f.b === 'うみ')
      ), '初めての組としては祝う');
      assertEqual(info.top, null, '同じ2人を「長い付き合い」として同時に出さない');
    });

    await r.test('前の日から続く組は、今日はじめての組と両方出せる', async () => {
      // 昨日以前から遊んでいる組（first_at を過去にして直接作る）
      db.prepare(
        "INSERT INTO pairs (user_id, a, b, count, first_at) VALUES (?, 'かこ', 'むかし', 4, '2026-08-01 12:00:00')"
      ).run(TEST_USER);
      const info = db.pairInfo(TEST_USER, ['かこ', 'むかし', 'そら', 'うみ']);
      assertEqual(info.top && info.top.a, 'かこ', '長い付き合いは過去から続く組');
      assertEqual(info.top && info.top.count, 4, '回数も正しい');
      assert(info.fresh.some((f) => f.a === 'うみ' || f.b === 'うみ'), '今日はじめての組も出る');
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
