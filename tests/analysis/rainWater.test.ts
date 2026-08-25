import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RainWaterRow, SeasonName } from '../../src/analysis/seasonalRain';
import { SEASON_RAIN, rainWaterRows } from '../../src/analysis/seasonalRain';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 雨で溜まる水（`src/analysis/seasonalRain.ts`）の検証。
 *
 * **確かめるのは値そのものではなく符号。** 降雨も蒸発も実測値から出しているので、値は気候や容器の
 * 調整で動く。動いても変わってほしくないのは「雨だけで水を賄えるのは雨季だけ」という配分のほうで、
 * それは差引の符号がそのまま表している。
 *
 * **ただし実測値そのものは、出どころのドキュメントと突き合わせる。** 同じ値が2箇所にあると、
 * 片方だけが更新されても誰も気づかない。
 *
 * 容器はここで宣言する（同梱の定義は読まない、tests/architecture/testKinds.test.ts）。口径ごとの
 * 量は `docs/engine/LiquidContainerSystem.md` 7節と同じにしてあるので、同梱の甕・ヤシの器の行と
 * 同じ数字が出る。同梱の中身そのものに対する符号は、レポートを再生成する
 * `tests/diagnostics/balanceStatsReport.test.ts` が見る。
 *
 * **条件の並びも同梱の `rain_filled_liquid` と揃える。** 数え方は宣言の形に依るので、形が揃って
 * いないと、同梱側にだけ増えた条件（雨よけの `sheltered`）をこの試験が見逃す。
 */
