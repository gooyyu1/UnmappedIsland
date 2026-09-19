// **ゲームが増えた量と、それに費やした量**を並べて出す。割に合っているかを見る係
// （[`agent-ops/prompts/payoff-prompt.md`](../agent-ops/prompts/payoff-prompt.md)）の材料。
//
// 使い方:
//   node scripts/payoffMetrics.mjs                       今日から遡って7日刻み
//   node scripts/payoffMetrics.mjs 2026-08-01 2026-09-01 区切りの日を指定する（古い順）
//
// ## なぜ「オブジェクト定義の数」で測るのか
//
// **ゲームの進捗は、ゲーム内に定義されたオブジェクトの数で擬似的に測れる**（出どころ: ユーザーの
// 指示・2026-09-19）。擬似的だという断りごと受け取っている——**これが増えない変更は、完成への
// 貢献が薄いものとして扱ってよい。**
//
// 行数では測れない。規約・ひな形・検査・記録はどれも行数を増やすが、**遊べる島は1ミリも広がらない。**
// [`historyStats.mjs`](historyStats.mjs) が出す「規模の推移」は**育ち方**の表で、そちらは行数と
// PRとissueを見る。ここが見るのは**割**——分母が費やした量で、分子がゲームの増分。
//
// ## 数える先
//
// **`object_defs` の直下のキー。** 世界に在る物・場所・生き物の型が1つ1行のキーとして並ぶ
// （`docs/engine/GameElementDefinition.md`）。`traits:` は配る側の宣言なので数えない——同じ物に
// 何枚重ねても、世界に在る物は増えない。
//
// **古い置き場も数える**（`world-codex` が `public` の下に在った頃のもの。下の `CODEX_DIRECTORIES`）。
// 2026-08-16 に `src/assets/` へ移したので、そこより前の区間は古いほうにしか無い。片方だけを見ると、
// **移した週に定義が全部消えたように出る。**
//
// ## 費やした量の数え方
//
// `main` の第1親系列で、末尾が `(#N)` か `Merge pull request #N` のコミットを1本と数える
// （`historyStats.mjs` と同じ見分け方）。**`main` へ直接pushした分は入らない。**
//
// **触った場所で3つに割る。** `src/assets/world-codex/`（世界の中身）、それ以外の `src/`
// （ゲームの実装）、**どちらも触っていないもの**（規約・文書・検査・盤面の道具）。最後の1つが
// 増えているとき、**仕組みが自分の世話に回っている。**
//
// ## 仕組みが自分で作った仕事
//
// スメルを拾う係の記録（`agent-ops/analysis/<日付>.md`）の `## 切った issue` に挙がった番号を数える。
// **PRが出るたびに生える入力から、1日に何件の仕事が生まれたか**がこの列。
// **`## 読んだ範囲` の行数は読まない**——あそこの書き方は回ごとに揺れており（「40件、行は85本」
// 「行**100件**」「コメントは**108件**」）、数として引くと揺れが値の動きに見える。**節の名前だけは
// `tests/docs/analysisRecord.test.ts` が本文と突き合わせている**ので、そこを鍵にする。

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dayOf, git, requireFullHistory, revisionAt } from './gitHistory.mjs';
import { japanDayOf } from './japanDay.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** 区切りを渡されなかったときの刻み（日）。 */
const DEFAULT_STEP_DAYS = 7;

/** 区切りを渡されなかったときに遡る区間の数。 */
const DEFAULT_STEPS = 8;

/** 世界の定義の置き場。**古い置き場も数える**（冒頭の「数える先」）。 */
const CODEX_DIRECTORIES = ['src/assets/world-codex/', 'public/world-codex/'];

/** 世界の定義のファイル。 */
const CODEX = new RegExp(
  `^(?:${CODEX_DIRECTORIES.map((directory) => directory.replaceAll('/', '\\/')).join('|')}).*\\.yaml$`,
);

/** 数えるキーを持つ節。 */
const OBJECT_DEFS = 'object_defs:';

/** スメルを拾う係の記録の置き場と、番号を挙げる節。 */
const ANALYSIS_DIR = join(ROOT, 'agent-ops', 'analysis');
const CUT_ISSUES = '## 切った issue';

