import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import type { ObjectCardStack } from '../../src/game/view/PlayScreenView';
import { fromGameSession } from '../../src/game/view/PlayScreenView';
import { parseLocale } from '../../src/locale/Localization';
import type { MiniGame } from '../support/miniGame';
import { miniGame } from '../support/miniGame';

/**
 * カードの印・覆い・輪郭（CardView.md 3節・9節・15節）の自動テスト。
 *
 * どれも**その物が今どうなっているか**だけで決まり、どのスロットに居るかは見ない。ここで確かめるのは
 * その規則で、何度で焦げるか・どの怪我が血を流すかは世界側の宣言の話。
 */
describe('カードの印と覆い', () => {
  const locale = parseLocale('ja.yaml', 'object_texts:\n  stone:\n    display_name: 石\n');

  const WORLD = `
object_defs:
  stone:
    tags: [item]

  # 動物はitemも兼ねる（HuntingSystem.md 1.1節）。負った傷を抱えられる。
  monkey:
    tags: [item, animal]
    props:
      consciousness: {gauge: {min: bad, max: good}, value: 100, range: {min: 0, max: 100}}
      wariness:
        value: 50
        range: {min: 0, max: 100}
        stages:
          - {name: calm}
          - {name: wary, min: 20, alert: caution}
    slots:
      injuries: {cell: {accept: {tag: injury}}}

  # 血の流れない怪我。治療具を当てられる。
  bruise:
    tags: [injury]
    slots:
      treatment: {cell_count: 1, cell: {accept: {tag: treatment}}}

  # 血の流れている傷。止まればbleedingが0になる。
  cut:
    tags: [injury]
    props:
      bleeding: {value: 5}
    slots:
      treatment: {cell_count: 1, cell: {accept: {tag: treatment}}}

  bandage:
    tags: [item, treatment]

  # 火にかけた物のcooking_progressを進めるのは、heatの段が宣言した寄与（FireSystem.md 7節）。
  hearth:
    tags: [fixture]
    props:
      heat:
        value: 0
        stages:
          - {name: out}
          - name: flame
            min: 20
            passives:
              - add: {child: {cooking_progress: 3}}
    slots:
      fire: {cell: {accept: {tag: item}}}

  # 24 ÷ 3 = 8tickでmaxちょうどに乗る。
  raw_meat:
    tags: [item]
    props:
      cooking_progress: {value: 0, range: {min: 0, max: 24}}

  # 6 ÷ 3 = 2tick。生肉より先に変わる。
  small_fish:
    tags: [item]
    props:
      cooking_progress: {value: 0, range: {min: 0, max: 6}}
`;

  const setUp = (): MiniGame => miniGame(WORLD);

  /** そのオブジェクトを映している札。 */
  function cardOf(mini: MiniGame, object: WorldObject): ObjectCardStack {
    const view = fromGameSession(mini.game, mini.codex, locale);
    return view.cardsIn(object.parentSlot!).find((card) => card?.objects[0] === object)!;
  }

  /** 炎を上げている炉を据え、その火の中へ生肉を1切れ入れる。 */
  function placeCookingHearth(mini: MiniGame): { readonly hearth: WorldObject; readonly meat: WorldObject } {
    const hearth = mini.spawn('hearth', mini.slot('fixtures', mini.land));
    hearth.tryGetProperty(mini.codex.propertyNames.getId('heat'))?.setNumber(30);
    const meat = mini.spawn('raw_meat', mini.slot('fire', hearth));
    return { hearth, meat };
  }

  it('動物のカードは、アイテムではなく動物として枠の色が決まる', () => {
    // 動物はitemも兼ねるので、種別を決める順序が効いている（CardView.md 2節 枠の色は種別で変える）。
    const mini = setUp();
    const monkey = mini.spawn('monkey', mini.slot('items', mini.land));

    expect(cardOf(mini, monkey).kind).toBe('animal');
  });

  it('警戒している動物のカードだけが、輪郭を明滅させる域を持つ', () => {
    // 安全域を外れている間だけ明滅する（CardView.md 3節 警戒している動物は輪郭を明滅させる）。
    const mini = setUp();
    const monkey = mini.spawn('monkey', mini.slot('items', mini.land));

    expect(cardOf(mini, monkey).alert, '現れた時点で警戒している').toBe('caution');

    monkey.tryGetProperty(mini.codex.propertyNames.getId('wariness'))?.setNumber(0);

    expect(cardOf(mini, monkey).alert, '落ち着けば明滅しない').toBe('safe');
  });

  it('警戒を持たないカードは、明滅させる域を持たない', () => {
    const mini = setUp();
    const stone = mini.spawn('stone', mini.slot('items', mini.land));

    expect(cardOf(mini, stone).alert).toBeUndefined();
  });

  it('動物のカードは、今の意識をゲージとして持つ', () => {
    const mini = setUp();
    const monkey = mini.spawn('monkey', mini.slot('items', mini.land));
    const gauge = () => cardOf(mini, monkey).gauges?.find((g) => g.key === 'consciousness');

    expect(gauge(), '起きていれば意識は満タン').toEqual({
      key: 'consciousness',
      ratio: 1,
      atMin: 'bad',
      atMax: 'good',
      worsensUpward: false,
    });

    monkey.tryGetProperty(mini.codex.propertyNames.getId('consciousness'))?.setNumber(10);

    expect(gauge()?.ratio, '削られた分だけ割合が下がる').toBe(0.1);
  });

  it('治療具を当てた怪我のカードだけが、手当て済みの印を持つ', () => {
    // 手当ての有無で絵は差し替えない（CardView.md 9節 カードの印）。
    const mini = setUp();
    const bruise = mini.spawn('bruise', mini.slot('injuries'));

    expect(cardOf(mini, bruise).mark).toBeUndefined();

    mini.spawn('bandage', mini.slot('treatment', bruise));

    expect(cardOf(mini, bruise).mark).toBe('🩹');
  });

  it('血が流れている傷は、手当て済みより先に出血の印を出す', () => {
    // 当ててあってもまだ流れているなら、伝えるべきは「当ててある」ではなく「止まっていない」
    // （VitalsSystem.md 9節）。
    const mini = setUp();
    const cut = mini.spawn('cut', mini.slot('injuries'));
    mini.spawn('bandage', mini.slot('treatment', cut));

    expect(cardOf(mini, cut).mark).toBe('🩸');

    cut.tryGetProperty(mini.codex.propertyNames.getId('bleeding'))?.setNumber(0);

    expect(cardOf(mini, cut).mark, '固まれば手当て済みの印へ戻る').toBe('🩹');
  });

  it('出血の印は、負っている本人のポートレイトにも出る', () => {
    // 傷のカードは開かないと見えないので、そこだけに出していると流し見のあいだに失血が進む
    // （VitalsSystem.md 9節）。
    const mini = setUp();
    const characterMark = () => fromGameSession(mini.game, mini.codex, locale).characterCard.mark;

    expect(characterMark(), '無傷なら何も出ない').toBeUndefined();

    const cut = mini.spawn('cut', mini.slot('injuries'));

    expect(characterMark()).toBe('🩸');

    cut.tryGetProperty(mini.codex.propertyNames.getId('bleeding'))?.setNumber(0);

    expect(characterMark(), '止まれば消える').toBeUndefined();
  });

  it('手当て済みの印は、負っている本人までは上がらない', () => {
    // 上げるのは出血だけ。手当て済みは「もう手を打った」を言うもので、急がせる必要がない。
    const mini = setUp();
    const bruise = mini.spawn('bruise', mini.slot('injuries'));
    mini.spawn('bandage', mini.slot('treatment', bruise));

    expect(fromGameSession(mini.game, mini.codex, locale).characterCard.mark).toBeUndefined();
  });

  it('血が流れている傷を負った動物は、そのカードに出血の印を出す', () => {
    // 傷は動物のinjuriesスロットの中なので、レーンに並ぶ1枚を見ているだけでは分からない。
    const mini = setUp();
    const monkey = mini.spawn('monkey', mini.slot('items', mini.land));

    expect(cardOf(mini, monkey).mark, '無傷なら何も出ない').toBeUndefined();

    mini.spawn('cut', mini.slot('injuries', monkey));

    expect(cardOf(mini, monkey).mark).toBe('🩸');
  });

  it('火にかけた物のカードは、変わるまでの残り時間と進み具合を出す', () => {
    const mini = setUp();
    const { hearth, meat } = placeCookingHearth(mini);

    // 24 ÷ 3 = 8tickでmaxちょうどに乗り、そこでon_maxが起きる → 8tick × 15分。
    expect(cardOf(mini, meat).cooking).toEqual({ ratio: 0, minutes: 120 });
    expect(hearth.tryGetSlot(mini.codex.slotNames.getId('fire'))?.contents).toContain(meat);
  });

  it('tick境界の外で時間が進めば、加熱が進まなくても残り時間は減る', () => {
    // 焼き上がるのはtickが回る瞬間だけなので、残り時間はその瞬間までの分数（CardView.md 15節）。
    // 5分の行動を挟んでも加熱は1つも進まないが、焼き上がる時刻は変わらないので残りは5分減る。
    const mini = setUp();
    const { meat } = placeCookingHearth(mini);
    const cookingId = mini.codex.propertyNames.getId('cooking_progress');
    const before = meat.tryGetProperty(cookingId)?.number;

    mini.game.session.advanceWorldTime(5);

    expect(meat.tryGetProperty(cookingId)?.number, '加熱は1つも進んでいない').toBe(before);
    expect(cardOf(mini, meat).cooking?.minutes).toBe(115);
  });

  it('火から出した物のカードには、加熱の覆いが出ない', () => {
    // 出すかどうかは場所ではなく「今その値が進んでいるか」で決まる（CardView.md 15節）。
    const mini = setUp();
    const { meat } = placeCookingHearth(mini);
    expect(meat.moveToSlot(mini.slot('items', mini.land))).toBeUndefined();

    expect(cardOf(mini, meat).cooking).toBeUndefined();
  });

  it('火が消えれば、火にかけたままの物からも覆いが消える', () => {
    const mini = setUp();
    const { hearth, meat } = placeCookingHearth(mini);

    hearth.tryGetProperty(mini.codex.propertyNames.getId('heat'))?.setNumber(0);

    expect(cardOf(mini, meat).cooking).toBeUndefined();
  });

  it('炉のカードは、中で一番早く変わるものの残り時間を上げる', () => {
    // 火にかけた物は炉を開くまで見えないので、開かずに焦げへ気付けるようにする（CardView.md 15節）。
    const mini = setUp();
    const { hearth } = placeCookingHearth(mini);
    mini.spawn('small_fish', mini.slot('fire', hearth));

    // 小魚は6 ÷ 3 = 2tickで30分。生肉の120分より先に変わるので、こちらが上がる。
    expect(cardOf(mini, hearth).cooking?.minutes).toBe(30);
  });
});
