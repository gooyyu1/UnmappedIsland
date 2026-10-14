import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentParts } from '../../scripts/codeComments.mjs';
import { ROOT } from '../support/sourceFiles';

/**
 * 定義（`src/assets/world-codex/**.yaml`）のコメントに、数どうしの式が書かれていないかの検査
 * （[`docs/diagnostics/README.md`](../../docs/diagnostics/README.md)「導いた値は、生成器へ移すか、書かない」）。
 *
 * YAML のコメントには `codex:` の印を置けないので、そこへ書いた式（`太い枝6本（1,000×6）＋縄1本（600）`）は
 * 材料の側の値を動かしても**古いまま緑で通る**。式で言いたいことは言葉で書き、関係そのものは検査が見る
 * （「材料の目方の和」なら `tests/world-codex/loadEffects.test.ts`）。
 *
 * **見えるのは、数と数を `×`・`÷`・`＋`・`+` で直接つないだ形だけ。** 文章で説いた導出
 * （「上限を減りで割ると10日」を「10日で朽ちる」と書いたもの）までは追えない。寸法（`1.8m×0.7m`）は
 * 1つの量を表す書き方なので見ない。
 */

const CODEX = 'src/assets/world-codex';

const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
/** 数の直後に付く単位（`500g`・`3食`）。区切りの字は含めない。 */
const UNIT = String.raw`[^\s\d、。，（）()「」]{0,3}?`;
/** 数と数を演算子でつないだ形。右辺の手前に置ける語（`車輪2枚`）も短く許す。 */
const EXPRESSION = new RegExp(String.raw`${NUMBER}${UNIT}\s*[×÷＋+]\s*[^\s\d、。（）()]{0,6}?${NUMBER}`, 'g');
/** 寸法の書き方（`1.8m×0.7m`・`40cm×`）。 */
const DIMENSION = new RegExp(String.raw`${NUMBER}c?m\s*×`);

/** コメントの1行から、式に当たる部分を拾う。 */
function expressionsIn(comment: string): string[] {
  return [...comment.matchAll(EXPRESSION)].map((match) => match[0]).filter((found) => !DIMENSION.test(found));
}

function yamlFilesIn(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return yamlFilesIn(rel);
    return entry.endsWith('.yaml') ? [rel] : [];
  });
}

describe('定義のコメントに、数どうしの式を書かない', () => {
  // 拾い方が死んでいれば、下の「無い」は何も見ずに緑になる。直してきた形そのものを並べる。
  it.each([
    ['太い枝6本（1,000×6）＋縄1本（600）。', ['1,000×6']],
    ['5000gの内訳: 生肉500g×4 + 獣骨500g + 生皮600g = 3100g。', ['500g×4', '500g + 生皮600']],
    ['走り木1800＋横木6000＋縄600＝8400g', ['1800＋横木6000']],
    ['そり8000＋車輪2枚4000。', ['8000＋車輪2']],
    ['（56＋25で70を越える）', ['56＋25']],
    ['1日1,536mL（3食×512mL）が', ['3食×512']],
  ])('式を拾える: %s', (comment, expected) => {
    expect(expressionsIn(comment)).toEqual(expected);
  });

  it.each([
    ['1.8m×0.7m×0.25mの枠組み。'],
    ['（EV = log2(照度 / 2.5 lx)、同1節）'],
    ['正味+0.3/tick（免疫が高まっても+0.2/tick）'],
    ['段はどの本でも共通（0/20/60/180。比3）'],
  ])('式でないものは拾わない: %s', (comment) => {
    expect(expressionsIn(comment)).toEqual([]);
  });

  const files = yamlFilesIn(CODEX);

  it('定義のコメントを読めている', () => {
    const comments = files.flatMap((file) =>
      commentParts(readFileSync(join(ROOT, file), 'utf-8'), file).filter((part) => part !== null),
    );
    expect(files.length).toBeGreaterThan(1);
    expect(comments.length).toBeGreaterThan(files.length);
  });

  it.each(files)('%s', (file) => {
    const found = commentParts(readFileSync(join(ROOT, file), 'utf-8'), file).flatMap((comment, index) =>
      comment === null ? [] : expressionsIn(comment).map((expression) => `${file}:${index + 1} 「${expression}」`),
    );
    expect(
      found,
      '式で書いた数は、材料の側を動かしても古いまま残る——言葉で書き、関係は検査に見させる',
    ).toEqual([]);
  });
});
