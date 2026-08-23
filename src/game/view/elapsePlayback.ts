import type { RecordedView } from './recording';
import { TickProgress } from './tickProgress';

/** 経過を見せている、ある瞬間の画面（ElapsePlayback.frameAt）。 */
export interface ElapseFrame {
  /** 時計に出す時刻（ゲーム内の総経過分）。目盛りに届くまでは手前の目盛りのまま。 */
  readonly clockMinutes: number;

  /**
   * ドーナツグラフの真ん中に出す、開始からの経過分。**clockMinutesと同じ目盛りから導く**ので、
   * 輪の数字と時計が別々の瞬間を指すことはない。
   */
  readonly elapsedMinutes: number;

  /** ドーナツグラフの塗り（0〜1）。 */
  readonly ratio: number;

  /** この瞬間に見せる控え（控えた時刻の順）。まだ目盛りに届いていないものは含まない。 */
  readonly due: readonly RecordedView[];
}

/**
 * ワールドを変えた経過を、実時間をかけて再生する（CardInteraction.md 7節）。
 *
 * ワールドは操作の実行時に一気に進み切っていて、控え（RecordedView）はtick境界ごとに取ってある。
 * **控えを出す瞬間は、時計がその時刻へ飛ぶ瞬間**——目盛りへ届く前に出すと、まだ起きていない結果が
 * 経過中の画面に現れる。
 *
 * **同じ控えは2度出さない。** フレームが飛んで目盛りを何本か跨いでも、飛ばした控えは控えた順に
 * まとめて出す（見せ落としを残さない、takeRemaining）。
 */
export class ElapsePlayback {
  private readonly fromMinutes: number;
  private readonly progress: TickProgress;
  private readonly recordedTicks: readonly RecordedView[];

  /** ここまで出した控えの数。控えは控えた時刻の順に並んでいるので、位置ひとつで足りる。 */
  private shownCount = 0;

  constructor(
    fromMinutes: number,
    toMinutes: number,
    tickMinutes: number,
    recordedTicks: readonly RecordedView[],
  ) {
    this.fromMinutes = fromMinutes;
    this.progress = new TickProgress(fromMinutes, toMinutes, tickMinutes);
    this.recordedTicks = recordedTicks;
  }

  /** 経過し切るまでのゲーム内時間（分）。0なら実時間をかけずに済む。 */
  get totalMinutes(): number {
    return this.progress.totalMinutes;
  }

  /** 開始からelapsedMinutes進んだ瞬間に見せるもの。 */
  frameAt(elapsedMinutes: number): ElapseFrame {
    const stepped = this.progress.steppedMinutesAt(elapsedMinutes);
    const clockMinutes = this.fromMinutes + stepped;
    return {
      clockMinutes,
      elapsedMinutes: stepped,
      ratio: this.progress.ratioAt(elapsedMinutes),
      due: this.dueAt(clockMinutes),
    };
  }

  /**
   * 見せ切っていない控えを全部返す（経過し切った時点で呼ぶ）。
   *
   * 実時間の刻みが最後の目盛りちょうどに来るとは限らないので、**最後の1枚が出ないまま終わりうる**。
   * 経過し切った並びは呼び出し側が改めて見せるが、その手前で起きた変化はここでしか出ない。
   */
  takeRemaining(): readonly RecordedView[] {
    return this.dueAt(Number.POSITIVE_INFINITY);
  }

  /** その時刻までに控えられていて、まだ出していないもの。 */
  private dueAt(minutes: number): readonly RecordedView[] {
    const due: RecordedView[] = [];
    while (
      this.shownCount < this.recordedTicks.length &&
      this.recordedTicks[this.shownCount].minutes <= minutes
    ) {
      due.push(this.recordedTicks[this.shownCount]);
      this.shownCount += 1;
    }
    return due;
  }
}
