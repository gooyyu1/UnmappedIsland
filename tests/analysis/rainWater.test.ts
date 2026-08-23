import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RainWaterRow } from '../../src/analysis/seasonalRain';
import { SEASON_RAIN, rainWaterRows } from '../../src/analysis/seasonalRain';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 雨で溜まる水（`src/analysis/seasonalRain.ts`）の検証。
 *
 * **確かめるのは値そのものではなく符号。** 降雨も蒸発も実測値から出しているので、値は気候や容器の
 * 調整で動く。動いても変わってほしくないのは「雨だけで水を賄えるのは雨季だけ」という配分のほうで、
 * それは差引の符号がそのまま表している。
 *
 * 容器はここで宣言する（同梱の定義は読まない、tests/architecture/testKinds.test.ts）。口径ごとの
 * 量は `docs/engine/LiquidContainerSystem.md` 7節と同じにしてあるので、同梱の甕・ヤシの器の行と
 * 同じ数字が出る。同梱の中身そのものに対する符号は、レポートを再生成する
 * `tests/diagnostics/balanceStatsReport.test.ts` が見る。
 */
describe('雨で溜まる水（seasonalRain）', () => {
  const YAML = `
object_defs:
  # 甕（narrow、4L）。雨が降っている間だけ、降り方に応じてfillが増える。
  jar:
    tags: [item, narrow_open_container]
    props:
      fill: {value: 0, range: {min: 0, max: 4000}}
      weight: {value: 1200}
    passives:
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: weather, eq: light_rain}
        add: {self: {fill: 20}}
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: weather, eq: heavy_rain}
        add: {self: {fill: 40}}
      - conditions:
          - {subject: self, matches: {tag: narrow_open_container}}
          - {subject: ancestor, prop: weather, eq: storm}
        add: {self: {fill: 80}}
      # 口径の違う容器あての宣言。同じ型に配られていても、この型では一度も効かない。
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: weather, eq: light_rain}
        add: {self: {fill: 10}}

  # ヤシの器（wide、250mL）。
  coconut_bowl:
    tags: [item, wide_open_container]
    props:
      fill: {value: 0, range: {min: 0, max: 250}}
      weight: {value: 100}
    passives:
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: weather, eq: light_rain}
        add: {self: {fill: 10}}
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
          - {subject: ancestor, prop: weather, eq: heavy_rain}
        add: {self: {fill: 20}}
      - conditions:
          - {subject: self, matches: {tag: wide_open_container}}
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
  const rowOf = (containerName: string, seasonName: string): RainWaterRow => {
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
      for (const seasonName of ['calm', 'dry'])
        expect(rowOf(containerName, seasonName).netPerDay, `${containerName} / ${seasonName}`).toBeLessThan(
          0,
        );
  });

  it('効かない口径あての宣言は降雨に足さない', () => {
    // 甕は narrow の宣言（light_rain 20mL/tick）だけで増える。同じ型に配られている wide の10mLを
    // 足してしまうと、雨の少ない季節でも差引が正へ転びうる。
    expect(rowOf('jar', 'calm').rainPerDay / rowOf('coconut_bowl', 'calm').rainPerDay).toBeCloseTo(2, 6);
  });

  it('蒸発は容量ではなく口径で決まる', () => {
    // 甕はヤシの器の16倍の容量だが、蒸発は口径ごとの mL/tick なので同じ倍率にはならない。
    for (const seasonName of ['calm', 'wet', 'dry'])
      expect(
        rowOf('jar', seasonName).evaporationPerDay / rowOf('coconut_bowl', seasonName).evaporationPerDay,
        seasonName,
      ).toBeLessThan(4);
  });

  /**
   * 気候の実測値が2箇所（気候レポートと解析）にあるので、ずれを機械で見る。突き合わせる相手を
   * `climateStatsReport.test.ts` ではなくその生成物にするのは、あの集計が20シード×3600日の
   * シミュレーションで、通常のテストスイートに置ける重さではないため。
   */
  describe('気候の実測値がClimateSystemStats.mdと一致する', () => {
    const report = readFileSync(join('docs', 'diagnostics', 'ClimateSystemStats.md'), 'utf8').split('\n');

    it('季節の持続日数', () => {
      const section = sectionOf(report, '季節の持続日数');
      for (const season of SEASON_RAIN)
        expect(meanOf(section, season.name), season.name).toBeCloseTo(season.durationDays, 2);
    });

    it('雨の降っている時間', () => {
      for (const season of SEASON_RAIN) {
        const section = sectionOf(report, season.name);
        for (const [weather, hours] of season.hoursByWeather)
          expect(meanOf(subsectionOf(section, weather), '全体'), `${season.name} / ${weather}`).toBeCloseTo(
            hours,
            2,
          );
      }
    });
  });
});

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
