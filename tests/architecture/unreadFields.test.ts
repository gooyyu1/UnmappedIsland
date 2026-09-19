import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReadIndex } from '../../scripts/declarationReads.mjs';
import { ROOT } from '../support/sourceFiles';

/**
 * **`src` の誰も読まないフィールド**の検査。書き込まれてはいるが、値を取り出す側が1人も居ない
 * 宣言を見つける。
 *
 * 隣の検査はどちらもこれを見ない。`exports.test.ts` が見るのは「どこからも輸入されない値の
 * `export`」で、フィールドは輸入されない。`readersOutsideSrc.test.ts` が問うているのは
 * 「`private` へ戻すか」で、インターフェースや型のフィールドにはその選択が無い。**その隙間に、
 * 組み立てられるだけで誰も取り出さないフィールドが残る。**
 *
 * **数えるのは読みだけで、書きは数えない**（`scripts/declarationReads.mjs`）。宣言の名前と、
 * オブジェクトリテラルのキーと、代入の左辺は読みではない——**出現をそのまま数えると、自分の
 * ファイルの中で組み立てているだけの宣言が「使われている」に見える。**
 *
 * **数えているのは名前の一致で、型解決ではない。** ずれは両向きに出る——同じ名前の無関係な
 * 識別子が在れば読み手として数え（`name` のようなありふれた名前ほど）、`obj['name']` のような
 * 文字列での読みは数えない。**確かなのは0件のほうで、1件ずつ倒すときは現物の呼び手を見ること。**
 *
 * **見るのはフィールドだけで、メソッドとアクセサは見ない。** そちらで読み手の居ないものは、枠組み
 * から呼ばれるもの（`Scene.init`）と、呼び出しが名前で現れないもの（`[Symbol.iterator]`）と、
 * `readersOutsideSrc.test.ts` が一覧で開いておくと決めたものに分かれる。同じ物差しを当てると、
 * **向こうの一覧をここへ写すことになる。**
 * **無名の型リテラル（`ReadonlyMap<number, { to: R }>` の `to`）も見ない**——宣言を集める
 * `scripts/declarationInventory.mjs` が、クラス・インターフェース・型別名の直下しか拾わない。
 */

/** 出力は`src`の量に比例して伸びるので、既定の上限（1MB）には頼らない。 */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * **`src` の外に読み手が居れば足りる**置き場。
 *
 * 解析（`src/analysis/`）が出す数の読み手は stats レポートで、レポートは `tests/diagnostics/` に
 * 居る（`npm run stats:balance` など）。この層では「`src` の外からしか読まれない」が既定なので、
 * `src` の読み手を求めると表に列を1つ足すたびに赤くなる。**それでも誰も読まないものは落とす**
 * ——読み手がどこにも居ないフィールドは、この層でも死んでいる。
 */
const READ_FROM_OUTSIDE_BY_DESIGN = ['src/analysis/'];

/** `MotionPlan.discards` を読むようになったファイル（#2082）。 */
const DISCARDS_READER = 'src/game/ui/CardTable.ts';

/** `scripts/declarationInventory.mjs --json` の1件。読むのはこの検査が使う分だけ。 */
interface Declaration {
  readonly file: string;
  /** 所属するクラス・インターフェース・型別名。 */
  readonly owner: string;
  readonly name: string;
  /** `field`・`method`など。 */
  readonly kind: string;
}

function trackedFiles(dir: string, extensions: readonly string[]): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter((file) => file !== '' && extensions.some((extension) => file.endsWith(extension)));
}

const SRC_FILES = trackedFiles('src', ['.ts']);
const OUTSIDE_FILES = ['tests', 'scripts'].flatMap((dir) => trackedFiles(dir, ['.ts', '.mts', '.mjs']));

const FIELDS: readonly Declaration[] = (
  JSON.parse(
    execFileSync('node', [join(ROOT, 'scripts/declarationInventory.mjs'), '--json'], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: MAX_OUTPUT_BYTES,
    }),
  ) as readonly Declaration[]
).filter((declaration) => declaration.kind === 'field');

const OUTSIDE_READS = buildReadIndex(ROOT, OUTSIDE_FILES);

/**
 * 索引に載っているのは、宣言の名前と同じ字面。**`#` から始まる private フィールドは `#` ごと**
 * ——落として引くと、索引の側は `#` 付きで持っているので0件になり、読み手の居る宣言が
 * 「誰も読まない」に見える。
 */
function readerCount(reads: Map<string, ReadonlySet<string>>, name: string): number {
  return (reads.get(name) ?? new Set<string>()).size;
}

/** その読み方をしたときに、読み手の居ないフィールド。 */
function unreadFields(srcReads: Map<string, ReadonlySet<string>>): readonly string[] {
  return FIELDS.filter((field) => readerCount(srcReads, field.name) === 0)
    .filter(
      (field) =>
        !READ_FROM_OUTSIDE_BY_DESIGN.some((dir) => field.file.startsWith(dir)) ||
        readerCount(OUTSIDE_READS, field.name) === 0,
    )
    .map((field) => `${field.file} ${field.owner}.${field.name}`)
    .sort();
}

describe('`src` の誰も読まないフィールド', () => {
  it('組み立てられるだけで誰も読まないフィールドが無い', () => {
    expect(
      unreadFields(buildReadIndex(ROOT, SRC_FILES)),
      '誰も読まないフィールドが在る。読む側を直すか、宣言を消す（組み立てる側も一緒に）',
    ).toEqual([]);
  });

  it('書かれてはいるが読まれないフィールドを取りこぼさない', () => {
    // `MotionPlan.discards` は、宣言と `planMotion` の返り値のキーで自分のファイルに2回現れる。
    // 出現を数えると「使われている」に見えるので、**読みを足した #2082 より前の姿**——それを読む
    // ファイルが `src` に1つも無い状態——を作って、見つけられることを確かめる。
    const beforeTheReaderWasAdded = SRC_FILES.filter((file) => file !== DISCARDS_READER);

    expect(
      unreadFields(buildReadIndex(ROOT, beforeTheReaderWasAdded)),
      `${DISCARDS_READER} の読みを外しても見つからない。別の読み手が増えているなら、外すファイルを見直す`,
    ).toContain('src/game/view/cardMotionPlan.ts MotionPlan.discards');
  });
});
