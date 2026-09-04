import type { ReferenceRoot } from '../domain/ReferenceRoot';

/**
 * クラフトの1工程を「入力 → 工程 → 出力」の形に均した見方。
 *
 * actions・combinations・recipesは文法がそれぞれ違うが、「何を使って（消費して）何ができるか」
 * という問いに対しては同じ形で答えられる。各定義クラス（InteractionDef・ObjectDef）が
 * 自分の宣言からこれを組み立てる。
 */

/** 工程への入力1つ。型そのもの（object）か、タグで指した相手（tag）のどちらか。 */
export type CraftingInput =
  /**
   * consumedは、この工程がその入力を消す（destroy・レシピのconsume）か。道具は消えないので偽。
   * countは1回の実行で要る個数（レシピの`count`、既定1）——**筏は丸太を6本使う**ので、
   * 総コストを出す側はこれを掛けないと1本ぶんで数えることになる。
   *
   * **確率でしか消えない入力では1を下回る。** 殴って仕留められるのは21回に1回で、外した回の獲物は
   * その場に残る——1回の実行で要るのは獲物1匹ではなく、その確率ぶんだけ。
   */
  | {
      readonly kind: 'object';
      readonly objectGlobalId: number;
      readonly consumed: boolean;
      readonly count: number;
    }
  | {
      readonly kind: 'tag';
      readonly tagGlobalId: number;
      readonly consumed: boolean;
      readonly count: number;
    };

/** 工程の出力1つ。countsは1回の実行で生まれうる個数（分岐どうしで違いうるため、出現した値を全て持つ）。 */
export interface CraftingOutput {
  readonly objectGlobalId: number;
  readonly counts: readonly number[];
}

/**
 * 工程が動かすプロパティ1件（`add`・`transfer`）。targetは宣言どおりの参照ルートで、キャラクタが
 * 受け取る値は`agent`、工程の主自身の値は`self`に出る。
 *
 * **同じ分岐の中で、宣言の続きとして後から代入されたぶんは、ここに残らない**（OutcomeSequel）。
 * rangeイベントのクランプで端へ戻されたぶんは残る——足した量が起きなかったわけではないため。
 */
export interface PropertyDelta {
  readonly target: ReferenceRoot;
  readonly propertyGlobalId: number;
  readonly amount: number;
}

/**
 * 工程が代入するプロパティ1件（`set`、9.2節）。
 *
 * **増減とは別に持つ。** 実際に動く量は今の値によるので、代入を増減として足すと、値域の端へ戻す
 * 既定のイベント（`on_max`が自分をmaxへ戻す、6.3節）が「max ぶん増えた」に化ける。
 * 一方で「どこへ動いたか」は代入だけが確定して言えるので、rangeの外へ出たかはこちらで問える。
 */
export interface PropertyAssignment {
  readonly target: ReferenceRoot;
  readonly propertyGlobalId: number;

  /**
   * 代入する値。個体を指す代入（9.2節）はどの個体かが実行時にしか決まらないのでundefined
   * ——**代入が起きること自体は言える**ので、それより前の増減が残らないことはこちらでも問える。
   */
  readonly value: number | undefined;
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
  readonly assignments: readonly PropertyAssignment[];
}

/**
 * クラフトの1工程。nameは宣言上の名前（アクション・combination・レシピの識別子）で、
 * ownerGlobalIdはそれを宣言している型。kindは表示名の引き方が違うため持つ（Localization.md）。
 *
 * 時間・産出・値の増減の3つが揃っているので、「1回の実行にいくらかかって何が返るか」がこれだけで
 * 分かる（収支表はこれを足し合わせる）。
 */
export interface CraftingStep {
  /**
   * interactionは操作（メニュー型・ドラッグ型・時間が配る手番の別は持たない——入口の違いでしかなく、
   * 工程としては同じ。押して起こせるかは下のstartedByPlayerが答える）。periodicは、操作ではなく
   * **時間で回る**工程（罠の判定）で、tick毎に動く値がrangeの端へ届くたびに起こる
   * （周期はrangeCyclesが定義から導く）。
   */
  readonly kind: 'interaction' | 'recipe' | 'periodic';

