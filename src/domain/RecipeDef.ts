import type { WorldObject } from './WorldObject';
import type { ObjectDef } from './ObjectDef';
import type { PickEffect } from './PickEffect';
import type { TypeMatchRule } from './TypeMatchRule';
import type { Requirement, Requirements } from './Requirement';
import { ReferenceContext } from './ReferenceRoot';
import type { PropertyPath } from './ReferenceRoot';

/**
 * 製作中オブジェクト（RecipeSystem.md 1節）を生成するときの軸名（GameElementDefinition.md 3.5節）。
 * 値はレシピの名前で、この軸を落とした座標——`become: {recipe: none}`——が完成品そのものを指す。
 */
export const RECIPE_AXIS = 'recipe';

/**
 * 製作中であることを表すタグ（RecipeSystem.md 5節）。生成した型はYAMLへ戻してから読み込む
 * （inProgressObjectsYaml）ので、作りかけであることもYAMLに書ける印で運ぶ。
 */
export const IN_PROGRESS_TAG = 'wip';

/**
 * 工程が要求する素材または道具1件（GameElementDefinition.md 13.1節）。
 *
 * **要求はタグでも書ける**（4.1節）。道具は
 * 「その用途に使える物」であって特定の型ではないので、刃物を`cutting_tool`で求められる。
 */
export class RecipeRequirementDef {
  /** 要求する型の指定（型そのもの、またはタグ）。 */
  readonly match: TypeMatchRule;

  readonly count: number;

  /** trueなら素材（消費される）、falseなら道具（存在確認のみ）。 */
  readonly consume: boolean;

  constructor(match: TypeMatchRule, count: number, consume: boolean) {
    if (count < 1) throw new Error(`要求の個数は1以上である必要があります（値: ${count}）。`);

    this.match = match;
    this.count = count;
    this.consume = consume;
  }

  /** この要求にcandidateDefが当てはまるか（素材・道具のどちらでも）。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.match.matches(candidateDef);
  }
}

/**
 * 手際をいくら積んでも、工程がこれより短くはならない分数（13.1節）。
 *
 * 0分の工程は「押した瞬間に終わる作業」になり、**時間が最も希少な資源である**という前提
 * （SkillSystem.md 7節）がその工程だけで消える。下限を持つのは工程の側で、上乗せの側ではない
 * ——上乗せは1つで所要時間の違う工程すべてに積まれるので、どこまで引いてよいかを知らない。
 */
const MINIMUM_STEP_MINUTES = 1;

/** レシピの工程1つ（13.1節）。 */
export class RecipeStepDef {
  readonly requirements: readonly RecipeRequirementDef[];

  /**
   * この工程が宣言した仕事の量を、ゲーム内時間（分）で表したもの。
   *
   * **作り手が実際に費やす時間とは別**（作り手の手際ぶん短くなる、`RecipeDef.minutesFor`）。進捗が
   * 数えるのはこちら——片付いた仕事の量は腕によらないので、進捗の上限（RecipeSystem.md 1節）は
   * ロード時に決まったままでいられる。
   */
  readonly durationMinutes: number;

  constructor(requirements: readonly RecipeRequirementDef[], durationMinutes: number) {
    if (requirements.length === 0) throw new Error('工程のrequiresは1件以上必要です。');
    if (durationMinutes <= 0)
      throw new Error(`工程の所要時間は正の数である必要があります（値: ${durationMinutes}）。`);

    this.requirements = requirements;
    this.durationMinutes = durationMinutes;
  }

  /** この工程がcandidateDefを要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.requirements.some((requirement) => requirement.requires(candidateDef));
  }
}

/**
 * レシピ1つ（13節）。成果物のObjectDefが持つ。
 *
 * `conditions`は**このレシピを知っているか**を判定するもので、素材が揃っているかとは別物
 * （素材の充足は`steps.requires`が持つ）。判定する時点では成果物のインスタンスがまだ無いので、そこを
 * 起点に辿る参照は解決先を持たない（何を書けるかはReferenceScope.acting.withoutSelfが決める）。
 */
export class RecipeDef {
  readonly name: string;

