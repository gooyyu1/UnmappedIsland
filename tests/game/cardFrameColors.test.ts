import { describe, expect, it } from 'vitest';
import type { CardFrameKind } from '../../src/game/looks/theme';
import { cardFrameColors } from '../../src/game/looks/theme';

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
    'artifact',
  ];

  const brightness = (color: number): number =>
    ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);

  it('種別ごとに違う色になる', () => {
    // 種別を足したのに色を足し忘れる（＝どれかと同じ色で出る）と、レーンの中で見分けが付かなくなる。
    const faces = KINDS.map((kind) => cardFrameColors(kind).face);

    expect(new Set(faces).size).toBe(KINDS.length);
  });

  it('タイトルの板のどの帯も桟より暗く、名前の文字はどの帯より明るい', () => {
    // 強調したいのは絵であって、名前は枠の一部（CardView.md 1節 カードの枠）。金の板は帯が明暗に
    // 振れる（同2.2節）が、**振れ幅は名前が読めるところまで**なので、帯ごとに見る。
    for (const kind of KINDS) {
      const colors = cardFrameColors(kind);
      for (const band of colors.plate) {
        expect(brightness(band), `${kind}: 板の帯は桟より暗い`).toBeLessThan(brightness(colors.face));
        expect(brightness(colors.ink), `${kind}: 文字は板の帯より明るい`).toBeGreaterThan(brightness(band));
      }
    }
  });

  it('縞になるのは金の板だけで、名前が載る中央の帯が最も暗い', () => {
    // 板を帯の並びにしたのは金を金に見せるためで（CardView.md 2.2節）、他の枠は平らなまま。
    // 帯を増やしたら名前が読めなくなった、を防ぐため、文字が載る中央が最も暗いことまで見る。
    for (const kind of KINDS) {
      const bands = cardFrameColors(kind).plate;
      if (kind !== 'artifact') {
        expect(bands.length, `${kind}: 平らな板`).toBe(1);
        continue;
      }

      expect(bands.length).toBeGreaterThan(1);
      const darkest = Math.min(...bands.map(brightness));
      expect(brightness(bands[Math.floor(bands.length / 2)])).toBe(darkest);
    }
  });
});
