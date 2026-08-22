import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { heatHazeFor } from '../../src/game/looks/heatHaze';
import { skyTintFor } from '../../src/game/looks/skyTint';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 空の演出（skyTint・heatHaze）を、世界・意匠を繋いだまま通す試験。
 *
 * 意匠のしきい値は、気候が実際に作る値を当て込んで決めている（陽炎の27度、翳りの基準になる曇りの
 * 日射）。**どちらか片方だけでは、噛み合わなくなったことが分からない**——日射や気温の寄与を変えれば
 * 意匠は無言でずれる。ここはその噛み合わせだけを見るので、**実データ（core.yaml）に依存する**。
 */
describe('空の演出（世界→意匠 通し）', () => {
  let codex: WorldCodex;

  /** worldのプロパティを直接置いた状態で、日射と気温の実効値を読む。 */
  function skyWith(weather: string, hour: number, thermalLevel: number) {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
    const world = game.world.instance;
    world.tryGetProperty(codex.propertyNames.getId('weather'))?.setNumber(codex.symbolNames.getId(weather));
    world.tryGetProperty(codex.propertyNames.getId('hour'))?.setNumber(hour);
    world.tryGetProperty(codex.propertyNames.getId('thermal_level'))?.setNumber(thermalLevel);
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
});
