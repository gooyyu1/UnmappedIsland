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
//   TASK    <issue番号> [<投入先の引数>]     … 引数が無ければクラウド（2.16）
//   NOTE    <人へ向けた1行>                  … 打つ手が無いことの説明。呼び手は記録するだけ
//
// **手を1行の文字列で返すのは、それがそのまま人の読む形だから。** `DRY_RUN` のログは この行を
// そのまま出す（[`daemon.sh`](daemon.sh) の「打たない手:」）ので、書式を持つ場所は1つで済む。
//
// 入力は次の形。
//
//   { "now": "<この周の時刻>",
//     "settledBefore": "<この時刻より前に止まっているPRは、チェック0本でも緑と読む>",
//     "mainChecks": [ { "status": "COMPLETED", "conclusion": "SUCCESS" } ],   … `main` の先頭のCI
//     "prs":      [ gh pr list --json number,isDraft,labels,mergeable,statusCheckRollup,updatedAt,headRefOid,baseRefName,body,files ],
//     "issues":   [ gh issue list --json number,labels,blockedBy ],
//     "sessions": [ { "id": "session_…", "status": "SESSION_STATUS_…",
//                     "bucket": "SESSION_STATUS_BUCKET_…", "env": "cloud | bridge | -",
//                     "tags": ["task-1"] } ],
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
 *
 * 手が空いてからの長さを覚えるのも同じ判定を使うので（[`board-round.mjs`](board-round.mjs)）、
 * ここから出す。**2箇所で書くと、片方だけが直る。**
 */
export const busySession = (session) => session.status === 'SESSION_STATUS_RUNNING';

/**
 * 手が空いたままこれだけ続いたら、停滞と読む（2.15.3）。**「手が空いている」ことそのものは停滞
 * ではない**——ワーカーは手番の切れ目ごとに空き、下請けのレビューを待つ間も空いて見える（1.6）。
 * **1度見ただけで停滞と読むと、押し切る寸前の作業を人へ返して畳む**（2026-09-06、issue #1506 の
 * ワーカーが「staging ready to push」のまま返却された）。
 *
 * **起こした後にも、同じ長さの窓をもう1つ空けてから返す。** 起こされたセッションが動き出すには
 * 時間が要るので、次の周（既定30秒）で見限ると、届いた合図が効く前に必ず返すことになる。
 */
const STALL_MINUTES = Number(process.env.STALL_MINUTES || 15);

/**
 * `env:<値>` が指す投入先（[`dispatch-task.sh`](dispatch-task.sh) へ渡す引数。2.16）。**盤面が
 * 宛先を知っている値の一覧はここだけ**——GitHub のラベルが在るかとは別で、人は盤面の知らない
 * `env:*` を作れる。ラベルの無い issue は `cloud` として引くので、既定も同じ表に載っている。
 */
const DISPATCH_TO = { cloud: '', bridge: '--bridge' };

/**
 * 同時に走ってよい**書くセッション**の数（3.1。**値は仮決め**）。錠を持たない issue はいくらでも
 * 並ぶので、**手綱はここにしか無い**。
 *
 * **2.5.2 の「残り余力と1本あたりの消費の比較」が入っても外さない**——残量だけを見て決めると、
 * 余力のある周に一度に何本も立つ。
 */
const WRITERS = 3;

/** `task-<番号>` のタグから担当の issue 番号を引く。持っていなければ `undefined`。 */
function heldIssue(session) {
  for (const tag of session.tags) {
    const match = /^task-(\d+)$/.exec(tag);
    if (match !== null) return Number(match[1]);
  }
  return undefined;
}

/**
 * その issue が取る**錠**（`area:` のラベル。[`parallel-work.md`](../../.claude/parallel-work.md) 2節）。
 * **同時に1本しか動かせない資源**を指すので、同じ錠を持つ issue は並べて投入しない。
 *
 * **投入を止めるのはこれだけ。** 同じファイルを2本が書くことは止めない——盤面にできるのは投入を
 * 遅らせることだけで、担当に挙がっているファイルは受け取った側がどのみち書く。ぶつかれば
 * コンフリクトとして出て、盤面は `mend` で直させ、**[`board-round.mjs`](board-round.mjs) が
 * 何とぶつかったかを控える**（3.1）。
 */
const locks = (issue) =>
  (issue.labels ?? []).map((label) => label.name).filter((name) => name.startsWith('area:'));

