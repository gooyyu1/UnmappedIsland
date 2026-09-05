// 司令塔の盤面を1回で出す。**ユーザーの答え待ち・開いているPR・開いている task issue・棚卸しの
// 済んでいない issue・畳んでいないセッション**を、突き合わせた形で並べる。入口は
// [`board.sh`](board.sh)。
//
// ## 往復を減らすためだけの道具ではない
//
// 手で引くと `gh pr list` と `gh issue list` の2回で済むので、つい**依存を引き忘れる**。
// `blockedBy` は issue 1件につき1回の `gh api` が要るぶん省かれやすく、**塞いでいた issue が閉じても
// 誰も気づかない**——着手できるようになった仕事が、次に誰かが思い出すまで止まる。ここでは必ず引く。
//
// 同じ理由で、issue に**もう投入済みか**も出す。判断材料が1つの表に載っていないと、二重に投入する
// （2つのセッションが同じ issue で別々のPRを出す）。
//
// 出るのは次の節。
//
//   ## 確定待ち <番号> <項目>
//   ## PR      <番号> <CI> <マージ可否> <base> <ラベル> <題>
//   ## TASK    <番号> <着手できるか> <題>
//   ## 未整理  <番号> <ラベル> <題>
//   ## 走行    <セッションID> <状態> <最終更新> <題>
//
// ## `確定待ち` を盤面に出すのは、引き継いだ司令塔が最初に読む場所だから
//
// ユーザーの答えは `meta` の issue の本文にチェックとして付き、**拾われるまでそこに残る。**
// 判定は [`checked-items.sh`](checked-items.sh) が持つ。
//
// **[`daemon.sh`](daemon.sh) はここを読まない**（判断が要るので、届ける口はまだ無い）。だから
// **誰かが自分から訊きに来ないと、答えは拾われないまま残る。** 盤面は、その訊きに来る側の道具。
//
// 拾ったら、答えの行き先を `## 下ろした項目` に書いてから一覧から消す（CLAUDE.md）。**`【確定】` の
// 印が付くのは待たない**——印を付けるのは答えを受けた issue の担当者で、待つと司令塔の手番が終わった
// のに一覧が残る。消すまで毎回ここに出続けるのが正しい——**消し忘れは、次の司令塔にも見える。**
//
// `TASK` の状態は次のどれか。
//   返却       … ワーカーが人へ返した（`判断待ち`。2.15）。人が外すまで配られない
//   投入済み   … 走行中のセッションか、開いているPRの `Closes` に載っている
//   待ち:#N    … `blockedBy` の #N がまだ開いている
//   着手可     … どれでもない＝今すぐ投入してよい
//
// ## `未整理` は、人間が書いたまま投入できない issue
//
// ユーザーが立てる issue は自分の言葉で書かれていて、担当も完了条件も無い。**そのまま `task` を
// 付けて投入すると、PRの範囲が宣言されていない**ので、司令塔は範囲外へ伸びたかを機械的に判定できず、
// 全部が判断待ちに落ちる。**投入の前に棚卸しで翻訳する**
// （[`parallel-work.md`](../../.claude/parallel-work.md)「人間が立てた issue は、投入する前に
// 棚卸しで task へ翻訳する」）。
//
// ここに出るのは `task` も `meta` も付いておらず、**依存も張られていない** open な issue。
// `meta` は常設の盤（#656 の確定待ち・手綱）で、投入する先が無いので棚卸しの対象でもない。
// **どれが翻訳の要る issue かは判定しない**——並べるところまでが機械の仕事で、まとめ方も分け方も
// モデルが決める。
//
// **依存が張ってあるものを外すのは、それが棚卸しの結論そのものだから。** 分解した親（子が全部
// 片付いたら閉じる入口）と、別の issue へ束ねた側は、どちらも `task` にはならないが翻訳は済んで
// いる。外さないと毎回ここへ並び、**次の司令塔が「まだ棚卸ししていない」と読んで投入し直す。**

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listSessions } from './live-sessions.mjs';
import { gh as runGh, runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 一覧を1ページだけ引く。**上限に当たったら黙らない**——一覧は新しい順なので、切れるのは古い側で、
 * 畳み忘れて残っているセッションはまさにそこに居る。出ないことを「無い」と読むと、永久に畳まれない。
 *
 * **繰らないのは、ここが人の求めに応じて1回動く道具だから。** 1ページで足りない日は稀で、その日は
 * 上の断りが出る。毎回全部繰ると、そのぶんプロセスが増える（[`spawn.mjs`](spawn.mjs)）。
 */
const SESSION_LIMIT = 100;

/** `baseRefName` を引くのは、**`main` の上に無いPRは盤面では捌けない**から（`board-move.mjs`）。 */
const PR_FIELDS = 'number,title,labels,statusCheckRollup,mergeable,baseRefName,body';

const names = (item) => (item.labels ?? []).map((label) => label.name);
const labelColumn = (item) => ((item.labels ?? []).length === 0 ? '-' : names(item).join(','));
const blockers = (issue) => (issue.blockedBy?.nodes ?? []).filter((node) => node.state === 'OPEN');

/** チェックの色。`board-move.mjs` と同じ判定だが、**人へ見せる語**なのでここが持つ。 */
function checks(pr) {
  const roll = pr.statusCheckRollup ?? [];
  if (roll.length === 0) return 'チェック無';
  if (roll.some((check) => check.status !== 'COMPLETED')) return '実行中';
  const ok = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  return roll.every((check) => ok.has(check.conclusion)) ? '緑' : '赤';
}

/**
 * 盤面の行を上から順に返す。**PRか issue を引けなければ `undefined`**——欠けたまま並べると、
 * 消えたPRが「無い」ものとして読まれる（理由は `gh` が自分で言っている）。
 */
export function board({ gh = runGh, page = listSessions, checkedItems = runCheckedItems, warn }) {
  const prsRaw = gh(['pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_FIELDS]);
  // issue は1回だけ引いて、`task` の付いたもの・まだどこにも分類されていないもの・`meta` の本文の
  // チェックへ分ける。**依存も同じ呼び出しで返る**ので、issue 1件ずつ `gh api` を叩かなくてよい。
  const issuesRaw = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,labels,blockedBy,body',
  ]);
  if (prsRaw === undefined || issuesRaw === undefined) return undefined;
  const prs = JSON.parse(prsRaw);
  const issues = JSON.parse(issuesRaw);

  const lines = ['## 確定待ち'];
  const checked = checkedItems(issuesRaw)
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => `確定待ち ${line}`);
  lines.push(...(checked.length === 0 ? ['（無し）'] : checked));

  lines.push('## PR');
  for (const pr of prs) {
    const base = pr.baseRefName ?? 'main';
    lines.push(`PR ${pr.number} ${checks(pr)} ${pr.mergeable} ${base} ${labelColumn(pr)} ${pr.title}`);
  }

  // 走行中（畳んでいない）セッション。ここが「もう投入したか」の主な根拠。
  const answer = page({ mine: true, limit: SESSION_LIMIT });
  if (answer === undefined) warn('（セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）');
  const all = answer?.ccr?.data ?? [];
  if (all.length === SESSION_LIMIT) {
    warn(`（一覧が上限 ${SESSION_LIMIT} に当たった。これより古いセッションは見えていない）`);
  }
  const live = all
    .filter((session) => session.session_status !== 'SESSION_STATUS_ARCHIVED')
    .map((session) => ({
      id: session.id,
      status: (session.session_status ?? '').replace('SESSION_STATUS_', ''),
      updated: session.updated_at,
      title: session.title ?? '',
    }));

  // 投入済みの印になる issue 番号。**走行中セッションの題の `(#N)` と、開いているPRの `Closes #N`。**
  const dispatched = new Set();
  for (const session of live) {
    for (const match of session.title.matchAll(/\(#(\d+)\)/g)) dispatched.add(match[1]);
  }
  for (const pr of prs) {
    for (const match of (pr.body ?? '').matchAll(/closes\s+#(\d+)/gi)) dispatched.add(match[1]);
  }

  lines.push('## TASK');
  for (const issue of issues.filter((item) => names(item).includes('task'))) {
    const blocker = blockers(issue)[0];
    const state = names(issue).includes('判断待ち')
      ? '返却'
      : dispatched.has(String(issue.number))
        ? '投入済み'
        : blocker === undefined
          ? '着手可'
          : `待ち:#${blocker.number}`;
    lines.push(`TASK ${issue.number} ${state} ${issue.title}`);
  }

  lines.push('## 未整理');
  const unsorted = issues
    .filter((issue) => !names(issue).includes('task') && !names(issue).includes('meta'))
    .filter((issue) => blockers(issue).length === 0)
    .map((issue) => `未整理 ${issue.number} ${labelColumn(issue)} ${issue.title}`);
  lines.push(...(unsorted.length === 0 ? ['（無し）'] : unsorted));

  lines.push('## 走行');
  const running = live.map(
    (session) => `走行 ${session.id} ${session.status} ${session.updated} ${session.title}`,
  );
  lines.push(...(running.length === 0 ? ['（無し）'] : running));

  return lines;
}

/** チェックの付いた項目の判定は [`checked-items.sh`](checked-items.sh) が持つ。 */
function runCheckedItems(issuesJson) {
  return runBash(join(HERE, 'checked-items.sh'), [], { input: issuesJson, capture: true }).stdout;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = board({ warn: (line) => console.error(line) });
  if (lines === undefined) process.exit(1);
  process.stdout.write(`${lines.join('\n')}\n`);
}
