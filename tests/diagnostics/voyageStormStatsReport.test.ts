import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildBalanceTables } from '../../src/analysis/balanceTables';
import { VoyageDriftSimulation } from '../../src/analysis/voyageDrift';
import type { VoyageCourse, VoyageLegs } from '../../src/analysis/voyageLegs';
import { voyageLegsOf } from '../../src/analysis/voyageLegs';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeYamlReportRegeneration,
  formatYamlReport,
  rounded,
  statRecordWith,
  yieldToEventLoop,
} from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { bundledCodex, SAMPLE_CHARACTER, worldCodexPath } from '../support/worldCodexFiles';

/**
 * 荒天の押し流し（`docs/world/Voyage.md` 3.8節）を入れて出航地点から本土まで渡らせ、その結果を
 * `stats/voyage_storm.yaml`へ書き出す。
 *
 * **静的に解いた側（`stats/voyage.yaml`）と分けてあるのは、測り方が違うから。** 向こうは定義だけから
 * 解いて実行を通さない一方、押し流しは通してみないと何区間ぶんになるかが出ない（`voyageDrift.ts`）。
 *
 * **書き出すのは数値だけ。** 何を測ったか・引いた線・数えていないものは、手書きの
 * `docs/diagnostics/VoyageStormStats.md` が持つ。
 *
 * 海区の網・荒天の押し流し・天気と風向きの引き方を触ったときに再生成する: `npm run stats:voyage-storm`。
 * **鮮度は気候表と同じ2本立て**——`npm test` では指紋と静的に解ける節だけを見て、丸ごとの突き合わせは
 * `.github/workflows/regenerate-stats.yml` が `main` で持つ（末尾のdescribe）。
 */

/** 何本の世界を回すか。世界1本につき天気と風向きの引き方が1通り決まる。 */
const SEED_COUNT = 6;

/** 世界1本・出航地点1つにつき、何回渡らせるか。 */
const VOYAGES_PER_SEED = 100;

/** 日数・区間数の桁。 */
const DECIMALS = 2;

/** このレポートの分布レコード。**長引いた側の裾を見る**表なので、真ん中の列は `median`。 */
const statRecord = statRecordWith('median');

