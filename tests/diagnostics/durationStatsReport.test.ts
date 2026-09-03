import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Duration, ToolWear } from '../../src/analysis/durations';
import { MINIMUM_DAYS, durationsOf, toolWearsOf } from '../../src/analysis/durations';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  RoundedNumber,
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
} from '../support/generatedReport';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 定義全体の**日をまたぐ長さ**を、種類を問わず1本の列に並べ（`src/analysis/durations.ts`）、
 * `stats/durations.yaml`へ書き出す。
 *
 * **しきい値は置かない。** 怪我より食べ物が長いことも、重い傷より軽い傷が長引くことも、赤/緑では
 * 言わない——ここが持つのは並びだけで、逆転が許されるかを決めるのは並びを読んでからになる。
 *
 * **書き出すのは数値だけ。** 何を数えたか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/DurationStats.md` が持つ。日数を決める値（怪我のseverity・食べ物のdurability・
 * season_remaining・道具のdurability）を触った後に再生成する: `npm run stats:durations`。
 * 再生成と鮮度の形は `tests/support/generatedReport.ts` が持つ。定義から解くだけなので、鮮度は
 * 丸ごと作り直して比べる。
 */

function buildSections(
  durations: readonly Duration[],
  toolWears: readonly ToolWear[],
): readonly YamlReportSection[] {
  return [
    {
      key: 'meta',
      records: [
        {
          unit: 'days',
          minimum: MINIMUM_DAYS,
          durations: durations.length,
          longest: days(durations[0]?.days ?? 0),
          shortest: days(durations[durations.length - 1]?.days ?? 0),
          tool_wears: toolWears.length,
        },
      ],
    },
    { key: 'durations', records: durations.map(durationRecord) },
    { key: 'tool_wear', records: toolWears.map(toolWearRecord) },
  ];
}

/** 長さ1行。**この節の並びそのものが答え**なので、種類で分けずに長い順のまま書く。 */
function durationRecord(duration: Duration): YamlRecord {
  return {
    object: duration.objectName,
    property: duration.propertyName,
    unit: 'days',
    days: days(duration.days),
    shortest_days: days(duration.shortestDays),
    longest_days: days(duration.longestDays),
    repeats: duration.repeats,
    destroys: duration.destroysSelf,
  };
}

/** 使うたびに減る値1行。単位が回数なので、上の節とは別に並べる（DurationStats.md参照）。 */
function toolWearRecord(wear: ToolWear): YamlRecord {
  return {
    object: wear.objectName,
    property: wear.propertyName,
    step: wear.stepName,
    owner: wear.stepOwnerName,
    unit: 'uses',
    uses: new RoundedNumber(wear.uses, 2),
    labor_minutes: wear.laborMinutes,
  };
}

/** 日数は小数第2位まで（0.01日＝約14分）。**並べ替えは丸める前の値で済んでいる**ので、同じ値に
 * 丸められた2行が並んでも順序は正しい。 */
function days(value: number): RoundedNumber {
  return new RoundedNumber(value, 2);
}

const REPORT_PATH = join('stats', 'durations.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'DurationStats.md');

/** 定義から数えて、レポートの中身を作る。再生成と鮮度の確認が同じものを見るための1箇所。 */
function buildReportFromDefinitions(): string {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  return formatYamlReport(
    [
      '日をまたぐ長さを、種類を問わず長い順に並べたもの。',
      '定義（src/assets/world-codex/*.yaml）だけから計算した。実行は通していない。',
      '生成物。手で書き換えず、npm run stats:durations で作り直す。',
      '何を数えて何を数えていないかは docs/diagnostics/DurationStats.md。',
    ],
    buildSections(durationsOf(codex), toolWearsOf(codex)),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_DURATION_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:durations', buildReportFromDefinitions);

/**
 * **生成時に1回ロールする初期値（6.2節）の上端が、列に載ること。** 骨折は10.5〜14日だが、下端の
 * 10.50しか出ていなかった（issue #1160）。この表の仕事は逆転の検出なので、上端が見えないと
 * 「上端でだけ起こる逆転」を緑のまま通す。
 */
describe('生成時にロールする長さの幅', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  const severityOf = (objectName: string) =>
    durationsOf(codex).find(
      (duration) => duration.objectName === objectName && duration.propertyName === 'severity',
    );

  it('骨折が、最も軽い折れ方と最も重い折れ方の幅として載る', () => {
    // severityは1008〜1344 tickを1回引いて-1/tickで減る（injuries.yaml）。条件つきの増減は
    // 持たないので、幅を作っているのはロールだけ——daysとshortest_daysは一致したままになる。
    expect(severityOf('fracture')).toMatchObject({
      days: 1008 / 96,
      shortestDays: 1008 / 96,
      longestDays: 1344 / 96,
    });
  });

  it('同じロールを持つ他の傷も、上端まで載る', () => {
    expect(severityOf('snare_laceration')).toMatchObject({ days: 240 / 96, longestDays: 480 / 96 });
    expect(severityOf('bruise')).toMatchObject({ days: 120 / 96, longestDays: 240 / 96 });
  });

  it('位相をロールする周期は、幅を持たない', () => {
    // 罠や畑の見えないタイマーが引くのは待ち時間ではなく位相（TrapSystem.md 2.1節）。値が戻って
    // 繰り返す周期の長さは戻った量で決まるので、初期値のロールは長さを変えない。
    const growth = durationsOf(codex).find((duration) => duration.propertyName === 'growth_remaining');

    expect(growth).toMatchObject({ repeats: true });
    expect(growth?.longestDays).toBe(growth?.days);
  });
});

/**
 * **同時には成立しない条件つきの増減で終わる長さが、列から落ちないこと。** どちらも打ち消し合って
 * 周期そのものが立たず、丸ごと消えていた（issue #1155）。日をまたぐ長さの列は逆転を機械で見つける
 * ための道具なので、死の期限が欠けたままだと何を見落としているかが分からない。
 */
describe('同時には成立しない増減で終わる長さ', () => {
  const codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();

  const daysOf = (propertyName: string) =>
    durationsOf(codex).filter((duration) => duration.propertyName === propertyName);

  it('凍死が、寒い所での長さと雨の野ざらしでの長さの幅として載る', () => {
    // 気温を同じ境目の逆向きの演算子で見る3ブロック（-2・-6・+8）。4本目の死に方（VitalsSystem.md
    // 8節）で、700 kcalを寒い所の-2/tickなら350 tick、雨に打たれる-6/tickなら116.7 tickで失う。
    // -2と-6は屋根と雨の有無が裏返しなので重ならない——足して-8にすると、最短が0.9日まで縮む。
    const warmth = daysOf('warmth');

    expect(warmth.map((duration) => duration.objectName)).toEqual(['captain', 'engineer', 'farmer', 'medic']);
    for (const duration of warmth) {
      expect(duration.days).toBeCloseTo(700 / 2 / 96, 6);
      expect(duration.shortestDays).toBeCloseTo(700 / 6 / 96, 6);
      expect(duration.destroysSelf).toBe(true);
    }
  });

  it('閉じ込めた獣の渇きが、飢えと並んで載る', () => {
    // 渇く-1と、囲いの飲み水から飲む+1は同じゲートを持つが、飲めるのは水が残っている間だけ
    // （TrapSystem.md 5.4節）。必ず重なるものとして足すと0になり、罠に掛かった獣の最も短い死の
    // 期限——人が見回りに戻れる長さ——が列から消える。
    const beasts = ['junglefowl', 'monkey', 'rat', 'wild_boar'];
    const hydration = daysOf('hydration').filter((duration) => beasts.includes(duration.objectName));

    expect(hydration.map((duration) => duration.objectName)).toEqual(beasts);
    for (const duration of hydration) {
      expect(duration.days).toBeCloseTo(336 / 96, 6);
      expect(duration.destroysSelf).toBe(true);
    }
  });
});
