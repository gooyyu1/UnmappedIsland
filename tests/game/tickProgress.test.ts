import { describe, expect, it } from 'vitest';
import { TickProgress } from '../../src/game/view/tickProgress';

/**
 * 時間経過の見せ方（CardInteraction.md 7節 時間経過のドーナツグラフ）の自動テスト。
 *
 * 目盛りが実際のtick境界（WorldSession.advanceWorldTimeがtickを回す瞬間）と一致すること、
 * 各区切りの前半で進み後半で止まること、その進み方が加速・減速を伴うこと、塗りと時計が食い違わない
 * ことを確かめる。
 */
describe('TickProgress(tick境界で一拍置く時間経過)', () => {
  const TICK = 15;

  describe('開始時刻がtick境界に乗っている場合(00:00から45分)', () => {
    const progress = new TickProgress(0, 45, TICK);

    it('区切りの前半で次の目盛りまで進む', () => {
      expect(progress.ratioAt(0), '押した直後は0%').toBe(0);
      // 1区切り目は0〜15分。その前半（0〜7.5分）で0%から1/3へ進む。
      expect(progress.ratioAt(7.5), '前半の終わりで1つ目の目盛り').toBeCloseTo(1 / 3);
    });

    it('目盛りへは加速して動き出し、減速して止まる', () => {
      // 1つ目の目盛り（1/3）へ向かう前半（0〜7.5分）の中での進み具合を、一定の速さの場合と比べる。
      const towardMark = (elapsed: number): number => progress.ratioAt(elapsed) / (1 / 3);

      expect(towardMark(0.75), '動き出しの1割の時点では、一定の速さより進んでいない').toBeLessThan(0.1);
      expect(towardMark(3.75), '半分の時点では進んでいる（減速に時間を多く割くため）').toBeGreaterThan(0.5);
      expect(towardMark(6.75), '止まる手前は目盛りに近い').toBeGreaterThan(0.9);
      expect(towardMark(6.75), 'まだ届いてはいない').toBeLessThan(1);
    });

    it('区切りの後半は止まる', () => {
      for (const elapsed of [7.5, 10, 12, 15]) {
        expect(progress.ratioAt(elapsed), `${elapsed}分でも1つ目の目盛りのまま`).toBeCloseTo(1 / 3);
      }
    });

    it('次の区切りに入ると再び進み始める', () => {
      expect(progress.ratioAt(22.5), '2区切り目の前半の終わりで2つ目の目盛り').toBeCloseTo(2 / 3);
      expect(progress.ratioAt(30), '2区切り目の後半は止まったまま').toBeCloseTo(2 / 3);
    });

    it('経過し切ると100%になる', () => {
      expect(progress.ratioAt(37.5), '最後の区切りの前半の終わり').toBeCloseTo(1);
      expect(progress.ratioAt(45)).toBe(1);
      expect(progress.ratioAt(60), '範囲を超えても100%を超えない').toBe(1);
    });

    it('時計は、塗りが目盛りへ届いた瞬間に飛ぶ', () => {
      expect(progress.steppedMinutesAt(0), '押した直後は開始時刻のまま').toBe(0);
      expect(progress.steppedMinutesAt(3.75), '目盛りへ向かっている間は動かない').toBe(0);
      expect(progress.steppedMinutesAt(7.5), '届いた瞬間に15分ぶん').toBe(15);
      expect(progress.steppedMinutesAt(15), '区切りの後半は止まったまま').toBe(15);
      expect(progress.steppedMinutesAt(22.5)).toBe(30);
      expect(progress.steppedMinutesAt(45)).toBe(45);
    });
  });

  describe('開始時刻がtick境界に乗っていない場合(07:10から45分)', () => {
    const from = 7 * 60 + 10;
    const progress = new TickProgress(from, from + 45, TICK);

    it('最初の目盛りだけ短く、次のtick境界に来る', () => {
      // 実際のtickは07:15/07:30/07:45（開始から5・20・35分後）に回る。
      expect(progress.ratioAt(2.5), '5分の区切りの前半の終わりで最初の目盛り').toBeCloseTo(5 / 45);
      expect(progress.ratioAt(5), '後半は止まったまま').toBeCloseTo(5 / 45);
      expect(progress.ratioAt(12.5), '次は15分の区切り。その前半の終わり').toBeCloseTo(20 / 45);
      expect(progress.ratioAt(27.5)).toBeCloseTo(35 / 45);
    });

    it('時計はtick境界の時刻へ飛ぶ', () => {
      expect(progress.steppedMinutesAt(0)).toBe(0);
      expect(progress.steppedMinutesAt(2.5), '07:15へ').toBe(5);
      expect(progress.steppedMinutesAt(12.5), '07:30へ').toBe(20);
      expect(progress.steppedMinutesAt(27.5), '07:45へ').toBe(35);
      expect(progress.steppedMinutesAt(45), '最後は経過し切った時刻（07:55）').toBe(45);
    });

    it('最後の区切りはtickを伴わないが、経過し切る位置で100%になる', () => {
      expect(progress.ratioAt(40), '35分から45分の区切りの前半の終わり').toBeCloseTo(1);
      expect(progress.ratioAt(45)).toBe(1);
    });
  });

  describe('durationがtickの倍数でない場合', () => {
    it('境界に乗った開始なら、目盛りはtickの位置と終わりに来る(00:00から20分)', () => {
      const progress = new TickProgress(0, 20, TICK);

      expect(progress.steppedMinutesAt(7.5), '00:15へ').toBe(15);
      expect(progress.steppedMinutesAt(15)).toBe(15);
      expect(progress.steppedMinutesAt(17.5), '残り5分の区切りの前半の終わりで00:20へ').toBe(20);
      expect(progress.ratioAt(17.5)).toBe(1);
    });

    it('境界に乗っていない開始でも、tickの回る位置に目盛りが来る(07:10から20分)', () => {
      // 実際のtickは07:15と07:30（開始から5・20分後）の2回。
      const from = 7 * 60 + 10;
      const progress = new TickProgress(from, from + 20, TICK);

      expect(progress.steppedMinutesAt(2.5), '07:15へ').toBe(5);
      expect(progress.steppedMinutesAt(5)).toBe(5);
      expect(progress.steppedMinutesAt(12.5), '07:30へ').toBe(20);
      expect(progress.ratioAt(12.5)).toBe(1);
    });

    it('tickを1回も跨がないなら、目盛りは終わりだけ(00:00から10分)', () => {
      const progress = new TickProgress(0, 10, TICK);

      expect(progress.ratioAt(2.5), '前半の半分の時点。まだ塗り切っていない').toBeLessThan(1);
      expect(progress.steppedMinutesAt(2.5), '目盛りへ届く前は動かない').toBe(0);
      expect(progress.steppedMinutesAt(5), '前半の終わりで経過し切る').toBe(10);
      expect(progress.ratioAt(5)).toBe(1);
    });
  });

  it('時間を消費しないなら最初から100%', () => {
    const progress = new TickProgress(100, 100, TICK);

    expect(progress.ratioAt(0)).toBe(1);
    expect(progress.steppedMinutesAt(0)).toBe(0);
  });
});
