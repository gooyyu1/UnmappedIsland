// GitHub と CCR から盤面を1つ組み立てる。**判断は1つも持たない**——ここが集めた形を読んで手を
// 決めるのは [`board-move.mjs`](board-move.mjs)（`.claude/board-design.md` 2.3）。
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

import { liveSessions } from './live-sessions.mjs';
import { gh as runGh } from './spawn.mjs';

/** PRの一覧に要る項目。**1回で引く**——項目ごとに引くと、項目ごとに見ている時点がずれる。 */
const PR_FIELDS =
  'number,isDraft,labels,mergeable,statusCheckRollup,updatedAt,headRefOid,baseRefName,body,files';

/**
 * 差し戻す相手は、そのPRのコミットの `Claude-Session:` トレーラで引く（2.11）。**上の一覧には
 * 混ぜられない**——`gh pr list --json commits` はPRごとに全コミットを取りに行き、GraphQL の
 * ノード数の上限（50万）を超えて何も返らなくなる。末尾の何本かだけを指名すれば1回で足りる。
 */
const PR_SESSIONS_QUERY =
  'query($owner:String!,$name:String!){repository(owner:$owner,name:$name)' +
  '{pullRequests(states:OPEN,first:50){nodes{number commits(last:20){nodes{commit{message}}}}}}}';

/** この時刻より前に止まっているPRは、チェックが0本でも緑と読む。 */
function settledBefore(now, settleMinutes) {
  const at = new Date(now.getTime() - settleMinutes * 60_000);
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
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
export function readBoard({ gh = runGh, sessions = liveSessions, log, now, settleMinutes, taken }) {
  const prs = gh(['pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_FIELDS]);
  if (prs === undefined) return undefined;
  const issues = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,labels,blockedBy',
  ]);
  if (issues === undefined) return undefined;
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

  const openIssues = JSON.parse(issues);
  return {
    settledBefore: settledBefore(now, settleMinutes),
    mainChecks: mainChecks(checks),
    prs: JSON.parse(prs),
    issues: openIssues,
    taken,
    issueStates: issueStates(gh, live, openIssues),
    prSessions: raw === undefined ? {} : prSessions(raw),
    sessions: live,
  };
}
