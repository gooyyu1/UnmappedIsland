import { describe, expect, it } from 'vitest';
import { tickSteppedCount, tickSteppedRatio } from '../../src/game/tickProgress';

/**
 * 時間経過の見せ方（ScreenLayout.md 時間経過のドーナツグラフ節）の自動テスト。
 * 3tick分（探索の45分＝実時間1.5秒）を例に、tickの前半で進み後半で止まることを確かめる。
 */
describe('tickProgress(tickごとに一拍置く時間経過)', () => {
  it('tickの前半で次の目盛りまで進む', () => {
    expect(tickSteppedRatio(0, 3), '押した直後は0%').toBe(0);
    // 1tick目の実時間は0〜1/3。その前半（0〜1/6）で0%から1/3へ進む。
    expect(tickSteppedRatio(1 / 12, 3), '前半の半分で目盛りの半分').toBeCloseTo(1 / 6);
    expect(tickSteppedRatio(1 / 6, 3), '前半の終わりで1つ目の目盛り').toBeCloseTo(1 / 3);
  });

  it('tickの後半は止まる', () => {
    for (const elapsed of [1 / 6, 1 / 5, 1 / 4, 1 / 3]) {
      expect(tickSteppedRatio(elapsed, 3), `経過${elapsed}でも1つ目の目盛りのまま`).toBeCloseTo(1 / 3);
    }
  });

  it('次のtickに入ると再び進み始める', () => {
    expect(tickSteppedRatio(0.4, 3)).toBeCloseTo(1 / 3 + (0.4 - 1 / 3) * 2);
    expect(tickSteppedRatio(1 / 2, 3), '2tick目の前半の終わりで2つ目の目盛り').toBeCloseTo(2 / 3);
    expect(tickSteppedRatio(2 / 3, 3), '2tick目の後半は止まったまま').toBeCloseTo(2 / 3);
  });

  it('経過し切ると100%になる', () => {
    expect(tickSteppedRatio(5 / 6, 3), '最後のtickの前半の終わり').toBeCloseTo(1);
    expect(tickSteppedRatio(1, 3)).toBe(1);
    expect(tickSteppedRatio(1.5, 3), '範囲を超えても100%を超えない').toBe(1);
  });

  it('tickが1つだけでも、前半で進み後半は止まる', () => {
    expect(tickSteppedRatio(0.25, 1)).toBeCloseTo(0.5);
    expect(tickSteppedRatio(0.5, 1)).toBe(1);
    expect(tickSteppedRatio(0.9, 1)).toBe(1);
  });

  it('埋まった目盛りの数は、塗りが目盛りへ届いた瞬間に増える', () => {
    // 時計はこの数で刻むので、塗り（tickSteppedRatio）と食い違わないことが要点。
    const count = (elapsed: number): number => tickSteppedCount(elapsed, 3);

    expect(count(0), '押した直後はまだ0つ目').toBe(0);
    expect(count(1 / 12), '1つ目の目盛りへ向かっている間は増えない').toBe(0);
    expect(count(1 / 6), '1つ目の目盛りへ届いた瞬間に1つ').toBe(1);
    expect(count(1 / 3), 'tickの後半の間は1つのまま').toBe(1);
    expect(count(0.4), '2つ目へ向かっている間も1つのまま').toBe(1);
    expect(count(1 / 2)).toBe(2);
    expect(count(5 / 6)).toBe(3);
    expect(count(1), '経過し切れば全部').toBe(3);
  });
});
