import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pathForBash, spawnScript } from './runScript';
import { STUB_SHEBANG } from './stubShebang';

/**
 * **「組み込みで済ませてある」を、破れたら落ちる形で見張るための世界。**
 *
 * PATH を**名乗った名前だけ**に絞って `.sh` を1本走らせ、**起きた外部プロセスを名前で控える。**
 * 名乗った名前は身代わりが控え、**絞りの外は `command_not_found_handle` が控える**（`BASH_ENV` で
 * 仕込む）。控えるのは名前を数え上げずに済ませるためで、思いつかなかった名前も同じ網に掛かる。
 *
 * **見つからなかった呼び出しも控えるのが要点。** 絞りの外は `command not found`（127）になるので
 * `set -e` の下では叩いた側ごと倒れるが、**`|| true` や `|| exit 0` で受けた呼び出しは倒れない**
 * ——フックにはその書き方が実際に在る（`format-after-edit.sh` の `npx … || true`、
 * `inject-policies.sh` の `grep … || true`）。倒れ方に頼ると、そこだけ網から漏れる。
 *
 * **組み込みで受けている形（`command -v node || exit 0`）はここの例ではない。** 外部プロセスが
 * そもそも起きないので、控えるものも倒れるものも無い——この網が見ているのは「起きた外部プロセス」で、
 * 組み込みで済ませてあるかは、網に何も載らないことでしか読めない。
 *
 * 名乗った名前は引数と作業ディレクトリも控える。**0個であることも、1個であることも同じ形で見られる。**
 */

export interface CommandCall {
  readonly name: string;
  /** 呼ばれた時点の作業ディレクトリ。**どこで走らせたかが仕事の一部**である相手を見るのに要る。 */
  readonly cwd: string;
  readonly args: readonly string[];
}

export interface OnlyTheseCommands {
  /** 本物へ渡す名前。控えてから、元の PATH で同じ名前を起動する。 */
  readonly real?: readonly string[];
  /** 控えるだけで、何もせず 0 で返る名前。仕事が重い相手（`npx prettier`）を止めるのに使う。 */
  readonly stub?: readonly string[];
  readonly input?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
}

export interface Restricted {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** 起きた外部プロセスを、呼ばれた順に。**見つからなかった呼び出しもここに載る。** */
  readonly calls: readonly CommandCall[];
}

/**
 * 控えを1行足す bash。`name` と `args` は bash の式として埋める（身代わりは自分の名前と `"$@"`、
 * 見つからなかった側は `"$1"` と残り）。**項目はタブで分ける**——JSONを渡す叩き手が居るので、
 * 空白では切れない。
 *
 * 引数は1つずつ回す。`printf '\t%s' "$@"` は引数が0個でも1回展開されるので、**引数なしで呼ばれた
 * 相手に空の引数が1つ在ることになる。**
 */
function record(name: string, args: string, log: string): string {
  return [
    `{ printf '%s\\t%s' ${name} "$PWD"`,
    `for arg in ${args}; do printf '\\t%s' "$arg"; done`,
    `printf '\\n'; } >> '${log}'`,
  ].join('\n  ');
}

/** `PATH` を名乗った名前だけに絞って `.sh` を1本走らせる。 */
export function runWithOnlyTheseCommands(script: string, only: OnlyTheseCommands): Restricted {
  const work = mkdtempSync(join(tmpdir(), 'unmapped-island-only-commands-'));
  try {
    const bin = join(work, 'bin');
    mkdirSync(bin, { recursive: true });
    const log = pathForBash(join(work, 'calls'));

    for (const name of only.real ?? []) {
      // 本物は元の PATH から引く。**絞った PATH のまま `exec` すると身代わり自身を呼び直す。**
      const shim = join(bin, name);
      const body = `export PATH="$ONLY_THESE_COMMANDS_PATH"\nexec ${name} "$@"\n`;
      writeFileSync(shim, `${STUB_SHEBANG}\n${record(`'${name}'`, '"$@"', log)}\n${body}`, 'utf-8');
      chmodSync(shim, 0o755);
    }
    for (const name of only.stub ?? []) {
      const shim = join(bin, name);
      writeFileSync(shim, `${STUB_SHEBANG}\n${record(`'${name}'`, '"$@"', log)}\n`, 'utf-8');
      chmodSync(shim, 0o755);
    }

    // **見つからなかった呼び出しを控える。** `BASH_ENV` は非対話の bash が起動時に読むので、叩く先が
    // `set -e` を書く前にこの関数が居る。**127 を返して倒れ方は変えない。**
    const prelude = join(work, 'not-found.sh');
    writeFileSync(
      prelude,
      `command_not_found_handle() {\n  ${record('"$1"', '"${@:2}"', log)}\n  return 127\n}\n`,
      'utf-8',
    );

    // **`PATH` は1つだけにする。** Windows の `process.env` は `Path` の綴りで返るので、そのまま
    // 足すと綴り違いの2本が子へ渡る。
    const base = Object.fromEntries(
      Object.entries({ ...process.env, ...only.env }).filter(([name]) => name.toUpperCase() !== 'PATH'),
    );

    const run = spawnScript(script, [], {
      cwd: only.cwd,
      env: {
        ...base,
        PATH: bin,
        ONLY_THESE_COMMANDS_PATH: process.env.PATH ?? '',
        BASH_ENV: pathForBash(prelude),
      },
      input: only.input ?? '',
    });

    const calls = existsSync(join(work, 'calls'))
      ? readFileSync(join(work, 'calls'), 'utf-8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => {
            // 控えの1行は、必ず名前と作業ディレクトリで始まる（`record`）。
            const [name, cwd, ...args] = line.split('\t');
            return { name, cwd, args };
          })
      : [];

    return { code: run.status ?? -1, stdout: run.stdout, stderr: run.stderr, calls };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
