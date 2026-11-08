// tvs-auto.js — TV の切りかえ（指示69 二の束）の「自動」の決まり。時計と状態を受けて「どの TV に何を出すか」だけ返す（node の検査から時計を進めて見る）
//
//   ・自動で回す：TV ごとに入／切。回す物と秒数（動画は秒が無ければ「1回分」＝拡張機能が教える長さ・分からなければ30秒）
//   ・あそびまちの呼び出し：TV② をあそびまちに30秒。そのあと、自動が入なら回すのにもどる・切なら元の画面へ
//   ・あつまれに人が入った（呼び込み idle → 待合 lobby）：TV① をあつまれへ
//   ・**あつまれのゲーム中（play）にあつまれを映している TV は、自動では決して切りかえない**
//   ・あつまれを映している TV は、人がいる間（idle 以外）も回さない・呼び出しでも動かさない（指示75 3-6）（決めごと：呼び込みから人が来てあつまれへもどしたのに、
//     次の秒で回して離れてしまうのを防ぐ。指示書に無い所・2026-11-02 Claude Code が決めた）
// 係が出す物のボタンを押したら、その TV の自動は切（tvs-routes.js）。ここは押したことを reset で知るだけ

'use strict';

const VIDEO_FALLBACK_SEC = 30;
const CHIME_SEC = 30;
const DEFAULT_ROT = { 1: [], 2: [{ item: 'menu', sec: 20 }, { item: 'asobi', sec: 20 }, { item: 'video', sec: null }] };
const DEFAULT_SETTINGS = { auto: { 1: false, 2: true }, rot: DEFAULT_ROT, chime: true, fesBack: true, rest: '準備中です', notice: { 1: '', 2: '' } };

function createAuto() {
  const pos = { 1: null, 2: null };    // 回している所 { i, until }
  const hold = { 1: null, 2: null };   // 呼び出しで出している間 { until, back }
  let lastPhase;

  const find = (ctx, id) => (ctx.items || []).find((x) => x.id === id);
  const usable = (ctx, tv, id) => { const x = find(ctx, id); return !!(x && x.tvs.indexOf(tv) !== -1 && x.have !== false); };
  const locked = (ctx, tv) => ctx.screens[tv].item === 'fes' && ctx.phase === 'play';
  const peopleOnFes = (ctx, tv) => ctx.screens[tv].item === 'fes' && !!ctx.phase && ctx.phase !== 'idle';
  const lenOf = (ctx, e) => (e.sec ? e.sec * 1000 : ((ctx.durations && ctx.durations[e.item]) || VIDEO_FALLBACK_SEC) * 1000);
  const listOf = (ctx, tv) => ((ctx.settings.rot && ctx.settings.rot[tv]) || []).filter((e) => usable(ctx, tv, e.item));

  /** 1秒ごとに呼ぶ。返すのは [{ tv, item, why }]（why：auto＝回す／chime-end＝呼び出しのあと元へ／fes＝人が入った） */
  function tick(ctx) {
    const out = [];
    const S = ctx.settings, now = ctx.now;
    if (S.fesBack && lastPhase === 'idle' && ctx.phase === 'lobby' && ctx.screens[1].item !== 'fes' && usable(ctx, 1, 'fes') && !locked(ctx, 1)) {
      out.push({ tv: 1, item: 'fes', why: 'fes' });
      hold[1] = null; pos[1] = null;
    }
    lastPhase = ctx.phase;
    for (const tv of [1, 2]) {
      if (out.some((a) => a.tv === tv)) continue;
      const h = hold[tv];
      if (h) {
        if (now < h.until) continue;
        hold[tv] = null;
        if (!S.auto[tv]) {
          // 元の画面へ。元の物がもう出せない（消した・ファイルが無い）時は休けいへ（あそびまちのままにしない）
          const back = h.back && usable(ctx, tv, h.back) ? h.back : (h.back ? 'rest' : null);
          if (back && back !== ctx.screens[tv].item && usable(ctx, tv, back) && !locked(ctx, tv)) out.push({ tv, item: back, why: 'chime-end' });
          continue;
        }
        // 自動が入：回すのにもどる。呼ばれる前に出していた物から（その物の時計は頭から）。
        // あそびまちを出している時に呼ばれた（元が無い）時は、あそびまちの次の物から
        // （pos を空にするだけだと、今のあそびまちから時計を始めて、さらに20秒あそびまちのままになっていた・tests/tvs-auto.js で赤を見た）
        const list = S.auto[tv] ? listOf(ctx, tv) : [];
        if (S.auto[tv] && list.length && !locked(ctx, tv)) {
          let i = list.findIndex((e) => e.item === h.back);
          if (i === -1) i = (list.findIndex((e) => e.item === 'asobi') + 1) % list.length;
          pos[tv] = { i, until: now + lenOf(ctx, list[i]) };
          if (list[i].item !== ctx.screens[tv].item) out.push({ tv, item: list[i].item, why: 'auto' });
          continue;
        }
        pos[tv] = null;
      }
      if (!S.auto[tv]) { pos[tv] = null; continue; }
      if (locked(ctx, tv) || peopleOnFes(ctx, tv)) { pos[tv] = null; continue; }
      const list = listOf(ctx, tv);
      if (!list.length) { pos[tv] = null; continue; }
      const p = pos[tv];
      if (!p) {
        // 回し始め：今の画面が回す物の中にあれば、そこから時計を始める。無ければ1つ目へ
        const i = list.findIndex((e) => e.item === ctx.screens[tv].item);
        if (i !== -1) { pos[tv] = { i, until: now + lenOf(ctx, list[i]) }; continue; }
        pos[tv] = { i: 0, until: now + lenOf(ctx, list[0]) };
        out.push({ tv, item: list[0].item, why: 'auto' });
        continue;
      }
      if (now < p.until) continue;
      const i = (p.i + 1) % list.length;
      pos[tv] = { i, until: now + lenOf(ctx, list[i]) };
      if (list[i].item !== ctx.screens[tv].item) out.push({ tv, item: list[i].item, why: 'auto' });
    }
    return out;
  }

  /** あそびまちの呼び出しが鳴った。TV② をあそびまちに30秒 */
  function chime(ctx) {
    const tv = 2;
    // 指示75 3-6（A24(b)）：あつまれを映していて人がいる間（呼び込み以外）は、回すのと同じく呼び出しでも動かさない
    if (!ctx.settings.chime || !usable(ctx, tv, 'asobi') || locked(ctx, tv) || peopleOnFes(ctx, tv)) return [];
    const back = hold[tv] ? hold[tv].back : ctx.screens[tv].item;
    hold[tv] = { until: ctx.now + CHIME_SEC * 1000, back: back === 'asobi' ? null : back };
    return ctx.screens[tv].item === 'asobi' ? [] : [{ tv, item: 'asobi', why: 'chime' }];
  }

  /** 係が手で切りかえた・自動を入れなおした：その TV の回している所と呼び出しの間を忘れる */
  function reset(tv) { pos[tv] = null; hold[tv] = null; }

  return { tick, chime, reset, _state: () => ({ pos, hold }) };
}

module.exports = { createAuto, DEFAULT_SETTINGS, CHIME_SEC, VIDEO_FALLBACK_SEC };
