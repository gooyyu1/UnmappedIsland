import { join } from 'node:path';
import type { HuntEncounterSetup } from '../../src/analysis/huntEncounter';
import { HUNTER, beastMoveCountsOf, runHuntEncounter } from '../../src/analysis/huntEncounter';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { YamlRecord, YamlReportSection } from '../support/generatedReport';
import {
  describeDocumentedSections,
  describeReportFreshness,
  describeYamlReportRegeneration,
  formatYamlReport,
  rounded,
  shareRecord,
  statRecordWith,
  yieldToEventLoop,
} from '../support/generatedReport';
import { Stat } from '../support/Stat';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 狩りの遭遇を実際に通して数え（`src/analysis/huntEncounter.ts`）、`stats/hunt.yaml`へ書き出す。
 *
 * **静的な集計では出ない値のためにある**（docs/engine/HuntingSystem.md 8節）。何手で逃げに転じるか、
 * 槍と斧で結末がどう違うか、深手を負わせた獲物が何手残るかは、獣の1手とこちらの一撃を交互に
 * 回すまで決まらない。
 *
 * **しきい値は置かない。** ここが持つのは数字だけで、長すぎるか短すぎるかを決めるのはこの数字が
 * 出てから。**書き出すのも数値だけ**で、何を数えたか・引いた線は手書きの
 * `docs/diagnostics/HuntStats.md` が持つ。
 *
 * 獣・武器・怪我の定義を触った後に再生成する: `npm run stats:hunt`。再生成と鮮度の形は
 * `tests/support/generatedReport.ts` が持つ。**丸ごと作り直して比べる**（数秒で済む）。
 */

/** 数える獣。`animals.yaml`で`beast` traitを名乗る型のすべて。 */
const ANIMALS = ['rat', 'junglefowl', 'monkey', 'wild_boar'] as const;

/** 数える武器。`tools.yaml`で`weapon` traitを名乗る型のすべて。 */
const WEAPONS = ['sharp_stone', 'stone_axe', 'spear'] as const;

/**
 * 逃げ道の本数。**0と1だけを見る**——逃走の候補の重みは道の本数を見ない（`among`が集合から1本
 * 選ぶだけ）ので、2本目から先は1本と同じになる。分かれ目は「逃げ道が在るか」の1点。
 */
const ESCAPE_ROUTES = [0, 1] as const;

/** 1手の顔ぶれを数えるときの警戒。段の名前が変わる位置を1つずつ。 */
const WARINESS_CASES = [
  { stage: 'calm', value: 0 },
  { stage: 'wary', value: 40 },
  { stage: 'enraged', value: 85 },
] as const;

const ENCOUNTER_SEEDS = 150;
const MOVE_SEEDS = 500;
const TRACKING_SEEDS = 12;

/** 遭遇の打ち切り。**尖った石のイノシシは届かない**ので、届かなかったことが`undecided`に出る。 */
const ENCOUNTER_TURN_LIMIT = 60;

/** 追跡の窓の打ち切り。最も長く残る傷（刺し傷720tick）＋立ち去りの96tickより長く取る。 */
const TRACKING_TURN_LIMIT = 1000;

/** 警戒が引き切るのを見るための打ち切り。最も長い初期値より長く取る。 */
const WARINESS_TURN_LIMIT = 96;

/** 分布の列。**真ん中の位置を見る表**なので`median`。 */
const statRecord = statRecordWith('median');

const REPORT_PATH = join('stats', 'hunt.yaml');
const DOC_PATH = join('docs', 'diagnostics', 'HuntStats.md');

async function buildReportFromDefinitions(): Promise<string> {
  const codex = bundledCodex();
  const sections: YamlReportSection[] = [];

  sections.push({
    key: 'meta',
    records: [
      {
        hunter: HUNTER,
        animals: ANIMALS.length,
        weapons: WEAPONS.length,
        encounter_seeds: ENCOUNTER_SEEDS,
        move_seeds: MOVE_SEEDS,
        tracking_seeds: TRACKING_SEEDS,
        unit: 'turns',
        encounter_turn_limit: ENCOUNTER_TURN_LIMIT,
        tracking_turn_limit: TRACKING_TURN_LIMIT,
      },
    ],
  });

  sections.push({ key: 'wariness', records: warinessRecords(codex) });
  await yieldToEventLoop();

  const encounters = encounterRecords(codex);
  sections.push({ key: 'encounter', records: encounters.measures });
  sections.push({ key: 'ending', records: encounters.endings });
  await yieldToEventLoop();

  sections.push({ key: 'beast_move', records: beastMoveRecords(codex) });
  await yieldToEventLoop();

  sections.push({ key: 'tracking', records: trackingRecords(codex) });

  return formatYamlReport(
    [
      '狩りの遭遇を、同梱の定義のまま実際に通して数えた手数。',
      '密林に狩人と獣を1頭ずつ置き、殴る側は毎手番かならず武器を重ねる。島の生成は通していない。',
      '生成物。手で書き換えず、npm run stats:hunt で作り直す。',
      '何を数えて何を数えていないかは docs/diagnostics/HuntStats.md。',
    ],
    sections,
  );
}

/** 現れたときの警戒と、そこから近寄れる・掴めるまでの手数（獣ごと）。 */
function warinessRecords(codex: WorldCodex): YamlRecord[] {
  return ANIMALS.map((animalName) => {
    const encounter = runHuntEncounter(
      codex,
      { animalName, escapeRoutes: 0, groundItems: [], turnLimit: WARINESS_TURN_LIMIT },
      0,
    );
    return {
      animal: animalName,
      appears_at: encounter.warinessAtStart,
      appears_in: encounter.warinessStageAtStart ?? null,
      unit: 'turns',
      until_calm: encounter.turnsUntilCalm ?? null,
      until_unguarded: encounter.turnsUntilUnguarded ?? null,
    };
  });
}

