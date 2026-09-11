// 盤面が動くのに要る値——CCR の環境ID（`CLOUD_ENV` / `BRIDGE_ENV`）と、CCR・`gh` の資格情報——が
// 生きているかを見回り、死んでいれば人へ告げる（`.claude/board-design.md` 2.22）。
//
//   node scripts/agent/check-values.mjs            # 1回見回る
//   DRY_RUN=1 node scripts/agent/check-values.mjs  # 調べて、告げる中身を出すだけ（何も書かない）
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
// **`gh` が死んでいる周は、その issue を書けない。告げる手はそこで尽きる**——理由は
// `.claude/board-design.md` 2.22.3。黙らずに `~/daemon.log` へは残すが、**読む者が居ないので
// 告げたことにはならない。**

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callMeta, metaJson } from '../../.claude/ccr-meta.mjs';
import { boardState } from './board-state.mjs';
import { environmentIds } from './live-sessions.mjs';
import { gh as runGh } from './spawn.mjs';

/** 告げ先の題。**2本目を作らない鍵はこれだけ**——台帳が失われても、題が合えば書き換えになる。 */
export const TITLE = '盤面が動くのに要る値が死んでいる';

/** 死んだまま、これだけ経ってから告げる（時間）。 */
const GRACE_HOURS = Number(process.env.VALUE_GRACE_HOURS || 6);

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
  CLOUD_ENV: '`scripts/agent/ccr-env.sh` の既定値を、今在るクラウドの環境IDへ直す',
  BRIDGE_ENV: 'このPCで Claude Code の CLI を開き直す（ブリッジの環境はCLIのプロセス1つにつき1つ）',
};

/**
 * `list_environments` で、今在る環境IDを引く。**CCR の資格情報が生きているかは、これが返ったこと
 * そのもの**（`.claude/board-design.md` 2.22）——別の口を作ると、確かめる対象が2つになる。
 *
 * 返すのは環境IDの集合。届かなければ、道具が言った理由をそのまま投げる。
 */
async function livingEnvironments(call) {
  const answer = metaJson(await call('list_environments', { limit: 100 }));
  if (answer === undefined) throw new Error('応答に JSON の行が無い');
  return new Set((answer.environments ?? []).map((environment) => environment.environment_id));
}

/**
 * 値ごとの見え方を並べる。`state` は `alive` / `dead` / `unknown` の3つで、**`unknown` は確かめ
 * られなかったこと**（上の「確かめられなかったことは」）。
 *
 * 差し替え口は試験のため（`tests/scripts/checkValues.test.ts`）。
 */
export async function surveyValues({ call = callMeta, gh = runGh, envs = environmentIds } = {}) {
  const found = [];

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
    found.push({
      key: name,
      label: `${name}（\`${id}\`）`,
      state: living === undefined ? 'unknown' : living.has(id) ? 'alive' : 'dead',
      seen: '`list_environments` の一覧に居ない',
      remedy: ENV_REMEDY[name] ?? '直し方は分からない（`check-values.mjs` の `ENV_REMEDY` に無い名前）',
    });
  }

  found.push({
    key: 'gh',
    label: '`gh` の資格情報',
    state: gh(['auth', 'status'], { allowFail: true }) === undefined ? 'dead' : 'alive',
    seen: '`gh auth status` が非0で終わる',
    remedy: 'このPCで `gh auth login` を打ち直す',
  });

  return found;
}

