// 盤面から、次に打つ手を優先順に並べる（`.claude/board-design.md` 2.3）。
//
//   import { moves } from './board-move.mjs';
//   moves(盤面)   // → 1要素1手の文字列の配列
//
// **打つのは呼び手**（[`board-round.mjs`](board-round.mjs)）で、ここは決めるだけ。決める材料が
// 全部引数に載っているので、実物を触らずに検査できる。
//
//   MERGE   <PR番号>
//   ARCHIVE <セッションID> <指紋>            … 起こす先が無くなったセッションを畳む
//   RESUME  <セッションID> mend   <PR番号>    <指紋>  … 指摘・コンフリクト・CIの赤を直させる
//   RESUME  <セッションID> reject <PR番号>    <指紋>  … 通らなかった仮決めを取り下げさせる
//   RESUME  <セッションID> look   <PR番号>    <指紋>  … 画面を撮って本文へ貼らせる
//   RESUME  <セッションID> stall  <issue番号> <指紋>
//   RETURN  <issue番号> <セッションID> <指紋>  … 起こしても動かないワーカーの仕事を人へ返す
//   REVIEW  <PR番号> <指紋>
//   TASK    <issue番号>
//   NOTE    <人へ向けた1行>                  … 打つ手が無いことの説明。呼び手は記録するだけ
//
// **手を1行の文字列で返すのは、それがそのまま人の読む形だから。** `DRY_RUN` のログは この行を
// そのまま出す（[`daemon.sh`](daemon.sh) の「打たない手:」）ので、書式を持つ場所は1つで済む。
//
// 入力は次の形。
//
//   { "settledBefore": "<この時刻より前に止まっているPRは、チェック0本でも緑と読む>",
//     "mainChecks": [ { "status": "COMPLETED", "conclusion": "SUCCESS" } ],   … `main` の先頭のCI
//     "prs":      [ gh pr list --json number,isDraft,labels,mergeable,statusCheckRollup,updatedAt,headRefOid,baseRefName,body,files ],
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

/**
 * 今その差分へ手が動いているか（1.6）。**言うのは `session_status` だけ**——`status_bucket` は
 * 手番が終わった後の要約から決まるので、どの値も「処理中」を意味しない。
 */
const busySession = (session) => session.status === 'SESSION_STATUS_RUNNING';

const names = (item) => (item.labels ?? []).map((label) => label.name);

