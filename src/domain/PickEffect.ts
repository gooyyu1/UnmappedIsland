import { pickWeighted } from './Rng';
import type { EffectSite } from './EffectSite';
import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { EffectReader, PickCandidateReading } from './EffectReader';
import type { WeightSpec } from './WeightSpec';

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
    const chosen = this.selectWeighted(owner, session, actor, dragged);
    chosen.effect.apply(owner, session, actor, dragged, effectSite);
  }

  read(reader: EffectReader): void {
    reader.pick(this.candidates.map((candidate) => candidate.reading));
  }

  /** **数えられない。** 引くたびに起きることが変わるので、2回目が何をするかは実行するまで分からない。 */
  override countableVessels(): undefined {
    return undefined;
  }

  /**
   * weightで重み付き抽選して1つ選ぶ。候補が非空であることは呼び出し側が保証する。
   *
   * **全候補の重みが0なら先頭の候補が選ばれる。** 何も起きない手番を作らないための規約で、
   * 「起こりうることが1つも無い」ときに何を選ぶかは抽選（pickWeighted）ではなくこちらが決める。
   */
  private selectWeighted(
    owner: WorldObject,
    session: WorldSession,
    actor: WorldObject | undefined,
    dragged: WorldObject | undefined,
  ): PickCandidateDef {
    const chosen = pickWeighted(
      this.candidates,
      (candidate) => candidate.weight.resolve(owner, actor, dragged),
      session.rng,
    );
    return chosen ?? this.candidates[0];
  }
}

/**
 * pickの1候補（GameElementDefinition.md 10節)。抽選の重み（weight）と、選ばれたときに適用する効果を持つ。
 */
export class PickCandidateDef {
  /** 抽選の重み（10.2節）。 */
  readonly weight: WeightSpec;

  /** この候補が選ばれたときに適用する効果。 */
  readonly effect: ActiveEffect;

  constructor(weight: WeightSpec, effect: ActiveEffect) {
    this.weight = weight;
    this.effect = effect;
  }

  /** この候補の宣言（PickCandidateReading参照）。PickEffect.readが読み手へ渡す。 */
  get reading(): PickCandidateReading {
    return { weight: this.weight.reading, effect: this.effect };
  }
}
