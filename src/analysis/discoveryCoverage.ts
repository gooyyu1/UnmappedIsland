import type { IslandMap } from '../domain/generation/IslandMap';
import type { LocationTypeDef } from '../domain/generation/LocationTypeDef';
import type { ObjectGlobalId } from '../domain/GlobalId';
import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import { craftingStepsOf } from './craftingSteps';

/**
 * 探索で見つかる物が、生成された島にどれだけ行き渡るかを出す。
 *
 * 見るのは**契機が島から消えるかどうか**の1点だけ（[`SkillSystem.md`](../../docs/engine/SkillSystem.md)
 * 3節の発見経路）。ある型を名指しで契機に据えると、その型を出す土地が1つも生成されなかった島では、
 * その契機ごと消える。札（タグ）で束ねれば、束の中のどれかが出れば済むので消えにくい——**その差が
 * どれだけあるか**を数える。
 *
 * 返すのは数値と識別子だけで、判定（この取りこぼしは許せるか・どちらで書くべきか）は持たない。
 *
 * 引く線は次のとおり。**引きの運は数えない**——`pick`の重みが正なら、その土地を探索し続ければ
 * いずれ出る（[`ExplorationSystem.md`](../../docs/engine/ExplorationSystem.md) 2節、ハズレの候補は
 * 置かない）ので、島にその土地が在るかどうかだけを見る。**亜種は見ない**——亜種が上書きするのは
 * `pick`の重みだけで、しかも0を跨がないので、出るか出ないかは土地の型で決まる。**跨いだら投げる**
 * （{@link assertVariantsKeepWeightsPositive}）——跨ぐと、素の重みだけを見たこの数字が黙ってずれる。
 */

/** 探索で見つかる型1つ。 */
export interface DiscoverableObject {
  readonly name: string;

  /** その型が持つ札（宣言順）。 */
  readonly tagNames: readonly string[];

  /** その型を出す土地の型の名前（名前順）。 */
  readonly locationDefNames: readonly string[];

  /** 同じものを島のサイトと突き合わせるための形。 */
  readonly locationDefGlobalIds: ReadonlySet<ObjectGlobalId>;
}

/** 探索で見つかる型のうち、同じ札を持つものの束。 */
export interface DiscoverableTag {
  readonly name: string;

  /** その札を持つ、探索で見つかる型の名前（名前順）。 */
  readonly objectNames: readonly string[];

  /** 束のどれかを出す土地の型のグローバルID（和集合）。 */
  readonly locationDefGlobalIds: ReadonlySet<ObjectGlobalId>;
}

/**
 * locations.yamlの`explore`から実測した出どころ表。定義は島をまたいで変わらないので、島ごとの
 * 算出はこれを使い回す。
 */
export interface DiscoverySources {
  /** 探索で見つかる型（名前順）。 */
  readonly objects: readonly DiscoverableObject[];

  /** そのどれかが持つ札（名前順）。 */
  readonly tags: readonly DiscoverableTag[];
}

/** 島1つで、どの契機が消えたか。添字は{@link DiscoverySources}の並び。 */
export interface IslandDiscoveryCoverage {
  readonly seed: number;

  /** その型を出す土地が島に1つも無かった型の添字。 */
  readonly missingObjectIndices: readonly number[];

  /** その札を持つ型を出す土地が島に1つも無かった札の添字。 */
  readonly missingTagIndices: readonly number[];
}

/**
 * 探索で見つかる型と札を、探索できる土地の型すべてから実測する。
 *
 * 探索で1つも物が見つからない世界なら投げる——出どころが空のまま割合だけが出ると、その0%は
 * 「消えない」ではなく「数えていない」を意味することになる。
 */
