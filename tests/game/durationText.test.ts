import { describe, expect, it } from 'vitest';
import { durationText, minutesText } from '../../src/game/ui/durationText';

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
