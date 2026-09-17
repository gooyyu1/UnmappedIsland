// 使用量の枠の名前と、[`usage.sh`](usage.sh) の出す行の読み方。**枠を増やすならここ1つ。**
//
// 枠の名前を要る側は、引く側（[`usage.mjs`](usage.mjs)）・積む側
// （[`usage-attribute.mjs`](usage-attribute.mjs)）・比べる側（[`headroom.mjs`](headroom.mjs)）に
// 分かれている。**それぞれに書き写すと、増やしたとき片方だけが知らないままになる**
// （`CLAUDE.md`「数え上げを書かない」）。

/**
 * 手綱が見る枠。**この並びが、積んだ記録（`spent.tsv`）の列の並びでもある。**
 *
 * 応答には他にも枠が並ぶ（`seven_day_opus` など）が、増やすなら
 * [`board-design.md`](../../agent-ops/board-design.md) 2.5.2 の側を先に決める。
 */
export const WINDOWS = ['five_hour', 'seven_day'];

/**
 * `usage.sh` の出した行を枠ごとに読む。**どれか1つでも読めなければ `undefined`**——欠けた枠を
 * 「余力が在る」として通すと、その枠では手綱が掛からないまま上限に当たる。
 *
 * **`resets_at`（3つ目の欄）は読まない。** 同じ枠でも呼び出しごとに揺れるので判定に使えない
 * （[`board-design.md`](../../agent-ops/board-design.md) 2.8）。
 */
export function parseUsage(text) {
  if (typeof text !== 'string') return undefined;
  const quotas = {};
  // **`\r` を落とすのはここ。** 行を出す側は Windows のシェルを通ることがあり、落とさないと
  // 末尾の `locked_reason` が `-\r` になって「錠が掛かっている」と読まれる。
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const fields = line.split(' ');
    if (!WINDOWS.includes(fields[0])) continue;
    quotas[fields[0]] = {
      utilization: Number(fields[1]),
      lockedReason: fields[3] === '-' ? undefined : fields[3],
    };
  }
  for (const name of WINDOWS) {
    if (quotas[name] === undefined || !Number.isFinite(quotas[name].utilization)) return undefined;
  }
  return quotas;
}
