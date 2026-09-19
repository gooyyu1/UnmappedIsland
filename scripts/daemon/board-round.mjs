// 盤面の1周。**引き、手を1つ打つ。** 待つことと二重に立たないことは
// [`daemon.sh`](daemon.sh)、盤面を組むのは [`board-read.mjs`](board-read.mjs)、手を決めるのは
// [`board-move.mjs`](board-move.mjs)。ここがやるのは**打つこと**と、その記録だけ。
//
//   node scripts/daemon/board-round.mjs         # 1周。引けなければ終了コード1
//   DRY_RUN=1 node scripts/daemon/board-round.mjs
//
// ## 打つのは1周に1手
//
// マージが1本入れば他のPRのコンフリクトや `blockedBy` が動くので、盤面は打つたびに変わる。
// **同じ周に2手目を打つと、変わる前の盤面で決めた手を打つことになる。**
//
// 上から順に、**打てた最初の1手**で切り上げる。打てなかった手（手綱で止まっている・相手が
// 動き出した）で周ごと止めると、止まっている種類と関係のない手まで巻き添えになる。
//
// ## 1周をプロセス1つに収める
//
// 引く・決める・打つを1つの node の中で済ませるのは、**Windowsではプロセス生成が1回10〜30ms
// かかる**ため（#1545 の実測）。デーモンは1周ごとにここを通るので、境界の数がそのまま常時の
// 固定費になる。**外へ出るのは、外の道具を叩くときだけ**——`gh` と、隣のスクリプト。
//
// 外を触る手（`runScript`・`gh`・一覧）と、出す先（`log`・`echo`）を引数で受けるのは、**実物を
// 起こさずに検査するため**。既定は本物なので、コマンドとして呼ぶ側は何も渡さなくてよい。

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MENDS, STRANDS, TAKEOVER, busySession, moves } from './board-move.mjs';
import { MERGED_WINDOW_HOURS, readBoard } from './board-read.mjs';
import {
  NOTE_PREFIX,
  PARTIAL_PREFIX,
  UNREADABLE,
  UNREADABLE_REASON,
  UNREADABLE_ROUNDS,
  UNREADABLE_UNTIL,
  appendRound,
  boardState,
  readLedger,
  writeLedger,
} from './board-state.mjs';
import { formatLive, liveSessions } from './live-sessions.mjs';
import { gh as runGh, posix, runBash } from './spawn.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * ぶつかった実績の帳面（1行1件のJSON。`agent-ops/board-design.md` 3.1）。**盤面は同じファイルを書く
 * issue を並べて投入する**ので、実際にぶつかった組を控えておかないと、`area:` の錠を足すべき資源が
 * 後から分からない。**手ではない**——打つ手が何であっても、見えたものをその周のうちに書く。
 */
const conflictsPath = (stateDir) => join(stateDir, 'conflicts.jsonl');

const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * ログは1行1件で、頭に時刻が付く（`daemon.sh` と同じ形）。**書き込みは同期で行う**——叩いた
 * スクリプトの出力はこちらの標準出力へ直に流れるので、非同期に貯めると打った手とその結果が
 * 入れ替わって並ぶ。
 */
const defaultLog = (line) => writeSync(1, `${stamp()} ${line}\n`);
const defaultEcho = (text) => writeSync(1, text);
const defaultWarn = (line) => writeSync(2, `${line}\n`);

/** 隣のスクリプトを1本叩く。 */
const defaultRunScript = (name, args, options) => runBash(join(HERE, name), args, options);

/**
 * **盤面を引けなくなった時刻**を控える（`board-state.mjs` の `UNREADABLE`）。**読むのは人**
 * ——引けない周にデーモンが打てる手は無い（`agent-ops/board-design.md` 2.21.1）。
 *
 * **始まりだけを覚える。** 毎周書き直すと、続いた長さが出せない。
 *
 * **終わり・周の数・道具が言った理由は毎周上書きする。** 始まりだけでは、読む人に届くのが
 * 「引けていない」までで止まる——**何周ぶんか**は待つ間隔が環境変数で動くので長さからは出せず、
 * **理由**を言えるのは引きに行った道具だけ（2.20.3）。
 *
 * **その周に出ていた断りは落とす。** あれは「今その周に出ている」ものとして人へ出る（2.20.3）が、
 * **引けない周は覚え書きを1つも出せない**ので、残すと**最後に引けた周のものが今のこととして出続け、
 * 続いている長さまで伸びる。** 直った周に出し直すので、失うのは区間をまたいだ長さだけ——**引けて
 * いない間はまだ詰まっているかも言えない**のだから、そこで数え直すのが正しい。
 */
