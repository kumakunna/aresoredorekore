// tests/sound.js — 音の箱（public/js/sound.js）と司会の声の差し込み口（指示68-2 第3節・第6節）
//
// 見るもの（門6・門10・門11）：
//   ・だれが鳴らすか：TV は全部・TV がいる部屋のスマホは「コツ」だけ・TV が無い遊び方はスマホが全部・音量 0 は何も
//   ・声は TV だけ。ファイルが無い言葉は何も鳴らさない（止まらない）。ある時は毎回変わる
//   ・**指示68-T 3：声は全部止めた**（TV でも鳴らさない・読み込まない。ファイルは残す）
//   ・指示68-T 4：同じ効果音は同時に3つまで
//   ・ファイルが読めない時は今の電子音（代わり）で鳴る。AudioContext は1つを使い回す
//   ・index.html から電子音（beep・buzz など）を直に呼んでいる所が、箱の「代わり」と電子音どうしの中だけ
const fs = require('fs');
const path = require('path');
const RT = require('../realtime');
const H = require('./harness');
const { createRunner, assert, assertEqual, launch, sleep } = H;

const ROOT = path.join(__dirname, '..');
const Sound = require('../public/js/sound.js');

/** 音のファイルを配る偽物：manifest と、mp3 の代わりの小さな箱 */
function 偽の配り手(manifest) {
  const 頼まれた = [];
  const f = (url) => {
    頼まれた.push(url);
    if (/index\.json$/.test(url)) return Promise.resolve(manifest ? { ok: true, json: () => Promise.resolve(manifest) } : { ok: false });
    return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve({ url }) });
  };
  return { f, 頼まれた };
}
/** AudioContext の偽物：作った数と、鳴らした buffer を数える */
function 偽の音() {
  const 記録 = { 作った: 0, 鳴った: [] };
  const make = () => {
    記録.作った++;
    return {
      state: 'running', destination: {},
      decodeAudioData: (ab, ok) => ok({ from: ab.url }),
      createBufferSource: () => ({ connect() {}, start() { 記録.鳴った.push(this.buffer.from); } })
    };
  };
  return { make, 記録 };
}
function 箱(o) {
  Sound.reset();
  const 代わり = [];
  const fallback = {};
  Sound.IDS.forEach((id) => { if (id !== 'tap') fallback[id] = () => 代わり.push(id); });
  Sound.setup(Object.assign({ base: 'sound/', volume: () => 1, where: () => ({ tv: true, tvInRoom: true }),
    out: null, fallback, fetch: null, makeContext: null, rnd: Math.random }, o || {}));
  return 代わり;
}

