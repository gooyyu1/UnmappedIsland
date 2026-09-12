import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { pathForBash, spawnScript } from '../support/runScript';
import { STUB_SHEBANG } from '../support/stubShebang';

/**
 * `scripts/agent/daemon-wake-task.sh` の検査（`agent-ops/board-design.md` 2.19）。
 *
 * **デーモンが落ちたときに起こす唯一の経路。** 壊れても、次に気づくのは「デーモンが落ちたまま盤面が
 * 止まっている」ときになる。しかも**登録が黙って空振りすることと、正しく登録できて何も言うことが
 * 無いことは、同じ緑に見える。**
 *
 * `schtasks` と `cygpath` は身代わりへ差し替える——本物を打つと、走らせた者のPCへタスクが1本立つ。
 * `git` も差し替える（起こす先を答えるのはあちらで、手元のリポジトリの形に結果を左右させない）。
 * `iconv` だけは本物を使う——**UTF-16LEで渡せているかがここの見どころ**なので、身代わりにすると
 * 検査そのものが消える。
 */

// 実プロセス（bash）を何本も起こすため、`npm test` 全体を並行実行したときのCPU競合だけで既定の5秒を
// 超えうる。
vi.setConfig({ testTimeout: 20000 });

const SCRIPT = resolve(__dirname, '../../scripts/agent/daemon-wake-task.sh');

interface World {
  /** `git` が本体のチェックアウトを答えないか（＝リポジトリの外・`git` が無い）。 */
  readonly gitFails?: boolean;
  /** `schtasks /create` が非0で終わるか。 */
  readonly createFails?: boolean;
  /** 立てた直後に引き直せないか（＝`/create` が撥ねた理由を標準出力へ流して0で返した形）。 */
  readonly queryFails?: boolean;
  readonly env?: Record<string, string>;
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  /** `schtasks` に渡された引数。1行が1回。 */
  readonly calls: readonly string[];
  /** `schtasks /create` へ渡されたファイルの中身そのまま。渡っていなければ `undefined`。 */
  readonly handed: Buffer | undefined;
  /** 起こす先として渡るはずの、本体のチェックアウト。**綴りは bash のもの**（下の `bashPath`）。 */
  readonly root: string;
}

/** `schtasks` の言い分。撥ねた理由をそのまま出しているかは、この文字列で追う。 */
const EXCUSE = 'ERROR: アクセスが拒否されました。';

/**
 * そのディレクトリを、**bash が呼ぶ名前**で答える。
 *
 * XMLへ入るのは `cd … && pwd` が出した綴りで、**MSYS2 の bash はそこで `/c/…` を返す**（`C:/…` では
 * ない。[`ccr-env.sh`](../../scripts/agent/ccr-env.sh) が同じ往復を記録している）。Node が組んだ綴りと
 * 直に突き合わせると、**Windowsで `npm test` を打った者にだけ赤くなり**、`schtasks` の無いCIでは
 * 気づけない。
 */
function bashPath(path: string): string {
  return execFileSync('bash', ['-c', `cd '${pathForBash(path)}' && pwd`], {
    encoding: 'utf-8',
  }).trim();
}

