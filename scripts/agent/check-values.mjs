// 盤面が動くのに要る値——CCR の環境ID（`CLOUD_ENV` / `BRIDGE_ENV`）と、CCR・`gh` の資格情報——が
// 生きているかを見回り、死んでいれば人へ告げる（`.claude/board-design.md` 2.22）。
//
//   node scripts/agent/check-values.mjs            # 1回見回る
//   DRY_RUN=1 node scripts/agent/check-values.mjs  # 調べて、告げる中身を出すだけ（何も書かない）
//
// 出すのは1行。**周期を持つのは呼び手**（[`daemon.sh`](daemon.sh) の `CHECK_INTERVAL`）——手で叩いた
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
// ## 告げ先は1つ、運ぶ手は2つ
//
// 告げるのは**題で引く issue 1本**だけ（`TITLE`）。開いていれば本文を丸ごと書き換え、無ければ立てる
// ——**題が鍵なので、同じ死が続いても2本目にならない。** 全部生き返ったら閉じる。
//
// **`gh` が死んでいる周は、その issue を自分では書けない。** 残っている口は CCR だけなので、
// **Routine の完了通知**（`notifications`）で人の電話へ出す。**こちらは押した回数がそのまま届く**
// ので、issue と違って**1つの死につき1回**に絞る（台帳の `pushed`）。
//
// **両方死んでいれば告げる手が無い。** 外から見ている者がこの口座に1つも無いので、ここは
// `.claude/board-design.md` 2.19.3 と同じ場所（人の目）へ落ちる。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { callMeta, metaJson } from '../../.claude/ccr-meta.mjs';
import { boardState } from './board-state.mjs';
import { environmentIds } from './live-sessions.mjs';
import { gh as runGh } from './spawn.mjs';

/** 告げ先の題。**issue と Routine で同じ綴りを使う**——どちらも題が鍵で、2本目を作らない印。 */
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
      id,
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
    next[value.key] = {
      since: before?.since ?? stamp(now),
      ...(before?.pushed === undefined ? {} : { pushed: before.pushed }),
    };
  }
  return next;
}

/**
 * 死んでいる値の表。**読む人はリポジトリを開かない**ので、直し方まで升に入れる。
 *
 * **告げ先が変わっても、中身はこれ1つ。** 変わるのは包み（下の `report` と `notice`）だけ。
 */
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
 * 電話へ出す報せ（`gh` が死んでいる周）。**issue を指さない**——`gh` が死んでいるからこちらへ来て
 * いるので、指した先は立っていないし、次の見回りが閉じにも行けない。
 */
export function notice(due, now) {
  return `${[
    `${stamp(now)} 時点で、UnmappedIsland の盤面が動くのに要る値が死んでいます。`,
    '**`gh` の資格情報も死んでいるので issue を立てられません。この報せが唯一の告げ先です。**',
    '盤面はここが直るまで進みません。直せるのは人の手だけです。',
    '',
    ...deadTable(due),
  ].join('\n')}\n`;
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
 * Routine が立てるセッションへ渡す本文。**調べさせない**——`gh` が死んでいる周に、クラウドの
 * セッションへ盤面を調べさせても、こちらが見た値の生死は向こうからは見えない。**運ぶのは通知だけ。**
 */
const ROUTINE_PROMPT = [
  'これは UnmappedIsland のブリッジ（ユーザーのPC）から押された報せです。',
  '**何も調べず、何も書き換えないでください。** 続けて届く本文が報せの中身そのものです。',
  '届いた本文を、そのまま結論として述べて終わってください。',
].join('\n');

/**
 * CCR の通知で告げる（`gh` が死んでいる周）。**押せたら `true`。**
 *
 * Routine は**題で引いて、無ければ立てる**——立てっぱなしにするのは、`delete_trigger` を打てる者が
 * 居ないからではなく、**次に `gh` が死んだときに同じ口を使う**ため。
 */
async function tellByPush(call, environmentId, body) {
  const listed = metaJson(await call('list_triggers', { limit: 100 }));
  let trigger = (listed?.data ?? []).find((item) => item.name === TITLE)?.id;
  if (trigger === undefined) {
    const made = metaJson(
      await call('create_trigger', {
        name: TITLE,
        prompt: ROUTINE_PROMPT,
        initiation: 'own_initiative',
        // **発火は押したときだけ**（`cron_expression` も `run_once_at` も渡さない）。時計で立つと、
        // 直った後も鳴り続ける。
        create_new_session_on_fire: true,
        environment_id: environmentId,
        // **人の電話へ出るのはここだけ。** 立てた Routine が通知を持たないと、押しても誰も知らない。
        notifications: { push: true, email: true },
        // **`connectors` は渡さない。** 空で渡しても撥ねられる（2026-09-11 に実測。
        // `the connectors parameter is not available for this organization`）。
      }),
    );
    trigger = made?.trigger?.id;
  }
  if (trigger === undefined) return false;
  await call('fire_trigger', { trigger_id: trigger, text: body });
  return true;
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

  // **告げ先で包みが変わる**（上の「告げ先は1つ、運ぶ手は2つ」）。issue の本文は issue を指すので、
  // issue を立てられない周にそれを流すと、在りもしない1本を待てと言うことになる。
  const body = ghAlive ? report(due, now) : notice(due, now);
  if (dryRun) {
    say(`値の見回り: ${ghAlive ? 'issue' : '通知'}で告げる（DRY_RUN なので打たない）\n${body}`);
    return false;
  }

  if (ghAlive) {
    const told = tellByIssue(gh, body);
    say(
      `値の見回り: ${due.map((value) => value.key).join(' ')} を issue へ${told ? '書いた' : '書けなかった'}`,
    );
    write(dead);
    return told;
  }

  // **押すのは1つの死につき1回。** 既に押してある周は、押し直さずに黙る。
  if (due.every((value) => dead[value.key].pushed !== undefined)) {
    say(`値の見回り: ${due.map((value) => value.key).join(' ')} は通知済み（押し直さない）`);
    write(dead);
    return false;
  }
  // クラウドの環境が死んでいれば、Routine を立てる先が無い。
  const cloud = survey.find((value) => value.key === 'CLOUD_ENV' && value.state === 'alive');
  let pushed = false;
  let excuse = 'クラウドの環境が死んでいる';
  if (cloud !== undefined) {
    try {
      pushed = await tellByPush(call, cloud.id, body);
      if (!pushed) excuse = 'Routine を立てられなかった';
    } catch (error) {
      // **ここで投げさせない。** 投げると台帳を書かずに終わり、**死んでいた長さを数え直す**ことに
      // なる——次の周も同じところで転べば、猶予は永久に満ちない。
      excuse = error instanceof Error ? error.message : String(error);
    }
  }
  if (pushed) for (const value of due) dead[value.key].pushed = stamp(now);
  say(`値の見回り: \`gh\` が死んでいるので通知で告げ${pushed ? 'た' : `られなかった（${excuse}）`}`);
  write(dead);
  return pushed;
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