(async function main() {
  const r = createRunner('sound：音の箱と司会の声（指示68-2）');

  await r.test('門11：だれが鳴らすか（TV は全部・TV がいる部屋のスマホはコツだけ・TV が無ければスマホが全部・音量0は何も）', async () => {
    const 表 = [
      [{ tv: true, tvInRoom: true }, 1, 'ok', true], [{ tv: true, tvInRoom: true }, 1, 'tap', true],
      [{ tv: false, tvInRoom: true }, 1, 'ok', false], [{ tv: false, tvInRoom: true }, 1, 'tap', true],
      [{ tv: false, tvInRoom: true }, 1, 'boom', false],
      [{ tv: false, tvInRoom: false }, 1, 'ok', true], [{ tv: false, tvInRoom: false }, 1, 'boom', true],
      [{ tv: true, tvInRoom: true }, 0, 'ok', false], [{ tv: false, tvInRoom: true }, 0, 'tap', false]
    ];
    表.forEach(([w, vol, id, want]) => assertEqual(Sound.shouldPlay(id, w, vol), want, JSON.stringify(w) + ' 音量' + vol + ' の ' + id));
    // 声は止めた（指示68-T 3）：TV でも鳴らさない。スマホは前から鳴らさない
    assertEqual(Sound.voiceShouldPlay({ tv: true }, 1), false, '指示68-T 3：TV でも声を鳴らさない');
    assertEqual(Sound.VOICE_ON, false, '声のスイッチは切');
    assertEqual(Sound.voiceShouldPlay({ tv: false, tvInRoom: false }, 1), false, 'TV が無い時もスマホは声を鳴らさない');
    assertEqual(Sound.voiceShouldPlay({ tv: true }, 0), false, '音量0の TV は鳴らさない');
  });

  await r.test('門11：ファイルが無い時は今の電子音で鳴る（index.json が無い・止まらない）', async () => {
    const 配り手 = 偽の配り手(null);
    const 代わり = 箱({ fetch: 配り手.f, makeContext: 偽の音().make });
    assertEqual(await Sound.preload('tv'), 0, '読む物は無い');
    assertEqual(Sound.play('ok'), 'fallback', 'ok は電子音');
    assertEqual(Sound.play('miss'), 'fallback', 'miss は電子音');
    assertEqual(Sound.play('tap'), 'none', 'コツは代わりの電子音を持たない（ファイルが届くまで今と同じ静けさ）');
    assertEqual(代わり.join(','), 'ok,miss', '代わりが呼ばれた');
  });

  await r.test('門6：声は止めた（TV でも鳴らない・指示68-T 3）／効果音は毎回変わる／スマホでは鳴らない', async () => {
    const 音 = 偽の音();
    const 配り手 = 偽の配り手({ se: { ok: 3 }, voice: { v24: 2 } });
    箱({ fetch: 配り手.f, makeContext: 音.make, rnd: () => 0 });
    await Sound.preload('tv');
    assertEqual(Sound.voice('v25'), 'off', 'TV でも声は鳴らさない（ファイルが無い言葉）');
    assertEqual(Sound.voice('v24'), 'off', 'TV でも声は鳴らさない（ファイルがある言葉）');
    assertEqual(音.記録.鳴った.length, 0, '何も鳴っていない');
    // 効果音も同じ（3本から、前と違う1本）
    const 効果 = [];
    for (let i = 0; i < 6; i++) { Sound.play('ok'); 効果.push(音.記録.鳴った[音.記録.鳴った.length - 1]); }
    for (let i = 1; i < 効果.length; i++) assert(効果[i] !== 効果[i - 1], '同じ効果音が続かない（' + 効果.join(' ') + '）');
    // スマホ（TV がいる部屋）では声を鳴らさない
    Sound.setup({ where: () => ({ tv: false, tvInRoom: true }) });
    assertEqual(Sound.voice('v24'), 'off', 'スマホでは声を鳴らさない');
  });

  await r.test('指示68-T 4：同じ効果音は同時に3つまで（4つ目は鳴らさない）。鳴り終わればまた鳴る・ほかの音は数えない', async () => {
    const 記録 = { 鳴った: [] };
    const c = {
      state: 'running', destination: {}, currentTime: 0,
      decodeAudioData: (ab, ok) => ok({ from: ab.url, duration: 0.1 }),
      createBufferSource: () => ({ playbackRate: { value: 1 }, connect() {}, start() { 記録.鳴った.push(this.buffer.from); } })
    };
    箱({ fetch: 偽の配り手({ se: { tap: 3, ok: 1 } }).f, makeContext: () => c });
    await Sound.preload('all');
    const 結果 = [];
    for (let i = 0; i < 5; i++) 結果.push(Sound.play('tap'));
    assertEqual(結果.join(','), 'file,file,file,full,full', '同じ瞬間の tap は3つまで');
    assertEqual(Sound.play('ok'), 'file', 'ほかの音は数えない');
    c.currentTime = 0.05;
    assertEqual(Sound.play('tap'), 'full', 'まだ3つ鳴っている');
    c.currentTime = 0.11;
    assertEqual(Sound.play('tap'), 'file', '鳴り終われば、また鳴る');
    // 高さを上げると早く終わる（長さ÷高さ）
    c.currentTime = 1; Sound.play('tap', { rate: 2 }); Sound.play('tap', { rate: 2 }); Sound.play('tap', { rate: 2 });
    c.currentTime = 1.06;
    assertEqual(Sound.play('tap'), 'file', '高さ2倍の音は 0.05秒で終わる');
    assertEqual(Sound.MAX_SAME, 3, '上限は3');
  });

  await r.test('門11：AudioContext は1つを使い回す（1回ごとに作ると6個前後で音が止まる）', async () => {
    const 音 = 偽の音();
    箱({ fetch: 偽の配り手({ se: { ok: 2, miss: 2 } }).f, makeContext: 音.make });
    await Sound.preload('all');
    for (let i = 0; i < 20; i++) Sound.play(i % 2 ? 'ok' : 'miss');
    assertEqual(音.記録.作った, 1, 'AudioContext を作ったのは1回');
    assertEqual(音.記録.鳴った.length, 20, '20回鳴った');
  });

  await r.test('入口の重さ：あとから読む。スマホは「コツ」だけ、TV は効果音と声を全部', async () => {
    const 配り手 = 偽の配り手({ se: { ok: 2, tap: 2, boom: 1 }, voice: { v24: 2 } });
    箱({ fetch: 配り手.f, makeContext: 偽の音().make });
    assertEqual(配り手.頼まれた.length, 0, 'setup だけでは何も読まない');
    await Sound.preload('tap');
    assertEqual(配り手.頼まれた.filter((u) => /\.mp3$/.test(u)).join(','), 'sound/se/tap-1.mp3,sound/se/tap-2.mp3', 'スマホはコツだけ');
    await Sound.preload('tv');
    const 声 = 配り手.頼まれた.filter((u) => /voice\//.test(u));
    assertEqual(声.length, 0, '指示68-T 3：TV も声は読まない（効果音だけ）');
    assert(配り手.頼まれた.some((u) => /se\/boom-1\.mp3$/.test(u)), 'TV は効果音を全部読む');
    const 前 = 配り手.頼まれた.length;
    await Sound.preload('tv');
    assertEqual(配り手.頼まれた.length, 前, '2回目は何も読まない');
    // 音量を試すボタン（force）は、TV がいる部屋のスマホでも鳴る
    Sound.setup({ where: () => ({ tv: false, tvInRoom: true }) });
    assertEqual(Sound.play('ok'), 'off', 'ふだんは鳴らさない');
    assertEqual(Sound.play('ok', { force: true }), 'file', '音量を試すボタンは鳴る');
  });

  await r.test('門10：電子音（beep・buzz など）を直に呼んでいる所は、箱の「代わり」と電子音どうしの中だけ', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
    const 名前 = ['beep', 'buzz', 'wrongSound', 'fanfareSound', 'cheerSound', 'timeUpSound', 'gavelSound', 'soldSound', 'snipSound', 'timesUpChimeSound'];
    // 許す範囲：Sound.setup({ … }) の中と、電子音の関数の本体
    const 範囲 = [];
    const a = html.indexOf('if(window.Sound) Sound.setup({');
    assert(a > 0, '箱につなぐ所が見つかる');
    範囲.push([a, html.indexOf('\n  });', a)]);
    名前.forEach((n) => {
      const s = html.indexOf('  function ' + n + '(');
      assert(s > 0, n + ' の本体が見つかる（名前が変わった？）');
      範囲.push([s, html.indexOf('\n  }\n', s)]);
    });
    const 外 = [];
    let 数えた = 0;
    for (const m of html.matchAll(new RegExp('\\b(' + 名前.join('|') + ')\\(', 'g'))) {
      const before = html.slice(Math.max(0, m.index - 9), m.index);
      if (/function $/.test(before)) continue;
      const 行頭 = html.lastIndexOf('\n', m.index);
      if (/^\s*(\/\/|\*)/.test(html.slice(行頭 + 1, m.index))) continue;   // コメントの中の名前
      数えた++;
      if (!範囲.some(([x, y]) => m.index > x && m.index < y)) 外.push(html.slice(0, m.index).split('\n').length + '行目 ' + m[1]);
    }
    assert(数えた >= 5, '電子音の呼び出しを数えられている（' + 数えた + '）');   // 型(b)
    assertEqual(外.join('・'), '', '箱を通らずに電子音を鳴らしている所');
    // 演出の部品（FxKit）の音も箱を通る
    const fx = html.slice(html.indexOf('      sound: {', html.indexOf('FxKit.init')), html.indexOf('      can: {', html.indexOf('FxKit.init')));
    assert(/sfx\('ok'/.test(fx) && /sfx\('miss'/.test(fx) && /sfx\('fanfare'/.test(fx), 'FxKit の音も sfx を通る');
  });

  await r.test('門11（画面）：TV がいる部屋のスマホは、まちがいの音を鳴らさない／TV が無ければ鳴らす（電子音で）', async () => {
    // TV が無い（1台で遊ぶ）
    const a = await launch({ fakeSocket: true });
    a.win.FxKit.flash('bad');
    await sleep(a.win, 30);
    const la = a.win.sfxProbe();
    assertEqual(la.where.tvInRoom, false, '前提：TV はいない');
    assert(la.log.some((x) => x.id === 'miss' && x.how === 'fallback'), 'TV が無ければスマホで鳴る（' + JSON.stringify(la.log) + '）');
    a.win.close();
    // TV がいる部屋のスマホ
    const b = await launch({ fakeSocket: true });
    const store = new RT.RoomStore();
    const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
    room.members.set('m1', { id: 'm1', name: 'ふう', role: RT.ROLE_PLAYER, connected: true, joinedAt: 1, lastSeen: Date.now(), readyGame: null });
    room.members.set('tv', { id: 'tv', name: 'TV', role: RT.ROLE_BIGSCREEN, connected: true, joinedAt: 1, lastSeen: Date.now(), readyGame: null });
    room.hostMemberId = 'm1';
    const snap = JSON.parse(JSON.stringify(RT.publicSnapshot(room)));
    b.win.__rtFake.replies = { 'room:create': () => ({ ok: true, code: snap.code, memberId: 'm1', room: snap }) };
    await H.makeRoomV2(b.win, b.doc);
    b.win.__rtFake.fire('room:update', snap);
    await sleep(b.win, 30);
    assertEqual(b.win.sfxProbe().where.tvInRoom, true, '前提：TV がいる');
    b.win.FxKit.flash('bad');
    await sleep(b.win, 30);
    const lb = b.win.sfxProbe().log;
    assert(lb.some((x) => x.id === 'miss' && x.how === 'off'), 'TV がいる部屋のスマホでは鳴らさない（' + JSON.stringify(lb) + '）');
    b.win.close();
  });

  // ===== 第3節：司会の声を流れに差しこむ（言うのは TV だけ。ここでは「何を言おうとしたか」を記録して見る） =====
  const 声を聞く = (win) => { const 言った = []; win.Sound.voice = (id) => { 言った.push(id); return 'none'; }; return 言った; };

  await r.test('第3節：3・2・1 は v07a・v07b・v07c、数え終わりに v08「スタート！」', async () => {
    const t = await launch({ fakeSocket: true });
    const 言った = 声を聞く(t.win);
    await t.win.FxKit.countdown(3);
    assertEqual(言った.join(','), 'v07a,v07b,v07c,v08', '3→v07a・2→v07b・1→v07c・スタート');
    t.win.close();
  });

  await r.test('第3節：終わりの声 … 解除は v24 → 幕が上がる時 v11、時間切れの爆発は v09 → v12 → v10', async () => {
    const t = await launch({ fakeSocket: true });
    const 言った = 声を聞く(t.win);
    const 送る = async () => { for (let i = 0; i < 5 && t.doc.querySelector('.fx-finale'); i++) { t.win.FxKit.skipNow(); await sleep(t.win, 150); } };
    const p1 = t.win.bombFinaleProbe({ success: true, tv: true, names: ['ふう'] });
    await sleep(t.win, 900); await 送る(); await p1;
    assertEqual(言った.join(','), 'v24,v11', '解除成功！ → おめでとう！');
    言った.length = 0;
    const p2 = t.win.bombFinaleProbe({ success: false, tv: true, left: 2, cause: 'time' });
    await sleep(t.win, 2100); await 送る(); await p2;
    assertEqual(言った.join(','), 'v09,v12,v10', 'そこまで！ → おしい！ → 結果発表！');
    t.win.close();
  });

  await r.test('第3節：TV の待合で v01、ゲームを選んで準備OK の待合で v06（段階を出てもどれば、また言う）', async () => {
    const t = await launch({ fakeSocket: true });
    const store = new RT.RoomStore();
    const room = store.create({ ownerUserId: 1, ownerUsername: 'kuma' });
    room.code = 'ABC234';
    room.members.set('m1', { id: 'm1', name: 'ふう', role: RT.ROLE_PLAYER, connected: true, joinedAt: 1, lastSeen: Date.now(), readyGame: null });
    room.members.set('tv', { id: 'tv', name: 'テレビ', role: RT.ROLE_BIGSCREEN, connected: true, joinedAt: 1, lastSeen: Date.now(), readyGame: null });
    room.hostMemberId = 'm1';
    const snap = () => JSON.parse(JSON.stringify(RT.publicSnapshot(room)));
    t.win.__rtFake.replies = { 'room:join': () => ({ ok: true, code: 'ABC234', memberId: 'tv', room: snap() }) };
    await H.joinRoomV2(t.win, t.doc, 'ABC234', 'テレビ');
    const 言った = 声を聞く(t.win);
    t.win.__rtFake.fire('room:update', snap());
    await sleep(t.win, 60);
    t.win.__rtFake.fire('room:update', snap());
    await sleep(t.win, 60);
    assertEqual(言った.join(','), 'v01', '待合で1回（知らせが2回来ても1回）');
    room.state.game = 'bomb';
    t.win.__rtFake.fire('room:update', snap());
    await sleep(t.win, 60);
    assertEqual(言った.join(','), 'v01,v06', 'ゲームを選んだら「じゅんびはいい？」');
    room.state.game = null;
    t.win.__rtFake.fire('room:update', snap());
    await sleep(t.win, 60);
    assertEqual(言った.join(','), 'v01,v06,v01', '待合にもどれば、また v01');
    t.win.close();
  });

  r.finish();
})();
