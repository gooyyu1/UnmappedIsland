// 盤面が動くのに要る値——CCR の環境ID（`CLOUD_ENV` / `BRIDGE_ENV`）、そこへ立てたセッションに走る者が
// 付くこと、CCR・`gh` の資格情報——が生きているかを見回り、死んでいれば人へ告げる
// （`agent-ops/board-design.md` 2.22節）。
//
//   node scripts/daemon/check-values.mjs            # 1回見回る
//   DRY_RUN=1 node scripts/daemon/check-values.mjs  # 調べるだけ（issue も台帳も書かず、セッションも立てない）
//
// **周期を持つのは呼び手**（[`daemon.sh`](daemon.sh) の `CHECK_INTERVAL`）——手で叩いた
// 1回が「まだ早い」と言って何もしないのは、叩いた側から見て何も起きていないのと同じ
// （[`board-publish.mjs`](board-publish.mjs) と同じ形）。
//
// ## 死んだと言うまで、死に続けるのを待つ
//
// **CCR のアクセストークンは数時間で切れ、放っておくと直る**（[`daemon.sh`](daemon.sh)「止めない
// のは」）。落ちた1回をそのまま死と読むと、**直る途中のものを毎回告げる**ことになり、告げたものが
// 誰にも読まれなくなる。**同じ値が死んだまま `VALUE_GRACE_HOURS` 経ってから告げる。**
//
// **生き返ったら、いつから死んでいたかは捨てる。** 途切れ途切れの死は、そのつど数え直す。
//
// ## 立てられることと、働くことは別に見る
//
// 環境IDが一覧に在っても、**そこへ立てたセッションに走る者が付くとは限らない**（2.22.4）。盤面には
// 「手が空いている」としか映らないので、**停滞として1件ずつ処理され、担当の issue が片端から人へ
// 返る**——返ったぶんを戻せるのは人だけなので、直っても盤面は自力で戻れない（issue #2206）。
// **この形を告げるのはここ**で、盤面の側は返さずに畳んで投入し直す（`board-move.mjs` の `neverRan`）。
//
// **告げるのは症状で、原因ではない。** 唯一の実測（2026-09-14 からの3日）は**使用量の上限**で、
// 環境そのものは生きていた（issue #2209）。**当たる前に投入を止めるのはあちらの仕事**で、ここは
// 「立てたのに働いていない」を人へ届ける側。
//
// **セッションの一覧はここで引き直す。** 1周を回す側の写し（`LIVE_SESSIONS_TSV`）は渡さない
// ——見回りの周期（`CHECK_INTERVAL`、既定1時間）は1周の周期（既定30秒）と別なので、渡すと
// **最後に盤面を引けた周の写し**を今の姿として読むことになる。引く回数の天井（1.7）に対しては、
// 1時間に1回の走査が増えるだけ。
//
// ## 確かめられなかったことは、死んだことではない
//
// CCR へ届かない周は、環境IDが一覧に居るかを**確かめようがない**。ここで「居ない」と読むと、
// トークンが切れただけの周に環境IDまで死んだことになる。**確かめられなかった値は、死とも生とも
// 数えず、それまで数えていた長さもそのまま残す。**
//
// ## 告げ先は issue 1本だけ
//
// 告げるのは**題で引く issue 1本**（`TITLE`）。開いていれば本文を丸ごと書き換え、無ければ立てる
// ——**題が鍵なので、同じ死が続いても2本目にならない。** 死んでいる値も、確かめられなかった値も
// 1つも残らなくなったら閉じる。
//
// **`gh` が死んでいる周は、手元からその issue を書けない。** 書く手がその値そのものだから——
// 代わりに**クラウドのセッションへ、同じ題・同じ本文で置かせに行く**（`agent-ops/board-design.md`
// 2.22.3節）。畳む鍵は向こうでも題だけで、**閉じるのは手元の見回りのまま**。頼めなければ
// `~/daemon.log` へ残すが、**読む者が居ないので告げたことにはならない。**

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callMeta, metaJson } from '../../.claude/ccr-meta.mjs';
import { allOpenIssues } from './board-read.mjs';
import { boardState } from './board-state.mjs';
import { envKind, environmentIds, liveSessions } from './live-sessions.mjs';
import { posix, gh as runGh, runBash } from './spawn.mjs';

