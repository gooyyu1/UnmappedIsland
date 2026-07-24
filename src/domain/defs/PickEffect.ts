import type { EffectSite, WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import { ActiveEffect } from './ActiveEffect';
import { resolveReferenceRoot } from './ReferenceRoot';
import type { PropertyPath } from './ReferenceRoot';

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

  /** weightで重み付き抽選して1つ選ぶ。候補が非空であることは呼び出し側が保証する。 */
  private selectWeighted(
    self: WorldObject,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
    session: WorldSession,
  ): PickCandidateDef {
    if (this.candidates.length === 1) return this.candidates[0];

    const weights = this.candidates.map((c) => Math.max(0, c.resolveWeight(self, actor, dragged)));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return this.candidates[0];

    const roll = session.rng.nextDouble() * total;
    let cumulative = 0;
    for (let i = 0; i < this.candidates.length; i++) {
      cumulative += weights[i];
      if (roll < cumulative) return this.candidates[i];
    }

    return this.candidates[this.candidates.length - 1];
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
}

/**
 * pickの1候補（GameElementDefinition.md 10節)。抽選の重み（weight）と、選ばれたときに適用する効果を持つ。
 */
export class PickCandidateDef {
  /** 抽選の重み（10.2節）。 */
  private readonly weight: WeightSpec;

  /** この候補が選ばれたときに適用する効果。undefinedなら何も起きない。 */
  private readonly effect: ActiveEffect | undefined;

  constructor(weight: WeightSpec, effect: ActiveEffect | undefined) {
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
    this.effect?.apply(owner, session, actor, dragged, effectSite);
  }
}
