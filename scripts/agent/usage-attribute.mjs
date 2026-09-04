// 使用量の増分を、生きているセッションへ割り当てる（`.claude/board-design.md` 2.5）。
//
//   echo '{"utilization":12,"resetsAt":"...","now":"...","live":[{"id":"cse_a","tags":["task-1"]}]}' \
//     | node scripts/agent/usage-attribute.mjs <状態のファイル> <記録のファイル>
//
// 状態のファイルを読み書きし、**畳まれたセッションぶんだけ**を記録のファイルへ1行1件で足す。
// 足した行は標準出力にも出す（呼び手が見えるように）。行は
// `<時刻>\t<種類>\t<消費>\t<セッションID>` のTSV。
//
// ## セッション単位の消費は引けないので、割り当てる
//
// APIが返すのは全体の `utilization` だけ（2.8）。**前回からの増分を、そのとき生きているセッション
// 全部で等分する。**
//
// **分母に1を足す。** 割る相手はタグの付いたセッションだけではなく、**ユーザー自身の対話も含めた
// 全部**（2.5）。同じ5時間枠を食っているので、含めないと投入したセッションの消費が過大に出る。
// ブリッジで Claude Code が走っていることはデーモンの前提なので（2.8）、その1本は常に居る。
//
// ## 枠が変わった周は、増分を0にする
//
// `resets_at` が変われば `utilization` は下がる。**引き算をそのまま使うと負の消費が積まれる**ので、
// 枠が変わった周と `utilization` が下がった周は基準を置き直すだけにする。取りこぼすのはその1周分。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** タグから投入の種類を決める（2.3 の4つ）。タグの無いセッションはユーザー自身の対話。 */
function kindOf(tags) {
  for (const tag of tags) {
    if (tag.startsWith('task-')) return 'new-task';
    if (tag.startsWith('review-')) return 'review';
  }
  return tags.length > 0 ? 'other' : 'untagged';
}

function readState(path) {
  if (!existsSync(path)) return { utilization: null, resetsAt: null, sessions: {} };
  return JSON.parse(readFileSync(path, 'utf8'));
}

const [statePath, spentPath] = process.argv.slice(2);
if (statePath === undefined || spentPath === undefined) {
  process.stderr.write('状態のファイルと記録のファイルのパスを渡す\n');
  process.exit(1);
}

const input = JSON.parse(readFileSync(0, 'utf8'));
const previous = readState(statePath);

const sameWindow = previous.resetsAt === input.resetsAt && typeof previous.utilization === 'number';
const rose = sameWindow && input.utilization >= previous.utilization;
const delta = rose ? input.utilization - previous.utilization : 0;

// 分母の `+ 1` はブリッジの Claude Code 本体。上の「分母に1を足す」。
const share = delta / (input.live.length + 1);

const sessions = {};
for (const session of input.live) {
  const carried = previous.sessions?.[session.id]?.spent ?? 0;
  sessions[session.id] = { kind: kindOf(session.tags), spent: carried + share };
}

// 生きている一覧から消えたセッション＝畳まれた。積み上がった値がそのセッションの消費。
const finished = Object.entries(previous.sessions ?? {})
  .filter(([id]) => sessions[id] === undefined)
  .map(([id, { kind, spent }]) => `${input.now}\t${kind}\t${spent.toFixed(4)}\t${id}`);

mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(
  statePath,
  `${JSON.stringify({ utilization: input.utilization, resetsAt: input.resetsAt, sessions }, null, 2)}\n`,
  'utf8',
);
if (finished.length > 0) {
  const lines = `${finished.join('\n')}\n`;
  appendFileSync(spentPath, lines, 'utf8');
  process.stdout.write(lines);
}