  /** 自動生成される製作中オブジェクトへ引き継ぐアイコン（13.2節）。未指定ならundefined。 */
  readonly icon: string | undefined;

  readonly steps: readonly RecipeStepDef[];

  /** 解放条件（SkillSystem.md 4節）。undefinedなら最初から解放されている。 */
  readonly unlock: Requirements | undefined;

  /**
   * 作り手の手際（docs/world/Skills.md 7節）が置いてある場所。名乗っていなければundefined＝腕は
   * 速さに効かない。
   *
   * **名乗れるのは1つだけ。** 上位のレシピは複数の腕を連言で要求する（SkillSystem.md 4.1節）が、
   * そこからはどの腕が速さを決めるか1つに定まらないので、作る側が名乗る。
   */
  readonly deftness: PropertyPath | undefined;

  /**
   * 完成した瞬間に1回だけ引く、余分が取れるかの卓（13.1節）。宣言していなければundefined＝
   * 何個作っても1つしかできない物。
   */
  readonly surplus: PickEffect | undefined;

  constructor(
    name: string,
    steps: readonly RecipeStepDef[],
    icon: string | undefined,
    unlock: Requirements | undefined,
    deftness: PropertyPath | undefined,
    surplus: PickEffect | undefined,
  ) {
    if (steps.length === 0) throw new Error(`レシピ'${name}': stepsは1件以上必要です。`);

    this.name = name;
    this.steps = steps;
    this.icon = icon;
    this.unlock = unlock;
    this.deftness = deftness;
    this.surplus = surplus;
  }

  /**
   * agentがその工程に実際に費やすゲーム内時間（分）。宣言された仕事の量から、作り手の手際を
   * 引いた値（13.1節）。手際を名乗っていない、または作り手がそれを持たないなら宣言どおり。
   *
   * **問うのは「この者にとって何分か」なのでagentは必ず要る**（解放条件`unmetUnlockRequirement`と
   * 同じ形）。誰にとってでもない分数は、工程が宣言した仕事の量（`durationMinutes`）が直接答える。
   */
  minutesFor(step: RecipeStepDef, agent: WorldObject): number {
    // 成果物のインスタンスはまだ無い（作りかけは完成品ではない）ので、selfを持たない文脈で解く。
    const deftness = this.deftness?.effectiveNumber(ReferenceContext.asking(agent)) ?? 0;
    return Math.max(MINIMUM_STEP_MINUTES, step.durationMinutes - deftness);
  }

  /**
   * 全工程が宣言した仕事の量の合計（分）。完成までの進捗の上限そのもの。
   *
   * **作り手が費やす時間の合計ではない**（手際のぶん短くなる、`minutesFor`）。上限が誰にとっても
   * 同じでなければ、作りかけの進捗が作り手ごとに違う意味を持つことになる。
   */
  get totalMinutes(): number {
    return this.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
  }

  /** このレシピがcandidateDefを、どこかの工程で素材か道具として要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.steps.some((step) => step.requires(candidateDef));
  }

  /**
   * agentが解放条件を満たしていない場合、最初に落ちた要件。満たしていればundefined。
   *
   * 未解放のレシピも一覧へ出し、そこでなぜ作れないかを言うため、可否と理由を1回の評価から得る
   * （Requirements.firstUnmet と同じ理由）。
   *
   * **問うのは「この者にとって解放されているか」なので、agentは必ず要る**（13.3節）。誰にとってでも
   * ない「解放条件を持つか」は`unlock`が直接答える。
   */
  unmetUnlockRequirement(agent: WorldObject): Requirement | undefined {
    // まだ成果物のインスタンスが無いので、selfを持たない文脈で評価する（13.3節）——selfを起点に辿る
    // 参照はそのまま解決先を持たない。
    return this.unlock?.firstUnmet(ReferenceContext.asking(agent));
  }
}
