import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldChange } from '../../src/domain/WorldChange';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { World } from '../../src/domain/wrappers/World';
import { bornInstances, originInstances, vanishedInstances } from '../../src/game/view/changedInstances';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { fixedRng } from '../support/rng';

/**
 * 世界に起きた変化を、カードの動きの言葉へ直す（changedInstances、docs/engine/HuntingSystem.md 6.2節と
 * docs/ui/CardInteraction.md 6.1節）の自動テスト。
 *
 * 狙いは「新しく現れた札がどこから飛ぶか」「何が壊れて何が生まれたか」をUIが知らずに済むこと。定義は
 * このファイル専用の最小Codexで書き、実データの変更に引きずられないようにする。
 */
describe('世界の変化から引く、カードの動き', () => {
  const YAML = `
object_defs:
  world:
    props:
      day: {value: 0}
      hour: {value: 0}
      minute: {value: 0}
      minutes_per_tick: {value: 15}
    slots:
      locations: {cell: {accept: {tag: location}}}
  ground:
    tags: [location]
    slots:
      items: {cell: {accept: {tag: item}}}
      beasts: {cell: {accept: {tag: beast}}}
      undiscovered: {cell: {accept: {tag: item}}}
  stone:
    tags: [item]
  basket:
    tags: [item]
    slots:
      contents: {cell: {accept: {tag: item}}}
  # 重ねた物を自分のlootへ取り上げる獣。
  beast:
    tags: [beast]
    slots:
      loot: {cell: {accept: {tag: item}}}
    interactions:
      grab:
        trigger: {drag: {tag: item}}
        move: {subject: dragged, to: self}
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let ground: WorldObject;

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('origins.yaml', YAML).build();
    session = new WorldSession(codex, undefined, fixedRng(0.5));
    const worldInstance = new WorldObject(0, codex.objects.get(codex.objectNames.getId('world')), session);
    session.adoptWorld(new World(worldInstance, codex));
    ground = spawn('ground');
    expect(ground.moveToSlotOrRejection(worldInstance.getSlot(slot('locations')))).toBeUndefined();
  });

  const slot = (name: string): number => codex.slotNames.getId(name);
  const spawn = (name: string): WorldObject => session.createObject(codex.objectNames.getId(name));

  /** その名前のオブジェクトを生成し、地面へ置く。 */
  function placeOnGround(name: string, slotName = 'items'): WorldObject {
    const object = spawn(name);
    expect(object.moveToSlotOrRejection(ground.getSlot(slot(slotName)))).toBeUndefined();
    return object;
  }

  /** bodyの実行中に起きた変化を、出どころへ直す。 */
  function originsOf(body: () => void): ReadonlyMap<number, number> {
    const changes: WorldChange[] = [];
    session.observeChanges((change) => changes.push(change), body);
    return originInstances(changes);
  }

  it('効果が動かした物は、その効果を宣言していた側の札から飛ぶ', () => {
    // 獣が石を取り上げたら、石は獣の札から飛ぶ。UIは「取り上げた」という分岐名を知らない。
    const beast = placeOnGround('beast', 'beasts');
    const stone = placeOnGround('stone');

    const origins = originsOf(() => {
      expect(
        beast
          .combinationsWith(stone, undefined)
          .find((c) => c.name === 'grab')
          ?.tryExecute() === true,
      ).toBe(true);
    });

    expect(origins).toEqual(new Map([[stone.instanceId, beast.instanceId]]));
  });

  it('2匹が別々に動かせば、出どころも分かれる', () => {
    // 呼び出し側が1つの矩形を渡す形では区別できない唯一の場合。
    const beasts = [placeOnGround('beast', 'beasts'), placeOnGround('beast', 'beasts')];
    const stones = [placeOnGround('stone'), placeOnGround('stone')];

    const origins = originsOf(() => {
      for (const [index, beast] of beasts.entries()) {
        expect(
          beast
            .combinationsWith(stones[index], undefined)
            .find((c) => c.name === 'grab')
            ?.tryExecute() === true,
        ).toBe(true);
      }
    });

    expect(origins).toEqual(
      new Map([
        [stones[0].instanceId, beasts[0].instanceId],
        [stones[1].instanceId, beasts[1].instanceId],
      ]),
    );
  });

  it('主体を持たない移動は、移動前の親から飛ぶ', () => {
    // 未発見の設置物の公開や、閉じた入れ物からの取り出しがこれ。画面に出ていないスロットから
    // 出てきた物は、その持ち主の札から飛ぶ。
    const hidden = placeOnGround('stone', 'undiscovered');

    const origins = originsOf(() => {
      expect(hidden.moveToSlotOrRejection(ground.getSlot(slot('items')))).toBeUndefined();
    });

    expect(origins).toEqual(new Map([[hidden.instanceId, ground.instanceId]]));
  });

  it('プレイヤーが直に生んだ物は、出どころを持たない', () => {
    // 主体も移動前の居場所も無い。どこから飛ばすかは世界の側に答が無いということ。
    const stone = spawn('stone');

    const origins = originsOf(() => {
      expect(stone.moveToSlotOrRejection(ground.getSlot(slot('items')))).toBeUndefined();
    });

    expect(origins.size).toBe(0);
  });

  it('世界から出た物は、出どころを持たない（現れるものが無い）', () => {
    const basket = placeOnGround('basket');

    const origins = originsOf(() => basket.destroy());

    expect(origins.size).toBe(0);
  });

  describe('世界の出入り（CardInteraction.md 6.1節 砂埃）', () => {
    /** bodyの実行中に起きた変化を、出入りしたインスタンスへ直す。 */
    function movesOf(body: () => void): { born: readonly number[]; vanished: readonly number[] } {
      const changes: WorldChange[] = [];
      session.observeChanges((change) => changes.push(change), body);
      return { born: bornInstances(changes), vanished: vanishedInstances(changes) };
    }

    it('壊れた物は世界から出たものとして挙がる', () => {
      const basket = placeOnGround('basket');

      expect(movesOf(() => basket.destroy())).toEqual({ born: [], vanished: [basket.instanceId] });
    });

    it('生まれた物は世界に入ったものとして挙がる', () => {
      const moves = movesOf(() => {
        const stone = spawn('stone');
        expect(stone.moveToSlotOrRejection(ground.getSlot(slot('items')))).toBeUndefined();
      });

      expect(moves.born).toHaveLength(1);
      expect(moves.vanished).toEqual([]);
    });

    it('移っただけの物は、どちらにも挙がらない', () => {
      // 別のレーンへ移った札はレーンから見れば消えて現れるので、ここで分かれていることが要る。
      const basket = placeOnGround('basket');
      const stone = placeOnGround('stone');

      const moves = movesOf(() => {
        expect(stone.moveToSlotOrRejection(basket.getSlot(slot('contents')))).toBeUndefined();
      });

      expect(moves).toEqual({ born: [], vanished: [] });
    });
  });

  it('一度の差し替えで何度も動いた物は、最初の出どころから飛ぶ', () => {
    // 見せる飛びは1回なので、出発点は最初に居た場所になる。
    const basket = placeOnGround('basket');
    const stone = spawn('stone');

    const origins = originsOf(() => {
      expect(stone.moveToSlotOrRejection(basket.getSlot(slot('contents')))).toBeUndefined();
      expect(stone.moveToSlotOrRejection(ground.getSlot(slot('items')))).toBeUndefined();
    });

    // 1つ目は生まれた分（出どころ無し）なので、記録に残るのは2つ目のかごから。
    expect(origins).toEqual(new Map([[stone.instanceId, basket.instanceId]]));
  });
});
