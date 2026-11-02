// tvs-store.js — TV の切りかえ（指示69）で、サーバーに覚えるもの
//
// 覚えるのは3つ。どれも SQLite に置くので、サーバーを作り直しても（push しても）元にもどる（指示69 2-5）。
//   ・出す物の一覧（tvs_items）：はじめからある5つ（あつまれ・メニュー・あそびまち・動画・休けい）と、係が足した物
//   ・TV ごとの今の画面と、ひとつ前の画面（tvs_screens）：「さっきの画面にもどす」のため
//   ・切りかえの記録（tvs_log）：だれが・いつ・何を。1か月で消す（fes-store.js と同じ）
// **あそびまちの URL（key 付き）はここに入れない。**.env の TVS_ASOBI_URL だけに置く（指示69 2-4）

'use strict';

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 6;   // リモコンが 1列3つ×2段で、スクロールせずに出せる数（指示69 2-2）

// はじめからある物。並び＝TV の PC のタブの並び（Ctrl+1〜5）。kind：fes=あつまれの TV／images=PC の画像／asobi=あそびまち／video=PC の動画／rest=休けい
const BUILTIN = [
  { id: 'fes', name: 'あつまれ', kind: 'fes', sound: 1 },
  { id: 'menu', name: 'メニュー', kind: 'images', sound: 0 },
  { id: 'asobi', name: 'あそびまち', kind: 'asobi', sound: 1 },
  { id: 'video', name: '動画', kind: 'video', sound: 0 },   // 動画の音は、はじめ「切」（指示69 くまくんの決め）
  { id: 'rest', name: '休けい', kind: 'rest', sound: 0 }
];
const KINDS = ['url', 'images', 'video'];   // 係が足せる種類（URL／PC の画像／PC の動画）
const DEFAULT_SCREEN = { 1: 'fes', 2: 'rest' };

function createTvsStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tvs_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT,
      tvs TEXT NOT NULL DEFAULT '12',
      sound INTEGER NOT NULL DEFAULT 0,
      ord INTEGER NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tvs_screens (
      tv INTEGER PRIMARY KEY,
      item TEXT NOT NULL,
      prev TEXT,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tvs_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      who TEXT NOT NULL,
      tv INTEGER NOT NULL,
      item TEXT NOT NULL
    );
  `);
  const ins = db.prepare('INSERT OR IGNORE INTO tvs_items (id, name, kind, url, tvs, sound, ord, builtin) VALUES (?, ?, ?, NULL, ?, ?, ?, 1)');
  BUILTIN.forEach((b, i) => ins.run(b.id, b.name, b.kind, '12', b.sound, i + 1));

  const row = (r) => ({ id: r.id, name: r.name, kind: r.kind, url: r.url || null, tvs: String(r.tvs).split('').map(Number).filter((n) => n === 1 || n === 2),
    sound: !!r.sound, builtin: !!r.builtin });
  function items() { return db.prepare('SELECT * FROM tvs_items ORDER BY ord').all().map(row); }
  function item(id) { const r = db.prepare('SELECT * FROM tvs_items WHERE id = ?').get(String(id)); return r ? row(r) : null; }
  function screens() {
    const out = {};
    [1, 2].forEach((tv) => {
      const r = db.prepare('SELECT * FROM tvs_screens WHERE tv = ?').get(tv);
      out[tv] = r ? { item: r.item, prev: r.prev || null, at: r.at } : { item: DEFAULT_SCREEN[tv], prev: null, at: 0 };
    });
    return out;
  }
  /** TV の今の画面を変える。前の画面は prev に残す（同じ物なら残さない） */
  function setScreen(tv, id, who, now) {
    const cur = screens()[tv];
    const prev = cur.item === id ? cur.prev : cur.item;
    db.prepare('INSERT INTO tvs_screens (tv, item, prev, at) VALUES (?, ?, ?, ?) ON CONFLICT(tv) DO UPDATE SET item = excluded.item, prev = excluded.prev, at = excluded.at')
      .run(tv, id, prev, now);
    db.prepare('INSERT INTO tvs_log (at, who, tv, item) VALUES (?, ?, ?, ?)').run(now, String(who || '-').slice(0, 40), tv, id);
  }
  /** 係が出す物を足す。足せない時は理由の字を返す */
  function addItem(p, now) {
    const name = String((p && p.name) || '').replace(/\s+/g, ' ').trim().slice(0, 12);
    const kind = String((p && p.kind) || '');
    const tvs = [1, 2].filter((n) => p && Array.isArray(p.tvs) && p.tvs.map(Number).indexOf(n) !== -1);
    const url = kind === 'url' ? String((p && p.url) || '').trim() : null;
    if (!name) return { error: '名前を入れてください' };
    if (KINDS.indexOf(kind) === -1) return { error: '種類をえらんでください' };
    if (!tvs.length) return { error: '出せる TV をえらんでください' };
    if (kind === 'url' && !/^https?:\/\/[^\s]+$/.test(url)) return { error: 'http:// か https:// で始まるアドレスを入れてください' };
    if (items().length >= MAX_ITEMS) return { error: '出す物は ' + MAX_ITEMS + ' つまでです' };
    const ord = (db.prepare('SELECT MAX(ord) AS m FROM tvs_items').get().m || 0) + 1;
    const id = 'x' + now.toString(36);
    db.prepare('INSERT INTO tvs_items (id, name, kind, url, tvs, sound, ord, builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
      .run(id, name, kind, url, tvs.join(''), p && p.sound ? 1 : 0, ord);
    return { item: item(id) };
  }
  /** 足した物だけ消せる。消した物を映していた TV は休けいへ */
  function removeItem(id, now) {
    const it = item(id);
    if (!it || it.builtin) return false;
    db.prepare('DELETE FROM tvs_items WHERE id = ?').run(it.id);
    const sc = screens();
    [1, 2].forEach((tv) => {
      if (sc[tv].item === it.id) setScreen(tv, 'rest', 'system', now);
      if (sc[tv].prev === it.id) db.prepare('UPDATE tvs_screens SET prev = NULL WHERE tv = ?').run(tv);
    });
    return true;
  }
  /** 音の入／切と、出せる TV を変える（はじめからある物も。休けい・あつまれの出せる TV は変えない） */
  function updateItem(id, p) {
    const it = item(id);
    if (!it) return null;
    if (p && typeof p.sound === 'boolean') db.prepare('UPDATE tvs_items SET sound = ? WHERE id = ?').run(p.sound ? 1 : 0, it.id);
    if (p && Array.isArray(p.tvs) && !(it.builtin && (it.kind === 'rest' || it.kind === 'fes'))) {
      const tvs = [1, 2].filter((n) => p.tvs.map(Number).indexOf(n) !== -1);
      if (tvs.length) db.prepare('UPDATE tvs_items SET tvs = ? WHERE id = ?').run(tvs.join(''), it.id);
    }
    return item(id);
  }
  function listLog(limit) { return db.prepare('SELECT at, who, tv, item FROM tvs_log ORDER BY id DESC LIMIT ?').all(limit || 10); }
  function purge(now) { db.prepare('DELETE FROM tvs_log WHERE at < ?').run((now || Date.now()) - RETAIN_MS); }
  return { items, item, screens, setScreen, addItem, removeItem, updateItem, listLog, purge };
}

module.exports = { createTvsStore, BUILTIN, MAX_ITEMS, DEFAULT_SCREEN };
