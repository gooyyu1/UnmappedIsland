import { describe, expect, it } from 'vitest';
import type { RecordedView } from '../../src/game/view/recording';
import { ElapsePlayback } from '../../src/game/view/elapsePlayback';

/**
 * 経過の再生（ElapsePlayback）の自動テスト。
 *
 * 控えの中身は見ない——**いつ出すか**だけが再生側の責務で、何が映っているかは控える側
 * （tests/game/recording.test.ts）が受け持つ。
 */
describe('経過の再生', () => {
  /** 控えた時刻だけを持つ控え。再生側が読むのはminutesだけ。 */
  const tick = (minutes: number): RecordedView => ({ minutes }) as RecordedView;

  /** 15分刻みの世界で、00:00から60分の経過を再生する（目盛りは15・30・45・60）。 */
  const playbackOf = (ticks: readonly RecordedView[]): ElapsePlayback => new ElapsePlayback(0, 60, 15, ticks);

  /** 経過分をstep刻みで進めて、その順に出た控えの時刻を並べる。 */
  const replay = (playback: ElapsePlayback, step: number): number[] => {
    const shown: number[] = [];
    for (let elapsed = 0; elapsed <= playback.totalMinutes; elapsed += step)
      shown.push(...playback.frameAt(elapsed).due.map((view) => view.minutes));
    return shown;
  };

  it('目盛りへ届くまで、その時刻の控えは出ない', () => {
    const playback = playbackOf([tick(15)]);

    // 最初の区切りの前半は目盛りへ向かって進んでいる途中で、時計はまだ00:00のまま。
    expect(playback.frameAt(0).due, '始まった瞬間').toEqual([]);
    expect(playback.frameAt(7).due, '目盛りの手前').toEqual([]);
    expect(
      playback.frameAt(8).due.map((view) => view.minutes),
      '目盛りへ届いた瞬間',
    ).toEqual([15]);
  });

  it('同じ控えが2度出ることはない', () => {
    const playback = playbackOf([tick(15), tick(30)]);

    expect(replay(playback, 1)).toEqual([15, 30]);
  });

  it('フレームが飛んで目盛りを跨いでも、飛ばした控えは順にまとめて出る', () => {
    const playback = playbackOf([tick(15), tick(30), tick(45)]);

    // 1回目の刻みで45分ぶんを跨ぐ。3枚が控えた順にまとめて出る。
    expect(playback.frameAt(50).due.map((view) => view.minutes)).toEqual([15, 30, 45]);
  });

  it('経過し切ると、控えを1枚残らず出し切っている', () => {
    const playback = playbackOf([tick(15), tick(30), tick(45)]);
    const shown = replay(playback, 3);

    // 実時間の刻みが最後の目盛りちょうどに来るとは限らないので、締めで取りこぼしを拾う。
    expect([...shown, ...playback.takeRemaining().map((view) => view.minutes)]).toEqual([15, 30, 45]);
  });

  it('締めを2度呼んでも、出し切った控えは繰り返さない', () => {
    const playback = playbackOf([tick(15)]);

    expect(playback.takeRemaining().map((view) => view.minutes)).toEqual([15]);
    expect(playback.takeRemaining()).toEqual([]);
  });

  it('控えが無くても、時計と塗りは進む', () => {
    const playback = playbackOf([]);

    expect(playback.frameAt(0).due).toEqual([]);
    expect(playback.frameAt(60).clockMinutes, '経過し切った時刻を指す').toBe(60);
    expect(playback.frameAt(60).ratio).toBe(1);
  });

  it('時間を消費しない経過は、最初から塗り切っている', () => {
    const playback = new ElapsePlayback(0, 0, 15, []);

    expect(playback.totalMinutes).toBe(0);
    expect(playback.frameAt(0)).toMatchObject({ clockMinutes: 0, elapsedMinutes: 0, ratio: 1, due: [] });
  });

  it('時計と、輪に出す経過分は、同じ目盛りを指す', () => {
    // 別々の瞬間を指すと、輪の数字が進んだのに時計が動かない、という見え方になる。
    const playback = new ElapsePlayback(430, 450, 15, []);

    for (const elapsed of [0, 3, 5, 12, 20]) {
      const frame = playback.frameAt(elapsed);
      expect(frame.clockMinutes - frame.elapsedMinutes, `${elapsed}分`).toBe(430);
    }
  });

  it('時計は控えと同じ絶対時刻を指す', () => {
    // 開始が目盛りに乗っていなければ、最初の目盛りだけ短くなる（07:10から20分＝430分から）。
    const playback = new ElapsePlayback(430, 450, 15, [tick(435)]);

    expect(playback.frameAt(0).clockMinutes, '始まった瞬間は開始時刻のまま').toBe(430);

    const jumped = playback.frameAt(5);

    expect(jumped.clockMinutes, '最初のtick境界へ飛ぶ').toBe(435);
    expect(
      jumped.due.map((view) => view.minutes),
      '飛んだ瞬間に控えが出る',
    ).toEqual([435]);
  });
});
