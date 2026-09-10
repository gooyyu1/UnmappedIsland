import type { WorldSession } from './WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { EffectReader, DeclaredNumberReading } from './EffectReader';
import type { DeclaredNumber } from './DeclaredNumber';
import type { ReferenceContext } from './ReferenceRoot';
import type { WorldObject } from './WorldObject';
import type { Requirement, Requirements } from './Requirement';
import type { SignalEffect } from './SignalEffect';
import type { PassiveEffect } from './PassiveEffect';
import type { PassiveEffects } from './PassiveEffects';
import type { PassiveReader } from './PassiveReader';
import { spendDurationAndReportParticipantsAlive } from './actionTime';

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

  /**
   * 時間を進める前に告げる出来事（`announce`、11.6節）。何も告げなければ空。
   *
   * **告げるだけで世界の形は変えない**ので、型がsignalに限る。効果（effect）と別に持つのは起きる時点が
   * 違うため——1つにまとめると、読み上げた側が「時間の前か後か」を言えなくなる。
   */
  readonly announcements: readonly SignalEffect[];

  /** 条件成立時に適用する効果。何も書かれていなければ空の合成（ActiveEffectSequence）で、適用しても何も起きない。 */
  private readonly effect: ActiveEffect;

  /**
   * 実行にかかるゲーム内時間（分）。リテラルか{subject, prop}参照（weightの10.2節と同じ二択）。
   * undefinedなら時間を消費しない。時間進行（advanceWorldTime）までがこのクラスの責務で、
   * 呼び出し側が実行後に別途時間を進める必要はない。
   */
  private readonly duration: DeclaredNumber | undefined;

  /**
   * `duration`を進めている間だけ効く持続効果（11.7節）。**効果（effect）と別に持つのは効く時点が
   * 違うため**——こちらは経過の各tickに1回ずつ、あちらは経過し終えてから1回。
   */
  private readonly passives: PassiveEffects;

  constructor(
    name: string,
    requirements: Requirements | undefined,
    announcements: readonly SignalEffect[],
    effect: ActiveEffect,
    duration: DeclaredNumber | undefined,
    passives: PassiveEffects,
  ) {
    this.name = name;
    this.requirements = requirements;
    this.announcements = announcements;
    this.effect = effect;
    this.duration = duration;
    this.passives = passives;
  }

  /**
   * 経過の間だけ効く持続効果（11.7節）が宣言していることを、宣言順にすべて読み上げさせる
   * （PassiveReader参照）。一式をまるごと読む相手はこちらを呼ぶ。
   */
  readPassives(reader: PassiveReader): void {
    this.passives.read(reader);
  }

  /** 経過の間だけ効く持続効果（11.7節）の宣言。1つも宣言していなければ空。
   * **1件ずつを別々に扱う相手だけが呼ぶ**（PassiveEffects.declarations参照）。 */
  get passiveDeclarations(): readonly PassiveEffect[] {
    return this.passives.declarations;
  }

  /**
   * この操作にかかるゲーム内時間（分）。durationを省いていれば0。
   *
   * 「今のself（とinstrument）の状態から見て、どれだけかかるか」なので、時間を進める前に解決する
   * （切れ味の悪い刃物ほど時間がかかる、が書けるように）。実行前に画面へ見せる用途にも使う。
   */
  minutesFor(context: ReferenceContext): number {
    return this.duration === undefined ? 0 : Math.trunc(this.duration.resolveOrZero(context));
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
   * 今この文脈で、効果の行き先が無いために成立しない操作か（ActiveEffect.blocksOperation、9.9節）。
   * 満たしていない要件（conditions）と違って理由を持たない——成立していないのは条件ではなく、
   * 行き先の型そのものだから。
   */
  blocksOperation(context: ReferenceContext): boolean {
    return this.effect.blocksOperation(context);
  }

  /**
   * candidatesを先頭から順に重ねたとき、効果が続けて何回受け取れるか（ActiveEffect.acceptedCount）。
   * 答えられなければundefined。まとめてよいかまでを決めるのはきっかけの側（DragTrigger）。
   */
  acceptedCount(context: ReferenceContext, candidates: readonly WorldObject[]): number | undefined {
    return this.effect.acceptedCount(context, candidates);
  }

  /** 所要時間の宣言（DeclaredNumberReading参照）。durationを省いていればundefined＝時間を消費しない。 */
  get durationReading(): DeclaredNumberReading | undefined {
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
   * conditionsを見て、告げ、時間を進め、効果を適用する（ActionSystem.md 2節）。順序に意味がある:
   * 所要時間は時間を進める前に解決し、時間は効果の適用より先に進める。経過中に関与オブジェクトが
   * 失われたら、その行動は成立しなかったものとして効果を適用しない（actionTime参照）。
   *
   * **`announce`（11.6節）だけは時間を進める前に告げる。** 効果として告げると、過ぎ切ってからしか
   * 出せない——強制的な時間経過（docs/world/Characters.md 限界節）では、飛んだ理由をその6時間の
   * 後に言うことになる。告げるのは「始まったこと」なので、**この後の段が落ちても取り消さない**。
   *
   * **持続効果（11.7節）は、時間を進める間だけ登録する。** 各tickの増減と一緒に足されるので、
   * 端に居ても正味で釣り合う——下限に張り付いた値の減りをクランプが吸って、宣言した量がまるごと
   * 残ることがない（docs/world/Characters.md 限界節）。
   *
   * **要件は選んだ時点ではなく実行の時点で引き直す**（候補を作ってから落とすまでに世界は変わる）。
   * 相手の型も変わりうるので、そちらの引き直しは`Combination`が足す。
   *
   * 1つの操作としてまるごと囲う（`InteractionRelation.whileActing`）のは、関係を張る側。ここは
   * 囲まれた中身だけを持つ。
   */
  tryExecute(context: ReferenceContext, session: WorldSession): boolean {
    const self = context.self!;
    if (this.unmetRequirement(context) !== undefined) return false;

    // 実行のはじめから囲う。経過中のtickが動かした値は「操作が増やしたもの」に入らないが、この操作
    // 自身が宣言した持続効果が足したぶんは入る（PropertyGain参照）。
    return session.withInteractionGains(self, () => {
      for (const announcement of this.announcements) announcement.apply(context, session);

      const involved = [self, context.agent, context.instrument];
      const minutes = this.minutesFor(context);
      const alive = session.whileInteractionPassives(self, this.passives, () =>
        spendDurationAndReportParticipantsAlive(minutes, session, involved),
      );
      if (!alive) return false;

      self.applyActiveEffect(this.effect, context);
      return true;
    });
  }
}
