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

/** 挙げたインスタンス全部が、同じ場所から飛び立つ場合の出どころ。 */
function origins(ids: readonly number[], x: number): ReadonlyMap<number, Rect> {
  return new Map(ids.map((id) => [id, rect(x)]));
}

describe('planMotion（CardInteraction.md 6節 カードの移動アニメーション）', () => {
  it('何も動いていなければ、何も起きない', () => {
    const plan = planMotion(input({ before: [placed('石', [1, 2], 0)], staying: [placed('石', [1, 2], 0)] }));
    expect(plan.flights).toEqual([]);
    expect(plan.fadeIns).toEqual([]);
    expect(plan.discards).toEqual([]);
    // 宙に在る札は無いので、2個ともその枠に居る。
    expect(plan.shown).toEqual([{ card: '石', remaining: 2, emptied: true }]);
  });

  it('3個まとめて生まれた束は、1枚に見えても3枚が順に飛ぶ', () => {
    const plan = planMotion(
      input({ arriving: [placed('実', [1, 2, 3], 500)], origins: origins([1, 2, 3], 0) }),
    );

    // 3個とも宙に在るので、着き始めるまで札は出ない。
    expect(plan.shown).toEqual([{ card: '実', remaining: 0, emptied: false }]);
    expect(plan.flights).toHaveLength(3);
    expect(plan.flights.map((flight) => flight.delaySteps)).toEqual([0, 1, 2]);
    for (const flight of plan.flights) {
      expect(flight.from).toEqual(rect(0));
      expect(flight.to).toEqual(rect(500));
      expect(flight.into).toBe('実');
    }
  });

  it('生まれた順の通し番号は、別々のカードとして生まれても重ならない', () => {
    const plan = planMotion(
      input({
        arriving: [placed('実', [1], 500), placed('枝', [2], 600)],
        origins: origins([1, 2], 0),
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
    expect(plan.flights[0]).toMatchObject({ face: '地の石', into: '地の石', from: rect(0), to: rect(500) });
    // 飛んでいる1個は着くまで合流先に居ない（3個のうち2個だけが見えている）。
    expect(plan.shown).toContainEqual({ card: '地の石', remaining: 1, emptied: true });
    expect(plan.shown).toContainEqual({ card: '手の石', remaining: 1, emptied: true });
  });

  it('掴んで離したインスタンスは、指を離した場所から動き出す', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1], 0)],
        staying: [placed('地の石', [1, 2], 500)],
        left: [{ card: '石', ids: [1] }],
        released: { ids: [1], rect: rect(300) },
      }),
    );

    const flight = plan.flights.find((f) => f.from.x === 300);
    expect(flight).toMatchObject({ to: rect(500), face: '地の石' });
  });

  it('ついてきて一緒に落とされたぶんも、指を離した場所から動き出す', () => {
    const plan = planMotion(
      input({
        before: [placed('地の石', [1, 2, 3], 0), placed('手の石', [4], 500)],
        staying: [placed('手の石', [1, 2, 4], 500)],
        left: [],
        released: { ids: [1, 2], rect: rect(300) },
      }),
    );

    // 2枚とも離した場所から。元の枠（x=0）からは飛ばない。
    expect(plan.flights).toHaveLength(2);
    expect(plan.flights.map((flight) => flight.from.x)).toEqual([300, 300]);
    expect(plan.flights.map((flight) => flight.delaySteps)).toEqual([0, 1]);
  });

  it('掴んで離したまま残ったカードは、束の残りが元の枠から、離した1つが指の位置から飛ぶ', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1, 2, 3], 0)],
        arriving: [placed('石', [1, 2, 3], 500)],
        released: { ids: [1], rect: rect(300) },
      }),
    );

    expect(plan.shown).toEqual([{ card: '石', remaining: 0, emptied: false }]);
    expect(plan.flights.map((flight) => flight.from.x).sort((a, b) => a - b)).toEqual([0, 0, 300]);
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

    expect(plan.landing).toEqual({ to: rect(500), into: '包帯' });
    expect(plan.flights).toEqual([]);
    // 運んでいるのは置いたままの分身なので、その1枚もまだ枠に居ない（フェードにもしない）。
    expect(plan.shown).toEqual([{ card: '包帯', remaining: 0, emptied: false }]);
    expect(plan.fadeIns).toEqual([]);
  });

  it('置いたままの分身が運ぶインスタンスは、releasedに混ざっていても便にならない', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1, 2], 0)],
        arriving: [placed('石', [1, 2], 500)],
        released: { ids: [1, 2], rect: rect(300) },
        heldId: 1,
      }),
    );

    // 掴んでいた1つ（heldId）は分身の着地で、ついてきた1つだけが離した場所からの便で動く。
    expect(plan.landing).toEqual({ to: rect(500), into: '石' });
    expect(plan.flights).toHaveLength(1);
    expect(plan.flights[0].from).toEqual(rect(300));
  });

  it('置いたままの分身が運ぶ1枚は、束の残りから引いて見せる', () => {
    const plan = planMotion(
      input({
        before: [placed('枯れ草', [1, 2, 3], 0)],
        staying: [placed('枯れ草', [1, 2, 3], 0)],
        heldId: 1,
      }),
    );

    // 手に在る1枚は束に居ない。掴んで運んでいる間の見え方（CarriedCards）がそのまま続く。
    expect(plan.shown).toEqual([{ card: '枯れ草', remaining: 2, emptied: true }]);
    expect(plan.flights).toEqual([]);
  });

  it('1つしか映していないカードを置いたままにすると、枠には帰ってくる場所の印が残る', () => {
    const plan = planMotion(
      input({ before: [placed('枯れ草', [1], 0)], staying: [placed('枯れ草', [1], 0)], heldId: 1 }),
    );

    expect(plan.shown).toEqual([{ card: '枯れ草', remaining: 0, emptied: true }]);
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
    // 運ばれてくるものが無いので、その場に1個居るものとして浮かび上がる。
    expect(plan.shown).toEqual([{ card: '実', remaining: 1, emptied: false }]);
  });

  it('同じ差し替えで生まれても、出どころが違えばそれぞれの出どころから飛ぶ', () => {
    // 出どころは呼び出し側が1つ渡すのではなく、世界に起きた変化が個体ごとに答える
    // （HuntingSystem.md 6.2節）。同じtickに2匹が別々の物を落としても取り違えない。
    const plan = planMotion(
      input({
        arriving: [placed('実', [1], 500), placed('枝', [2], 600)],
        origins: new Map([
          [1, rect(0)],
          [2, rect(100)],
        ]),
      }),
    );

    expect(plan.flights.map((flight) => flight.from.x)).toEqual([0, 100]);
  });

  it('出どころを持たないインスタンスだけが、その場で浮かび上がる', () => {
    const plan = planMotion(
      input({
        arriving: [placed('実', [1], 500), placed('枝', [2], 600)],
        origins: origins([1], 0),
      }),
    );

    expect(plan.fadeIns).toEqual(['枝']);
    expect(plan.flights).toHaveLength(1);
    expect(plan.flights[0]).toMatchObject({ face: '実', from: rect(0), to: rect(500) });
  });

  it('identityを持たないカードは、出どころを引く手がかりが無いので浮かび上がる', () => {
    const plan = planMotion(input({ arriving: [placed('見つけた物', [], 500)], origins: origins([1], 0) }));
    expect(plan.fadeIns).toEqual(['見つけた物']);
    expect(plan.flights).toEqual([]);
  });

  describe('砂埃（6.1節）', () => {
    it('世界から出たインスタンスは、居た枠で砂埃が立つ', () => {
      const plan = planMotion(
        input({
          before: [placed('実', [1], 0)],
          left: [{ card: '実', ids: [1] }],
          vanished: [1],
        }),
      );
      expect(plan.puffs).toEqual([rect(0)]);
    });

    it('レーンを移っただけの札では立たない', () => {
      // 居なくなったカード（left）は壊れた札と移った札の両方を含むので、これだけでは決められない。
      const plan = planMotion(
        input({
          before: [placed('地の石', [1], 0)],
          arriving: [placed('手の石', [1], 500)],
          left: [{ card: '地の石', ids: [1] }],
        }),
      );
      expect(plan.puffs).toEqual([]);
      expect(plan.flights.map((flight) => flight.puffs)).toEqual([false]);
    });

    it('束が丸ごと消えても、砂埃は札1枚につき1回', () => {
      const plan = planMotion(
        input({
          before: [placed('実', [1, 2, 3], 0)],
          left: [{ card: '実', ids: [1, 2, 3] }],
          vanished: [1, 2, 3],
        }),
      );
      expect(plan.puffs).toEqual([rect(0)]);
    });

    it('画面に出ていなかった物が壊れても、立てる場所が無い', () => {
      // 閉じた入れ物の中や未発見のスロットで壊れた物。枠を持たないので何も起きない。
      const plan = planMotion(input({ vanished: [7] }));
      expect(plan.puffs).toEqual([]);
    });

    it('生まれたインスタンスの砂埃は、その便が着いてから立つ', () => {
      const plan = planMotion(
        input({ arriving: [placed('実', [1], 500)], origins: origins([1], 0), born: [1] }),
      );

      expect(plan.puffs).toEqual([]);
      expect(plan.flights.map((flight) => flight.puffs)).toEqual([true]);
    });

    it('既に居る束へ合流する生まれも、着いた先で立つ', () => {
      const plan = planMotion(
        input({
          before: [placed('実', [1], 500)],
          staying: [placed('実', [1, 2], 500)],
          origins: origins([2], 0),
          born: [2],
        }),
      );

      expect(plan.flights.map((flight) => flight.puffs)).toEqual([true]);
    });

    it('出どころの分からない生まれは、浮かび上がるその場で立つ', () => {
      const plan = planMotion(input({ arriving: [placed('実', [1], 500)], born: [1] }));

      expect(plan.fadeIns).toEqual(['実']);
      expect(plan.puffs).toEqual([rect(500)]);
    });
  });
});
