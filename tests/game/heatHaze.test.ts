import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { heatHazeFor } from '../../src/game/ui/heatHaze';
import { skyTintFor } from '../../src/game/ui/skyTint';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 陽炎（heatHaze）と翳り・輝き（skyTint）が、同梱のWorldCodexが実際に作る値の上で意図どおりに
 * 効くことの検証。しきい値はcore.yamlの寄与から決めているので、寄与を変えるとここが落ちる。
 */
describe('空の演出が、同梱のWorldCodexの値の上で成り立つ', () => {
  let codex: WorldCodex;

  /** worldのプロパティを直接置いた状態で、日射と気温の実効値を読む。 */
  function skyWith(weather: string, hour: number, thermalLevel: number) {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    const world = game.world.instance;
    world.setNumber(codex.propertyNames.getId('weather'), codex.symbolNames.getId(weather));
    world.setNumber(codex.propertyNames.getId('hour'), hour);
    world.setNumber(codex.propertyNames.getId('thermal_level'), thermalLevel);
    return { sunlight: game.world.sunlight, temperature: game.world.ambientTemperature };
  }

  /** 涼しくも暑くもない季節（thermal_levelのmild段）。 */
  const MILD = 1000;
  /** 乾季後半の暑さ（hot段の下限）。 */
  const HOT = 1920;

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
  });

  it('夜は天気によらず日射が0になり、真夜中の快晴も明るくならない', () => {
    for (const weather of ['clear', 'sunny', 'scorching']) {
      const { sunlight } = skyWith(weather, 2, MILD);
      expect(sunlight, weather).toBe(0);
      expect(skyTintFor(sunlight)!.additive, `${weather}: 夜は翳る`).toBe(false);
    }
  });

  it('日中は、曇りが翳りも輝きも無い基準になり、晴れるほど明るくなる', () => {
    const brightness = (weather: string): number => {
      const tint = skyTintFor(skyWith(weather, 11, MILD).sunlight);
      return tint === undefined ? 0 : tint.alpha * (tint.additive ? 1 : -1);
    };

    expect(brightness('cloudy'), '曇りの日中は基準').toBe(0);
    expect(brightness('clear')).toBeGreaterThan(0);
    expect(brightness('sunny')).toBeGreaterThan(brightness('clear'));
    expect(brightness('scorching')).toBeGreaterThan(brightness('sunny'));
    expect(brightness('light_rain'), '雨は基準より暗い').toBeLessThan(0);
    expect(brightness('storm')).toBeLessThan(brightness('light_rain'));
  });

  it('陽炎は、暑い季節の日中にだけ立つ', () => {
    expect(heatHazeFor(skyWith('scorching', 11, HOT).temperature), '乾季後半の灼熱').toBeDefined();
    expect(heatHazeFor(skyWith('sunny', 11, HOT).temperature), '乾季後半の晴天でも立つ').toBeDefined();
    expect(heatHazeFor(skyWith('scorching', 2, HOT).temperature), '同じ季節でも夜は立たない').toBeUndefined();
    expect(
      heatHazeFor(skyWith('scorching', 11, MILD).temperature),
      '暑い季節でなければ立たない',
    ).toBeUndefined();
  });

  it('陽炎は、暑いほど強く歪む', () => {
    const hot = heatHazeFor(skyWith('scorching', 11, HOT).temperature)!;
    const milder = heatHazeFor(27)!;

    expect(hot.strength).toBeGreaterThan(milder.strength);
    expect(milder.strength, '立ち始めでも消えるほど弱くはしない').toBeGreaterThan(0);
  });
});
