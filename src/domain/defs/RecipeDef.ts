import type { WorldObject } from '../runtime/WorldObject';
import type { CraftingStep, StepOutcome } from './CraftingStep';
import { collectOutputs } from './CraftingStep';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { text } from './Description';
import type { ObjectDef } from './ObjectDef';
import type { TypeMatchRule } from './TypeMatchRule';
import type { ReferenceRoot } from './ReferenceRoot';
import type { Requirement, Requirements } from './Requirement';

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

  /** 全工程を通した所要時間（分）。工程の別は畳むので、時間も和で1つにする。 */
  private get totalMinutes(): number {
    return this.steps.reduce((sum, step) => sum + step.durationMinutes, 0);
  }

  /** このレシピがcandidateDefを、どこかの工程で素材か道具として要求しているか。 */
  requires(candidateDef: ObjectDef): boolean {
    return this.steps.some((step) => step.requires(candidateDef));
  }

  /**
   * このレシピを1つの工程として見たもの（CraftingStep参照）。工程（steps）の別は畳む——
   * 「何を使って何ができるか」の問いには、レシピ全体でひとつの答えで足りる。所要時間も同じ理由で
   * 全工程の和にする。productGlobalIdは完成品（このレシピを宣言している型）。
   *
   * レシピは分岐も所要時間の参照も持たないので、確率1の1分岐で、数値は常に確定する。
   */
  craftingStep(productGlobalId: number): CraftingStep {
    const outcomes: readonly StepOutcome[] = [
      {
        probability: 1,
        spawns: [{ objectGlobalId: productGlobalId, count: 1 }],
        deltas: [],
        assignments: [],
      },
    ];
    return {
      kind: 'recipe',
      name: this.name,
      ownerGlobalId: productGlobalId,
      inputs: this.steps.flatMap((step) =>
        step.requirements.map((requirement) =>
          requirement.match.craftingInput(requirement.consume, requirement.count),
        ),
      ),
      outputs: collectOutputs(outcomes),
      laborMinutes: this.totalMinutes,
      elapsedMinutes: this.totalMinutes,
      outcomes,
      hasUnresolvedReferences: false,
    };
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
