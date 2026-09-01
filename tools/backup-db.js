// tools/backup-db.js — データベースの定期バックアップ（第37弾・2026-09の障害を受けて追加）
//
// なぜ `cp` ではなく、これを使うのか：
//   DBは WAL モード（db.js の `journal_mode = WAL`）で動いている。
//   遊んでいる最中の .db ファイルをそのままコピーすると、まだ .db に反映されていない
//   -wal の中身が抜け落ちて、**壊れた／古いバックアップ**が黙って出来上がる。
//   better-sqlite3 の backup() は SQLite 公式のオンラインバックアップAPIで、
//   サーバーを止めずに「その瞬間として正しい1つのファイル」を作れる。
//
// 使い方（cronから毎日1回）：
//   node /root/backend/tools/backup-db.js
//
// 置き場所と世代：
//   /root/backups/aresoredorekore/daily/YYYY-MM-DD.db    直近14日分
//   /root/backups/aresoredorekore/monthly/YYYY-MM.db     毎月1日の分を12か月分
//   （置き場所は環境変数 BACKUP_DIR で変えられる）
//
// これは「DBだけが壊れた・消えた」ときの備え。**VPSごと消えた場合は救えない**ので、
// その役目はConoHa側の自動バックアップが持つ。役割分担は docs/障害と復旧_2026-09.md を見ること。

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SRC = path.join(__dirname, '..', 'data', 'aresoredorekore.db');
const ROOT = process.env.BACKUP_DIR || '/root/backups/aresoredorekore';
const DAILY_KEEP = 14;   // 直近14日分（1日1回なので2週間さかのぼれる）
const MONTHLY_KEEP = 12; // 毎月1日の分を1年分

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    day: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    month: d.getFullYear() + '-' + p(d.getMonth() + 1),
    isFirstOfMonth: d.getDate() === 1
  };
}

// 世代の掃除：名前順で新しいものから keep 件だけ残す（YYYY-MM-DD / YYYY-MM は名前順＝日付順）
function prune(dir, keep) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  const drop = files.slice(0, Math.max(0, files.length - keep));
  drop.forEach((f) => {
    fs.unlinkSync(path.join(dir, f));
    console.log('[backup] 古い世代を削除: ' + f);
  });
  return files.length - drop.length;
}

(async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('[backup] データベースが見つかりません: ' + SRC);
    process.exit(1);
  }
  const now = new Date();
  const s = stamp(now);
  const dailyDir = path.join(ROOT, 'daily');
  const monthlyDir = path.join(ROOT, 'monthly');
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.mkdirSync(monthlyDir, { recursive: true });

  const dest = path.join(dailyDir, s.day + '.db');
  const db = new Database(SRC, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const size = fs.statSync(dest).size;
  console.log('[backup] 作成: ' + dest + '（' + size + ' バイト）');

  // 取れたものが本当に読めるか、その場で確かめる。
  // 「毎日動いていたのに、いざという時に開けなかった」が一番こわい
  const check = new Database(dest, { readonly: true });
  try {
    const ok = check.pragma('integrity_check', { simple: true });
    if (ok !== 'ok') throw new Error('integrity_check が ok ではありません: ' + ok);
    const users = check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    console.log('[backup] 検査OK（アカウント ' + users + ' 件）');
  } finally {
    check.close();
  }

  // 読むために開いただけでも -wal / -shm が横に出来る。掃除は .db しか見ないので、
  // 放っておくと置き場所に残り続け、戻す時にも紛らわしい。中身が空なことを確かめてから消す
  [dest + '-wal', dest + '-shm'].forEach((side) => {
    if (!fs.existsSync(side)) return;
    if (side.endsWith('-wal') && fs.statSync(side).size > 0) {
      console.warn('[backup] -wal に中身が残っています。消さずに残します: ' + side);
      return;
    }
    fs.unlinkSync(side);
  });

  if (s.isFirstOfMonth) {
    const m = path.join(monthlyDir, s.month + '.db');
    fs.copyFileSync(dest, m); // 検査済みのバックアップからのコピーなのでcpでよい
    console.log('[backup] 月次を保存: ' + m);
  }

  const d = prune(dailyDir, DAILY_KEEP);
  const mo = prune(monthlyDir, MONTHLY_KEEP);
  console.log('[backup] 完了（日次 ' + d + ' 世代 / 月次 ' + mo + ' 世代）');
})().catch((e) => {
  console.error('[backup] 失敗: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
