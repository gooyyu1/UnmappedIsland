import { describe, expect, it } from 'vitest';
import { clampScroll, minScrollFor, scrollThumbSpan } from '../../src/ui/scroll';

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

/**
 * 送り量の約束（ScrollArea）。**0が先頭で、送るほど負**——中身を負の向きへずらして見せるので、
 * 送り量はそのまま中身の位置の差になる。
 */
describe('送れる範囲', () => {
  it('中身が可視域に収まるなら送らない', () => {
    expect(minScrollFor(400, 300)).toBe(0);
    expect(minScrollFor(400, 400), 'ちょうど収まる場合も').toBe(0);
  });

  it('はみ出した分だけ送れる', () => {
    expect(minScrollFor(400, 1000)).toBe(-600);
  });

  it('送り過ぎも戻し過ぎも、範囲の端で止まる', () => {
    expect(clampScroll(-999, -600), '送り過ぎ').toBe(-600);
    expect(clampScroll(50, -600), '先頭より手前へは戻らない').toBe(0);
    expect(clampScroll(-100, -600), '範囲の中はそのまま').toBe(-100);
  });

  it('送る先が無ければ、どこへ動かしても先頭のまま', () => {
    expect(clampScroll(-100, 0)).toBe(0);
  });
});
