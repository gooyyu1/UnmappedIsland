import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourcesIn } from '../support/sourceFiles';

/**
 * 色の置き場の検査（docs/CodeStructure.md 3節）。
 *
 * **色は、使う部品が1つでも意匠（`looks/theme.ts` の `COLOR`）へ置く**という決めを見張る。配色は
 * 画面全体の調和で決まるので1箇所で見渡せることそのものが値打ちで、見渡せているかは**意匠の外に
 * 色が1つも無いこと**でしか言えない。1つでも外に出た時点で、残りを見ても全部は見えていない。
 *
 * **見るのはゲームの層（`src/game`）だけ。** 汎用部品（`src/ui`）は意匠へ到達できない層
 * （CodeStructure.md 1節）なので、この決めがそもそも掛からない。
 */

/** 見張る置き場と、その中で唯一色を持てる場所。 */
const WATCHED = 'src/game';
const PALETTE = 'src/game/looks/theme.ts';

/**
 * 実行時エラーの報告（CodeStructure.md 1節の表では**層の外**）。画面の部品ではなく、**壊れた画面の
 * 上へDOMで重ねる帯**なので、画面の配色の決めが掛からない——むしろ画面から離して読ませる。
 */
const OUTSIDE_THE_SCREEN = ['src/game/errorReport.ts'];

/** 数値で書いた色。ちょうど6桁だけを数える——8桁は色ではない（`WeatherOverlay`の散らしの種）。 */
const HEX_COLOR = /0x[0-9a-fA-F]{6}(?![0-9a-fA-F])/;

/**
 * 文字列で渡す色。**Phaserは落ち影や縁取りの色を文字列でしか受け取らない**ので、数値だけを見ると
 * そこが素通りする。
 *
 * **引用符の中だけを見る。** `#` に続く数字は、コメントの issue 番号（`#1449`）でも同じ形になる。
 */
const CSS_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/;
const QUOTED = /'[^']*'|"[^"]*"|`[^`]*`/g;

/** そのファイルの中で色を書いている行を、読める形にして並べる。 */
function colorLinesIn(rel: string): readonly string[] {
  return readFileSync(join(ROOT, rel), 'utf-8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => HEX_COLOR.test(line) || (line.match(QUOTED) ?? []).some((q) => CSS_COLOR.test(q)))
    .map(({ line, number }) => `${rel}:${number} ${line}`);
}

describe('色の置き場', () => {
  it('意匠の外に色を置かない', () => {
    const offenders = sourcesIn(WATCHED)
      .filter((rel) => rel !== PALETTE && !OUTSIDE_THE_SCREEN.includes(rel))
      .flatMap(colorLinesIn);

    expect(offenders, 'この行が色を抱えている。意匠（looks/theme.ts の COLOR）へ出す').toEqual([]);
  });
});
