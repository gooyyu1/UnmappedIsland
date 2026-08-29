import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';
import type { CraftingInput, CraftingStep } from './CraftingStep';
import { craftingStepsOf } from './craftingSteps';
import { islandLocationsOf } from './islandLocations';

/**
 * 島の産物から**島を出るのに要るもの**まで、工程の鎖が閉じているかを数える。`startupReach.ts` が
 * 最初の段（火口・錐・軸・刃・水・食料）を測るのに対し、こちらは最後の段を測る。
 *
 * 返すのは識別子と数だけで、判定（この鎖は長すぎるか・何日で組み上がるか）は持たない。しきい値を
 * 決めるのはこの数字が出てからで、道具の側が先に決めてしまうと、決める材料が道具の判定に汚染される
 * （`startupReach.ts` 冒頭と同じ理由）。
 *
 * 引く線は4つ。
 *
 * **出発集合は島の土地そのもの。** 探索も他と同じ1つの工程として回す（`craftingStepsOf`）ので、
 * `explore`が何を配るかを読み直さない。島に湧く動物も探索が配るので、同じ道を通って出てくる。海区は
 * 出発集合に入れないため、海の産物は船が出来るまで手に入らない。
 *
 * **島ごとの土地の配りは数えない。** 数えるのは定義の上で鎖が閉じるかで、その土地が生成された島に
 * 在るかは別の問い（`startupReach`が島ごとに測る軸）。
 *
 * **個数は数えない。** 同じ工程は何度でも繰り返せるので、届くかどうかに個数は効かない。道具
 * （`consume: false`）も、減らないだけで要ることに変わりはなく、材料と同じ1つの入力として数える。
 *
 * **実行時にしか決まらないものは解かない。** 抽選（`pick`）は確率が0でない分岐が返す物を「返る」と
 * 読み、どの回に何を引くかは数えない（`startupReach`が期待個数で読むのと同じ線）。
 */

/**
 * 島を出るのに要るものを名乗るタグ（ContentSkeleton.md 3節の系統12）。**識別子（`raft`・
 * `rawhide_sail`）を直接書かない**——船や帆が増えたときに、この道具が古い世界を測ったまま緑になる。
 */
export const ESCAPE_GOAL_TAG_NAMES: readonly string[] = ['boat', 'sail'];

/** 工程の入力1つ。 */
export interface NeedInput {
  /** タグで指した入力（`{tag: cutting_tool}`）ならそのタグ名。型そのものを指す入力ではundefined。 */
  readonly tagName: string | undefined;

  /**
   * その入力が名指しする型。タグで指した入力では、島から最も少ない工程で届く型を代表に1つ選び
   * （同じ工程数なら宣言順）、届く型が1つも無ければundefined。
   */
  readonly objectName: string | undefined;

  /** 工程がその入力を消費するか。道具は消えないが、要ることに変わりはない（冒頭「個数は数えない」）。 */
  readonly consumed: boolean;
}

/** 工程1つ。名前と宣言している型は`CraftingStep`のまま持つ（表示名の引き方が違うので`kind`も持つ）。 */
export interface NeedStep {
  readonly kind: CraftingStep['kind'];
  readonly name: string;
  readonly ownerObjectName: string;
  readonly inputs: readonly NeedInput[];
}

/** 島の産物から、要るもの1つへ届くまで。 */
export interface NeedReach {
  /** 何工程先か。0は島にそのまま在るもの（探索できる土地）。 */
  readonly hops: number;

  /** そこへ最も少ない工程で届いた工程（同じ工程数なら宣言順で先）。`hops`が0の型ではundefined。 */
  readonly via: NeedStep | undefined;
}

/** 届かない要るものを生みうる工程1つ。 */
export interface BlockedStep {
  readonly step: NeedStep;

  /** その工程の入力のうち、島から届かないもの。**空にはならない**——全部満たせるなら届いている。 */
  readonly missing: readonly NeedInput[];
}

/** 島を出るのに要るもの1つ。 */
export interface EscapeNeed {
  readonly objectName: string;

  /** 目標そのものなら、それを名乗っているタグ名。材料としてだけ要るものではundefined。 */
  readonly goalTagName: string | undefined;

  /** 届いたなら、そこまでの数え。届かないならundefined。 */
  readonly reach: NeedReach | undefined;

  /** 届かないときだけ、その型を生みうる工程と、そのうち島に無い入力。届いた型では空。 */
  readonly blockedBy: readonly BlockedStep[];
}

/** 数えた結果。 */
export interface EscapeReach {
  /** 出発集合＝島にそのまま在るもの（探索できる島の土地）。並びは宣言順。 */
  readonly departureObjectNames: readonly string[];

