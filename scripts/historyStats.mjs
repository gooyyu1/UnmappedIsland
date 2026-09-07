// リポジトリの育ち方（規模・PR・issue の推移）を、指定した日の実測として出す。
//
// [`docs/HowWeGotHere.md`](../docs/HowWeGotHere.md) の「規模の推移」の表を作る道具。
// **あの表は手で埋めない**——この出力をそのまま貼る。
//
// 使い方:
//   node scripts/historyStats.mjs                      開始日から7日刻み＋今日
//   node scripts/historyStats.mjs 2026-07-18 2026-08-30 指定した日だけ
//   node scripts/historyStats.mjs --svg docs <日付...>  表に加えて、貼り込む図も書き出す
//
// 日付は**日本時間**で読み、その日の最終コミットの状態を測る。時差で日が変わるので、UTCの
// 履歴をそのまま日で切ると1日ずれる。**呼ぶ側も日付をJSTで作ること**——UTCの「今日」を渡すと、
// JSTで日が変わった後の時間帯にはHEADが境界より後になり、その日のコミットが1つも無いことになる。
//
// **履歴を全部持っていないと走らない**（`requireFullHistory`）。浅いクローンでは、行数の列だけが
// 出せてしまうのが一番危ないので、手前で止める。
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
// コミットを1本と数える。**`main` へ直接pushした分は入らない**——PRとして通っていない
// ので、1本あたりの規模を平均する母集団としても外れているのが正しい。
//
// 1本あたりの規模は**その行の1つ前の行からの区間**の平均で、累計の平均ではない。方式が変わる
// たびに1本の大きさが変わるので、累計にすると変わったこと自体が見えなくなる。
//
// **作業ブランチで走らせるなら、`main` は merge ではなく rebase で取り込むこと。** merge で
// 取り込むと `main` 側のコミットが第2親へ回り、**取り込んだ分のPRを丸ごと数え落とす**
// （行数の列は最終コミットの中身を見るので落ちない。PRの列だけが静かに減る）。
//
// ## issue の数え方
//
// GitHubにしか無いので `gh` へ訊く。`gh` が無い環境（CIなど）では `-` を出す——他の列は git
// だけで出るので、issue が引けないことを理由に全部を止めない。
//
// ## コストの数え方
//
// [`stats/usage/`](../stats/usage) を読む（作り方と限界は
// [`scripts/usage/README.md`](usage/README.md)）。**Claude はクラウドと手元の両方**が入っており、
// 1時間ごとの記録を日本時間の日へ束ね直してから区間へ足す。**Copilot は日単位の記録しか無い**ので
// UTCの日付をそのまま日本時間の日として使う。**これ以上は寄せられない**——UTCの1日は日本時間の
// 同じ日付の15時間と翌日の9時間に跨るので、同じ日付へ丸めるのが、時刻を持たない記録から取れる
// 唯一の割り当て。日をまたいだ分（最大9時間ぶん）は1日前に出る。
//
// **記録の無い区間は0**。両方とも最初のセッションから通して記録があるので、空欄は「使っていない」
// を意味する。

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineChart } from './lineChart.mjs';

/** 運用を回す道具の置き場。本番のプログラムではないので、`実装` とは別の列で数える。 */
const TOOL_DIRECTORIES = ['scripts', '.claude', 'tools'];

/** 道具として数える拡張子。**実行されるものとその型だけ**で、傍らの `*.md` や設定は入らない。 */
const TOOL_EXTENSIONS = ['mjs', 'mts', 'sh', 'py'];

