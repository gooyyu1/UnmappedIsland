// 使用量の増分を、そのとき動いていたセッションへ割り当てる（`.claude/board-design.md` 2.5）。
//
//   echo '{"utilization":12,"now":"...","live":[{"id":"cse_a","tags":["task-1"],"working":true}]}' \
//     | node scripts/agent/usage-attribute.mjs <状態のファイル> <記録のファイル>
//
// 状態のファイルを読み書きし、**畳まれたセッションぶんだけ**を記録のファイルへ1行1件で足す。
// 足した行は標準出力にも出す（呼び手が見えるように）。行は
// `<時刻>\t<種類>\t<消費>\t<セッションID>` のTSV。
//
// ## セッション単位の消費は引けないので、割り当てる
//
// APIが返すのは全体の `utilization` だけ（2.8）。**前回からの増分を、そのとき動いていたセッション
// で等分する。**
//
// **分母は「動いていたもの」だけ。** 畳まれていないセッションには、手が空いて次の指示を待っている
// ものが混ざる（1.2）。待っている本数で割ると、待っているほど消費したことになる。
//
// **ユーザー自身の対話も分母に入る**（2.5.3）。ブリッジの Claude Code もCCRのセッションなので
// 一覧に載り、動いていれば `working` が立つ——**別枠で1を足すと二重に数える**。
//
// **1本も動いていない周の増分は、誰にも割り当てない。** 一覧に載らない手元の Claude Code が
// 食ったぶんなので、投入したセッションのせいにすると過大に出る。
//
// ## 下がった周は、増分を0にする
//
// **引き算をそのまま使うと負の消費が積まれる**ので、`utilization` が前の周より下がった周は基準を
// 置き直すだけにする。取りこぼすのはその1周分。
//
// **枠が変わったことは、この下がりで見る。`resets_at` は使わない。** APIの返す `resets_at` は同じ枠
// でも呼び出しごとに揺れ（実測: 2026-09-05。`07:19:59.015` 〜 `07:20:00.994`）、**揺れの中心が
// きりのよい境界に乗るのでどの粒度で丸めても境界をまたぐ。** 見比べると一致する周が来ず、増分が
// 永久に0になる。枠が明けた直後は必ず低い値から始まるので、下がりで足りる——取り違えるのは前の枠を
// 数%しか使わずに終えたときだけで、狂うのはその数%。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** タグから投入の種類を決める（2.3）。タグの無いセッションはユーザー自身の対話。 */
function kindOf(tags) {
  for (const tag of tags) {
    if (tag.startsWith('task-')) return 'new-task';
    if (tag.startsWith('review-')) return 'review';
  }
  return tags.length > 0 ? 'other' : 'untagged';
}

function readState(path) {
  if (!existsSync(path)) return { utilization: null, sessions: {} };
  return JSON.parse(readFileSync(path, 'utf8'));
}

const [statePath, spentPath] = process.argv.slice(2);
if (statePath === undefined || spentPath === undefined) {
  process.stderr.write('状態のファイルと記録のファイルのパスを渡す\n');
  process.exit(1);
}

const input = JSON.parse(readFileSync(0, 'utf8'));
const previous = readState(statePath);

const rose = typeof previous.utilization === 'number' && input.utilization >= previous.utilization;
const delta = rose ? input.utilization - previous.utilization : 0;

// 上の「分母は『動いていたもの』だけ」。1本も動いていなければ、この周の増分は誰にも積まない。
const working = input.live.filter((session) => session.working);
const share = working.length > 0 ? delta / working.length : 0;

const sessions = {};
for (const session of input.live) {
  const carried = previous.sessions?.[session.id]?.spent ?? 0;
  sessions[session.id] = {
    kind: kindOf(session.tags),
    spent: carried + (session.working ? share : 0),
  };
}

// 生きている一覧から消えたセッション＝畳まれた。積み上がった値がそのセッションの消費。
const finished = Object.entries(previous.sessions ?? {})
  .filter(([id]) => sessions[id] === undefined)
  .map(([id, { kind, spent }]) => `${input.now}\t${kind}\t${spent.toFixed(4)}\t${id}`);

mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(
  statePath,
  `${JSON.stringify({ utilization: input.utilization, sessions }, null, 2)}\n`,
  'utf8',
);
if (finished.length > 0) {
  const lines = `${finished.join('\n')}\n`;
  appendFileSync(spentPath, lines, 'utf8');
  process.stdout.write(lines);
}
