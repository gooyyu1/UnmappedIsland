import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 手順書が git の範囲を指すとき、起点が `origin/main` であることの検査
 * （[issue #1900](https://github.com/gooyyu1/UnmappedIsland/issues/1900)）。
 *
 * 作業ブランチは `git checkout -B <枝> origin/main` で切るので、**ローカルの `main` は一度も
 * 動かない**。クローンしたままのクラウドのセッションでは、`main...HEAD` の merge-base がクローン
 * 時点まで下がり、そこから先に `origin/main` へ入った他人の変更が丸ごと差分に出る。
 *
 * **混ざっても差分は出るので、受け取った側は自分の差分だと思って読む。** 気づけるかどうかを
 * 読み手任せにしないために、起点の綴りを手順の側で縛る。
 */

const ROOT = resolve(__dirname, '../..');

/** 降りない場所。その時点の記録と、生成物と、追跡していない各セッションのリポジトリ。 */
const SKIP_DIRS = new Set(['analysis', 'decisions', 'worktrees', 'node_modules', 'dist', 'site']);

/** 見る先。手順を書く文書と、係を動かすスクリプト。 */
const ROOTS = ['CLAUDE.md', '.claude', 'scripts', 'docs', '.github'] as const;

const EXTS = ['.md', '.sh', '.mjs', '.cjs', '.ts', '.yml', '.yaml'] as const;

/**
 * ローカルの `main` を起点に置いた書き方。`origin/main` と、`$main_tip` のような変数名は外す。
 *
 * 範囲の記法だけでは足りない——`git diff main HEAD` のように `..` を使わない形でも同じことが
 * 起きるので、git の読み出しを名指しした行も見る。
 */
const PATTERNS: readonly { readonly what: string; readonly pattern: RegExp }[] = [
  { what: '範囲の起点', pattern: /(?<![\w/$-])main\.{2,3}/ },
  {
    what: 'git へ渡す版',
    pattern: /git\s+(?:diff|log|rev-list|merge-base)[^\n`]*?(?<![\w/$-])main(?![\w/-])/,
  },
];

function filesUnder(path: string): readonly string[] {
  if (!statSync(path).isDirectory()) {
    return EXTS.some((ext) => path.endsWith(ext)) ? [path] : [];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !SKIP_DIRS.has(entry.name))
    .flatMap((entry) => filesUnder(join(path, entry.name)));
}

/** 見る先の全部を `[path, 行番号, 行]` へ開く。 */
function lines(): readonly (readonly [string, number, string])[] {
  return ROOTS.flatMap((entry) => filesUnder(join(ROOT, entry))).flatMap((path) =>
    readFileSync(path, 'utf-8')
      .split('\n')
      .map((line, index) => [relative(ROOT, path), index + 1, line] as const),
  );
}

describe('差分の起点', () => {
  it('手順書もスクリプトも、ローカルの `main` を起点にしない', () => {
    const found = lines().flatMap(([path, no, line]) =>
      PATTERNS.filter(({ pattern }) => pattern.test(line)).map(
        ({ what }) => `${path}:${no}（${what}）`,
      ),
    );

    expect(found, 'ローカルの `main` はクローンしたまま動かない。`origin/main` を起点にする').toEqual(
      [],
    );
  });
});
