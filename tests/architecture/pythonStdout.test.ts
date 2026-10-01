import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackedFiles } from '../../scripts/docScope.mjs';

/**
 * Python が標準出力へ書く符号化の検査。
 *
 * **Windows の Python は、書き先が端末でないとき（パイプ・ファイル・捨て先）ロケールの符号化で書く。**
 * 英語のロケールなら cp1252 で日本語を1字も書けず、日本語のロケールの cp932 でも `〜`（U+301C）は
 * 書けない。どちらも `print` が `UnicodeEncodeError` を投げてスクリプトごと止まる。端末へ直に
 * 書いたときと、Linux・macOS では起きないので、書いた人の手元ではまず見えない
 * （`tests/scripts/usageTimeline.test.ts` が Windows のCIでだけ落ちた）。
 *
 * だから `print` を持つスクリプトは、どれも冒頭で標準出力を UTF-8 に固定する。書く字に日本語が
 * 入るかでは分けない——書く値（パス・引数）に入るかは、書いた時点では決まらない。
 */

const ROOT = resolve(__dirname, '../..');

const FIXES = 'sys.stdout.reconfigure(encoding="utf-8")';

/**
 * 固定している行。**モジュールの最上位（行頭）に在るものだけ**を数える——コメントの中や関数の中に
 * 書いたものは、`print` より先に走る保証が無い。
 */
const FIXING_LINE = /^sys\.stdout\.reconfigure\(encoding="utf-8"\)$/m;

const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

const printing = trackedFiles(ROOT, '*.py').filter((rel) => read(rel).includes('print('));

/** 固定の行が、最初の `print(` より前に在るか。 */
function fixesBeforePrinting(source: string): boolean {
  const lf = source.replace(/\r\n/g, '\n');
  const fixing = FIXING_LINE.exec(lf);
  return fixing !== null && fixing.index < lf.indexOf('print(');
}

describe('Python の標準出力', () => {
  it('print を持つスクリプトは、標準出力を UTF-8 に固定している', () => {
    expect(
      printing.filter((rel) => !fixesBeforePrinting(read(rel))),
      `最初の print より前に、モジュールの最上位で ${FIXES} を置く`,
    ).toEqual([]);
  });

  it('見張る先が在る', () => {
    // 列挙の仕方が壊れたときに、検査が黙って空を通さないようにする。
    expect(printing).toContain(join('scripts', 'usage', 'timeline.py'));
  });
});
