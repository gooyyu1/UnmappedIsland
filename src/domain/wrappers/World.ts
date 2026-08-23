import { ObjectWrapper } from './ObjectWrapper';
import type { Rng } from '../Rng';

/**
 * world（唯一のシングルトン、GameElementDefinition.md 15節）の包み（ObjectWrapper）。
 *
 * worldがどのプロパティを持つべきかはまだ確定していないため、既存のサンプルに登場済みのものだけを実装している。
 */
export class World extends ObjectWrapper {
  get day(): number {
    return this.effectiveNumberOf(this.words.dayId);
  }

  get hour(): number {
    return this.effectiveNumberOf(this.words.hourId);
  }

  get minute(): number {
    return this.effectiveNumberOf(this.words.minuteId);
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
   * なので、実体は値の名前空間（symbolNames）が持つ名前を引き直したもの。worldが天気を
   * 持たなければundefined。
   */
  get weather(): string | undefined {
    const value = this.tryEffectiveNumberOf(this.words.weatherId);
    return value === undefined ? undefined : this.codex.symbolNames.getName(value);
  }

  /**
   * 今の日射（ClimateSystem.md）。時間帯と天気の寄与が重なった実効値で、夜は天気によらず0になる。
   * worldが日射を持たなければundefined。
   */
  get sunlight(): number | undefined {
    return this.tryEffectiveNumberOf(this.words.sunlightId);
  }

  /**
   * 今の気温（ClimateSystem.md）。日射と季節の寄与が重なった実効値。体温ではない。
   * worldが気温を持たなければundefined。
   */
  get ambientTemperature(): number | undefined {
    return this.tryEffectiveNumberOf(this.words.ambientTemperatureId);
  }

  /** 1tickに相当するゲーム内時間（分）。実体値をそのまま返す（WorldSession.advanceWorldTime参照）。 */
  get rawMinutesPerTick(): number {
    return this.instance.tryGetProperty(this.words.minutesPerTickId)?.number ?? 0;
  }

  /**
   * 今から数えてn回目のtickが回るまでの分数。**tickが回るのは通算分がminutes_per_tickの倍数になる
   * 瞬間**なので、ちょうど境界の上に居るなら次の1回はまるまるminutes_per_tick分先になる。
   *
   * 時間を進める側（WorldSession.advanceWorldTime）も、tick境界でしか起きないことの残り時間を出す側
   * （火にかけた物の焼き上がり、CardView.md 15節）も、この1つの答えから出す——**tickがいつ回るかの
   * 決まりを2箇所に書くと、片方だけ変えても何も壊れない**。
   */
  minutesUntilTick(n: number): number {
    const step = this.rawMinutesPerTick;
    return (n - 1) * step + (step - (this.totalMinutes % step));
  }

  /**
   * 現在時刻を、その日のearliestMinutes〜latestMinutes（0:00からの経過分、両端を含む）の中から
   * tick刻み（minutes_per_tick）で1つ選んで設定する（NewGame.start専用）。
   *
   * tickが回るのは絶対時刻がminutes_per_tickの倍数になる瞬間（WorldSession.advanceWorldTime）なので、
   * 刻みに乗らない時刻から始めると、以後ずっとtick境界が半端な時刻へずれる。
   */
  rollTimeOfDay(earliestMinutes: number, latestMinutes: number, rng: Rng): void {
    const step = this.rawMinutesPerTick;
    const firstStep = Math.ceil(earliestMinutes / step);
    const lastStep = Math.trunc(latestMinutes / step);
    const minutes = rng.nextInt(firstStep, lastStep + 1) * step;

    this.instance.tryGetProperty(this.words.hourId)?.setNumber(Math.trunc(minutes / 60));
    this.instance.tryGetProperty(this.words.minuteId)?.setNumber(minutes % 60);
  }

  /** minuteへamountを加減算する（WorldSession.advanceWorldTime専用。負の値も許容する）。繰り上げ（on_max）はtickを待たずその場で走る（PropertyValue.add参照）。 */
  addMinutes(amount: number): void {
    this.instance.tryGetProperty(this.words.minuteId)?.add(amount);
  }
}
