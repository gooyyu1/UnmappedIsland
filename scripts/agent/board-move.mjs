// 盤面から、次に打つ手を優先順に並べる（`.claude/board-design.md` 2.3）。
//
//   node scripts/agent/board-move.mjs < 盤面.json
//
// 標準入力は盤面のJSON、標準出力は1行1手。**打つのは呼び手**（[`daemon.sh`](daemon.sh)）で、
// ここは決めるだけ。決める材料が全部引数に載っているので、実物を触らずに検査できる。
//
//   MERGE   <PR番号>
//   ARCHIVE <セッションID> <指紋>            … 担当の issue が閉じたワーカーを畳む
//   RESUME  <セッションID> mend  <PR番号>    <指紋>
//   RESUME  <セッションID> stall <issue番号> <指紋>
//   REVIEW  <PR番号> <指紋>
//   TASK    <issue番号>
//   NOTE    <人へ向けた1行>                  … 打つ手が無いことの説明。呼び手は記録するだけ
//
// 入力は次の形。
//
//   { "settledBefore": "<この時刻より前に止まっているPRは、チェック0本でも緑と読む>",
//     "prs":      [ gh pr list --json number,isDraft,labels,mergeable,statusCheckRollup,updatedAt,headRefOid,baseRefName,body ],
//     "issues":   [ gh issue list --json number,labels,blockedBy ],
//     "sessions": [ { "id": "session_…", "status": "SESSION_STATUS_…",
//                     "bucket": "SESSION_STATUS_BUCKET_…", "tags": ["task-1"] } ],
//     "issueStates": { "<issue番号>": "OPEN | CLOSED" },
//     "prSessions":  { "<PR番号>": "session_…" },
//     "taken":    { "<手のキー>": "<前に打ったときの指紋>" } }
//
// ## 同じ手を、同じ盤面へ二度打たない
//
// `send_message` で起こしたセッションが何もせずに止まると、盤面は前の周と同じまま——**次の周も同じ
// 手が出て、永久に起こし続ける。** そこで、打った手を `taken` へ「そのとき盤面がどう見えていたか」
// （指紋）とともに残し、**指紋が変わるまで同じ手を出さない。** 直しなら指紋は PR の先頭コミット
// （`headRefOid`）なので、**直しが push された瞬間だけ**次の手が出る。
//
// `taken` は過去の記録なので、デーモンが死んでも嘘にならない（1.1）。失われたときの害は、
// 同じ依頼が1回重なることだけ。
//
// ## セッションへの問いは2つある（1.2）
//
// **投入済みか**（畳まれていないか）と、**今その差分へ手が動いているか**。ここは両方を使う
// ——`task-<番号>` が生きていれば新しく投入しないが、手が空いていればレビューへ出してよい。
// **片方だけで書くと、再レビューが永久に止まるか、手が空いた上へ2本目が立つ。**
// どの値がどちらに答えるかは 1.6。

import { readFileSync } from 'node:fs';

/**
 * 今その差分へ手が動いているか（1.6）。**言うのは `session_status`**——`status_bucket` は手が
 * 空いても `..._WORKING` のまま固まることがあり、そうなったPRのレビューが永久に出なくなる。
 *
 * **`..._BLOCKED` を足しているのは仮説で、実測していない。** 承認待ちのセッションが
 * `SESSION_STATUS_RUNNING` を保つのか `..._IDLE` へ落ちるのかを見ていないので、落ちる場合に備えて
 * or で残してある。**実測が付いたら、要らない側を消すこと。**
 */
const busySession = (session) =>
  session.status === 'SESSION_STATUS_RUNNING' || session.bucket === 'SESSION_STATUS_BUCKET_BLOCKED';

const input = JSON.parse(readFileSync(0, 'utf8'));
const taken = input.taken ?? {};
/** 生きているワーカーの担当 issue のうち、**開いている一覧に載っていなかったもの**の状態（2.10）。 */
const issueStates = input.issueStates ?? {};
/** PRごとの、そのPRを書いたセッション（コミットの `Claude-Session:` トレーラ。2.11）。 */
const prSessions = input.prSessions ?? {};

const names = (item) => (item.labels ?? []).map((label) => label.name);

