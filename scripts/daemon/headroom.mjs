// 残り余力と1本あたりの消費を比べて、この種類を流してよいかを答える
// （`agent-ops/board-design.md` 2.5.2）。**入口は隣の [`headroom.sh`](headroom.sh)。**
//
//   bash scripts/daemon/usage.sh --last | node scripts/daemon/headroom.mjs new-task <spent.tsv>
//
// ## 比べるのは、残量ではなく「あと1本入るか」
//
// 基盤の出す段階（`limits[].severity`）は「どれだけ使ったか」を粗く言うだけで、**こちらが知りたい
// 「あと1本投入してよいか」には答えない**（2.5.1）。要るのは次の比較。
//
//   残り余力（= 100 - utilization） < その種類の1本あたりの平均消費 × 安全率
//
// **枠ごとに比べ、どれか1つでも足りなければ止める。** 枠は独立に尽きる——2026-09-14 からの3日で
// 当たったのは週次のほうで、5時間の枠には余力が在った（issue #2209）。
//
// ## 段は結果として付く
//
// 種類ごとにしきい値を書き分けない。**消費の大きい種類ほど早く止まる**ので、上限が近づくと重い
// 仕事から順に落ち、軽いものが最後まで流れる（2.5.2）。
//
// ## 消費が0の記録は、平均に入れない
//
// **0は「1本で0しか食わなかった」ではなく「一度も動いているところを見なかった」。** 割り当ての側は
// 動いていた周にしか積まない（[`usage-attribute.mjs`](usage-attribute.mjs)）ので、モデルが割り当た
// らずに空のまま畳まれたセッションは0で残る。**それを平均に入れると、上限に当たっている間ほど平均が
// 0へ近づき、いちばん止めたい周に手綱が緩む**——2026-09-14 からの3日は、投入した90本がまさにこの形
// で畳まれている（#2209）。
//
// ## 「制限中だった」という状態を持たない
//
// 毎回引いて比べるだけなので、**枠が明けた周はそのまま `GO` に戻る**（2.5.1）。復帰のための処理も、
// 復帰し忘れる状態も無い。

import { existsSync, readFileSync } from 'node:fs';
import { WINDOWS, parseUsage } from './usage-windows.mjs';

/**
 * 安全率。**1本ぶんの余力では足りないとして止める倍率**で、大きいほど早く止まる。
 *
 * **仮決め: 2**（計測が無い状態で決めた。実績から決め直す先はここ1つ）。**大きめに置く**のは、
 * 外したときの損が釣り合わないから——小さすぎると上限に当たって中途半端なセッションが残り、
 * 大きすぎても投入が遅れるだけで済む（2.5.3）。
 */
const SAFETY_FACTOR = 2;

/**
 * 計測が溜まるまで使う、1本あたりの消費（枠ごとの `utilization` の百分率）。**仮決め**（2.5.3
 * 「計測が溜まるまでは既定値を使う。既定は大きめに置く」）。
 */
const DEFAULT_SPENT = { five_hour: 10, seven_day: 2 };

/** 平均を信じ始める件数。これに満たない種類は `DEFAULT_SPENT` のまま。 */
const MIN_SAMPLES = 3;

/**
 * 投入の種類 → 記録に積まれている種類（[`usage-attribute.mjs`](usage-attribute.mjs) の `kindOf`）。
 *
 * **タグから付く種類のほうが粗い。** `review-untasked` に当たるタグは無く、積まれるのは `review`
 * ——ここで寄せないと、その種類の計測が永久に0件のまま既定値で止まり続ける。
 *
 * **`resume` は測れないので、`new-task` と同じところで止める**（2.5.2 の「起こす経路も同じ関門を
 * 通る」）。起こされたセッションが食ったぶんは**そのセッション自身の種類**として積まれるので、
 * `resume` の行は永久に0件——分けて測る値が記録に無い。**通しにくい側へ外す**のは 2.5.3
 * 「既定は大きめに置く」と同じ理由で、外したときの損が釣り合わないから（緩すぎると上限に当たって
 * 何も出ないまま返され、きつすぎても起こすのが遅れるだけで、起こす手は枠が明けた周に出し直される）。
 */
function measuredKind(kind) {
  if (kind === 'new-task' || kind === 'resume') return 'new-task';
  if (kind === 'review' || kind === 'review-untasked') return 'review';
  return 'other';
}

/**
 * 記録から、その種類の1本あたりの消費を枠ごとに出す。
 *
 * **列の並びは `WINDOWS`**（`usage-attribute.mjs` が同じ並びで書く）。欄の数が合わない行は読まない
 * ——**枠が増える前に書かれた行**がそれで、読み違えるより落とすほうが軽い（落ちるのは、その行が
 * 平均へ入らないことだけ）。
 */
function averageSpent(spentPath, kind) {
  const samples = Object.fromEntries(WINDOWS.map((name) => [name, []]));
  if (existsSync(spentPath)) {
    for (const line of readFileSync(spentPath, 'utf8').replace(/\r/g, '').split('\n')) {
      const fields = line.split('\t');
      if (fields.length !== WINDOWS.length + 3 || fields[1] !== kind) continue;
      WINDOWS.forEach((name, index) => {
        const value = Number(fields[2 + index]);
        // 上の「消費が0の記録は、平均に入れない」。
        if (Number.isFinite(value) && value > 0) samples[name].push(value);
      });
    }
  }
  return Object.fromEntries(
    WINDOWS.map((name) => {
      const values = samples[name];
      if (values.length < MIN_SAMPLES) return [name, DEFAULT_SPENT[name]];
      return [name, values.reduce((sum, value) => sum + value, 0) / values.length];
    }),
  );
}

/** 答えを1行と終了コードで返す。**0が `GO`、4が余力で止まっている、1が読めなかった。** */
function verdict(kind, usage, spentPath) {
  // **錠が掛かっていたら、計測に関わらず全部止める**（2.5.2）。既に立てられない。
  for (const name of WINDOWS) {
    const locked = usage[name].lockedReason;
    if (locked !== undefined) return { line: `HOLD ${name} に錠が掛かっている（${locked}）`, code: 4 };
  }

  const average = averageSpent(spentPath, measuredKind(kind));
  for (const name of WINDOWS) {
    const left = 100 - usage[name].utilization;
    const needed = average[name] * SAFETY_FACTOR;
    if (left < needed) {
      return {
        line: `HOLD ${name} の残り余力 ${left.toFixed(1)} < 1本あたり ${average[name].toFixed(1)} × 安全率 ${SAFETY_FACTOR}`,
        code: 4,
      };
    }
  }
  return { line: 'GO', code: 0 };
}

const [kind, spentPath] = process.argv.slice(2);
if (kind === undefined || spentPath === undefined) {
  process.stderr.write('種類と、記録のファイルのパスを渡す\n');
  process.exit(1);
}

const usage = parseUsage(readFileSync(0, 'utf8'));
if (usage === undefined) {
  process.stdout.write('UNKNOWN 使用量の行を読めなかった\n');
  process.exit(1);
}

const answer = verdict(kind, usage, spentPath);
process.stdout.write(`${answer.line}\n`);
process.exit(answer.code);
