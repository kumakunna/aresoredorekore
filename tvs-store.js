// tvs-store.js — TV の切りかえ（指示69）で、サーバーに覚えるもの
//
// 覚えるのは3つ。どれも SQLite に置くので、サーバーを作り直しても（push しても）元にもどる（指示69 2-5）。
//   ・出す物の一覧（tvs_items）：はじめからある5つ（あつまれ・メニュー・あそびまち・動画・休けい）と、係が足した物
//   ・TV ごとの今の画面と、ひとつ前の画面（tvs_screens）：「さっきの画面にもどす」のため
//   ・切りかえの記録（tvs_log）：だれが・いつ・何を。1か月で消す（fes-store.js と同じ）
//   ・設定（tvs_settings・二の束）：自動で回す入／切と中身・呼び出し・人が入った時・休けいの字・お知らせの一言
// **あそびまちの URL（key 付き）はここに入れない。**.env の TVS_ASOBI_URL だけに置く（指示69 2-4）

'use strict';

const { DEFAULT_SETTINGS } = require('./tvs-auto');

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
// 指示75 4-1：8つまで（はじめからの7つ＋足せる1つ）。リモコンは物の数で 1列3つ／4つ×2段にかえ、スクロールせずに出す
const MAX_ITEMS = 8;

// はじめからある物。並び＝TV の PC のタブの並び（Ctrl+1〜5）。kind：fes=あつまれの TV／images=PC の画像／asobi=あそびまち／video=PC の動画／rest=休けい
const BUILTIN = [
  { id: 'fes', name: 'あつまれ', kind: 'fes', sound: 1 },
  { id: 'menu', name: 'メニュー', kind: 'images', sound: 0 },
  { id: 'asobi', name: 'あそびまち', kind: 'asobi', sound: 1 },
  { id: 'video', name: '動画1', kind: 'video', sound: 0 },   // 動画の音は、はじめ「切」（指示69 くまくんの決め）
  { id: 'rest', name: '休けい', kind: 'rest', sound: 0 },
  // 指示75 4-1（くまくんの決め）：動画と画像を2つずつ、別々のボタンで。休けいは5つ目のまま（TV の PC の Ctrl+5）・新しい2つはそのあと
  { id: 'menu2', name: '画像2', kind: 'images', sound: 0 },
  { id: 'video2', name: '動画2', kind: 'video', sound: 0 }
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
    CREATE TABLE IF NOT EXISTS tvs_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
  // 指示75 4-1：前からの入れ物は、はじめの5つの並び（ord 1〜5）と足した物の並びを変えず、無い物（画像2・動画2）をいちばんうしろに足す。
  // 「動画」は「動画1」に（係が名前を変えていなければ）
  db.prepare("UPDATE tvs_items SET name = '動画1' WHERE id = 'video' AND builtin = 1 AND name = '動画'").run();
  BUILTIN.forEach((b, i) => {
    if (db.prepare('SELECT 1 FROM tvs_items WHERE id = ?').get(b.id)) return;
    const max = (db.prepare('SELECT MAX(ord) AS m FROM tvs_items').get() || {}).m || 0;
    ins.run(b.id, b.name, b.kind, '12', b.sound, Math.max(i + 1, max + 1));
  });

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
  /** 設定（決まった6つの欄だけ）。無い欄は既定（tvs-auto.js DEFAULT_SETTINGS） */
  function settings() {
    const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    for (const r of db.prepare('SELECT key, value FROM tvs_settings').all()) {
      if (r.key in out) { try { out[r.key] = JSON.parse(r.value); } catch (e) {} }
    }
    return out;
  }
  /** 設定を変える。欄ごとに形を確かめ、合わない物は捨てる（変えた欄の名前を返す） */
  function setSettings(patch) {
    const p = patch || {}, cur = settings(), changed = [];
    const put = (k, v) => { db.prepare('INSERT INTO tvs_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v)); changed.push(k); };
    const tvMap = (v, f) => { const o = {}; [1, 2].forEach((tv) => { o[tv] = f(v && v[tv], tv); }); return o; };
    const text = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
    if (p.auto && typeof p.auto === 'object') put('auto', tvMap(p.auto, (v, tv) => (typeof v === 'boolean' ? v : !!cur.auto[tv])));
    if (p.rot && typeof p.rot === 'object') {
      const ids = items().map((it) => it.id);
      put('rot', tvMap(p.rot, (v, tv) => (Array.isArray(v) ? v : cur.rot[tv] || []).slice(0, 8)
        .filter((e) => e && ids.indexOf(e.item) !== -1)
        .map((e) => ({ item: e.item, sec: e.sec == null || e.sec === '' ? null : Math.max(5, Math.min(600, Math.round(+e.sec) || 20)) }))));
    }
    if (typeof p.chime === 'boolean') put('chime', p.chime);
    if (typeof p.fesBack === 'boolean') put('fesBack', p.fesBack);
    if (typeof p.rest === 'string') put('rest', text(p.rest, 30) || DEFAULT_SETTINGS.rest);
    if (p.notice && typeof p.notice === 'object') put('notice', tvMap(p.notice, (v, tv) => (typeof v === 'string' ? text(v, 40) : cur.notice[tv] || '')));
    return changed;
  }
  function listLog(limit) { return db.prepare('SELECT at, who, tv, item FROM tvs_log ORDER BY id DESC LIMIT ?').all(limit || 10); }
  function purge(now) { db.prepare('DELETE FROM tvs_log WHERE at < ?').run((now || Date.now()) - RETAIN_MS); }
  return { items, item, screens, setScreen, addItem, removeItem, updateItem, listLog, purge, settings, setSettings };
}

module.exports = { createTvsStore, BUILTIN, MAX_ITEMS, DEFAULT_SCREEN };
