import { describe, expect, it } from 'vitest';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * spawnのcount（GameElementDefinition.md 9.4節）の検証。同じ宣言を並べるのと同じ意味なので、
 * 「count回ぶん生まれて配置される」ことを実際の配置で確かめる。
 */
describe('spawnのcount', () => {
  const YAML = `
object_defs:
  ground:
    singleton: true
    slots:
      items:
        cell: {accept: {tag: item}}
  stone:
    tags: [item]
  pile:
    tags: [item]
    actions:
      scatter:
        spawn: {object: stone, count: 3, into: same_slot}
        destroy: self
`;

  function itemsOnGround(yaml: string): readonly string[] {
    const codex = new WorldCodexYamlLoader().load('test.yaml', yaml).build();
    const session = new WorldSession(codex);
    const ground = new WorldObject(1, codex.objects.get(codex.objectNames.getId('ground')), session);
    const pile = new WorldObject(2, codex.objects.get(codex.objectNames.getId('pile')), session);
    pile.moveIntoFirstAcceptingSlot(ground, codex.wellKnown, false, session);

    pile.tryExecuteAction('scatter', undefined, session);

    const slot = ground.tryGetSlot(codex.slotNames.getId('items'));
    return (slot?.contents ?? []).map((object) => object.def.name);
  }

  it('countの数だけ生まれる', () => {
    expect(itemsOnGround(YAML)).toEqual(['stone', 'stone', 'stone']);
  });

  it('省略すると1個（従来どおり）', () => {
    expect(itemsOnGround(YAML.replace(', count: 3', ''))).toEqual(['stone']);
  });

  it('0以下・小数はロード時に弾く', () => {
    expect(() => itemsOnGround(YAML.replace('count: 3', 'count: 0'))).toThrow(YamlLoadError);
    expect(() => itemsOnGround(YAML.replace('count: 3', 'count: 1.5'))).toThrow(YamlLoadError);
  });
});
