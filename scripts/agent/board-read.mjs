// GitHub と CCR、それにリポジトリ自身から盤面を1つ組み立てる。**判断は1つも持たない**——ここが
// 集めた形を読んで手を決めるのは [`board-move.mjs`](board-move.mjs)（`.claude/board-design.md` 2.3）。
//
//   import { readBoard } from './board-read.mjs';
//   readBoard({ log })   // → 盤面（`gh` が引けなければ undefined）
//
// 出す形は `board-move.mjs` の冒頭にある。
//
// ## 引けなかったら、欠けたまま返さない
//
// `gh` が失敗した周は盤面が欠けているので、**欠けたまま手を決めない**（消えたPRを「無い」と読むと、
// レビューを二重に立てる）。返すのは `undefined` で、呼び手はその周を捨てる。**例外にしないのは、
// 引けないことが普通に起きるから**——認証切れも通信断も、手を打たない理由としては同じ。
// 一覧（[`live-sessions.mjs`](live-sessions.mjs)）だけは投げてくるので、**受けるのは呼び手**
// ——理由を言える者が向こうにしか居ないぶん、言葉を持ったまま上がる。
//
// ## 外から渡すのは、外部を触る手だけ
//
// `gh` と一覧の引き方を引数で受けるのは、**実物を起こさずに検査するため**。既定は本物を呼ぶので、
// 呼び手（[`board-round.mjs`](board-round.mjs)）は何も渡さなくてよい。

import { readdirSync } from 'node:fs';

import { liveSessions } from './live-sessions.mjs';
import { gh as runGh } from './spawn.mjs';

/**
 * **盤面が GitHub と CCR の外を見るのは、この2つの置き場だけ。** どちらも、その係の仕事が
 * issue にもPRにも現れず**リポジトリの中にしか無い**ので、ここで数える以外に「仕事があるか」を
 * 知る手立てが無い。
 *
 * - `DECISIONS` … 判断の履歴（`CLAUDE.md`「価値観の記録」）。読むのは価値観を畳む係の `due`。
 * - `ANALYSES` / `ANALYSIS_SUMMARIES` … 一次の分析係が回ごとに書く記録と、二次が横断してまとめた
 *   記録（`.claude/board-design.md` 2.17.4）。読むのは回をまたぐ形を見る係の `due`。
 */
const DECISIONS = new URL('../../.claude/decisions/', import.meta.url);
const ANALYSES = new URL('../../.claude/analysis/', import.meta.url);
const ANALYSIS_SUMMARIES = new URL('summary/', ANALYSES);

/** PRの一覧に要る項目。**1回で引く**——項目ごとに引くと、項目ごとに見ている時点がずれる。 */
const PR_FIELDS =
  'number,isDraft,labels,mergeable,statusCheckRollup,updatedAt,headRefOid,baseRefName,body,files,comments';

/**
 * マージ済みPRから引く項目。**読むのは後片付けの手**（[`board-move.mjs`](board-move.mjs) の `TIDY`）
 * **とスメルを拾う係の `due`**（同 `CYCLES`）で、要るのは番号とコメントだけ——上の一覧には
 * 混ぜられない（あちらは開いているPRで、後片付けもスメルもマージ後だから）。
 */
const MERGED_PR_FIELDS = 'number,comments';

/**
 * さかのぼるマージ済みPRの幅（時間）。**後片付けが追える幅でもある**——デーモンがこれより長く
 * 止まっていた間に入ったPRは、窓から出るので後片付けが走らない（[`board-move.mjs`](board-move.mjs)
 * の `TIDY`）。**本数ではなく期間で持つ。** 本数は、1本あたりに掛かる
 * 時間が変われば覆う期間も変わるので、係の間隔ぶんに入る本数を下回った瞬間、**拾われないまま窓から
 * 出るスメルが出る**——30本で1日を覆うつもりだったものが、実測（2026-09-07）では15時間ぶんしか
 * なく、#1659〜#1740 が一度も読まれずに落ちた。期間で持てば、その間に何本入っても落ちない。
 *
 * **係の間隔**（[`board-move.mjs`](board-move.mjs) の `CYCLES` の `analysis` の `hours`）**より
 * 広く取る。** 同じ幅を [`analysis-prompt.md`](../../.claude/analysis-prompt.md)「読む範囲」が係へも渡す
 * ——**盤面より係の窓が狭いと、盤面が見つけた未読が係の窓の外に落ち**、印が付かないので
 * **毎日立って毎日同じ空振りを繰り返す。**
 */