/** 告げ先の題。**2本目を作らない鍵はこれだけ**——台帳が失われても、題が合えば書き換えになる。 */
export const TITLE = '盤面が動くのに要る値が死んでいる';

/** このリポジトリの根。クラウドへ頼むときに、ひな形と投入の口を引く。 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** クラウドのセッションへ渡すひな形。埋めるのは `<本文>` の1箇所だけ。 */
const CLOUD_TEMPLATE = join(ROOT, 'agent-ops/prompts/values-prompt.md');

/** ひな形の中の、告げる本文を埋める場所。 */
const BODY_SLOT = '<本文>';

/**
 * クラウドへ頼むときの係の名前。タグは `chore-<名前>` になる（[`dispatch-chore.sh`](dispatch-chore.sh)）
 * ので、**盤面は他の周期の係と同じ条件で畳む**（`board-move.mjs`）——`gh` が生き返った周に片付く。
 */
const CLOUD_CHORE = 'values';

/**
 * 手綱へ訊く種類（[`brake.sh`](brake.sh)）。**係の名前と綴りが同じだが別のもの**——あちらはタグに
 * なり、こちらは読めなかった周に倒れる向きを決める。
 */
const CLOUD_GATE = 'values';

/**
 * 摘みの時間。**数でない値は既定へ落とす。** `NaN` を通すと時間の比較が全部 false になり、
 * **見張りが黙って止まる**——毎周「告げることは無い」と言い続けるので、効いているのと見分けが
 * 付かない。
 */
function hours(name, fallback) {
  const given = Number(process.env[name]);
  return Number.isFinite(given) ? given : fallback;
}

/** 死んだまま、これだけ経ってから告げる（時間）。 */
const graceHours = () => hours('VALUE_GRACE_HOURS', 6);

/**
 * クラウドへ頼み直すまでの間隔（時間）。
 *
 * **手元から書く周は毎回書き換える**（`gh issue edit` 1回）が、**クラウドは1回につきセッションが
 * 1本立つ**ので、同じ速さでは頼めない。**それでも一度きりにはしない**——立てたセッションに走る者が
 * 付かない区間（2.22.4）では、頼んだのに誰も書かないまま終わる。
 */
const retellHours = () => hours('VALUE_RETELL_HOURS', 6);

/** 台帳の置き場。**1周を回す側の `taken.json` とは分ける**——書き手が違うので、混ぜると潰し合う。 */
const ledgerPath = (stateDir) => join(stateDir, 'value-check.json');

/** 時刻の綴り。**ミリ秒は落とす**——読むのは人で、秒より細かい差に意味が無い。 */
const stamp = (now) => now.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * 表の升。**道具が言った理由をそのまま載せる**ので、改行も `|` も混ざる——**どちらもそこで表が
 * 崩れる**（崩れた表は、値の名前と直し方が別の行に散る）。
 */
const cell = (text) => String(text).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

/**
 * 環境IDごとの直し方。**鍵は [`ccr-env.sh`](ccr-env.sh) が出す名前**（あちらが出す行は
 * `<名前>=<ID>`）。**知らない名前には直し方が無いと書く**——空欄にすると、直し方の無い値なのか
 * 書き忘れなのかが読む人に見分けられない。
 */
const ENV_REMEDY = {
  CLOUD_ENV: '`scripts/daemon/ccr-env.sh` の既定値を、今在るクラウドの環境IDへ直す',
  BRIDGE_ENV: 'このPCで Claude Code の CLI を開き直す（ブリッジの環境はCLIのプロセス1つにつき1つ）',
};

/**
 * 環境IDごとの、**立てたセッションが働かない**ときの直し方。上の `ENV_REMEDY` とは別の値なので
 * 別の表で持つ——**環境IDが生きていることと、そこへ立てたセッションが働くことは違う**（下の
 * `workingEnvironment`）。
 *
 * **使用量の上限を先に挙げる。** 唯一の実測（2026-09-14 からの3日）がこれだった——**セッションは
 * 作られるのに、モデルが割り当たらないので空のまま**（issue #2209。出どころ: ユーザーの指示・
 * 2026-09-17）。環境そのものの不調と**同じ顔に見える**ので、見分けるには使用量を見るしかない。
 */
