import { pickWeighted } from '../runtime/Rng';
import type { EffectSite, WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { StepOutcome } from './CraftingStep';
import { UNCHANGED_OUTCOMES, scaleOutcomes } from './CraftingStep';
import type { DefNames, DescriptionToken, DescriptionWriter } from './Description';
import { propertyRef, text } from './Description';
import { resolveReferenceRoot } from './ReferenceRoot';
import type { PropertyPath, ReferenceRoot, StaticValueResolver } from './ReferenceRoot';

/**
 * pick（10節）: weightで1候補を選び、その候補の効果を適用する効果。候補の効果もActiveEffect
 * （さらにpickなら再帰する）。候補が無ければ何もしない。
 */
export class PickEffect extends ActiveEffect {
  private readonly candidates: readonly PickCandidateDef[];

  constructor(candidates: readonly PickCandidateDef[]) {
    super();
    this.candidates = candidates;
  }

  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    if (this.candidates.length === 0) return;
    const chosen = this.selectWeighted(owner, actor, dragged, session);
    chosen.apply(owner, session, actor, dragged, effectSite);
  }

  describe(names: DefNames, out: DescriptionWriter): void {
    out.write(text('pick:'));
    out.indented(() => {
      for (const candidate of this.candidates) candidate.describe(names, out);
    });
  }

  affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    return this.candidates.some((candidate) => candidate.affects(propertyGlobalId, ownedByDeclarer));
  }

  override spawns(objectGlobalId: number): boolean {
    return this.candidates.some((candidate) => candidate.spawns(objectGlobalId));
  }

  /**
   * 候補ごとに枝分かれさせ、weightを確率へ直して返す（StepOutcome参照）。抽選の規約はselectWeightedと
   * 同じで、負の重みは0として扱い、**全候補の重みが0なら先頭の候補だけが起こる**。
   */
  override collectOutcomes(resolve: StaticValueResolver): readonly StepOutcome[] {
    if (this.candidates.length === 0) return UNCHANGED_OUTCOMES;

    const weights = this.candidates.map((candidate) => Math.max(0, candidate.staticWeight(resolve) ?? 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return this.candidates[0].collectOutcomes(resolve);

    return this.candidates.flatMap((candidate, index) =>
      scaleOutcomes(candidate.collectOutcomes(resolve), weights[index] / total),
    );
  }

  override destroys(target: ReferenceRoot): boolean {
    return this.candidates.some((candidate) => candidate.destroys(target));
  }

  /**
   * weightで重み付き抽選して1つ選ぶ。候補が非空であることは呼び出し側が保証する。
   *
   * **全候補の重みが0なら先頭の候補が選ばれる。** 何も起きない手番を作らないための規約で、
   * 「起こりうることが1つも無い」ときに何を選ぶかは抽選（pickWeighted）ではなくこちらが決める。
   */
  private selectWeighted(
    self: WorldObject,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    session: WorldSession,
  ): PickCandidateDef {
    const chosen = pickWeighted(
      this.candidates,
      (candidate) => candidate.resolveWeight(self, actor, dragged),
      session.rng,
    );
    return chosen ?? this.candidates[0];
  }
}

/** pick候補のweight（10.2節）。リテラル定数か、既存propsへのパス参照のいずれか。 */
export class WeightSpec {
  private readonly isPathRef: boolean;
  private readonly literal: number;
  private readonly path: PropertyPath | undefined;

  private constructor(isPathRef: boolean, literal: number, path: PropertyPath | undefined) {
    this.isPathRef = isPathRef;
    this.literal = literal;
    this.path = path;
  }

  static fromLiteral(literal: number): WeightSpec {
    return new WeightSpec(false, literal, undefined);
  }

  static fromPath(path: PropertyPath): WeightSpec {
    return new WeightSpec(true, 0, path);
  }

  resolve(self: WorldObject, actor: WorldObject | undefined, dragged: WorldObject | undefined): number {
    if (!this.isPathRef) return this.literal;

    const path = this.path!;
    const target =
      path.root === 'ancestor'
        ? self.findAncestorWithProperty(path.propertyGlobalId)
        : resolveReferenceRoot(path.root, self, actor, dragged);
    return target !== undefined ? target.getEffectiveValue(path.propertyGlobalId) : 0;
  }

  /**
   * この値を、実行時のオブジェクトを使わずに定義だけから解く（StaticValueResolver参照）。
   * リテラルはそのまま、参照はresolveに委ねる（解けなければundefined）。
   */
  staticResolve(resolve: StaticValueResolver): number | undefined {
    if (!this.isPathRef) return this.literal;
    const path = this.path!;
    return resolve(path.root, path.propertyGlobalId);
  }

  /** この値の出どころを書き表す（Description参照）。リテラルなら数値、参照ならプロパティ。 */
  describe(names: DefNames): readonly DescriptionToken[] {
    if (!this.isPathRef) return [text(String(this.literal))];
    const path = this.path!;
    return [propertyRef(names.propertyName(path.propertyGlobalId), path.root)];
  }
}

/**
 * pickの1候補（GameElementDefinition.md 10節)。抽選の重み（weight）と、選ばれたときに適用する効果を持つ。
 */
export class PickCandidateDef {
  /** 抽選の重み（10.2節）。 */
  private readonly weight: WeightSpec;

  /** この候補が選ばれたときに適用する効果。 */
  private readonly effect: ActiveEffect;

  constructor(weight: WeightSpec, effect: ActiveEffect) {
    this.weight = weight;
    this.effect = effect;
  }

  /** この候補の抽選重みを、現在の文脈で解決する（PickEffectのweight抽選が使う）。 */
  resolveWeight(self: WorldObject, actor: WorldObject | undefined, dragged: WorldObject | undefined): number {
    return this.weight.resolve(self, actor, dragged);
  }

  /** この候補が選ばれたときに、自分の効果を適用する（PickEffectが選択後に呼ぶ）。 */
  apply(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    effectSite: EffectSite | undefined,
  ): void {
    this.effect.apply(owner, session, actor, dragged, effectSite);
  }

  /** この候補を「重み」の行と、その下の効果として書き出す（Description参照）。 */
  describe(names: DefNames, out: DescriptionWriter): void {
    out.write(text('weight = '), ...this.weight.describe(names));
    out.indented(() => this.effect.describe(names, out));
  }

  affects(propertyGlobalId: number, ownedByDeclarer: boolean): boolean {
    return this.effect.affects(propertyGlobalId, ownedByDeclarer);
  }

  spawns(objectGlobalId: number): boolean {
    return this.effect.spawns(objectGlobalId);
  }

  /** この候補の抽選重みを、定義だけから解く（PickEffect.collectOutcomesが使う）。 */
  staticWeight(resolve: StaticValueResolver): number | undefined {
    return this.weight.staticResolve(resolve);
  }

  collectOutcomes(resolve: StaticValueResolver): readonly StepOutcome[] {
    return this.effect.collectOutcomes(resolve);
  }

  destroys(target: ReferenceRoot): boolean {
    return this.effect.destroys(target);
  }
}
