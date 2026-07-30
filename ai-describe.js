// ai-describe.js — AIに「お題の説明文」を作らせる共通層（第27弾）
//
// なぜ切り出したか:
//   これまで Gemini を呼ぶのは /api/ai-describe（端末から頼まれた時）だけだった。
//   第27弾で、爆弾解除の競争版が「試合が始まる前にサーバーだけで全部生成しておく」
//   必要になった。プロンプトを2箇所に書くと、片方だけ直して古いまま残る
//   （原則9：借りたものは、その世界観ごと運ばれる）。ここ1箇所だけにする。
//
// このファイルはExpressもsocket.ioも知らない。呼ばれたら文字列を返すだけ。

// #3（第5弾から引き継ぎ）：無料枠のレート制限が緩いモデルを使う
const MODEL = 'gemini-flash-lite-latest';
const RATE_LIMIT_WAIT_MS = 3000;

/**
 * お題からプロンプトを組む。ここが説明文の品質を決めるので、
 * 変える時は「一言ヒント」と「2〜3文の説明」の両方を必ず見直すこと。
 */
function buildPrompt({ name, ng_words, hint, avoid }) {
  const avoidList = (ng_words || []).join('、') || 'なし';
  if (hint) {
    // 一言ヒントモード（③）：単語ひとつだけ返す。avoid には既出のヒントを渡す
    const already = (avoid || []).join('、');
    return 'あなたは日本語のパーティーゲーム「あれそれどれこれ」のヒント役です。プレイヤーはヒントの単語だけを聞いてお題を当てます。\n'
      + `お題:「${name}」\n禁止ワード: ${avoidList}\n`
      + (already ? `すでに出したヒント: ${already}\n` : '')
      + '\nお題を連想できる「単語ひとつだけ」を日本語で出力してください。お題の名前そのもの・禁止ワード・すでに出したヒントは絶対に使わないこと。文ではなく単語のみ、説明・記号・句読点・番号は一切付けず、単語だけを返してください。';
  }
  return 'あなたは日本語のパーティーゲーム「あれそれどれこれ」の出題者です。プレイヤーは言葉の説明だけを聞いて、お題が何かを当てます。\n'
    + `お題:「${name}」\n禁止ワード: ${avoidList}\n\n`
    + 'お題の名前そのものと禁止ワードは絶対に使わず、日本語で2〜3文の簡潔な説明をしてください。説明文以外（前置きや補足）は一切出力しないでください。';
}

// 呼び出し側が理由で分岐できるように、エラーには種類を付ける
class DescribeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'no_key' | 'bad_request' | 'api_error' | 'empty' | 'network'
  }
}

/**
 * Gemini に説明文を作らせる。
 * @param {object} input { name, ng_words, hint, avoid }
 * @param {object} deps  テストから差し替えるための入り口（fetch・APIキー・待ち時間）
 * @returns {Promise<{description:string}>}
 */
async function describe(input, deps) {
  const d = deps || {};
  const doFetch = d.fetch || fetch;
  const apiKey = (d.apiKey !== undefined) ? d.apiKey : process.env.GEMINI_API_KEY;
  const waitMs = (d.rateLimitWaitMs !== undefined) ? d.rateLimitWaitMs : RATE_LIMIT_WAIT_MS;
  const name = String((input && input.name) || '').trim();

  if (!name) throw new DescribeError('bad_request', 'name is required');
  if (!apiKey) {
    throw new DescribeError('no_key',
      'サーバーにGEMINI_API_KEYが設定されていません（.envに追加してpm2 restartしてください）');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildPrompt(Object.assign({}, input, { name })) }] }]
  });
  const call = () => doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });

  let resp;
  try {
    resp = await call();
    if (resp.status === 429) {
      // #3：レート制限（429）は数秒待って1回だけ自動リトライ
      await new Promise((r) => setTimeout(r, waitMs));
      resp = await call();
    }
  } catch (e) {
    throw new DescribeError('network', 'AI呼び出し中にエラーが発生しました');
  }

  if (!resp.ok) {
    let errBody = '';
    try { errBody = await resp.text(); } catch (e) { /* 本文が読めなくても状態は伝える */ }
    const err = new DescribeError('api_error', 'AI呼び出しに失敗しました（APIキーを確認してください）');
    err.status = resp.status;
    err.body = errBody;
    throw err;
  }

  let data;
  try { data = await resp.json(); }
  catch (e) { throw new DescribeError('empty', 'AIからの応答が空でした'); }
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts && cand.content.parts[0]
    && cand.content.parts[0].text ? cand.content.parts[0].text.trim() : null;
  if (!text) throw new DescribeError('empty', 'AIからの応答が空でした');
  return { description: text };
}

// AIが使えるかどうか（部屋の待合で「始められない理由」を出すために使う）
function available(deps) {
  const d = deps || {};
  return !!((d.apiKey !== undefined) ? d.apiKey : process.env.GEMINI_API_KEY);
}

module.exports = { describe, available, buildPrompt, DescribeError, MODEL };