const WORKER_REMEDY = {
  CLOUD_ENV:
    'まず `bash scripts/daemon/usage.sh` で使用量の上限に当たっていないか見る（2026-09-14 からの3日はこれだった）。余力が在るなら `claude.ai/code` でセッションを1本開いて走るか確かめる',
  BRIDGE_ENV:
    'まず `bash scripts/daemon/usage.sh` で使用量の上限に当たっていないか見る。余力が在るなら、このPCで Claude Code の CLI を開き直す（走る者はCLIのプロセスが配る）',
};

/**
 * `list_environments` で、今在る環境IDを引く。**CCR の資格情報が生きているかは、これが返ったこと
 * そのもの**（`agent-ops/board-design.md` 2.22節）——別の口を作ると、確かめる対象が2つになる。
 *
 * 返すのは環境IDの集合。届かなければ、道具が言った理由をそのまま投げる。
 */
async function livingEnvironments(call) {
  const answer = metaJson(await call('list_environments', { limit: 100 }));
  if (answer === undefined) throw new Error('応答に JSON の行が無い');
  return new Set((answer.environments ?? []).map((environment) => environment.environment_id));
}

/**
 * 盤面が立てたセッションのタグの頭。**綴りの出どころは投入の側**（[`dispatch-task.sh`](dispatch-task.sh)
 * の `task-`・[`dispatch-review.sh`](dispatch-review.sh) の `review-`・
 * [`dispatch-chore.sh`](dispatch-chore.sh) の `chore-`）。**増えたら黙って数え落とす**ので、突き合わせ
 * は検査が持つ（`tests/scripts/checkValues.test.ts`）。
 */
export const DISPATCH_TAGS = ['task-', 'review-', 'chore-'];

/**
 * 盤面が立てたセッションか。**下の `workingEnvironment` が数えるのはこれだけ。**
 *
 * **ユーザー自身の Claude Code も同じ環境に居る**（`origin: claude_code_cli`。ブリッジでは
 * CLI が開いているかぎり畳まれずに残る）。あれには盤面のタグが無く、**走る者が付かないまま一覧に
 * 居続けるのが正常**なので、混ぜると**盤面のセッションが1本も生きていない瞬間に、健全な環境が
 * 死んで見える**（2026-09-17 に実測。`session_01P8J4tWrH7ENQuumsfgcAN3` が
 * `tags: ["config:auto-create-pr:ready", "remote-control-cli"]` で `last_served_model` を持たない）。
 */
const dispatchedByBoard = (session) =>
  session.tags.some((tag) => DISPATCH_TAGS.some((head) => tag.startsWith(head)));

/**
 * その環境へ盤面が立てたセッションが、現に働いているか（2.22.4）。
 *
 * **環境IDが生きている一覧に在ることでは言えない。** 2026-09-14 から3日、環境は一覧に居るのに
 * **立てたセッションに走る者が1本も付かない**区間が続き、見回りは最後まで `告げることは無い` を
 * 出し続けた（issue #2206）。
 *
 * - **その環境に盤面のセッションが1本も無ければ `unknown`。** 何も投入していない周がそう見える
 *   だけで、働かないことの証拠ではない。
 * - **1本でも働いた跡があれば `alive`。** 走る者は配られている。
 * - **1本以上在って、どれにも跡が無ければ `dead`。**
 *
 * **立てた直後の1本しか居ない周も `dead` に見える**（走る者が付くまでの数秒）。ここに窓は置かず、
 * 猶予（2.22.2）に任せる——**その1本は働き出しても一覧に残る**ので、次の見回りが `alive` を踏んで
 * 台帳を消す。猶予を越えられるのは、**見回りの何周ぶんも `alive` を1度も踏まない**ときだけ。
 *
 * 一覧を引けなかったら `undefined`（呼び手が `unknown` へ倒す）。
 */
function workingEnvironment(live, name) {
  if (live === undefined) return undefined;
  const mine = live.filter((session) => session.env === envKind(name) && dispatchedByBoard(session));
  if (mine.length === 0) return undefined;
  return mine.some((session) => session.served) ? 'alive' : 'dead';
}

/**
 * 値ごとの見え方を並べる。`state` は `alive` / `dead` / `unknown` の3つで、**`unknown` は確かめ
 * られなかったこと**（上の「確かめられなかったことは」）。
 *
 * 差し替え口は試験のため（`tests/scripts/checkValues.test.ts`）。
 */
