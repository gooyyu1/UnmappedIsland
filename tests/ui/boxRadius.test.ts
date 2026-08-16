import { describe, expect, it } from 'vitest';
import { drawBox } from '../../src/ui/shapes';

interface RoundedRectCall {
  readonly x: number;
  readonly width: number;
  readonly radius: number;
}

/**
 * drawBoxが角丸矩形へ渡した寸法だけを拾う覆い（描画そのものはPhaserの仕事）。
 * 破線の弧も同じ丸みで描くので、arcの中心と半径も拾う。
 */
function recorder(): {
  graphics: Parameters<typeof drawBox>[0];
  rounded: RoundedRectCall[];
  arcs: { x: number; radius: number }[];
} {
  const rounded: RoundedRectCall[] = [];
  const arcs: { x: number; radius: number }[] = [];
  const graphics = {
    fillStyle: () => graphics,
    lineStyle: () => graphics,
    fillRoundedRect: (x: number, _y: number, width: number, _height: number, radius: number) =>
      rounded.push({ x, width, radius }),
    strokeRoundedRect: (x: number, _y: number, width: number, _height: number, radius: number) =>
      rounded.push({ x, width, radius }),
    beginPath: () => graphics,
    strokePath: () => graphics,
    lineBetween: () => graphics,
    arc: (x: number, _y: number, radius: number) => arcs.push({ x, radius }),
  };
  return { graphics: graphics as unknown as Parameters<typeof drawBox>[0], rounded, arcs };
}

describe('角丸矩形の丸み(drawBox)', () => {
  it('丸みの2倍より狭い矩形では、丸みが辺の半分に収まる', () => {
    // Phaserは右側の角の弧を x + width - radius を中心に描くため、抑えないと弧が左へ貫通する
    // （値がごく小さいときのステータスバーの塗り）。
    const { graphics, rounded } = recorder();
    drawBox(graphics, { x: 0, y: 0, width: 6, height: 40 }, { fill: 0xffffff, radius: 10 });

    expect(rounded).toEqual([{ x: 0, width: 6, radius: 3 }]);
  });

  it('塗り・枠線・影・破線のどれも矩形からはみ出さない', () => {
    for (const style of [
      { fill: 0xffffff, radius: 10 },
      { border: 0x000000, borderWidth: 2, radius: 10 },
      { fill: 0xffffff, radius: 10, shadow: 2 },
      { border: 0x000000, borderWidth: 2, radius: 10, dashed: true },
    ]) {
      const { graphics, rounded, arcs } = recorder();
      const rect = { x: 0, y: 0, width: 6, height: 40 };
      drawBox(graphics, rect, style);

      for (const call of rounded) {
        expect(call.radius * 2, `丸みが幅を超える: ${JSON.stringify(call)}`).toBeLessThanOrEqual(call.width);
      }
      for (const arc of arcs) {
        expect(arc.x - arc.radius, `弧が左へはみ出す: ${JSON.stringify(arc)}`).toBeGreaterThanOrEqual(rect.x);
        expect(arc.x + arc.radius).toBeLessThanOrEqual(rect.x + rect.width);
      }
    }
  });

  it('辺が丸みに対して十分あれば、指定した丸みのまま描く', () => {
    const { graphics, rounded } = recorder();
    drawBox(graphics, { x: 0, y: 0, width: 200, height: 40 }, { fill: 0xffffff, radius: 10 });

    expect(rounded).toEqual([{ x: 0, width: 200, radius: 10 }]);
  });
});
