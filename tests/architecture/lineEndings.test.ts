import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackedFiles } from '../../scripts/docScope.mjs';

/**
 * シェルが起動するファイルの改行コードの検査（[`.gitattributes`](../../.gitattributes)）。
 *
 * **改行コードの扱いは、取り出す人の git の設定に委ねられている。** `core.autocrlf=true` で取り出すと
 * `*.sh` も CRLF になり、`bash` は行末の `\r` を語の一部として受け取って**まるごと動かなくなる**
 * （`tests/scripts/**` が丸ごと落ちる。実行ビットが立っていればカーネルも1行目を読むので、そちらは
 * `env: 'bash\r': No such file or directory` で起動そのものが失敗する）。issue #2171。
 *
 * **スクリプトの側では受けられない**——読み始める前に起動が失敗するので、`\r` を落とす書き方を
 * 置く場所が無い。だから取り出す側を固定するしかなく、固定したことを見張るのがここ。
 *
 * 見張りを2つに分けているのは、**赤くなる条件が違う**から。
 *
 * 1. **`.gitattributes` の宣言**（{@link declaredEol}）。取り出し方に関わらず同じ答えが出るので、
 *    CRLF で取り出していない環境でも判定になる。宣言が消えた・新しい種類のスクリプトが宣言の外に
 *    生えた、で赤。**`git check-attr` は手元の `core.attributesFile` も合わせて解決する**ので、
 *    同じ宣言をグローバルに持っている人の手元ではこれだけでは足りない——リポジトリが
 *    `.gitattributes` を自分で持っていることを併せて見て、残りは 2 が受ける。
 * 2. **作業ツリーのバイト列**。CRLF で取り出された作業ツリーでだけ赤になる。1 が緑でも、
 *    宣言より前に CRLF のまま入った控えは LF へ戻らないので、こちらが要る。
 */

const ROOT = resolve(__dirname, '../..');

/** git へ渡す綴り。`trackedFiles` はそのプラットフォームの区切りで返す。 */
const posix = (rel: string): string => rel.split(sep).join('/');

/**
 * シェバングの2バイト。**綴りを直に書かない**——`tests/**` での `#` と `!` の直書きは
 * [`STUB_SHEBANG`](../support/stubShebang.ts) へ寄せてあり、`tests/scripts/shebang.test.ts` が見張る。
 */
const SHEBANG = Buffer.of(0x23, 0x21);

/**
 * 先頭がシェバングかどうか。**全部を読まずに先頭だけ見る**——追跡しているものには絵も zip も在る。
 */
function startsWithShebang(rel: string): boolean {
  const fd = openSync(join(ROOT, rel), 'r');
  try {
    const head = Buffer.alloc(SHEBANG.length);
    return readSync(fd, head, 0, head.length, 0) === head.length && head.equals(SHEBANG);
  } finally {
    closeSync(fd);
  }
}

/**
 * シェルが起動するファイル。**綴りの一覧を書かずに現物から作る**——`.gitattributes` に書いた種類を
 * ここへ写すと、両方が同じ思い込みを持つので、宣言の外に生えたスクリプトを1つも見つけられない。
 *
 * `*.sh` は中身を問わず入れる（`source` される側もシェルが読む）。拡張子が違っても、シェバングを
 * 持つならカーネルが1行目を読むので入れる。
 */
const STARTED_BY_SHELL = trackedFiles(ROOT).filter((rel) => rel.endsWith('.sh') || startsWithShebang(rel));

/** `.gitattributes` が宣言している `eol`（宣言が無ければ `unspecified`）。 */
function declaredEol(paths: readonly string[]): Map<string, string> {
  const output = execFileSync('git', ['check-attr', 'eol', '--stdin', '-z'], {
    cwd: ROOT,
    input: paths.map((rel) => `${posix(rel)}\0`).join(''),
    encoding: 'utf-8',
  });
  // `<path>\0eol\0<value>\0` の繰り返し。
  const fields = output.split('\0');
  const found = new Map<string, string>();
  for (let at = 0; at + 2 < fields.length; at += 3) found.set(fields[at], fields[at + 2]);
  return found;
}

describe('シェルが起動するファイルの改行コード', () => {
  // 集める側が黙って0件になると、**1つも見ていない状態と、全部が正しい状態が同じ緑**になる。
  it('検査する対象が在る', () => {
    expect(STARTED_BY_SHELL).not.toEqual([]);
  });

  it('`.gitattributes` が LF に固定している', () => {
    // **リポジトリが自分で宣言を持っている**こと。手元のグローバルな設定で同じ宣言を持っている人には、
    // 下の `check-attr` だけでは「リポジトリに在る」と「自分の手元に在る」が区別できない。
    expect(trackedFiles(ROOT, '.gitattributes'), '`.gitattributes` が追跡されていない').not.toEqual([]);

    const eol = declaredEol(STARTED_BY_SHELL);
    const undeclared = STARTED_BY_SHELL.filter((rel) => eol.get(posix(rel)) !== 'lf');

    expect(
      undeclared,
      '`.gitattributes` が LF に固定していないスクリプトが在る（`text eol=lf` を足す——' +
        `CRLF で取り出されると動かない）:\n${undeclared.join('\n')}`,
    ).toEqual([]);
  });

  it('作業ツリーで CRLF になっていない', () => {
    const crlf = STARTED_BY_SHELL.filter((rel) => readFileSync(join(ROOT, rel), 'latin1').includes('\r'));

    expect(
      crlf,
      `行末に \\r が在るスクリプトが在る（この作業ツリーでは動かない）:\n${crlf.join('\n')}`,
    ).toEqual([]);
  });
});