export function discoverySourcesOf(codex: WorldCodex): DiscoverySources {
  const generation = codex.generation;
  if (generation === undefined)
    throw new Error('地形生成の定義（terrain_generation.yaml）がロードされていません。');

  /** 型のグローバルID → それを出す土地の型のグローバルID。 */
  const locationsByObject = new Map<ObjectGlobalId, Set<ObjectGlobalId>>();
  const seenLocationDefs = new Set<ObjectGlobalId>();

  for (const locationType of generation.locationTypes) {
    const locationDef = codex.objects.get(locationType.objectDefGlobalId);
    assertVariantsKeepWeightsPositive(codex, locationType, locationDef);
    if (seenLocationDefs.has(locationDef.globalId)) continue;
    seenLocationDefs.add(locationDef.globalId);

    for (const objectGlobalId of exploreSpawnsOf(codex, locationDef)) {
      const locations = locationsByObject.get(objectGlobalId) ?? new Set<ObjectGlobalId>();
      locations.add(locationDef.globalId);
      locationsByObject.set(objectGlobalId, locations);
    }
  }

  if (locationsByObject.size === 0) throw new Error('探索で見つかる型が1つもありません。');

  const objects = [...locationsByObject]
    .map(([objectGlobalId, locationDefGlobalIds]) => ({
      name: codex.objectNames.getName(objectGlobalId),
      tagNames: codex.objects
        .get(objectGlobalId)
        .tags.map((tagGlobalId) => codex.tagNames.getName(tagGlobalId)),
      locationDefNames: [...locationDefGlobalIds].map((id) => codex.objects.get(id).name).sort(),
      locationDefGlobalIds,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { objects, tags: tagsOf(objects) };
}

/** 島1つを測る。 */
export function islandDiscoveryCoverageOf(
  sources: DiscoverySources,
  map: IslandMap,
): IslandDiscoveryCoverage {
  const present = new Set(map.sites.map((site) => site.type!.objectDefGlobalId));

  return {
    seed: map.seed,
    missingObjectIndices: missingIndicesOf(sources.objects, present),
    missingTagIndices: missingIndicesOf(sources.tags, present),
  };
}

/** その土地の型が生成されなかったせいで、島から消えた契機の添字。 */
function missingIndicesOf(
  groups: readonly { readonly locationDefGlobalIds: ReadonlySet<ObjectGlobalId> }[],
  present: ReadonlySet<ObjectGlobalId>,
): number[] {
  return groups
    .map((_, index) => index)
    .filter((index) => [...groups[index].locationDefGlobalIds].every((globalId) => !present.has(globalId)));
}

/** 探索で見つかる型が持つ札を、束ねて並べる。 */
function tagsOf(objects: readonly DiscoverableObject[]): readonly DiscoverableTag[] {
  const objectNames = new Map<string, string[]>();
  const locations = new Map<string, Set<ObjectGlobalId>>();

  for (const object of objects)
    for (const tagName of object.tagNames) {
      objectNames.set(tagName, [...(objectNames.get(tagName) ?? []), object.name]);
      const union = locations.get(tagName) ?? new Set<ObjectGlobalId>();
      for (const globalId of object.locationDefGlobalIds) union.add(globalId);
      locations.set(tagName, union);
    }

  return [...objectNames]
    .map(([name, names]) => ({
      name,
      objectNames: names,
      locationDefGlobalIds: locations.get(name)!,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * その土地の亜種が、探索の候補の重みを0から動かしも0へ落としもしないことを確かめる。
 *
 * この表は**素の重みだけ**を見て「その土地が在れば、いずれ出る」と数える。亜種は発見量のつまみを
 * 上書きするだけのもの（[`TerrainGeneration.md`](../../docs/engine/TerrainGeneration.md) 3.6節）
 * なので今はそれで合っているが、**0を跨ぐ上書きが1つ入ると数字が黙ってずれる**——素で0のつまみを
 * 亜種が起こせば、その亜種の島でだけ出るものを「どの島でも出る」と数え、逆なら出ないものを数える。
 */
function assertVariantsKeepWeightsPositive(
  codex: WorldCodex,
  locationType: LocationTypeDef,
  locationDef: ObjectDef,
): void {
  for (const variant of locationType.variants)
    for (const [propertyGlobalId, value] of variant.props) {
      const base = locationDef.tryGetPropertyDef(propertyGlobalId)?.initialValueWithoutRoll;
      if (value > 0 && base !== undefined && base > 0) continue;

      const propertyName = codex.propertyNames.getName(propertyGlobalId);
      throw new Error(
        `土地 '${locationDef.name}' の亜種 '${variant.id}' が、'${propertyName}' を ${base ?? '未宣言'} ` +
          `から ${value} へ上書きしています。亜種は発見量のつまみを動かすだけで、0を跨いではいけません` +
          `（跨ぐなら、この表は亜種ごとに数え直す必要があります）。`,
      );
    }
}

/**
 * その土地の探索1回が生む型（重みが正のものだけ）。探索を宣言していない土地は投げる
 * （土地は必ず探索できる）。
 */
function exploreSpawnsOf(codex: WorldCodex, locationDef: ObjectDef): ReadonlySet<ObjectGlobalId> {
  const explore = craftingStepsOf(codex, locationDef).find(
    (step) => step.kind === 'interaction' && step.name === codex.vocabulary.world.exploreAction,
  );
  if (explore === undefined) throw new Error(`土地 '${locationDef.name}' が探索を宣言していません。`);

  const spawned = new Set<ObjectGlobalId>();
  for (const outcome of explore.outcomes) {
    if (outcome.probability <= 0) continue;
    for (const spawn of outcome.spawns) if (spawn.count > 0) spawned.add(spawn.objectGlobalId);
  }
  return spawned;
}
