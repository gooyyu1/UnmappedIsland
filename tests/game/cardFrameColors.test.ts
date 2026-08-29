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

  it('金以外は、タイトルの板のどの帯も桟より暗く、名前の文字はどの帯より明るい', () => {
    // 強調したいのは絵であって、名前は枠の一部（CardView.md 1節 カードの枠）。
    for (const kind of KINDS.filter((kind) => kind !== 'artifact')) {
      const colors = cardFrameColors(kind);
      for (const band of colors.plate) {
        expect(brightness(band), `${kind}: 板の帯は桟より暗い`).toBeLessThan(brightness(colors.face));
        expect(brightness(colors.ink), `${kind}: 文字は板の帯より明るい`).toBeGreaterThan(brightness(band));
      }
    }
  });

  it('金の板だけは逆に、桟より明るいところを持ち、名前の文字はどの帯より暗い', () => {
    // アーティファクトは札そのものが目立つことが目的なので、板を暗くする規約から外れる
    // （CardView.md 2.2節）。板が明るくなると紙の白の文字は読めないので、文字も一緒に反転する。
    // 翳りまで桟より明るくは求めない——**振れ幅が金属の見え方を作る**ので、板全体を面より上へ
    // 持ち上げると淡い黄色の帯にしかならない。
    const colors = cardFrameColors('artifact');

    expect(Math.max(...colors.plate.map(brightness)), '反射は桟より明るい').toBeGreaterThan(
      brightness(colors.face),
    );
    for (const band of colors.plate) {
      expect(brightness(colors.ink), '文字は板の帯より暗い').toBeLessThan(brightness(band));
    }
  });

  it('斜めの筋を持つのは金の板だけで、その帯の並びは両端が同じ色', () => {
    // 板を帯の並びにしたのは金を金に見せるためで（CardView.md 2.2節）、他の枠は平らなまま。
    // 両端が同じ色であることは描き手が頼りにしている——角の丸みに筋が掛からないよう左右の端を
    // 1本目の色で埋めるので、ここが崩れると板の右端だけ色が飛ぶ（Card.drawPlate）。
    for (const kind of KINDS) {
      const bands = cardFrameColors(kind).plate;
      if (kind !== 'artifact') {
        expect(bands.length, `${kind}: 平らな板`).toBe(1);
        continue;
      }

      expect(bands.length).toBeGreaterThan(1);
      expect(bands[bands.length - 1]).toBe(bands[0]);
    }
  });
});
