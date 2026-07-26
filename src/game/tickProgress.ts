/** 1区切りぶんの実時間のうち、割合を進める側に使う比。残りは止めて、目盛りで一拍置く。 */
const ADVANCE_RATIO = 0.5;

/**
 * 時間を消費するアクションの、時間経過の見せ方（ScreenLayout.md 時間経過のドーナツグラフ節）。
 *
 * ゲーム内の変化が起きるのはtick境界だけなので、実時間を一定の速さで滑らかに映すのではなく、
 * 区切りごとに一拍置く。区切り（目盛り）は**絶対時刻がminutes_per_tickの倍数になる瞬間**で、
 * WorldSession.advanceWorldTimeが実際にtickを回す瞬間と一致する。開始時刻が境界に乗っていなければ
 * 最初の区切りだけ短くなり、durationが倍数でなければ最後の区切りだけ短くなる。
 *
 * ドーナツグラフの塗り（ratioAt）と時計の刻み（steppedMinutesAt）が食い違わないよう、どちらも
 * 同じ区切りから導く。
 */
export class TickProgress {
  /** 開始からの経過分。これを100%として塗る。 */
  readonly totalMinutes: number;

  /** 開始からの経過分で表した目盛りの位置。末尾は必ずtotalMinutes（そこで塗り切る）。 */
  private readonly marks: readonly number[];

  constructor(fromMinutes: number, toMinutes: number, tickMinutes: number) {
    this.totalMinutes = Math.max(0, toMinutes - fromMinutes);
    this.marks = TickProgress.markUpTo(this.totalMinutes, fromMinutes, tickMinutes);
  }

  /** 経過した分に対する、ドーナツグラフの塗り（0〜1）。 */
  ratioAt(elapsedMinutes: number): number {
    if (this.totalMinutes <= 0) return 1;

    const { start, end, within } = this.segmentAt(elapsedMinutes);
    return (start + Math.min(within / ADVANCE_RATIO, 1) * (end - start)) / this.totalMinutes;
  }

  /**
   * 経過した分に対する、時計へ出す「開始からの経過分」。塗りが次の目盛りへ届くまでは手前の目盛りの
   * ままで、届いた瞬間にその目盛りの時刻へ飛ぶ。
   */
  steppedMinutesAt(elapsedMinutes: number): number {
    if (this.totalMinutes <= 0) return 0;

    const { start, end, within } = this.segmentAt(elapsedMinutes);
    return within >= ADVANCE_RATIO ? end : start;
  }

  /** 経過分が入っている区切りと、その中での進み具合（0〜1）。 */
  private segmentAt(elapsedMinutes: number): { start: number; end: number; within: number } {
    const elapsed = Math.min(Math.max(elapsedMinutes, 0), this.totalMinutes);
    // 最後の目盛りちょうどはどの区切りにも入らないので、最後の区切りを走り切ったものとして扱う。
    const found = this.marks.findIndex((mark) => elapsed < mark);
    const index = found < 0 ? this.marks.length - 1 : found;

    const start = index === 0 ? 0 : this.marks[index - 1];
    const end = this.marks[index];
    return { start, end, within: end === start ? 1 : (elapsed - start) / (end - start) };
  }

  /**
   * 次のtick境界から順に、経過し切るまでの目盛りを並べる（末尾は経過し切る位置そのもの）。
   * 開始時刻が境界に乗っていれば最初の目盛りはtickMinutes後、乗っていなければ端数の残りだけ後。
   */
  private static markUpTo(totalMinutes: number, fromMinutes: number, tickMinutes: number): number[] {
    if (tickMinutes <= 0) return [totalMinutes];

    const marks: number[] = [];
    const offset = ((fromMinutes % tickMinutes) + tickMinutes) % tickMinutes;
    for (let mark = tickMinutes - offset; mark < totalMinutes; mark += tickMinutes) marks.push(mark);

    marks.push(totalMinutes);
    return marks;
  }
}
