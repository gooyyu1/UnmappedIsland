import { describe, expect, it } from 'vitest';
import type { MotionInput, PlacedCard } from '../../src/game/view/cardMotionPlan';
import { planMotion } from '../../src/game/view/cardMotionPlan';

// カードの実体も枠の矩形も計画には見えない（総称CとR）ので、テストでは名前の文字列と
// 位置を表すだけの数で代用する。数で書けること自体が「計画は座標を読まない」の確認になる。

function placed(card: string, ids: readonly number[], at: number): PlacedCard<string, number> {
  return { card, ids, rect: at };
}

function input(partial: Partial<MotionInput<string, number>>): MotionInput<string, number> {
  return { before: [], arriving: [], staying: [], left: [], ...partial };
}

/** 挙げたインスタンス全部が、同じ場所から飛び立つ場合の出どころ。 */
function origins(ids: readonly number[], at: number): ReadonlyMap<number, number> {
  return new Map(ids.map((id) => [id, at]));
}

describe('planMotion（CardInteraction.md 6節 カードの移動アニメーション）', () => {
  it('何も動いていなければ、何も起きない', () => {
    const plan = planMotion(input({ before: [placed('石', [1, 2], 0)], staying: [placed('石', [1, 2], 0)] }));
    expect(plan.flights).toEqual([]);
    expect(plan.fadeIns).toEqual([]);
    expect(plan.discards).toEqual([]);
    // 宙に在る札は無いので、2個ともその枠に居る。
    expect(plan.shown).toEqual([{ card: '石', present: [1, 2], emptied: true }]);
  });

  it('3個まとめて生まれた束は、1枚に見えても3枚が順に飛ぶ', () => {
    const plan = planMotion(
      input({ arriving: [placed('実', [1, 2, 3], 500)], origins: origins([1, 2, 3], 0) }),
    );

    // 3個とも宙に在るので、着き始めるまで札は出ない。
    expect(plan.shown).toEqual([{ card: '実', present: [], emptied: false }]);
    expect(plan.flights).toHaveLength(3);
    expect(plan.flights.map((flight) => flight.delaySteps)).toEqual([0, 1, 2]);
    for (const flight of plan.flights) {
      expect(flight.from).toEqual(0);
      expect(flight.to).toEqual(500);
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
    expect(plan.flights[0]).toMatchObject({ into: '地の石', from: 0, to: 500 });
    // 飛んでいる1個は着くまで合流先に居ない（3個のうち2個だけが見えている）。
    expect(plan.shown).toContainEqual({ card: '地の石', present: [3], emptied: true });
    expect(plan.shown).toContainEqual({ card: '手の石', present: [1], emptied: true });
  });

  it('掴んで離したインスタンスは、指を離した場所から動き出す', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1], 0)],
        staying: [placed('地の石', [1, 2], 500)],
        left: [{ card: '石', ids: [1] }],
        released: { ids: [1], rect: 300 },
      }),
    );

    const flight = plan.flights.find((f) => f.from === 300);
    expect(flight).toMatchObject({ to: 500, into: '地の石' });
  });

  it('ついてきて一緒に落とされたぶんも、指を離した場所から動き出す', () => {
    const plan = planMotion(
      input({
        before: [placed('地の石', [1, 2, 3], 0), placed('手の石', [4], 500)],
        staying: [placed('手の石', [1, 2, 4], 500)],
        left: [],
        released: { ids: [1, 2], rect: 300 },
      }),
    );

    // 2枚とも離した場所から。元の枠（位置0）からは飛ばない。
    expect(plan.flights).toHaveLength(2);
    expect(plan.flights.map((flight) => flight.from)).toEqual([300, 300]);
    expect(plan.flights.map((flight) => flight.delaySteps)).toEqual([0, 1]);
  });

  it('掴んで離したまま残ったカードは、束の残りが元の枠から、離した1つが指の位置から飛ぶ', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1, 2, 3], 0)],
        arriving: [placed('石', [1, 2, 3], 500)],
        released: { ids: [1], rect: 300 },
      }),
    );

    expect(plan.shown).toEqual([{ card: '石', present: [], emptied: false }]);
    expect(plan.flights.map((flight) => flight.from).sort((a, b) => a - b)).toEqual([0, 0, 300]);
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
      // 便の見た目は行き先のカードから借りる（居なくなったカードは既に無いものとして扱う）。
      expect(flight).toMatchObject({ into: '手の石', from: 0, to: 500 });
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

  it('置いたままの札が運ぶインスタンスは、通常の便にせず着地先だけを返す', () => {
    const plan = planMotion(
      input({
        before: [placed('包帯', [1], 0)],
        arriving: [placed('包帯', [1], 500)],
        aloft: [1],
      }),
    );

    expect(plan.landings.get(1)).toEqual({ to: 500, into: '包帯' });
    expect(plan.flights).toEqual([]);
    // 運んでいるのは置いたままの札なので、その1枚もまだ枠に居ない（フェードにもしない）。
    expect(plan.shown).toEqual([{ card: '包帯', present: [], emptied: false }]);
    expect(plan.fadeIns).toEqual([]);
  });

  it('置いたままの札が運ぶインスタンスは、releasedに混ざっていても便にならない', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1, 2], 0)],
        arriving: [placed('石', [1, 2], 500)],
        released: { ids: [1, 2], rect: 300 },
        aloft: [1],
      }),
    );

    // 掴んでいた1つ（aloft）は置いたままの札の着地で、ついてきた1つだけが離した場所からの便で動く。
    expect(plan.landings.get(1)).toEqual({ to: 500, into: '石' });
    expect(plan.flights).toHaveLength(1);
    expect(plan.flights[0].from).toEqual(300);
  });

  it('置いたままの札が運ぶ1枚は、束の残りから引いて見せる', () => {
    const plan = planMotion(
      input({
        before: [placed('枯れ草', [1, 2, 3], 0)],
        staying: [placed('枯れ草', [1, 2, 3], 0)],
        aloft: [1],
      }),
    );

    // 手に在る1枚は束に居ない。掴んで運んでいる間の見え方（CarriedCard）がそのまま続く。
    expect(plan.shown).toEqual([{ card: '枯れ草', present: [2, 3], emptied: true }]);
    expect(plan.flights).toEqual([]);
  });

  it('1つしか映していないカードを置いたままにすると、枠には帰ってくる場所の印が残る', () => {
    const plan = planMotion(
      input({ before: [placed('枯れ草', [1], 0)], staying: [placed('枯れ草', [1], 0)], aloft: [1] }),
    );

    expect(plan.shown).toEqual([{ card: '枯れ草', present: [], emptied: true }]);
  });

  it('子ウィンドウへ貸した1枚は束から引かれ、残りはその枠に居たまま（Windows.md 1.1節）', () => {
    const plan = planMotion(
      input({ before: [placed('石', [1, 2], 0)], staying: [placed('石', [1, 2], 0)], aloft: [1] }),
    );

    expect(plan.shown).toEqual([{ card: '石', present: [2], emptied: true }]);
    expect(plan.flights).toEqual([]);
    // 帰り先はいつでも答える（返すかどうかを決めるのは借りた側）。
    expect(plan.landings.get(1)).toEqual({ to: 0, into: '石' });
    expect(plan.landings.get(2)).toBeUndefined();
  });

  it('持ち出されている札が複数あっても、それぞれの帰り先を答える', () => {
    const plan = planMotion(
      input({
        before: [placed('石', [1], 0), placed('枝', [2], 100)],
        staying: [placed('石', [1], 0), placed('枝', [2], 100)],
        aloft: [1, 2],
      }),
    );

    expect(plan.shown).toEqual([
      { card: '石', present: [], emptied: true },
      { card: '枝', present: [], emptied: true },
    ]);
    expect(plan.landings.get(1)).toEqual({ to: 0, into: '石' });
    expect(plan.landings.get(2)).toEqual({ to: 100, into: '枝' });
  });

  it('置いたままの札のインスタンスが失われていれば、着地先は無い', () => {
    const plan = planMotion(
      input({
        before: [placed('包帯', [1], 0)],
        left: [{ card: '包帯', ids: [1] }],
        aloft: [1],
      }),
    );
    expect(plan.landings.get(1)).toBeUndefined();
    expect(plan.discards).toEqual(['包帯']);
  });

  it('出どころの分からないカードは、その場で浮かび上がる', () => {
    const plan = planMotion(input({ arriving: [placed('実', [1], 500)] }));
    expect(plan.fadeIns).toEqual(['実']);
    expect(plan.flights).toEqual([]);
    // 運ばれてくるものが無いので、その場に1個居るものとして浮かび上がる。
    expect(plan.shown).toEqual([{ card: '実', present: [1], emptied: false }]);
  });

  it('同じ差し替えで生まれても、出どころが違えばそれぞれの出どころから飛ぶ', () => {
    // 出どころは呼び出し側が1つ渡すのではなく、世界に起きた変化が個体ごとに答える
    // （HuntingSystem.md 6.2節）。同じtickに2匹が別々の物を落としても取り違えない。
    const plan = planMotion(
      input({
        arriving: [placed('実', [1], 500), placed('枝', [2], 600)],
        origins: new Map([
          [1, 0],
          [2, 100],
        ]),
      }),
    );

    expect(plan.flights.map((flight) => flight.from)).toEqual([0, 100]);
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
    expect(plan.flights[0]).toMatchObject({ into: '実', from: 0, to: 500 });
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
      expect(plan.puffs).toEqual([0]);
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
      expect(plan.flights.map((flight) => flight.raisesDust)).toEqual([false]);
    });

    it('束が丸ごと消えても、砂埃は札1枚につき1回', () => {
      const plan = planMotion(
        input({
          before: [placed('実', [1, 2, 3], 0)],
          left: [{ card: '実', ids: [1, 2, 3] }],
          vanished: [1, 2, 3],
        }),
      );
      expect(plan.puffs).toEqual([0]);
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
      expect(plan.flights.map((flight) => flight.raisesDust)).toEqual([true]);
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

      expect(plan.flights.map((flight) => flight.raisesDust)).toEqual([true]);
    });

    it('出どころの分からない生まれは、浮かび上がるその場で立つ', () => {
      const plan = planMotion(input({ arriving: [placed('実', [1], 500)], born: [1] }));

      expect(plan.fadeIns).toEqual(['実']);
      expect(plan.puffs).toEqual([500]);
    });
  });

  describe('突進（HuntingSystem.md 6.1節）', () => {
    /** 獣が、地面の籠へ手を出した回。壊した回ならvanishedに籠が挙がる。 */
    function raid(vanished: readonly number[]) {
      return planMotion(
        input({
          before: [placed('獣', [1], 0), placed('籠', [2], 500)],
          staying: [placed('獣', [1], 0)],
          left: [{ card: '籠', ids: [2] }],
          lunges: new Map([[1, 2]]),
          vanished,
        }),
      );
    }

    it('突進は、主体の札が相手の枠まで行って自分の枠へ帰る', () => {
      expect(raid([2]).lunges).toEqual([
        { id: 1, into: '獣', home: 0, from: 0, to: 500, struck: '籠', raisesDust: true },
      ]);
    });

    it('その手番に現れた個体は、出どころから駆け出す（元の枠は画面のどこにも無い）', () => {
      // 探索で出くわしたその回に足元の物をくわえたサルがこれ。
      const plan = planMotion(
        input({
          before: [placed('籠', [2], 500)],
          arriving: [placed('獣', [1], 0)],
          left: [{ card: '籠', ids: [2] }],
          origins: origins([1], 900),
          born: [1],
          lunges: new Map([[1, 2]]),
        }),
      );

      expect(plan.lunges[0]).toMatchObject({ from: 900, to: 500, home: 0 });
      // 突進が運ぶので、現れた分の便は立たない。
      expect(plan.flights).toEqual([]);
    });

    it('突進している個体は、行って帰るまで自分の枠に居ない', () => {
      // 便・置いたままの札と同じ引き算。帰ってくる枠なので印は残る。
      expect(raid([2]).shown).toEqual([{ card: '獣', present: [], emptied: true }]);
    });

    it('突き当たられた札は、突進が着くまで片付けない', () => {
      const plan = raid([2]);
      expect(plan.discards).toEqual([]);
      expect(plan.lunges[0].struck).toBe('籠');
    });

    it('壊された相手の砂埃は、突き当たってから立つ', () => {
      const plan = raid([2]);
      expect(plan.puffs).toEqual([]);
      expect(plan.lunges[0].raisesDust).toBe(true);
    });

    it('持ち去られただけの相手では、砂埃は立たない', () => {
      const plan = raid([]);
      expect(plan.puffs).toEqual([]);
      expect(plan.lunges[0].raisesDust).toBe(false);
    });

    it('束の一部だけを持ち去られた札はその場に残るので、突進が片付けるものは無い', () => {
      const plan = planMotion(
        input({
          before: [placed('獣', [1], 0), placed('実', [2, 3], 500)],
          staying: [placed('獣', [1], 0), placed('実', [3], 500)],
          lunges: new Map([[1, 2]]),
        }),
      );

      expect(plan.lunges[0]).toMatchObject({ to: 500, struck: undefined });
    });

    it('指が放した物へは突進しない（その動きは指が見せている）', () => {
      // 重ねた道具を使い切る操作がこれ。宣言している側の札が、手を離した位置へ飛びかかって見える。
      const plan = planMotion(
        input({
          before: [placed('火口', [1], 0), placed('枝', [2], 500)],
          staying: [placed('火口', [1], 0)],
          left: [{ card: '枝', ids: [2] }],
          released: { ids: [2], rect: 300 },
          lunges: new Map([[1, 2]]),
          vanished: [2],
        }),
      );

      expect(plan.lunges).toEqual([]);
      // 突進が引き取らないので、砂埃も片付けも普段どおり即座に。
      expect(plan.puffs).toEqual([500]);
      expect(plan.discards).toEqual(['枝']);
    });

    it('既に突進している個体には、二重に立てない', () => {
      const plan = planMotion(
        input({
          before: [placed('獣', [1], 0), placed('籠', [2], 500)],
          staying: [placed('獣', [1], 0)],
          left: [{ card: '籠', ids: [2] }],
          aloft: [1],
          lunges: new Map([[1, 2]]),
        }),
      );

      expect(plan.lunges).toEqual([]);
    });

    it('相手が画面に出ていなければ、突き当たる先が無い', () => {
      const plan = planMotion(
        input({
          before: [placed('獣', [1], 0)],
          staying: [placed('獣', [1], 0)],
          lunges: new Map([[1, 2]]),
        }),
      );

      expect(plan.lunges).toEqual([]);
      expect(plan.shown).toEqual([{ card: '獣', present: [1], emptied: true }]);
    });

    it('主体の札が枠から居なくなっていれば、帰る先が無いので突進しない', () => {
      // 手を出した直後に自分も別の土地へ移った回。札はレーンから消えるだけになる。
      const plan = planMotion(
        input({
          before: [placed('獣', [1], 0), placed('籠', [2], 500)],
          left: [
            { card: '獣', ids: [1] },
            { card: '籠', ids: [2] },
          ],
          lunges: new Map([[1, 2]]),
        }),
      );

      expect(plan.lunges).toEqual([]);
      expect(plan.discards).toEqual(['獣', '籠']);
    });
  });
});
