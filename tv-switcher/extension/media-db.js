// media-db.js — TV の PC に置く画像・動画（指示69 2-2）。「はじめる」の画面で1回えらぶと、拡張機能の中（IndexedDB）に写して覚える。
// Chrome を開き直しても残る。入れかえは、もう一度えらぶだけ。物の id ごとに、ファイルの並び [{ name, type, blob }]

(function (root) {
  'use strict';
  const DB = 'tvs-media', STORE = 'files';
  function open() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(req && req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  const MediaDb = {
    get: (id) => run('readonly', (s) => s.get(id)).then((v) => v || []),
    put: (id, files) => run('readwrite', (s) => s.put(files, id)),
    keys: () => run('readonly', (s) => s.getAllKeys()).then((v) => v || []),
    /** { 物の id: 1つでもあるか } */
    async have(ids) {
      const out = {};
      for (const id of ids) out[id] = (await MediaDb.get(id)).length > 0;
      return out;
    }
  };
  root.MediaDb = MediaDb;
})(typeof self !== 'undefined' ? self : globalThis);
