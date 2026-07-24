import type { NameRegistry } from '../../defs/NameRegistry';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';

/**
 * world（唯一のシングルトン、GameElementDefinition.md 15節）に対する、UI/ゲームロジック向けの型付きビュー。
 * 継承（class World extends WorldObject）ではなくラップにしているのは、WorldCodexがtraitによる合成モデルを
 * 採用しており、クラス階層と噛み合わないため。
 *
 * worldがどのプロパティを持つべきかはまだ確定していないため、既存のサンプルに登場済みのものだけを実装している。
 */
export class World {
  readonly instance: WorldObject;

  private readonly dayId: number;
  private readonly hourId: number;
  private readonly minuteId: number;
  private readonly minutesPerTickId: number;

  constructor(instance: WorldObject, propertyNames: NameRegistry) {
    this.instance = instance;
    this.dayId = propertyNames.getId('day');
    this.hourId = propertyNames.getId('hour');
    this.minuteId = propertyNames.getId('minute');
    this.minutesPerTickId = propertyNames.getId('minutes_per_tick');
  }

  get day(): number {
    return this.instance.getEffectiveValue(this.dayId);
  }

  get hour(): number {
    return this.instance.getEffectiveValue(this.hourId);
  }

  get minute(): number {
    return this.instance.getEffectiveValue(this.minuteId);
  }

  /** 1tickに相当するゲーム内時間（分）。実体値をそのまま返す（WorldSession.advanceWorldTime参照）。 */
  get minutesPerTick(): number {
    return this.instance.getNumber(this.minutesPerTickId);
  }

  /** minuteへamountを加減算する（WorldSession.advanceWorldTime専用。負の値も許容する）。sessionを渡すことで、on_overflow等がtickを待たずその場で判定・実行される（WorldObject.addNumber参照）。 */
  addMinutes(amount: number, session: WorldSession): void {
    this.instance.addNumber(this.minuteId, amount, session);
  }
}