function markUnreadable(stateDir, at, reason) {
  const taken = readLedger(stateDir);
  taken[UNREADABLE] ??= at;
  taken[UNREADABLE_UNTIL] = at;
  taken[UNREADABLE_ROUNDS] = String(Number(taken[UNREADABLE_ROUNDS] ?? 0) + 1);
  taken[UNREADABLE_REASON] = reason;
  writeLedger(stateDir, trackNotes(trackNotes(taken, NOTE_PREFIX, [], at), PARTIAL_PREFIX, [], at));
}

/**
 * 引けた周に、**引けなかった区間を1件として帳面へ閉じる**（`board-state.mjs` の `journalPath`）。
 *
 * **印を消すだけにしない。** 直った周に台帳から消えるので、**後から立った見回りには、在ったこと
 * すら分からない**（2026-09-18 に実測。同じ日に331分ぶん止まっていたのに、印は1つも残っていな
 * かった）。**猶予（2.22.2）を詰める材料もこれ**——値の見回りが告げる手前で直る停止は、ここに
 * 残さないとどこにも数が出ない。
 *
 * **`DRY_RUN` の周も書く。** ぶつかった実績の帳面（下の `newConflicts`）が `DRY_RUN` で書かないのは、
 * **指紋を埋めると本番の周でも二度と記録されない**から。こちらは逆で、**`DRY_RUN` の周も印は消える**
 * （台帳はこの下で書き直される）ので、書かないほうが測定を消すことになる。
 */
function closeUnreadable(stateDir, taken, at) {
  const since = taken[UNREADABLE];
  if (since === undefined) return;
  appendRound(stateDir, {
    at,
    kind: 'gap',
    from: since,
    until: taken[UNREADABLE_UNTIL] ?? since,
    rounds: Number(taken[UNREADABLE_ROUNDS] ?? 1),
    reason: taken[UNREADABLE_REASON] ?? '',
  });
  for (const key of [UNREADABLE, UNREADABLE_UNTIL, UNREADABLE_ROUNDS, UNREADABLE_REASON]) {
    delete taken[key];
  }
}

/**
 * その周に出ていた断り（`board-move.mjs` の `NOTE`＝**配れない理由**と、`board-read.mjs` の
 * `sayIncomplete`＝**この周の盤面が欠けている理由**）を、出始めた時刻とともに台帳へ写す。
 * 分けて持つ理由は `board-state.mjs` の `PARTIAL_PREFIX`。
 *
 * **消えた断りは落とし、続いている断りの時刻は動かさない。** 毎周書き直すと、読む人に届くのが
 * 「今はこうだ」までで止まる——**1周ぶんの覚え書きは「やることが無い周」と見分けが付かない**ので、
 * **同じ理由が何分続いているか**が、詰まりの合図そのもの（2.20.3）。
 */
export function trackNotes(taken, prefix, notes, now) {
  const marked = {};
  for (const [key, mark] of Object.entries(taken)) {
    if (!key.startsWith(prefix)) marked[key] = mark;
  }
  for (const note of notes) {
    const key = `${prefix}${note}`;
    marked[key] = taken[key] ?? now;
  }
  return marked;
}

/** 帳面に既に載っている `<PR>:<先頭コミット>`。読めない周は空（帳面がまだ無い周と同じ）。 */
function writtenConflicts(stateDir) {
  let text;
  try {
    text = readFileSync(conflictsPath(stateDir), 'utf8');
  } catch {
    return new Set();
  }
  const keys = new Set();
  for (const line of text.split('\n')) {
    if (line === '') continue;
    // 壊れた行は無かったことにする。**取りこぼす害は同じ組を二度書くことだけ**なので、
    // 帳面ごと諦めるより軽い。
    try {
      const record = JSON.parse(line);
      keys.add(`${record.pr}:${record.head}`);
    } catch {
      continue;
    }
  }
  return keys;
}

/** [`describe-conflict.sh`](describe-conflict.sh) の出力。調べられなければ `undefined`。 */
function describeConflict(runScript, number) {
  const out = runScript('describe-conflict.sh', [String(number)], { capture: true });
  if (out.status !== 0) return undefined;
  const files = [];
  const rivals = [];
  for (const line of out.stdout.split(/\r?\n/)) {
    if (line.startsWith('FILE ')) files.push(line.slice('FILE '.length));
    else if (line.startsWith('WITH ')) rivals.push(Number(line.slice('WITH '.length)));
  }
  return { files, with: rivals };
}

