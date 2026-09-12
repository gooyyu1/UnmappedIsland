import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 色の置き場の検査（docs/CodeStructure.md 3節）。
 *
 * **色は、使う部品が1つでも意匠（`src/game/looks`）へ置く**という決めを見張る。配色は画面全体の
 * 調和で決まるので1箇所で見渡せることそのものが値打ちで、見渡せているかは**意匠の外に色が1つも
 * 無いこと**でしか言えない。1つでも外に出た時点で、残りを見ても全部は見えていない。
 *
 * **見るのはゲームの層（`src/game`）だけ。** 汎用部品（`src/ui`）は意匠へ到達できない層
 * （CodeStructure.md 1節）で、既定は起動時に外から入る（`setShapeDefaults`・`setLabelDefaults`）。
 * そこに残る黒と白は入れ替える相手が無い値——影は下地の明るさによらず黒、マスクの塗りは画面に
 * 出ない。素材（`src/art`）が絵へ焼く色も、画面部品の配色ではないのでここでは見ない。
 */

const ROOT = resolve(__dirname, '../..');

/** 見張る置き場と、その中で色を持ってよい場所（意匠）。 */
const WATCHED = 'src/game';
const PALETTE = 'src/game/looks/';

/**
 * 実行時エラーの報告（CodeStructure.md 3節）。**ゲームの画面が壊れた上へDOMで重ねる帯**なので、
 * 画面の配色の一部ではない——むしろ画面から離して読ませるものだし、意匠を引けば壊れているかも
 * しれない側への依存が1本増える。
 */
const OUTSIDE_THE_SCREEN = ['src/game/errorReport.ts'];

/**
 * 色として読める字面。**Phaserへ文字列で渡す色も数える**——`setShadow`は色を文字列でしか
 * 受け取らないので、数値だけを見ると素通りする。
 *
 * **16進はちょうど6桁のものだけを数える。** 8桁は色ではなく、散らしの種のような混ぜ合わせの定数
 * （`WeatherOverlay`の`SCATTER_SEED`）——色として拾うと、逃げ道として意匠へ移させることになる。
 */
const COLOR_LITERAL = /(?:0x|#)[0-9a-fA-F]{6}(?![0-9a-fA-F])|\brgba?\(/;

/** そのディレクトリ以下の.tsファイル（リポジトリ相対）。 */
function sourcesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) found.push(...sourcesIn(rel));
    else if (entry.endsWith('.ts')) found.push(rel);
  }
  return found;
}

/** そのファイルの中で色を書いている行を、読める形にして並べる。 */
function colorLinesIn(rel: string): readonly string[] {
  return readFileSync(join(ROOT, rel), 'utf-8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => COLOR_LITERAL.test(line))
    .map(({ line, number }) => `${rel}:${number} ${line}`);
}

describe('色の置き場', () => {
  it('意匠の外に色を置かない', () => {
    const offenders = sourcesIn(WATCHED)
      .filter((rel) => !rel.startsWith(PALETTE) && !OUTSIDE_THE_SCREEN.includes(rel))
      .flatMap(colorLinesIn);

    expect(offenders, 'この行が色を抱えている。意匠（looks/theme.ts の COLOR）へ出す').toEqual([]);
  });
});
