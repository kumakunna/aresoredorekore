// defuse-logic.js — 爆弾解除カセット「実物解除」のルール層（第27弾-3）
//
// 設計の芯は bomb-logic.js / wolf-logic.js とまったく同じ:
//   DOM も socket.io も知らない。Node.js から require できる純粋な計算だけを置く。
//   だから jsdom を立てずに単体テストできる。
//
// Keep Talking and Nobody Explodes の「情報の非対称性」という構造だけを参考にし、
// 判定ルールは全部このファイルで新しく決めている（対応表も手順も一切借りていない）。
//
// ---- 9種のモジュールを1つの型に収める ----
// どのモジュールも、生成すると必ずこの3つを持つ:
//
//   hint     … 解除役の画面にいつも出てよいもの（色・記号など、それだけでは解けない）
//   manual   … hint を答えに変える対応表。マニュアル役だけが見る
//   answer   … 正解。誰の画面にも出さない（サーバーだけが持つ）
//
// マニュアルあり … 解除役は hint、マニュアル役は manual。口で伝え合って解く
// マニュアルなし … 同じ manual を解除役の画面に出す（自力で解ける）
//
// この3つに揃えたおかげで、「マニュアルあり／なし」の切り替えは
// 「対応表を誰に渡すか」だけになり、モジュールごとに書き分けなくて済む。
// （マニュアルなしが簡単・速くなるのは承知のうえ。別の性質の遊びとして扱う）
//
// ---- 判定はサーバーが持つ ----
// 解除役の端末に answer を渡さないので、判定は必ずサーバーで行う。
// センサーを使うモジュールは、端末から「粗くした測定値」だけを送り、
// 届いているかどうかはサーバーが決める（端末に正解を持たせない）。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DefuseLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 小さな道具 ----
  function defaultRnd() { return Math.random(); }
  function pick(list, rnd) { return list[Math.floor((rnd || defaultRnd)() * list.length)]; }
  function shuffled(list, rnd) {
    var r = rnd || defaultRnd;
    var a = (list || []).slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function intBetween(min, max, rnd) {
    return min + Math.floor((rnd || defaultRnd)() * (max - min + 1));
  }
  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  // ---- 共通の部品 ----
  var COLORS = [
    { id: 'red', label: '赤', emoji: '🔴' },
    { id: 'blue', label: '青', emoji: '🔵' },
    { id: 'green', label: '緑', emoji: '🟢' },
    { id: 'yellow', label: '黄', emoji: '🟡' }
  ];
  var MARKS = ['★', '●', '▲', '■', '♦', '✚'];
  var DIRS = [
    { id: 'n', label: '北', deg: 0 },
    { id: 'e', label: '東', deg: 90 },
    { id: 's', label: '南', deg: 180 },
    { id: 'w', label: '西', deg: 270 }
  ];
  // 端末の向き。①面認証で使う4つの面
  var FACES = [
    { id: 'up', label: '上向き' },
    { id: 'down', label: '下向き' },
    { id: 'left', label: '左に倒す' },
    { id: 'right', label: '右に倒す' }
  ];
  var POSES = [
    { id: 'banzai', label: 'バンザイ', desc: '両手をまっすぐ上に' },
    { id: 'tpose', label: '横いっぱい', desc: '両手を真横に伸ばす' },
    { id: 'onehand', label: '片手あげ', desc: '右手だけを上に' },
    { id: 'crouch', label: 'しゃがむ', desc: 'その場でしゃがむ' }
  ];

  function colorById(id) { return COLORS.find(function (c) { return c.id === id; }) || COLORS[0]; }
  function dirById(id) { return DIRS.find(function (d) { return d.id === id; }) || DIRS[0]; }
  function poseById(id) { return POSES.find(function (p) { return p.id === id; }) || POSES[0]; }

  // 方角の差（0〜180度）。359度と1度が「2度差」になるようにする
  function degDiff(a, b) {
    var d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
  }

  // ================= ① 面認証 =================
  // 端末を4つの向きに回すと、それぞれの面の色と記号が見える。
  // 対応表は「色と記号 → 押すボタンの色」。4面ぶん正しく押せたら解除。
  var faceModule = {
    id: 'face', name: '面認証', icon: '🔄',
    physical: false, needsManualHolders: 0, needs: ['orientation'],
    lead: '端末を回して、出てきた面のとおりにボタンを押そう',
    generate: function (rnd) {
      var marks = shuffled(MARKS, rnd).slice(0, 4);
      var faces = FACES.map(function (f, i) {
        return { face: f.id, color: shuffled(COLORS, rnd)[0].id, mark: marks[i] };
      });
      // 対応表：面の色と記号の組から、押すボタンの色を決める。
      // 記号ごとに違う「ずらし方」を割り当てるので、色だけ・記号だけでは解けない
      var shifts = {};
      marks.forEach(function (m, i) { shifts[m] = intBetween(1, 3, rnd); });
      var answer = faces.map(function (f) {
        var at = COLORS.findIndex(function (c) { return c.id === f.color; });
        return COLORS[(at + shifts[f.mark]) % COLORS.length].id;
      });
      return {
        hint: { faces: faces, order: FACES.map(function (f) { return f.id; }) },
        manual: {
          kind: 'faceTable',
          rows: marks.map(function (m) {
            return {
              mark: m,
              // 「この記号なら、面の色から何個ずらした色を押す」
              map: COLORS.map(function (c, at) {
                return { from: c.id, to: COLORS[(at + shifts[m]) % COLORS.length].id };
              })
            };
          })
        },
        answer: { buttons: answer },   // 面の並び順に押すべきボタンの色
        progress: { step: 0, total: 4 }
      };
    },
    // action: { type:'press', face:'up', color:'red' }
    judge: function (inst, action) {
      if (!action || action.type !== 'press') return { ok: false };
      var idx = inst.hint.order.indexOf(action.face);
      if (idx === -1) return { ok: false };
      // 順番どおりの面でなければ、押しても進まない（間違いにもしない）
      if (idx !== inst.progress.step) return { ok: true, note: 'wrongFace' };
      if (action.color !== inst.answer.buttons[idx]) return { ok: true, miss: true };
      inst.progress.step++;
      return { ok: true, solved: inst.progress.step >= 4 };
    }
  };

  // ================= ② 傾け迷路 =================
  // 5×5。傾けた向きに1マスずつ進む。壁は進めず、罠を踏むとミス。
  // 対応表は迷路の地図そのもの。
  var MAZE_SIZE = 5;
  var mazeModule = {
    id: 'maze', name: '傾け迷路', icon: '🌀',
    physical: false, needsManualHolders: 0, needs: ['orientation'],
    lead: '端末を傾けて、ボールをゴールまで運ぼう',
    generate: function (rnd) {
      var n = MAZE_SIZE;
      // 壁は「マスとマスの間」ではなく「入れないマス」で表す（口で伝えやすい）
      var blocked = {}, traps = {};
      var start = { x: 0, y: 0 };
      var goal = { x: n - 1, y: n - 1 };
      var key = function (p) { return p.x + ',' + p.y; };
      // 必ず通れる道を1本引いてから、その道以外に壁と罠を置く
      var path = [{ x: 0, y: 0 }];
      var cur = { x: 0, y: 0 };
      var guard = 0;
      while ((cur.x !== goal.x || cur.y !== goal.y) && guard++ < 100) {
        var goRight = (cur.y === goal.y) ? true : (cur.x === goal.x ? false : (rnd || defaultRnd)() < 0.5);
        cur = goRight ? { x: cur.x + 1, y: cur.y } : { x: cur.x, y: cur.y + 1 };
        path.push(cur);
      }
      var onPath = {};
      path.forEach(function (p) { onPath[key(p)] = true; });
      var free = [];
      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          if (!onPath[key({ x: x, y: y })]) free.push({ x: x, y: y });
        }
      }
      shuffled(free, rnd).slice(0, 6).forEach(function (p) { blocked[key(p)] = true; });
      shuffled(free.filter(function (p) { return !blocked[key(p)]; }), rnd)
        .slice(0, 3).forEach(function (p) { traps[key(p)] = true; });
      return {
        hint: { size: n, start: start, goal: goal, at: { x: start.x, y: start.y } },
        manual: {
          kind: 'mazeMap', size: n, goal: goal,
          blocked: Object.keys(blocked), traps: Object.keys(traps)
        },
        answer: { blocked: blocked, traps: traps, goal: goal },
        progress: { at: { x: start.x, y: start.y }, steps: 0 }
      };
    },
    // action: { type:'step', dir:'up'|'down'|'left'|'right' }
    judge: function (inst, action) {
      if (!action || action.type !== 'step') return { ok: false };
      var d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[action.dir];
      if (!d) return { ok: false };
      var at = inst.progress.at;
      var to = { x: at.x + d[0], y: at.y + d[1] };
      var n = inst.hint.size;
      if (to.x < 0 || to.y < 0 || to.x >= n || to.y >= n) return { ok: true, note: 'wall' };
      var k = to.x + ',' + to.y;
      if (inst.answer.blocked[k]) return { ok: true, note: 'wall' };
      inst.progress.at = to;
      inst.progress.steps++;
      if (inst.answer.traps[k]) {
        // 罠を踏んだらミス。スタートに戻して続けられるようにする（詰みを作らない）
        inst.progress.at = { x: inst.hint.start.x, y: inst.hint.start.y };
        return { ok: true, miss: true, note: 'trap' };
      }
      if (to.x === inst.answer.goal.x && to.y === inst.answer.goal.y) {
        return { ok: true, solved: true };
      }
      return { ok: true };
    }
  };

  // ================= ③ 振ってアクション =================
  // 指定の回数だけ、指定のテンポで振る。
  // 対応表は「記号 → 回数とテンポ」。
  var SHAKE_TEMPOS = [
    { id: 'fast', label: 'はやく', maxGapMs: 700 },
    { id: 'slow', label: 'ゆっくり', minGapMs: 900 }
  ];
  var shakeModule = {
    id: 'shake', name: '振ってアクション', icon: '📳',
    physical: true, needsManualHolders: 0, needs: ['motion'],
    lead: '決まった回数・テンポで端末を振ろう',
    generate: function (rnd) {
      var mark = pick(MARKS, rnd);
      var count = intBetween(3, 6, rnd);
      var tempo = pick(SHAKE_TEMPOS, rnd).id;
      // 対応表：記号ごとに「回数とテンポ」が決まっている
      var rows = shuffled(MARKS, rnd).slice(0, 4);
      if (rows.indexOf(mark) === -1) rows[0] = mark;
      var table = rows.map(function (m) {
        return m === mark
          ? { mark: m, count: count, tempo: tempo }
          : { mark: m, count: intBetween(3, 6, rnd), tempo: pick(SHAKE_TEMPOS, rnd).id };
      });
      return {
        hint: { mark: mark },
        manual: { kind: 'shakeTable', rows: table },
        answer: { count: count, tempo: tempo },
        progress: { done: false }
      };
    },
    // action: { type:'shakes', count:n, gaps:[ms,...] }
    judge: function (inst, action) {
      if (!action || action.type !== 'shakes') return { ok: false };
      var want = inst.answer;
      if (action.count !== want.count) return { ok: true, miss: true, note: 'count' };
      var gaps = action.gaps || [];
      var spec = SHAKE_TEMPOS.find(function (t) { return t.id === want.tempo; });
      var okTempo = gaps.every(function (g) {
        return spec.maxGapMs ? g <= spec.maxGapMs : g >= spec.minGapMs;
      });
      if (!okTempo) return { ok: true, miss: true, note: 'tempo' };
      inst.progress.done = true;
      return { ok: true, solved: true };
    }
  };

  // ================= ④ コンパス方角 =================
  // 決まった方角へ向けて、少しのあいだキープする。
  // 対応表は「色と記号 → 方角」。
  var COMPASS_TOLERANCE_DEG = 22;
  var COMPASS_HOLD_MS = 1500;
  var compassModule = {
    id: 'compass', name: 'コンパス方角', icon: '🧭',
    physical: false, needsManualHolders: 0, needs: ['compass'],
    lead: '決まった方角へ端末を向けて、そのままキープ',
    generate: function (rnd) {
      var color = pick(COLORS, rnd).id;
      var mark = pick(MARKS, rnd);
      var dirs = shuffled(DIRS, rnd);
      // 対応表：色ごとに方角が決まり、記号が「1つ隣にずらすか」を決める
      var base = {};
      COLORS.forEach(function (c, i) { base[c.id] = dirs[i % dirs.length].id; });
      var shiftMarks = shuffled(MARKS, rnd).slice(0, 3);
      var shift = shiftMarks.indexOf(mark) >= 0 ? 1 : 0;
      var at = DIRS.findIndex(function (d) { return d.id === base[color]; });
      var answerDir = DIRS[(at + shift) % DIRS.length].id;
      return {
        hint: { color: color, mark: mark },
        manual: {
          kind: 'compassTable',
          base: COLORS.map(function (c) { return { color: c.id, dir: base[c.id] }; }),
          shiftMarks: shiftMarks
        },
        answer: { dir: answerDir },
        progress: { holdMs: 0, needMs: COMPASS_HOLD_MS }
      };
    },
    // action: { type:'heading', deg:number, dtMs:number }
    judge: function (inst, action) {
      if (!action || action.type !== 'heading') return { ok: false };
      var target = dirById(inst.answer.dir).deg;
      var within = degDiff(action.deg, target) <= COMPASS_TOLERANCE_DEG;
      if (!within) { inst.progress.holdMs = 0; return { ok: true }; }
      inst.progress.holdMs += Math.max(0, Math.min(500, action.dtMs || 0));
      if (inst.progress.holdMs >= inst.progress.needMs) return { ok: true, solved: true };
      return { ok: true };
    }
  };

  // ================= ⑤ 水平キープ =================
  // 決まった秒数のあいだ、決まった範囲に水平を保つ。
  // 対応表は「記号 → 目標の秒数と許容範囲」。
  var levelModule = {
    id: 'level', name: '水平キープ', icon: '🫧',
    physical: false, needsManualHolders: 0, needs: ['orientation'],
    lead: '端末を水平にして、そのまま止めよう',
    generate: function (rnd) {
      var mark = pick(MARKS, rnd);
      var rows = shuffled(MARKS, rnd).slice(0, 4);
      if (rows.indexOf(mark) === -1) rows[0] = mark;
      var table = rows.map(function (m) {
        return { mark: m, seconds: intBetween(2, 5, rnd), toleranceDeg: intBetween(5, 15, rnd) };
      });
      var mine = table.find(function (r) { return r.mark === mark; });
      return {
        hint: { mark: mark },
        manual: { kind: 'levelTable', rows: table },
        answer: { seconds: mine.seconds, toleranceDeg: mine.toleranceDeg },
        progress: { holdMs: 0, needMs: mine.seconds * 1000 }
      };
    },
    // action: { type:'tilt', deg:number, dtMs:number }
    judge: function (inst, action) {
      if (!action || action.type !== 'tilt') return { ok: false };
      if (Math.abs(action.deg) > inst.answer.toleranceDeg) {
        inst.progress.holdMs = 0;
        return { ok: true };
      }
      inst.progress.holdMs += Math.max(0, Math.min(500, action.dtMs || 0));
      if (inst.progress.holdMs >= inst.progress.needMs) return { ok: true, solved: true };
      return { ok: true };
    }
  };

  // ================= ⑥ リズム合わせ =================
  // 8拍のうち、決められた拍だけを叩く。拍はクイズ解除の心拍と同じ間隔。
  // 対応表は「記号 → 叩く拍」。
  var RHYTHM_BEATS = 8;
  var rhythmModule = {
    id: 'rhythm', name: 'リズム合わせ', icon: '💓',
    physical: false, needsManualHolders: 0,
    lead: '心拍に合わせて、決められた拍だけを叩こう',
    generate: function (rnd) {
      var mark = pick(MARKS, rnd);
      var rows = shuffled(MARKS, rnd).slice(0, 4);
      if (rows.indexOf(mark) === -1) rows[0] = mark;
      var table = rows.map(function (m) {
        var beats = shuffled([0, 1, 2, 3, 4, 5, 6, 7], rnd)
          .slice(0, intBetween(3, 4, rnd)).sort(function (a, b) { return a - b; });
        return { mark: m, beats: beats };
      });
      var mine = table.find(function (r) { return r.mark === mark; });
      return {
        hint: { mark: mark, beats: RHYTHM_BEATS },
        manual: { kind: 'rhythmTable', rows: table, beats: RHYTHM_BEATS },
        answer: { beats: mine.beats },
        progress: { done: false }
      };
    },
    // action: { type:'taps', beats:[i,...] }（1周ぶんをまとめて送る）
    judge: function (inst, action) {
      if (!action || action.type !== 'taps') return { ok: false };
      var got = (action.beats || []).slice().sort(function (a, b) { return a - b; }).join(',');
      var want = inst.answer.beats.join(',');
      if (got !== want) return { ok: true, miss: true };
      inst.progress.done = true;
      return { ok: true, solved: true };
    }
  };

  // ================= ⑧ ポーズ指定 =================
  // 指示のポーズを取る。姿勢の判定はスマホの中だけで行い、
  // カメラ映像はサーバーへ送らないし、どこにも記録しない。
  // 対応表は「色と記号 → ポーズ」。
  var poseModule = {
    id: 'pose', name: 'ポーズ指定', icon: '🙆',
    physical: true, needsManualHolders: 0, needsCamera: true, needs: ['camera'],
    lead: '指示のポーズを取ろう（カメラは端末の中だけで使います）',
    generate: function (rnd) {
      var color = pick(COLORS, rnd).id;
      var poses = shuffled(POSES, rnd);
      var map = {};
      COLORS.forEach(function (c, i) { map[c.id] = poses[i % poses.length].id; });
      return {
        hint: { color: color },
        manual: {
          kind: 'poseTable',
          rows: COLORS.map(function (c) { return { color: c.id, pose: map[c.id] }; })
        },
        answer: { pose: map[color] },
        progress: { done: false }
      };
    },
    // action: { type:'pose', pose:'banzai' }（端末の中で見分けた結果だけを送る）
    judge: function (inst, action) {
      if (!action || action.type !== 'pose') return { ok: false };
      if (action.pose !== inst.answer.pose) return { ok: true, miss: true };
      inst.progress.done = true;
      return { ok: true, solved: true };
    }
  };

  // ================= ⑨ 分割暗号 =================
  // マニュアル役が2人以上いる時だけ出る。暗号を人数ぶんに切って配るので、
  // マニュアル役どうしが相談しないと組み立てられない。
  var CIPHER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 部屋コードと同じ、紛らわしくない字
  var cipherModule = {
    id: 'cipher', name: '分割暗号', icon: '🧩',
    physical: false, needsManualHolders: 2,
    lead: 'マニュアル役みんなの暗号をつなげて入力しよう',
    generate: function (rnd, ctx) {
      var holders = Math.max(2, (ctx && ctx.manualHolders) || 2);
      var len = holders * 2; // 1人2文字ずつ
      var code = '';
      for (var i = 0; i < len; i++) code += pick(CIPHER_ALPHABET.split(''), rnd);
      var parts = [];
      for (var h = 0; h < holders; h++) parts.push({ index: h, text: code.slice(h * 2, h * 2 + 2) });
      return {
        hint: { length: len, parts: holders },
        manual: { kind: 'cipherParts', parts: parts },
        answer: { code: code },
        progress: { done: false }
      };
    },
    // action: { type:'code', text:'AB12' }
    judge: function (inst, action) {
      if (!action || action.type !== 'code') return { ok: false };
      var got = String(action.text || '').toUpperCase().replace(/\s+/g, '');
      if (got !== inst.answer.code) return { ok: true, miss: true };
      inst.progress.done = true;
      return { ok: true, solved: true };
    }
  };

  // ================= ⑩ イエスノー解錠 =================
  // はい／いいえ／わからない だけで正解にたどり着く。
  // 答えるのはアプリなので、マニュアル役が1人もいなくても遊べる
  // （マニュアル表示端末が0台の時に体験を削らないための1本）。
  var YESNO_BANK = [
    {
      answer: '冷蔵庫',
      facts: { 'それは家の中にありますか？': 'yes', 'それは電気を使いますか？': 'yes', 'それは持ち運べますか？': 'no', 'それは食べ物ですか？': 'no', 'それは冷たいですか？': 'yes', 'それは音が鳴りますか？': 'unknown', 'それは外で使いますか？': 'no', 'それは1人で持てますか？': 'no' },
      choices: ['冷蔵庫', 'エアコン', '洗濯機', '電子レンジ']
    },
    {
      answer: '傘',
      facts: { 'それは家の中にありますか？': 'yes', 'それは電気を使いますか？': 'no', 'それは持ち運べますか？': 'yes', 'それは食べ物ですか？': 'no', 'それは冷たいですか？': 'no', 'それは音が鳴りますか？': 'no', 'それは外で使いますか？': 'yes', 'それは1人で持てますか？': 'yes' },
      choices: ['傘', '帽子', '靴', 'かばん']
    },
    {
      answer: 'ペンギン',
      facts: { 'それは家の中にありますか？': 'no', 'それは電気を使いますか？': 'no', 'それは持ち運べますか？': 'unknown', 'それは食べ物ですか？': 'no', 'それは冷たいですか？': 'yes', 'それは音が鳴りますか？': 'yes', 'それは外で使いますか？': 'unknown', 'それは1人で持てますか？': 'yes' },
      choices: ['ペンギン', 'シロクマ', 'ラクダ', 'イルカ']
    },
    {
      answer: '信号機',
      facts: { 'それは家の中にありますか？': 'no', 'それは電気を使いますか？': 'yes', 'それは持ち運べますか？': 'no', 'それは食べ物ですか？': 'no', 'それは冷たいですか？': 'no', 'それは音が鳴りますか？': 'yes', 'それは外で使いますか？': 'yes', 'それは1人で持てますか？': 'no' },
      choices: ['信号機', '自動販売機', 'ポスト', '街灯']
    }
  ];
  var YESNO_MAX_QUESTIONS = 5;
  var yesnoModule = {
    id: 'yesno', name: 'イエスノー解錠', icon: '🔐',
    physical: false, needsManualHolders: 0, noManualNeeded: true,
    lead: '質問を選んで、はい／いいえ から正体を当てよう',
    generate: function (rnd) {
      var item = pick(YESNO_BANK, rnd);
      var questions = shuffled(Object.keys(item.facts), rnd);
      return {
        hint: { questions: questions, maxQuestions: YESNO_MAX_QUESTIONS, choices: shuffled(item.choices, rnd) },
        // このモジュールだけは、対応表に出せるものが「答えそのもの」しかない。
        // マニュアル役に渡すと一言で終わってしまうので、対応表は持たせない
        manual: null,
        answer: { name: item.answer, facts: item.facts },
        progress: { asked: [], left: YESNO_MAX_QUESTIONS }
      };
    },
    // action: { type:'ask', question:'…' } / { type:'guess', name:'…' }
    judge: function (inst, action) {
      if (!action) return { ok: false };
      if (action.type === 'ask') {
        if (inst.progress.left <= 0) return { ok: true, note: 'noMoreQuestions' };
        var a = inst.answer.facts[action.question];
        if (!a) return { ok: false };
        if (inst.progress.asked.some(function (x) { return x.q === action.question; })) {
          return { ok: true, note: 'alreadyAsked' };
        }
        inst.progress.asked.push({ q: action.question, a: a });
        inst.progress.left--;
        return { ok: true };
      }
      if (action.type === 'guess') {
        if (action.name !== inst.answer.name) return { ok: true, miss: true };
        inst.progress.done = true;
        return { ok: true, solved: true };
      }
      return { ok: false };
    }
  };

  var MODULES = [faceModule, mazeModule, shakeModule, compassModule, levelModule,
    rhythmModule, poseModule, cipherModule, yesnoModule];
  function moduleById(id) { return MODULES.find(function (m) { return m.id === id; }) || null; }

  // ---- 設定 ----
  var MIN_MODULES = 4, MAX_MODULES = 8;
  var MIN_STRIKES = 1, MAX_STRIKES = 5;
  var MODE = { NORMAL: 'normal', FOCUS: 'focus' }; // 通常 / 集中解除

  function normalizeConfig(cfg) {
    var c = cfg || {};
    return {
      mode: (c.mode === MODE.FOCUS) ? MODE.FOCUS : MODE.NORMAL,
      moduleCount: clampInt(c.moduleCount, MIN_MODULES, MAX_MODULES, 5),
      // ミス上限は全体で共有。基本3回
      strikes: clampInt(c.strikes, MIN_STRIKES, MAX_STRIKES, 3),
      // マニュアルあり／なし（情報配置スイッチ）
      manual: c.manual !== false,
      timerSec: clampInt(c.timerSec, 0, 59 * 60 + 59, 300),
      // 体を動かすモジュール（振る・ポーズ）を入れるか。同意が取れた時だけ true
      allowPhysical: !!c.allowPhysical,
      allowCamera: !!c.allowCamera,
      preset: c.preset || null
    };
  }

  /**
   * その場で出せるモジュールの候補。
   *  ・マニュアル役が足りないモジュール（分割暗号）は外す
   *  ・体を動かす同意が無ければ、振る・ポーズは外す
   *  ・カメラが使えなければポーズは外す
   *  ・マニュアル表示端末が0台でも遊べるよう、対応表の要らない1本を必ず残す
   */
  /**
   * @param {object} caps 解除役の端末でできること
   *   { orientation:傾きが読める, compass:方位が読める, motion:振りが読める, camera:カメラが使える }
   *   省略した場合は「全部できる」とみなす（テストや、判定だけを見たい時のため）。
   */
  function availableModules(cfg, manualHolders, caps) {
    var holders = Math.max(0, manualHolders || 0);
    var can = caps || { orientation: true, compass: true, motion: true, camera: true };
    return MODULES.filter(function (m) {
      if (m.needsManualHolders > holders) return false;
      if (m.physical && !cfg.allowPhysical) return false;
      if (m.needsCamera && !cfg.allowCamera) return false;
      // その端末で読めないセンサーを使うモジュールは出さない。
      // 出してしまうと、解除役が一生解けない「詰み」のマスになる
      if ((m.needs || []).some(function (k) { return !can[k]; })) return false;
      // マニュアルありの設定なのに渡す人がいない時は、対応表の要らないものだけ
      if (cfg.manual && holders === 0 && !m.noManualNeeded) return false;
      return true;
    });
  }

  /**
   * 爆弾に載せるモジュールを選ぶ。
   * 同じ種類ばかりにならないよう、まず全種類から1つずつ取り、
   * 足りなければ2周目に入る（4個のうち3個が水平キープ、を防ぐ）。
   */
  function pickModules(cfg, manualHolders, rnd, caps) {
    var pool = availableModules(cfg, manualHolders, caps);
    if (!pool.length) return [];
    var out = [];
    var n = 0;
    while (out.length < cfg.moduleCount) {
      var round = shuffled(pool, rnd);
      for (var i = 0; i < round.length && out.length < cfg.moduleCount; i++) {
        var def = round[i];
        var inst = def.generate(rnd, { manualHolders: manualHolders });
        inst.uid = 'md' + (n++);
        inst.type = def.id;
        inst.solved = false;
        out.push(inst);
      }
    }
    return out;
  }

  /**
   * 解除役の画面に出してよいもの。
   * マニュアルなしの設定では、対応表もここに載せる（自力で解ける）。
   * answer は何があっても載せない。
   */
  function openView(inst, withManual) {
    var def = moduleById(inst.type);
    var out = {
      uid: inst.uid, type: inst.type, name: def.name, icon: def.icon, lead: def.lead,
      solved: !!inst.solved,
      hint: inst.hint,
      progress: inst.progress
    };
    // withManual=false（マニュアルなし）の時だけ、対応表を解除役にも渡す
    if (!withManual && inst.manual) out.manual = inst.manual;
    return out;
  }

  /**
   * マニュアル役の画面に出すもの。
   * 対応表だけで、いまの進み具合や答えは出さない
   * （手元で解けてしまうと、口で伝え合う遊びが成立しない）。
   */
  function manualView(inst) {
    var def = moduleById(inst.type);
    if (!inst.manual) return null;
    return {
      uid: inst.uid, type: inst.type, name: def.name, icon: def.icon,
      manual: inst.manual, solved: !!inst.solved
    };
  }

  /**
   * 対応表をマニュアル役で分け合う。
   * 1人に全部渡すと、大人数の時に他の人がやることを失う（KTANEの「1人何もしない問題」）。
   * @returns {object} memberId -> そのひとが持つモジュールのuidの配列
   */
  function splitManual(moduleUids, holderIds) {
    var out = {};
    (holderIds || []).forEach(function (id) { out[id] = []; });
    if (!holderIds || !holderIds.length) return out;
    moduleUids.forEach(function (uid, i) {
      out[holderIds[i % holderIds.length]].push(uid);
    });
    return out;
  }

  // 公開してよい進み具合（大画面と全員向け）。中身は一切入れない
  function publicProgress(instances, strikesLeft, strikesMax) {
    return {
      total: instances.length,
      solved: instances.filter(function (m) { return m.solved; }).length,
      modules: instances.map(function (m) {
        var def = moduleById(m.type);
        return { uid: m.uid, name: def.name, icon: def.icon, solved: !!m.solved };
      }),
      strikesLeft: strikesLeft,
      strikesMax: strikesMax
    };
  }

  // 体を動かすモジュールが候補に入るか（同意画面を出すかの判断に使う）
  function hasPhysical(cfg, manualHolders, caps) {
    return availableModules(cfg, manualHolders, caps).some(function (m) { return m.physical; });
  }

  /**
   * 解除役みんなの端末を合わせて、どのセンサーが使えるかを出す。
   * 誰か1人の端末で読めれば、そのモジュールは出してよい
   * （その人に爆弾を持ってもらえばいいだけなので）。
   */
  function mergeCaps(list) {
    var out = { orientation: false, compass: false, motion: false, camera: false };
    (list || []).forEach(function (c) {
      if (!c) return;
      Object.keys(out).forEach(function (k) { if (c[k]) out[k] = true; });
    });
    return out;
  }

  return {
    MODULES: MODULES, moduleById: moduleById,
    COLORS: COLORS, MARKS: MARKS, DIRS: DIRS, FACES: FACES, POSES: POSES,
    colorById: colorById, dirById: dirById, poseById: poseById, degDiff: degDiff,
    MODE: MODE, MIN_MODULES: MIN_MODULES, MAX_MODULES: MAX_MODULES,
    MIN_STRIKES: MIN_STRIKES, MAX_STRIKES: MAX_STRIKES,
    MAZE_SIZE: MAZE_SIZE, RHYTHM_BEATS: RHYTHM_BEATS,
    COMPASS_TOLERANCE_DEG: COMPASS_TOLERANCE_DEG, COMPASS_HOLD_MS: COMPASS_HOLD_MS,
    YESNO_MAX_QUESTIONS: YESNO_MAX_QUESTIONS,
    normalizeConfig: normalizeConfig, availableModules: availableModules,
    pickModules: pickModules, openView: openView, manualView: manualView,
    splitManual: splitManual, publicProgress: publicProgress, hasPhysical: hasPhysical,
    mergeCaps: mergeCaps, shuffled: shuffled
  };
}));
