// リポジトリの育ち方（規模・PR・issue の推移）を、指定した日の実測として出す。
//
// [`docs/HowWeGotHere.md`](../docs/HowWeGotHere.md) の「規模の推移」の表を作る道具。
// **あの表は手で埋めない**——この出力をそのまま貼る。
//
// 使い方:
//   node scripts/historyStats.mjs                      開始日から7日刻み＋今日
//   node scripts/historyStats.mjs 2026-07-18 2026-08-30 指定した日だけ
//
// 日付は**日本時間**で読み、その日の最終コミットの状態を測る。時差で日が変わるので、UTCの
// 履歴をそのまま日で切ると1日ずれる。
//
// ## 行数の集め方
//
// 置き場はC#期（Unity）とTS期をまたぐが、**両方のpathspecを合併して1つの式で数える**。
// C#期には `src/` が無く、TS期には `Assets/` が無いので、合併しても互いに混ざらない。
// 期ごとに式を分けると、境目の日にどちらで数えたかが出力から読めなくなる。
//
// ## PRの数え方
//
// `main` の第1親系列で、`Merge pull request #N`（マージコミット）か末尾が `(#N)`（squash）の
// コミットを1本と数える。**司令塔が `main` へ直接pushした分は入らない**——PRとして通っていない
// ので、1本あたりの規模を平均する母集団としても外れているのが正しい。
//
// 1本あたりの規模は**その行の1つ前の行からの区間**の平均で、累計の平均ではない。方式が変わる
// たびに1本の大きさが変わるので、累計にすると変わったこと自体が見えなくなる。
//
// ## issue の数え方
//
// GitHubにしか無いので `gh` へ訊く。`gh` が無い環境（CIなど）では `-` を出す——他の列は git
// だけで出るので、issue が引けないことを理由に全部を止めない。

import { execFileSync } from 'node:child_process';

/** 行数の4列。値は `git grep` へ渡す pathspec で、C#期とTS期の置き場を合併してある。 */
const LINE_COLUMNS = [
  { header: '実装', pathspecs: ['Assets/Scripts/**/*.cs', 'src/**/*.ts', ':!src/**/*.test.ts'] },
  { header: '試験', pathspecs: ['Tests/**/*.cs', 'tests/**/*.ts', 'src/**/*.test.ts'] },
  { header: '文書', pathspecs: ['Documents/**/*.md', 'docs/**/*.md'] },
  {
    header: '定義',
    pathspecs: ['Assets/StreamingAssets/**/*.yaml', 'public/**/*.yaml', 'src/assets/**/*.yaml'],
  },
];

const TIMEZONE = 'Asia/Tokyo';
const OFFSET = '+0900';
const DEFAULT_STEP_DAYS = 7;

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, TZ: TIMEZONE },
  }).trim();
}

/** その日（日本時間）の最終コミット。まだ1つも無い日は空文字。 */
function revisionAt(day) {
  return git(['rev-list', '-1', `--before=${day} 23:59:59 ${OFFSET}`, 'HEAD']);
}

/** pathspec に当たるファイルの総行数。`git grep -c ''` は1行1ファイルで `rev:path:行数` を返す。 */
function lineCount(revision, pathspecs) {
  let stdout = '';
  try {
    stdout = git(['grep', '-c', '', revision, '--', ...pathspecs]);
  } catch {
    // 1件も当たらないと `git grep` は終了コード1を返す。行数0のことなので誤りではない。
    return 0;
  }
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(':') + 1)), 0);
}

/** `main` へPRとして入ったコミット（第1親系列）を、古い順に日付付きで。 */
function mergedPullRequests() {
  const log = git(['log', '--first-parent', '--format=%H@@%ad@@%s', '--date=format-local:%Y-%m-%d']);
  return log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha, day, subject] = line.split('@@');
      return { sha, day, subject };
    })
    .filter(({ subject }) => /^Merge pull request #\d+/.test(subject) || /\(#\d+\)$/.test(subject))
    .reverse();
}

/** 文書の置き場。C#期の `Documents/` とTS期の `docs/`。 */
const DOCUMENT_DIRECTORIES = /^(docs|Documents)\//;
/** 実装と試験の置き場。同上。 */
const CODE_DIRECTORIES = /^(src|tests|Assets\/Scripts|Tests)\//;

/**
 * そのPRが `main` へ入れた差分。第1親との差分なので、squashでもマージでも同じ意味になる。
 *
 * `bothSides` は、文書と実装（試験を含む）の**両方**を1本のPRで触ったかどうか。仕様を先に
 * 書いてから実装する進め方が、機能ごとに閉じている（アジャイル的）か、文書を全部書いてから
 * 実装へ移る（ウォーターフォール的）かは、この割合に出る。
 */
