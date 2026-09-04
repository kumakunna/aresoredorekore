// ui.js — 全画面が共有するUI部品（第39弾）
//
// ここに入れるのは「どの画面でも同じ意味を持つ道具」だけ。
// ゲームの見せ場（褒める・開示・爆発）は fx.js の担当で、
// **道具は世界の外にある**——テーマを当てず、共通トークンで描く
// （docs/デザインの正本.md 1-3）。
//
// すべての部品に共通する約束：
//   ・テーマ非適用（`.ui-layer` の中は共通トークンで描く）
//   ・文字サイズ設定に追従する（--fs-* を使う）
//   ・出現・消失は FxKit.hold() を通る＝スキップ三層に乗る
//   ・振動は4つの型からしか鳴らさない
//   ・閉じてよいものは、外側タップ・ESC・戻るで閉じられる
//
// **ブラウザ標準の confirm / alert / prompt は使わない。**
// あれは見た目がテーマに従わず、文言も変えられず、
// 「取り返しがつかない操作」と「ただの知らせ」を同じ顔で出してしまう。

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UiKit = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var cfg = {
    doc: null,
    root: null,
    fx: null,          // FxKit（hold と vibe を借りる）
    text: {}           // 共通の言い回し（ui-text.js）
  };

  function doc() { return cfg.doc || (typeof document !== 'undefined' ? document : null); }
  function host() {
    var d = doc();
    if (!d) return null;
    return cfg.root || d.getElementById('app') || d.body;
  }
  function hold(ms) {
    if (cfg.fx && cfg.fx.hold) return cfg.fx.hold(ms);
    return Promise.resolve(true);
  }
  function vibe(name) {
    if (cfg.fx && cfg.fx.vibe) { try { cfg.fx.vibe(name); } catch (e) {} }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function word(key, fallback) {
    return (cfg.text && cfg.text[key]) || fallback;
  }

  function init(opt) {
    opt = opt || {};
    if (opt.doc) cfg.doc = opt.doc;
    if (opt.root) cfg.root = opt.root;
    if (opt.fx) cfg.fx = opt.fx;
    if (opt.text) cfg.text = opt.text;
    bindKeys();
    return api;
  }

  // ---------- 重なりの管理 ----------
  // 開いている重なりを積んでおく。**いちばん上のものだけが閉じる対象**。
  // 「戻る」を押した時に、後ろの画面を動かす前にここを見る
  var stack = [];

  function top() { return stack.length ? stack[stack.length - 1] : null; }

  /**
   * いちばん上の重なりを閉じる。閉じられたら true。
   * 画面の「戻る」は、まずこれを呼ぶ——
   * 第39弾の着手前は、設定を開いたまま戻るを押すと
   * **設定は開いたまま、後ろの画面だけが動いていた**。
   */
  function closeTop(why) {
    var t = top();
    if (!t) return false;
    if (why === 'outside' && t.lockOutside) return true;  // 押されたが、閉じない
    if (why === 'esc' && t.lockOutside) return true;
    t.close(null);
    return true;
  }
  function anyOpen() { return stack.length > 0; }

  var keysBound = false;
  function bindKeys() {
    var d = doc();
    if (!d || keysBound) return;
    keysBound = true;
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && anyOpen()) { e.preventDefault(); closeTop('esc'); }
    });
  }

  // ---------- 下に敷く暗幕 ----------
  // dialog / sheet / popup が共有する。**二重に暗くならない**ように数を数える
  var dimNode = null;
  var dimCount = 0;
  function dimOn() {
    var h = host(), d = doc();
    if (!h || !d) return;
    dimCount++;
    if (dimNode) return;
    dimNode = d.createElement('div');
    dimNode.className = 'ui-dim';
    h.appendChild(dimNode);
    // 次のフレームで濃くする（いきなり出さない）
    void dimNode.offsetWidth;
    dimNode.classList.add('is-on');
  }
  function dimOff() {
    dimCount = Math.max(0, dimCount - 1);
    if (dimCount > 0 || !dimNode) return;
    var n = dimNode;
    dimNode = null;
    n.classList.remove('is-on');
    hold(250).then(function () { if (n.parentNode) n.parentNode.removeChild(n); });
  }

  // ---------- 土台：重なりを1つ開く ----------
  /**
   * @param opt.kind      'dialog' | 'sheet' | 'popup'
   * @param opt.html      中身
   * @param opt.lockOutside 外側タップ・ESCで閉じない（danger だけ true）
   * @param opt.onOpen    描いた直後（ボタンを結ぶ）
   * @returns Promise     閉じた時の値
   */
  function openLayer(opt) {
    var h = host(), d = doc();
    if (!h || !d) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var layer = d.createElement('div');
      // **テーマを当てない**（ui-layer の中は共通トークン）
      layer.className = 'ui-layer ui-' + opt.kind;
      layer.innerHTML = '<div class="ui-panel" role="dialog" aria-modal="true">' + opt.html + '</div>';
      var panel = layer.querySelector('.ui-panel');

      var entry = { close: close, lockOutside: !!opt.lockOutside, node: layer };
      var done = false;

      function close(value) {
        if (done) return;
        done = true;
        var i = stack.indexOf(entry);
        if (i >= 0) stack.splice(i, 1);
        layer.classList.remove('is-on');
        dimOff();
        hold(250).then(function () {
          if (layer.parentNode) layer.parentNode.removeChild(layer);
          resolve(value);
        });
      }
      entry.close = close;

      // 外側を押したら閉じる（danger だけ閉じない）
      layer.addEventListener('click', function (e) {
        if (e.target !== layer) return;
        if (opt.lockOutside) return;
        close(null);
      });

      dimOn();
      h.appendChild(layer);
      stack.push(entry);
      void layer.offsetWidth;
      layer.classList.add('is-on');
      if (opt.onOpen) opt.onOpen(panel, close);
      // 最初に触れるものへ焦点を移す（キーボードでも扱えるように）
      var first = panel.querySelector('button, input');
      if (first && first.focus) { try { first.focus(); } catch (e) {} }
    });
  }

  // ---------- dialog（人の判断が要る時） ----------
  var DIALOG_KINDS = ['confirm', 'danger', 'info', 'ask'];

  /**
   * @param o.kind  'confirm' | 'danger' | 'info' | 'ask'
   * @param o.title 見出し（1行）
   * @param o.body  本文（2〜3行）
   * @param o.ok    主ボタンの文言
   * @param o.cancel 逃げ道の文言（info では出さない）
   * @param o.value  ask の初期値
   * @returns confirm/danger → true|null ／ info → true ／ ask → 文字列|null
   */
  function dialog(o) {
    o = o || {};
    var kind = DIALOG_KINDS.indexOf(o.kind) >= 0 ? o.kind : 'confirm';
    var danger = (kind === 'danger');
    var ask = (kind === 'ask');
    var one = (kind === 'info');

    var okWord = o.ok || (one ? word('ok', 'OK') : word('yes', 'はい'));
    var cancelWord = o.cancel || word('cancel', 'キャンセル');

    var html =
      '<div class="ui-head">' + esc(o.title || '') + '</div>' +
      (o.body ? '<div class="ui-body">' + esc(o.body).replace(/\n/g, '<br>') + '</div>' : '') +
      (ask ? '<input class="ui-input" id="uiAskInput" type="' + (o.numeric ? 'number' : 'text') +
             '" value="' + esc(o.value == null ? '' : o.value) + '"' +
             (o.min != null ? ' min="' + o.min + '"' : '') +
             (o.max != null ? ' max="' + o.max + '"' : '') + '>' : '') +
      '<div class="ui-acts">' +
        '<button class="ui-btn ui-btn-main" data-ui="ok">' + esc(okWord) + '</button>' +
        (one ? '' : '<button class="ui-btn ui-btn-quiet" data-ui="cancel">' + esc(cancelWord) + '</button>') +
      '</div>';

    // 取り返しがつかないものだけ、注意の振動を鳴らす
    if (danger) vibe('warn');

    return openLayer({
      kind: 'dialog',
      html: '<div class="ui-dialog-in' + (danger ? ' is-danger' : '') + '">' + html + '</div>',
      // **danger は外側タップで閉じない。**誤操作で消えると、
      // 「押していないのに閉じた」のか「取りやめた」のかが本人にも分からない
      lockOutside: danger,
      onOpen: function (panel, close) {
        var input = panel.querySelector('#uiAskInput');
        panel.addEventListener('click', function (e) {
          var b = e.target.closest('[data-ui]');
          if (!b) return;
          if (b.dataset.ui === 'ok') {
            vibe(danger ? 'warn' : 'ok');
            close(ask ? (input ? input.value : '') : true);
          } else {
            vibe('tick');
            close(null);
          }
        });
        if (input) {
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { vibe('ok'); close(input.value); }
          });
        }
      }
    });
  }

  // 使いやすい入口
  function confirmDialog(title, body, opt) {
    return dialog(Object.assign({ kind: 'confirm', title: title, body: body }, opt || {}));
  }
  function dangerDialog(title, body, opt) {
    return dialog(Object.assign({ kind: 'danger', title: title, body: body }, opt || {}));
  }
  function infoDialog(title, body, opt) {
    return dialog(Object.assign({ kind: 'info', title: title, body: body }, opt || {}));
  }
  function askDialog(title, opt) {
    return dialog(Object.assign({ kind: 'ask', title: title }, opt || {}));
  }

  // ---------- sheet（下からせり上がる詳細） ----------
  function sheet(o) {
    o = o || {};
    return openLayer({
      kind: 'sheet',
      html:
        '<div class="ui-sheet-in">' +
          '<div class="ui-head">' + esc(o.title || '') + '</div>' +
          '<div class="ui-scroll">' + (o.html || esc(o.body || '')) + '</div>' +
          (o.ok ? '<div class="ui-acts"><button class="ui-btn ui-btn-main" data-ui="ok">' +
                  esc(o.ok) + '</button></div>' : '') +
        '</div>',
      onOpen: function (panel, close) {
        panel.addEventListener('click', function (e) {
          if (e.target.closest('[data-ui="ok"]')) { vibe('ok'); close(true); }
        });
      }
    });
  }

  // ---------- popup（長押し・i で出る説明） ----------
  // **アイコンと名前は固定、本文だけスクロールする。**
  // 長い説明でも、何の説明を読んでいるかが上に残り続ける
  function popup(o) {
    o = o || {};
    return openLayer({
      kind: 'popup',
      html:
        '<div class="ui-popup-in">' +
          '<div class="ui-popup-head">' +
            (o.icon ? '<span class="ui-popup-icon">' + o.icon + '</span>' : '') +
            '<span class="ui-popup-name">' + esc(o.title || '') + '</span>' +
            '<button class="ui-x" data-ui="close" aria-label="' + esc(word('close', 'とじる')) + '">✕</button>' +
          '</div>' +
          '<div class="ui-scroll">' + (o.html || esc(o.body || '')).replace(/\n/g, '<br>') + '</div>' +
        '</div>',
      onOpen: function (panel, close) {
        panel.addEventListener('click', function (e) {
          if (e.target.closest('[data-ui="close"]')) { vibe('tick'); close(null); }
        });
      }
    });
  }

  // ---------- toast（判断の要らない知らせ） ----------
  // **重い知らせを toast にしない。**「爆発しました」のようなものは
  // 読み落とすと取り返しがつかないので dialog の info を使う
  var toastBox = null;
  function toast(text, opt) {
    var h = host(), d = doc();
    if (!h || !d) return Promise.resolve(false);
    opt = opt || {};
    if (!toastBox || !toastBox.parentNode) {
      toastBox = d.createElement('div');
      toastBox.className = 'ui-toasts';
      h.appendChild(toastBox);
    }
    var n = d.createElement('div');
    n.className = 'ui-toast';
    n.setAttribute('role', 'status');
    n.textContent = String(text == null ? '' : text);
    toastBox.appendChild(n);
    void n.offsetWidth;
    n.classList.add('is-on');
    vibe('tick');
    return hold(opt.ms || 2200).then(function () {
      n.classList.remove('is-on');
      return hold(250).then(function () {
        if (n.parentNode) n.parentNode.removeChild(n);
        return true;
      });
    });
  }

  // ---------- chip（人数などの小さな状態） ----------
  // 押せる。押すと sheet か popup を出す
  function chipHtml(o) {
    o = o || {};
    return '<button class="ui-chip" type="button"' +
      (o.id ? ' id="' + esc(o.id) + '"' : '') +
      (o.act ? ' data-uichip="' + esc(o.act) + '"' : '') + '>' +
      (o.icon ? '<span class="ui-chip-i">' + o.icon + '</span>' : '') +
      '<span class="ui-chip-t">' + esc(o.text || '') + '</span>' +
      '</button>';
  }

  var api = {
    init: init,
    dialog: dialog,
    confirm: confirmDialog,
    danger: dangerDialog,
    info: infoDialog,
    ask: askDialog,
    sheet: sheet,
    popup: popup,
    toast: toast,
    chipHtml: chipHtml,
    closeTop: closeTop,
    anyOpen: anyOpen,
    KINDS: DIALOG_KINDS,
    /**
     * **カタログに並べるべき部品の名前。**
     * 部品を足したら、ここにも足す——
     * そうしないと tests/ui-kit.js が「カタログに出ていない」と赤くする。
     * 「作ったが、誰も見ていない部品」を作らないための一覧（落とし穴20）
     */
    SHOWCASE: ['confirm', 'danger', 'info', 'ask', 'sheet', 'popup', 'toast', 'chip'],
    _stack: stack
  };
  return api;
}));
