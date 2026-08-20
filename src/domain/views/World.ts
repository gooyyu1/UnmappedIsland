import type { NameRegistry } from '../NameRegistry';
import type { Rng } from '../Rng';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';
import { Location } from './Location';

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
  /** 気候の語彙を持たないCodex（時間だけを扱うテスト用など）ではundefined。 */
  private readonly weatherId: number | undefined;
  private readonly sunlightId: number | undefined;
  private readonly ambientTemperatureId: number | undefined;
  private readonly symbolNames: NameRegistry;

  constructor(instance: WorldObject, propertyNames: NameRegistry, symbolNames: NameRegistry) {
    this.instance = instance;
    this.dayId = propertyNames.getId('day');
    this.hourId = propertyNames.getId('hour');
    this.minuteId = propertyNames.getId('minute');
    this.minutesPerTickId = propertyNames.getId('minutes_per_tick');
    this.weatherId = propertyNames.tryGetId('weather');
    this.sunlightId = propertyNames.tryGetId('sunlight');
    this.ambientTemperatureId = propertyNames.tryGetId('ambient_temperature');
    this.symbolNames = symbolNames;
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

  /**
   * day 1の0:00から数えた通算分（dayは1始まりなので0起点へ直す）。時間の経過そのものを1つの数として
   * 扱いたい場面——経過量を求める・その分だけ実時間をかけて時計を進める——のための読み取り。
   */
  get totalMinutes(): number {
    return ((this.day - 1) * 24 + this.hour) * 60 + this.minute;
  }

  /**
   * 今の天気の識別子（`light_rain`など、ClimateSystem.md 4.2節）。シンボル型プロパティ（6.6節）
   * なので、実体は値の名前空間（symbolNames）が持つ名前を引き直したもの。天気の語彙を持たない
   * Codexではundefined。
   */
  get weather(): string | undefined {
    if (this.weatherId === undefined) return undefined;
    return this.symbolNames.getName(this.instance.getEffectiveValue(this.weatherId));
  }

  /**
   * 今の日射（ClimateSystem.md）。時間帯と天気の寄与が重なった実効値で、夜は天気によらず0になる。
   * 日射の語彙を持たないCodexではundefined。
   */
  get sunlight(): number | undefined {
    return this.sunlightId === undefined ? undefined : this.instance.getEffectiveValue(this.sunlightId);
  }

  /**
   * 今の気温（ClimateSystem.md）。日射と季節の寄与が重なった実効値。体温ではない。
   * 気温の語彙を持たないCodexではundefined。
   */
  get ambientTemperature(): number | undefined {
    return this.ambientTemperatureId === undefined
      ? undefined
      : this.instance.getEffectiveValue(this.ambientTemperatureId);
  }

  /** 1tickに相当するゲーム内時間（分）。実体値をそのまま返す（WorldSession.advanceWorldTime参照）。 */
  get minutesPerTick(): number {
    return this.instance.getNumber(this.minutesPerTickId);
  }

  /**
   * 現在時刻を、その日のearliestMinutes〜latestMinutes（0:00からの経過分、両端を含む）の中から
   * tick刻み（minutes_per_tick）で1つ選んで設定する（NewGame.start専用）。
   *
   * tickが回るのは絶対時刻がminutes_per_tickの倍数になる瞬間（WorldSession.advanceWorldTime）なので、
   * 刻みに乗らない時刻から始めると、以後ずっとtick境界が半端な時刻へずれる。
   */
  rollTimeOfDay(earliestMinutes: number, latestMinutes: number, rng: Rng): void {
    const step = this.minutesPerTick;
    const firstStep = Math.ceil(earliestMinutes / step);
    const lastStep = Math.trunc(latestMinutes / step);
    const minutes = rng.nextInt(firstStep, lastStep + 1) * step;

    this.instance.setNumber(this.hourId, Math.trunc(minutes / 60));
    this.instance.setNumber(this.minuteId, minutes % 60);
  }

  /**
   * 島のすべての土地へ、動物の1手を配る（tickの後処理、HuntingSystem.md 5.2節）。
   *
   * 配る先を「プレイヤーの居る土地」に絞らないのは、動物がプレイヤーを見ているわけではないから
   * ——放って出かけた先で罠に掛かった獲物が暴れ、目を離した拠点の物が持ち去られる。
   *
   * 土地の語彙を持たないCodex（時間だけを扱うテスト用など）では何もしない。
   */
  runAnimalTurns(session: WorldSession): void {
    const locationsSlotId = session.codex.slotNames.tryGetId('locations');
    if (locationsSlotId === undefined) return;

    const slot = this.instance.tryGetSlot(locationsSlotId);
    if (slot === undefined) return;

    for (const land of [...slot.contents]) new Location(land, session.codex).runAnimalTurns(session);
  }

  /** minuteへamountを加減算する（WorldSession.advanceWorldTime専用。負の値も許容する）。sessionを渡すことで、on_max等がtickを待たずその場で判定・実行される（WorldObject.addNumber参照）。 */
  addMinutes(amount: number, session: WorldSession): void {
    this.instance.addNumber(this.minuteId, amount, session);
  }
}
