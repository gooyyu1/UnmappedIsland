import { describe, expect, it } from 'vitest';
import { scrollThumbSpan } from '../../src/game/ui/scroll';

describe('scrollThumbSpan', () => {
  it('中身が可視域に収まるとトラック全体を占める', () => {
    expect(scrollThumbSpan(600, 0, 0, 40)).toEqual({ x: 0, width: 600 });
  });

  it('つまみの長さは中身に対する可視域の割合になる', () => {
    expect(scrollThumbSpan(600, 0, -600, 40).width).toBe(300);
  });

  it('左端では0、右端ではトラックの右端につまみが着く', () => {
    expect(scrollThumbSpan(600, 0, -600, 40).x).toBe(0);
    expect(scrollThumbSpan(600, -600, -600, 40).x).toBe(300);
  });

  it('つまみの位置は送り具合に比例する', () => {
    expect(scrollThumbSpan(600, -300, -600, 40).x).toBe(150);
  });

  it('中身が長くてもつまみは最小の長さより短くならない', () => {
    const span = scrollThumbSpan(600, -11400, -11400, 40);
    expect(span.width).toBe(40);
    expect(span.x).toBe(560);
  });

  it('可動範囲を外れた送り量は両端へ丸める', () => {
    expect(scrollThumbSpan(600, 60, -600, 40).x).toBe(0);
    expect(scrollThumbSpan(600, -660, -600, 40).x).toBe(300);
  });
});
