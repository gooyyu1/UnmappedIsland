import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { WorldSession } from '../../src/domain/WorldSession';
import { seededRng } from '../../src/domain/Rng';

// value: {min, max} 記法（GameElementDefinition.md 6.2節）による「初期値をレンジ内でランダムに決める」
// 挙動の検証。spawn（WorldSession.rng経由）では[min,max]の一様乱数、RNGを渡さない直接生成では
// 決定的にminになる。
describe('初期値のrandom range', () => {
  const yaml = `
object_defs:
  gem:
    props:
      quality:
        value: {min: 10, max: 20}
`;

  function load(): WorldCodex {
    return new WorldCodexYamlLoader().load('core.yaml', yaml).build();
  }

  it('spawnした初期値はrangeの範囲内に収まり、複数の値が現れる', () => {
    const codex = load();
    const qualityId = codex.propertyNames.getId('quality');
    const gemId = codex.objectNames.getId('gem');
    const session = new WorldSession(codex, undefined, seededRng(12345));

    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const v = session.spawn(gemId).tryGetProperty(qualityId)?.number ?? 0;
      expect(v).toBeGreaterThanOrEqual(10); // 初期値は[min,max]の閉区間に収まる
      expect(v).toBeLessThanOrEqual(20);
      seen.add(v);
    }

    expect(seen.size).toBeGreaterThan(1); // 100体分では複数の異なる初期値が現れる（ランダム化されている）
    expect(seen.has(20)).toBe(true); // 上限maxも取りうる（閉区間）
  });

  it('同じシードで生成すると初期値も再現する', () => {
    const codex = load();
    const qualityId = codex.propertyNames.getId('quality');
    const gemId = codex.objectNames.getId('gem');

    function firstSpawn(seed: number): number {
      return (
        new WorldSession(codex, undefined, seededRng(seed)).spawn(gemId).tryGetProperty(qualityId)?.number ??
        0
      );
    }

    // 同じシードなら初期値も再現する（決定的に振る舞わせられる）
    expect(firstSpawn(999)).toBe(firstSpawn(999));
  });
});
