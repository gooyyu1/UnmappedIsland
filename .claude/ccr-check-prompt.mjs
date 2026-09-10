// `create_session` で送った指示が、欠けずに届いたかを確かめる。
//
//   import { checkPrompt } from './ccr-check-prompt.mjs';
//   await checkPrompt(session, sentPath)   // → 一致したか
//
// **シェルからの入口は隣の [`ccr-check-prompt.sh`](./ccr-check-prompt.sh)。** 呼び方と出る行はそちら。
// **投入する側はここを関数として呼ぶ**（[`dispatch-session.mjs`](../scripts/agent/dispatch-session.mjs)）
// ——入口を通すと node がもう1つ起きる（[`ccr-meta.mjs`](./ccr-meta.mjs)「node から呼ぶ側は」）。
//
// 見るのは `inbound_origin` が `mcp_create_session` の user イベント1つだけ。**`send_message` で
// 送った本文は対象外**——あちらは `<` `>` が実体参照になるので、同じ比較では常に不一致になる。
//
// ## 手で書くと必ず踏む4つ
//
// これを書くまでは、セッションを立てるたびに毎回この4つを踏み直していた。
//
// - 本文の在り処は `user.internal_anthropic_catchall.message.content`。`role` も `user.content` も
//   無いので、素直に書くと空振りする。
// - `list_events` が返すのは**新しい側から**。種の指示は最も古い1件なので、最初のページには
//   居ないことがある。`before_id` に前のページの `first_id` を渡して遡る。
// - **`create_session` の直後は、遡り切っても種の指示がまだ載っていない**（記録に出るまで数十秒
//   掛かる。2026-08-28 に実測——立てた直後は「見つからない」、1時間後の同じセッションは「一致」）。
//   無いことを不一致として報せると、欠けていないものを欠けたと読む。**載るまで待ってから判定する。**
// - **載りかけの本文は、長さの違う別物として読める**（2026-08-28 に実測——立てた直後は 1838 字で
//   不一致、数分後の同じセッションは 1836 字で一致）。無いときと同じ理由なので、**長さが違っても
//   即断せず、待ち切ってから不一致と言う。**

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { callMeta, metaJson } from './ccr-meta.mjs';

/** 種の指示が記録に出るまで待つ秒数。 */
const WAIT_SECONDS = Number(process.env.CCR_CHECK_WAIT_SECONDS || 180);

/** 1周で遡るページ数の上限。 */
const MAX_PAGES = 30;

/** 待ち直す間隔。 */
const RETRY_MS = 10_000;

/**
 * 遡って種の指示の本文を探す。**まだ載っていないなら `undefined`**——「無い」と「届いた本文が違う」を
 * 混ぜない（上の「載るまで待ってから判定する」）。
 */
async function findSeed(session, call) {
  let before = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const request = { session_id: session, limit: 100, ...(before === '' ? {} : { before_id: before }) };
    const events = metaJson(await call('list_events', request))?.ccr;
    if (events === undefined) throw new Error('応答に JSON の行が無い');

    const seed = (events.data ?? []).find((event) => {
      const inbound = event.user?.internal_anthropic_catchall;
      return inbound?.inbound_origin === 'mcp_create_session' && typeof inbound.message?.content === 'string';
    });
    if (seed !== undefined) return seed.user.internal_anthropic_catchall.message.content.trim();

    // 同じ `first_id` が返ったら、それ以上は遡れない＝まだ載っていない。
    if (events.has_more !== true || !events.first_id || events.first_id === before) return undefined;
    before = events.first_id;
  }
  return undefined;
}

/**
 * 送った指示（`sentPath`）が `session` へ欠けずに届いたかを確かめる。**一致したら `true`。**
 *
 * 差し替え口は試験のため（`tests/scripts/ccrCheckPrompt.test.ts`）。省いたものは本物が入る。
 */
export async function checkPrompt(
  session,
  sentPath,
  { call = callMeta, wait = WAIT_SECONDS, pause = sleep } = {},
) {
  const sent = readFileSync(sentPath, 'utf8').trim();
  const deadline = Date.now() + wait * 1000;

  // 最後に見た「長さの違う本文」。待ち切ってから、これがあれば不一致として出す。
  let lastDiff;

  for (;;) {
    const got = await findSeed(session, call);
    if (got === sent) {
      console.log('一致');
      return true;
    }
    if (got !== undefined) lastDiff = got;

    if (Date.now() >= deadline) {
      if (lastDiff === undefined) {
        console.error(
          `${wait}秒待っても種の指示が記録に出ない（create_session で立てたセッションか確かめる）`,
        );
      } else {
        console.error('--- 届いた先頭300字 ---');
        console.error(lastDiff.slice(0, 300));
        console.log(`不一致（送った ${sent.length} 字 / 届いた ${lastDiff.length} 字）`);
      }
      return false;
    }
    await pause(RETRY_MS);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [session, sent] = process.argv.slice(2);
  try {
    process.exit((await checkPrompt(session, sent)) ? 0 : 1);
  } catch (error) {
    // **読めない・読み取れないは、不一致ではない。** 判定として数えられないように別の終了コードで返す。
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }
}
