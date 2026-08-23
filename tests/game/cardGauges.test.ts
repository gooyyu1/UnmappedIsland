import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { CardGauge } from '../../src/game/ui/Card';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import { parseLocale } from '../../src/locale/Localization';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * カードの下端に積むバー（CardView.md 8節）の自動テスト。
 *
 * 見るのは**どのカードがどのバーを出し、両端をどちら向きに見せるか**だけ。割合そのものの計算は
 * 世界側（PropertyValue.ratio・fullestSlotFillRatio）が受け持つ。
 */
describe('カードのバー', () => {
  const locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');

  /**
   * 器・入れ物・怪我・炉——バーの出どころが違う型を一通り。**どれも「その宣言を持つか」だけで
   * バーが決まる**ので、名前は形が分かるものにしてある。
   */
  const WORLD = `
traits:
  liquid_container:
    tags: [liquid_container]
  liquid:
    tags: [liquid]
    props:
      density: {value: 1}
  blue:
    props:
      color: {value: 0x2f86d8}

object_defs:
  # バーの宣言を持たない物。バーが出ないことの相手役。
  stone:
    tags: [item]
    props:
      volume: {value: 100}

  # 尽きると使えなくなるので、満タン側がgood。
  chisel:
    tags: [item]
    props:
      durability: {gauge: {min: bad, max: good}, value: 100, range: {min: 0, max: 100}}

  # 残り薪。減るほど悪いのは耐久度と同じ。
  hearth:
    tags: [fixture]
    props:
      fuel: {gauge: {min: bad, max: good}, value: 0, range: {min: 0, max: 30}}

  # 残っている傷は増えるほど悪いので、耐久度とは両端が逆。下限は0ではなく1。
  bruise:
    tags: [injury]
    props:
      severity: {gauge: {min: good, max: bad}, value: 100, range: {min: 1, max: 100}}

  # 固形物の入れ物。上限（capacity）を持つので、詰まり具合のバーを出す。
  crate:
    tags: [item]
    storage: true
    props:
      volume: {value: 500}
    slots:
      contents:
        cell_count: 10
        cell: {accept: {tag: item}}
        capacity: 20000

  # 液体の容器。中身は容器自身のfillなので、量のバーは中身の色で出る。
  bowl:
    tags: [item]
    traits: [liquid_container]
    props:
      weight: {value: 200}
      fill: {value: 0, range: {min: 0, max: 250}, on_min: {become: {content: none}}}
      volume: {value: 200}
    variation_axes:
      content: {of: {tag: liquid}}

  water_liquid:
    traits: [liquid, blue]
`;

  const setUp = (): MiniGame => miniGame(WORLD);

  /** そのオブジェクトの札が出しているバーのうち、鍵が一致する1本（無ければundefined）。 */
  function gaugeOf(mini: MiniGame, object: WorldObject, key: string): CardGauge | undefined {
    const view = fromGameSession(mini.game, mini.codex, locale);
    const card = view.cardsIn(object.parentSlot!).find((held) => held?.objects[0] === object);
    return card?.gauges?.find((gauge) => gauge.key === key);
  }

  /** 容器を中身入りの変種にして、量を入れる（LiquidContainerSystem.md 2節）。 */
  function fill(mini: MiniGame, container: WorldObject, amount: number): void {
    container.becomeAlong(new Map([['content', 'water_liquid']]));
    container.tryGetProperty(mini.codex.propertyNames.getId('fill'))?.setNumber(amount);
  }

  it('gauge宣言を持つプロパティだけが、その残りの割合をバーにする', () => {
    const mini = setUp();
    const chisel = mini.createObject('chisel', mini.slot('hand'));
    const stone = mini.createObject('stone', mini.slot('hand'));

    expect(gaugeOf(mini, chisel, 'durability'), '作りたては満タン').toEqual({
      key: 'durability',
      ratio: 1,
      atMin: 'bad',
      atMax: 'good',
      worsensUpward: false,
    });
    expect(gaugeOf(mini, stone, 'durability'), '石は耐久度を持たない').toBeUndefined();

    chisel.tryGetProperty(mini.codex.propertyNames.getId('durability'))?.add(-25);

    expect(gaugeOf(mini, chisel, 'durability')?.ratio, '減った分だけ割合が下がる').toBe(0.75);
  });

  it('炉は残っている薪の割合をバーとして持つ', () => {
    const mini = setUp();
    const hearth = mini.createObject('hearth', mini.slot('fixtures', mini.land));
    const fuelId = mini.codex.propertyNames.getId('fuel');

    expect(gaugeOf(mini, hearth, 'fuel')?.ratio, '薪が無ければ0').toBe(0);

    hearth.tryGetProperty(fuelId)?.setNumber(15);

    expect(gaugeOf(mini, hearth, 'fuel')?.ratio, 'くべた分だけ割合が上がる').toBeCloseTo(0.5, 2);
  });

  it('怪我のカードのバーは、耐久度とは両端が逆になる（減るほど良い）', () => {
    const mini = setUp();
    const bruise = mini.createObject('bruise', mini.slot('injuries'));

    expect(gaugeOf(mini, bruise, 'severity')).toEqual({
      key: 'severity',
      ratio: 1,
      atMin: 'good',
      atMax: 'bad',
      worsensUpward: true,
    });

    // 下限は0ではなく1なので、半分まで治しても割合はぴったり半分にはならない。
    bruise.tryGetProperty(mini.codex.propertyNames.getId('severity'))?.setNumber(50);

    expect(gaugeOf(mini, bruise, 'severity')?.ratio, '半分治れば半分まで縮む').toBeCloseTo(0.5, 1);
  });

  it('上限を持つ入れ物のカードだけが、容量の詰まり具合を持つ', () => {
    const mini = setUp();
    const crate = mini.createObject('crate', mini.slot('hand'));
    const stone = mini.createObject('stone', mini.slot('hand'));

    expect(gaugeOf(mini, crate, '@capacity'), 'contentsが容量を宣言している').toEqual({
      key: '@capacity',
      ratio: 0,
      // 満杯へ近づくほど物が入らなくなるので、空いている側がgood。
      atMin: 'good',
      atMax: 'bad',
      worsensUpward: true,
    });
    expect(gaugeOf(mini, stone, '@capacity'), '中身を持たない物に詰まり具合は無い').toBeUndefined();
  });

  it('液体容器のカードは、中身の割合と液体の色をバーにする', () => {
    const mini = setUp();
    const bowl = mini.createObject('bowl', mini.slot('hand'));

    expect(
      gaugeOf(mini, bowl, '@fill')?.ratio,
      '空の容器も量を持つので、0のバーが出る（どれだけ入るかは容器自身の情報）',
    ).toBe(0);

    // 容量は250mLなので、100mLで4割。
    fill(mini, bowl, 100);

    expect(gaugeOf(mini, bowl, '@fill'), '色は中身の液体が宣言したもの').toEqual({
      key: '@fill',
      ratio: 0.4,
      color: 0x2f86d8,
      // 良し悪しではなく中身そのものの色を映すバーなので、両端は色を決めない。
      atMin: 'neutral',
      atMax: 'neutral',
      worsensUpward: false,
    });

    // 飲み干す＝fillが尽きる。量が尽きた変種は空の容器へ戻る（fillのon_min）。
    bowl.tryGetProperty(mini.codex.propertyNames.getId('fill'))?.setNumber(0);

    expect(gaugeOf(mini, bowl, '@fill')?.ratio, '飲み干して空へ戻れば0に戻る').toBe(0);
  });

  it('液体の容器は、詰まり具合ではなく中身のバーを出す', () => {
    // 上限は同じcapacityでも、量を持つのは中身の液体自身なので、映すのは中身の色のバー1本だけ。
    // 2本出ると同じ位置に重なる。
    const mini = setUp();
    const bowl = mini.createObject('bowl', mini.slot('hand'));
    fill(mini, bowl, 100);

    expect(gaugeOf(mini, bowl, '@capacity')).toBeUndefined();
    expect(gaugeOf(mini, bowl, '@fill')?.ratio, '入っていることは中身のバーが見せる').toBeGreaterThan(0);
  });

  it('液体を入れられないカードは、中身のバーを持たない', () => {
    const mini = setUp();
    const crate = mini.createObject('crate', mini.slot('hand'));

    expect(gaugeOf(mini, crate, '@fill'), '量で満たされるものではないのでバーは出さない').toBeUndefined();
  });
});
