import type { WorldObject } from './WorldObject';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { text } from './Description';
import type { ObjectDef } from './ObjectDef';
import type { TypeMatchRule } from './TypeMatchRule';
import type { ReferenceRoot } from './ReferenceRoot';
import type { Requirement, Requirements } from './Requirement';

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
    this.match = match;
    this.count = count;
    this.consume = consume;
  }

  /** この要求にcandidateDefが当てはまるか（素材・道具のどちらでも）。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.match.matches(candidateDef);
  }

  /** この要求を書き表す（Description参照）。 */
  describe(names: DefNames): readonly DescriptionToken[] {
    return [text(this.consume ? '素材: ' : '道具: '), ...this.match.describe(names), text(` ×${this.count}`)];
  }
}

/** レシピの工程1つ（13.1節）。 */
export class RecipeStepDef {
  readonly requirements: readonly RecipeRequirementDef[];

  /** この工程にかかるゲーム内時間（分）。 */
  readonly durationMinutes: number;

  constructor(requirements: readonly RecipeRequirementDef[], durationMinutes: number) {
    this.requirements = requirements;
    this.durationMinutes = durationMinutes;
  }

  /** この工程がcandidateDefを要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.requirements.some((requirement) => requirement.requires(candidateDef));
  }

  /** この工程を書き出す（Description参照）。stepNumberは1始まりの見出し用の番号。 */
  describe(stepNumber: number, names: DefNames, out: DescriptionWriter): void {
    out.write(text(`工程${stepNumber}（${this.durationMinutes}分）:`));
    out.indented(() => {
      for (const requirement of this.requirements) out.write(...requirement.describe(names));
    });
  }
}

/**
 * レシピ1つ（13節）。成果物のObjectDefが持つ。
 *
 * `conditions`は**このレシピを知っているか**を判定するもので、素材が揃っているかとは別物
 * （素材の充足は`steps.requires`が持つ）。判定できる対象はactorだけで、まだ存在しない成果物を
 * 指すself/parent/ancestorは使えない（RECIPE_CONDITION_ROOTS参照）。
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
    this.name = name;
    this.steps = steps;
    this.icon = icon;
    this.unlock = unlock;
  }

  /** このレシピがcandidateDefを、どこかの工程で素材か道具として要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.steps.some((step) => step.requires(candidateDef));
  }

  /** このレシピを書き出す（Description参照）。 */
  describe(names: DefNames, out: DescriptionWriter): void {
    if (this.unlock !== undefined) {
      out.write(text('解放条件:'));
      out.indented(() => this.unlock!.describe(names, out));
    }
    for (const [index, step] of this.steps.entries()) step.describe(index + 1, names, out);
  }

  /**
   * 解放条件を満たしていない場合、最初に落ちた要件。満たしていればundefined。
   *
   * 未解放のレシピも解放条件とともに一覧へ出すため、可否と理由を1回の評価から得る
   * （Requirements.firstUnmet と同じ理由）。
   */
  unmetUnlockRequirement(
    resolveRoot: (root: ReferenceRoot) => WorldObject | undefined,
  ): Requirement | undefined {
    return this.unlock?.firstUnmet(resolveRoot);
  }

  isUnlocked(resolveRoot: (root: ReferenceRoot) => WorldObject | undefined): boolean {
    return this.unmetUnlockRequirement(resolveRoot) === undefined;
  }
}
