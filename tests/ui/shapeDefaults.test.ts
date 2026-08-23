import { afterEach, describe, expect, it } from 'vitest';
import { drawBox, setShapeDefaults } from '../../src/ui/shapes';
import { SHAPE_LOOK } from '../../src/game/looks/theme';

/** drawBoxが影として置いた矩形の、ずらし幅と濃さだけを拾う覆い。 */
function shadowRecorder(): {
  graphics: Parameters<typeof drawBox>[0];
  shadows: { offset: number; alpha: number }[];
} {
  const shadows: { offset: number; alpha: number }[] = [];
  let alpha = 1;
  const graphics = {
    fillStyle: (_color: number, a?: number) => {
      alpha = a ?? 1;
      return graphics;
    },
    lineStyle: () => graphics,
    fillRoundedRect: (x: number) => {
      // 塗り本体は原点（ずらし0・不透明）なので、影だけが残る。
      if (x !== 0) shadows.push({ offset: x, alpha });
    },
    strokeRoundedRect: () => graphics,
    beginPath: () => graphics,
    strokePath: () => graphics,
    lineBetween: () => graphics,
    arc: () => graphics,
  };
  return { graphics: graphics as unknown as Parameters<typeof drawBox>[0], shadows };
}

const shadowsOf = (): { offset: number; alpha: number }[] => {
  const { graphics, shadows } = shadowRecorder();
  drawBox(graphics, { x: 0, y: 0, width: 100, height: 40 }, { fillColor: 0xffffff, shadowOffset: 3 });
  return shadows;
};

describe('図形の意匠の注入(setShapeDefaults)', () => {
  // モジュール変数なので、他のテストへ持ち越さないよう既定へ戻す。
  afterEach(() => {
    setShapeDefaults({ shadowLayers: [{ offsetScale: 1, alpha: 0.3 }], dashLengthRatio: 6 });
  });

  it('入れなければ、影は1枚だけ置かれる（意匠を持たない画面でも図形になる）', () => {
    expect(shadowsOf()).toEqual([{ offset: 3, alpha: 0.3 }]);
  });

  it('このゲームの意匠を入れると、影は2枚重なる', () => {
    // ぼかせないので1枚だと輪郭がそのまま出る（theme.SHAPE_LOOK）。main.tsが起動時に入れる。
    setShapeDefaults(SHAPE_LOOK);

    expect(shadowsOf()).toEqual([
      { offset: 3, alpha: 0.3 },
      { offset: 6, alpha: 0.12 },
    ]);
  });
});
