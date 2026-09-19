import { beforeAll, describe, expect, it } from 'vitest';
import type { StartedGame } from '../../src/domain/generation/NewGame';
import type { PropertyValue } from '../../src/domain/PropertyValue';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { startNewGame } from '../../src/domain/generation/NewGame';
import { heatHazeFor } from '../../src/game/looks/heatHaze';
import { skyTintFor } from '../../src/game/looks/skyTint';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import { parseLocale } from '../../src/locale/Localization';
import { bundledCodex, SAMPLE_CHARACTER } from '../support/worldCodexFiles';
import { seededRng } from '../../src/domain/Rng';

/**
 * 空の演出（skyTint・heatHaze）を、世界・意匠を繋いだまま通す試験。
 *
 * 意匠のしきい値は、気候が実際に作る値を当て込んで決めている（陽炎の27度、翳りの基準になる曇りの
 * 正午の明るさ）。**どちらか片方だけでは、噛み合わなくなったことが分からない**——明るさや気温の
 * 寄与を変えれば意匠は無言でずれる。ここはその噛み合わせだけを見るので、
 * **実データ（core.yaml）に依存する**。
 */
describe('空の演出（世界→意匠 通し）', () => {
  let codex: WorldCodex;

  /** worldの天気・時刻・季節を直接置いた周回。 */
  function gameWith(weather: string, hour: number, thermalLevel: number): StartedGame {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, seededRng(1234));
    const world = game.world.instance;
    world.tryGetProperty(codex.propertyNames.getId('weather'))?.setNumber(codex.symbolNames.getId(weather));
    world.tryGetProperty(codex.propertyNames.getId('hour'))?.setNumber(hour);
    world.tryGetProperty(codex.propertyNames.getId('thermal_level'))?.setNumber(thermalLevel);
    return game;
  }

  /** 空の気温（worldのambient_temperature）。 */
  function skyTemperature(game: StartedGame): PropertyValue {
    return game.world.instance.getProperty(codex.propertyNames.getId('ambient_temperature'));
  }

  /**
   * その空での、翳りが読む明るさと、陽炎が読む気温。**翳りは空を、陽炎は居る土地を見る**
   * （ScreenLayout.md 7.5節の対応表）ので、同じ空から引いても出どころが分かれる。
   */
  function skyWith(weather: string, hour: number, thermalLevel: number) {
    const game = gameWith(weather, hour, thermalLevel);
    return {
      brightness: game.world.ambientBrightness,
      temperature: game.player.location?.ambientTemperature,
    };
  }

  /** 涼しくも暑くもない季節（thermal_levelのmild段）。 */
  const MILD = 1000;
  /** 乾季後半の暑さ（hot段の下限）。 */
  const HOT = 1920;

  beforeAll(() => {
    codex = bundledCodex();
  });

  it('夜は天気によらず底へ均され、真夜中の快晴も明るくならない', () => {
    for (const weather of ['clear', 'sunny', 'scorching']) {
      const { brightness } = skyWith(weather, 2, MILD);
      expect(brightness, weather).toBe(-6);
      expect(skyTintFor(brightness)!.additive, `${weather}: 夜は翳る`).toBe(false);
    }
  });

  it('正午は、曇りが翳りも輝きも無い基準になり、晴れるほど明るくなる', () => {
    const tintDepth = (weather: string): number => {
      const tint = skyTintFor(skyWith(weather, 11, MILD).brightness);
      return tint === undefined ? 0 : tint.alpha * (tint.additive ? 1 : -1);
    };

    expect(tintDepth('cloudy'), '曇りの正午は基準').toBe(0);
    expect(tintDepth('clear')).toBeGreaterThan(0);
    expect(tintDepth('sunny')).toBeGreaterThan(tintDepth('clear'));
    expect(tintDepth('scorching')).toBeGreaterThan(tintDepth('sunny'));
    expect(tintDepth('light_rain'), '雨は基準より暗い').toBeLessThan(0);
    expect(tintDepth('storm')).toBeLessThan(tintDepth('light_rain'));
  });

  it('空だけで陽炎が立つのは、暑い季節の日中', () => {
    expect(heatHazeFor(skyWith('scorching', 11, HOT).temperature), '乾季後半の灼熱').toBeDefined();
    expect(heatHazeFor(skyWith('sunny', 11, HOT).temperature), '乾季後半の晴天でも立つ').toBeDefined();
    expect(heatHazeFor(skyWith('scorching', 2, HOT).temperature), '同じ季節でも夜は立たない').toBeUndefined();
    expect(
      heatHazeFor(skyWith('scorching', 11, MILD).temperature),
      '暑い季節でなければ立たない',
    ).toBeUndefined();
  });

  it('陽炎が受け取るのは居る土地の気温で、空の気温ではない', () => {
    // 陽炎はレーン＝居る土地の地面を歪ませる演出（ScreenLayout.md 7.5.4節）なので、読む先は土地の
    // 側。土地は海抜ぶんだけ空より低い（ClimateSystem.md 1.1節）ので、空を読んでいれば値がずれる
    // ——**画面へ渡る数がどちらの側かを見るのはここだけ**で、意匠は渡された数しか知らない。
    const game = gameWith('scorching', 11, HOT);
    const land = game.startLocation.instance.getProperty(codex.propertyNames.getId('ambient_temperature'));
    land.setNumber(-7);

    const view = fromGameSession(game, parseLocale('ja.yaml', 'object_texts: {}\n'));

    expect(view.currentLocationTemperature, '居る土地の気温そのまま').toBe(land.getEffectiveValue());
    expect(view.currentLocationTemperature, '空の気温とは違う').not.toBe(
      skyTemperature(game).getEffectiveValue(),
    );
  });

  it('居る土地で炉が燃えていれば、空が暑くなくても陽炎は立つ', () => {
    // 土地の気温には据えた炉の暖（+8、FireSystem.md 9.2節）も積まれる。読む先を空から土地へ移した
    // ことで陽炎の立つ場面が広がった——**広がったことをここで留める**ので、狭めるなら
    // ScreenLayout.md 7.5.4節ごと決め直すことになる。
    const game = gameWith('clear', 11, MILD);
    const land = game.player.location!;
    expect(heatHazeFor(land.ambientTemperature), '炉が無ければ立たない').toBeUndefined();

    const campfire = game.session.createObject(codex.objectNames.getId('campfire'));
    expect(
      campfire.moveToSlotOrRejection(land.instance.getSlot(codex.slotNames.getId('fixtures'))),
      '土地の設置物として据える',
    ).toBeUndefined();
    campfire.getProperty(codex.propertyNames.getId('heat')).setNumber(20);

    expect(heatHazeFor(land.ambientTemperature), '炉の暖が積まれれば立つ').toBeDefined();
  });
});