/**
 * この周で新しく見えたコンフリクトの記録。**同じ差分は一度だけ**——押し返されるまで盤面は
 * `CONFLICTING` を返し続けるので、`<PR>:<先頭コミット>` を控えて突き合わせる（打つ手の指紋と同じ形）。
 *
 * `describe` は「そのPRが何のファイルで・どのPRとぶつかったか」を返す
 * （[`describe-conflict.sh`](describe-conflict.sh)）。**調べられなかったものは書かない**——次の周に
 * 調べ直せるよう、指紋を埋めずに残す。**恒久的に調べられないPRは、開いている限り毎周 `git fetch` を
 * 払い続ける**（枝の消えた fork など）。失敗の大半は一時的（認証・通信）なので、回数を数える台帳を
 * 増やすより安いと見た。
 *
 * **併合し直せてしまったものは、空のまま書く。** GitHub の `mergeable` は `main` が動くたびに
 * 古くなるので、`CONFLICTING` と言われた差分が手元では綺麗に併合できることがある。**これは調べた
 * 結果であって失敗ではない**ので、指紋を埋めて次の周から見ない（`ARCHIVE` の `KEPT` と同じ形）。
 */
export function newConflicts(prs, written, describe, at) {
  const records = [];
  for (const pr of prs) {
    if (pr.mergeable !== 'CONFLICTING') continue;
    // **他のPRの上に積まれたPRは数えない。** GitHub が見ているのはその base との衝突で、
    // `describe-conflict.sh` が調べる `main` との衝突とは別物。
    if ((pr.baseRefName ?? 'main') !== 'main') continue;
    const head = pr.headRefOid;
    if (written.has(`${pr.number}:${head}`)) continue;
    const found = describe(pr.number);
    if (found === undefined) continue;
    records.push({ at, pr: pr.number, head, files: found.files, with: found.with });
  }
  return records;
}

/**
 * 消えたPR・畳まれたセッションの記録は捨てる。残すと、番号が回り込んだときに古い指紋が効く。
 *
 * **`cycle:` だけは残す。** あれは盤面の何かに紐づく指紋ではなく、**周期の係を前に立てた時刻**
 * （`board-move.mjs` の `CYCLES`）。捨てると、次の周に間隔が満ちていないものまで立つ。
 *
 * **`unreadable:` も残す。** あれは盤面の何かに紐づく指紋ではなく、**盤面を引けなくなった時刻**
 * （`board-state.mjs` の `UNREADABLE`）。捨てると、続いた長さが毎周0へ戻る。
 *
 * **`note:` と `partial:` も残す。** あれは**その断りが出始めた時刻**（同 `NOTE_PREFIX`・
 * `PARTIAL_PREFIX`）で、落とすのはその断りが出なくなった周（下の `trackNotes`）。ここで捨てると、
 * 続いた長さが毎周0へ戻る。
 *
 * **`tidy:` は時刻で捨てる。** 後片付けの相手はマージ済みのPRで、開いているPRの一覧には載らない
 * ——**引けなかった周を「1件も無い」と読むと、その周に全部の覚えが消える**（次の周、窓に入って
 * いるぶんが丸ごと打ち直される）。指紋は打った時刻なので、**窓（`MERGED_WINDOW_HOURS`）を過ぎた
 * ものだけを捨てれば、盤面が相手として見ているあいだは必ず残っている。**
 */
export function pruneTaken(taken, board) {
  const ids = new Set(board.sessions.map((session) => session.id));
  const numbers = new Set(board.prs.map((pr) => String(pr.number)));
  const tidyFrom = Date.parse(board.now) - MERGED_WINDOW_HOURS * 3_600_000;
  const kept = {};
  for (const [key, mark] of Object.entries(taken)) {
    const lives =
      key.startsWith('cycle:') ||
      key.startsWith('unreadable:') ||
      key.startsWith(NOTE_PREFIX) ||
      key.startsWith(PARTIAL_PREFIX) ||
      (key.startsWith('tidy:') && Date.parse(mark) >= tidyFrom) ||
      (key.startsWith('resume:') && ids.has(key.slice('resume:'.length))) ||
      (key.startsWith('review:') && numbers.has(key.slice('review:'.length))) ||
      (key.startsWith('archive:') && ids.has(key.slice('archive:'.length))) ||
      (key.startsWith('idle:') && ids.has(key.slice('idle:'.length)));
    if (lives) kept[key] = mark;
  }
  return kept;
}

