import { describe, expect, it } from 'vitest';
import { pathRequiredProgresses } from '../../src/domain/generation/IslandSpawner';

/**
 * 道が見つかる進捗の割り当て（ExplorationSystem.md 3.2節）が持つ2つの性質の検査。
 * **`src/analysis/pathDiscovery.ts` がこの2つへ寄りかかっている**——最初の時刻を本数によらない
 * ものとして読み、最後の時刻を本数を渡さずに引く。
 *
 * 割り当ては同梱の定義を読まない純粋な計算なので、ここで確かめられる（上限は試験の中で置く）。
 * 実際に湧いた道がこの並びを持つことは `tests/generation/islandSpawner.test.ts` が見る。
 */
describe('道が見つかる進捗の割り当て', () => {
  /** 土地が宣言している探索率100%までの回数の幅（locations.yamlは10〜20）を跨ぐ値。 */
  const PROGRESS_MAXES = [10, 15, 18, 20];

  /** 島に出る次数の幅を超えて確かめる（実測の最大は5）。 */
  const PATH_COUNTS = [2, 3, 4, 5, 6, 7, 8];

  it('最初の道は、道の本数にも探索の回数にもよらず同じ進捗で出る', () => {
    for (const progressMax of PROGRESS_MAXES)
      for (const pathCount of [1, ...PATH_COUNTS])
        expect(pathRequiredProgresses(pathCount, progressMax)[0], `上限${progressMax}・${pathCount}本`).toBe(
          2,
        );
  });

  it('最後の道の進捗は、道が2本以上ならその本数によらない', () => {
    for (const progressMax of PROGRESS_MAXES) {
      const lastOfTwo = pathRequiredProgresses(2, progressMax).at(-1);
      expect(lastOfTwo, `上限${progressMax}: 最後の道は探索率100%の手前`).toBe(progressMax - 1);

      for (const pathCount of PATH_COUNTS)
        expect(
          pathRequiredProgresses(pathCount, progressMax).at(-1),
          `上限${progressMax}・${pathCount}本の最後の道`,
        ).toBe(lastOfTwo);
    }
  });

  it('進捗は見つかる順に増えていく（同じ回に2本は出ない…とは限らない）', () => {
    // 等間隔の割り当ては、本数が多いと同じ進捗へ2本が当たりうる（上限10で5本なら2,3,5,7,9）。
    // **減らないこと**だけが並びの約束で、それが崩れると「見つかる順」が名前どおりでなくなる。
    for (const progressMax of PROGRESS_MAXES)
      for (const pathCount of PATH_COUNTS) {
        const progresses = pathRequiredProgresses(pathCount, progressMax);
        for (let i = 1; i < progresses.length; i++)
          expect(progresses[i], `上限${progressMax}・${pathCount}本の${i + 1}本目`).toBeGreaterThanOrEqual(
            progresses[i - 1],
          );
      }
  });
});
