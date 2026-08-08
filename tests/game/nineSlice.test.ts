import { describe, expect, it } from 'vitest';
import { sliceSpans } from '../../src/game/ui/nineSlice';

describe('9patchの切り分け(nineSlice)', () => {
  it('端は原寸のまま、中央が残りを埋める', () => {
    expect(sliceSpans(500, 48)).toEqual([
      { at: 0, size: 48 },
      { at: 48, size: 404 },
      { at: 452, size: 48 },
    ]);
  });

  it('隙間なく辺を埋める', () => {
    for (const total of [500, 97, 96, 95, 40, 1]) {
      const [first, middle, last] = sliceSpans(total, 48);
      expect(first.at).toBe(0);
      expect(first.at + first.size).toBe(middle.at);
      expect(middle.at + middle.size).toBe(last.at);
      expect(last.at + last.size).toBe(total);
    }
  });

  it('端が両方入らない短い辺では、端どうしを重ねずに詰める', () => {
    expect(sliceSpans(40, 48)).toEqual([
      { at: 0, size: 20 },
      { at: 20, size: 0 },
      { at: 20, size: 20 },
    ]);
  });
});