/** 本文の `Closes #N`。番号だけの参照では issue が閉じないので、ここでも見ない。 */
function closes(body) {
  return [...(body ?? '').matchAll(/closes\s+#(\d+)/gi)].map((match) => Number(match[1]));
}

/**
 * 画面が変わるのに `## 見た目` が無いか（`CLAUDE.md`「PR本文に置く節」）。**見るのはレビュアーでは
 * なく盤面**——差分の置き場も本文も機械で読めるので、レビュアーのセッションを1本使う手前で弾ける。
 *
 * 節はあるが中身が空のものも同じ扱い。画像も「不要」＋理由も無ければ、**後から補えるものが差分に
 * 残らない**（これが、本文の節のうちここだけを見る理由）。
 */
function missingLook(pr) {
  const shown = (pr.files ?? []).some(
    (file) => file.path.startsWith('src/game/') || file.path.startsWith('src/assets/'),
  );
  if (!shown) return false;
  const lines = (pr.body ?? '').split(/\r?\n/);
  const at = lines.findIndex((line) => /^##\s+見た目\s*$/.test(line));
  if (at < 0) return true;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim() === '';
}

/** チェックの一覧の色。**1つでも終わっていなければ `running`**（読むのはPRと `main` の両方）。 */
function color(roll) {
  if (roll.some((check) => check.status !== 'COMPLETED')) return 'running';
  const ok = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  return roll.every((check) => ok.has(check.conclusion)) ? 'green' : 'red';
}

/** 盤面を読んで、打つ手を優先順に並べる。 */
export function moves(input) {
  const taken = input.taken ?? {};
  /** 生きているワーカーの担当 issue のうち、**開いている一覧に載っていなかったもの**の状態（2.10）。 */
  const issueStates = input.issueStates ?? {};
  /** PRごとの、そのPRを書いたセッション（コミットの `Claude-Session:` トレーラ。2.11）。 */
  const prSessions = input.prSessions ?? {};

  const alive = (tag) => input.sessions.filter((session) => session.tags.includes(tag));
  const busy = (tag) => alive(tag).some(busySession);

  /**
   * 差し戻す相手（2.11）。引くのは**コミットの `Claude-Session:` トレーラ**——`Closes` は、そのPRで
   * どの issue が閉じるかの印であって、誰が書いたかを指していない。畳まれたセッションはここに
   * 居ないので、そのまま「起こせない」になる（1.2）。
   */
  function menders(pr) {
    const id = prSessions[String(pr.number)];
    return id === undefined ? [] : input.sessions.filter((session) => session.id === id);
  }

  /**
   * CIの色。**チェックが1つも登録されないPRがある**（`tests.yml` の `paths` に当たらない差分）ので、
   * 落ち着いてから緑と読む。まだ登録中なだけの場合と区別が付かないため。
   */
  function checks(pr) {
    const roll = pr.statusCheckRollup ?? [];
    if (roll.length === 0) return pr.updatedAt < input.settledBefore ? 'green' : 'running';
    return color(roll);
  }

  /**
   * `main` の先頭のCIの色（2.14）。**赤い間は `mend` を打たない**——`main` の赤はそれを取り込んだ
   * PRを全部赤くするので、作業者が何をしても緑にならない。指紋は push のたびに変わるから、
   * 差し戻しは押し返されるたびに新しい手として通り、止まらない。
   */
  const mainCheck = color(input.mainChecks ?? []);

  const merges = [];
  const archives = [];
  const mends = [];
  const stalls = [];
  const returns = [];
  const reviews = [];
  const tasks = [];
  const notes = [];

  // **古いものから捌く。** 一覧は新しい順に返るので、そのまま回すと**打つのは1周に1手**（`daemon.sh`）
  // なぶん、後から出たPRが毎周先に拾われて古いものが後回しになる。issue 側（下の `ready`）と同じ向き。
  for (const pr of [...input.prs].sort((a, b) => a.number - b.number)) {
    if (pr.isDraft === true) continue;
    const labels = names(pr);

    // **他のPRの上に積まれたPRは、盤面では捌けない。** CIは古い base の上で緑になり、レビューが読む
    // 差分にも下のPRの変更が混ざる（#1508 はこれで2周ぶん無駄にしている）。触らずに書き残すだけに
    // する。下が入ると `merge-and-close.sh` が `main` へ張り替えるが、**それで直るのは自動クローズ
    // だけ**で、差分もCIも載せ直すまで古いまま（あちらの「積まれたPRは…」）。
    if ((pr.baseRefName ?? 'main') !== 'main') {
      notes.push(`PR #${pr.number} は ${pr.baseRefName} の上に積まれている（下が入るまで触らない）`);
      continue;
    }

    const check = checks(pr);
    // **差し戻す種類は、起こされた側がやることで分ける**（1.3）。盤面から見た効き目（どれも
    // 「書いた本人を起こす」）で束ねると、渡す文面が1つになって作業が読めない。
    //
    // - `reject` … 通らなかった仮決めを取り下げて、別の決め方でやり直す
    // - `look`   … 画面を撮って本文へ貼る
    // - `mend`   … PRを見て直す（指摘・コンフリクト・CIの赤。**この3つは作業が同じ**なので束ねる）
    //
    // **どのラベルが付いていても差し戻す。** PRの `判断待ち` はマージを、`収束せず` はレビューを
    // 止めるだけで、直しを止める理由にはならない——コンフリクトの解消を人の返事まで待たせない（2.13）。
    const [kind, reason] = labels.includes('却下')
      ? ['reject', '仮決めが却下された']
      : missingLook(pr)
        ? ['look', '画面が変わるのに `## 見た目` が無い']
        : labels.includes('直し待ち')
          ? ['mend', '差し戻された']
          : pr.mergeable === 'CONFLICTING'
            ? ['mend', 'コンフリクトしている']
            : check === 'red'
              ? ['mend', 'CIが赤い']
              : [null, null];

    if (kind !== null) {
      // **`main` が赤い間は直しを頼まない**（2.14）。頼む先が居るかを調べる手前で止める——相手が
      // 誰であっても、直せないことは変わらない。`reject` と `look` は `main` の色と関わらない作業
      // （仮決めの取り下げ・画面の証跡）なので、そのまま出す。
      if (kind === 'mend' && mainCheck === 'red') {
        notes.push(`PR #${pr.number} は${reason}が、\`main\` が赤いので直しを頼まない`);
        continue;
      }
      // 直す相手は、そのPRを書いたセッション。**畳まれていれば起こせない**——畳むのは
      // 「この仕事は終わった」と判断した側の明示の操作なので、機械では戻さない（1.2）。
      const holders = menders(pr);
      if (holders.length === 0) {
        // **引けなかった理由を分ける。** 名乗っていないのは規則の破れ（2.11）で、直すのは人。
        // 畳まれているだけなら、盤面の側にできることは無い。
        const why =
          prSessions[String(pr.number)] === undefined
            ? '書いたセッションが名乗っていない'
            : '直す相手が畳まれている';
        notes.push(`PR #${pr.number} は${reason}が、${why}`);
        continue;
      }
      for (const holder of holders) {
        if (busySession(holder)) continue;
        // **指紋に種類を入れる。** セッションごとに1枠しか持たないので、同じ差分で別の種類を打つとき
        // （直しの後に却下が来る、など）に前の指紋と一致してしまい、後から来たほうが黙って落ちる。
        const mark = `${kind}:${pr.number}:${pr.headRefOid}`;
        if (taken[`resume:${holder.id}`] === mark) continue;
        mends.push(`RESUME ${holder.id} ${kind} ${pr.number} ${mark}`);
      }
      continue;
    }

    if (labels.includes('通してよい')) {
      // PRの `判断待ち` が止めるのはマージだけ（2.13）。越えるのは `merge-and-close.sh <PR> --user-ok`。
      if (labels.includes('判断待ち')) continue;
      if (check === 'green' && pr.mergeable === 'MERGEABLE') merges.push(`MERGE ${pr.number}`);
      continue;
    }

    // `収束せず` が止めるのはレビューだけ（2.13）。往復では決まらないと分かった差分へ、次の周を
    // 出さない——人が `通してよい` か `直し待ち` で答えるまで、この先へは進まない。
    if (labels.includes('収束せず')) continue;

    // 結論のラベルが無い＝この差分はまだ読まれていない（push で外れる。`board-labels.yml`）。
    if (check !== 'green') continue;
    // **マージできると分かるまで出さない。** `mergeable` は3値で、`main` が動くたびに開いているPRが
    // 全部 `UNKNOWN` へ落ち、GitHub が計算し直すまでそのまま。上の `CONFLICTING` だけで弾くと、
    // **その隙間に当たった周がコンフリクトしたままレビューへ出す**（#1538 が実際にそうなった。
    // 枝は動いていないのに、覚え書きが1周だけ消えた周でレビューへ出ている）。
    if (pr.mergeable !== 'MERGEABLE') continue;
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

  // 手が空いたセッションの行き先。**レビューは畳み**、ワーカーは**担当の issue がもう自分の仕事で
  // なければ畳んで**、まだ仕事なのにPRが出ていなければ起こす。どれも「手が空いている」ことが入口
  // なので、1つの走査で決める。
  for (const session of input.sessions) {
    if (busySession(session)) continue;

    // **レビューは、走り終わっていれば畳む**（2.10.3）。使い回さない設計（`dispatch-review.sh`）なので、
    // 手が止まった時点でもう誰も起こさない。**PRが開いているかは見ない**——`直し待ち` のまま戻って
    // こないPRのレビューも、畳めない理由は無い。
    const review = session.tags.find((tag) => tag.startsWith('review-'));
    if (review !== undefined) {
      const mark = `read:${review.slice('review-'.length)}`;
      if (taken[`archive:${session.id}`] !== mark) archives.push(`ARCHIVE ${session.id} ${mark}`);
      continue;
    }

    for (const tag of session.tags) {
      if (!tag.startsWith('task-')) continue;
      const held = tag.slice('task-'.length);
      const issue = Number(held);
      const open = input.issues.find((item) => item.number === issue);

      // **その issue がまだこのワーカーの仕事かは issue の側にある**（2.10）。**PRがマージされたか
      // では決めない**——手でマージされたPRの後片付けは走らないので、条件をそちらに繋ぐとワーカーが
      // 永久に残る。**畳んだ理由が読めるように、仕事でなくなった形ごとに指紋を分ける**（2.10.2）。
      const done =
        issueStates[held] === 'CLOSED'
          ? `closed:${issue}`
          : open !== undefined && names(open).includes('判断待ち')
            ? `returned:${issue}`
            : undefined;
      if (done !== undefined) {
        if (taken[`archive:${session.id}`] === done) break;
        archives.push(`ARCHIVE ${session.id} ${done}`);
        break;
      }

      // PRを出さないまま手が空いたセッション。**まず1回起こし、それでも何も出てこなければ人へ返す**
      // （2.15）。セッションが持つ指紋の枠は1つなので、`stall:` → `returned:` と進めば、どちらの手も
      // 二度は出ない。
      if (open === undefined) continue;
      if (input.prs.some((pr) => closes(pr.body).includes(issue))) continue;
      const woke = taken[`resume:${session.id}`];
      if (woke === `returned:${issue}`) continue;
      if (woke === `stall:${issue}`) {
        returns.push(`RETURN ${issue} ${session.id} returned:${issue}`);
        continue;
      }
      stalls.push(`RESUME ${session.id} stall ${issue} stall:${issue}`);
    }
  }

  // **並列度1**（3.1）。担当の交わりを計算する仕組みがまだ無いので、書くセッションは同時に1本まで。
  // レビューは書かないので数えない。
  const writing = input.sessions.filter((session) => session.tags.some((tag) => tag.startsWith('task-')));

  // **古いものから投入する。** 一覧は新しい順に返るので、そのまま使うと古い issue が永久に
  // 後回しになる（今 open な `task` は30件を超える）。
  const ready = [...input.issues]
    .sort((a, b) => a.number - b.number)
    .filter((issue) => names(issue).includes('task'))
    // 返ってきたものは、人が `判断待ち` を外すまで配らない（2.15）。**`task` は付いたまま**なので、
    // 人の手番は1タップで済む。**不変条件を持つのは投入する側**（1.4）で、ここはその写し。
    .filter((issue) => !names(issue).includes('判断待ち'))
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
  return [
    ...merges,
    ...archives,
    ...mends,
    ...stalls,
    ...returns,
    ...reviews,
    ...tasks,
    ...notes.map((note) => `NOTE ${note}`),
  ];
}
