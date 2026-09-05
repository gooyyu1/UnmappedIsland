import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { StepOutcome } from './CraftingStep';
import { craftingStepsOf } from './craftingSteps';
import { rangeEventReadouts } from './rangeEvents';

/**
 * 診断レポートが数える土地の集め方。**収支（`balanceTables`）と活動時間（`activityHours`）が同じ集合を
 * 見る**——どちらの表も答えたいのは「島の1日が賄えるか」で、集める条件が2箇所に割れると片方だけずれる。
 *
 * 集めるのは、探索できる土地（`location`タグ＋`exploration_progress`）のうち**海でしか手に入らない
 * ものではないもの**。海区（`voyage.yaml`）はその条件をそのまま満たす——探索でき、寝られ、雨も貯まる
 * ——が、島の土地ではないので分母に入れない。
 *
 * **線は「海でしか手に入らない」で、`sea`タグだけでは引けない。** 漁り場（`fish_shoal`）も小島
 * （`offshore_islet`）も海区に湧く設置物で、タグは持たない（小島に`sea`を付けると筏の`disembark`が
 * 通らなくなる）。湧き元を辿って、海区からしか生まれない型をまとめて外す（`seaOnly`）。
 */

/** 表に出す島の土地と、海として外したもの。 */
export interface IslandLocations {
  /** 島の土地。表の行になる。 */
  readonly island: readonly ObjectDef[];

  /**
   * 海として外した場所。**外したものも返す**のは、線を引いた位置をレポートへ書くため——海区は
   * 集め方の条件をそのまま満たすので、外したことが数字の側には現れない。
   */
  readonly excludedSea: readonly ExcludedLocation[];

  /**
   * 海でしか手に入らない型すべて（土地に限らない）。**工程の側もここを見る**——漁り場が生肉を
   * 30分で返すので、これを外さないと生肉の代表経路が海に決まり、島で最も安い肉の経路が表から
   * 押し出される。`excludedSea`はこの集合のうち土地であるもの。
   */
  readonly seaOnly: ReadonlySet<number>;
}

/** 表から外した場所1つ。 */
export interface ExcludedLocation {
  readonly def: ObjectDef;

  /**
   * 外す根拠にしたタグの名前。**外した側が名乗る**ので、レポートはこれをそのまま書き出せる。
   * 海区にしか湧かない土地は自分では名乗らないが、湧き元を辿れば同じタグに行き着く。
   */
  readonly tag: string;
}

export function islandLocationsOf(codex: WorldCodex): IslandLocations {
  const { locationTagId, seaTagId, explorationProgressId } = codex.vocabulary.world;
  const seaTag = codex.tagNames.getName(seaTagId);
  const seaOnly = seaOnlyObjectsOf(codex);

  const island: ObjectDef[] = [];
  const excludedSea: ExcludedLocation[] = [];
  for (const def of codex.objects) {
    if (!def.hasTag(locationTagId) || def.tryGetPropertyDef(explorationProgressId) === undefined) continue;
    if (seaOnly.has(def.globalId)) excludedSea.push({ def, tag: seaTag });
    else island.push(def);
  }
  return { island, excludedSea, seaOnly };
}

/**
 * 海でしか手に入らない型。**島の側から数えて、残りを海とする**——湧き元を持たない型（土地・
 * キャラクタ・地形が置く物）を島にあるものとして始め、そこから湧く型を辿れなくなるまで広げる。
 * 辿り着かなかったものが、海でしか手に入らない型になる。
 *
 * 種から外すのは`sea`タグを持つ型だけで、そこから先は湧き元が決める——漁り場は海区の見張りが、
 * 小島は海区の`exploration_progress.on_max`が湧かせるので、どちらも島からは辿り着かない。
 *
 * 湧き元を数え漏らした型は「湧き元を持たない」＝島にあるもの、へ倒れる。**外し過ぎない側へ倒れる**
 * ので、外した一覧に載るのは湧き元を実際に辿れたものだけになる。
 */
function seaOnlyObjectsOf(codex: WorldCodex): ReadonlySet<number> {
  const defs = [...codex.objects];
  const spawnsOf = new Map<number, readonly number[]>();

  /** 他の型が湧かせる型。ここに居ない型は、世界に置かれるか持ち物から組み立てるかで、湧く場所を持たない。 */
  const spawnedByOthers = new Set<number>();

  /** 自分が自分の湧き元になっている型（spawnsFrom参照）。持ち物から組み立てるので、湧く場所を持たない。 */
  const madeOfItself = new Set<number>();

  for (const def of defs) {
    const produced = spawnsFrom(codex, def);
    const byOthers = produced.filter((objectGlobalId) => objectGlobalId !== def.globalId);
    spawnsOf.set(def.globalId, byOthers);
    if (byOthers.length !== produced.length) madeOfItself.add(def.globalId);
    for (const objectGlobalId of byOthers) spawnedByOthers.add(objectGlobalId);
  }

  const reachable = new Set<number>();
  const pending: number[] = [];
  const reach = (globalId: number): void => {
    if (reachable.has(globalId)) return;
    reachable.add(globalId);
    pending.push(globalId);
  };

  const { seaTagId } = codex.vocabulary.world;
  for (const def of defs)
    if (!def.hasTag(seaTagId) && (!spawnedByOthers.has(def.globalId) || madeOfItself.has(def.globalId)))
      reach(def.globalId);
  while (pending.length > 0)
    for (const objectGlobalId of spawnsOf.get(pending.pop()!) ?? []) reach(objectGlobalId);

  return new Set(defs.filter((def) => !reachable.has(def.globalId)).map((def) => def.globalId));
}

/**
 * その型が世界へ湧かせる型。操作・レシピ（`craftingStepsOf`）に加えて、**値が端へ届いたときに起こる
 * ことも読む**——小島は海区の見張りが直に湧かせるのではなく、見張りを重ねた先の`on_max`が湧かせる。
 *
 * **自分自身も返す。** レシピの宣言は産物の側に付く（`recipesProducingThis`）ので、自分を湧かせる型は
 * 「持ち物から組み立てるもの」——縄も筏も湧く場所を持たず、どこで作ってもよい。
 */
function spawnsFrom(codex: WorldCodex, def: ObjectDef): readonly number[] {
  const produced = new Set<number>();
  const add = (outcomes: readonly StepOutcome[]): void => {
    for (const outcome of outcomes) for (const spawn of outcome.spawns) produced.add(spawn.objectGlobalId);
  };

  for (const step of craftingStepsOf(codex, def)) add(step.outcomes);
  for (const propertyDef of def.enumeratePropertyDefs())
    for (const readout of rangeEventReadouts(propertyDef, () => undefined)) add(readout.outcomes);
  return [...produced];
}
