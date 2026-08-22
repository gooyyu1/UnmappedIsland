import type { WorldObject } from './WorldObject';
import type { ObjectDef } from './ObjectDef';
import type { TypeMatchRule } from './TypeMatchRule';
import type { Requirement, Requirements } from './Requirement';
import { ReferenceContext } from './ReferenceRoot';

/**
 * 製作中オブジェクト（RecipeSystem.md 1節）を生成するときの軸名（GameElementDefinition.md 3.5節）。
 * 値はレシピの名前で、この軸を落とした座標——`become: {recipe: none}`——が完成品そのものを指す。
 */
export const RECIPE_AXIS = 'recipe';

/**
 * 製作中であることを表すタグ（RecipeSystem.md 5節）。作りかけは完成品のタグを引き継ぐので、
 * **タグだけを見ると完成品と区別が付かない**——道具として働けるかを問う場所はこれで弾く。
 */
export const IN_PROGRESS_TAG = 'wip';

/**
 * 工程が要求する素材または道具1件（GameElementDefinition.md 13.1節）。
 *
 * **要求はタグでも書ける**（枠の`accept`・combinationsの`with`と同じTypeMatchRule）。道具は
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

/** レシピの工程1つ（13.1節）。 */
export class RecipeStepDef {
  readonly requirements: readonly RecipeRequirementDef[];

  /** この工程にかかるゲーム内時間（分）。 */
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
 * （素材の充足は`steps.requires`が持つ）。判定できる対象はactorだけで、まだ存在しない成果物を
 * 指すself/parent/ancestorは使えない（ReferenceScope.recipeUnlock参照）。
 */
export class RecipeDef {
  readonly name: string;

  /** 自動生成される製作中オブジェクトへ引き継ぐアイコン（13.2節）。未指定ならundefined。 */
  readonly icon: string | undefined;

  readonly steps: readonly RecipeStepDef[];

  /** 解放条件（SkillSystem.md 4節）。undefinedなら最初から解放されている。 */
  readonly unlock: Requirements | undefined;

  constructor(
    name: string,
    steps: readonly RecipeStepDef[],
    icon: string | undefined,
    unlock: Requirements | undefined,
  ) {
    if (steps.length === 0) throw new Error(`レシピ'${name}': stepsは1件以上必要です。`);

    this.name = name;
    this.steps = steps;
    this.icon = icon;
    this.unlock = unlock;
  }

  /** 全工程を通した所要時間（分）。完成までの進捗の上限そのもの。 */
  get totalMinutes(): number {
    return this.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
  }

  /** このレシピがcandidateDefを、どこかの工程で素材か道具として要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.steps.some((step) => step.requires(candidateDef));
  }

  /**
   * 解放条件を満たしていない場合、最初に落ちた要件。満たしていればundefined。
   *
   * 未解放のレシピも解放条件とともに一覧へ出すため、可否と理由を1回の評価から得る
   * （Requirements.firstUnmet と同じ理由）。
   */
  unmetUnlockRequirement(actor: WorldObject | undefined): Requirement | undefined {
    // 参照できるのはactorだけ（13.3節）。まだ成果物のインスタンスが無いので、selfを持たない文脈で
    // 評価する——self・parent・ancestorはそのまま解決先を持たない。
    return this.unlock?.firstUnmet(ReferenceContext.acting(undefined, actor, undefined));
  }
}