  /**
   * 島を出るのに要るもの——目標そのもの（`ESCAPE_GOAL_TAG_NAMES`を名乗る型）と、そこへ推移的に
   * 要求される型。並びは工程数の昇順、同じなら宣言順。
   *
   * **推移の展開は、届いた工程だけを辿る。** その型を生みうる工程すべてへ広げると、島では通らない
   * 作り方の材料まで「要るもの」に数えられ、鎖が閉じていても届かないものが並ぶ。途切れた型だけは、
   * どこで切れたかを言うために生みうる工程すべてへ広げる。
   */
  readonly needs: readonly EscapeNeed[];

  /** そのうち届かなかったもの。**空なら鎖は閉じている。** */
  readonly unreachedNeeds: readonly EscapeNeed[];
}

/**
 * 定義から数える。
 *
 * 目標のタグを名乗る型が1つも無ければ投げる——島を出る手立てが宣言されていないのに数えると、
 * 「要るものは全部揃っている」が空集合について成り立ってしまう。
 */
export function escapeReachOf(codex: WorldCodex): EscapeReach {
  const departure = islandLocationsOf(codex).island;
  const tagBearers = tagBearersOf(codex);
  const closure = closureFrom(codex, tagBearers, departure);

  const goals = new Map<number, string>();
  for (const tagName of ESCAPE_GOAL_TAG_NAMES) {
    const tagGlobalId = codex.tagNames.tryGetId(tagName);
    const bearers = tagGlobalId === undefined ? [] : (tagBearers.get(tagGlobalId) ?? []);
    if (bearers.length === 0) throw new Error(`タグ '${tagName}' を名乗る型が1つもありません。`);
    for (const objectGlobalId of bearers) if (!goals.has(objectGlobalId)) goals.set(objectGlobalId, tagName);
  }

  const needs = needsOf(codex, closure, tagBearers, goals);
  return {
    departureObjectNames: departure.map((def) => def.name),
    needs,
    unreachedNeeds: needs.filter((need) => need.reach === undefined),
  };
}

/** タグ → それを名乗る型（宣言順）。 */
type TagBearers = ReadonlyMap<number, readonly number[]>;

/** 島の産物から届いた型と、そこまでの工程数・工程。 */
interface Closure {
  /** 型 → 何工程先か。載っていない型は島から届かない。 */
  readonly hops: ReadonlyMap<number, number>;

  /** 型 → 最も少ない工程でそこへ届いた工程。出発集合の型は載らない。 */
  readonly via: ReadonlyMap<number, CraftingStep>;

  /** 世界のすべての工程。届かない型がどこで切れたかも、ここから引く。 */
  readonly steps: readonly CraftingStep[];
}

/**
 * 出発集合から辿れる型を、工程数の段ごとに広げる。
 *
 * **同じ段の中で届いた型は、その段の入力にしない。** 工程の並び順で工程数が変わらないための決めで
 * あり、これが**循環に落ちないこと**でもある——ある型の工程数はその入力すべてより必ず大きいので、
 * 自分を材料にして自分へ届く鎖は数えられない。
 */
function closureFrom(codex: WorldCodex, tagBearers: TagBearers, departure: readonly ObjectDef[]): Closure {
  const steps = [...codex.objects].flatMap((def) => craftingStepsOf(codex, def));
  const hops = new Map<number, number>(departure.map((def) => [def.globalId, 0]));
  const via = new Map<number, CraftingStep>();

  for (let round = 1; ; round++) {
    const arrived = new Map<number, CraftingStep>();
    for (const step of steps) {
      if (!step.inputs.every((input) => satisfierOf(hops, tagBearers, input) !== undefined)) continue;
      for (const objectGlobalId of producedBy(step))
        if (!hops.has(objectGlobalId) && !arrived.has(objectGlobalId)) arrived.set(objectGlobalId, step);
    }
    if (arrived.size === 0) return { hops, via, steps };

    for (const [objectGlobalId, step] of arrived) {
      hops.set(objectGlobalId, round);
      via.set(objectGlobalId, step);
    }
  }
}

/**
 * 目標から要るものを推移的に集める。届いた型は届いた工程の入力を辿り、届かない型はそれを生みうる
 * 工程すべてへ広げる——**途切れた先だけが広がる**ので、鎖が閉じている限り一覧は実際に通る道だけになる。
 */