/** その issue が要求する環境（`env:` のラベル。無ければクラウド）。**重ねて付いていれば `undefined`。** */
function wantedEnv(issue) {
  const marks = (issue.labels ?? []).map((label) => label.name).filter((name) => name.startsWith('env:'));
  if (marks.length > 1) return undefined;
  return marks.length === 0 ? 'cloud' : marks[0].slice('env:'.length);
}

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
   * 手が空いてから経った分（`STALL_MINUTES` の説明）。空いた時刻を覚えるのは呼び手
   * （[`board-round.mjs`](board-round.mjs)）で、**動き出せばその記録は消える**。
   *
   * **覚えが無ければ0**——この周に空いたばかりか、まだ一度も見ていないかのどちらかで、どちらも
   * 「続いている」とは言えない。**引けなかったときに動かない側へ倒す**のは、ここで打つ手が
   * どちらも取り返しの付かないもの（人へ返す・畳む）だから。
   */
  function idleMinutes(session) {
    const since = Date.parse(taken[`idle:${session.id}`] ?? '');
    const at = Date.parse(input.now ?? '');
    return Number.isNaN(since) || Number.isNaN(at) ? 0 : (at - since) / 60_000;
  }

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
   * その仕事がワーカーの手を離れた形（2.10.2）。まだ持っているなら `undefined`。**呼ぶのは手が
   * 空いているワーカーに対してだけ**——走っている最中のセッションは、どの形でも畳まない。
   */
  function leaving(session, issue, open) {
    if (issueStates[String(issue)] === 'CLOSED') return `closed:${issue}`;
    if (open === undefined) return undefined;
    if (names(open).includes('判断待ち')) return `returned:${issue}`;

    // **走らせる先が食い違ったら、そこはこの仕事の場所ではない**（2.16.2）。畳めば次の周に配り直され、
    // 正しい環境で立ち上がる。
    //
    // **PRを出した後のワーカーは動かさない。** 配り直しても `dispatch-task.sh` が既に開いている
    // PRを見て止めるだけで、**畳んだぶん、そのPRの直しを頼む相手が居なくなる**（2.11）。
    if (input.prs.some((pr) => closes(pr.body).includes(issue))) return undefined;
    const where = wantedEnv(open);
    // **配り直す先が無いなら動かさない。** 知らない宛先も `env:` の重なりも、畳んだところで
    // 次の周は投入で止まる——空いた枠を無駄にするだけで、直るのは人が触ったとき。
    if (where === undefined || DISPATCH_TO[where] === undefined) return undefined;
    // **畳めるのはクラウドのセッションだけ。** [`archive-session.sh`](archive-session.sh) は
    // ブリッジのセッションを必ず `KEPT` にするので、出しても畳まれず**指紋だけが残り、そのワーカーは
    // 二度と起こされず人へも返らなくなる**。`env:` の付かない issue をブリッジで走らせる形は実在
    // する（棚卸し役・手元からの投入）ので、既定の `cloud` との食い違いがそのまま当たる。
    //
    // **環境を引けなかったもの（`-`）もここで外れる。** 知らないことを「違う」として読むと、
    // 正しく走っているセッションを畳む（`live-sessions.mjs` の「知らない環境は `-`」）。
    if (session.env !== 'cloud') return undefined;
    return where === 'cloud' ? undefined : `moved:${issue}`;
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
    // **指紋が言えるのは「この差分を出した」までで、「読まれた」ではない。** 読み手がもう居ない
    // のに出したことを読まれたことと読むと、判定を書かずに終わったレビューがそのPRを永久に止める
    // （issue #1569。畳まれた理由が何であれ同じ）。**居るなら読んでいる最中**——畳むのは 2.10.3 の側。
    const sent = taken[`review:${pr.number}`] === pr.headRefOid;
    if (sent && alive(`review-${pr.number}`).length > 0) {
      notes.push(`PR #${pr.number} はレビューが読んでいる最中で、結論のラベルはまだ無い`);
      continue;
    }
    if (sent) notes.push(`PR #${pr.number} のレビューは判定を書かずに終わったので、もう一度出す`);
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
    //
    // **ただし「走り終わった」と「道具の承認を待っている」は同じ形に見える**（1.6）。ワーカーと
    // 同じく、空いたままが `STALL_MINUTES` 続いてから畳む——30秒で畳んだ盤面は、承認を求めて
    // 止まったレビューを判定を書く前に消し、そのPRを永久に止めた（2026-09-06、PR #1573。
    // 要約は `Waiting on permission: Bash`。issue #1569）。
    const review = session.tags.find((tag) => tag.startsWith('review-'));
    if (review !== undefined) {
      if (idleMinutes(session) < STALL_MINUTES) continue;
      const mark = `read:${review.slice('review-'.length)}`;
      if (taken[`archive:${session.id}`] !== mark) archives.push(`ARCHIVE ${session.id} ${mark}`);
      continue;
    }

    for (const tag of session.tags) {
      if (!tag.startsWith('task-')) continue;
      const issue = Number(tag.slice('task-'.length));
      const open = input.issues.find((item) => item.number === issue);

      // **その issue がまだこのワーカーの仕事かは issue の側にある**（2.10）。**PRがマージされたか
      // では決めない**——手でマージされたPRの後片付けは走らないので、条件をそちらに繋ぐとワーカーが
      // 永久に残る。**畳んだ理由が読めるように、仕事でなくなった形ごとに指紋を分ける**（2.10.2）。
      const done = leaving(session, issue, open);
      if (done !== undefined) {
        if (taken[`archive:${session.id}`] === done) break;
        archives.push(`ARCHIVE ${session.id} ${done}`);
        break;
      }

      // PRを出さないまま**手が空いたままになった**セッション。**まず1回起こし、それでも何も
      // 出てこなければ人へ返す**（2.15）。セッションが持つ指紋の枠は1つなので、`stall:` →
      // `returned:` と進めば、どちらの手も二度は出ない。
      if (open === undefined) continue;
      if (input.prs.some((pr) => closes(pr.body).includes(issue))) continue;
      // **空いていることではなく、空いたままであることが入口**（`STALL_MINUTES`）。
      const idle = idleMinutes(session);
      if (idle < STALL_MINUTES) continue;
      const woke = taken[`resume:${session.id}`];
      if (woke === `returned:${issue}`) continue;
      if (woke === `stall:${issue}`) {
        // 起こしてからも同じだけ空いたまま。**動き出していれば `stall:` は消えている**ので
        // （`board-round.mjs`）、ここへ来るのは合図が効かなかったものだけ。
        if (idle >= STALL_MINUTES * 2) returns.push(`RETURN ${issue} ${session.id} returned:${issue}`);
        continue;
      }
      stalls.push(`RESUME ${session.id} stall ${issue} stall:${issue}`);
    }
  }

  // **並べてよいかは、錠と本数で決める**（3.1・`parallel-work.md` 2節）。レビューは書かないので
  // 数えない。
  const holders = input.sessions
    .map((session) => ({ session, number: heldIssue(session) }))
    .filter((holder) => holder.number !== undefined)
    .map((holder) => ({
      ...holder,
      issue: input.issues.find((issue) => issue.number === holder.number),
    }));

  // **本数を数える側からだけ、仕事の終わったワーカーを外す。** 担当が閉じているなら次の仕事は
  // 持たない（2.10。畳むのは `ARCHIVE` だが、**走っている間は畳めない**ので、待つと枠が空かない）。
  //
  // **錠の側では外さない**——閉じていても、走っている限り資源は掴んだまま。担当が読めないので
  // 錠も引けず、下の `waitingFor` が「読めない」として止める。
  const held = holders.filter(
    (holder) => holder.issue !== undefined || issueStates[String(holder.number)] !== 'CLOSED',
  );

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

  /**
   * その issue をどこへ投入するか（`dispatch-task.sh` の引数）。**知らない `env:*` は配らない**
   * ——既定のクラウドへ落とすと、**そこでしかできないから宛先を書いた仕事が黙って別の場所で走り、
   * 指定が無視されたことが誰にも残らない**。返す `undefined` は「配れない」。
   */
  function destination(issue) {
    const where = wantedEnv(issue);
    if (where === undefined) {
      notes.push(`issue #${issue.number} に \`env:\` が重ねて付いている`);
      return undefined;
    }
    const flag = DISPATCH_TO[where];
    if (flag === undefined) notes.push(`issue #${issue.number} の \`env:${where}\` は知らない宛先`);
    return flag;
  }

  /** その issue を今は出せない理由（出せるなら `undefined`）。 */
  function waitingFor(issue) {
    const mine = locks(issue);
    if (mine.length === 0) return undefined;
    for (const holder of holders) {
      // **素性を引けなかった相手の後ろでは、錠を持つ issue を出さない。** 相手が同じ錠を持って
      // いないことを確かめられないので、資源を2本で取り合う形が通ってしまう。
      if (holder.issue === undefined) return `${holder.session.id} の担当（#${holder.number}）が読めない`;
      const lock = mine.find((name) => locks(holder.issue).includes(name));
      if (lock !== undefined) return `#${issue.number} と #${holder.number} が \`${lock}\` を取り合う`;
    }
    return undefined;
  }

  // **待たせている理由を毎周書く。** 起こしても動かないセッションが1本残ると、`stall` は指紋で
  // 1回しか出ないので、黙ったまま TASK が永久に止まる。ログに何も出ないと「やることが無い周」と
  // 見分けが付かない。**打つのは1周に1手**なので、書くのは先頭が待っている理由でよい。
  const waiting = [];
  if (held.length >= WRITERS) {
    if (ready.length > 0) {
      notes.push(`${ready.length}件の task が、書くセッション${WRITERS}本の空きを待っている`);
    }
  } else {
    for (const issue of ready) {
      const why = waitingFor(issue);
      if (why !== undefined) {
        waiting.push(why);
        continue;
      }
      const flag = destination(issue);
      if (flag === undefined) continue;
      tasks.push(flag === '' ? `TASK ${issue.number}` : `TASK ${issue.number} ${flag}`);
    }
    if (tasks.length === 0 && waiting.length > 0) {
      notes.push(`${waiting.length}件の task が待っている。先頭は ${waiting[0]}`);
    }
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
