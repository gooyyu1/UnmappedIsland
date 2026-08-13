import { describe, expect, it } from 'vitest';
import type { CardFrameKind } from '../../src/game/ui/theme';
import { cardFrameColors } from '../../src/game/ui/theme';

/**
 * カードの枠の色（CardView.md 2節 枠の色は種別で変える）の自動テスト。
 *
 * 検査するのは種別ごとに色が分かれていることと、桟・板・文字の明るさの順序だけ。**どれだけ違えば
 * 見分けが付くかは検査しない**——数値で言えるのはRGBの隔たりで、それは見分けやすさとは別のものなので、
 * しきい値を置いても意匠の判断を代わりに担えない。
 */
describe('カードの枠の色', () => {
  const KINDS: readonly CardFrameKind[] = [
    'location',
    'fixture',
    'item',
    'food',
    'container',
    'tool',
    'injury',
    'animal',
    'character',
    'blueprint',
  ];

  it('種別ごとに違う色になる', () => {
    // 種別を足したのに色を足し忘れる（＝どれかと同じ色で出る）と、レーンの中で見分けが付かなくなる。
    const faces = KINDS.map((kind) => cardFrameColors(kind).face);

    expect(new Set(faces).size).toBe(KINDS.length);
  });

  it('タイトルの板は桟より暗く、名前の文字は板より明るい', () => {
    // 強調したいのは絵であって、名前は枠の一部（CardView.md 1節 カードの枠）。
    const brightness = (color: number): number =>
      ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);

    for (const kind of KINDS) {
      const colors = cardFrameColors(kind);
      expect(brightness(colors.plate), `${kind}: 板は桟より暗い`).toBeLessThan(brightness(colors.face));
      expect(brightness(colors.ink), `${kind}: 文字は板より明るい`).toBeGreaterThan(brightness(colors.plate));
    }
  });
});
