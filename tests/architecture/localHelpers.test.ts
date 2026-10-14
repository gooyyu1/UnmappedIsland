import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, sourcesIn } from '../support/sourceFiles';

/**
 * **定義を引く助けが、検査ファイルの中に写しで生えていないか**の検査。
 *
 * 定義から値を引く読み方は `tests/support` に1つ置く。検査ごとに同じ助けを書くと、読み方を1つ直した
 * ときに他の写しが古いまま残り、同じ「宣言の値」を検査ごとに違う読み方で比べることになる。
 *
 * 見るのは、**型の名前を変数で受けて、作りたての1つから数値を読む**形（`declaredNumberOf`）。型を
 * 名指して作るのは個々の検査の手順で、名前を変数で受けた時点で、それは助けになっている。
 */
describe('検査ファイルの局所の助け', () => {
  it('型の宣言した数値を読む助けを、tests/support の外で書かない', () => {
    const found = sourcesIn('tests')
      .filter((file) => !file.startsWith('tests/support/'))
      .flatMap((file) =>
        [
          ...readFileSync(join(ROOT, file), 'utf8').matchAll(
            /createObject\(codex\.objectNames\.getId\(\w+\)\)\s*\.getProperty\([^;]*?\)\.number/g,
          ),
        ].map(([match]) => `${file}: ${match.replace(/\s+/g, ' ')}`),
      );

    expect(found, 'declaredNumberOf から引く（tests/support/declaredNumber.ts）').toEqual([]);
  });
});
