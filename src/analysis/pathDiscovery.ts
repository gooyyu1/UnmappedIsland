import { pathRequiredProgresses } from '../domain/generation/IslandSpawner';
import type { ObjectGlobalId } from '../domain/GlobalId';
import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import { craftingStepsOf } from './craftingSteps';

/**
 * 土地の型1つの、**道が見つかる時刻表**。探索の進捗は1回の探索につき1進むので、進捗の値へ
 * 1回ぶんの時間を掛ければ、その道が見つかるまでにその土地で費やす探索時間が出る。
 *
 * 測るのは**その土地に居続けたときの時間**だけで、そこへ通う移動も、目当ての物を引くまでの回数も
 * 数えない（引きの運）。
 */
export interface PathDiscoverySchedule {
  readonly locationDefName: string;

  /** 探索1回にかかる時間（分）。 */
  readonly exploreMinutes: number;

  /** 探索率100%に達するまでの探索回数（`exploration_progress`の上限）。 */
  readonly exploresToFull: number;
}

/** 探索できる土地の型すべてについて、道が見つかる時刻表を実測する。 */
export function pathDiscoverySchedulesOf(
  codex: WorldCodex,
): ReadonlyMap<ObjectGlobalId, PathDiscoverySchedule> {
  const generation = codex.generation;
  if (generation === undefined)
    throw new Error('地形生成の定義（terrain_generation.yaml）がロードされていません。');

  const schedules = new Map<ObjectGlobalId, PathDiscoverySchedule>();
  for (const locationType of generation.locationTypes) {
    const locationDef = codex.objects.get(locationType.objectDefGlobalId);
    if (schedules.has(locationDef.globalId)) continue;

    schedules.set(locationDef.globalId, {
      locationDefName: locationDef.name,
      exploreMinutes: exploreMinutesOf(codex, locationDef),
      exploresToFull: exploresToFullOf(codex, locationDef),
    });
  }
  return schedules;
}

/**
 * 道が`pathCount`本ある土地で、それぞれの道が見つかるまでの探索時間（分）。並びは見つかる順で、
 * 割り当てそのものは`pathRequiredProgresses`（実体化する側と共有）が決める。
 */
export function discoveryMinutesOf(schedule: PathDiscoverySchedule, pathCount: number): readonly number[] {
  return pathRequiredProgresses(pathCount, schedule.exploresToFull).map(
    (progress) => progress * schedule.exploreMinutes,
  );
}

/**
 * 道の本数を問わず、その土地の道が全部出そろっているといえる探索時間（分）。
 * **いちばん遅く出る道の時刻**——道が1本だけの土地はもっと早く出る。
 */
export function allPathsDiscoveryMinutesOf(schedule: PathDiscoverySchedule): number {
  return Math.max(...discoveryMinutesOf(schedule, 2));
}

/** その土地を探索率100%まで開くのに要る探索時間（分）。1本目の早さを読む物差しになる。 */
export function fullExplorationMinutesOf(schedule: PathDiscoverySchedule): number {
  return schedule.exploresToFull * schedule.exploreMinutes;
}

function exploreMinutesOf(codex: WorldCodex, locationDef: ObjectDef): number {
  const explore = craftingStepsOf(codex, locationDef).find(
    (step) => step.kind === 'interaction' && step.name === codex.vocabulary.world.exploreAction,
  );
  if (explore === undefined) throw new Error(`土地 '${locationDef.name}' が探索を宣言していません。`);
  return explore.laborMinutes;
}

function exploresToFullOf(codex: WorldCodex, locationDef: ObjectDef): number {
  const range = locationDef.tryGetPropertyDef(codex.vocabulary.world.explorationProgressId)?.range;
  if (range === undefined)
    throw new Error(`土地 '${locationDef.name}' がexploration_progressのrangeを宣言していません。`);
  return range.max;
}