  /**
   * プレイヤーが押して起こせる工程か（InteractionTrigger.startedByPlayer）。**経路として並べてよいのは
   * これだけ**——時間が配る手番（動物の1手、限界に達した値が起こす強制的な時間経過）は選べないので、
   * 経路に並べると選べない道が献立に載る。**工程の一覧としては数える**ので、落とすのは経路を組む側。
   */
  readonly startedByPlayer: boolean;
  readonly name: string;
  readonly ownerGlobalId: number;
  readonly inputs: readonly CraftingInput[];

  /** 生まれうる型の一覧（outcomesから導いたもの）。何も生まない工程では空。 */
  readonly outputs: readonly CraftingOutput[];

  /**
   * 1回の実行で**プレイヤーが払う**時間（分）。他の行動と競合するのはこちらだけ。
   * durationを宣言していない工程と、時間で回る工程（periodic）は0。
   */
  readonly laborMinutes: number;

  /**
   * 1回の実行で**経過する**時間（分）。プレイヤーが手を止めて待つ工程では労働時間と等しく、
   * 時間で回る工程（periodic）だけが両者に差を持つ——罠は4時間かかるが、その間に別のことができる。
   */
  readonly elapsedMinutes: number;

  /** 起こりうる結果（確率つき）。分岐の無い工程でも必ず1件ある。 */
  readonly outcomes: readonly StepOutcome[];

  /**
   * duration・weightに、定義だけからは確定しない参照が含まれるか（祖先が入れる値・生成時に個体へ
   * 上書きされる値）。真の工程は、durationMinutesとprobabilityをそのまま信用できない。
   */
  readonly hasUnresolvedReferences: boolean;
}

/** 何も起こさない1分岐（値もオブジェクトも動かさない効果の結果）。 */
export const UNCHANGED_OUTCOMES: readonly StepOutcome[] = [
  { probability: 1, spawns: [], deltas: [], assignments: [] },
];

/** 分岐の一覧の確率を一律に倍する（pickが候補の枝を自分の確率へ畳むときに使う）。 */
export function scaleOutcomes(outcomes: readonly StepOutcome[], factor: number): readonly StepOutcome[] {
  return outcomes.map((outcome) => ({ ...outcome, probability: outcome.probability * factor }));
}

/**
 * 右の一覧が、左に対してどういう続きか。**右の代入をどう読むかがこれで決まる。**
 *
 * - `declared` — 宣言に並べて書いてある続き。**後の代入は、前に足した量を消す**——代入はそのものが
 *   行き先なので、物を食べて満腹が500増えても、吐く枝が満腹を0にすれば、その枝の取り分は0
 *   （docs/engine/DigestionSystem.md 6.3節）。
 * - `triggered` — 左が動かした値が端へ届いて起きたこと（rangeイベント）。**代入は端で止まったことを
 *   言うだけ**で、足した量が起きなかったとは言っていない——既定のクランプで消すと、6時間の睡眠が
 *   眠気を1つも戻さないことになる。
 */
export type OutcomeSequel = 'declared' | 'triggered';

/**
 * 2つの分岐の一覧を直積にする（両方が順に起こる）。同じ型のspawnは1件へ合算し、プロパティの増減は
 * 宣言順のまま並べる。`sequel`が`declared`なら、右が代入するプロパティの増減を左から落とす
 * （OutcomeSequel参照）ので、`deltas`は「最後の代入より後に起きた増減」になる。
 */
export function combineOutcomes(
  left: readonly StepOutcome[],
  right: readonly StepOutcome[],
  sequel: OutcomeSequel,
): readonly StepOutcome[] {
  const combined: StepOutcome[] = [];
  for (const a of left)
    for (const b of right)
      combined.push({
        probability: a.probability * b.probability,
        spawns: mergeSpawns(a.spawns, b.spawns),
        deltas: [
          ...(sequel === 'declared' ? survivingDeltas(a.deltas, b.assignments) : a.deltas),
          ...b.deltas,
        ],
        assignments: [...a.assignments, ...b.assignments],
      });
  return combined;
}

/** 後から代入されるプロパティのぶんを落とした増減（OutcomeSequel参照）。 */
function survivingDeltas(
  deltas: readonly PropertyDelta[],
  assignments: readonly PropertyAssignment[],
): readonly PropertyDelta[] {
  if (assignments.length === 0 || deltas.length === 0) return deltas;

  const assigned = new Set(assignments.map(propertyKey));
  return deltas.filter((delta) => !assigned.has(propertyKey(delta)));
}

function propertyKey(entry: PropertyDelta | PropertyAssignment): string {
  return `${entry.target}:${entry.propertyGlobalId}`;
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