/**
 * そのリビジョンの `object_defs` の直下キーの数。
 *
 * **1リビジョンにつき `git grep` 1回で済ませる。** ファイルごとに `git show` すると、Windowsでは
 * プロセス生成が1回10〜30msかかる（#1545 の実測）ので、区間の数だけ数百回に膨らむ。
 *
 * 引くのは**トップレベルのキー**（`^\S+:`）と**その直下のキー**（`^  \S+:`）の行だけ。前者で節の
 * 出入りを見て、`object_defs` の中に居るあいだの後者を数える。**節の中に居るかを見ないと、
 * `traits:` の下のキーまで数える。**
 */
function objectDefinitions(revision) {
  try {
    return countObjectDefs(git(['grep', '-n', '-E', KEY_LINES, revision]));
  } catch {
    // 1件も当たらないと `git grep` は終了コード1を返す。定義がまだ無いリビジョンのことで、誤りではない。
    return 0;
  }
}

/** `git grep -n` が引く行——トップレベルのキーと、その直下のキー。 */
export const KEY_LINES = '^([A-Za-z_][A-Za-z0-9_]*:|  [A-Za-z_][A-Za-z0-9_]*:)';

/**
 * `git grep -n <rev>` が返す1行——`<rev>:<パス>:<行番号>:<中身>`。
 *
 * **区切りの `:` の数では割れない。** パスにも中身にも `:` が入りうるので、前から数えると列がずれる。
 * **パスの終わりは拡張子で決める**（引いているのは `.yaml` だけ）——そこを起点にすれば、リビジョンの
 * 綴りにも中身にも依らない。
 */
const HIT = /^[^:]*:(.*\.yaml):\d+:([\s\S]*)$/;

/**
 * `git grep -n <KEY_LINES> <rev>` の出力から、`object_defs` の直下キーを数える。
 *
 * **ファイルが変わるたびに節から出る。** `git grep` はファイルごとに並べて返すが、前のファイルが
 * `object_defs` の途中で終わっていることがあり、持ち越すと**次のファイルの先頭のキーまで数える。**
 */
export function countObjectDefs(stdout) {
  let count = 0;
  let inside = false;
  let current = '';
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const found = HIT.exec(line);
    if (found === null) continue;
    const [, path, text] = found;
    if (!CODEX.test(path)) continue;
    if (path !== current) {
      current = path;
      inside = false;
    }
    if (text.startsWith('  ')) {
      if (inside) count += 1;
      continue;
    }
    inside = text === OBJECT_DEFS;
  }
  return count;
}

/**
 * `main` へPRとして入ったコミットを、古い順に。**触ったパスを添える**ので、`--name-only` で1回引く。
 *
 * **マージコミットは `--name-only` が何も出さない。** 数には入れるが、触った場所の列には出ない
 * ——`paths` が空のものがそれで、下の `spending` では「どちらも触らず」へ落ちる（**PRとしては
 * 入っている**ので、総数からは外さない）。
 */
function mergedPullRequests() {
  const log = git(['log', '--first-parent', '--format=@@%at@@%s', '--name-only']);
  const prs = [];
  let current;
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) {
      const [, at, ...subject] = line.split('@@');
      const title = subject.join('@@');
      const isPullRequest = /\(#\d+\)$/.test(title) || /^Merge pull request #\d+/.test(title);
      current = isPullRequest ? { day: dayOf(at), paths: [] } : undefined;
      if (current !== undefined) prs.push(current);
      continue;
    }
    if (line !== '' && current !== undefined) current.paths.push(line);
  }
  return prs.reverse();
}

/** その区間に入ったPRを、触った場所で割った数。 */
function spending(prs, after, until) {
  const inside = prs.filter((pr) => pr.day > after && pr.day <= until);
  const touches = (pr, prefixes) =>
    pr.paths.some((path) => prefixes.some((prefix) => path.startsWith(prefix)));
  const codex = inside.filter((pr) => touches(pr, CODEX_DIRECTORIES));
  const source = inside.filter((pr) => touches(pr, ['src/']) && !touches(pr, CODEX_DIRECTORIES));
  return {
    total: inside.length,
    codex: codex.length,
    source: source.length,
    elsewhere: inside.length - codex.length - source.length,
  };
}

