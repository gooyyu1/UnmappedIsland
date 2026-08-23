import { beforeEach, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * placement（GameElementDefinition.md 7.7節）に対する自動テスト。エンジンの走査（auto）から外した
 * スロットが、あふれた物の行き先にも強制配置の行き先にもならないことを確認する。
 */
describe('自動配置の対象外スロット', () => {
  const YAML = `
object_defs:
  clearing:
    slots:
      items:
        cell: {accept: {tag: item}}
      characters:
        cell: {accept: {tag: character}}

  character:
    tags: [character]
    slots:
      hand:
        cell: {accept: {tag: item}}
        cell_count: 1
      equipment:
        cell: {accept: {tag: item}}
        placement: [manual]
    interactions:
      craft:
        trigger: menu
        spawn: {object: knife, into: actor}

  knife: {tags: [item]}
  stone: {tags: [item]}
`;

  let codex: WorldCodex;
  let session: WorldSession;
  let clearing: WorldObject;
  let player: WorldObject;

  /** slotNameの中身をobject_defの名前で並べる。 */
  function contentsOf(owner: WorldObject, slotName: string): string[] {
    return (owner.tryGetSlot(codex.slotNames.getId(slotName))?.contents ?? []).map(
      (object) => object.def.name,
    );
  }

  function spawnInto(objectName: string, parent: WorldObject, slotName: string): WorldObject {
    const spawned = session.spawn(codex.objectNames.getId(objectName));
    expect(spawned.moveToSlot(parent.getSlot(codex.slotNames.getId(slotName)))).toBeUndefined();
    return spawned;
  }

  beforeEach(() => {
    codex = new WorldCodexYamlLoader().load('core.yaml', YAML).build();
    session = new WorldSession(codex);
    clearing = session.spawn(codex.objectNames.getId('clearing'));
    player = spawnInto('character', clearing, 'characters');
  });

  it('手持ちに空きがあれば、そこへ入る', () => {
    expect(player.tryGetAction('craft', player)?.tryExecute() === true).toBe(true);

    expect(contentsOf(player, 'hand')).toEqual(['knife']);
    expect(contentsOf(player, 'equipment')).toEqual([]);
  });

  it('手持ちが埋まっていると、装備欄を飛ばして足元の土地へ落ちる', () => {
    spawnInto('stone', player, 'hand');

    expect(player.tryGetAction('craft', player)?.tryExecute() === true).toBe(true);

    expect(contentsOf(player, 'equipment'), '装備欄は自動配置の対象外').toEqual([]);
    expect(contentsOf(clearing, 'items')).toEqual(['knife']);
  });

  it('名指しの移動なら、自動配置の対象外のスロットにも入れられる', () => {
    const stone = spawnInto('stone', player, 'hand');

    expect(stone.moveToSlot(player.getSlot(codex.slotNames.getId('equipment')))).toBeUndefined();

    expect(contentsOf(player, 'equipment')).toEqual(['stone']);
  });
});
