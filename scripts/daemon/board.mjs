// 盤面を1回で出す。**ユーザーの答え待ち・開いているPR・開いている task issue・棚卸しの
// 済んでいない issue・畳んでいないセッション**を、突き合わせた形で並べる。
//
// 出口は2つある。**突き合わせるのは1箇所**（`survey`）で、違うのは並べ方だけ——片方だけが違う
// 盤面を見せることにならない。
//
//   [`board.sh`](../agent/board.sh)               … 端末へ1回。1行1件（読むのは、セッションを立てられる者）
//   [`board-publish.mjs`](board-publish.mjs) … 常設の issue の本文へ周期で（読むのはスマホの人間。
//                                             `agent-ops/board-design.md` 2.20）
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
// ユーザーの答えは `kind:ask` の issue の本文にチェックとして付き、**拾われるまでそこに残る。**
// 判定は [`checked-items.sh`](../agent/checked-items.sh) が持つ。**常設の盤が全部その対象ではない**
// ——チェックが設定である盤も、機械が本文を書く盤も、拾えば下ろされない項目が居座る（同）。
//
// **[`daemon.sh`](daemon.sh) はここを読まない**（判断が要るので、届ける口はまだ無い）。だから
// **誰かが自分から訊きに来ないと、答えは拾われないまま残る。** 盤面は、その訊きに来る側の道具。
//
// 拾ったら、答えの行き先を**その盤の中**（`## 下ろした項目` のような記録の節）へ書いてから、
// チェックの付いた項目を消す。**`【確定】` の印が付くのは待たない**——印を付けるのは答えを受けた
// 側で、待つと答えを下ろした後も出続ける。消すまで毎回ここに出るのが正しい——**消し忘れは、次に
// 見に来た者にも見える。**
//
// **人へ1問ずつ訊く issue（`判断待ち`）は、ここには出ない。** あちらは下ろす先が既にある
// （ユーザーがラベルを外せば、盤面がその issue を配る。`CLAUDE.md`「確認は、1問1 issue で出す」）。
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
// ## `未整理` は、棚卸しの結論がまだ揃っていない issue
//
// **棚卸しの結論（`kind:` と `goal:`）が揃っていない open な issue**（`agent-ops/board-design.md`
// 2.17.1）。分類がまだか、分類は済んだが向かう先を名乗っていないか。
//
// **「まだ見ていない」ではない。** 後者は `kind:` が付いている以上**棚卸しが一度見たもの**で、
// 名乗りだけが落ちている。**見たかどうかではなく、結論が揃ったかで並べる。**
//
// **判定は [`board-move.mjs`](board-move.mjs) の `unsorted` から引く**——棚卸しの係が立つ理由も
// 同じものを読むので、2箇所で書くと**ここに並ぶ「未整理」と、棚卸しが立つ理由が食い違う。**
//
// **分類の値を数え上げて、そのどれでもない、という否定の列挙では表さない。** 出口が増えるたびに条件を
// 書き換えることになり、書き忘れた出口の issue が毎周また並ぶ。分解した親も、別の issue へ束ねた
// 側も、棚卸しは `kind:` を付けて出るので、**依存が張ってあるかを見る必要も無い。**
//
// **どれが翻訳の要る issue かは判定しない**——並べるところまでが機械の仕事で、まとめ方も分け方も
// モデルが決める。

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HUMAN_TURN,
  PATROL,
  STRANDS,
  busySession,
  cycleHours,
  strandedPrs,
  unsorted as unsortedIssue,
} from './board-move.mjs';
import { allOpenIssues, readPrSessions } from './board-read.mjs';
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
async function survey({ gh, sessions, warn }) {
  const prsRaw = gh(['pr', 'list', '--state', 'open', '--limit', '50', '--json', PR_FIELDS]);
  // issue は1回だけ引いて、`kind:task` の付いたもの・まだ分類されていないもの・`kind:ask` の本文の
  // チェックへ分ける。**依存も同じ呼び出しで返る**ので、issue 1件ずつ `gh api` を叩かなくてよい。
  // **引くのはデーモンと同じ手**（[`board-read.mjs`](board-read.mjs) の `allOpenIssues`）——別々に
  // 引くと、盤面には載っているのに人の読む窓からだけ消える帯ができる。
  const issues = allOpenIssues(gh, 'number,title,labels,blockedBy,body');
  if (prsRaw === undefined || issues === undefined) return undefined;
  const prs = JSON.parse(prsRaw);

  // 畳んでいないセッション。ここが「もう投入したか」の主な根拠。**引けなければ空のまま進む**
  // ——投入済みの判定はPRだけになるが、PRと issue は並べられる。
  let live = [];
  let sessionsKnown = true;
  try {
    live = await sessions();
  } catch {
    sessionsKnown = false;
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

  const unsorted = issues.filter(unsortedIssue);

  // **宛先を引けないPRを言うには、名乗りと生きた一覧の**両方**が要る**（`board-move.mjs` の
  // `strandedPrs`）。片方でも欠けた周に「引けない」と読むと、**健全なPRが全部そう見える**
  // ——引けなかったことは断りとして出し、節そのものは出さない。
  // **理由は道具から受け取って、断りへ載せる**（1.7）。落とすと、**読む人には「出せない」しか
  // 残らない**——ここの断りはそのまま本文の ⚠ の行になる。
  let claimWhyNot = '';
  const claimed = sessionsKnown ? readPrSessions(gh, (line) => (claimWhyNot = line)) : undefined;
  if (sessionsKnown && claimed === undefined) {
    warn(`（差し戻す相手を引けなかった。宛先の無いPRは出せない）: ${claimWhyNot}`);
  }
  const stranded = strandedPrs(prs, claimed, live);

  return { issues, prs, tasks, unsorted, live, sessionsKnown, stranded };
}

/** 端末へ1行1件で出す形（[`board.sh`](../agent/board.sh)）。引けなければ `undefined`。 */
export async function board({ gh = runGh, sessions = liveSessions, checkedItems = runCheckedItems, warn }) {
  const found = await survey({ gh, sessions, warn });
  if (found === undefined) return undefined;

  const lines = ['## 確定待ち'];
  // **引くのはここだけ。** `checked-items.sh` はプロセスを1つ起こす（[`spawn.mjs`](spawn.mjs)）ので、
  // 出さない側（`issueBody`）のために毎回起こさない。
  const checked = checkedItems(JSON.stringify(found.issues))
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
 * 経過した長さ。**読む人に引き算をさせない**——リポジトリも時計も開かずに、止まっている長さが
 * そのまま読める形にする。
 */
function elapsed(from, now) {
  const minutes = Math.floor((now.getTime() - from) / 60_000);
  if (minutes < 60) return `${minutes}分`;
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

/**
 * **これだけ見回りが途切れたら、断りにする。** 係の間隔（[`board-move.mjs`](board-move.mjs) の
 * `CYCLES` の `patrol`）から出すので、間隔を変えてもここは書き換わらない。**間隔そのものでは
 * 鳴らさない**——1回ぶんの立ち遅れ（手綱で止まっている・投入が転んだ・係が長く走っている）は
 * 毎日出るので、それで鳴ると読む人がこの行を読まなくなる。
 */
const STALE_PATROL_HOURS = (cycleHours(PATROL) ?? 1) * 3;

/**
 * 盤面を引けていないことの断り（`agent-ops/board-design.md` 2.21）。**印を置くのはデーモン**
 * （[`board-state.mjs`](board-state.mjs) の `UNREADABLE`）で、ここはその読み手。
 *
 * **いちばん上へ出す。** 引けない周のデーモンにできることはこれだけで、**直せるのは Claude Code
 * 本体を触れる人だけ**——表の状態より先に読まれる必要がある。
 *
 * **読めない値なら何も出さない。** 出どころは台帳のテキストなので、壊れていることがありうる。
 */
function unreadableNote(unreadable, now) {
  const from = Date.parse(unreadable?.since ?? '');
  if (Number.isNaN(from)) return undefined;
  // **周の数と、道具が言った理由を一緒に出す**（2.20.3）。長さだけでは、待つ間隔が動いたときに
  // 何周ぶんかが読めず、**理由が無いと直す先が分からない**——読む人はスマホから読むので、
  // `~/daemon.log` を開けない。
  const said = unreadable.reason === '' ? '' : `。道具が言った理由: ${cell(unreadable.reason)}`;
  return `**盤面を引けていません**（${unreadable.since} から ${elapsed(from, now)}・${unreadable.rounds}周）。GitHub か CCR から引けない周が続いています——**直せるのは人だけ**で、この間セッションは1本も立ちません${said}`;
}

/**
 * 周の出来事を遡る幅。**読むのは人で、要るのは「今どうなっているか」**——長く取るほど、直った
 * 詰まりが今の詰まりと並んで出る。**帳面そのものは落とす者が置かれていない**ので、これより前を
 * 数えたいとき（猶予を詰めるなど。2.22.2）は帳面を直に読む。
 */
export const EVENT_WINDOW_HOURS = 6;

/**
 * **周の出来事**（2.20.3）。**届く先はここしか無い**——1周を回す側が書くのは `~/daemon.log` で、
 * **それを定期的に読む者は居ない**（2.22.3）。並べるのは次のもの。
 *
 * - **配れない理由**（`board-move.mjs` の `NOTE`）と、**それが何分続いているか**。1周ぶんの
 *   覚え書きは「やることが無い周」と見分けが付かないので、**続いている長さが詰まりの合図**。
 * - **この周の盤面が欠けている理由**（`board-read.mjs` の `sayIncomplete`）。**上とは別の表**に
 *   する——あちらは盤面が何かを待っていることで、こちらは盤面がその周に全部を見られなかったこと
 *   （`board-state.mjs` の `PARTIAL_PREFIX`）。
 * - **打った手の件数。** `RETURN` のように、**件数そのものが合図になる手**がある
 *   （[`patrol-prompt.md`](../../agent-ops/prompts/patrol-prompt.md)「正常の定義」）。
 * - **盤面を引けなかった区間**（いつからいつまで・何周・道具が言った理由）。**直った周に台帳の印は
 *   消える**ので、帳面に閉じたものだけが後から読める。
 *
 * **どれも無い周は節ごと出さない**（`humanTurn` と同じ理由）。
 */
function roundEvents(blockedNotes, partialNotes, events, now) {
  const from = now.getTime() - EVENT_WINDOW_HOURS * 3_600_000;
  const recent = events.filter((event) => Date.parse(String(event.at)) >= from);
  const gaps = recent.filter((event) => event.kind === 'gap');

  // 打った手を `<手> <結果>` で数える。**結果ごとに分ける**——打てたことと打てなかったことは、
  // 読む人にとって別の出来事（2.21.2）。
  const tally = new Map();
  for (const event of recent) {
    if (event.kind !== 'move') continue;
    const key = `${event.move} ${MOVE_RESULTS[event.result] ?? event.result}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  if (blockedNotes.length === 0 && partialNotes.length === 0 && tally.size === 0 && gaps.length === 0) {
    return [];
  }
  const lines = [
    '',
    '## 周の出来事',
    '',
    `直近${EVENT_WINDOW_HOURS}時間。**出どころはデーモンの帳面**です。`,
  ];

  if (blockedNotes.length > 0) {
    lines.push(
      '',
      '**配れない理由**（この周にも出ています）',
      '',
      '| 何が止めているか | 続いている |',
      '|---|---|',
      ...blockedNotes.map((note) => `| ${cell(note.text)} | ${elapsedSince(note.since, now)} |`),
    );
  }

  if (partialNotes.length > 0) {
    lines.push(
      '',
      '**この周の盤面が欠けています**（そのぶん、出ない手があります）',
      '',
      '| 何が引けていないか |',
      '|---|',
      ...partialNotes.map((text) => `| ${cell(text)} |`),
    );
  }

  if (tally.size > 0) {
    lines.push(
      '',
      '**打った手**',
      '',
      '| 手 | 件数 |',
      '|---|---|',
      ...[...tally].map(([what, count]) => `| ${cell(what)} | ${count} |`),
    );
  }

  if (gaps.length > 0) {
    lines.push(
      '',
      '**盤面を引けなかった区間**',
      '',
      '| いつから | いつまで | 周 | 道具が言った理由 |',
      '|---|---|---|---|',
      ...gaps.map(
        (gap) => `| ${cell(gap.from)} | ${cell(gap.until)} | ${gap.rounds} | ${cell(gap.reason ?? '')} |`,
      ),
    );
  }
  return lines;
}

/**
 * 手の結果を、人へ見せる語にする。**綴りを持つのは [`board-round.mjs`](board-round.mjs)**
 * （`PLAYED`・`FAILED`・`SETTLED`）で、ここはその読み手。
 *
 * **結果が増えたら、ここにも升が要る。** 欠けると、その結果の手は帳面に載るのに**人の読む盤面には
 * 結果が英語のまま出る**——突き合わせは検査が持つ（`tests/scripts/roundEventsReachPeople.test.ts`）。
 */
export const MOVE_RESULTS = {
  played: '打てた',
  failed: '打てなかった',
  settled: '打てなかった（答えは返っている）',
};

/** その時刻から今までの長さ。**読めない時刻はそのまま出す**——黙って落とすと、行ごと消える。 */
function elapsedSince(since, now) {
  const from = Date.parse(since ?? '');
  return Number.isNaN(from) ? String(since) : elapsed(from, now);
}

/**
 * 盤面を見回る係（`agent-ops/board-design.md` 2.21）が最後に残した1行。**記録を書くのは係自身**
 * （[`patrol-prompt.md`](../../agent-ops/prompts/patrol-prompt.md)）で、ここはその読み手。
 *
 * **「異常なし」と「立たなかった」を分けるのがこの行**——立たなければ時刻が古いまま残るので、
 * **`STALE_PATROL_HOURS` を過ぎたら断りにする**（長さと、その決め方はあちらが持つ）。係が黙って
 * 立たなくなったことは、他のどこにも出ない。
 *
 * **「盤面の」を落とさない。** デーモンにはもう1つ見回り（2.22 の、値の生死を見る手）が在るので、
 * 裸の「見回り」だと読む人がどちらの話か分からない。
 */
function patrolNote(patrol, now) {
  if (patrol === undefined)
    return '⚠ **盤面を見回る係の記録がありません。** 立っていないか、記録が壊れています（2.21）';
  const from = Date.parse(patrol.at);
  const line = `盤面の見回り ${patrol.at} … ${patrol.verdict === '' ? '（判定なし）' : patrol.verdict}${patrol.summary === '' ? '' : ` ${patrol.summary}`}`;
  if (now.getTime() - from < STALE_PATROL_HOURS * 3_600_000) return line;
  return `⚠ **盤面を見回る係が ${elapsed(from, now)} 立っていません。** 最後の記録は「${line}」（2.21）`;
}

/**
 * そのPRが止まっていることと、**画面のマージが今すぐ押せるか**（2.13.8）。人の手番で止まっている
 * 間は `main` の動きで直しを頼まないので、**待つほど衝突とCIの赤がそのまま残る**——押せないことを
 * 書かないと、読んだ人は「通す」を選んだつもりでボタンの前に着く。
 */
function pendingMerge(pr) {
  const blocked = [
    pr.mergeable === 'CONFLICTING' ? '衝突' : undefined,
    checks(pr) === '赤' ? 'CIが赤い' : undefined,
  ].filter((reason) => reason !== undefined);
  return blocked.length === 0 ? 'マージされない' : `マージされない（${blocked.join('・')}。取り込みが要る）`;
}

/**
 * 人の手番で止まっているもの（`HUMAN_TURN`。2.13）。**届く先はここしか無い**——ラベルを付けるのは
 * 機械かレビュアーで、PRを出すのも issue を返すのも人と同じアカウントなので、GitHub の通知は
 * 鳴らない。端末の盤面にはラベルの列が出るが（`board`）、**叩けない人が読めるのは本文だけ。**
 *
 * **何が止まるかを一緒に書く。** 効き目は1つでも、その先は母集団で決まる（1.3）——PRならマージ、
 * issue なら投入。**なぜ止めたかは判定のコメントに在る**ので、ここは番号と題で足りる。
 *
 * **無い周は節ごと出さない。** 毎周「（無し）」が出る節は、在る周も同じ見た目のまま読み飛ばされる。
 */
function humanTurn(found) {
  const held = [
    ...found.prs.map((pr) => ({ item: pr, what: `PR #${pr.number}`, stops: pendingMerge(pr) })),
    ...found.issues.map((issue) => ({ item: issue, what: `#${issue.number}`, stops: '配られない' })),
  ].filter(({ item }) => names(item).some((name) => HUMAN_TURN.includes(name)));
  if (held.length === 0) return [];
  // **取り込みが要るPRが1本も無い周には書かない。** 毎周出る断りは、当たっている周も読み飛ばされる。
  const stale = held.some(({ stops }) => stops.includes('取り込みが要る'))
    ? [
        '',
        '**`取り込みが要る` と出たPRは、画面のマージが押せません。** 通すなら「通してよい。`main` を取り込んで」と書いてラベルを外してください——書いた本人が1回で取り込み直し、緑になったらここへ戻ります（2.13.8）。',
      ]
    : [];
  return [
    '',
    '## 人の手番',
    '',
    '**この印が外れるまで、下は進みません。** 通すならPRを画面からマージ、通さないならラベルを外す（2.13.1）。',
    ...stale,
    '',
    '| どれ | 外れないと | 題 |',
    '|---|---|---|',
    ...held.map(({ item, what, stops }) => `| ${what} | ${stops} | ${cell(item.title)} |`),
  ];
}

/**
 * **差し戻す相手を引けないPR**（2.11.4）。**届く先はここしか無い**——盤面は毎周 `~/daemon.log` へ
 * 覚え書きを書くが、**それを定期的に読む者は居ない**（2.22.3）。2026-09-11、PR #1922 の名乗りが
 * 引けないまま、ユーザーがPRへ書いた質問は作者へ一度も届かず、盤面は2時間手を1つも打たなかった
 * （issue #1937）。
 *
 * **人の手番の節とは分ける。** あちらは「ラベルを外すかマージするか」で答えるものだが、ここは
 * **PRを直すか閉じるかまで人がやる**——答え方が違うものを1つの表に並べると、読む人は先頭の
 * 指示に従って外すだけになる。
 *
 * **無い周は節ごと出さない**（`humanTurn` と同じ理由）。
 */
function strandedNote(found) {
  if (found.stranded.length === 0) return [];
  return [
    '',
    '## 宛先の無いPR',
    '',
    '**盤面からは誰にも回せません。** 直しが要っても差し戻す先が無いので、下は人が動かすまで止まります。',
    '',
    '| どれ | なぜ | 直すには |',
    '|---|---|---|',
    ...found.stranded.map(
      ({ pr, kind }) => `| PR #${pr.number} | ${STRANDS[kind].why} | ${STRANDS[kind].fix} |`,
    ),
  ];
}

/**
 * 常設の issue の本文（[`board-publish.mjs`](board-publish.mjs)）。読むのは**スマホの人間**で、
 * 手元でスクリプトを叩けない相手なので、**リポジトリを開かずに読める形**にする。
 *
 * **断りは本文へも出す。** 知らせる先がログしか無いと、**ログを読めるのは手元で叩ける人だけ**
 * なので、読んでいる人には届かない。セッションの一覧を引けなかった周は、断りに加えて
 * **一覧を根拠にした行そのものを落とす**（下の `sessionsKnown`）。
 *
 * **周の出来事も同じ理由でここへ出す**（`blockedNotes`・`events`。2.20.3）。**置くのは1周を回す側**
 * （[`board-round.mjs`](board-round.mjs)）で、ここはその読み手——周と書き出しは別の周期で走る別の
 * プロセスなので、**デーモンの帳面を通す以外に届く道が無い。**
 *
 * 引けなければ `undefined`（呼び手は書き込まない——**古い本文が残るほうが、欠けた盤面より正しい**）。
 */
export async function issueBody({
  gh = runGh,
  sessions = liveSessions,
  warn,
  now = new Date(),
  unreadable,
  patrol,
  blockedNotes = [],
  partialNotes = [],
  events = [],
} = {}) {
  const notes = [];
  const found = await survey({
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
    '（周期と、書けなかったときの振る舞いは `agent-ops/board-design.md` 2.20）。',
    '',
    `最終更新 ${at}`,
  ];
  // **引けていない断りが先。** 一覧を引けなかった周の断り（`notes`）は表の読み方の注釈だが、
  // こちらは**読んだ人に手を打ってもらうための行**（2.21）。
  const stuck = unreadableNote(unreadable, now);
  if (stuck !== undefined) lines.push('', `⚠ ${stuck}`);
  for (const note of notes) lines.push('', `⚠ ${note}`);
  lines.push('', patrolNote(patrol, now));
  // **人の手番は、状態の表より先。** 断りと同じで、**読んだ人に手を打ってもらうための行**
  // （2.20.2）——件数と表は、その後で読めばよい。
  lines.push(...humanTurn(found));
  // **人の手番の次。** 同じく手を打ってもらうための節だが、**外れるのを待っている相手が居る
  // ぶん人の手番が先**——こちらは誰も待っていないので、気づくのが1画面ぶん遅れても止まらない。
  lines.push(...strandedNote(found));
  // **周の出来事は、人の手番の次・件数の表より先**（2.20.3）。表は「今どう見えているか」だが、
  // ここは**盤面が動いているか**——止まっているときに人が最初に知りたいのはこちら。
  lines.push(...roundEvents(blockedNotes, partialNotes, events, now));

  const tally = new Map(COUNTS.map((name) => [name, 0]));
  for (const task of found.tasks) {
    const name = counted(task);
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }

  // **セッションの一覧が無い周は、それを根拠にした行を出さない。** 空の一覧で組むと、投入済みの
  // task が `着手可`・`担当無し` に化けて**在るはずのものが消えた盤面**になり、読んだ人は投入して
  // よいと読む（1.1・2.20.2）。**断りだけでは足りない**——表が在れば、表のほうが読まれる。
  lines.push('', '## 件数', '', '| 何が | 件数 |', '|---|---|');
  if (found.sessionsKnown) for (const [name, count] of tally) lines.push(`| ${name} | ${count} |`);
  lines.push(`| 未整理 | ${found.unsorted.length} |`);
  lines.push(`| 開いているPR | ${found.prs.length} |`);
  if (found.sessionsKnown) lines.push(`| 畳んでいないセッション | ${found.live.length} |`);

  lines.push('', '## 投入済み', '');
  if (!found.sessionsKnown) lines.push('（セッションの一覧を引けなかったので、出せない）');
  else {
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
  }

  return `${lines.join('\n')}\n`;
}

/**
 * チェックの付いた項目の判定は [`checked-items.sh`](../agent/checked-items.sh) が持つ。
 *
 * **起こすのは `board()` の側だけ**なので、あちらは `scripts/agent/` に在る——起こす1回は
 * [`board.sh`](../agent/board.sh) を打った人のもので、デーモンは通らない
 * （`agent-ops/parallel-work.md`「`scripts/` は呼び手で分かれている」）。
 */
function runCheckedItems(issuesJson) {
  return runBash(join(HERE, '..', 'agent', 'checked-items.sh'), [], {
    input: issuesJson,
    capture: true,
  }).stdout;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = await board({ warn: (line) => console.error(line) });
  if (lines === undefined) process.exit(1);
  process.stdout.write(`${lines.join('\n')}\n`);
}