function diffOf(sha) {
  const numstat = git(['diff', '--numstat', `${sha}^1`, sha]);
  let files = 0;
  let lines = 0;
  let documents = false;
  let code = false;
  for (const row of numstat.split('\n')) {
    if (row === '') continue;
    const [added, removed, path] = row.split('\t');
    files += 1;
    // バイナリは `-` で出る。行数としては数えず、ファイル数だけ数える。
    lines += (Number(added) || 0) + (Number(removed) || 0);
    if (DOCUMENT_DIRECTORIES.test(path)) documents = true;
    if (CODE_DIRECTORIES.test(path)) code = true;
  }
  return { files, lines, bothSides: documents && code };
}

/** その日までに立てられた issue の累計。`gh` が無ければ null。 */
function issueCountAt(day) {
  const nextDay = new Date(`${day}T00:00:00+09:00`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const bound = nextDay.toISOString().replace(/\.\d+Z$/, 'Z');
  const query = `repo:${repository()} is:issue created:<${bound}`;
  try {
    return Number(
      execFileSync('gh', ['api', '-X', 'GET', 'search/issues', '-f', `q=${query}`, '--jq', '.total_count'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    return null;
  }
}

function repository() {
  const url = git(['remote', 'get-url', 'origin']);
  const match = /github\.com[/:]([^/]+\/[^/.]+)/.exec(url);
  if (match === null) throw new Error(`originのURLから owner/repo を取れない: ${url}`);
  return match[1];
}

/** 引数が無いときの既定。最初のコミットの日から7日刻みで、最後は今日。 */
function defaultDays() {
  const first = git(['log', '--reverse', '--format=%ad', '--date=format-local:%Y-%m-%d'])
    .split('\n')[0]
    .trim();
  const today = git(['log', '-1', '--format=%ad', '--date=format-local:%Y-%m-%d']);
  const days = [];
  for (let at = new Date(`${first}T00:00:00+09:00`); ; at.setUTCDate(at.getUTCDate() + DEFAULT_STEP_DAYS)) {
    const day = formatDay(at);
    if (day >= today) break;
    days.push(day);
  }
  days.push(today);
  return days;
}

function formatDay(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatTable(rows) {
  const headers = [
    '日',
    ...LINE_COLUMNS.map((column) => column.header),
    'issue',
    'PR',
    '1PRあたり',
    '文書と実装が同じPR',
  ];
  const aligns = ['---', ...headers.slice(1).map(() => '--:')];
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [`| ${headers.join(' | ')} |`, `| ${aligns.join(' | ')} |`, ...body].join('\n');
}

const days = process.argv.slice(2);
const targets = days.length > 0 ? days : defaultDays();
for (const day of targets) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error(`日付は YYYY-MM-DD で指定してください: ${day}`);
    process.exit(1);
  }
}

const pullRequests = mergedPullRequests();
const rows = [];
let previousDay = '';
for (const day of targets) {
  const revision = revisionAt(day);
  if (revision === '') {
    console.error(`${day} までのコミットが履歴に無い。浅いクローンなら 'git fetch --unshallow' が要る。`);
    process.exit(1);
  }

  const counts = LINE_COLUMNS.map((column) => lineCount(revision, column.pathspecs));
  const merged = pullRequests.filter(({ day: at }) => at <= day);
  const inInterval = merged.filter(({ day: at }) => at > previousDay);
  const diffs = inInterval.map(({ sha }) => diffOf(sha));
  const mean = (pick) => diffs.reduce((sum, diff) => sum + pick(diff), 0) / diffs.length;
  const empty = diffs.length === 0;
  const size = empty
    ? '-'
    : `${mean((d) => d.files).toFixed(1)}ファイル / ${Math.round(mean((d) => d.lines))}行`;
  const bothSides = empty ? '-' : `${Math.round(100 * mean((d) => (d.bothSides ? 1 : 0)))}%`;
  const issues = issueCountAt(day);

  rows.push([
    day.slice(5),
    ...counts.map((count) => count.toLocaleString('en-US')),
    issues === null ? '-' : issues.toLocaleString('en-US'),
    merged.length.toLocaleString('en-US'),
    size,
    bothSides,
  ]);
  previousDay = day;
}

if (rows.length === 0) {
  console.error('行が1つも出なかった。日付の指定か履歴の深さを確認してください。');
  process.exit(1);
}

console.log(formatTable(rows));
