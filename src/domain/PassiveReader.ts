import type { AmountReading } from './PassiveAmount';
import type { ConditionDeclaration } from './ConditionReader';
import type { TransferReading } from './EffectReader';
import type { ReferenceRoot } from './ReferenceRoot';

/**
 * 持続効果（8節）が**何を宣言しているか**を読み上げる相手（PassiveEffect.read）。
 *
 * 一時的な効果の読み上げ口（EffectReader）と別なのは、**ゲートを必ず伴う**ため——tick毎に効く宣言は
 * 「いつ効くか」と切り離せない。動詞がわずかしかないのも持続効果の性質そのもので、可逆な寄与（`modify`）・
 * 不可逆な積み上げ（`add`）・輸送（`transfer`）に閉じている（8.4節）。
 */
export interface PassiveReader {
  /** `modify`（8.3節）。可逆な寄与で、**実体値は動かさない**。 */
  modify(reading: PassivePropertyReading): void;

  /** `add`（8.4節）。tick毎に実体値そのものを動かす。 */
  accumulate(reading: PassivePropertyReading): void;

  /** `transfer`（8.4節）。在庫の続く間だけ動くので、amountは上限。 */
  transfer(reading: TransferReading, gate: GateReading): void;
}

/** `modify`/`add` 1件の宣言。 */
export interface PassivePropertyReading {
  readonly target: ReferenceRoot;
  readonly propertyGlobalId: number;
  readonly amount: AmountReading;
  readonly gate: GateReading;
}

/**
 * ゲート（8.2節）の宣言。**条件は読み下せる形で渡す**——「いつまで成り立つか」を見積もるのも、
 * 読める形へ書き出すのも、入れ子を辿らないとできない。
 */
export interface GateReading {
  /** 段で縛られているならその段。常時効くならundefined。 */
  readonly stage: { readonly propertyGlobalId: number; readonly name: string } | undefined;

  /** 段以外の条件。無ければundefined。 */
  readonly conditions: ConditionDeclaration | undefined;
}

/** 自分が何を宣言しているかを読み上げられる持続効果。 */
export interface PassiveDeclaration {
  read(reader: PassiveReader): void;
}
