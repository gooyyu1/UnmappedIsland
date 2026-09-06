// 盤面を1回で出す。**ユーザーの答え待ち・開いているPR・開いている task issue・棚卸しの
// 済んでいない issue・畳んでいないセッション**を、突き合わせた形で並べる。
//
// 出口は2つある。**突き合わせるのは1箇所**（`survey`）で、違うのは並べ方だけ——片方だけが違う
// 盤面を見せることにならない。
//
//   [`board.sh`](board.sh)               … 端末へ1回。1行1件（読むのは、セッションを立てられる者）
//   [`board-publish.mjs`](board-publish.mjs) … 常設の issue の本文へ周期で（読むのはスマホの人間。
//                                             `.claude/board-design.md` 2.20）
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
// 端末へ出るのは次の節。
//
//   ## 確定待ち <番号> <項目>
//   ## PR      <番号> <CI> <マージ可否> <base> <ラベル> <題>
//   ## TASK    <番号> <着手できるか> <題>
//   ## 未整理  <番号> <ラベル> <題>
//   ## 走行    <セッションID> <状態> <走っている場所> <タグ>
//
// ## セッションの一覧は、デーモンと同じ引き方で引く
//
// [`live-sessions.mjs`](live-sessions.mjs) を通す——**生きたものが尽きるまで繰る**ので、固まった
// まま直近のページから外れたセッションも見える。**ここだけ1ページで済ませると、盤面が「居ない」と
// 言う相手をデーモンは掴んでいる**ことになり、読んだ人は投入してよいと読む。
//
// ## `確定待ち` を盤面に出すのは、訊きに来る側にしか届かないから
//
// ユーザーの答えは `kind:meta` の issue の本文にチェックとして付き、**拾われるまでそこに残る。**
// 判定は [`checked-items.sh`](checked-items.sh) が持つ。
//
// **[`daemon.sh`](daemon.sh) はここを読まない**（判断が要るので、届ける口はまだ無い）。だから
// **誰かが自分から訊きに来ないと、答えは拾われないまま残る。** 盤面は、その訊きに来る側の道具。
//
// 拾ったら、答えの行き先を `## 下ろした項目` に書いてから一覧から消す（CLAUDE.md）。**`【確定】` の
// 印が付くのは待たない**——印を付けるのは答えを受けた issue の担当者で、待つと答えを下ろした後も
// 一覧に残る。消すまで毎回ここに出続けるのが正しい——**消し忘れは、次に見に来た者にも見える。**
//
// ## task issue には、軸が2つある
//
// **配ってよいか**（`state`）は次のどれか。
//   返却       … ワーカーが人へ返した（`判断待ち`。2.15）。人が外すまで配られない
//   投入済み   … `task-<番号>` のセッションが生きているか、開いているPRの `Closes` に載っている
//   待ち:#N    … `blockedBy` の #N がまだ開いている
//   着手可     … どれでもない＝今すぐ投入してよい
//
// **投入した先で何が起きているか**（`progress`）は、`投入済み` のものにだけ在る。
//   作業中     … `task-<番号>` のセッションが走っている
//   レビュー中 … そのPRの `review-<PR番号>` が走っている
//   手空き     … セッションは畳まれていないが、手は動いていない
//   担当無し   … `task-<番号>` のセッションがもう居ない（開いているPRだけが残っている）
//
// **両方走っていれば両方出す。** どちらかへ丸めると、起きていることの片方が消える。
//
// **投入済みかをセッションの題では見ない。** 題の形（`作業 #<番号> <題>`）を持つのは 2.9 で、
// 機械の見分けはタグ（`task-<番号>`）——両方を見る規約にすると、題の形が変わったときに黙って
// 外れる。
//
// 状態の後ろに `env:<値>` が出るものは、**そこで走らせる指定が付いている**（2.16）。無いものは
// クラウド。
//
// ## `未整理` は、棚卸しがまだ見ていない issue
//
// **`kind:` のラベルを1つも持たない open な issue**（`.claude/board-design.md` 2.17.1）。分類は
// 棚卸しが付けるので、持っていないことがそのまま「まだ見ていない」を指す。
//
// **`kind:task` も `kind:meta` も付いていない、という否定の列挙では表さない。** 出口が増えるたびに条件を
// 書き換えることになり、書き忘れた出口の issue が毎周また並ぶ。分解した親も、別の issue へ束ねた
// 側も、棚卸しは `kind:` を付けて出るので、**依存が張ってあるかを見る必要も無い。**
//
// **どれが翻訳の要る issue かは判定しない**——並べるところまでが機械の仕事で、まとめ方も分け方も
// モデルが決める。

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { busySession } from './board-move.mjs';
import { liveSessions } from './live-sessions.mjs';
import { gh as runGh, runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

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
 * マージできるか。**`gh` の語をそのまま出さない**——読むのはスマホの人間で、GitHub の列挙の綴りは
 * 見分けの手掛かりにならない。**知らない値はそのまま出す**（黙って「不明」へ落とすと、増えた値に
 * 誰も気づけない）。
 */
const MERGEABILITY = { MERGEABLE: 'マージ可', CONFLICTING: '衝突', UNKNOWN: '不明' };
const mergeability = (pr) => MERGEABILITY[pr.mergeable] ?? pr.mergeable ?? '不明';

/** 本文の `Closes #N`。番号だけの参照では issue が閉じないので、ここでも見ない。 */
const closes = (body) => [...(body ?? '').matchAll(/closes\s+#(\d+)/gi)].map((match) => Number(match[1]));

/**
 * 盤面を1つ組み立てる。**引き当てはここだけ**で、並べ方は下の2つが持つ。**PRか issue を引けなければ
 * `undefined`**——欠けたまま並べると、消えたPRが「無い」ものとして読まれる（理由は `gh` が自分で
 * 言っている）。
 */
function survey({ gh, sessions, warn }) {
  const prsRaw = gh(['pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_FIELDS]);
  // issue は1回だけ引いて、`kind:task` の付いたもの・まだ分類されていないもの・`kind:meta` の本文の
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

  // 畳んでいないセッション。ここが「もう投入したか」の主な根拠。**引けなければ空のまま進む**
  // ——投入済みの判定はPRだけになるが、PRと issue は並べられる。
  let live = [];
  try {
    live = sessions();
  } catch {
    warn('（セッションの一覧を引けなかった。投入済みの判定はPRだけで行う）');
  }

  const tagged = (tag) => live.filter((session) => session.tags.includes(tag));
  const running = (tag) => tagged(tag).some(busySession);

  const tasks = issues
    .filter((issue) => names(issue).includes('kind:task'))
    .map((issue) => {
      const own = tagged(`task-${issue.number}`);
      // **開いているPRだけで見る。** 閉じたPRは、取り下げか、閉じてから立て直す途中（`dispatch-task.sh`）。
      const pr = prs.find((item) => closes(item.body).includes(issue.number));
      const blocker = blockers(issue)[0];
      const state = names(issue).includes('判断待ち')
        ? '返却'
        : own.length > 0 || pr !== undefined
          ? '投入済み'
          : blocker === undefined
            ? '着手可'
            : `待ち:#${blocker.number}`;
      const moving = [];
      if (running(`task-${issue.number}`)) moving.push('作業中');
      if (pr !== undefined && running(`review-${pr.number}`)) moving.push('レビュー中');
      return {
        number: issue.number,
        title: issue.title,
        state,
        progress: moving.length > 0 ? moving.join('・') : own.length > 0 ? '手空き' : '担当無し',
        pr,
        // 走らせる先の指定（2.16）。**知らない値もそのまま出す**——盤面が配れないことは
        // `board-move.mjs` が覚え書きで言うので、ここは付いているものを見せるだけでよい。
        env: names(issue).find((name) => name.startsWith('env:')),
      };
    });

  const unsorted = issues.filter((issue) => !names(issue).some((name) => name.startsWith('kind:')));

  // `issuesRaw` を返すのは、**`確定待ち` を引くのが端末の側だけ**だから（下の `board`）。
  return { issuesRaw, prs, tasks, unsorted, live };
}

/** 端末へ1行1件で出す形（[`board.sh`](board.sh)）。引けなければ `undefined`。 */
export function board({ gh = runGh, sessions = liveSessions, checkedItems = runCheckedItems, warn }) {
  const found = survey({ gh, sessions, warn });
  if (found === undefined) return undefined;

  const lines = ['## 確定待ち'];
  // **引くのはここだけ。** `checked-items.sh` はプロセスを1つ起こす（[`spawn.mjs`](spawn.mjs)）ので、
  // 出さない側（`issueBody`）のために毎回起こさない。
  const checked = checkedItems(found.issuesRaw)
    .split(/\r?\n/)
    .filter((line) => line !== '')
    .map((line) => `確定待ち ${line}`);
  lines.push(...(checked.length === 0 ? ['（無し）'] : checked));

  lines.push('## PR');
  for (const pr of found.prs) {
    const base = pr.baseRefName ?? 'main';
    lines.push(`PR ${pr.number} ${checks(pr)} ${mergeability(pr)} ${base} ${labelColumn(pr)} ${pr.title}`);
  }

  lines.push('## TASK');
  for (const task of found.tasks) {
    lines.push(
      `TASK ${task.number} ${task.state}${task.env === undefined ? '' : ` ${task.env}`} ${task.title}`,
    );
  }

  lines.push('## 未整理');
  const unsorted = found.unsorted.map(
    (issue) => `未整理 ${issue.number} ${labelColumn(issue)} ${issue.title}`,
  );
  lines.push(...(unsorted.length === 0 ? ['（無し）'] : unsorted));

  lines.push('## 走行');
  // **何をしているセッションかはタグで読む**（`task-<番号>` / `review-<PR番号>` / `chore-<名>`）。
  // 題を出さないのは、一覧が [`live-sessions.mjs`](live-sessions.mjs) から来るため——**デーモンが
  // 見ているものと同じ一覧**であることのほうが、読みやすさより先に来る。
  const running = found.live.map(
    (session) =>
      `走行 ${session.id} ${session.status.replace('SESSION_STATUS_', '')} ${session.env} ${
        session.tags.length === 0 ? '-' : session.tags.join(',')
      }`,
  );
  lines.push(...(running.length === 0 ? ['（無し）'] : running));

  return lines;
}

/** 数える先。**並びがそのまま表の行になる**ので、配る順（着手可が先）で並べる。 */
const COUNTS = ['着手可', '投入済み', '待ち', '返却'];

/** その task が数えられる先。`待ち:#N` は番号ごとに分かれないよう、頭だけで見る。 */
const counted = (task) => (task.state.startsWith('待ち') ? '待ち' : task.state);

/** 表の升。**`|` はそのまま置けない**——issue の題に混ざると、そこで列が割れる。 */
const cell = (text) => String(text).replace(/\|/g, '\\|');

/**
 * 常設の issue の本文（[`board-publish.mjs`](board-publish.mjs)）。読むのは**スマホの人間**で、
 * 手元でスクリプトを叩けない相手なので、**リポジトリを開かずに読める形**にする。
 *
 * **断りは本文へも出す。** 一覧を引けなかった周は状態が当てにならないが、**それを知らせる先が
 * ログしか無いと、読んでいる人は嘘の表を正しいものとして読む。**
 *
 * 引けなければ `undefined`（呼び手は書き込まない——**古い本文が残るほうが、欠けた盤面より正しい**）。
 */
export function issueBody({ gh = runGh, sessions = liveSessions, warn, now = new Date() } = {}) {
  const notes = [];
  const found = survey({
    gh,
    sessions,
    warn: (line) => {
      notes.push(line);
      warn(line);
    },
  });
  if (found === undefined) return undefined;

  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    '**この本文はデーモンが周期で丸ごと書き換えます。** 人が書いたものは次の更新で消えます',
    '（周期と、書けなかったときの振る舞いは `.claude/board-design.md` 2.20）。',
    '',
    `最終更新 ${at}`,
  ];
  for (const note of notes) lines.push('', `⚠ ${note}`);

  const tally = new Map(COUNTS.map((name) => [name, 0]));
  for (const task of found.tasks) {
    const name = counted(task);
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }

  lines.push('', '## 件数', '', '| 何が | 件数 |', '|---|---|');
  for (const [name, count] of tally) lines.push(`| ${name} | ${count} |`);
  lines.push(`| 未整理 | ${found.unsorted.length} |`);
  lines.push(`| 開いているPR | ${found.prs.length} |`);
  lines.push(`| 畳んでいないセッション | ${found.live.length} |`);

  lines.push('', '## 投入済み', '');
  const rows = found.tasks
    .filter((task) => task.state === '投入済み')
    .map(
      (task) =>
        `| #${task.number} | ${cell(task.title)} | ${task.progress} | ${
          task.pr === undefined ? '-' : `#${task.pr.number} ${checks(task.pr)} ${mergeability(task.pr)}`
        } |`,
    );
  if (rows.length === 0) lines.push('（無し）');
  else lines.push('| issue | 題 | 状態 | PR |', '|---|---|---|---|', ...rows);

  return `${lines.join('\n')}\n`;
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
