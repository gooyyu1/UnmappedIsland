import {
  execFileSync,
  spawn,
  spawnSync,
  type ExecFileSyncOptionsWithStringEncoding,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'node:child_process';

/**
 * bash が読むパス。**区切りは `/` へ直す。** 受け取る側は `${BASH_SOURCE[0]%/*}` や
 * `dirname "${BASH_SOURCE[0]}"` で自分の置き場を出すので、Windowsの `\` のまま渡すと**区切りが1つも
 * 無い名前**に見え、隣のファイルをカレントから探しに行く。
 *
 * 直す先は、走らせるスクリプト自身だけではない——身代わりのスクリプトへ書き込むパスも読むのは bash。
 *
 * 本番の経路は `scripts/daemon/spawn.mjs` の `posix` が同じ約束を持つ。
 */
export function pathForBash(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * 走らせる bash の在り処。**名前ではなく在り処で起動する**——`PATH` を絞って走らせる試験
 * （[`onlyTheseCommands`](onlyTheseCommands.ts)）では `bash` 自身も絞りの外に出るので、名前では
 * 見つからない。かといって `/bin/bash` と決め打つと、bash がそこに無い環境で壊れる。
 *
 * 在り処は**読み手ごとに2つの綴りを持つ。** MSYS2 の bash は自分を `/usr/bin/bash` と答えるが、
 * Windows の node はその綴りを開けない（`spawn /usr/bin/bash ENOENT`）。node が起こす `BASH` は
 * `cygpath` で Windows の綴りへ直し、bash 自身が読む `BASH_AS_BASH_SEES_IT` は直さない——身代わりの
 * 先頭の1行（[`stubShebang`](stubShebang.ts)）は空白を含む綴り（`C:/Program Files/...`）を書けない。
 * `cygpath` の無い環境では2つは同じ綴り。
 *
 * 引くのは1回だけ。
 */
const [bashAsBashSeesIt, bashForNode] = execFileSync(
  'bash',
  [
    '-c',
    'b=$(command -v bash); echo "$b"; if command -v cygpath >/dev/null; then cygpath -w "$b"; else echo "$b"; fi',
  ],
  { encoding: 'utf-8' },
)
  .trim()
  .split(/\r?\n/);

export const BASH = bashForNode;

/** bash 自身が読む bash の在り処（`BASH` と同じ出どころ。分けている理由は `BASH` の側）。 */
export const BASH_AS_BASH_SEES_IT = bashAsBashSeesIt;

/**
 * `.sh` を1本走らせて標準出力を返す。**走らせるスクリプトの在り処を直す約束をここが持つ**ので、
 * 叩く側は「走らせてほしい」と頼むだけでよく、直す手順を覚えていなくてよい。`args` に載せるものは
 * パスとは限らないので触らない——引数がパスなら、叩く側が `pathForBash` を通す。
 *
 * 標準出力を文字列で受けるのはどの叩き手も同じなので `encoding` はここが決める。それ以外
 * （`cwd`・`env`・`stdio`・`input`）は叩く世界ごとに違うので渡させる。非0で終わったときに投げるのは
 * `execFileSync` のまま——非0が結果の一部である叩き手は `spawnScript` を使う。
 */
export function runScript(
  script: string,
  args: readonly string[],
  options: Omit<ExecFileSyncOptionsWithStringEncoding, 'encoding'>,
): string {
  return execFileSync(BASH, [pathForBash(script), ...args], { ...options, encoding: 'utf-8' });
}

/**
 * `.sh` を1本走らせて、終了コードと両方の出力をそのまま返す。**非0で終わることそのものが確かめたい
 * 結果**である叩き手のための受け方。在り処を直す約束も `args` の扱いも `runScript` と同じ。
 */
export function spawnScript(
  script: string,
  args: readonly string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'>,
): SpawnSyncReturns<string> {
  return spawnSync(BASH, [pathForBash(script), ...args], { ...options, encoding: 'utf-8' });
}

/** `.sh` を1本走らせた結果。**非0で終わることも結果の一部**なので、投げずに返す。 */
export interface ScriptRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `.sh` を1本走らせて、終わるのを**待たずに**約束を返す。在り処を直す約束も `args` の扱いも
 * `runScript` と同じ。
 *
 * **叩く先が試験と同じプロセスの何かへ問い合わせるなら、これを使う**——理由は
 * [`fakeMetaServer`](fakeMetaServer.ts) の冒頭（身代わりのMCPサーバがその形）。
 */
export function spawnScriptAsync(
  script: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<ScriptRun> {
  const child = spawn(BASH, [pathForBash(script), ...args], options);

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf-8');
  child.stderr.setEncoding('utf-8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));

  return new Promise((done) => {
    child.on('close', (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}