describe('雨で溜まる水（seasonalRain）', () => {
  const YAML = `
object_defs:
  # 甕（narrow、4L）。雨よけの無い場所で雨が降っている間だけ、降り方に応じてfillが増える。
  jar:
    tags: [item, narrow_open_container]
    props:
      fill: {value: 0, range: {min: 0, max: 4000}}
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
      # 天候を名指ししていない増分。何tick効くかが天候の出現時間から決まらないので数えない。
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: sheltered, eq: 0}
        add: {self: {fill: 1000}}

  # ヤシの器（wide、250mL）。
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

  it('雨季は雨だけで水が増える', () => {
    for (const containerName of ['jar', 'coconut_bowl'])
      expect(rowOf(containerName, 'wet').netPerDay, containerName).toBeGreaterThan(0);
  });

  it('雨季以外は蒸発が降雨を上回る', () => {
    for (const containerName of ['jar', 'coconut_bowl'])
      for (const seasonName of ['calm', 'dry'] as const)
        expect(rowOf(containerName, seasonName).netPerDay, `${containerName} / ${seasonName}`).toBeLessThan(
          0,
        );
  });

  it('天候以外の条件が課されていても、その天候の量として数える', () => {
    // 雨を受ける宣言は「雨よけの下でないこと」も課している。祖先の条件は真偽を決めずに素通しする
    // 決まりなので、それを理由に数えるのをやめると、容器そのものが表から消える。
    for (const containerName of ['jar', 'coconut_bowl'])
      expect(rowOf(containerName, 'wet').rainPerDay, containerName).toBeGreaterThan(0);
  });

  it('効かない口径あての宣言・天候を名指ししない宣言は降雨に足さない', () => {
    // 甕は narrow の3つの宣言だけで増え、その量はどの降り方でもヤシの器のちょうど2倍。同じ型に
    // 配られている wide あての宣言や、天候を名指ししていない宣言（雨よけだけを見る1000mL/tick）が
    // 混ざると、この倍率が崩れる。
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

  /**
   * 蒸発の実測値も2箇所（設計ドキュメントの日数表と解析）にある。読み手が見るのは日数のほうで、
   * mL/tickはそれを容量で割っただけなので、割り戻して突き合わせる。
   */
  it('蒸発の実測値がLiquidContainerSystem.mdの日数表と一致する', () => {
    const doc = readFileSync(join('docs', 'engine', 'LiquidContainerSystem.md'), 'utf8').split(/\r?\n/);
    for (const [containerName, apertureLabel] of [
      ['coconut_bowl', 'ヤシの器'],
      ['jar', '甕'],
    ]) {
      const days = emptyingDaysOf(doc, apertureLabel);
      for (const season of SEASON_RAIN) {
        const row = rowOf(containerName, season.name);
        expect(row.capacity / row.evaporationPerDay, `${containerName} / ${season.name} の日数`).toBeCloseTo(
          days.get(season.name)!,
          1,
        );
      }
    }
  });

  /**
   * 気候の実測値が2箇所（気候レポートと解析）にあるので、ずれを機械で見る。突き合わせる相手を
   * `climateStatsReport.test.ts` ではなくその生成物にするのは、あの集計が20シード×3600日の
   * シミュレーションで、通常のテストスイートに置ける重さではないため。
   */
  describe('気候の実測値がClimateSystemStats.mdと一致する', () => {
    const report = readFileSync(join('docs', 'diagnostics', 'ClimateSystemStats.md'), 'utf8').split(/\r?\n/);

    it('季節の持続日数', () => {
      const section = sectionOf(report, '季節の持続日数');
      for (const season of SEASON_RAIN)
        expect(meanOf(section, season.name), season.name).toBeCloseTo(season.durationDays, 2);
    });

    it('雨の降っている時間', () => {
      for (const season of SEASON_RAIN) {
        const section = sectionOf(report, season.name);
        for (const [weather, hours] of Object.entries(season.hoursByWeather))
          expect(meanOf(subsectionOf(section, weather), '全体'), `${season.name} / ${weather}`).toBeCloseTo(
            hours,
            2,
          );
      }
    });
  });
});

/**
 * `docs/engine/LiquidContainerSystem.md` 6節の「満杯から空になるまでの日数」の表から、見出しが
 * その語を含む列（口径）を季節ごとに読む。
 */
function emptyingDaysOf(lines: readonly string[], apertureLabel: string): ReadonlyMap<SeasonName, number> {
  const start = lines.findIndex((line) => line.startsWith('満杯から空になるまでの日数'));
  expect(start, '日数表が見つからない').toBeGreaterThanOrEqual(0);
  const table = lines.slice(start);

  const header = table.find((line) => line.startsWith('|'));
  expect(header, '日数表の見出し行が見つからない').toBeDefined();
  const column = cellsOf(header!).findIndex((cell) => cell.includes(apertureLabel));
  expect(column, `列 '${apertureLabel}' が見つからない`).toBeGreaterThanOrEqual(0);

  const days = new Map<SeasonName, number>();
  for (const season of SEASON_RAIN) {
    const row = table.find((line) => line.startsWith(`| \`${season.name}\` |`));
    expect(row, `行 '${season.name}' が見つからない`).toBeDefined();
    days.set(season.name, Number.parseFloat(cellsOf(row!)[column]));
  }
  return days;
}

/** 表の行（`| a | b |`）の、両端の空文字を落としたセル。 */
function cellsOf(row: string): readonly string[] {
  return row
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

/** `## 見出し` から次の `## ` までの行。 */
function sectionOf(lines: readonly string[], heading: string): readonly string[] {
  return linesUnder(lines, `## ${heading}`, '## ');
}

/** 節の中の `#### 見出し` から次の `#### ` までの行。 */
function subsectionOf(lines: readonly string[], heading: string): readonly string[] {
  return linesUnder(lines, `#### ${heading}`, '#### ');
}

function linesUnder(lines: readonly string[], heading: string, siblingPrefix: string): readonly string[] {
  const start = lines.indexOf(heading);
  expect(start, `見出し '${heading}' が見つからない`).toBeGreaterThanOrEqual(0);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith(siblingPrefix));
  return end < 0 ? rest : rest.slice(0, end);
}

/** 統計表（`| 行の名前 | 平均 | ...`）の平均の列。 */
function meanOf(lines: readonly string[], rowLabel: string): number {
  const row = lines.find((line) => line.startsWith(`| ${rowLabel} |`));
  expect(row, `行 '${rowLabel}' が見つからない`).toBeDefined();
  return Number.parseFloat(row!.split('|')[2]);
}