export const MERGED_WINDOW_HOURS = 48;

/**
 * 1回で引く一覧の上限。**当たった周の盤面は全部を見ていない**ので、`capped` が黙って切らずに言う。
 *
 * マージ済みPRのぶんは**窓の幅ではなく、引きすぎを止める栓**——1周は30秒なので
 * （[`daemon.sh`](daemon.sh) の `INTERVAL`）、窓に入る本数がそのまま毎周の重さになる。
 * 実測（2026-09-10）では48時間ぶんが6本、**いちばん流量の多かった48時間**（2026-09-05T12:00Z
 * からの2日）で117本。普段は本数で切っていたころより軽く、混んだ日だけ重い。
 *
 * 開いている issue のぶんは**古い側から消える**——`gh issue list` が並べるのは作成の新しい順なので、
 * 上限に当たると**いちばん古い issue から盤面の外へ出る。** 2026-09-11T17:20Z に100件へ当たり、
 * 走っているワーカーが担当する #1722 が盤面から消えた（常設の盤の「投入済み」からも落ちた）。
 * 繰る・条件で絞るといった形にするのは #1844 の仕事で、ここは**実数が届かない高さ**に置いてある。
 */
const CAPS = { openPrs: 50, issues: 300, mergedPrs: 200 };

/** 検査から見える上限（マージ済みPRのぶん）。 */
export const MERGED_CAP = CAPS.mergedPrs;

/**
 * 開いている issue のぶん。**常設の盤を書く側**（[`board.mjs`](board.mjs)）**も同じ値で引く**
 * ——別々に持つと、盤面には載っているのに人の読む窓からだけ消える帯ができる。
 */
export const ISSUE_CAP = CAPS.issues;

/**
 * 上限に当たったら言う。**黙って切ると、切られた側は盤面から消える**——「1件も無い」と同じ形に
 * なるので、次の周も、その次の周も同じに読む。
 */
function capped(log, what, items, cap) {
  if (items.length >= cap) log(`${what}が上限（${cap}件）に達した（この周の盤面は全部を見ていない）`);
  return items;
}

/**
 * 差し戻す相手は、そのPRのコミットの `Claude-Session:` トレーラで引く（2.11）。**上の一覧には
 * 混ぜられない**——`gh pr list --json commits` はPRごとに全コミットを取りに行き、GraphQL の
 * ノード数の上限（50万）を超えて何も返らなくなる。末尾の何本かだけを指名すれば1回で足りる。
 */
const PR_SESSIONS_QUERY =
  'query($owner:String!,$name:String!){repository(owner:$owner,name:$name)' +
  // **本数は開いているPRの一覧と同じ。** 別々に持つと、片方だけが届く帯ができる。
  `{pullRequests(states:OPEN,first:${CAPS.openPrs}){nodes{number commits(last:20){nodes{commit{message}}}}}}}`;

/**
 * まだ棚卸しを通っていない判断の履歴の件数（`archive/` に入っていないもの）。**読むのは価値観を
 * 畳む係の `due`**（[`board-move.mjs`](board-move.mjs) の `CYCLES`）。
 *
 * **読めなかった周は0にして進む。** その周に係が立たないだけで、他の手は打てる。
 */
function countDecisions(log) {
  try {
    return readdirSync(DECISIONS).filter((name) => name.endsWith('.md')).length;
  } catch {
    log('判断の履歴を数えられなかった（この周は、価値観を畳む係を立てない）');
    return 0;
  }
}

