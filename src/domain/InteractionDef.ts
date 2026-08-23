import type { WorldSession } from './WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { EffectReader, WeightReading } from './EffectReader';
import type { WeightSpec } from './WeightSpec';
import type { ReferenceContext } from './ReferenceRoot';
import type { WorldObject } from './WorldObject';
import type { Requirement, Requirements } from './Requirement';
import { spendDuration } from './actionTime';

/**
 * 操作1つの中身（ActionSystem.md 1節）——満たすべき要件・起こすこと・かかる時間。
 *
 * **何がこれを起こすかは持たない。** 操作どうしの違いは起こされ方だけなので、そちらは
 * きっかけ（InteractionTrigger）が持ち、宣言をぶら下げる。選ばれた後の実行手順（2節）は
 * きっかけによらず同じなので、ここが1箇所で持つ。
 */
export class InteractionDef {
  readonly name: string;

  /** 実行するために満たすべき要件（14節）。undefinedなら常に真（conditions省略）。 */
  private readonly requirements: Requirements | undefined;

  /** 条件成立時に適用する効果。何も書かれていなければ空の合成（ActiveEffects）で、適用しても何も起きない。 */
  private readonly effect: ActiveEffect;

  /**
   * 実行にかかるゲーム内時間（分）。リテラルか{subject, prop}参照（weightの10.2節と同じ二択）。
   * undefinedなら時間を消費しない。時間進行（advanceWorldTime）までがこのクラスの責務で、
   * 呼び出し側が実行後に別途時間を進める必要はない。
   */
  private readonly duration: WeightSpec | undefined;

  constructor(
    name: string,
    requirements: Requirements | undefined,
    effect: ActiveEffect,
    duration: WeightSpec | undefined,
  ) {
    this.name = name;
    this.requirements = requirements;
    this.effect = effect;
    this.duration = duration;
  }

  /**
   * この操作にかかるゲーム内時間（分）。durationを省いていれば0。
   *
   * 「今のself（とdragged）の状態から見て、どれだけかかるか」なので、時間を進める前に解決する
   * （切れ味の悪い刃物ほど時間がかかる、が書けるように）。実行前に画面へ見せる用途にも使う。
   */
  minutesFor(context: ReferenceContext): number {
    return this.duration === undefined ? 0 : Math.trunc(this.duration.resolve(context));
  }

  /** 実行に必要な要件（14節）を宣言順に。conditionsを省いていれば空。 */
  get requirementDeclarations(): readonly Requirement[] {
    return this.requirements?.declarations ?? [];
  }

  /** この操作が何を起こすと宣言しているかを読み上げる（EffectReader参照）。 */
  read(reader: EffectReader): void {
    this.effect.read(reader);
  }

  /**
   * 今この文脈で、効果の行き先が無いために成立しない操作か（ActiveEffect.unresolvable、9.9節）。
   * 満たしていない要件（conditions）と違って理由を持たない——成立していないのは条件ではなく、
   * 行き先の型そのものだから。
   */
  unresolvable(context: ReferenceContext): boolean {
    return this.effect.unresolvable(context);
  }

  /**
   * candidatesを先頭から順に重ねたとき、効果が続けて何回受け取れるか（ActiveEffect.acceptedCount）。
   * 答えられなければundefined。まとめてよいかまでを決めるのはきっかけの側（DragTrigger）。
   */
  acceptedCount(context: ReferenceContext, candidates: readonly WorldObject[]): number | undefined {
    return this.effect.acceptedCount(context, candidates);
  }

  /** 所要時間の宣言（WeightReading参照）。durationを省いていればundefined＝時間を消費しない。 */
  get durationReading(): WeightReading | undefined {
    return this.duration?.reading;
  }

  /**
   * 宣言順で最初に満たしていない要件（14節）。すべて満たしていればundefined＝今この操作を実行できる。
   * 実行できない理由をUIへ見せるためにも使う（Windows.md 1節 オブジェクトの子ウィンドウ）。
   */
  unmetRequirement(context: ReferenceContext): Requirement | undefined {
    return this.requirements?.firstUnmet(context);
  }

  /**
   * conditionsを見て、時間を進め、効果を適用する（ActionSystem.md 2節）。順序に意味がある:
   * 所要時間は時間を進める前に解決し、時間は効果の適用より先に進める。経過中に関与オブジェクトが
   * 失われたら、その行動は成立しなかったものとして効果を適用しない（actionTime参照）。
   *
   * **要件は選んだ時点ではなく実行の時点で引き直す**（候補を作ってから落とすまでに世界は変わる）。
   * 相手の型も変わりうるので、そちらの引き直しは`Combination`が足す。
   */
  execute(context: ReferenceContext, session: WorldSession): boolean {
    const self = context.self!;
    if (this.unmetRequirement(context) !== undefined) return false;

    const involved = [self, context.actor, context.dragged];
    if (!spendDuration(this.minutesFor(context), session, involved)) return false;

    // 時間を進め終えてから囲うので、経過中のtickが動かした値は「操作が増やしたもの」に入らない
    // （PropertyGain参照）。
    session.withInteractionEffect(self, () =>
      self.applyActiveEffect(this.effect, context.actor, context.dragged),
    );
    return true;
  }
}