function register(world: World = {}): Run {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-daemon-wake-task-'));
  try {
    const dir = pathForBash(work);
    // `--git-common-dir` の親が実在しないと、そこへ `cd` する側が転ぶ。
    mkdirSync(join(work, 'main', '.git'), { recursive: true });
    const root = bashPath(join(work, 'main'));

    // **答えるのは Windows の綴り**（`C:/…`）。本物の `git` がそう答えるので、身代わりも同じ形で
    // 返す——`cd … && pwd` を通った後の綴り（`root`）とは違う。
    const git = join(work, 'git');
    writeFileSync(
      git,
      `${STUB_SHEBANG}
${world.gitFails === true ? 'exit 1' : ''}
case "$*" in
  *--git-common-dir*) printf '%s' '${dir}/main/.git' ;;
esac
`,
      'utf-8',
    );
    chmodSync(git, 0o755);

    // `cygpath -w` は Windows の綴りへ直すだけなので、身代わりは受け取ったものをそのまま返す。
    const cygpath = join(work, 'cygpath');
    writeFileSync(cygpath, `${STUB_SHEBANG}\nprintf '%s' "$2"\n`, 'utf-8');
    chmodSync(cygpath, 0o755);

    // `/xml` の次に来るものが渡されたファイル。位置で数えず、印を見て拾う。
    const schtasks = join(work, 'schtasks');
    writeFileSync(
      schtasks,
      `${STUB_SHEBANG}
echo "$*" >> '${dir}/schtasks-calls'
case "$1" in
  /create)
    prev=''
    for a in "$@"; do
      if [ "$prev" = '/xml' ]; then cp "$a" '${dir}/handed.xml'; fi
      prev="$a"
    done
    echo '${EXCUSE}'
    exit ${world.createFails === true ? 1 : 0}
    ;;
  /query)
    exit ${world.queryFails === true ? 1 : 0}
    ;;
esac
`,
      'utf-8',
    );
    chmodSync(schtasks, 0o755);

    const result = spawnScript(SCRIPT, [], {
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${work}${delimiter}${process.env.PATH ?? ''}`,
        ...world.env,
      },
    });

    const calls = join(work, 'schtasks-calls');
    const handed = join(work, 'handed.xml');
    return {
      code: result.status ?? -1,
      out: result.stdout,
      err: result.stderr,
      calls: existsSync(calls) ? readFileSync(calls, 'utf-8').split('\n').filter(Boolean) : [],
      handed: existsSync(handed) ? readFileSync(handed) : undefined,
      root,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** 渡されたXML。**読むのは渡ったバイト列そのもの**で、書いたつもりの中身ではない。 */
function handedXml(run: Run): string {
  if (run.handed === undefined) throw new Error('`schtasks /create` へファイルが渡っていない');
  return run.handed.subarray(2).toString('utf16le');
}

const TASK = 'ClaudeCode-BoardDaemonWake';

describe('daemon-wake-task.sh', () => {
  it('登録できたら、立てた名前を1行だけ出す', () => {
    const run = register();

    expect(run.code).toBe(0);
    expect(run.out.trim().split('\n')).toEqual([`REGISTERED ${TASK}`]);
  });

  // **何度打っても1本のまま**（2.19.1）。探す鍵はタスクの名前なので、上書きの印を落とすと2本目が
  // 立つのではなく、2度目の登録が「もう在る」で撥ねられる。
  it('同じ名前へ上書きで立て、同じ名前で引き直す', () => {
    const run = register();

    expect(run.calls).toHaveLength(2);
    // 渡すXMLの置き場は毎回違う（`mktemp -d`）ので、そこだけ伏せて見る。
    expect(run.calls[0]).toMatch(new RegExp(`^/create /tn \\\\${TASK} /xml \\S+ /f$`));
    expect(run.calls[1]).toBe(`/query /tn \\${TASK}`);
  });

  it('立てる先の名前は `WAKE_TASK_NAME` で替えられる', () => {
    const run = register({ env: { WAKE_TASK_NAME: 'Test-Wake' } });

    expect(run.out.trim()).toBe('REGISTERED Test-Wake');
    expect(run.calls.every((call) => call.includes('\\Test-Wake'))).toBe(true);
  });

  // **`schtasks` は UTF-8 のXMLを読めない。** 書いた中身が正しくても、渡し方が崩れれば登録は空振る。
  it('渡すファイルは、BOM付きのUTF-16LE', () => {
    const run = register();

    expect(run.handed?.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    expect(handedXml(run).startsWith('<?xml ')).toBe(true);
  });

  // 打つ手に判断が1つも要らないことの上に、この係は立っている（2.19）。
  it('打つのは `daemon.sh start` の1行だけ', () => {
    const run = register();

    // `&` はXMLでは書けないので、繋ぎは `&amp;&amp;`。**`cd` が転んだら打たない。**
    expect(handedXml(run)).toContain('&amp;&amp; bash scripts/agent/daemon.sh start"</Arguments>');
    expect(handedXml(run).match(/<Exec>/g)).toHaveLength(1);
  });

  // 起こす先は**本体のチェックアウト**（`.git` そのものではない）。作業ツリーから打っても、進めた
  // 本体が走る。
  it('起こす先は、`--git-common-dir` が答えた本体', () => {
    const run = register();

    expect(handedXml(run)).toContain(`<Arguments>-lc "cd '${run.root}' `);
  });

  // **再起動の直後**（ログオン）と**落ちた跡**（毎時）で、拾う相手が違う（2.19）。
  it('起こす口は、ログオンと毎時の2つ', () => {
    const xml = handedXml(register());

    expect(xml).toContain('<LogonTrigger>');
    expect(xml).toContain('<Interval>PT1H</Interval>');
  });

  // 起点を登録した時刻にすると、打ち直すたびに起きる分が動く。日付の頭に置いて毎時0分へ寄せてある。
  it('繰り返しの起点は日付の頭で、発火は毎時0分', () => {
    expect(handedXml(register())).toMatch(/<StartBoundary>\d{4}-\d{2}-\d{2}T00:00:00<\/StartBoundary>/);
  });

  it('渡すXMLだけ見たいときは、登録せずに出す', () => {
    const run = register({ env: { DRY_RUN: '1' } });

    expect(run.code).toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.out).toContain('<Interval>PT1H</Interval>');
  });

  // 本体が分からなければ、登録する先も決められない。**間違った先へ立てるより、立てないほうがよい。**
  it('本体のチェックアウトが分からなければ、打たずに1で終わる', () => {
    const run = register({ gitFails: true });

    expect(run.code).toBe(1);
    expect(run.calls).toEqual([]);
    expect(run.err).toContain('本体のチェックアウトが分からない');
  });

  it('登録できなければ、道具が言った理由をそのまま出して1で終わる', () => {
    const run = register({ createFails: true });

    expect(run.code).toBe(1);
    expect(run.err).toContain(EXCUSE);
    expect(run.out).not.toContain('REGISTERED');
  });

  // **`schtasks` は撥ねた理由を標準出力へ流して0で返すことがある。** 打てたと言うのは、引き直せた
  // ときだけ。
  it('立てた直後に引き直せなければ、立てたと言わずに1で終わる', () => {
    const run = register({ queryFails: true });

    expect(run.code).toBe(1);
    expect(run.err).toContain('登録した直後に引けなかった');
    expect(run.out).not.toContain('REGISTERED');
  });
});