/**
 * まだ二次が読んでいない、一次の分析の記録の件数。**読むのは回をまたぐ形を見る係の `due`**
 * （[`board-move.mjs`](board-move.mjs) の `CYCLES`）。
 *
 * **一次のファイルに処理済みの印を持たせない**（`.claude/board-design.md` 2.17.4）——印を持たせると、
 * 一次に二次の都合が入る。代わりに**二次が最後に書いた日付より後の一次のファイルを数える**
 * （どちらも `<YYYY-MM-DD>` で始まるので、文字列の大小がそのまま日付の前後になる）。
 *
 * **粒が日なので、二次が書いた後に同じ日の一次が入ると、その1件は引き金にならない。** 割り切って
 * いる——**中身は落ちない**（二次は次の周に `.claude/analysis/` を読み直し、読む範囲を自分で決める）
 * ので、失うのは引き金1回ぶん。日より細かい印を持たせると、一次のファイルへ二次の都合を書くことに
 * なり、上の一点を崩す。
 *
 * **読めなかった周は0にして進む。** その周に係が立たないだけで、他の手は打てる。
 *
 * **置き場を引数で受けるのは、実物を起こさずに検査するため**（このファイルの冒頭）。日付の比較と
 * 「二次がまだ一度も書いていない」の分岐を持つので、**実物のディレクトリの今の中身で通すと、
 * 二次が1回書いた日から検査の意味が変わる。**
 */
export function countUnsummarizedAnalyses(log, { analyses = ANALYSES, summaries = ANALYSIS_SUMMARIES } = {}) {
  const days = (dir) => {
    const named = /^(\d{4}-\d{2}-\d{2})/;
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => named.exec(name)?.[1])
      .filter((day) => day !== undefined);
  };
  let written;
  try {
    written = days(analyses);
  } catch {
    log('分析の記録を数えられなかった（この周は、回をまたぐ形を見る係を立てない）');
    return 0;
  }
  // **二次がまだ一度も書いていない周は、置き場そのものが無い。** そこを読めない扱いにすると係が
  // 永久に立たないので、**一次の記録が全部そのまま未処理**として返す。
  let summarized;
  try {
    summarized = days(summaries).sort().at(-1);
  } catch {
    return written.length;
  }
  return written.filter((day) => summarized === undefined || day > summarized).length;
}

