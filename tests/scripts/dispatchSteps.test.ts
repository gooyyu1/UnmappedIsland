import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeMetaServer, writeFakeCredentials } from '../support/fakeMetaServer';
import { runScript, spawnScriptAsync } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/daemon/dispatch-steps.sh` の `dispatch_session` が、**関門の終了コードをそのまま呼び手の
 * 終了コードにする**ことの検査（`agent-ops/board-design.md` 2.21.2）。
 *
 * **人が手綱で止めている周（3）と、それ以外で転んだ周（1）を、1周を回す側が見分けられなくなると、
 * ログがどちらも「転んだ」と言う**——それを毎回読む盤面を見回る係が、人の意思で止まっている周を
 * 毎回調べに行くことになる。関門を抜けたところに `if` が1つ挟まるだけで潰れる区別なので、
 * **投入するスクリプトを実際に走らせて**見る。
 *
 * **`--gate values` の側はもっと静かに壊れる**（2.22.3）。手綱を読む手が `gh` そのものなので、
 * **`gh` が死んだ周は手綱を読めない**——その死を告げに行く投入だけが、そこを止まらずに通る。
 * 通れなくなっても出るのは「頼めなかった」の1行だけで、**告げる者が居ないことは誰にも見えない。**
 *
 * `gh` は PATH の先頭で差し替え、セッションの一覧はこの周のぶんの写しを渡す
 * （[`live-sessions.mjs`](../../scripts/daemon/live-sessions.mjs)）。**写しに同じタグの1本を置くのは
 * 安全のため**——関門が壊れて手綱を素通りしても、占有が止めるので本物のセッションは立たない。
 * **手綱を流す側は、CCRの通信先を身代わりへ向けて止める**（[`fakeMetaServer`](../support/fakeMetaServer.ts)）。
 */

const SCRIPT = resolve(__dirname, '../../scripts/daemon/dispatch-chore.sh');

/** 手綱の issue の番号。実物の番号は試験に書き写さない。 */
const BRAKE_ISSUE = '9999';

const brakeBody = (other: string) =>
  [
    '## 手綱',
    '',
    '- [x] 投入する（これを外すと下は全部止まる）',
    '  - [x] 新しいタスク',
    '  - [x] レビュー',
    '    - [x] task を持たないPRも読む',
    '  - [x] 直しの再開',
    `  - [${other}] その他のエージェント（周期で起きる係）`,
  ].join('\n');

/**
 * `gh` の身代わりを PATH の先頭へ置き、この周ぶんのセッションの写しを添える。返すのは渡す環境変数。
 *
 * `brake` を渡さなければ**資格情報が死んでいる周**——`gh` はどの引数でも非0で終わる。
 */
function world(work: string, brake?: string): NodeJS.ProcessEnv {
  const gh = join(work, 'gh');
  writeFileSync(
    gh,
    brake === undefined
      ? `${STUB_SHEBANG}
echo 'gh: 資格情報が無い' >&2
exit 1
`
      : `${STUB_SHEBANG}
case "$1 $2" in
  "issue view") cat <<'BODY'
${brake}
BODY
    ;;
  *) exit 1 ;;