/**
 * **手が空いたのはいつからか**を覚える（`board-move.mjs` の `STALL_MINUTES`）。停滞を「空いて
 * いること」で読むと、手番の切れ目ごとに空くワーカーを毎回停滞と読む——盤面はそれで、押し切る
 * 寸前の作業を人へ返して畳んだ（2026-09-06、issue #1506）。
 *
 * **動き出したら、覚えも「起こしたが動かなかった」の記録も消す。** 動いた時点でどちらも嘘に
 * なるので、残すと**次に空いた瞬間に、起こす手順を飛ばして人へ返す**ことになる。
 */
export function trackIdle(taken, board, now) {
  const marked = { ...taken };
  for (const session of board.sessions) {
    const idle = `idle:${session.id}`;
    const resume = `resume:${session.id}`;
    if (busySession(session)) {
      delete marked[idle];
      if ((marked[resume] ?? '').startsWith('stall:')) delete marked[resume];
      continue;
    }
    marked[idle] ??= now;
  }
  return marked;
}

/**
 * 人へ返すときに issue へ置くコメント。**1行目が返却の宣言**で、ここを読んでラベルを動かすのは
 * [`board-labels.yml`](../../.github/workflows/board-labels.yml)——**ワーカーが自分で返すときと同じ道**
 * （`agent-ops/board-design.md` 2.15）。ラベルを盤面から直に触らないので、返す経路が2つに割れない。
 *
 * **返す理由ごとに文面を分ける**（2.11.4）。**人がすることが返す形ごとに違う**ので、1つの文面に
 * 畳むと**読んだ人が手を入れる先を間違える。**
 *
 * - **起こしても動かなかったワーカー**（2.15.3）… 投入し直せば進む
 * - **宛先の無いPRを抱えた担当**（2.11.4）… そのPRを直さないかぎり、何度投入しても同じところで止まる
 * - **頼み終えた差し戻しが戻ってこないPR**（2.13.6）… 宛先は居るが動かない。**直しを引き取るか、
 *   PRを閉じるまで、そのPRの版は動かない**
 */
function returnBody(session, issue, cause) {
  // **綴りは最後の `:` で割る。** 差し戻しの理由（`board-move.mjs` の `MENDS`）は綴りそのものに
  // `:` を持つ（`mend:red`）ので、頭から割ると理由が切れる。
  const at = String(cause ?? '').lastIndexOf(':');
  const kind = at < 0 ? '' : String(cause).slice(0, at);
  const number = at < 0 ? '' : String(cause).slice(at + 1);
  const mend = MENDS[kind];
  if (mend !== undefined)
    return `[返却] PR #${number} の直しを頼んでも、戻ってこない

この issue のPR（#${number}）は**${mend.why}**ので、盤面は書いた本人のセッション（\`${session}\`）へ
直しを頼みました。**それから手が動かないまま、そのPRも変わっていません**——**盤面がこの版へ打てる手は
尽きました**（\`agent-ops/board-design.md\` 2.13.6）。

**直すには**: ${TAKEOVER[mend.kind]}。

手が動き出したら、この issue（#${issue}）から \`判断待ち\` を外してください。
`;
  const strand = STRANDS[kind];
  if (strand === undefined)
    return `[返却] 起こしても手が動かなかった

担当していたセッション（\`${session}\`）は、PRを出さないまま手が空いた状態が続き、盤面が一度
起こしても何も出てきませんでした。**返却の宣言は届いていません**——止まった理由はここには書けません。

同じ内容でもう一度投入するなら、この issue（#${issue}）から \`判断待ち\` を外してください。
`;
  return `[返却] PR #${number} の直しを頼む相手を引けない

この issue のPR（#${number}）は、コミットの \`Claude-Session:\` の名乗りから差し戻す相手を引けません
——**${strand.why}**。盤面はこのPRをレビューへもマージへも差し戻しへも出せないので、担当していた
セッション（\`${session}\`）に枠と錠を握らせたままにせず、ここで返します。

**直すには**: ${strand.fix}。

PRが動き出したら、この issue（#${issue}）から \`判断待ち\` を外してください。
`;
}