export async function surveyValues({
  call = callMeta,
  gh = runGh,
  envs = environmentIds,
  sessions = liveSessions,
} = {}) {
  const found = [];

  // **引けなかった周は、働いているかを確かめようがない**（上の「確かめられなかったことは」）。
  // 引けない理由そのものは `ccr` の側が告げるので、ここは黙って `unknown` へ倒す。
  let live;
  try {
    live = await sessions();
  } catch {
    live = undefined;
  }

  let living;
  let unreachable;
  try {
    living = await livingEnvironments(call);
  } catch (error) {
    unreachable = error instanceof Error ? error.message : String(error);
  }
  found.push({
    key: 'ccr',
    label: 'CCR の資格情報',
    state: unreachable === undefined ? 'alive' : 'dead',
    // **道具が言った理由をそのまま載せる。** 切れたのか届かないのかを見分けるのは読む人で、
    // こちらには「返らなかった」しか見えない。
    seen: `\`list_environments\` が返らない（${unreachable ?? ''}）`,
    remedy: 'このPCで Claude Code を起動し直して、トークンを貼り直させる',
  });

  // **`ccr-env.sh` が出さなかった側は見ない。** ブリッジのIDはCLIが開いていなければ空で、それは
  // 死ではなく「今は無い」（あちらの「開いていなければ空」）。
  for (const { name, id } of envs()) {
    const listed = living === undefined ? 'unknown' : living.has(id) ? 'alive' : 'dead';
    found.push({
      key: name,
      label: `${name}（\`${id}\`）`,
      state: listed,
      seen: '`list_environments` の一覧に居ない',
      remedy: ENV_REMEDY[name] ?? '直し方は分からない（`check-values.mjs` の `ENV_REMEDY` に無い名前）',
    });
    // **一覧に居ない環境の「働くか」は、その死の裏に隠れている。** 別に数えると、1つの不調が
    // 2行になって、読む人には直す先が2つ在るように見える。
    found.push({
      key: `${name}:workers`,
      label: `${name} へ盤面が立てたセッション`,
      state: listed === 'alive' ? (workingEnvironment(live, name) ?? 'unknown') : 'unknown',
      seen: '盤面が立てたセッションに走る者が付かない（働いた跡のあるものが1本も無い）',
      remedy: WORKER_REMEDY[name] ?? '直し方は分からない（`check-values.mjs` の `WORKER_REMEDY` に無い名前）',
    });
  }

  // **道具が言った理由をそのまま升へ載せる**（`agent-ops/board-design.md` 1.7節）。読むのはスマホの人で、
  // **「非0で終わる」だけでは、打ち直せばよいのか別の不調かが読めない。**
  let ghWhyNot = '';
  found.push({
    key: 'gh',
    label: '`gh` の資格情報',
    state:
      gh(['auth', 'status'], { sayWhyNot: (line) => (ghWhyNot = line) }) === undefined ? 'dead' : 'alive',
    seen: `\`gh auth status\` が非0で終わる（${ghWhyNot}）`,
    remedy: 'このPCで `gh auth login` を打ち直す',
  });

  return found;
}

/**
 * 台帳を読む。持つのは2つ——死んでいる値がいつからか（`dead`）と、**クラウドへ最後に頼んだ時刻**
 * （`asked`。下の `askCloud`）。
 *
 * **読めなければ空。** 失われたときの害は、告げるのが猶予のぶん遅れること・クラウドへもう一度
 * 頼むこと・**告げる表の「いつから」が本当より後の時刻で据え置かれること**（`since` は最初に見た
 * 周で決まる）で、**どれも2本目は立てない**（畳む鍵は題だけ）。
 *
 * **`dead` を入れ子へ移した周も、同じところへ落ちる**（平らに書かれた古い1本は読めない）。
 * 読み替えは置かない——このリポジトリに後方互換は要らず、置けば**次に形を変える人が、読み替えを
 * 消してよいかを毎回考える**ことになる。
 */
function readLedger(stateDir) {
  let found;
  try {
    found = JSON.parse(readFileSync(ledgerPath(stateDir), 'utf8'));
  } catch {
    found = {};
  }
  return { dead: found.dead ?? {}, asked: found.asked };
}

