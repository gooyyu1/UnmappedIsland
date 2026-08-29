import type { InteractionDef } from './InteractionDef';
import type { ObjectDef } from './ObjectDef';
import type { ReferenceContext } from './ReferenceRoot';
import type { TypeMatchReading, TypeMatchRule } from './TypeMatchRule';
import type { WorldObject } from './WorldObject';

/** 何がこの操作のきっかけになるか（InteractionTrigger.reading参照）。 */
export type InteractionTriggerReading =
  | { readonly kind: 'menu' }
  | { readonly kind: 'tick' }
  | { readonly kind: 'drag'; readonly with: TypeMatchReading; readonly allowMultiple: boolean };

/** きっかけ別に束ねる先（InteractionTrigger.addTo参照）。 */
export interface TriggerGroups {
  readonly menu: MenuTrigger[];
  readonly tick: TickTrigger[];
  readonly drag: DragTrigger[];
}

/**
 * 操作を起こすもの（GameElementDefinition.md 11.1節）。**きっかけが宣言を持つ**——操作どうしの
 * 違いは中身（要件・効果・所要時間）ではなく起こされ方だけなので、差はここに集まる。
 *
 * 束ねるのも引くのもきっかけの単位で行う（`ObjectDef.menuTriggers` ほか）。画面のボタンを並べる側も
 * 時間の側も、**自分に関わるものだけを受け取る**ので、種類を見分ける必要がない。
 */
export abstract class InteractionTrigger {
  /** このきっかけが起こす操作。 */
  readonly interaction: InteractionDef;

  protected constructor(interaction: InteractionDef) {
    this.interaction = interaction;
  }

  /** 自分がどの束に入るかは自分が知っている。**種類を足したら実装しないとコンパイルが通らない。** */
  abstract addTo(groups: TriggerGroups): void;

  /** このきっかけの宣言そのもの（InteractionTriggerReading参照）。 */
  abstract get reading(): InteractionTriggerReading;
}

/**
 * 相手を伴わないきっかけ（11節）。1枚のカード（self）だけで完結し、名前で指して実行される。
 * agentは常に暗黙的に参加する。
 */
export abstract class ActionTrigger extends InteractionTrigger {
  constructor(interaction: InteractionDef) {
    super(interaction);
  }
}

/** プレイヤーが押したときに起きる（11.1節）。**画面のボタンに出るのはこれだけ。** */
export class MenuTrigger extends ActionTrigger {
  addTo(groups: TriggerGroups): void {
    groups.menu.push(this);
  }

  get reading(): InteractionTriggerReading {
    return { kind: 'menu' };
  }
}

/**
 * 時間が経ったときに起きる（11.1節）。プレイヤーが押す機会は無く、名前で指して実行される点だけが
 * メニュー型と同じ（動物の1手、docs/engine/HuntingSystem.md 5節）。
 */
export class TickTrigger extends ActionTrigger {
  addTo(groups: TriggerGroups): void {
    groups.tick.push(this);
  }

  get reading(): InteractionTriggerReading {
    return { kind: 'tick' };
  }
}

/**
 * カードを重ねたときに起きる（12節）。宣言している側がself、相手がinstrumentになる。
 * 宣言は**変化の本体**の側に1つだけ置く（12.3節）。
 */
export class DragTrigger extends InteractionTrigger {
  /** 相手とのマッチング条件（12.1節）。 */
  readonly with: TypeMatchRule;

  /**
   * まとめて重ねてよいか（`allow_multiple`、12.4節）。**構造として何個受け取れるかとは別の宣言**——
   * 器が答えられても、まとめて実行させたくない操作はある（時間のかかる操作を止める手段がプレイヤーに
   * 無いため）。既定はfalseで、1枚ずつ。
   */
  private readonly allowMultiple: boolean;

  constructor(interaction: InteractionDef, withRule: TypeMatchRule, allowMultiple = false) {
    super(interaction);
    this.with = withRule;
    this.allowMultiple = allowMultiple;
  }

  addTo(groups: TriggerGroups): void {
    groups.drag.push(this);
  }

  /** instrumentDefをこの組み合わせの相手にできるか（12.1節）。 */
  acceptsInstrument(instrumentDef: ObjectDef): boolean {
    return this.with.matches(instrumentDef);
  }

  /**
   * instrumentたちを先頭から順に重ねたとき、続けて実行できる個数。効果が数を答えられなければ1で、
   * まとめてよいと宣言していなければ（allow_multiple）、数えられても1までにする。
   *
   * **0は「重ねても何も起きない」ではなく「起こしてはいけない」。** 器へ入らないまま相手を消す効果
   * （満杯の炉へ薪をくべる）が、黙って薪だけ失う結果になるのを防ぐ。
   */
  acceptedCount(context: ReferenceContext, candidates: readonly WorldObject[]): number {
    const counted = this.interaction.acceptedCount(context, candidates);
    return counted === undefined ? 1 : this.allowMultiple ? counted : Math.min(1, counted);
  }

  get reading(): InteractionTriggerReading {
    return { kind: 'drag', with: this.with.reading, allowMultiple: this.allowMultiple };
  }
}