/**
 * 行数の列。値は `git grep` へ渡す pathspec で、C#期とTS期の置き場を合併してある。
 *
 * **どこへ数えるかは、置き場ではなく中身の性質で決める。** 絵のレシピは `tools/` に在っても
 * データなので `定義` へ、運用の取り決めは `.claude/` に在っても文書なので `文書` へ入る。
 * **`.claude/decisions/` は判断の履歴なので、どの列にも数えない**——文書とは別のもの。
 *
 * **拡張子は `**.ts` の形で書く。** 途中にスラッシュを挟む形（`**` とスラッシュと `*.ts`）は、
 * 置き場の**直下**にあるファイルを取りこぼす——文書の列が `docs/` 直下（`HowWeGotHere.md`
 * など）を1つも数えていなかった。**どの列も拡張子で絞る**——絞らないと、置き場へ画像や zip が
 * 入った日に、`git grep -c ''` がそれへ返す数が黙って列へ乗る。
 */
const LINE_COLUMNS = [
  { header: '実装', pathspecs: ['Assets/Scripts/**.cs', 'src/**.ts', ':!src/**.test.ts'] },
  { header: '試験', pathspecs: ['Tests/**.cs', 'tests/**.ts', 'src/**.test.ts'] },
  {
    // `:(glob)` を付けると `*` がスラッシュを跨がなくなる。`.claude/` は**直下だけ**が取り決めで、
    // 下の階層（`skills/`・`decisions/`）は別のもの。
    header: '文書',
    pathspecs: ['Documents/**.md', 'docs/**.md', ':(glob).claude/*.md'],
  },
  {
    header: '定義',
    pathspecs: ['Assets/StreamingAssets/**.yaml', 'public/**.yaml', 'src/assets/**.yaml', 'tools/**.json'],
  },
  {
    header: '道具',
    pathspecs: TOOL_DIRECTORIES.flatMap((directory) =>
      TOOL_EXTENSIONS.map((extension) => `${directory}/**.${extension}`),
    ),
  },
];

/** 使用量の置き場。手元とクラウドを合わせて集めたもの。 */
const USAGE_DIRECTORY = new URL('../stats/usage/', import.meta.url);

const OFFSET = '+0900';
const DEFAULT_STEP_DAYS = 7;

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

/**
 * コミットの時刻（`%at` のエポック秒）から、日本時間の日を出す。
 *
 * **`--date=format-local` は使わない。** あれは git が環境の時間帯をどう解釈するかに乗っており、
 * 解釈できない環境では黙って別の日境で切る——**ずれても表は正常な形で出る**ので、貼った先で
 * 気づけない（2026-09-07、この道具の出力が行数だけ日本時間・PRだけ別の日境になっていた）。
 * 日境を決める場所は、`revisionAt` の `OFFSET` と合わせてここ1つに寄せる。
 */
function dayOf(epochSeconds) {
  return formatDay(new Date(Number(epochSeconds) * 1000));
}

/**
 * 履歴を全部持っていないなら、何も測らずに落ちる。
 *
 * **浅いクローンでは、この道具が答えるべきものが元から無い。** 行数の列だけは手元の1コミットから
 * 出せてしまうが、そこで表を出すと**PRの列が欠けたまま「測れた」形の表**になり、貼った先で
 * 気づけない。数えられるものと数えられないものの線は、ここ1箇所で引く。
 */
function requireFullHistory() {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'true') return;
  console.error(
    "浅いクローンでは育ち方を測れない。'git fetch --unshallow origin' で履歴を取ってから走らせること。",
  );
  process.exit(1);
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
  const log = git(['log', '--first-parent', '--format=%H@@%at@@%s']);
  const diffs = diffsBySha();
  return log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [sha, at, subject] = line.split('@@');
      return { sha, day: dayOf(at), subject };
    })
    .filter(({ subject }) => /^Merge pull request #\d+/.test(subject) || /\(#\d+\)$/.test(subject))
    .reverse()
    .map((pullRequest) => ({ ...pullRequest, diff: diffs.get(pullRequest.sha) }));
}

