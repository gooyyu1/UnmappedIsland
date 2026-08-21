import { describe, expect, it } from 'vitest';
import { heatHazeFor } from '../../src/game/looks/heatHaze';

/**
 * 気温に応じて地面を歪ませる陽炎（ScreenLayout.md 7.5節 空の演出）。
 *
 * **気温がどこから来るかは見ない**——その気温の日が実際に来るかは世界側の宣言の話で、
 * 噛み合わせはtests/integration/skyOverBundledClimate.test.tsが見る。
 */
describe('heatHaze(気温に応じた陽炎)', () => {
  const strengthAt = (temperature: number): number => heatHazeFor(temperature)?.strength ?? 0;

  it('涼しければ立たない', () => {
    expect(heatHazeFor(26)).toBeUndefined();
    expect(heatHazeFor(20)).toBeUndefined();
  });

  it('気温が分からないCodexでは立たない', () => {
    expect(heatHazeFor(undefined)).toBeUndefined();
  });

  it('立ち始めでも、消えるほど弱くはしない', () => {
    expect(strengthAt(27)).toBeGreaterThan(0);
  });

  it('暑いほど強く歪む', () => {
    expect(strengthAt(29)).toBeGreaterThan(strengthAt(27));
    expect(strengthAt(31)).toBeGreaterThan(strengthAt(29));
  });

  it('取りうる最大より暑くても、歪みは頭打ちになる', () => {
    expect(strengthAt(40)).toBe(strengthAt(31));
  });

  it('陽炎と分かる程度に留め、描画の壊れには見せない', () => {
    for (let temperature = 27; temperature <= 45; temperature++)
      expect(strengthAt(temperature), `${temperature}度`).toBeLessThan(0.1);
  });
});