/** `now` からさかのぼった時刻。比べる相手（PRの `updatedAt`・GitHubの検索）と同じ形で書く。 */
function isoBefore(now, ms) {
  return new Date(now.getTime() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** この時刻より前に止まっているPRは、チェックが0本でも緑と読む。 */
function settledBefore(now, settleMinutes) {
  return isoBefore(now, settleMinutes * 60_000);
}

/**
 * `main` の先頭のCI。**赤い間は差し戻しを打たない**（`board-move.mjs`、`board-design.md` 2.14）。
 * 語彙をPRの `statusCheckRollup` に合わせて渡すので、向こうは1つの判定で両方を読める。
 */
function mainChecks(raw) {
  return (JSON.parse(raw).check_runs ?? []).map((run) => ({
    status: (run.status ?? '').toUpperCase(),
    conclusion: (run.conclusion ?? '').toUpperCase(),
  }));
}

/** PR番号 → そのPRを書いたセッション。**拾うのは、トレーラを持つ最後のコミット**（手が変われば新しいほうが今の書き手）。 */
function prSessions(raw) {
  const found = {};
  for (const node of JSON.parse(raw).data?.repository?.pullRequests?.nodes ?? []) {
    const ids = (node.commits?.nodes ?? [])
      .flatMap((commit) => (commit.commit?.message ?? '').split(/\r?\n/))
      .filter((line) => line.startsWith('Claude-Session:'))
      .map((line) => line.split('/').at(-1));
    const id = ids.at(-1);
    if (id !== undefined) found[String(node.number)] = id;
  }
  return found;
}

/**
 * ワーカーを畳んでよいかは、担当の issue の側で決まる（2.10）。**探すのはセッションの側から**
 * ——閉じた issue の一覧は増える一方で、畳む相手はそこには居ない。開いている一覧に載っている
 * ぶんは引かないので、引くのは**行き先が消えたタグの数**だけ（普通は0）。
 *
 * ここが答えるのは**閉じたかどうかだけ**。開いたまま人の手番へ移った issue（`判断待ち`）は
 * 開いている一覧の側に載っているので、そちらのラベルで見る（2.10.2）。
 *
 * 引けなかったものは書かない。**知らないことを「閉じた」として読まない**——畳んだ判定は戻せる
 * とはいえ、次の周にもう一度引ける。
 */
function issueStates(gh, sessions, issues) {
  const open = new Set(issues.map((issue) => issue.number));
  const held = new Set();
  for (const session of sessions) {
    for (const tag of session.tags) {
      const match = /^task-(\d+)$/.exec(tag);
      if (match !== null && !open.has(Number(match[1]))) held.add(match[1]);
    }
  }

  const states = {};
  for (const number of [...held].sort()) {
    const state = gh(['issue', 'view', number, '--json', 'state', '--jq', '.state'], { allowFail: true });
    if (state !== undefined) states[number] = state.trim();
  }
  return states;
}

/** 盤面を1つ組み立てる。`gh` が引けなければ `undefined`、一覧が引けなければ投げる。 */
export function readBoard({
  gh = runGh,
  sessions = liveSessions,
  log,
  pendingDecisions = () => countDecisions(log),
  unsummarizedAnalyses = () => countUnsummarizedAnalyses(log),
  now,
  settleMinutes,
  taken,
}) {
  const prs = gh(['pr', 'list', '--state', 'open', '--limit', String(CAPS.openPrs), '--json', PR_FIELDS]);
  if (prs === undefined) return undefined;
  const issues = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--limit',
    String(CAPS.issues),
    '--json',
    'number,labels,blockedBy',
  ]);
  if (issues === undefined) return undefined;
  // **引けなくても盤面は捨てない。** 欠けた周は後片付けと周期の係が出ないだけで済む——必須に
  // すると、**マージもレビューも投入も1周まるごと止まる。**
  // **黙って空にしない**（下の差し戻す相手と同じ理由。空は「1件も無い」と同じ形になる）。
  const mergedRaw = gh(
    [
      'pr',
      'list',
      '--state',
      'merged',
      // **絞るのはマージされた時刻。** `gh pr list` が並べるのは作成日なので、本数で切ると、
      // **長く開いていたPRはマージされる頃には窓の外に居る**（`判断待ち` で人の手番へ移ったPRは
      // 1周から数周遅れて入る）。マージで絞れば、入った順のとおりに窓へ載る。
      '--search',
      `merged:>=${isoBefore(now, MERGED_WINDOW_HOURS * 3_600_000)}`,
      '--limit',
      String(CAPS.mergedPrs),
      '--json',
      MERGED_PR_FIELDS,
    ],
    { allowFail: true },
  );
  if (mergedRaw === undefined) {
    log('マージ済みPRを引けなかった（この周は、後片付けもスメルを拾う係も出ない）');
  }
  const mergedPrs = capped(
    log,
    'マージ済みPR',
    mergedRaw === undefined ? [] : JSON.parse(mergedRaw),
    CAPS.mergedPrs,
  );
  const checks = gh(['api', 'repos/{owner}/{repo}/commits/main/check-runs']);
  if (checks === undefined) return undefined;

  // **引けなかった周は空にして進む。** 差し戻す相手が分からないだけで、他の手は打てる
  // （`board-move.mjs` が覚え書きを出す）。**黙って空にしない**——空は「名乗っていない」と同じ形
  // なので、この周の覚え書きは名乗り忘れと見分けが付かない。
  const raw = gh(
    ['api', 'graphql', '-f', `query=${PR_SESSIONS_QUERY}`, '-F', 'owner={owner}', '-F', 'name={repo}'],
    { allowFail: true },
  );
  if (raw === undefined) log('差し戻す相手を引けなかった（この周の「名乗っていない」は当てにならない）');

  // **一覧を引けなかったら投げる**（[`live-sessions.mjs`](live-sessions.mjs)）。受けるのは呼び手で、
  // ここでも受けると、次に足す失敗をどちらへ載せるかが決まらなくなる。
  const live = sessions();

  const openIssues = capped(log, '開いている issue', JSON.parse(issues), CAPS.issues);
  const openPrs = capped(log, '開いているPR', JSON.parse(prs), CAPS.openPrs);
  return {
    // **手が空いてからの長さを測るのに要る**（`board-move.mjs` の `STALL_MINUTES`）。この周の
    // 時刻は1つで、比べる相手（台帳の `idle:`）も同じ形で書く。
    now: now.toISOString(),
    settledBefore: settledBefore(now, settleMinutes),
    mainChecks: mainChecks(checks),
    prs: openPrs,
    mergedPrs,
    pendingDecisions: pendingDecisions(),
    unsummarizedAnalyses: unsummarizedAnalyses(),
    issues: openIssues,
    taken,
    issueStates: issueStates(gh, live, openIssues),
    prSessions: raw === undefined ? {} : prSessions(raw),
    sessions: live,
  };
}
