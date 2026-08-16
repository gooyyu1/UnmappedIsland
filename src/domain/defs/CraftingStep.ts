import type { ReferenceRoot } from './ReferenceRoot';

/**
 * クラフトの1工程を「入力 → 工程 → 出力」の形に均した見方。
 *
 * actions・combinations・recipesは文法がそれぞれ違うが、「何を使って（消費して）何ができるか」
 * という問いに対しては同じ形で答えられる。各定義クラス（InteractionDef・ObjectDef）が
 * 自分の宣言からこれを組み立てる。
 */

/** 工程への入力1つ。型そのもの（object）か、タグで指した相手（tag）のどちらか。 */
export type CraftingInput =
  /** consumedは、この工程がその入力を消す（destroy・レシピのconsume）か。道具は消えないので偽。 */
  | { readonly kind: 'object'; readonly objectGlobalId: number; readonly consumed: boolean }
  | { readonly kind: 'tag'; readonly tagGlobalId: number; readonly consumed: boolean };

/** 工程の出力1つ。countsは1回の実行で生まれうる個数（分岐どうしで違いうるため、出現した値を全て持つ）。 */
export interface CraftingOutput {
  readonly objectGlobalId: number;
  readonly counts: readonly number[];
}

/**
 * 工程が動かすプロパティ1件（`add`・`transfer`）。targetは宣言どおりの参照ルートで、キャラクタが
 * 受け取る値は`actor`、工程の主自身の値は`self`に出る。
 */
export interface PropertyDelta {
  readonly target: ReferenceRoot;
  readonly propertyGlobalId: number;
  readonly amount: number;
}

/** 1つの分岐で生まれる型と個数。同じ型を複数回spawnする分岐では合算済み。 */
export interface SpawnedCount {
  readonly objectGlobalId: number;
  readonly count: number;
}

/**
 * 工程の1分岐（pickの候補1つ）。分岐を持たない工程は確率1の1件になり、入れ子のpickは確率の積まで
 * 畳んである。全分岐のprobabilityの和は1。
 *
 * **pickの候補を平らに潰さないのがこの型の役目。** 「どの分岐が、どの確率で、何を返すか」が残って
 * いなければ、期待値（30分で青い実が1.8個）が復元できない。
 */
export interface StepOutcome {
  readonly probability: number;
  readonly spawns: readonly SpawnedCount[];
  readonly deltas: readonly PropertyDelta[];
}

/**
 * クラフトの1工程。nameは宣言上の名前（アクション・combination・レシピの識別子）で、
 * ownerGlobalIdはそれを宣言している型。kindは表示名の引き方が違うため持つ（Localization.md）。
 *
 * 時間・産出・値の増減の3つが揃っているので、「1回の実行にいくらかかって何が返るか」がこれだけで
 * 分かる（収支表はこれを足し合わせる）。
 */
export interface CraftingStep {
  readonly kind: 'action' | 'combination' | 'recipe';
  readonly name: string;
  readonly ownerGlobalId: number;
  readonly inputs: readonly CraftingInput[];

  /** 生まれうる型の一覧（outcomesから導いたもの）。何も生まない工程では空。 */
  readonly outputs: readonly CraftingOutput[];

  /** 1回の実行にかかるゲーム内時間（分）。durationを宣言していない工程は0。 */
  readonly durationMinutes: number;

  /** 起こりうる結果（確率つき）。分岐の無い工程でも必ず1件ある。 */
  readonly outcomes: readonly StepOutcome[];

  /**
   * duration・weightに、定義だけからは確定しない参照が含まれるか（祖先が入れる値・生成時に個体へ
   * 上書きされる値）。真の工程は、durationMinutesとprobabilityをそのまま信用できない。
   */
  readonly hasUnresolvedReferences: boolean;
}

/** 何も起こさない1分岐（値もオブジェクトも動かさない効果の結果）。 */
export const UNCHANGED_OUTCOMES: readonly StepOutcome[] = [{ probability: 1, spawns: [], deltas: [] }];

/** 分岐の一覧の確率を一律に倍する（pickが候補の枝を自分の確率へ畳むときに使う）。 */
export function scaleOutcomes(outcomes: readonly StepOutcome[], factor: number): readonly StepOutcome[] {
  return outcomes.map((outcome) => ({ ...outcome, probability: outcome.probability * factor }));
}

/**
 * 2つの分岐の一覧を直積にする（宣言順の合成＝両方が順に起こる）。同じ型のspawnは1件へ合算し、
 * プロパティの増減は宣言順のまま並べる。
 */
export function combineOutcomes(
  left: readonly StepOutcome[],
  right: readonly StepOutcome[],
): readonly StepOutcome[] {
  const combined: StepOutcome[] = [];
  for (const a of left)
    for (const b of right)
      combined.push({
        probability: a.probability * b.probability,
        spawns: mergeSpawns(a.spawns, b.spawns),
        deltas: [...a.deltas, ...b.deltas],
      });
  return combined;
}

/** 分岐ごとの産出から、型ごとに出現した個数をまとめた出力の列を作る（出力の線1本＝1つの型）。 */
export function collectOutputs(outcomes: readonly StepOutcome[]): readonly CraftingOutput[] {
  const countsByObject = new Map<number, number[]>();
  for (const outcome of outcomes)
    for (const spawn of outcome.spawns) {
      const counts = countsByObject.get(spawn.objectGlobalId);
      if (counts === undefined) countsByObject.set(spawn.objectGlobalId, [spawn.count]);
      else if (!counts.includes(spawn.count)) counts.push(spawn.count);
    }
  return [...countsByObject].map(([objectGlobalId, counts]) => ({ objectGlobalId, counts }));
}

function mergeSpawns(left: readonly SpawnedCount[], right: readonly SpawnedCount[]): readonly SpawnedCount[] {
  if (left.length === 0) return right;
  if (right.length === 0) return left;

  const countByObject = new Map<number, number>();
  for (const spawn of [...left, ...right])
    countByObject.set(spawn.objectGlobalId, (countByObject.get(spawn.objectGlobalId) ?? 0) + spawn.count);
  return [...countByObject].map(([objectGlobalId, count]) => ({ objectGlobalId, count }));
}