/**
 * 死んでいる値に、いつから死んでいるかを付ける。**生き返った値は台帳から消える**ので、次に死んだ
 * ときは数え直しになる。
 */
function trackDead(previous, survey, now) {
  const next = {};
  for (const value of survey) {
    const before = previous[value.key];
    // 確かめられなかった値は、それまでの長さをそのまま持ち越す（上の「確かめられなかったことは」）。
    if (value.state === 'unknown') {
      if (before !== undefined) next[value.key] = before;
      continue;
    }
    if (value.state === 'alive') continue;
    next[value.key] = { since: before?.since ?? stamp(now) };
  }
  return next;
}

/** 死んでいる値の表。**読む人はリポジトリを開かない**ので、直し方まで升に入れる。 */
function deadTable(due) {
  const lines = ['| 値 | いつから | 見えた形 | 直し方 |', '|---|---|---|---|'];
  for (const value of due) {
    lines.push(`| ${cell(value.label)} | ${value.since} | ${cell(value.seen)} | ${cell(value.remedy)} |`);
  }
  return lines;
}

/** issue の本文。**丸ごと書き換わる**ので、人が書き足しても消えることを頭に置く。 */
function report(due, now) {
  return `${[
    '**この本文は `scripts/daemon/check-values.mjs` が周期で丸ごと書き換えます。**',
    '人が書いたものは次の見回りで消えます（`agent-ops/board-design.md` 2.22節）。',
    '',
    `最終更新 ${stamp(now)}`,
    '',
    '盤面が動くのに要る値が死んでいます。**盤面はここが直るまで進みません。**',
    '直せるのは人の手だけなので、この issue は誰にも配りません（`判断待ち`）。',
    '',
    ...deadTable(due),
    '',
    '**直れば、次の見回りが閉じます**——`gh` が死んでいる間は、この本文をクラウドのセッションが' +
      '代わりに置きます（`agent-ops/board-design.md` 2.22.3節）。',
  ].join('\n')}\n`;
}

/**
 * `~/daemon.log` へ残す1行ぶん（`gh` が死んでいる周）。**これだけでは告げたことにならない**
 * ——ログを読めるのは手元で叩ける人だけで、定期的に読む者が居ない
 * （`agent-ops/board-design.md`「未決」）。**それでも黙らないのは、後から追えるようにするため。**
 */
function deadBrief(due) {
  return due.map((value) => `${cell(value.label)}（${value.since} から）`).join('・');
}

/**
 * クラウドのセッションへ渡すひな形に、告げる本文を埋める。**埋めた結果もひな形の形のまま**なので、
 * 題の引き方も囲みの読み方も投入の口（[`dispatch-chore.sh`](dispatch-chore.sh)）が持ったまま変わら
 * ない（[`dispatch-session.mjs`](dispatch-session.mjs) のレビューと同じ形）。**埋めるのがここなのは、
 * 埋める値を持っているのが見回りだけだから。**
 */
export function cloudPrompt(body) {
  // **置き換えは関数で渡す。** 文字列で渡すと、本文に `$&` が混ざった周だけ中身が化ける。
  return readFileSync(CLOUD_TEMPLATE, 'utf8').replaceAll(BODY_SLOT, () => body);
}

/**
 * クラウドのセッションへ、同じ題・同じ本文で置かせに行く（`agent-ops/board-design.md` 2.22.3節）。
 * **頼めたら `true`。**
 *
 * **関門は通る。** 手綱へ訊く種類だけ `values` にする（`--gate`）——読める周は他の周期の係と同じ
 * 鎖で止まり、**読めない周だけ流す**（[`brake.sh`](brake.sh)「読めない周に止まらない種類が1つある」）。
 * 手綱を読む手が `gh` そのものなので、そこで止めると**いちばん告げてほしい周にだけ立たない。**
 * 余力も占有も他と同じものを通るが、それらは**通れば毎周立ててよい**とは言わないので、無制限に
 * 頼まないための間隔は呼び手が持つ（上の `retellHours`）。
 */
