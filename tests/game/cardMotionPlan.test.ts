import { describe, expect, it } from 'vitest';
import type { MotionInput, PlacedCard } from '../../src/game/ui/cardMotionPlan';
import { planMotion } from '../../src/game/ui/cardMotionPlan';
import type { Rect } from '../../src/game/layout/ScreenMetrics';

// カードの実体は計画には見えないので、テストでは名前の文字列で代用する。

function rect(x: number): Rect {
  return { x, y: 0, width: 90, height: 140 };
}

function placed(card: string, ids: readonly number[], x: number): PlacedCard<string> {
  return { card, ids, rect: rect(x) };
}

function input(partial: Partial<MotionInput<string>>): MotionInput<string> {
  return { before: [], arriving: [], staying: [], left: [], ...partial };
}

describe('planMotion（ScreenLayout.md カードの移動アニメーション節）', () => {
  it('何も動いていなければ、何も起きない', () => {
    const plan = planMotion(input({ before: [placed('石', [1, 2], 0)], staying: [placed('石', [1, 2], 0)] }));
    expect(plan.flights).toEqual([]);
    expect(plan.hidden).toEqual([]);
    expect(plan.fadeIns).toEqual([]);
    expect(plan.discards).toEqual([]);
  });

  it('3個まとめて生まれた束は、1枚に見えても3枚が順に飛ぶ', () => {
    const plan = planMotion(input({ arriving: [placed('実', [1, 2, 3], 500)], origin: rect(0) }));

    expect(plan.hidden).toEqual(['実']);
    expect(plan.flights).toHaveLength(3);
    expect(plan.flights.map((flight) => flight.delaySteps)).toEqual([0, 1, 2]);
    for (const flight of plan.flights) {
      expect(flight.from).toEqual(rect(0));
      expect(flight.to).toEqual(rect(500));
    }
    // 表に返すのは最後に着く1枚だけ。
    expect(plan.flights.map((flight) => flight.reveals)).toEqual([undefined, undefined, '実']);
  });

  it('生まれた順の通し番号は、別々のカードとして生まれても重ならない', () => {
    const plan = planMotion(
      input({
        arriving: [placed('実', [1], 500), placed('枝', [2], 600)],
        origin: rect(0),
      }),
    );
    expect(plan.flights.map((flight) => flight.delaySteps)).toEqual([0, 1]);
  });

  it('居続けるカードの間でインスタンスが移れば、その1つぶんだけが飛ぶ', () => {
    const plan = planMotion(
      input({
        before: [placed('手の石', [1, 2], 0), placed('地の石', [3], 500)],
        staying: [placed('手の石', [1], 0), placed('地の石', [2, 3], 500)],
      }),
    );

    expect(plan.flights).toHaveLength(1);
    expect(plan.flights[0]).toMatchObject({ face: '地の石', from: rect(0), to: rect(500) });
    // 合流先は見えているカードなので、表に返す相手は無い。
    expect(plan.flights[0].reveals).toBeUndefined();
    expect(plan.hidden).toEqual([]);
  });

  it('掴んで離したインスタンスは、指を離した場所から動き出す', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1], 0)],
        staying: [placed('地の石', [1, 2], 500)],
        left: [{ card: '石', ids: [1] }],
        released: { id: 1, rect: rect(300) },
      }),
    );

    const flight = plan.flights.find((f) => f.from.x === 300);
    expect(flight).toMatchObject({ to: rect(500), face: '地の石' });
  });

  it('掴んで離したまま残ったカードは、束の残りが元の枠から、離した1つが指の位置から飛ぶ', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1, 2, 3], 0)],
        arriving: [placed('石', [1, 2, 3], 500)],
        released: { id: 1, rect: rect(300) },
      }),
    );

    expect(plan.hidden).toEqual(['石']);
    expect(plan.flights.map((flight) => flight.from.x).sort((a, b) => a - b)).toEqual([0, 0, 300]);
    expect(plan.flights.filter((flight) => flight.reveals === '石')).toHaveLength(1);
  });

  it('束ごと居なくなって他の束へ合流したぶんは、中身の数だけ飛び、カードは即座に片付く', () => {
    const plan = planMotion(
      input({
        before: [placed('地の石', [1, 2], 0), placed('手の石', [3], 500)],
        staying: [placed('手の石', [1, 2, 3], 500)],
        left: [{ card: '地の石', ids: [1, 2] }],
      }),
    );

    expect(plan.discards).toEqual(['地の石']);
    expect(plan.flights).toHaveLength(2);
    expect(plan.flights.map((flight) => flight.delaySteps)).toEqual([0, 1]);
    for (const flight of plan.flights) {
      // 分身の見た目は行き先のカードから借りる（居なくなったカードは既に無いものとして扱う）。
      expect(flight).toMatchObject({ face: '手の石', from: rect(0), to: rect(500) });
    }
  });

  it('世界から消えたカードは飛ばず、その場で片付く', () => {
    const plan = planMotion(
      input({
        before: [placed('実', [1], 0)],
        left: [{ card: '実', ids: [1] }],
      }),
    );
    expect(plan.discards).toEqual(['実']);
    expect(plan.flights).toEqual([]);
  });

  it('居なくなったカードのインスタンスを現れたカードが引き継いでも、便は1つずつしか立たない', () => {
    const plan = planMotion(
      input({
        before: [placed('地の石', [1, 2], 0)],
        arriving: [placed('手の石', [1, 2], 500)],
        left: [{ card: '地の石', ids: [1, 2] }],
      }),
    );

    // 2インスタンスで2便。左右どちらの経路でも二重には飛ばない。
    expect(plan.flights).toHaveLength(2);
    expect(plan.discards).toEqual(['地の石']);
  });

  it('置いたままの分身が運ぶインスタンスは、通常の便にせず着地先だけを返す', () => {
    const plan = planMotion(
      input({
        before: [placed('包帯', [1], 0)],
        arriving: [placed('包帯', [1], 500)],
        heldId: 1,
      }),
    );

    expect(plan.landing).toEqual({ to: rect(500), reveals: '包帯' });
    expect(plan.flights).toEqual([]);
    // 表に返すのは分身の着地なので、フェードにも伏せにもしない。
    expect(plan.fadeIns).toEqual([]);
  });

  it('置いたままの分身のインスタンスが失われていれば、着地先は無い', () => {
    const plan = planMotion(
      input({
        before: [placed('包帯', [1], 0)],
        left: [{ card: '包帯', ids: [1] }],
        heldId: 1,
      }),
    );
    expect(plan.landing).toBeUndefined();
    expect(plan.discards).toEqual(['包帯']);
  });

  it('出どころの分からないカードは、その場で浮かび上がる', () => {
    const plan = planMotion(input({ arriving: [placed('実', [1], 500)] }));
    expect(plan.fadeIns).toEqual(['実']);
    expect(plan.flights).toEqual([]);
    expect(plan.hidden).toEqual([]);
  });

  it('identityを持たないカードは、1枚として出どころから飛ぶ', () => {
    const plan = planMotion(input({ arriving: [placed('見つけた物', [], 500)], origin: rect(0) }));
    expect(plan.flights).toHaveLength(1);
    expect(plan.flights[0]).toMatchObject({ from: rect(0), to: rect(500), reveals: '見つけた物' });
  });
});
