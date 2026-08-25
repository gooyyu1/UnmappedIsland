import { describe, expect, it } from 'vitest';
import type { RainWaterRow, SeasonName } from '../../src/analysis/seasonalRain';
import { SEASON_CLIMATE, rainWaterRows } from '../../src/analysis/seasonalRain';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 雨で溜まる水（`src/analysis/seasonalRain.ts`）の数え方の検証。
 *
 * **確かめるのはこの解析の規則で、同梱の定義に対する結論ではない。** 雨だけで水を賄えるのが雨季
 * だけであることと、`LiquidContainerSystem.md` 6節の日数表との一致は、同梱の定義を読む
 * `tests/diagnostics/rainWaterContent.test.ts` が見る。
 *
 * 容器も世界もここで宣言する（同梱の定義は読まない、tests/architecture/testKinds.test.ts）。
 * **世界を宣言するのは、蒸発の上乗せが明るさで決まるため**——時刻と天気が `ambient_brightness` へ
 * 与える寄与が無いと、日向と日陰の区別が付かない。値は `core.yaml` を真似ているが、時刻の刻みは
 * 「昼は一律に真上」まで単純にしてある。
 *
 * **条件の並びは同梱の `rain_filled_liquid`・`evaporating_liquid` と揃える。** 数え方は宣言の形に
 * 依るので、形が揃っていないと、同梱側にだけ増えた条件をこの試験が見逃す。
 */