/**
 * スメルを拾う係が、1回の記録で挙げた issue の数。
 *
 * **数えるのは箇条書き1つにつき先頭の番号だけ。** 行の後ろには**何を見て切ったか**が続き、そこに
 * 出どころのPRの番号が並ぶ（`agent-ops/prompts/analysis-prompt.md` の「記録」）ので、節の中の
 * `#数字` を全部数えると、**切った issue の数がPRの数だけ水増しされる。**
 */
export function countCutIssues(text) {
  const numbers = new Set();
  let inside = false;
  let found = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      inside = line.trimEnd() === CUT_ISSUES;
      found ||= inside;
      continue;
    }
    if (!inside || !line.startsWith('- ')) continue;
    const number = line.match(/#\d+/)?.[0];
    if (number !== undefined) numbers.add(number);
  }
  return found ? numbers.size : undefined;
}

/** 渡された区切り（古い順）。渡されなければ、今日から `DEFAULT_STEP_DAYS` 刻みで遡る。 */
function boundaries(argv) {
  if (argv.length > 0) return [...argv].sort();
  const today = new Date();
  const days = [];
  for (let step = DEFAULT_STEPS; step >= 0; step -= 1) {
    const at = new Date(today);
    at.setUTCDate(at.getUTCDate() - step * DEFAULT_STEP_DAYS);
    days.push(japanDayOf(at));
  }
  return days;
}

/**
 * 1オブジェクトあたりの費やした量。**増えていない区間は割を出さない**——定義が減った区間で負の値を
 * 出すと、**払った量が多いほど小さく（良く）見える**列になる。
 */
export function ratio(top, bottom) {
  return bottom <= 0 ? '—' : (top / bottom).toFixed(1);
}

/** 表を組み立てて標準出力へ書く。**呼ばれたときだけ走る**ので、上の関数は検査から素で引ける。 */
function report() {
  requireFullHistory('割に合っているか');

  const days = boundaries(process.argv.slice(2));
  const prs = mergedPullRequests();

  const rows = [];
  let previousObjects;
  let previousDay;
  for (const day of days) {
    const revision = revisionAt(day);
    const objects = revision === '' ? 0 : objectDefinitions(revision);
    const grew = previousObjects === undefined ? undefined : objects - previousObjects;
    const spent = previousDay === undefined ? undefined : spending(prs, previousDay, day);
    rows.push({ day, objects, grew, spent });
    previousObjects = objects;
    previousDay = day;
  }

  const out = [];
  out.push(
    `# 割に合っているか（${japanDayOf(new Date())} 時点・HEAD=${git(['rev-parse', '--short', 'HEAD'])}）`,
  );
  out.push('');
  out.push('## ゲームが増えた量と、それに費やした量');
  out.push('');
  out.push(
    '| 区間の終わり | オブジェクト定義 | 増えた数 | 入ったPR | world-codex | src | どちらも触らず | 1オブジェクトあたりPR |',
  );
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of rows) {
    if (row.spent === undefined) {
      out.push(`| ${row.day} | ${row.objects} | — | — | — | — | — | — |`);
      continue;
    }
    const { total, codex, source, elsewhere } = row.spent;
    out.push(
      `| ${row.day} | ${row.objects} | ${row.grew} | ${total} | ${codex} | ${source} | ${elsewhere} | ${ratio(total, row.grew)} |`,
    );
  }

  out.push('');
  out.push('## 仕組みが自分で作った仕事');
  out.push('');
  out.push('| 分析の回 | 切った issue |');
  out.push('| --- | ---: |');
  const records = readdirSync(ANALYSIS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort();
  for (const file of records) {
    const cut = countCutIssues(readFileSync(join(ANALYSIS_DIR, file), 'utf-8'));
    if (cut === undefined) continue;
    out.push(`| ${file.replace(/\.md$/, '')} | ${cut} |`);
  }

  process.stdout.write(`${out.join('\n')}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  report();
}
