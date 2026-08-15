import { describe, expect, it } from 'vitest';
import { durationText, elapsedText, minutesText } from '../../src/game/ui/durationText';

describe('minutesText(ゲーム内時間の長さ)', () => {
  it('1時間に満たなければ分だけ、超えれば時間と分に分ける', () => {
    // 焼き上がるまでの残り時間（CardView.md 15節）も、操作にかかる時間と同じ字面で読める。
    expect(minutesText(45)).toBe('45分');
    expect(minutesText(60)).toBe('1時間');
    expect(minutesText(135)).toBe('2時間15分');
  });
});

describe('durationText(かかる時間の表示)', () => {
  it('時間を消費しない操作は表示しない', () => {
    expect(durationText(0)).toBeUndefined();
  });

  it('1時間に満たなければ分だけ、超えれば時間と分に分ける', () => {
    expect(durationText(15)).toBe('かかる時間 15分');
    expect(durationText(60)).toBe('かかる時間 1時間');
    expect(durationText(90)).toBe('かかる時間 1時間30分');
    expect(durationText(1440)).toBe('かかる時間 24時間');
  });
});

describe('elapsedText(経過時間の表示)', () => {
  it('分は必ず2桁で、時間との間を:で区切る', () => {
    // 動きながら大きく出る数字なので、値が変わっても文字の幅が動かない形にする。
    expect(elapsedText(0)).toBe('+0:00');
    expect(elapsedText(15)).toBe('+0:15');
    expect(elapsedText(60)).toBe('+1:00');
    expect(elapsedText(95)).toBe('+1:35');
    expect(elapsedText(360)).toBe('+6:00');
  });

  it('端数のある分は切り捨て、負の経過は0にする', () => {
    // 目盛りは分の境目に置かれるが、演出の途中で端数が渡っても字面は分単位のまま。
    expect(elapsedText(15.9)).toBe('+0:15');
    expect(elapsedText(-1)).toBe('+0:00');
  });
});
