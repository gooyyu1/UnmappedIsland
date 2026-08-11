import type { WorldObject } from '../runtime/WorldObject';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { objectRef, text } from './Description';
import type { ReferenceRoot } from './ReferenceRoot';
import type { Requirement, Requirements } from './Requirement';

/** 工程が要求する素材または道具1件（GameElementDefinition.md 13.1節）。 */
export class RecipeRequirementDef {
  /** 要求する型のグローバルID。 */
  readonly objectGlobalId: number;

  readonly count: number;

  /** trueなら素材（消費される）、falseなら道具（存在確認のみ）。 */
  readonly consume: boolean;

  constructor(objectGlobalId: number, count: number, consume: boolean) {
    this.objectGlobalId = objectGlobalId;
    this.count = count;
    this.consume = consume;
  }

  /** この要求がobjectGlobalIdの型を名指ししているか（素材・道具のどちらでも）。 */
  requires(objectGlobalId: number): boolean {
    return this.objectGlobalId === objectGlobalId;
  }

  /** この要求を書き表す（Description参照）。 */
  describe(names: DefNames): readonly DescriptionToken[] {
    return [
      text(this.consume ? '素材: ' : '道具: '),
      objectRef(names.objectName(this.objectGlobalId)),
      text(` ×${this.count}`),
    ];
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

  /** この工程がobjectGlobalIdの型を要求しているか。 */
  requires(objectGlobalId: number): boolean {
    return this.requirements.some((requirement) => requirement.requires(objectGlobalId));
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

  /** このレシピがobjectGlobalIdの型を、どこかの工程で素材か道具として要求しているか。 */
  requires(objectGlobalId: number): boolean {
    return this.steps.some((step) => step.requires(objectGlobalId));
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