/**
 * **前の差分の札を落としてほしい**とPRへ頼む1行目（`board-move.mjs` の `UNLABEL`。
 * `agent-ops/board-design.md` 2.13.7）。読んで札を動かすのは
 * [`board-labels.yml`](../../.github/workflows/board-labels.yml) の `swept`——**外すのはあちらだけ**
 * （こちらが外すと `却下` になる。下の `play` の `UNLABEL`）。
 *
 * **綴りはあちらと揃っていること。** Actions には node を持ち込めないので実装は別で、
 * 突き合わせは検査が持つ（`tests/scripts/boardLabels.test.ts`）。
 */
export const SWEEP_LINE = '[札] 前の差分の結論を落とす';

/**
 * その頼みの本文。**なぜ落ちるのかを書くのは、読むのが人だから**——札が消えた理由の置き場は
 * コメントしか無い（ラベルは事実しか持たない。1.3）。
 */
const sweepBody = (head) =>
  `${SWEEP_LINE}

このPRに付いている結論の札は、**前の差分に付いたもの**です。判定のコメントはどれも、今の頭
（\`${head}\`）とは別の版を名乗っています。push で落ちるはずのものが残っているので、落とし直します
（[\`board-design.md\`](../agent-ops/board-design.md) 2.13.7）。

**直しが要るかどうかは、これで変わりません**——次の周でレビューが読み直します。
`;

/**
 * 1手の結果。**「打てなかった」を、直す相手が要る分（`FAILED`）と、答えが返っている分
 * （`SETTLED`）に割る**——人が手綱で止めている・畳んではいけないと分かった、など。
 *
 * **割るのは、ログを読む側のため。** 盤面を見回る係（`board-move.mjs` の `CYCLES` の `patrol`）は
 * `~/daemon.log` から「何が止まっているか」を読むので、**直す相手の居ない手が転んで見えると、
 * 毎回そこを調べに行く**（`agent-ops/board-design.md` 2.21.2）。
 */
export const PLAYED = 'played';
export const FAILED = 'failed';
export const SETTLED = 'settled';

/**
 * セッションを立てる・起こすスクリプトが、**打てない理由に答えが返っていることを名乗る**終了コード。
 * 綴りを持つのは名乗る側で、ここはその読み手。
 *
 * - `3` … 人が手綱で止めている（[`brake.sh`](brake.sh)）。人が外すまで戻らない。立てる側も起こす側も出す
 * - `4` … 使用量の余力が足りない（[`headroom.sh`](headroom.sh)）。枠が明ければひとりでに戻る。
 *   **立てる側も起こす側も出す**——モデルを使わせてよいかは同じ関門
 *   （[`may-spend.sh`](may-spend.sh)）に訊く（`agent-ops/board-design.md` 2.5.2）
 *
 * **どちらも直す相手が居ない**ので `SETTLED`。**打つ手は違うが、それを読むのはログを見る人**で、
 * 理由の行はそれぞれのスクリプトが標準エラーへ出している。
 */
const ANSWERED_EXITS = new Set([3, 4]);

/** 投入・再開のスクリプトの終了コードを、1手の結果へ読み替える。 */
const dispatched = (status) => (status === 0 ? PLAYED : ANSWERED_EXITS.has(status) ? SETTLED : FAILED);

