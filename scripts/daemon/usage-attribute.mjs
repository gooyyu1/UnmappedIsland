// 使用量の増分を、そのとき動いていたセッションへ割り当てる（`agent-ops/board-design.md` 2.5）。
//
//   echo '{"usage":"five_hour 12 - -\nseven_day 3 - -","now":"...","live":[…]}' \
//     | node scripts/daemon/usage-attribute.mjs <状態のファイル> <記録のファイル>
//
// 状態のファイルを読み書きし、**畳まれたセッションぶんだけ**を記録のファイルへ1行1件で足す。
// 足した行は標準出力にも出す（呼び手が見えるように）。行は
// `<時刻>\t<種類>\t<枠ごとの消費…>\t<セッションID>` のTSV で、**枠の並びは
// [`usage-windows.mjs`](usage-windows.mjs) の `WINDOWS`。**
//
// ## セッション単位の消費は引けないので、割り当てる
//
// APIが返すのは全体の `utilization` だけ（2.8）。**前回からの増分を、そのとき動いていたセッション
// で等分する。**
//
// **枠ごとに別々に積む。** 投入を止めるかは枠ごとに比べる（2.5.2）ので、1本あたりの消費も**その枠
// の単位**で要る——`five_hour` の百分率を `seven_day` の残りと比べても、数の意味が違う。
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
import { WINDOWS, parseUsage } from './usage-windows.mjs';

/** タグから投入の種類を決める（2.3）。タグの無いセッションはユーザー自身の対話。 */
function kindOf(tags) {
  for (const tag of tags) {
    if (tag.startsWith('task-')) return 'new-task';
    if (tag.startsWith('review-')) return 'review';
  }
  return tags.length > 0 ? 'other' : 'untagged';
}

function readState(path) {
  if (!existsSync(path)) return { utilization: {}, sessions: {} };
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * そのセッションが前の周までに積んでいた、枠ごとの消費。
 *
 * **枠ごとに分かれていなかった頃の値は、`five_hour` の増分だけを積んだもの**なので、その枠へ
 * 引き継ぐ。**捨てると、乗り換えの周に生きていたセッションが実際より小さい消費として記録へ入り、
 * 0ではないので平均から除かれないまま平均を下へ引く**（[`headroom.mjs`](headroom.mjs)）——このPRが
 * 塞ごうとしている側と同じ向きに狂う。他の枠は0のまま＝「一度も見なかった」で、あちらが除く。
 *
 * **要るのは乗り換えの1回きり。** 乗り換えの時点で生きていたセッションが全部畳まれたら、この分岐は
 * 二度と通らないので消してよい。
 *
 * **引き継ぐのは積み上がりだけで、基準（`utilization`）は引き継がない。** 前の版は枠ごとに持って
 * いないので枠の名前で引けず、**乗り換えの周だけは両方の枠で増分が0になる**（下の `rose`）。
 * **その1周ぶんだけ、消費を小さく見積もる**——上の「捨てると平均を下へ引く」と同じ向きの狂いで、
 * 大きさが積み上がり全部か1周ぶんかだけが違う。下の「下がった周」と同じ取りこぼしとして受ける。
 */
function carriedSpent(spent) {
  if (typeof spent === 'number') return { five_hour: spent };
  return spent ?? {};
}

const [statePath, spentPath] = process.argv.slice(2);
if (statePath === undefined || spentPath === undefined) {
  process.stderr.write('状態のファイルと記録のファイルのパスを渡す\n');
  process.exit(1);
}

const input = JSON.parse(readFileSync(0, 'utf8'));
const usage = parseUsage(input.usage);
if (usage === undefined) {
  process.stderr.write(`使用量の行を読めなかった: ${JSON.stringify(input.usage)}\n`);
  process.exit(1);
}
const previous = readState(statePath);

// 上の「分母は『動いていたもの』だけ」。1本も動いていなければ、この周の増分は誰にも積まない。
const working = input.live.filter((session) => session.working);

const share = {};
for (const name of WINDOWS) {
  const before = previous.utilization?.[name];
  const rose = typeof before === 'number' && usage[name].utilization >= before;
  const delta = rose ? usage[name].utilization - before : 0;
  share[name] = working.length > 0 ? delta / working.length : 0;
}

const sessions = {};
for (const session of input.live) {
  const carried = carriedSpent(previous.sessions?.[session.id]?.spent);
  const spent = {};
  for (const name of WINDOWS) {
    spent[name] = (carried[name] ?? 0) + (session.working ? share[name] : 0);
  }
  sessions[session.id] = { kind: kindOf(session.tags), spent };
}

// 生きている一覧から消えたセッション＝畳まれた。積み上がった値がそのセッションの消費。
const finished = Object.entries(previous.sessions ?? {})
  .filter(([id]) => sessions[id] === undefined)
  .map(([id, { kind, spent }]) => {
    const carried = carriedSpent(spent);
    return [input.now, kind, ...WINDOWS.map((name) => (carried[name] ?? 0).toFixed(4)), id].join('\t');
  });

mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(
  statePath,
  `${JSON.stringify(
    {
      utilization: Object.fromEntries(WINDOWS.map((name) => [name, usage[name].utilization])),
      sessions,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
if (finished.length > 0) {
  const lines = `${finished.join('\n')}\n`;
  appendFileSync(spentPath, lines, 'utf8');
  process.stdout.write(lines);
}
