import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';

/**
 * bash が読むパス。**区切りは `/` へ直す。** 受け取る側は `${BASH_SOURCE[0]%/*}` や
 * `dirname "${BASH_SOURCE[0]}"` で自分の置き場を出すので、Windowsの `\` のまま渡すと**区切りが1つも
 * 無い名前**に見え、隣のファイルをカレントから探しに行く。
 *
 * 直す先は、走らせるスクリプト自身だけではない——身代わりのスクリプトへ書き込むパスも読むのは bash。
 *
 * 本番の経路は `scripts/agent/spawn.mjs` の `posix` が同じ約束を持つ。
 */
export function pathForBash(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * `.sh` を1本走らせて標準出力を返す。**渡すパスを直す約束をここが持つ**ので、叩く側は「走らせて
 * ほしい」と頼むだけでよく、直す手順を覚えていなくてよい。
 *
 * 標準出力を文字列で受けるのはどの叩き手も同じなので `encoding` はここが決める。それ以外
 * （`cwd`・`env`・`stdio`・`input`）は叩く世界ごとに違うので渡させる。非0で終わったときに投げるのは
 * `execFileSync` のまま——終了コードを見たい叩き手が `status` で受け取る。
 */
export function runScript(
  script: string,
  args: readonly string[],
  options: Omit<ExecFileSyncOptionsWithStringEncoding, 'encoding'>,
): string {
  return execFileSync('bash', [pathForBash(script), ...args], { ...options, encoding: 'utf-8' });
}