function askCloud(body, run = runBash) {
  const work = mkdtempSync(join(tmpdir(), 'check-values-cloud-'));
  try {
    const filled = join(work, 'values-prompt.md');
    writeFileSync(filled, cloudPrompt(body));
    const call = run(join(ROOT, 'scripts/daemon/dispatch-chore.sh'), [
      CLOUD_CHORE,
      posix(filled),
      '--gate',
      CLOUD_GATE,
    ]);
    return call.status === 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * 開いている issue のうち、題の合うものの番号。**引けなければ `undefined`**——「1本も無い」は
 * `null` で返る。**引けなかったことと無いことを混ぜない**（混ぜると、一覧が転んだ周に同じ題の
 * 2本目が立つ）。
 *
 * **`--search` では引かない。** あちらは索引を引くので、**立てた直後はまだ出てこない**（2026-09-11
 * に実測。立てた issue を続けて検索して0件）——1本に畳む鍵が題なのに、引けない窓があると2本目が
 * 立つ。開いている issue を丸ごと引いて題で照らす。
 *
 * **丸ごとは [`board-read.mjs`](board-read.mjs) の `allOpenIssues` に任せる。** 自分で数を渡すと、
 * 開いている issue がその数へ届いた日に**古い側が切られ**、当の issue がそこに居れば見つからない
 * ——引けない窓と同じ形で2本目が立つ。
 *
 * **引けなかった理由は `sayWhyNot` へ渡す**（1.7）。**告げる手が丸ごと1周飛ぶ**ので、落とすと、告げて
 * いないことの理由がどこにも残らない。
 */
function openIssue(gh, sayWhyNot) {
  const found = allOpenIssues(gh, 'number,title', { sayWhyNot });
  if (found === undefined) return undefined;
  return found.find((issue) => issue.title === TITLE)?.number ?? null;
}

/**
 * `gh` で告げる。**題で引いて、開いていれば本文を書き換えるだけ**——2本目を作らない鍵は題だけで、
 * 台帳には持たせない（台帳が失われても、2本目は立たない）。
 *
 * **一覧を引けなかった周は、何も書かない。** 書くと同じ題の2本目が立つ——**告げるのが1周ぶん
 * 遅れるほうが軽い。**
 *
 * **書けなかった理由は `sayWhyNot` へ渡す**（1.7）。告げられなかった周は、**告げる先が丸ごと1周黙る**
 * ので、呼び手が出す行に理由が載らないと、読む人には「書けなかった」しか残らない。
 */
function tellByIssue(gh, body, sayWhyNot) {
  const open = openIssue(gh, sayWhyNot);
  if (open === undefined) return false;
  const work = mkdtempSync(join(tmpdir(), 'check-values-'));
  try {
    const file = join(work, 'body.md');
    writeFileSync(file, body);
    if (open !== null) {
      return gh(['issue', 'edit', String(open), '--body-file', file], { sayWhyNot }) !== undefined;
    }
    return (
      gh(
        [
          'issue',
          'create',
          '--title',
          TITLE,
          '--body-file',
          file,
          '--label',
          '判断待ち',
          '--label',
          'origin:agent',
          // **人が `判断待ち` を外した後に効く**（`agent-ops/board-design.md` 2.18.1節）。名乗らなくても
          // 整備として並ぶだけだが、そのぶん未整理として毎周拾われるので、ここで名乗る。
          '--label',
          'goal:upkeep',
        ],
        { sayWhyNot },
      ) !== undefined
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 全部生き返ったので畳む。開いていなければ（引けなければ）何もしない。 */
function closeIssue(gh) {
  const open = openIssue(gh);
  if (open === undefined || open === null) return false;
  return (
    gh([
      'issue',
      'close',
      String(open),
      '--comment',
      '値が全部生き返ったので閉じます（`scripts/daemon/check-values.mjs`）。',
    ]) !== undefined
  );
}

/**
 * 1回見回って、告げる。**告げる手を打てたら `true`**——手元で issue へ書いたか、`gh` が死んでいる
 * 周にクラウドへ頼めたか。
 *
 * 差し替え口は試験のため（`tests/scripts/checkValues.test.ts`）。省いたものは本物が入る。
 */
export async function checkValues({
  call = callMeta,
  gh = runGh,
  envs = environmentIds,
  sessions = liveSessions,
  stateDir = boardState(),
  now = new Date(),
  grace = graceHours(),
  retell = retellHours(),
  ask = askCloud,
  dryRun = process.env.DRY_RUN !== undefined && process.env.DRY_RUN !== '',
  say = console.log,
} = {}) {
  const survey = await surveyValues({ call, gh, envs, sessions });
  const previous = readLedger(stateDir);
  const dead = trackDead(previous.dead, survey, now);

  // 猶予を越えた値だけが、告げる対象。**越えていない死は、まだ直る途中のものと見分けが付かない。**
  const limit = now.getTime() - grace * 3_600_000;
  const due = survey
    .filter((value) => dead[value.key] !== undefined && value.state === 'dead')
    .map((value) => ({ ...value, since: dead[value.key].since }))
    .filter((value) => Date.parse(value.since) <= limit);

  const ghAlive = survey.find((value) => value.key === 'gh')?.state === 'alive';
  // クラウドへ最後に頼んだ時刻。**頼めた周だけ進む**——転んだ周に進めると、次に頼めるのが間隔の
  // ぶん先になる。**`gh` が生き返ったら捨てる**（死んでいた長さと同じ扱い）——残すと、次に死んだ
  // 周が古い時刻に縛られて、間隔のぶん黙る。
  let asked = ghAlive ? undefined : previous.asked;
  const write = () => {
    if (!dryRun) {
      writeFileSync(ledgerPath(stateDir), `${JSON.stringify({ dead, asked }, undefined, 2)}\n`);
    }
  };

  if (due.length === 0) {
    // **閉じてよいのは、台帳が空のときだけ。** `due` が空なのは「猶予に届いていない」「確かめられ
    // なかった」でも起きるので、そこで閉じると**死んだままの周に「全部生き返った」と告げ**、次に
    // 確かめられた周には題で引く先が無くなって2本目が立つ。
    // `gh` が死んでいれば台帳に残るので、ここへ来た時点で `gh` は生きている。
    const healed = Object.keys(dead).length === 0;
    const closed = healed && !dryRun && closeIssue(gh);
    say(
      `値の見回り: 告げることは無い（${survey.map((value) => `${value.key}=${value.state}`).join(' ')}）${
        closed ? '。生き返ったので issue を閉じた' : ''
      }`,
    );
    write();
    return false;
  }

  const body = report(due, now);

  // **`gh` が死んでいれば、手元から書く手はそこで尽きる**（2.22.3）。残っている口はクラウドの
  // セッションだけなので、同じ題・同じ本文を置かせに行く。
  if (!ghAlive) {
    if (dryRun) {
      say(`値の見回り: \`gh\` が死んでいるのでクラウドへ頼む（DRY_RUN なので立てない）\n${body}`);
      return false;
    }
    // **読めない時刻は「頼んでいない」と同じに扱う。** `NaN` を比較へ通すと常に false になり、
    // **二度と頼まなくなる**——台帳が壊れた周の先が、丸ごと黙る。
    const lastAsk = Date.parse(asked ?? '');
    const mayAsk = !Number.isFinite(lastAsk) || lastAsk <= now.getTime() - retell * 3_600_000;
    if (!mayAsk) {
      say(`値の見回り: \`gh\` が死んでいる。クラウドへは ${asked} に頼んだので、まだ頼み直さない`);
      write();
      return false;
    }
    const handed = ask(body);
    if (handed) asked = stamp(now);
    say(
      `値の見回り: \`gh\` が死んでいるので、クラウドのセッションへ${handed ? '頼んだ' : '頼めなかった'}（${deadBrief(due)}）`,
    );
    write();
    return handed;
  }

  if (dryRun) {
    say(`値の見回り: issue で告げる（DRY_RUN なので打たない）\n${body}`);
    return false;
  }

  // **書けなかった理由は、道具が言ったものをそのまま出す**（1.7）。
  let tellWhyNot = '';
  const told = tellByIssue(gh, body, (line) => (tellWhyNot = line));
  say(
    `値の見回り: ${due.map((value) => value.key).join(' ')} を issue へ${told ? '書いた' : `書けなかった（${tellWhyNot}）`}`,
  );
  write();
  return told;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkValues();
  } catch (error) {
    // **見回りが転んでも、呼び手（デーモン）は回り続ける。** ここで非0を返しても止める者が居ない
    // ので、理由だけ残す。
    console.error(`値の見回りが転んだ: ${error instanceof Error ? error.message : error}`);
  }
}
