import { describe, expect, it } from 'vitest';
import type { LayoutEdge, LayoutNode } from '../../src/codex/networkLayout';
import { layoutLayered } from '../../src/codex/networkLayout';

/**
 * 階層レイアウト（networkLayout）の検証。座標そのものではなく、レイアウトが守るべき性質
 * （素材が左・ループ以外は左→右・決定性）を確かめる。
 */
describe('階層レイアウト（layoutLayered)', () => {
  const node = (id: string): LayoutNode => ({ id, width: 100, height: 50 });
  const edge = (from: string, to: string): LayoutEdge => ({ from, to });

  function xOf(result: ReturnType<typeof layoutLayered>, id: string): number {
    return result.positions.get(id)!.x;
  }

  it('チェーンは左から右へ並ぶ', () => {
    const result = layoutLayered(
      [node('beach'), node('coconut'), node('husked')],
      [edge('beach', 'coconut'), edge('coconut', 'husked')],
    );

    expect(xOf(result, 'beach')).toBeLessThan(xOf(result, 'coconut'));
    expect(xOf(result, 'coconut')).toBeLessThan(xOf(result, 'husked'));
    expect(result.backEdgeIndexes.size).toBe(0);
  });

  it('合流するノードは、すべての入力より右に置かれる（最長経路の層）', () => {
    // stone → sharp_stone → craft ← beach（beachからcraftへは1歩、stone経由は2歩）。
    const result = layoutLayered(
      [node('stone'), node('sharp'), node('craft'), node('beach')],
      [edge('stone', 'sharp'), edge('sharp', 'craft'), edge('beach', 'craft')],
    );

    expect(xOf(result, 'craft')).toBeGreaterThan(xOf(result, 'sharp'));
    expect(xOf(result, 'craft')).toBeGreaterThan(xOf(result, 'beach'));
  });

  it('ループは戻り辺として切られ、残りは左から右になる', () => {
    const result = layoutLayered(
      [node('a'), node('b'), node('c')],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );

    expect([...result.backEdgeIndexes]).toEqual([2]);
    expect(xOf(result, 'a')).toBeLessThan(xOf(result, 'b'));
    expect(xOf(result, 'b')).toBeLessThan(xOf(result, 'c'));
  });

  it('全ノードが図の中に収まり、重ならない', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d'), node('e')];
    const result = layoutLayered(nodes, [edge('a', 'c'), edge('b', 'c'), edge('c', 'd'), edge('c', 'e')]);

    for (const { id, width, height } of nodes) {
      const position = result.positions.get(id)!;
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.x + width).toBeLessThanOrEqual(result.width);
      expect(position.y + height).toBeLessThanOrEqual(result.height);
    }

    // 同じ列（b, d/eの列）のノードが縦に重ならない。
    const b = result.positions.get('d')!;
    const e = result.positions.get('e')!;
    expect(Math.abs(b.y - e.y)).toBeGreaterThanOrEqual(50);
  });

  it('繋がりのあるノードは上下位置が概ね揃う', () => {
    // 層0にa,b,cが縦に積まれ、層1にsinkとd。dはc（層0の一番下）としか繋がっていないので、
    // 層の先頭や中央ではなくcの高さへ寄るべき（sinkはa,bの間に寄る）。
    const result = layoutLayered(
      [node('a'), node('b'), node('c'), node('d'), node('sink')],
      [edge('a', 'sink'), edge('b', 'sink'), edge('c', 'd')],
    );

    const centerOf = (id: string): number => result.positions.get(id)!.y + 25;
    expect(Math.abs(centerOf('d') - centerOf('c'))).toBeLessThan(10);
    expect(Math.abs(centerOf('sink') - (centerOf('a') + centerOf('b')) / 2)).toBeLessThan(10);
  });

  it('同じ入力からは同じ結果が返る（決定性）', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')];

    const first = layoutLayered(nodes, edges);
    const second = layoutLayered(nodes, edges);
    expect([...first.positions.entries()]).toEqual([...second.positions.entries()]);
  });
});
