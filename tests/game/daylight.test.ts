import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { SunlightHours } from '../../src/game/view/daylight';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 日の出・日の入りの境目をまたいだかの判定（`src/game/view/daylight.ts`）の試験。
 *
 * 判定するのは「太陽の光だけで手元の細かい作業ができるか」が切り替わった瞬間で、境目の数字も
 * 太陽高度の寄与も、宣言から読む（IlluminationSystem.md 5節・8節）。**天気を混ぜないこと**が
 * この判定の肝なので、雲が陽を遮る宣言を置いたうえで、境目が動かないことを見る。
 *
 * 世界の宣言はここに書く（同梱のcore.yamlは読まない、tests/architecture/testKinds.test.ts）。
 */

/**
 * 夜（底）と昼（+10以上）だけを持つ世界と、手元の作業に+5を要求するキャラクタ。
 * 同梱の`core.yaml`と同じ形——太陽高度はhourの段が、雲の遮りはweatherの段が`modify`する。
 */
const YAML = `
object_defs:
  world:
    singleton: true
    props:
      ambient_brightness:
        value: 0
        range: {min: -6, max: 17}
      hour:
        value: 12
        range: {min: 0, max: 24}
        stages:
          - {name: night, passives: [{modify: {self: {ambient_brightness: -6}}}]}
          - {name: sunrise, min: 6, passives: [{modify: {self: {ambient_brightness: 10}}}]}
          - {name: noon, min: 11, passives: [{modify: {self: {ambient_brightness: 16}}}]}
          - {name: sunset, min: 17, passives: [{modify: {self: {ambient_brightness: 10}}}]}
          - {name: night_late, min: 18, passives: [{modify: {self: {ambient_brightness: -6}}}]}
      weather:
        value: clear
        stages:
          - {name: clear}
          - {name: storm, passives: [{modify: {self: {ambient_brightness: -10}}}]}

  hero:
    tags: [character]
    props:
      hand_brightness:
        value: 0
        stages:
          - {name: pitch_dark}
          - {name: dim, min: -5}
          - {name: bright, min: 5}

  eyeless:
    tags: [character]
`;

/** 手元の明るさを見るキャラクタ（上のYAMLのheroと同じ宣言）。 */
const HERO = `
  hero:
    tags: [character]
    props:
      hand_brightness:
        value: 0
        stages:
          - {name: pitch_dark}
          - {name: dim, min: -5}
          - {name: bright, min: 5}
`;

/** 1日が8時しかない世界。5時から明るくなるので、明るいのは5・6・7の3つだけになる。 */
const SHORT_DAY_YAML = `
object_defs:
  world:
    singleton: true
    props:
      ambient_brightness:
        value: 0
        range: {min: -6, max: 17}
      hour:
        value: 0
        range: {min: 0, max: 8}
        stages:
          - {name: night, passives: [{modify: {self: {ambient_brightness: -6}}}]}
          - {name: day, min: 5, passives: [{modify: {self: {ambient_brightness: 10}}}]}
${HERO}`;

/** 時刻が値域を持たない世界。1日の長さが決まらないので、太陽の巡りも数えられない。 */
const NO_CLOCK_RANGE_YAML = `
object_defs:
  world:
    singleton: true
    props:
      ambient_brightness:
        value: 0
        range: {min: -6, max: 17}
      hour:
        value: 0
        stages:
          - {name: night, passives: [{modify: {self: {ambient_brightness: -6}}}]}
          - {name: day, min: 5, passives: [{modify: {self: {ambient_brightness: 10}}}]}
${HERO}`;

function sunlightHoursOf(yaml: string, character: string): SunlightHours {
  const loader = new WorldCodexYamlLoader();
  loader.load('test.yaml', yaml);
  const codex: WorldCodex = loader.buildAndReset();
  return SunlightHours.of(codex, codex.objects.get(codex.objectNames.getId(character)));
}

describe('SunlightHours（太陽の光だけで手元の作業ができる時刻）', () => {
  const sunlight = (): SunlightHours => sunlightHoursOf(YAML, 'hero');

  it('日の出の時から日の入りの時までが明るい', () => {
    const hours = sunlight();
    const lit = [...Array(24).keys()].filter((hour) => hours.handworkLitAt(hour));
    expect(lit).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('夜から昼へ移ると日の出、その日の生存日数を答える', () => {
    expect(sunlight().daybreakBetween({ elapsedDays: 9, hour: 5 }, { elapsedDays: 9, hour: 6 })).toEqual({
      kind: 'sunrise',
      elapsedDays: 9,
    });
  });

  it('昼から夜へ移ると日の入り', () => {
    expect(sunlight().daybreakBetween({ elapsedDays: 9, hour: 17 }, { elapsedDays: 9, hour: 18 })).toEqual({
      kind: 'sunset',
      elapsedDays: 9,
    });
  });

  it('境目をまたがない経過では何も出さない', () => {
    const hours = sunlight();
    expect(hours.daybreakBetween({ elapsedDays: 9, hour: 6 }, { elapsedDays: 9, hour: 7 })).toBeUndefined();
    expect(hours.daybreakBetween({ elapsedDays: 9, hour: 0 }, { elapsedDays: 9, hour: 1 })).toBeUndefined();
    // 時間を消費しない操作では、前後が同じ時刻のまま何度も比べられる。
    expect(hours.daybreakBetween({ elapsedDays: 9, hour: 6 }, { elapsedDays: 9, hour: 6 })).toBeUndefined();
  });

  it('日付をまたぐ夜の間は、日の出も日の入りも出さない', () => {
    expect(
      sunlight().daybreakBetween({ elapsedDays: 9, hour: 23 }, { elapsedDays: 10, hour: 0 }),
    ).toBeUndefined();
  });

  it('雲が陽を遮っても境目は動かない', () => {
    // 嵐（-10）は正午の明るさを16から6へ落とすが、それは太陽の位置ではないので日の入りではない。
    const stormy = sunlightHoursOf(YAML.replace('value: clear', 'value: storm'), 'hero');
    expect(stormy.handworkLitAt(6)).toBe(true);
    expect(stormy.handworkLitAt(5)).toBe(false);
  });

  it('手元の明るさに段を持たないキャラクタでは、どの時刻も明るくない', () => {
    const hours = sunlightHoursOf(YAML, 'eyeless');
    expect([...Array(24).keys()].filter((hour) => hours.handworkLitAt(hour))).toEqual([]);
    expect(hours.daybreakBetween({ elapsedDays: 9, hour: 5 }, { elapsedDays: 9, hour: 6 })).toBeUndefined();
  });

  it('1日の長さは時刻の値域が決める（上限そのものは繰り上がるので含まない）', () => {
    const hours = sunlightHoursOf(SHORT_DAY_YAML, 'hero');
    expect([...Array(24).keys()].filter((hour) => hours.handworkLitAt(hour))).toEqual([5, 6, 7]);
  });

  it('時刻が値域を持たない世界では、どの時刻も明るくない', () => {
    const hours = sunlightHoursOf(NO_CLOCK_RANGE_YAML, 'hero');
    expect([...Array(24).keys()].filter((hour) => hours.handworkLitAt(hour))).toEqual([]);
  });
});