/** 1手打つ。打てたら `PLAYED`（呼び手は周を切り上げる）、それ以外は次の手へ進む。 */
export function play(kind, args, { runScript, gh, remember, log, echo }) {
  const [a = '', b = '', c = '', d = ''] = args;
  switch (kind) {
    case 'TIDY': {
      // 終了コード2は「後片付けに残りがある」。手は打てているので、次の周は別の手へ進む
      // ——**残りの多くは打ち直しても同じ結果になる**（本体が汚れている・`Closes` が閉じ損ねている）。
      const code = runScript('tidy-merged-pr.sh', [a]).status;
      if (code !== 0 && code !== 2) return FAILED;
      remember(`tidy:${a}`, b);
      return PLAYED;
    }
    case 'MERGE': {
      return runScript('merge-pr.sh', [a]).status === 0 ? PLAYED : FAILED;
    }
    case 'RESUME': {
      const result = dispatched(runScript('resume-session.sh', [a, b, c]).status);
      if (result !== PLAYED) return result;
      remember(`resume:${a}`, d);
      return PLAYED;
    }
    case 'RETURN': {
      // 本文は複数行なので、引数ではなくファイルで渡す。**`gh` は Windows のバイナリ**なので、
      // そのパスは `posix()` を通さない生のまま（あれはシェルへ渡すときの作法）。
      const work = mkdtempSync(join(tmpdir(), 'board-round-'));
      try {
        const body = join(work, 'return.md');
        writeFileSync(body, returnBody(b, a, d));
        if (gh(['issue', 'comment', a, '--body-file', body]) === undefined) return FAILED;
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
      remember(`resume:${b}`, c);
      return PLAYED;
    }
    case 'REVIEW': {
      const result = dispatched(runScript('dispatch-review.sh', [a]).status);
      if (result !== PLAYED) return result;
      remember(`review:${a}`, b);
      return PLAYED;
    }
    case 'UNLABEL': {
      // **札を外すのはワークフローだけ**（`board-labels.yml` の `swept`）。ここが
      // `gh pr edit --remove-label` を打つと、それが `unlabeled` の出来事になり、
      // **あちらの `unlabeled_by_hand` が「人が外した」と読んで `却下` を付ける**——見分けは
      // `sender` で、デーモンの `gh` は人と同じアカウントを使う（2.2.1）。**頼む形で残す。**
      const work = mkdtempSync(join(tmpdir(), 'board-round-'));
      try {
        const body = join(work, 'sweep.md');
        writeFileSync(body, sweepBody(b));
        if (gh(['pr', 'comment', a, '--body-file', body]) === undefined) return FAILED;
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
      // **指紋を残さない。** 頼んだことを覚えて二度目を出さないようにすると、**頼む先が転んだ回に
      // 札が残ったまま素通りする**（`board-move.mjs` の `UNLABEL`）。同じ手が何度も出ないことは、
      // **頼みのコメントで `updatedAt` が動く**ことで足りている（あちらの「落ち着くまでは頼まない」）。
      return PLAYED;
    }
    case 'ARCHIVE': {
      // 畳んでよいかの判定は [`archive-session.sh`](archive-session.sh) が持つ。**終了コードは見ない**
      // ——あちらは1件ずつの結果を行で返す。`--keep-untagged` は、ここへ来る相手が必ずワーカーか
      // レビューか周期の係であること（盤面の側の約束）を、畳む手前でもう一度確かめるため。
      const out = runScript('archive-session.sh', ['--keep-untagged', 'task-,review-,chore-'], {
        input: `${a}\n`,
        capture: true,
      });
      if (out.status !== 0) return FAILED;
      echo(`${out.stdout.replace(/\n+$/, '')}\n`);

      const verdicts = out.stdout.split(/\r?\n/);
      if (verdicts.includes(`ARCHIVED ${a}`)) return PLAYED;
      // `KEPT` は「畳んではいけない」という**安定した答え**（接頭辞に当たるタグを持たないもの）。
      // 指紋を残さないと、**1周1手のうちの1手がこれで埋まり続ける。** `UNARCHIVED`（打って失敗）と
      // `UNKNOWN`（素性を引けなかった）は答えではないので残さず、次の周にもう一度試す。
      if (verdicts.includes(`KEPT ${a}`)) {
        remember(`archive:${a}`, b);
        return SETTLED;
      }
      return FAILED;
    }
    case 'TASK': {
      // **補足は無い。** 書けるのはモデルだけで、デーモンには書くものが無い——issue 本文が全部を持つ
      // （`dispatch-task.sh`「書くことが無いなら、空のファイルでよい」）。
      //
      // 投入先は盤面が決めて引数の形で寄越す（2.16）。**どの `env:` がどこを指すかはここには無い**
      // ——知っているのは盤面だけで、こちらはそれをそのまま渡す。
      const work = mkdtempSync(join(tmpdir(), 'board-round-'));
      try {
        const supplement = join(work, 'supplement.md');
        writeFileSync(supplement, '');
        const where = b === '' ? [] : [b];
        return dispatched(runScript('dispatch-task.sh', [a, posix(supplement), ...where]).status);
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    }
    case 'CHORE': {
      // 周期の係（`board-move.mjs` の `CYCLES`）。**指紋は立てた時刻**で、次に立ててよいかを決める
      // のは盤面。**立てられなかった周は覚えない**——覚えると、失敗したまま間隔ぶん黙る。
      const where = d === '' ? [] : [d];
      const result = dispatched(runScript('dispatch-chore.sh', [a, b, ...where]).status);
      if (result !== PLAYED) return result;
      remember(`cycle:${a}`, c);
      return PLAYED;
    }
    default:
      log(`知らない手なので打たない: ${kind} ${a} ${b} ${c}`);
      return FAILED;
  }
}

/** 1周。盤面を引けたら `true`、引けなかったら `false`（呼び手はその周を捨てる）。 */
export async function round({
  runScript = defaultRunScript,
  gh = runGh,
  sessions = liveSessions,
  // 棚卸しを通っていない判断の履歴・二次がまだ読んでいない分析の記録・参照の検め残しの見方
  // （`board-read.mjs`）。
  // **外を触る手は全部渡す**ので、これも渡せる形にしてある——渡さなければ本物のリポジトリを見る。
  pendingDecisions,
  unsummarizedAnalyses,
  pendingRefAudit,
  log = defaultLog,
  echo = defaultEcho,
  warn = defaultWarn,
  now = () => new Date(),
  stateDir = boardState(),
  // チェックが1本も登録されないPRを緑と読むまでの猶予。登録の途中と見分けが付かないので待つ。
  settleMinutes = Number(process.env.SETTLE_MINUTES || 10),
  dryRun = (process.env.DRY_RUN ?? '') !== '',
} = {}) {
  // **一覧はこの周に1回だけ引く**（`board-design.md` 1.7）。要る側は4つあり、それぞれが自分で
  // 引くと同じ答えを4回買うことになる——`list_sessions` の上限は1時間あたりで数えるので、その
  // 回数がそのまま盤面の回る速さの天井になる。引いたものはファイルへ置き、叩くスクリプトへは
  // 環境変数で在り処だけを渡す。**この周のうちに立ったセッションは、次の周の一覧に載る。**
  // **この周の時刻は1つ**（比べる相手も、引けていない印も同じ形で書く）。
  const at = now();

  // **引けなかった理由は、諦めた側から受け取る**（1.7）。**引けなかった周に人へ届くのはこれだけ**
  // で、「引けなかった」だけでは、資格情報の切れと通信の断ちが同じ顔になる（2.20.3）。
  let whyUnreadable = '';
  const sayWhyNot = (line) => {
    whyUnreadable = line;
    warn(line);
  };

  let live;
  try {
    live = await sessions();
  } catch (error) {
    // **理由を言えるのは投げた側だけ**なので、その言葉をそのまま出す。
    const why = error instanceof Error ? error.message : String(error);
    warn(why);
    // **引けない間は誰もセッションを立てられない**ので、ここで控えた印を読むのは人
    // （2.20 の書き出し）。
    if (!dryRun) markUnreadable(stateDir, at.toISOString(), why);
    return false;
  }
  const livePath = join(stateDir, 'live-sessions.tsv');
  writeFileSync(livePath, live.map((session) => `${formatLive(session)}\n`).join(''));
  // **在り処は、叩く相手にだけ渡す。** `process.env` を書き換えると、同じプロセスで動く他の呼び手
  // にも見える（`spawn.mjs`）。
  const runScriptHere = (name, args, options) =>
    runScript(name, args, { ...options, env: { LIVE_SESSIONS_TSV: livePath } });

  // **この周の盤面が欠けている理由**（`board-read.mjs` の `sayIncomplete`）。**ログへ出すだけでは
  // 届かない**ので、下で台帳へ写して人の読む盤面へ渡す（2.20.3）。
  const incomplete = [];
  const sayIncomplete = (line) => {
    incomplete.push(line);
    log(line);
  };

  const spent = runScriptHere('usage-record.sh', [], { capture: true });
  // **使用量を引けない周は、余力で止める手が効かない**（2.5.2）ので、これも盤面の欠けとして言う。
  if (spent.status !== 0) sayIncomplete('使用量を引けなかった（この周は、余力を見ずに投入する）');
  for (const line of spent.stdout.split(/\r?\n/)) {
    if (line !== '') log(`消費 ${line}`);
  }

  const taken = readLedger(stateDir);
  const board = await readBoard({
    gh,
    sayWhyNot,
    sessions: () => live,
    pendingDecisions,
    unsummarizedAnalyses,
    pendingRefAudit,
    sayIncomplete,
    now: at,
    settleMinutes,
    taken,
  });
  if (board === undefined) {
    if (!dryRun) markUnreadable(stateDir, at.toISOString(), whyUnreadable);
    return false;
  }

  const pruned = trackIdle(pruneTaken(taken, board), board, at.toISOString());
  // **引けた周に印を消す。** ここまで来られたのは盤面を引けたからで、残すと直った後も人へ
  // 「引けていない」と出続ける（`board-state.mjs` の `UNREADABLE`）。**消す手前で帳面へ閉じる**
  // ——消すだけだと、止まっていたこと自体が跡形も無くなる（上の `closeUnreadable`）。
  closeUnreadable(stateDir, pruned, at.toISOString());
  board.taken = pruned;

  const lines = moves(board);
  const notes = lines.filter((line) => line.startsWith('NOTE ')).map((line) => line.slice('NOTE '.length));
  for (const note of notes) log(`覚え書き: ${note}`);

  // **その周に出た断りを、出始めた時刻とともに台帳へ写す。** ログへ出すだけだと、**読む者が居ない**
  // （2.20.3）——盤面が20分以上同じ3行を出し続けても、人の見に来る盤面には何も出なかった。
  // **2種類を分けて持つ**のは、読む人がすることが違うから（`board-state.mjs` の `PARTIAL_PREFIX`）。
  const since = at.toISOString();
  const remaining = trackNotes(
    trackNotes(pruned, NOTE_PREFIX, notes, since),
    PARTIAL_PREFIX,
    incomplete,
    since,
  );
  writeLedger(stateDir, remaining);
  // **盤面が指す台帳は、下で書き足される側と同じもの。** 別のままにすると、`remember` が控えた指紋は
  // 台帳には載るのに `board.taken` からは見えない——今その先を読む者は居ないが、**読む者が現れた日に
  // 静かにずれる。**
  board.taken = remaining;
  const remember = (key, mark) => {
    remaining[key] = mark;
    writeLedger(stateDir, remaining);
  };

  const played = lines.filter((line) => !line.startsWith('NOTE '));
  if (dryRun) {
    for (const line of played) log(`打たない手: ${line}`);
    return true;
  }

  // **ぶつかった実績を控える**（3.1）。**記録は手ではない**ので、下で打つ手が何であっても、その手前で
  // 書き終わる。**`DRY_RUN` の周では書かない**——指紋を埋めると、その組は本番の周でも二度と記録
  // されない（見るだけのつもりで測定を消すことになる）。
  for (const record of newConflicts(
    board.prs,
    writtenConflicts(stateDir),
    (number) => describeConflict(runScriptHere, number),
    board.now,
  )) {
    appendFileSync(conflictsPath(stateDir), `${JSON.stringify(record)}\n`);
    if (record.files.length === 0) {
      log(`PR #${record.pr} は手元では併合できた（GitHub の \`mergeable\` が古い）`);
      continue;
    }
    const rivals = record.with.map((number) => `#${number}`).join(' ');
    log(`ぶつかった: PR #${record.pr} ${record.files.join(' ')}${rivals === '' ? '' : ` … ${rivals}`}`);
  }

  // **盤面が引けている周の不調は、印には立てない**（2.21.2）。転んだ手を数えて印を立てていたが、
  // **手が1つも出ない周**（錠で全部が待たされる・差し戻す相手を引けない）には掛からず、2026-09-11
  // にそのまま2時間11分止まった（#1939）。見るのは毎回立つ係（`CYCLES` の `patrol`）で、**この
  // ログが見る側の材料**——打った手と、打てなかった手の理由がここに残る。
  //
  // **同じことを帳面へも書く**（2.20.3）。ログを定期的に読む者は居ないので、**打った手の件数が
  // 合図になるもの**（`RETURN` が一度に何件出たか）**は、人の見に来る場所に出ないと誰も数えない。**
  for (const line of played) {
    const [kind, ...args] = line.split(' ');
    const [a = '', b = '', c = ''] = args;
    log(`打つ: ${kind} ${a} ${b} ${c}`);
    const result = play(kind, args, { runScript: runScriptHere, gh, remember, log, echo });
    appendRound(stateDir, { at: at.toISOString(), kind: 'move', move: kind, target: a, result });
    if (result === PLAYED) {
      log(`打てた: ${kind} ${a}`);
      // **打つのは1周に1手**（このファイルの冒頭）。
      break;
    }
    log(`打てなかった: ${kind} ${a}${result === SETTLED ? '（転んだのではない）' : ''}`);
  }
  return true;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit((await round()) ? 0 : 1);
  } catch (error) {
    // 呼び手（`daemon.sh`）が終了コードから言えるのは「引けなかった」だけ。**引けなかった以外で
    // 落ちたことは、ここで言わないと誰も言わない**——引き続き諦める側へ倒すが、手掛かりは残す。
    defaultWarn(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  }
}