/** 台帳を読む。**読めなければ空**——失われたときの害は、告げるのが猶予のぶん遅れることだけ。 */
function readLedger(stateDir) {
  try {
    return JSON.parse(readFileSync(ledgerPath(stateDir), 'utf8'));
  } catch {
    return {};
  }
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
export function report(due, now) {
  return `${[
    '**この本文は `scripts/agent/check-values.mjs` が周期で丸ごと書き換えます。**',
    '人が書いたものは次の見回りで消えます（`.claude/board-design.md` 2.22）。',
    '',
    `最終更新 ${stamp(now)}`,
    '',
    '盤面が動くのに要る値が死んでいます。**盤面はここが直るまで進みません。**',
    '直せるのは人の手だけなので、この issue は誰にも配りません（`判断待ち`）。',
    '',
    ...deadTable(due),
    '',
    '**直ったら、この issue は次の見回りが閉じます。**',
  ].join('\n')}\n`;
}

/**
 * `~/daemon.log` へ残す1行ぶん（`gh` が死んでいる周）。**告げたことにはならない**——ログを読める
 * のは手元で叩ける人だけで、定期的に読む者が居ない（`.claude/board-design.md`「未決」）。
 * **それでも黙らないのは、後から追えるようにするため。**
 */
function deadBrief(due) {
  return due.map((value) => `${cell(value.label)}（${value.since} から）`).join('・');
}

/**
 * 開いている issue のうち、題の合うものの番号。**引けなければ `undefined`**——「1本も無い」は
 * `null` で返る。**引けなかったことと無いことを混ぜない**（混ぜると、一覧が転んだ周に同じ題の
 * 2本目が立つ）。
 *
 * **`--search` では引かない。** あちらは索引を引くので、**立てた直後はまだ出てこない**（2026-09-11
 * に実測。立てた issue を続けて検索して0件）——1本に畳む鍵が題なのに、引けない窓があると2本目が
 * 立つ。開いている issue を丸ごと引いて題で照らす。
 */
function openIssue(gh) {
  const found = gh(['issue', 'list', '--state', 'open', '--limit', '300', '--json', 'number,title'], {
    allowFail: true,
  });
  if (found === undefined) return undefined;
  try {
    return JSON.parse(found).find((issue) => issue.title === TITLE)?.number ?? null;
  } catch {
    return undefined;
  }
}

/**
 * `gh` で告げる。**題で引いて、開いていれば本文を書き換えるだけ**——2本目を作らない鍵は題だけで、
 * 台帳には持たせない（台帳が失われても、2本目は立たない）。
 *
 * **一覧を引けなかった周は、何も書かない。** 書くと同じ題の2本目が立つ——**告げるのが1周ぶん
 * 遅れるほうが軽い。**
 */
function tellByIssue(gh, body) {
  const open = openIssue(gh);
  if (open === undefined) return false;
  const work = mkdtempSync(join(tmpdir(), 'check-values-'));
  try {
    const file = join(work, 'body.md');
    writeFileSync(file, body);
    if (open !== null) return gh(['issue', 'edit', String(open), '--body-file', file]) !== undefined;
    return (
      gh([
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
      ]) !== undefined
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
      '値が全部生き返ったので閉じます（`scripts/agent/check-values.mjs`）。',
    ]) !== undefined
  );
}

/**
 * 1回見回って、告げる。**告げたら `true`。**
 *
 * 差し替え口は試験のため（`tests/scripts/checkValues.test.ts`）。省いたものは本物が入る。
 */
export async function checkValues({
  call = callMeta,
  gh = runGh,
  envs = environmentIds,
  stateDir = boardState(),
  now = new Date(),
  grace = GRACE_HOURS,
  dryRun = process.env.DRY_RUN !== undefined && process.env.DRY_RUN !== '',
  say = console.log,
} = {}) {
  const survey = await surveyValues({ call, gh, envs });
  const previous = readLedger(stateDir);
  const dead = trackDead(previous, survey, now);

  // 猶予を越えた値だけが、告げる対象。**越えていない死は、まだ直る途中のものと見分けが付かない。**
  const limit = now.getTime() - grace * 3_600_000;
  const due = survey
    .filter((value) => dead[value.key] !== undefined && value.state === 'dead')
    .map((value) => ({ ...value, since: dead[value.key].since }))
    .filter((value) => Date.parse(value.since) <= limit);

  const ghAlive = survey.find((value) => value.key === 'gh')?.state === 'alive';
  const write = (taken) => {
    if (!dryRun) writeFileSync(ledgerPath(stateDir), `${JSON.stringify(taken, undefined, 2)}\n`);
  };

  if (due.length === 0) {
    // **閉じてよいのは、台帳が空のときだけ。** `due` が空なのは「猶予に届いていない」「確かめられ
    // なかった」でも起きるので、そこで閉じると**死んだままの周に「全部生き返った」と告げ**、次に
    // 確かめられた周には題で引く先が無くなって2本目が立つ。
    const healed = Object.keys(dead).length === 0;
    const closed = healed && ghAlive && !dryRun && closeIssue(gh);
    say(
      `値の見回り: 告げることは無い（${survey.map((value) => `${value.key}=${value.state}`).join(' ')}）${
        closed ? '。生き返ったので issue を閉じた' : ''
      }`,
    );
    write(dead);
    return false;
  }

  // **`gh` が死んでいれば、告げる手はそこで尽きる**（2.22.3）。ログへ残すだけで、届く先は無い。
  if (!ghAlive) {
    say(`値の見回り: \`gh\` が死んでいるので告げられない（${deadBrief(due)}）`);
    write(dead);
    return false;
  }

  const body = report(due, now);
  if (dryRun) {
    say(`値の見回り: issue で告げる（DRY_RUN なので打たない）\n${body}`);
    return false;
  }

  const told = tellByIssue(gh, body);
  say(
    `値の見回り: ${due.map((value) => value.key).join(' ')} を issue へ${told ? '書いた' : '書けなかった'}`,
  );
  write(dead);
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
