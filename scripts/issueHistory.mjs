// その日までに立てられた issue の数を、GitHub へ訊かずに出す。
//
// 置き場は [`stats/issues.tsv`](../stats/issues.tsv) で、**作るのは `npm run stats:issues`**
// （[`collectIssueHistory.mjs`](collectIssueHistory.mjs)）。読む側（`historyStats.mjs`）は git と
// 同じくローカルのファイルだけを見る——表を作るたびに外へ当てると、網の無い環境で列が消えるうえ、
// 検査が走るたびにGitHubへ出ることになる。
//
// **最後の行の日が、測った日。** 測った日に issue が1件も立っていなくても行を書くので、行の並びが
// そのまま「どこまで測ったか」になる。別の欄で持つと、行と食い違ったときにどちらが正しいかを
// 決められない。
//
// **測った日より後を訊かれたら、値は持ち越しになる**（`issueCountAt` の `measured`）。表へ出す側は
// 実測と区別が付く形で書く——区別を付けずに出すと、古い数字が今の実測として読まれる。

import { readFileSync } from 'node:fs';

/** 立てられた日ごとの issue の数の置き場。書く側と読む側で1つに寄せる。 */
export const ISSUE_HISTORY_FILE = new URL('../stats/issues.tsv', import.meta.url);

const HEADER = ['day_jst', 'created'];

/**
 * 立てられた日ごとの issue の数を、置き場の書式にする。
 *
 * **測った日の行が無ければ0で足す。** 最後の行が測った日であることは、読む側が「どこまで
 * 測ったか」を知る唯一の手がかり（このファイルの冒頭）。
 *
 * @param {ReadonlyMap<string, number>} createdByDay 立てられた日（日本時間）ごとの数
 * @param {string} measuredDay 測った日（日本時間）
 * @returns {string} `stats/issues.tsv` の中身
 */
export function formatIssueHistory(createdByDay, measuredDay) {
  const rows = new Map(createdByDay);
  if (!rows.has(measuredDay)) rows.set(measuredDay, 0);
  const lines = [...rows]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([day, created]) => `${day}\t${created}`);
  return `${HEADER.join('\t')}\n${lines.join('\n')}\n`;
}

/**
 * 置き場の中身を解く。**形が崩れていたら落ちる**——数の列だけが静かに減るより、読めないと
 * 言って止まるほうが、貼った先で気づける。
 *
 * @param {string} text `stats/issues.tsv` の中身
 * @returns {{ measuredDay: string, createdByDay: Map<string, number> }} 測った日と、日ごとの数
 */
export function parseIssueHistory(text) {
  // **改行は `\r?\n` で割る。** 作業ツリーがCRLFのとき、行末に `\r` が残ると見出しの照合も日付の
  // 照合も外れ、表が1列欠けるのではなく道具ごと落ちる（同じ形で issue #867）。
  const [header, ...lines] = text.trim().split(/\r?\n/);
  if (header !== HEADER.join('\t')) throw new Error(`issue の履歴の見出しが違う: ${header}`);
  const createdByDay = new Map();
  let measuredDay = '';
  for (const line of lines) {
    const [day, created] = line.split('\t');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`issue の履歴の日付が読めない: ${line}`);
    if (!/^\d+$/.test(created)) throw new Error(`issue の履歴の数が読めない: ${line}`);
    if (day <= measuredDay)
      throw new Error(`issue の履歴が古い順に並んでいない: ${measuredDay} の次に ${day}`);
    createdByDay.set(day, Number(created));
    measuredDay = day;
  }
  if (measuredDay === '') throw new Error('issue の履歴に行が1つも無い');
  return { measuredDay, createdByDay };
}

/**
 * 置き場を読む。**無ければ、作り方を告げて落ちる**——列を落として表を出すと、貼り直した先で
 * 今ある値を失う（issue #1887）。
 *
 * @returns {{ measuredDay: string, createdByDay: Map<string, number> }} 測った日と、日ごとの数
 */
export function readIssueHistory() {
  let text;
  try {
    text = readFileSync(ISSUE_HISTORY_FILE, 'utf8');
  } catch {
    throw new Error("issue の履歴が無い。'npm run stats:issues' で作ってから走らせること。");
  }
  return parseIssueHistory(text);
}

/**
 * その日までに立てられた issue の累計。
 *
 * @param {{ measuredDay: string, createdByDay: ReadonlyMap<string, number> }} history 置き場の中身
 * @param {string} day 日本時間の日（`YYYY-MM-DD`）
 * @returns {{ count: number, measured: boolean }} 累計と、それが実測か（偽なら測った日からの持ち越し）
 */
export function issueCountAt(history, day) {
  let count = 0;
  for (const [at, created] of history.createdByDay) {
    if (at <= day) count += created;
  }
  return { count, measured: day <= history.measuredDay };
}

/**
 * 累計を、表へ出す形にする。**持ち越しはそう書く**——数字だけを出すと、古い値が今の実測として
 * 読まれる。持ち越しが出たら `npm run stats:issues` から集め直す。
 *
 * @param {{ count: number, measured: boolean }} counted {@link issueCountAt} の結果
 * @returns {string} 表の升の中身
 */
export function formatIssueCount({ count, measured }) {
  const value = count.toLocaleString('en-US');
  return measured ? value : `${value}（持ち越し）`;
}