describe('雨で溜まる水（seasonalRain）', () => {
  const YAML = `
object_defs:
  world:
    props:
      hour:
        value: 12
        range: {min: 0, max: 24}
        stages:
          - name: night
            passives:
              - modify: {self: {ambient_brightness: -6}}
          - name: day
            min: 6
            passives:
              - modify: {self: {ambient_brightness: 16}}
          - name: night_late
            min: 18
            passives:
              - modify: {self: {ambient_brightness: -6}}
      weather:
        value: clear
        stages:
          - {name: scorching}
          - name: sunny
            passives:
              - modify: {self: {ambient_brightness: -1}}
          - name: clear
            passives:
              - modify: {self: {ambient_brightness: -2}}
          - name: cloudy
            passives:
              - modify: {self: {ambient_brightness: -5}}
          - name: light_rain
            passives:
              - modify: {self: {ambient_brightness: -6}}
          - name: heavy_rain
            passives:
              - modify: {self: {ambient_brightness: -8}}
          - name: storm
            passives:
              - modify: {self: {ambient_brightness: -10}}
      ambient_brightness: {value: 0, range: {min: -6, max: 17}}

  # 甕（narrow、4L）。雨よけの無い場所で雨が降っている間だけ、降り方に応じてfillが増える。
  jar:
    tags: [item, narrow_open_container]
    props:
      fill:
        value: 0
        range: {min: 0, max: 4000}
        stages:
          # 段で縛られた増減。その段だった時間は天候の出現時間から決まらないので数えない。
          - name: any
            passives:
              - add: {self: {fill: 1000}}
      weight: {value: 1200}
    passives:
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
          - {subject: ancestor, prop: weather, eq: light_rain}
        add: {self: {fill: 20}}
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
          - {subject: ancestor, prop: weather, eq: heavy_rain}
        add: {self: {fill: 40}}
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
          - {subject: ancestor, prop: weather, eq: storm}
        add: {self: {fill: 80}}
      # 口径の違う容器あての宣言。同じ型に配られていても、この型では一度も効かない。
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
          - {subject: ancestor, prop: weather, eq: light_rain}
        add: {self: {fill: 10}}
      # 蒸発。基礎（雨天は除外）と、明るさのしきい値で決まる上乗せの和。
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: weather, not_in: [light_rain, heavy_rain, storm]}
        add: {self: {fill: -2}}
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: ambient_brightness, gte: 12}
        add: {self: {fill: -2}}
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: ambient_brightness, gte: 14}
        add: {self: {fill: -2}}
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: ambient_brightness, gte: 16}
        add: {self: {fill: -2}}

  # ヤシの器（wide、250mL）。降る量は甕の半分、蒸発も口径ぶん小さい。
  coconut_bowl:
    tags: [item, wide_open_container]
    props:
      fill: {value: 0, range: {min: 0, max: 250}}
      weight: {value: 100}
    passives:
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
          - {subject: ancestor, prop: weather, eq: light_rain}
        add: {self: {fill: 10}}
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
          - {subject: ancestor, prop: weather, eq: heavy_rain}
        add: {self: {fill: 20}}
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
          - {subject: ancestor, prop: weather, eq: storm}
        add: {self: {fill: 40}}
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: weather, not_in: [light_rain, heavy_rain, storm]}
        add: {self: {fill: -1}}
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: ambient_brightness, gte: 14}
        add: {self: {fill: -1}}
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: ambient_brightness, gte: 16}
        add: {self: {fill: -1}}

  # 蓋のできる容器。雨を受けないので、行が出てはいけない。
  waterskin:
    tags: [item]
    props:
      fill: {value: 0, range: {min: 0, max: 1000}}
      weight: {value: 200}
`;

  const codex = new WorldCodexYamlLoader().load('rainWater.yaml', YAML).buildAndReset();
  const rows = rainWaterRows(codex);
  const rowOf = (containerName: string, seasonName: SeasonName): RainWaterRow => {
    const row = rows.find(
      (candidate) => candidate.containerName === containerName && candidate.seasonName === seasonName,
    );
    expect(row, `${containerName} / ${seasonName} の行`).toBeDefined();
    return row!;
  };

  /** その季節のうち、雨が降っていない時間の割合。基礎の蒸発が効く時間そのもの。 */
  const dryFractionOf = (seasonName: SeasonName): number => {
    const season = SEASON_CLIMATE.find((candidate) => candidate.name === seasonName)!;
    const { light_rain, heavy_rain, storm } = season.hoursByWeather;
    return 1 - (light_rain + heavy_rain + storm) / (season.durationDays * 24);
  };

  it('雨を受ける容器だけが、季節ごとに1行ずつ出る', () => {
    expect(rows.map((row) => `${row.containerName}/${row.seasonName}`)).toEqual([
      'jar/calm',
      'jar/wet',
      'jar/dry',
      'coconut_bowl/calm',
      'coconut_bowl/wet',
      'coconut_bowl/dry',
    ]);
  });

  it('天候以外の条件が課されていても、その天候の量として数える', () => {
    // 雨を受ける宣言は「雨よけの下でないこと」も課している。祖先の条件のうち天候と明るさ以外は
    // 真偽を決めずに素通しする決まりなので、それを理由に数えるのをやめると、容器そのものが表から消える。
    for (const containerName of ['jar', 'coconut_bowl'])
      expect(rowOf(containerName, 'wet').rainPerDay, containerName).toBeGreaterThan(0);
  });

  it('効かない口径あての宣言・段で縛られた宣言は降雨に足さない', () => {
    // 甕は narrow の3つの宣言だけで増え、その量はどの降り方でもヤシの器のちょうど2倍。同じ型に
    // 配られている wide あての宣言や、fill の段の中に書かれた宣言（1000mL/tick）が混ざると、
    // この倍率が崩れる。
    for (const seasonName of ['calm', 'wet', 'dry'] as const)
      expect(
        rowOf('jar', seasonName).rainPerDay / rowOf('coconut_bowl', seasonName).rainPerDay,
        seasonName,
      ).toBeCloseTo(2, 6);
  });

  it('蒸発は容量ではなく口径で決まる', () => {
    // 甕はヤシの器の16倍の容量だが、蒸発は口径ごとの mL/tick なので同じ倍率にはならない。
    for (const seasonName of ['calm', 'wet', 'dry'] as const)
      expect(
        rowOf('jar', seasonName).evaporationPerDay / rowOf('coconut_bowl', seasonName).evaporationPerDay,
        seasonName,
      ).toBeLessThan(4);
  });

  it('雨天の間は蒸発しない', () => {
    // 基礎の宣言が雨系の天候を除外しているので、降っている時間が長い季節ほど蒸発は小さくなる。
    // 雨季の雨は乾季の30倍以上の時間降る。
    for (const containerName of ['jar', 'coconut_bowl'])
      expect(rowOf(containerName, 'wet').evaporationPerDay, containerName).toBeLessThan(
        rowOf(containerName, 'dry').evaporationPerDay / 2,
      );
  });

  it('日射の上乗せは、明るさのしきい値を超えている間だけ足される', () => {
    // この試験の世界では、夜（18-5時）は底の-6なので上乗せは1つも成立せず、昼（6-17時）は
    // 天候ぶんだけ暗い+16から始まる。つまり蒸発は「基礎だけ」より多く、「基礎＋上乗せ全部」より少ない。
    for (const [containerName, base, withBonus] of [
      ['jar', 2, 8],
      ['coconut_bowl', 1, 3],
    ] as const)
      for (const seasonName of ['calm', 'wet', 'dry'] as const) {
        const perDay = rowOf(containerName, seasonName).evaporationPerDay;
        const label = `${containerName} / ${seasonName}`;
        expect(perDay, label).toBeGreaterThan(base * 96 * dryFractionOf(seasonName));
        expect(perDay, label).toBeLessThan(withBonus * 96 * dryFractionOf(seasonName));
      }
  });

  it('天候の出現時間の合計が、季節の持続日数と釣り合う', () => {
    // 割合の分母は持続日数なので、天候が1つ書き落とされると、残り全部の重みが黙って小さくなる。
    for (const season of SEASON_CLIMATE) {
      const hours = Object.values(season.hoursByWeather).reduce((sum, value) => sum + value, 0);
      expect(hours, season.name).toBeCloseTo(season.durationDays * 24, 0);
    }
  });
});