function needsOf(
  codex: WorldCodex,
  closure: Closure,
  tagBearers: TagBearers,
  goals: ReadonlyMap<number, string>,
): readonly EscapeNeed[] {
  const needs = new Map<number, EscapeNeed>();
  const pending = [...goals.keys()];

  while (pending.length > 0) {
    const objectGlobalId = pending.pop()!;
    if (needs.has(objectGlobalId)) continue;

    const hops = closure.hops.get(objectGlobalId);
    const via = closure.via.get(objectGlobalId);
    const blockedBy: BlockedStep[] = [];

    if (hops === undefined)
      for (const step of closure.steps) {
        if (!producedBy(step).includes(objectGlobalId)) continue;
        const missing = step.inputs.filter(
          (input) => satisfierOf(closure.hops, tagBearers, input) === undefined,
        );
        blockedBy.push({
          step: needStepOf(codex, closure, tagBearers, step),
          missing: missing.map((input) => needInputOf(codex, closure, tagBearers, input)),
        });
        for (const input of missing) pending.push(...declaredSatisfiersOf(tagBearers, input));
      }

    if (via !== undefined)
      for (const input of via.inputs) pending.push(satisfierOf(closure.hops, tagBearers, input)!);

    needs.set(objectGlobalId, {
      objectName: codex.objects.get(objectGlobalId).name,
      goalTagName: goals.get(objectGlobalId),
      reach:
        hops === undefined
          ? undefined
          : { hops, via: via === undefined ? undefined : needStepOf(codex, closure, tagBearers, via) },
      blockedBy,
    });
  }

  const sorted = [...needs].sort(([leftId, left], [rightId, right]) =>
    hopsOrder(left) !== hopsOrder(right) ? hopsOrder(left) - hopsOrder(right) : leftId - rightId,
  );
  return sorted.map(([, need]) => need);
}

/** 並べるときの工程数。届かないものは末尾へ置く。 */
function hopsOrder(need: EscapeNeed): number {
  return need.reach?.hops ?? Number.MAX_SAFE_INTEGER;
}

function needStepOf(
  codex: WorldCodex,
  closure: Closure,
  tagBearers: TagBearers,
  step: CraftingStep,
): NeedStep {
  return {
    kind: step.kind,
    name: step.name,
    ownerObjectName: codex.objects.get(step.ownerGlobalId).name,
    inputs: step.inputs.map((input) => needInputOf(codex, closure, tagBearers, input)),
  };
}

function needInputOf(
  codex: WorldCodex,
  closure: Closure,
  tagBearers: TagBearers,
  input: CraftingInput,
): NeedInput {
  const named = input.kind === 'object' ? input.objectGlobalId : satisfierOf(closure.hops, tagBearers, input);
  return {
    tagName: input.kind === 'tag' ? codex.tagNames.getName(input.tagGlobalId) : undefined,
    objectName: named === undefined ? undefined : codex.objects.get(named).name,
    consumed: input.consumed,
  };
}

/**
 * その入力を満たしている型（島から届いているもの）。満たせていなければundefined。
 *
 * 工程の入力には宣言した型そのもの（self）も並ぶので、**木を見つけていなければ木は切れない**。
 */
function satisfierOf(
  hops: ReadonlyMap<number, number>,
  tagBearers: TagBearers,
  input: CraftingInput,
): number | undefined {
  if (input.kind === 'object') return hops.has(input.objectGlobalId) ? input.objectGlobalId : undefined;

  let cheapest: number | undefined;
  let cheapestHops = Number.MAX_SAFE_INTEGER;
  for (const objectGlobalId of tagBearers.get(input.tagGlobalId) ?? []) {
    const bearerHops = hops.get(objectGlobalId);
    if (bearerHops !== undefined && bearerHops < cheapestHops) {
      cheapest = objectGlobalId;
      cheapestHops = bearerHops;
    }
  }
  return cheapest;
}

/** その入力を満たしうる型（届いていなくてもよい）。途切れた先を辿るのはこちら。 */
function declaredSatisfiersOf(tagBearers: TagBearers, input: CraftingInput): readonly number[] {
  return input.kind === 'object' ? [input.objectGlobalId] : (tagBearers.get(input.tagGlobalId) ?? []);
}

/** 1回の実行で生まれうる型。**確率0の分岐は数えない**——重み0の候補は引かれない。 */
function producedBy(step: CraftingStep): readonly number[] {
  const produced = new Set<number>();
  for (const outcome of step.outcomes)
    if (outcome.probability > 0) for (const spawn of outcome.spawns) produced.add(spawn.objectGlobalId);
  return [...produced];
}

function tagBearersOf(codex: WorldCodex): TagBearers {
  const bearers = new Map<number, number[]>();
  for (const def of codex.objects)
    for (const tagGlobalId of def.tags) {
      const listed = bearers.get(tagGlobalId);
      if (listed === undefined) bearers.set(tagGlobalId, [def.globalId]);
      else listed.push(def.globalId);
    }
  return bearers;
}