const REPORT_PATH = join('stats', 'voyage_storm.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'VoyageStormStats.md');

/**
 * 指紋が見る入力。**世界を回す側が読むのはこの2つ**——天気と風向きの引き方（`core.yaml`）と、
 * 海区の網・押し流しの卓（`voyage.yaml`）。
 *
 * **1日ぶんの自由時間（日数の分母）は指紋の外**で、島の献立を触れば動く。そこは指紋ではなく
 * `baseline` 節の**再計算そのもの**で突き合わせる（下のdescribe）。
 */
const FINGERPRINT_SOURCES = ['core.yaml', 'voyage.yaml'];

/**
 * 指紋が見る入力ファイルの中身のハッシュ。**改行はLFへ均す**——CRLFの作業ツリーで生成した指紋が、
 * LFの作業ツリーで食い違わないようにする。
 */
function inputFingerprint(): string {
  const hash = createHash('sha256');
  for (const fileName of FINGERPRINT_SOURCES)
    hash.update(readFileSync(worldCodexPath(fileName), 'utf8').replace(/\r\n/g, '\n'));
  return hash.digest('hex').slice(0, 16);
}

/** 出航地点×季節ごとに集めるもの。 */
interface StormStats {
  readonly days: Map<string, Stat>;
  readonly crossings: Map<string, Stat>;
  readonly sweptBackwards: Map<string, Stat>;
  readonly sweptForwards: Map<string, Stat>;
  readonly voidedCrossings: Map<string, Stat>;
}

function statOf(stats: Map<string, Stat>, key: string): Stat {
  let stat = stats.get(key);
  if (stat === undefined) stats.set(key, (stat = new Stat()));
  return stat;
}

/**
 * 測る針路。**出航地点ごとに、区間の最も少ない1本だけ**——押し流された先から先へ進む道は残り区間の
 * 少ないほうを採る（`voyageDrift.ts`）ので、遠回りを最初から選ぶ針路はこの測りに現れない。
 */
function measuredCourses(legs: VoyageLegs): readonly VoyageCourse[] {
  const courses = legs.courses.filter((course) => !course.detour);
  if (courses.length === 0) throw new Error('区間の最も少ない針路が1本もありません。');
  return courses;
}

/** その針路が、その季節に、押し流しを数えなければ何日かかるか。 */
function baselineDaysOf(course: VoyageCourse, seasonName: string): number {
  const total = course.bySeason.get(seasonName);
  if (total === undefined)
    throw new Error(`針路 '${course.coastName}' に季節 '${seasonName}' の合計がありません。`);
  return total.days;
}

/** 季節の綴り（宣言順）。針路が季節ごとの合計を持つので、そこから採る。 */
function seasonNamesOf(courses: readonly VoyageCourse[]): readonly string[] {
  const names = [...courses[0].bySeason.keys()];
  if (names.length === 0) throw new Error('季節ごとの合計がありません。');
  return names;
}

/**
 * 静的に解ける節（`baseline`）。**鮮度の突き合わせはここを再計算して見る**ので、シミュレーションを
 * 回さずに作れる形で1箇所に置く。
 */
function baselineRecords(courses: readonly VoyageCourse[], seasons: readonly string[]): YamlRecord[] {
  return courses.flatMap((course) =>
    seasons.map((season) => ({
      coast: course.coastName,
      season,
      legs: course.legs,
      days: rounded(baselineDaysOf(course, season), DECIMALS),
    })),
  );
}

function buildSections(
  courses: readonly VoyageCourse[],
  seasons: readonly string[],
  stats: StormStats,
): readonly YamlReportSection[] {
  const keys = courses.flatMap((course) =>
    seasons.map((season) => ({ course, season, key: `${course.coastName},${season}` })),
  );

  return [
    { key: 'meta', records: [{ seeds: SEED_COUNT, voyages_per_seed: VOYAGES_PER_SEED }] },
    {
      key: 'input_fingerprint',
      records: [{ sources: FINGERPRINT_SOURCES, sha256_prefix: inputFingerprint() }],
    },
    { key: 'baseline', records: baselineRecords(courses, seasons) },
    {
      key: 'course_storm',
      records: keys.map(({ course, season, key }) =>
        statRecord({ coast: course.coastName, season, unit: 'days' }, statOf(stats.days, key)),
      ),
    },
    {
      key: 'course_crossings',
      records: keys.map(({ course, season, key }) =>
        statRecord({ coast: course.coastName, season, unit: 'legs' }, statOf(stats.crossings, key)),
      ),
    },
    {
      key: 'sweeps',
      records: keys.map(({ course, season, key }) => ({
        coast: course.coastName,
        season,
        unit: 'times_per_voyage',
        backwards: rounded(statOf(stats.sweptBackwards, key).mean, DECIMALS),
        forwards: rounded(statOf(stats.sweptForwards, key).mean, DECIMALS),
        voided_crossings: rounded(statOf(stats.voidedCrossings, key).mean, DECIMALS),
      })),
    },
    {
      key: 'storm_cost',
      records: keys.map(({ course, season, key }) => ({
        coast: course.coastName,
        season,
        extra_days: rounded(statOf(stats.days, key).mean - baselineDaysOf(course, season), DECIMALS),
        extra_legs: rounded(statOf(stats.crossings, key).mean - course.legs, DECIMALS),
      })),
    },
  ];
}

/**
 * 押し流しを入れて渡らせ、レポートの中身を作る。
 *
 * **世界とシードの間でイベントループへ返す**（{@link yieldToEventLoop}）。1本の世界で1つの出航地点を
 * 渡り終えるのに数秒なので、これで足りる。
 */
async function buildReportFromDefinitions(): Promise<string> {
  const codex = bundledCodex();
  const legs = voyageLegsOf(codex, buildBalanceTables(codex, SAMPLE_CHARACTER));
  const courses = measuredCourses(legs);
  const seasons = seasonNamesOf(courses);

  const stats: StormStats = {
    days: new Map(),
    crossings: new Map(),
    sweptBackwards: new Map(),
    sweptForwards: new Map(),
    voidedCrossings: new Map(),
  };

  for (let seed = 1; seed <= SEED_COUNT; seed++) {
    for (const course of courses) {
      await yieldToEventLoop();

      // **出航地点ごとに世界を1つ**。同じ海に筏を2つ浮かべると、押し流しの卓がどちらか一方だけを
      // 動かすので、どちらの航海も相手の居ない世界のものではなくなる。
      const simulation = new VoyageDriftSimulation(codex, legs, seed);
      for (let voyage = 0; voyage < VOYAGES_PER_SEED; voyage++) {
        const run = simulation.sail(course.coastName, course.startZoneName);
        const key = `${run.coastName},${run.seasonName}`;
        statOf(stats.days, key).add(run.days);
        statOf(stats.crossings, key).add(run.crossings);
        statOf(stats.sweptBackwards, key).add(run.sweptBackwards);
        statOf(stats.sweptForwards, key).add(run.sweptForwards);
        statOf(stats.voidedCrossings, key).add(run.voidedCrossings);
      }
    }
  }

  return formatYamlReport(
    [
      '荒天の押し流しを入れて、出航地点から本土まで実際に渡らせた実測。',
      '生成物。手で書き換えず、npm run stats:voyage-storm で作り直す。',
      '何を測ったか・引いた線・数えていないものは docs/diagnostics/VoyageStormStats.md。',
    ],
    buildSections(courses, seasons, stats),
  );
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_VOYAGE_STORM_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

/** 節がずれていたときに出す直し方。 */
const REGENERATE_HINT = "'npm run stats:voyage-storm'で再生成する";

/**
 * 生成済みの`stats/voyage_storm.yaml`が、今の定義より古くなっていないか。
 *
 * 再生成は世界を何本も回すので、`npm test`では作り直さずに**入力が変わったことだけを軽く見る**。
 * シミュレーションの入力（`core.yaml`・`voyage.yaml`）は指紋で、定義から静的に解ける `baseline` 節は
 * 再計算で。**ここが見ないぶん**——シミュレーションのコードを変えて古くなった場合——は、
 * `.github/workflows/regenerate-stats.yml`が`main`で丸ごと作り直して拾う。
 *
 * **行は両向きで突き合わせる。** 今の定義から出る行を書き出し済みの表へ探しに行くだけでは、
 * **定義から出なくなった行が表に残っても気づけない**——出航地点を1つ減らす変更は、行が増える形では
 * なく減る形でしか現れない。
 */
describe('voyage_storm.yamlの鮮度', () => {
  const storedReport = (): Record<string, YamlRecord[]> =>
    parse(readFileSync(REPORT_PATH, 'utf8')) as Record<string, YamlRecord[]>;

  it('シミュレーションの入力が、指紋を取ったときから変わっていない', () => {
    expect(storedReport().input_fingerprint, `古い。${REGENERATE_HINT}`).toEqual([
      { sources: FINGERPRINT_SOURCES, sha256_prefix: inputFingerprint() },
    ]);
  });

  it('押し流しを数えない側の節が、今の定義から出る行と過不足なく一致する', () => {
    const codex = bundledCodex();
    const legs = voyageLegsOf(codex, buildBalanceTables(codex, SAMPLE_CHARACTER));
    const lineOf = (record: YamlRecord): string =>
      [record.coast, record.season, record.legs, Number(record.days).toFixed(DECIMALS)].join(' / ');
    const courses = measuredCourses(legs);

    expect(storedReport().baseline.map(lineOf), `古い。${REGENERATE_HINT}`).toEqual(
      baselineRecords(courses, seasonNamesOf(courses)).map(lineOf),
    );
  });
});
