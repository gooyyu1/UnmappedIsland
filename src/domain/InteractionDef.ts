import type { WorldObject } from './WorldObject';
import type { WorldSession } from './WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { DefNames, DescriptionWriter } from './Description';
import { text } from './Description';
import { describeEffect, weightTokens } from './describeEffect';
import type { EffectReader, WeightReading } from './EffectReader';
import type { WeightSpec } from './PickEffect';
import { resolveReferenceRoot } from './ReferenceRoot';
import type { Requirement, Requirements } from './Requirement';
import type { TypeMatchReading } from './TypeMatchRule';
import { spendDuration } from './actionTime';

/**
 * プレイヤーが起こせる操作1つ（ActionSystem.md 1節）。具象は入口が違うだけの2種——名前で指す
 * メニュー型（ActionDef）と、withタグで相手と噛み合うドラッグ型（CombinationDef）。
 *
 * 選ばれた後の実行手順（2節）は共通なのでここが持つ。draggedはドラッグ型だけが持つ相手で、
 * メニュー型ではundefined。条件の起点も効果の対象も所要時間の参照も、そのまま流せば同じ経路を通る。
 */
export abstract class InteractionDef {
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

  protected constructor(
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
  minutesFor(self: WorldObject, dragged: WorldObject | undefined, actor: WorldObject | undefined): number {
    return this.duration === undefined ? 0 : Math.trunc(this.duration.resolve(self, actor, dragged));
  }

  /**
   * この操作を書き表す（Description参照）。きっかけ（メニュー/相手のタグ）→要件→所要時間→効果の順で、
   * プレイヤーがカードを触ってから起こることの順番に並べる。
   */
  describe(names: DefNames, out: DescriptionWriter): void {
    this.describeTrigger(names, out);

    if (this.requirements !== undefined) {
      out.write(text('conditions:'));
      out.indented(() => this.requirements!.describe(names, out));
    }

    if (this.duration !== undefined)
      out.write(text('所要時間: '), ...weightTokens(this.duration.reading, names), text('分'));

    describeEffect(this, names, out);
  }

  /** 何がこの操作のきっかけになるか（具象ごとに違う）。describeが先頭に書く。 */
  protected abstract describeTrigger(names: DefNames, out: DescriptionWriter): void;

  /** この操作が何を起こすと宣言しているかを読み上げる（EffectReader参照）。 */
  read(reader: EffectReader): void {
    this.effect.read(reader);
  }

  /**
   * 今この文脈で、効果の行き先が無いために成立しない操作か（ActiveEffect.unresolvable、9.9節）。
   * 満たしていない要件（conditions）と違って理由を持たない——成立していないのは条件ではなく、
   * 行き先の型そのものだから。
   */
  unresolvable(self: WorldObject, dragged: WorldObject | undefined, actor: WorldObject | undefined): boolean {
    return this.effect.unresolvable(self, actor, dragged);
  }

  /** まとめて実行するときの回数の上限を効果に訊く（ActiveEffect.acceptedCount）。 */
  protected acceptedCountOf(
    self: WorldObject,
    candidates: readonly WorldObject[],
    actor: WorldObject | undefined,
  ): number | undefined {
    return this.effect.acceptedCount(self, candidates, actor);
  }

  /** 所要時間の宣言（WeightReading参照）。durationを省いていればundefined＝時間を消費しない。 */
  get durationReading(): WeightReading | undefined {
    return this.duration?.reading;
  }

  /** 重ねる相手の指定（12.1節）。メニュー型は相手を取らないのでundefined。 */
  get draggedReading(): TypeMatchReading | undefined {
    return undefined;
  }

  /**
   * 宣言順で最初に満たしていない要件（14節）。すべて満たしていればundefined＝今この操作を実行できる。
   * 実行できない理由をUIへ見せるためにも使う（Windows.md 1節 オブジェクトの子ウィンドウ）。
   */
  protected firstUnmetRequirement(
    self: WorldObject,
    dragged: WorldObject | undefined,
    actor: WorldObject | undefined,
  ): Requirement | undefined {
    return this.requirements?.firstUnmet((root) => resolveReferenceRoot(root, self, actor, dragged));
  }

  /**
   * conditionsを見て、時間を進め、効果を適用する（ActionSystem.md 2節）。順序に意味がある:
   * 所要時間は時間を進める前に解決し、時間は効果の適用より先に進める。経過中に関与オブジェクトが
   * 失われたら、その行動は成立しなかったものとして効果を適用しない（actionTime参照）。
   */
  protected apply(
    self: WorldObject,
    dragged: WorldObject | undefined,
    actor: WorldObject | undefined,
    session: WorldSession,
  ): boolean {
    if (this.firstUnmetRequirement(self, dragged, actor) !== undefined) return false;

    if (!spendDuration(this.minutesFor(self, dragged, actor), session, [self, dragged, actor])) return false;

    // 時間を進め終えてから囲うので、経過中のtickが動かした値は「操作が増やしたもの」に入らない
    // （PropertyGain参照）。
    session.withInteractionEffect(self, () => self.applyActiveEffect(this.effect, actor, dragged));
    return true;
  }
}
