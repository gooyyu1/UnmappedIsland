import type { WorldObject } from '../runtime/WorldObject';
import type { WorldSession } from '../runtime/WorldSession';
import type { ActiveEffect } from './ActiveEffect';
import type { CraftingInput, CraftingStep } from './CraftingStep';
import { collectOutputs } from './CraftingStep';
import type { DefNames, DescriptionWriter } from './Description';
import { text } from './Description';
import type { WeightSpec } from './PickEffect';
import { resolveReferenceRoot } from './ReferenceRoot';
import type { StaticValueResolver } from './ReferenceRoot';
import type { Requirement, Requirements } from './Requirement';
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
      out.write(text('所要時間: '), ...this.duration.describe(names), text('分'));

    this.effect.describe(names, out);
  }

  /** 何がこの操作のきっかけになるか（具象ごとに違う）。describeが先頭に書く。 */
  protected abstract describeTrigger(names: DefNames, out: DescriptionWriter): void;

  /**
   * この操作の効果にmatchesが真になるものがあるか（逆引きの絞り込み用）。効果そのものを渡すので、
   * 何を尋ねるか（どのプロパティを書き換えるか・どの型を生むか）は呼び出し側が決める。
   */
  hasEffectMatching(matches: (effect: ActiveEffect) => boolean): boolean {
    return matches(this.effect);
  }

  /**
   * この操作を1つの工程として見たもの（CraftingStep参照）。**何も生み出さない操作も返す**——
   * 食べる・飲む操作はプロパティを返す終端の工程であり、出力の有無で絞るのは受け取る側の都合。
   *
   * 入力は常にself（この操作を宣言した型）で、消費されるかはdestroyの有無から分かる。
   * ドラッグ型の相手（withタグ）は具象（CombinationDef）が足す。
   *
   * resolveは、durationとweightの`{subject, prop}`参照を定義だけから解く手立て。1つでも解けなければ
   * hasUnresolvedReferencesが立つので、読み手はその行の数値を鵜呑みにせずに済む。
   */
  craftingStep(selfObjectGlobalId: number, resolve: StaticValueResolver): CraftingStep {
    let unresolved = false;
    const track: StaticValueResolver = (root, propertyGlobalId) => {
      const value = resolve(root, propertyGlobalId);
      if (value === undefined) unresolved = true;
      return value;
    };

    const outcomes = this.effect.collectOutcomes(track);
    const inputs: CraftingInput[] = [
      {
        kind: 'object',
        objectGlobalId: selfObjectGlobalId,
        consumed: this.effect.destroys('self'),
        count: 1,
      },
      ...this.extraCraftingInputs(this.effect),
    ];
    return {
      kind: this.craftingKind,
      name: this.name,
      ownerGlobalId: selfObjectGlobalId,
      inputs,
      outputs: collectOutputs(outcomes),
      // プレイヤーが手を止めている間に時間が進むので、払う時間と経過する時間は等しい。
      laborMinutes: this.staticMinutes(track),
      elapsedMinutes: this.staticMinutes(track),
      outcomes,
      hasUnresolvedReferences: unresolved,
    };
  }

  /**
   * この操作にかかるゲーム内時間（分）を、実行時のオブジェクトを使わずに解いた値。durationを省いて
   * いれば0、参照が解けなければ0（工程の側がhasUnresolvedReferencesで印を持つ）。
   */
  private staticMinutes(resolve: StaticValueResolver): number {
    if (this.duration === undefined) return 0;
    return Math.trunc(this.duration.staticResolve(resolve) ?? 0);
  }

  /** self以外の入力（ドラッグ型のwithタグ）。メニュー型には無い。 */
  protected extraCraftingInputs(_effect: ActiveEffect): readonly CraftingInput[] {
    return [];
  }

  /** クラフト工程としての種別（表示名の引き方が違う、CraftingStep参照）。 */
  protected abstract get craftingKind(): 'action' | 'combination';

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
    session.withInteractionEffect(self, () => self.applyActiveEffect(this.effect, session, actor, dragged));
    return true;
  }
}
