// tests/wake-keep.js — スマホと TV の画面を消さない（指示71-1・Screen Wake Lock）
//
// 門：部屋に入ると取る・見え直すと取り直す・部屋を出ると外す・使えない端末で例外が出ない（navigator.wakeLock をにせ物にした検査）
// 前半は部品（public/js/wake-keep.js）だけ、後半は本物の画面（index.html・疑似 socket）で回す
const { createRunner, assert, assertEqual, launch, waitFor, sleep } = require('./harness');
const WakeKeep = require('../public/js/wake-keep');

/** にせの navigator.wakeLock。request の回数・いま持っている数・見えているかを数える */
function fakeEnv(opt) {
  const o = opt || {};
  const doc = { visibilityState: 'visible', handlers: [], addEventListener(n, fn) { if (n === 'visibilitychange') this.handlers.push(fn); },
    set(v) { this.visibilityState = v; this.handlers.forEach((fn) => fn()); } };
  const env = { requests: 0, live: [], doc };
  const nav = o.none ? {} : { wakeLock: { request(type) {
    env.requests++;
    if (type !== 'screen') return Promise.reject(new Error('type'));
    if (o.reject) return Promise.reject(Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' }));
    const s = { released: false, h: [], addEventListener(n, fn) { if (n === 'release') this.h.push(fn); },
      release() { if (!this.released) { this.released = true; env.live = env.live.filter((x) => x !== this); this.h.forEach((fn) => fn()); } return Promise.resolve(); } };
    env.live.push(s);
    return Promise.resolve(s);
  } } };
  env.nav = nav;
  // 画面が見えなくなると、ブラウザが自分で外す（決まり）
  env.hide = () => { env.live.slice().forEach((s) => s.release()); doc.set('hidden'); };
  env.show = () => doc.set('visible');
  return env;
}
const tick = () => new Promise((r) => setTimeout(r, 20));

(async function main() {
  const r = createRunner('wake-keep：スマホと TV の画面を消さない（指示71-1）');

  await r.test('部品：取りたい時に取る（1つだけ）・取りたくなくなったら外す', async () => {
    const env = fakeEnv(); let want = false;
    const k = WakeKeep.create({ nav: env.nav, doc: env.doc, want: () => want, everyMs: 0 });
    await tick();
    assertEqual(env.requests, 0, '部屋の外では取らない');
    want = true; k.sync(); k.sync(); await tick(); k.sync(); await tick();
    assertEqual(env.live.length, 1, '部屋に入ったら1つ取る（何度呼んでも1つ）');
    assertEqual(env.requests, 1, '取りに行くのは1回');
    want = false; k.sync(); await tick();
    assertEqual(env.live.length, 0, '部屋を出たら外す');
    k.stop();
  });

  await r.test('部品：見えなくなるとブラウザが外す → 見え直したら取り直す（部屋にいる間だけ）', async () => {
    const env = fakeEnv(); let want = true;
    const k = WakeKeep.create({ nav: env.nav, doc: env.doc, want: () => want, everyMs: 0 });
    await tick();
    assertEqual(env.live.length, 1, 'はじめに取る');
    env.hide(); await tick();
    assertEqual(env.live.length, 0, '見えなくなると外れる');
    k.sync(); await tick();
    assertEqual(env.live.length, 0, '見えていない間は取りに行かない');
    env.show(); await tick();
    assertEqual(env.live.length, 1, '見え直したら取り直す');
    want = false; env.hide(); env.show(); await tick();
    assertEqual(env.live.length, 0, '部屋にいないなら、見え直しても取らない');
    k.stop();
  });

  await r.test('部品：使えない端末（wakeLock が無い・断られる）でも例外を出さず、何も言わない', async () => {
    for (const opt of [{ none: true }, { reject: true }]) {
      const env = fakeEnv(opt);
      let threw = null;
      const onErr = (e) => { threw = e; };
      process.on('unhandledRejection', onErr);
      const k = WakeKeep.create({ nav: env.nav, doc: env.doc, want: () => true, everyMs: 0 });
      await tick(); k.sync(); env.show(); await tick();
      process.off('unhandledRejection', onErr);
      assertEqual(threw, null, JSON.stringify(opt) + '：例外が出ない');
      assertEqual(k.held(), false, JSON.stringify(opt) + '：持っていない');
      k.stop();
    }
    const k2 = WakeKeep.create({ nav: undefined, doc: undefined, want: () => true, everyMs: 0 });
    k2.sync(); k2.stop();
  });

  await r.test('部品：取りに行っている途中で部屋を出た → 届いた物はすぐ外す（持ちっぱなしにしない）', async () => {
    const env = fakeEnv(); let want = true;
    const k = WakeKeep.create({ nav: env.nav, doc: env.doc, want: () => want, everyMs: 0 });
    want = false;   // request の返事が来る前に出た
    await tick(); await tick();
    assertEqual(env.live.length, 0, '外した');
    k.stop();
  });

  // ---- 本物の画面 ----
  const SEED = 'window.__wk = { requests: 0, live: [] };' +
    'Object.defineProperty(window.navigator, "wakeLock", { configurable: true, value: { request: function(t){ window.__wk.requests++;' +
    ' var s = { released: false, h: [], addEventListener: function(n, fn){ if(n === "release") this.h.push(fn); },' +
    ' release: function(){ if(!this.released){ this.released = true; window.__wk.live = window.__wk.live.filter(function(x){ return x !== s; }); this.h.forEach(function(fn){ fn(); }); } return Promise.resolve(); } };' +
    ' window.__wk.live.push(s); return Promise.resolve(s); } } });';
  const room = (members) => ({ code: 'WKL234', ownerUserId: null, hostMemberId: 'h1', playerCount: members.length, memberCount: members.length,
    ready: { count: 0, total: members.length, waitingNames: [], all: false }, members, state: { phase: 'lobby', game: null, data: {} } });

  const ME = { id: 'm1', name: 'あき', role: 'player', connected: true };
  async function 入る(opt) {
    const o = opt || {};
    const t = await launch({ fakeSocket: true, rtSeed: o.noLock ? '' : SEED, noDoorWait: true });
    const w = t.win;
    await waitFor(w, () => w.__rtFake.connected, 4000, '疑似 socket');
    const mine = o.tv ? { id: 'tv', name: 'TV', role: 'bigscreen', connected: true } : ME;
    w.__rtFake.replies = { 'room:join': () => ({ ok: true, code: 'WKL234', memberId: mine.id, room: room([{ id: 'h1', name: 'ホスト', role: 'player', connected: true, isHost: true }, mine]) }) };
    if (!o.noLock) assertEqual(w.__wk.live.length, 0, '入口では取らない');
    await require('./harness').joinRoomV2(w, t.doc, 'WKL234', o.tv ? 'TV' : 'あき', o.tv ? { tv: true } : undefined);
    return t;
  }

  await r.test('画面：部屋に入ると取る・部屋が閉じたら外す（ふだんの部屋）', async () => {
    const t = await 入る();
    try {
      const w = t.win;
      await waitFor(w, () => w.__wk.live.length === 1, 4000, '部屋に入ったら取る');
      w.__rtFake.fire('room:closed', { by: 'h1' });
      await waitFor(w, () => w.__wk.live.length === 0, 4000, '部屋が閉じたら外す');
    } finally { t.win.close(); }
  });

  await r.test('画面：部屋から出された時も外す', async () => {
    const t = await 入る();
    try {
      const w = t.win;
      await waitFor(w, () => w.__wk.live.length === 1, 4000, '取る');
      w.__rtFake.fire('room:kicked', { by: 'h1' });
      await waitFor(w, () => w.__wk.live.length === 0, 4000, '出されたら外す');
    } finally { t.win.close(); }
  });

  await r.test('画面：見えなくなって外れたあと、見え直したら取り直す', async () => {
    const t = await 入る();
    try {
      const w = t.win, d = t.doc;
      await waitFor(w, () => w.__wk.live.length === 1, 4000, '取る');
      let vis = 'hidden';
      Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => vis });
      w.__wk.live.slice().forEach((x) => x.release());
      d.dispatchEvent(new w.Event('visibilitychange'));
      await sleep(w, 300);
      assertEqual(w.__wk.live.length, 0, '見えない間は持たない');
      vis = 'visible';
      d.dispatchEvent(new w.Event('visibilitychange'));
      await waitFor(w, () => w.__wk.live.length === 1, 2000, '見え直したら取り直す');
    } finally { t.win.close(); }
  });

  await r.test('画面：TV（大画面）として部屋に入っている間も取る', async () => {
    const t = await 入る({ tv: true });
    try { await waitFor(t.win, () => t.win.__wk.live.length === 1, 4000, 'TV も取る'); } finally { t.win.close(); }
  });

  await r.test('画面：wakeLock が無い端末で、部屋に入っても例外が出ない', async () => {
    const t = await 入る({ noLock: true });
    try {
      assert(!t.win.navigator.wakeLock, 'jsdom には wakeLock が無い（使えない端末と同じ）');
      await sleep(t.win, 2500);
      assertEqual(t.errors.length, 0, '例外が出ない（' + t.errors.join(' / ') + '）');
    } finally { t.win.close(); }
  });

  r.finish();
  process.exit(0);
})();
