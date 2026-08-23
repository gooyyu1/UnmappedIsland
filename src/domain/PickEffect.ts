import { pickWeighted } from './Rng';
import type { AmongSpec } from './AmongSpec';
import type { EffectSite } from './EffectSite';
import type { WorldSession } from './WorldSession';
import { ActiveEffect } from './ActiveEffect';
import type { EffectReader, PickCandidateReading } from './EffectReader';
import type { ReferenceContext } from './ReferenceRoot';
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

  /**
   * **相手が居ない候補は抽選に出ない**（`among`、10.3節）ので、著者は「相手が居なければ起こらない」を
   * 書かなくてよい。全部外れれば何も起きない。
   */
  apply(context: ReferenceContext, session: WorldSession, effectSite: EffectSite | undefined): void {
    const available = this.candidates.filter((candidate) => candidate.isAvailable(context));
    if (available.length === 0) return;
    this.selectWeighted(available, context, session).apply(context, session, effectSite);
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
    available: readonly PickCandidateDef[],
    context: ReferenceContext,
    session: WorldSession,
  ): PickCandidateDef {
    const chosen = pickWeighted(available, (candidate) => candidate.weight.resolve(context), session.rng);
    return chosen ?? available[0];
  }
}

/**
 * pickの1候補（GameElementDefinition.md 10節)。抽選の重み（weight）と、選ばれたときに適用する効果を持つ。
 * `among`（10.3節）を書いた候補は、周りの物から相手を1つ選んでから効果を当てる。
 */
export class PickCandidateDef {
  /** 抽選の重み（10.2節）。 */
  readonly weight: WeightSpec;

  /** この候補が選ばれたときに適用する効果。 */
  private readonly effect: ActiveEffect;

  /** 周りから相手を1つ選ぶ宣言（10.3節）。書いていなければundefined。 */
  private readonly among: AmongSpec | undefined;

  constructor(weight: WeightSpec, effect: ActiveEffect, among?: AmongSpec) {
    this.weight = weight;
    this.effect = effect;
    this.among = among;
  }

  /**
   * 今この文脈でこの候補が抽選に出るか。`among`を書いていれば**相手が1つ以上居るときだけ**出る。
   */
  isAvailable(context: ReferenceContext): boolean {
    return this.among === undefined || this.among.candidates(context).length > 0;
  }

  /** この候補が選ばれたときに起こす。`among`を書いていれば、選んだ相手をpickedにした文脈で当てる。 */
  apply(context: ReferenceContext, session: WorldSession, effectSite: EffectSite | undefined): void {
    if (this.among === undefined) {
      this.effect.apply(context, session, effectSite);
      return;
    }

    const picked = this.among.select(context, session.rng);
    // isAvailableで相手が居ることを確かめてから選ぶので、ここでundefinedにはならない。
    if (picked === undefined) return;
    this.effect.apply(context.withPicked(picked), session, effectSite);
  }

  /** この候補の宣言（PickCandidateReading参照）。PickEffect.readが読み手へ渡す。 */
  get reading(): PickCandidateReading {
    return { weight: this.weight.reading, effect: this.effect, among: this.among?.reading };
  }
}