/** 遭遇1つぶんの分布と結末。 */
function encounterRecords(codex: WorldCodex): { measures: YamlRecord[]; endings: YamlRecord[] } {
  const measures: YamlRecord[] = [];
  const endings: YamlRecord[] = [];

  for (const animalName of ANIMALS) {
    for (const weaponName of WEAPONS) {
      for (const escapeRoutes of ESCAPE_ROUTES) {
        const keys = { animal: animalName, weapon: weaponName, escape_routes: escapeRoutes };
        const turns = new Stat();
        const wounds = new Stat();
        const endingCounts = new Map<string, number>();

        for (let seed = 0; seed < ENCOUNTER_SEEDS; seed++) {
          const encounter = runHuntEncounter(
            codex,
            { animalName, weaponName, escapeRoutes, groundItems: [], turnLimit: ENCOUNTER_TURN_LIMIT },
            seed,
          );
          turns.add(encounter.turns);
          wounds.add(encounter.woundsTaken);
          endingCounts.set(encounter.ending, (endingCounts.get(encounter.ending) ?? 0) + 1);
        }

        measures.push(statRecord({ ...keys, measure: 'turns', unit: 'turns' }, turns));
        measures.push(statRecord({ ...keys, measure: 'wounds_taken', unit: 'wounds' }, wounds));
        for (const [ending, count] of sortedByName(endingCounts)) {
          endings.push(shareRecord({ ...keys, ending }, count / ENCOUNTER_SEEDS));
        }
      }
    }
  }
  return { measures, endings };
}

/**
 * 1手の顔ぶれ（獣×警戒×間合い）。**手番を1つだけ回して数える**——2手目からはその1手が変えた
 * 世界（くわえた物・逃げた先）を見ることになり、素の配分ではなくなる。
 *
 * 足元には持ち去りの相手（ヤシの実）と体当たりの相手（編み籠）を1つずつ置く。置かないと、
 * その2つの候補は相手が居ないまま抽選に出ない。
 */
function beastMoveRecords(codex: WorldCodex): YamlRecord[] {
  const records: YamlRecord[] = [];

  for (const animalName of ANIMALS) {
    for (const braced of [false, true]) {
      for (const wariness of WARINESS_CASES) {
        const counts = new Map<string, number>();
        const setup: HuntEncounterSetup = {
          animalName,
          escapeRoutes: 1,
          groundItems: ['coconut', 'woven_basket'],
          startingWariness: wariness.value,
          turnLimit: 1,
        };

        for (let seed = 0; seed < MOVE_SEEDS; seed++) {
          const encounter = runHuntEncounter(codex, braced ? withBracedReach(setup) : setup, seed);
          for (const [move, count] of beastMoveCountsOf(encounter)) {
            counts.set(move, (counts.get(move) ?? 0) + count);
          }
        }

        records.push({
          animal: animalName,
          wariness: wariness.stage,
          braced_reach: braced,
          unit: 'percent',
          moves: sortedByName(counts)
            .filter(([, count]) => count > 0)
            .map(([move, count]) => ({ move, share: rounded((count / MOVE_SEEDS) * 100, 2) })),
        });
      }
    }
  }
  return records;
}

/**
 * 追跡の窓。**一撃だけ入れて、道の通っていない土地へ退く**——そこから獲物が世界に残る手数を数える。
 * 外した回も混ぜる（傷の付かなかった個体がどうなるかも窓のうち）。
 */
function trackingRecords(codex: WorldCodex): YamlRecord[] {
  const records: YamlRecord[] = [];

  for (const animalName of ANIMALS) {
    for (const weaponName of WEAPONS) {
      const turns = new Stat();
      const endingCounts = new Map<string, number>();

      for (let seed = 0; seed < TRACKING_SEEDS; seed++) {
        const encounter = runHuntEncounter(
          codex,
          {
            animalName,
            weaponName,
            escapeRoutes: 1,
            groundItems: [],
            strikesBeforeLeaving: 1,
            turnLimit: TRACKING_TURN_LIMIT,
          },
          seed,
        );
        turns.add(encounter.turns);
        endingCounts.set(encounter.ending, (endingCounts.get(encounter.ending) ?? 0) + 1);
      }

      records.push({
        ...statRecord({ animal: animalName, weapon: weaponName, unit: 'turns' }, turns),
        endings: sortedByName(endingCounts).map(([ending, count]) => ({
          ending,
          share: rounded((count / TRACKING_SEEDS) * 100, 2),
        })),
      });
    }
  }
  return records;
}

/** 槍を手にした狩人を立ち会わせる。**振らせはしない**——測りたいのは構えの効きだけだから。 */
function withBracedReach(setup: HuntEncounterSetup): HuntEncounterSetup {
  return { ...setup, weaponName: 'spear', striking: false };
}

/** 名前の昇順。**出現順で書くと、同じ入力でもシードの引き方で行が入れ替わる。** */
function sortedByName(counts: ReadonlyMap<string, number>): [string, number][] {
  return [...counts].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
}

const DOCUMENTED_SECTIONS = describeDocumentedSections(DOC_PATH, REPORT_PATH);

describeYamlReportRegeneration(
  REPORT_PATH,
  'RUN_HUNT_STATS',
  buildReportFromDefinitions,
  DOCUMENTED_SECTIONS.required,
);

describeReportFreshness(REPORT_PATH, 'npm run stats:hunt', buildReportFromDefinitions);