/** 本文の `Closes #N`。番号だけの参照では issue が閉じないので、ここでも見ない。 */
function closes(body) {
  return [...(body ?? '').matchAll(/closes\s+#(\d+)/gi)].map((match) => Number(match[1]));
}

const alive = (tag) => input.sessions.filter((session) => session.tags.includes(tag));
const busy = (tag) => alive(tag).some(busySession);

/**
 * 差し戻す相手（2.11）。引くのは**コミットの `Claude-Session:` トレーラ**——`Closes` は、そのPRで
 * どの issue が閉じるかの印であって、誰が書いたかを指していない。畳まれたセッションはここに
 * 居ないので、そのまま「起こせない」になる（1.2）。
 *
 * **`Closes` とタグで引く側はつなぎ。** トレーラの規則が入る前に出たPRと、手で立てたPRには
 * トレーラが無い。**開いているPRが全部トレーラを持つようになったら、この分岐ごと消す。**
 */
function menders(pr) {
  const id = prSessions[String(pr.number)];
  if (id !== undefined) return input.sessions.filter((session) => session.id === id);
  return closes(pr.body).flatMap((issue) => alive(`task-${issue}`));
}

/**
 * CIの色。**チェックが1つも登録されないPRがある**（`tests.yml` の `paths` に当たらない差分）ので、
 * 落ち着いてから緑と読む。まだ登録中なだけの場合と区別が付かないため。
 */
function checks(pr) {
  const roll = pr.statusCheckRollup ?? [];
  if (roll.length === 0) return pr.updatedAt < input.settledBefore ? 'green' : 'running';
  if (roll.some((check) => check.status !== 'COMPLETED')) return 'running';
  const ok = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  return roll.every((check) => ok.has(check.conclusion)) ? 'green' : 'red';
}

const merges = [];
const archives = [];
const mends = [];
const stalls = [];
const reviews = [];
const tasks = [];
const notes = [];

// **古いものから捌く。** 一覧は新しい順に返るので、そのまま回すと**打つのは1周に1手**（`daemon.sh`）
// なぶん、後から出たPRが毎周先に拾われて古いものが後回しになる。issue 側（下の `ready`）と同じ向き。
for (const pr of [...input.prs].sort((a, b) => a.number - b.number)) {
  if (pr.isDraft === true) continue;
  const labels = names(pr);
  // 人間の手元。仮決めへの返事を待っているので、機械は触らない（1.3）。
  if (labels.includes('判断待ち')) continue;

  // **他のPRの上に積まれたPRは、盤面では捌けない。** CIは古い base の上で緑になり、レビューが読む
  // 差分にも下のPRの変更が混ざる（#1508 はこれで2周ぶん無駄にしている）。触らずに書き残すだけに
  // する。下が入ると `merge-and-close.sh` が `main` へ張り替えるが、**それで直るのは自動クローズ
  // だけ**で、差分もCIも載せ直すまで古いまま（あちらの「積まれたPRは…」）。
  if ((pr.baseRefName ?? 'main') !== 'main') {
    notes.push(`PR #${pr.number} は ${pr.baseRefName} の上に積まれている（下が入るまで触らない）`);
    continue;
  }

  const check = checks(pr);
  // **コンフリクトはラベルより先に見る。** 誰の手元にあろうと、解消するまで前へ進めない。
  const reason = labels.includes('直し待ち')
    ? '差し戻された'
    : pr.mergeable === 'CONFLICTING'
      ? 'コンフリクトしている'
      : check === 'red'
        ? 'CIが赤い'
        : null;

  if (reason !== null) {
    // 直す相手は、そのPRを書いたセッション。**畳まれていれば起こせない**——畳むのは
    // 「この仕事は終わった」と判断した側の明示の操作なので、機械では戻さない（1.2）。
    const holders = menders(pr);
    if (holders.length === 0) {
      // **「名乗っていない」と「畳まれている」を、まだ書き分けていない。** 分けるには覚え書きの文面を
      // 変えることになり、それを見張っている試験が #1538 のファイル分割の最中なので、入った後に回す。
      notes.push(`PR #${pr.number} は${reason}が、直す相手のセッションが居ない`);
      continue;
    }
    for (const holder of holders) {
      if (busySession(holder)) continue;
      const mark = `mend:${pr.number}:${pr.headRefOid}`;
      if (taken[`resume:${holder.id}`] === mark) continue;
      mends.push(`RESUME ${holder.id} mend ${pr.number} ${mark}`);
    }
    continue;
  }

  if (labels.includes('通してよい')) {
    if (check === 'green' && pr.mergeable === 'MERGEABLE') merges.push(`MERGE ${pr.number}`);
    continue;
  }

  // 結論のラベルが無い＝この差分はまだ読まれていない（push で外れる。`board-labels.yml`）。
  if (check !== 'green') continue;
  // 前のレビューが走っている間は出さない。**書き終えたレビューは止めない**——次の差分のレビューは
  // 別の仕事で、それを占有と読むと再レビューが永久に止まる（1.2）。
  if (busy(`review-${pr.number}`)) continue;
  // 著者が書いている最中に読ませない（動く的を読むことになる）。
  if (closes(pr.body).some((issue) => busy(`task-${issue}`))) continue;
  if (taken[`review:${pr.number}`] === pr.headRefOid) {
    notes.push(`PR #${pr.number} はレビューへ出したが、結論のラベルが付いていない`);
    continue;
  }
  reviews.push(`REVIEW ${pr.number} ${pr.headRefOid}`);
}

// 手が空いたワーカーの行き先は2つ。**担当の issue が閉じていれば畳み**、開いているのにPRが出て
// いなければ起こす。どちらも「手が空いている」ことが入口なので、1つの走査で決める。
for (const session of input.sessions) {
  if (busySession(session)) continue;
  for (const tag of session.tags) {
    if (!tag.startsWith('task-')) continue;
    const held = tag.slice('task-'.length);
    const issue = Number(held);

    // **仕事が終わったかは issue の側にある**（2.10）。**PRがマージされたかでは決めない**——手で
    // マージされたPRの後片付けは走らないので、条件をそちらに繋ぐとワーカーが永久に残る。
    if (issueStates[held] === 'CLOSED') {
      const mark = `closed:${issue}`;
      if (taken[`archive:${session.id}`] === mark) break;
      archives.push(`ARCHIVE ${session.id} ${mark}`);
      break;
    }

    // PRを出さないまま手が空いたセッション。**1回だけ起こす**（指紋が issue 番号だけなので、次は無い）。
    if (!input.issues.some((item) => item.number === issue)) continue;
    if (input.prs.some((pr) => closes(pr.body).includes(issue))) continue;
    const mark = `stall:${issue}`;
    if (taken[`resume:${session.id}`] === mark) continue;
    stalls.push(`RESUME ${session.id} stall ${issue} ${mark}`);
  }
}

// **並列度1**（3.1）。作業領域の多次元ラベルがまだ無いので、書くセッションは同時に1本まで。
// レビューは書かないので数えない。
const writing = input.sessions.filter((session) => session.tags.some((tag) => tag.startsWith('task-')));

// **古いものから投入する。** 一覧は新しい順に返るので、そのまま使うと古い issue が永久に
// 後回しになる（今 open な `task` は30件を超える）。
const ready = [...input.issues]
  .sort((a, b) => a.number - b.number)
  .filter((issue) => names(issue).includes('task'))
  .filter((issue) => !(issue.blockedBy?.nodes ?? []).some((node) => node.state === 'OPEN'))
  .filter((issue) => !input.prs.some((pr) => closes(pr.body).includes(issue.number)))
  // 既にセッションが持っている issue は配り直さない（「投入済みか」は生死で見る。1.2）。
  .filter((issue) => alive(`task-${issue.number}`).length === 0);

if (writing.length === 0) {
  for (const issue of ready) tasks.push(`TASK ${issue.number}`);
} else if (ready.length > 0) {
  // **待たせている相手を毎周書く。** 起こしても動かないセッションが1本残ると、`stall` は指紋で
  // 1回しか出ないので、黙ったまま TASK が永久に止まる。ログに何も出ないと「やることが無い周」と
  // 見分けが付かない。
  const holders = writing.map((session) => session.id).join('・');
  notes.push(`${ready.length}件の task が、書くセッション（${holders}）の空きを待っている`);
}
if (writing.length > 1) {
  notes.push(`書くセッションが${writing.length}本走っている（並列度1のはず）`);
}

// 畳むのをマージの次に置くのは、**書くセッションの枠が空くから**（3.1 の並列度）。後ろへ回すと、
// 終わったワーカーが枠を握ったまま、待っている task が投入されない周が続く。
const moves = [...merges, ...archives, ...mends, ...stalls, ...reviews, ...tasks];
process.stdout.write([...moves, ...notes.map((note) => `NOTE ${note}`)].join('\n'));
if (moves.length > 0 || notes.length > 0) process.stdout.write('\n');
