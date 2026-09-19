import { describe, expect, it } from 'vitest';
import type { ObjectGlobalId } from '../../src/domain/GlobalId';
import { NO_INSTANCE, WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * instanceIdの予約値（{@link NO_INSTANCE}）を、**どの個体も名乗らない**ことの試験。
 *
 * 個体を指すプロパティは、書き込まれる前はこの値を持つ。ここが破れると、行き先を書き忘れた宣言が
 * 黙って「その値を名乗っている個体」——所属ツリーの根——を掴む（issue #2087）。引く側に既定値の
 * 分岐を置かずに済んでいるのは、この予約が守られているからなので、**予約そのものを見る。**
 */

const YAML = `
object_defs:
  world:
    singleton: true
    slots:
      stuff: {cell: {accept: {tag: thing}}}

  stone:
    tags: [thing]
`;

function open(): { session: WorldSession; stoneId: ObjectGlobalId } {
  const codex = new WorldCodexYamlLoader().load('reservation.yaml', YAML).buildAndReset();
  return { session: new WorldSession(codex), stoneId: codex.objectNames.getId('stone') };
}

describe('instanceIdの予約値', () => {
  it('予約値を名乗る個体は作れない', () => {
    const { session, stoneId } = open();

    expect(() => new WorldObject(NO_INSTANCE, session.codex.objects.get(stoneId), session)).toThrow(
      /NO_INSTANCE/,
    );
  });

  it('WorldSessionが配る番号は予約値を避ける', () => {
    // 最初の1つで見る——ここが予約値から始まると、世界に最初に湧いた物が「該当なし」を名乗る。
    const { session, stoneId } = open();

    expect(session.createObject(stoneId).instanceId).not.toBe(NO_INSTANCE);
  });

  it('予約値で引いても、どの個体にも当たらない', () => {
    const { session, stoneId } = open();
    const world = session.createObject(session.codex.objectNames.getId('world'));
    const stone = session.createObject(stoneId);
    expect(
      stone.moveToSlotOrRejection(world.getSlot(session.codex.slotNames.getId('stuff'))),
    ).toBeUndefined();

    expect(world.findSelfOrDescendantByInstanceId(NO_INSTANCE), '根も子孫も当たらない').toBeUndefined();
    expect(world.findSelfOrDescendantByInstanceId(stone.instanceId), '実在する番号は当たる').toBe(stone);
  });
});