/** 見出しの行を持つTSVを、1行1レコードの配列にする。 */
function readTable(name) {
  const [header, ...lines] = readFileSync(new URL(name, USAGE_DIRECTORY), 'utf8').trim().split('\n');
  const keys = header.split('\t');
  return lines.map((line) => Object.fromEntries(line.split('\t').map((cell, index) => [keys[index], cell])));
}

/** 日（日本時間）ごとに払った額。Claude と Copilot で、元の記録の細かさが違う（冒頭の「コストの数え方」）。 */
function costByDay() {
  const sum = (rows, dayOf) => {
    const total = new Map();
    for (const row of rows) {
      const day = dayOf(row);
      total.set(day, (total.get(day) ?? 0) + Number(row.cost_usd));
    }
    return total;
  };
  return {
    claude: sum(readTable('by_hour.tsv'), (row) => formatDay(new Date(row.hour_utc))),
    copilot: sum(readTable('copilot_by_day.tsv'), (row) => row.day_utc),
  };
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
 *
 * **ここでの「文書」は仕様の置き場だけ**で、`文書` の列とは範囲が違う——`.claude/` の取り決めは、
 * 実装と対で書かれるものではないので、対になっているかを見るこの割合には入れない。
 *
 * **全部のPRぶんを1回の `git log` で取る。** 1本ずつ `git diff` を呼ぶと、履歴が千本を超えた
 * あたりから子プロセスの起動だけで数十秒かかる。`-m --first-parent` は、マージコミットでも
 * 第1親との差分だけを出す。
 */
function diffsBySha() {
  const log = git(['log', '--first-parent', '-m', '--numstat', '--format=@@%H']);
  const diffs = new Map();
  let current = null;
  for (const row of log.split('\n')) {
    if (row.startsWith('@@')) {
      current = { files: 0, lines: 0, documents: false, code: false };
      diffs.set(row.slice(2), current);
      continue;
    }
    if (current === null || row === '') continue;
    const [added, removed, path] = row.split('\t');
    current.files += 1;
    // バイナリは `-` で出る。行数としては数えず、ファイル数だけ数える。
    current.lines += (Number(added) || 0) + (Number(removed) || 0);
    if (DOCUMENT_DIRECTORIES.test(path)) current.documents = true;
    if (CODE_DIRECTORIES.test(path)) current.code = true;
  }
  return new Map(
    [...diffs].map(([sha, { files, lines, documents, code }]) => [
      sha,
      { files, lines, bothSides: documents && code },
    ]),
  );
}

/** その日までに立てられた issue の累計。`gh` が無い・originがGitHubでないなら null。 */
function issueCountAt(day) {
  const nextDay = new Date(`${day}T00:00:00+09:00`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const bound = nextDay.toISOString().replace(/\.\d+Z$/, 'Z');
  try {
    const query = `repo:${repository()} is:issue created:<${bound}`;
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
  const first = dayOf(git(['log', '--reverse', '--format=%at']).split('\n')[0].trim());
  const today = dayOf(git(['log', '-1', '--format=%at']));
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

/** `YYYY-MM-DD`（日本時間）を count 日ずらす。 */
function shiftDay(day, count) {
  const at = new Date(`${day}T00:00:00+09:00`);
  at.setUTCDate(at.getUTCDate() + count);
  return formatDay(at);
}

/** `from` から `to` まで（両端を含む）の日。 */
function daysBetween(from, to) {
  const days = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/**
 * 区間の量を置く日。**区切りの日ではなく、区間の真ん中に置く。**
 *
 * 行数や累計はその日の状態なので区切りの日で正しいが、区間を平均した量は区間のどこかを代表する
 * 値なので、同じx座標に並べると右端へ張り付く。区切りは「作り方を変えた日」で決めていて幅が
 * 揃っていないので、ずれる量も点ごとに変わる。
 *
 * `from` は `to` 以前であること（区間が空だと代表する日が無い）。
 */
function middleDay(from, to) {
  const at = (day) => Date.parse(`${day}T00:00:00+09:00`);
  return shiftDay(from, Math.floor((at(to) - at(from)) / (2 * 86400000)));
}

/**
 * 区間の量を出す窓の幅。**段の区切りは使わない**（`dailyTotals`）。
 *
 * **奇数であること**——中央合わせなので、真ん中の日が1つに決まらないと窓が対称にならない。
 */
const WINDOW_DAYS = 3;

/**
 * 日ごとの、コストとPRの量。
 *
 * **図の区間の段は、段の区切りではなくここから固定幅の窓で作る。** 段の区切りは「作り方を変えた
 * 日」で決まっていて幅が揃わないので、区間の量を段ごとに出すと、**区切りを1日動かすだけで値が
 * 半分になる**（2026-09-07 時点の測定で、変更1千行あたりが $95.6 と $52.5 に分かれた）。
 */
function dailyTotals(pullRequests, costs, from, to) {
  const totals = new Map(
    daysBetween(from, to).map((day) => [day, { day, claude: 0, copilot: 0, count: 0, lines: 0 }]),
  );
  for (const [key, source] of [
    ['claude', costs.claude],
    ['copilot', costs.copilot],
  ]) {
    for (const [day, cost] of source) {
      const total = totals.get(day);
      if (total !== undefined) total[key] += cost;
    }
  }
  for (const { day, diff } of pullRequests) {
    const total = totals.get(day);
    if (total === undefined) continue;
    total.count += 1;
    total.lines += diff.lines;
  }
  return [...totals.values()];
}

/**
 * 中央合わせの移動窓で均した、日ごとの量。
 *
 * **端では窓が痩せる**——線を最後の日まで引くため。単価は、窓にPRが1本も無ければ定義できないので
 * null にし、その日は段から落とす（0で埋めると「ただ同然で作れた日」に見える）。
 */
function rollingSeries(totals) {
  const half = (WINDOW_DAYS - 1) / 2;
  return totals.map((_, index) => {
    const window = totals.slice(Math.max(0, index - half), index + half + 1);
    const sum = (pick) => window.reduce((total, row) => total + pick(row), 0);
    const claude = sum((row) => row.claude);
    const count = sum((row) => row.count);
    const lines = sum((row) => row.lines);
    return {
      day: totals[index].day,
      claudePerDay: claude / window.length,
      copilotPerDay: sum((row) => row.copilot) / window.length,
      claudePerPullRequest: count === 0 ? null : claude / count,
      claudePerThousandLines: lines === 0 ? null : (1000 * claude) / lines,
    };
  });
}

function formatTable(rows) {
  const headers = [
    '日',
    ...LINE_COLUMNS.map((column) => column.header),
    'issue',
    'PR',
    '1PRあたり',
    '変更行',
    'Claudeのコスト',
    '文書と実装が同じPR',
  ];
  const aligns = ['---', ...headers.slice(1).map(() => '--:')];
  const body = rows.map((row) => `| ${row.join(' | ')} |`);
  return [`| ${headers.join(' | ')} |`, `| ${aligns.join(' | ')} |`, ...body].join('\n');
}

/** その日の実測。表もグラフもここから作る。 */
function measureAt(day, previousDay, from, pullRequests, costs) {
  const revision = revisionAt(day);
  if (revision === '') {
    console.error(`${day} までのコミットが履歴に無い。浅いクローンなら 'git fetch --unshallow' が要る。`);
    process.exit(1);
  }

  const merged = pullRequests.filter(({ day: at }) => at <= day);
  const diffs = merged.filter(({ day: at }) => at > previousDay).map(({ diff }) => diff);
  const mean = (pick) => diffs.reduce((sum, diff) => sum + pick(diff), 0) / diffs.length;
  const spent = (total) =>
    [...total].reduce((sum, [at, cost]) => (at > previousDay && at <= day ? sum + cost : sum), 0);
  const claudeCost = spent(costs.claude);
  /**
   * 区間のPRが動かした行（追加＋削除）。**行数の列の増分（純増）とは別物**——書き直しと削除は
   * 純増に現れないが、掛かったコストは同じ。値段を割る分母はこちら。
   */
  const changedLines = diffs.reduce((sum, diff) => sum + diff.lines, 0);
  return {
    day,
    // 区間の始まりの日（この日を含む）。区間の量を図のどこへ置くかは、ここと `day` で決まる。
    from,
    counts: LINE_COLUMNS.map((column) => lineCount(revision, column.pathspecs)),
    issues: issueCountAt(day),
    pullRequests: merged.length,
    claudeCost,
    copilotCost: spent(costs.copilot),
    changedLines,
    claudeCostPerThousandLines: changedLines === 0 ? null : (1000 * claudeCost) / changedLines,
    // 区間にPRが1本も無い日は平均が定義できない。0で埋めると「小さいPRが並んだ」と読めてしまう。
    claudeCostPerPullRequest: diffs.length === 0 ? null : claudeCost / diffs.length,
    filesPerPullRequest: diffs.length === 0 ? null : mean((diff) => diff.files),
    linesPerPullRequest: diffs.length === 0 ? null : mean((diff) => diff.lines),
    bothSidesShare: diffs.length === 0 ? null : mean((diff) => (diff.bothSides ? 1 : 0)),
  };
}

function toRow(measurement) {
  const size =
    measurement.linesPerPullRequest === null
      ? '-'
      : `${measurement.filesPerPullRequest.toFixed(1)}ファイル / ${Math.round(measurement.linesPerPullRequest).toLocaleString('en-US')}行`;
  const dollars = (value) => `$${Math.round(value).toLocaleString('en-US')}`;
  // 千行あたりだけが欠けるのは、PRは在るのに動いた行が0のとき（全部バイナリ）。
  const perThousandLines =
    measurement.claudeCostPerThousandLines === null
      ? ''
      : `・千行 $${measurement.claudeCostPerThousandLines.toFixed(1)}`;
  const cost =
    measurement.claudeCostPerPullRequest === null
      ? dollars(measurement.claudeCost)
      : `${dollars(measurement.claudeCost)}（1本 $${measurement.claudeCostPerPullRequest.toFixed(1)}${perThousandLines}）`;
  return [
    measurement.day.slice(5),
    ...measurement.counts.map((count) => count.toLocaleString('en-US')),
    measurement.issues === null ? '-' : measurement.issues.toLocaleString('en-US'),
    measurement.pullRequests.toLocaleString('en-US'),
    size,
    measurement.changedLines.toLocaleString('en-US'),
    cost,
    measurement.bothSidesShare === null ? '-' : `${Math.round(100 * measurement.bothSidesShare)}%`,
  ];
}

/**
 * 貼り込む図。ファイル名は参照する文書の名前を頭に付ける（`docs/ui/StartScreen_*.png` と同じ形）。
 * 桁の違う量は同じ枠へ重ねないので、1枚あたりのパネル数は中身で決まる。
 */
function chartsOf(measurements, rolling) {
  const days = measurements.map((measurement) => measurement.day);
  // 区間の量は区間の真ん中へ置く（`middleDay`）。時点の量だけが区切りの日に乗る。
  const middles = measurements.map((measurement) => middleDay(measurement.from, measurement.day));
  const series = (name, pick) => ({ name, values: measurements.map(pick) });
  /** 移動窓の段。値が定義できない日は、0で埋めずにその段から落とす。 */
  const window = (label, pick) => {
    const rows = rolling.filter((row) => pick(row) !== null);
    return { label, days: rows.map((row) => row.day), series: [{ name: 'コスト', values: rows.map(pick) }] };
  };
  const charts = [
    {
      file: 'HowWeGotHere_lines.svg',
      title: '行数の推移',
      days,
      panels: [
        {
          label: '行数',
          series: LINE_COLUMNS.map((column, index) =>
            series(column.header, (measurement) => measurement.counts[index]),
          ),
        },
      ],
    },
    {
      file: 'HowWeGotHere_pr_size.svg',
      title: 'PR1本あたりの大きさ',
      days,
      panels: [
        {
          label: '変更行数',
          days: middles,
          series: [series('1PRあたり', (m) => m.linesPerPullRequest ?? 0)],
        },
        {
          label: 'ファイル数',
          days: middles,
          series: [series('1PRあたり', (m) => m.filesPerPullRequest ?? 0)],
        },
      ],
    },
  ];

  // 桁が2つ違うので、Claude と Copilot は同じ枠へ重ねずに段を分ける。
  // **総額ではなく1日あたり**——区間の長さが揃っていないと、総額の上下は使ったペースではなく
  // 区間の長さを描くことになる。
  charts.push({
    file: 'HowWeGotHere_cost.svg',
    title: `AIに払った額（ドル・${WINDOW_DAYS}日の移動窓）`,
    days: rolling.map((row) => row.day),
    panels: [
      window('Claude・1日あたり', (row) => row.claudePerDay),
      window('Copilot・1日あたり', (row) => row.copilotPerDay),
      window('Claude・PR1本あたり', (row) => row.claudePerPullRequest),
      // PRの粒は期を通じて変わるので、1本あたりだけでは値段と粒度が混ざる。
      window('Claude・変更1千行あたり', (row) => row.claudePerThousandLines),
    ],
  });

  // issue が引けなかった実行では、PRだけの図にならないよう1枚まるごと落とす。
  if (measurements.every((measurement) => measurement.issues !== null)) {
    charts.push({
      file: 'HowWeGotHere_issues_prs.svg',
      title: 'issue と PR の累計',
      days,
      panels: [
        {
          label: '累計',
          series: [
            series('issue（立てた）', (m) => m.issues),
            series('PR（mainへ入った）', (m) => m.pullRequests),
          ],
        },
      ],
    });
  }
  return charts;
}

requireFullHistory();

const argv = process.argv.slice(2);
const svgIndex = argv.indexOf('--svg');
const svgDirectory = svgIndex === -1 ? null : argv[svgIndex + 1];
if (svgIndex !== -1 && (svgDirectory === undefined || svgDirectory.startsWith('-'))) {
  console.error('--svg には書き出し先のディレクトリが要ります。');
  process.exit(1);
}

const days = svgIndex === -1 ? argv : [...argv.slice(0, svgIndex), ...argv.slice(svgIndex + 2)];
const targets = days.length > 0 ? days : defaultDays();
for (const day of targets) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error(`日付は YYYY-MM-DD で指定してください: ${day}`);
    process.exit(1);
  }
}

const pullRequests = mergedPullRequests();
const costs = costByDay();
const measurements = [];
// 最初の区間の始まりは、`main` へ最初のPRが入った日。以降は前の区切りの翌日。
const firstDay = pullRequests[0]?.day ?? targets[0];
let previousDay = '';
for (const day of targets) {
  measurements.push(
    measureAt(
      day,
      previousDay,
      previousDay === '' ? firstDay : shiftDay(previousDay, 1),
      pullRequests,
      costs,
    ),
  );
  previousDay = day;
}

if (measurements.length === 0) {
  console.error('行が1つも出なかった。日付の指定か履歴の深さを確認してください。');
  process.exit(1);
}

console.log(formatTable(measurements.map(toRow)));

if (svgDirectory !== null) {
  mkdirSync(svgDirectory, { recursive: true });
  const rolling = rollingSeries(
    dailyTotals(pullRequests, costs, firstDay, measurements[measurements.length - 1].day),
  );
  for (const chart of chartsOf(measurements, rolling)) {
    const path = join(svgDirectory, chart.file);
    writeFileSync(path, lineChart(chart));
    console.error(`書き出した: ${path}`);
  }
}