esac
`,
    'utf-8',
  );
  chmodSync(gh, 0o755);

  // 見回る係の仕事を既に持っている1本。**手綱を通ってしまった回は、ここで止まる。**
  // **告げに行く側（`chore-values`）は入れない**——あちらは手綱を通り抜けるのが正しいので、
  // ここで塞ぐと「通れたこと」を見る側が占有で落ちる。立てに行った先は身代わりのCCR。
  const live = join(work, 'live.tsv');
  writeFileSync(
    live,
    'session_busy\tSESSION_STATUS_RUNNING\tSESSION_STATUS_BUCKET_WORKING\tchore-patrol\tbridge\n',
    'utf-8',
  );

  return {
    ...process.env,
    PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
    LIVE_SESSIONS_TSV: live,
    BRAKE_ISSUE,
    CLOUD_ENV: 'env_TEST_CLOUD',
  };
}

/** 盤面が控えを置く場所（`BOARD_STATE`）。**渡す側の家とは別に名指しする**——本物を読ませない。 */
const stateDir = (home: string) => join(home, '.claude', 'board-state');

/** 余力の控えの置き場（[`usage.sh`](../../scripts/daemon/usage.sh) の `--last`）。 */
const cachedUsage = (home: string) => join(stateDir(home), 'usage-latest');

/**
 * 余力が在ることにする。**告げに行く投入も余力へは訊く**ので、控えが無いとそこで止まる
 * （下の「余力の控えが無ければ」）——控えの1行目は引けた時刻で、そこから `USAGE_MAX_AGE_SECONDS`
 * を越えると古い扱いになる。
 *
 * **叩いた印も一緒に置く。** 控えが無い周に `headroom.sh` は自分で1回引きに行くので、印が無いと
 * **試験が本物の口を叩く。**
 */
function seedHeadroom(home: string): void {
  const now = Math.floor(Date.now() / 1000);
  const file = cachedUsage(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    [`${now}`, 'five_hour 5 2026-01-01T00:00:00+00:00 -', 'seven_day 5 2026-01-01T00:00:00+00:00 -', ''].join(
      '\n',
    ),
    'utf-8',
  );
  writeFileSync(join(dirname(file), 'usage-polled'), `${now}\n`, 'utf-8');
}

/** `dispatch-chore.sh` を1本叩く。返すのは終了コード。 */
function dispatchChore(brake: string): number {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-dispatch-steps-'));
  try {
    runScript(SCRIPT, ['patrol', 'agent-ops/prompts/patrol-prompt.md'], {
      stdio: 'pipe',
      env: world(work, brake),
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe('dispatch-steps.sh', () => {
  it('人が手綱で止めていれば、3で終わる', () => {
    expect(dispatchChore(brakeBody(' '))).toBe(3);
  });

  // 3以外で転んだ周は、盤面から見れば詰まり。**占有で止まった回をここで見る**ので、
  // 「どんな失敗でも3になる」形の取り違えもここで落ちる。
  it('手綱以外で立てられなければ、1で終わる', () => {
    expect(dispatchChore(brakeBody('x'))).toBe(1);
  });
});

/**
 * `gh` が死んだ周に、クラウドへ告げに行く投入（`agent-ops/board-design.md` 2.22.3）。
 *
 * **CCRへ何が届いたかで見る。** 終了コードは、関門で止まっても身代わりの応答で止まっても同じ1に
 * なるので、区別が付かない。
 */
describe('dispatch-chore.sh の `--gate values`', () => {
  const server = new FakeMetaServer();
  let endpoint = '';
  let work = '';

  beforeEach(async () => {
    endpoint = await server.listen();
    server.received.length = 0;
    work = mkdtempSync(join(tmpdir(), 'unmapped-island-gate-values-'));
    writeFakeCredentials(work);
    seedHeadroom(work);
  });

  afterEach(async () => {
    await server.close();
    rmSync(work, { recursive: true, force: true });
  });

  /** 立てに行った `create_session` の引数。行っていなければ `undefined`。 */
  const created = () =>
    server.received
      .map((request) => JSON.parse(request.body).params)
      .find((params) => params.name === 'create_session')?.arguments;

  const run = (args: readonly string[]) =>
    spawnScriptAsync(SCRIPT, ['values', 'agent-ops/prompts/values-prompt.md', ...args], {
      env: {
        ...world(work),
        CCR_META_ENDPOINT: endpoint,
        HOME: work,
        USERPROFILE: work,
        BOARD_STATE: stateDir(work),
      },
    });

  // **手綱を読む手が `gh` そのもの。** ここで止まる側へ倒すと、告げてほしい周にだけ立たない。
  it('`gh` が死んでいても、手綱で止まらずに立てに行く', async () => {
    const done = await run(['--gate', 'values']);

    expect(done.stderr).not.toContain('投入の手綱で止まっている');
    expect(created()?.tags).toEqual(['chore-values']);
  });

  // **リポジトリのURLも `gh` へ訊かない**（`dispatch-steps.sh` の `choose_target`）。訊くと、
  // 手綱を流しても同じ周で転ぶ。
  it('立てる先へ、`gh` を通さずに引いたリポジトリを渡す', async () => {
    await run(['--gate', 'values']);

    expect(created()?.source_url).toMatch(/^https:\/\/github\.com\/.+\/.+$/);
    expect(created()?.source_url).not.toContain('.git');
  });

  // 既定の側が素通りしていないこと。**`gh` が死んでいれば手綱は読めない**ので、そこで止まる。
  it('渡さなければ、同じ周に手綱で止まる', async () => {
    const done = await run([]);

    expect(done.stderr).toContain('投入の手綱で止まっている');
    expect(created()).toBeUndefined();
  });

  // **流すのは種類であって、`--gate` を渡したことではない。** 渡せば流れる形にすると、綴りを
  // 間違えた周が黙って手綱を素通りする。
  it('別の種類を渡せば、同じ周に手綱で止まる', async () => {
    const done = await run(['--gate', 'other']);

    expect(done.stderr).toContain('投入の手綱で止まっている');
    expect(created()).toBeUndefined();
  });

  /**
   * **流れるのは手綱だけ。** 余力（`headroom.sh`）も占有も、他の種類と同じものを通る
   * （`agent-ops/board-design.md` 2.5.1 は **【確定】**）。**控えを消すだけで止まる**ことで、
   * 上の「立てに行く」が余力を素通りして通っているのではないことまで見る。
   */
  it('余力の控えが無ければ、手綱を流した周でも止まる', async () => {
    rmSync(cachedUsage(work));

    const done = await run(['--gate', 'values']);

    expect(done.stderr).toContain('使用量の余力で止まっている');
    expect(created()).toBeUndefined();
  });

  it('知らない引数は撥ねる', async () => {
    const done = await run(['--unknown']);

    expect(done.code).toBe(1);
    expect(done.stderr).toContain('知らない引数');
    expect(created()).toBeUndefined();
  });

  /**
   * **この種類は、手綱が読めない周に止まらない。** 増えても出るのは立ったセッションだけなので、
   * **人が止めているつもりの周に走り続けていても、誰にも見えない**（手綱を外したことは、読めない
   * 周には誰にも見えない）。名乗ってよいのは、その手綱を読む値そのものが死んでいる周に立つ1つだけ
   * （`agent-ops/board-design.md` 2.22.3）。
   */
  it('この種類を名乗るのは、値の見回りだけ', () => {
    // 見るのは**打つもの**だけ。文書が語形を引くのは呼び出しではない。
    const tracked = execFileSync('git', ['ls-files', '-z', 'scripts', '.github'], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf-8',
    })
      .split('\0')
      .filter(Boolean);
    const carried = tracked.filter((rel) =>
      readFileSync(resolve(__dirname, '../..', rel), 'utf-8').includes('--gate'),
    );

    expect(carried.sort()).toEqual(['scripts/daemon/check-values.mjs', 'scripts/daemon/dispatch-chore.sh']);
  });
});
