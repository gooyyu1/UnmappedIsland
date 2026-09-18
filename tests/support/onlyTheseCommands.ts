import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pathForBash, spawnScript } from './runScript';

import { STUB_SHEBANG } from './stubShebang';

/**
 * **「組み込みで済ませてある」を、破れたら落ちる形で見張るための世界。**
 *
 * PATH を**名乗った名前だけ**に絞って `.sh` を1本走らせる。絞りの外の外部コマンドを呼べば
 * `command not found`（127）で、`set -e` の下では叩いた側が非0で終わる——**名前を数え上げずに、
 * 生えた外部プロセスを残らず捕まえられる**のがこの絞り方の要点で、思いつかなかった名前も同じ網に
 * 掛かる。
 *
 * 名乗った名前は、呼ばれたことと引数を控える。**0個であることも、1個であることも同じ形で見られる。**
 *
 * **控えが空であることだけを見ない。** 絞りの外を呼ぶと起動そのものが失敗するので、そのときも控えは
 * 空のまま——「1つも起こさなかった」と見分けが付かない。`code` が 0 であることと**対で**見ること。
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
  /** 起きた外部プロセスを、呼ばれた順に。 */
  readonly calls: readonly CommandCall[];
}

/**
 * 控える1行を出す。**名前と引数はタブで分ける**——JSONを渡す叩き手が居るので、空白では切れない。
 */
function record(name: string, log: string): string {
  return `{ printf '%s\\t%s' '${name}' "$PWD"; printf '\\t%s' "$@"; printf '\\n'; } >> '${log}'\n`;
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
      writeFileSync(
        shim,
        `${STUB_SHEBANG}\n${record(name, log)}export PATH="$ONLY_THESE_COMMANDS_PATH"\nexec ${name} "$@"\n`,
        'utf-8',
      );
      chmodSync(shim, 0o755);
    }
    for (const name of only.stub ?? []) {
      const shim = join(bin, name);
      writeFileSync(shim, `${STUB_SHEBANG}\n${record(name, log)}`, 'utf-8');
      chmodSync(shim, 0o755);
    }

    // **`PATH` は1つだけにする。** Windows の `process.env` は `Path` の綴りで返るので、そのまま
    // 足すと綴り違いの2本が子へ渡る。
    const base = Object.fromEntries(
      Object.entries({ ...process.env, ...only.env }).filter(([name]) => name.toUpperCase() !== 'PATH'),
    );

    const run = spawnScript(script, [], {
      cwd: only.cwd,
      env: { ...base, PATH: bin, ONLY_THESE_COMMANDS_PATH: process.env.PATH ?? '' },
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
