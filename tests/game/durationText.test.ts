import { describe, expect, it } from 'vitest';
import { durationText } from '../../src/game/ui/durationText';

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
