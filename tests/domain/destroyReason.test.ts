import { describe, expect, it } from 'vitest';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 消滅が名乗る名前（GameElementDefinition.md 9.3節の`reason`）に対する自動テスト。
 *
 * **確かめるのは「消した宣言が名乗ったことだけが残る」こと。** 残った値から何が起きたのかを推測すると、
 * 上限で消える場合・段を通らない即死・致死でない消滅の3つを同時に取りこぼす（VitalsSystem.md 6節）。
 */
describe('消えるときに名乗る理由', () => {
  const yaml = `
object_defs:
  land:
    slots:
      ground: {cell: {accept: {tag: creature}}}

  # 下限で消える獣。命を絶った宣言が死因を名乗る。
  thirsty_beast:
    tags: [creature]
    props:
      hydration:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          destroy: {subject: self, reason: dehydrated}
        passives:
          - add: {self: {hydration: -1}}

  # 上限で消える獣。下限側と同じように名乗れる。
  burning_beast:
    tags: [creature]
    props:
      scorch:
        value: 9
        range: {min: 0, max: 10}
        on_max:
          destroy: {subject: self, reason: burnt}
        passives:
          - add: {self: {scorch: 1}}

  # 立ち去る獣。消えはするが、名乗らない。
  visiting_beast:
    tags: [creature]
    props:
      stay_remaining:
        value: 1
        range: {min: 0, max: 10}
        on_min:
          destroy: self
        passives:
          - add: {self: {stay_remaining: -1}}

  # 段も端も通らずに消える獣（即死）。
  doomed_beast:
    tags: [creature]
    interactions:
      smite:
        trigger: menu
        destroy: {subject: self, reason: smitten}
`;

  /** land.ground に1体立たせる。 */
  function release(objectName: string): WorldObject {
    const loader = new WorldCodexYamlLoader();
    loader.load('destroyReason.yaml', yaml);
    const codex = loader.buildAndReset();
    const session = new WorldSession(codex);

    const land = session.createObject(codex.objectNames.getId('land'));
    const beast = session.createObject(codex.objectNames.getId(objectName));
    expect(beast.moveToSlotOrRejection(land.getSlot(codex.slotNames.getId('ground')))).toBeUndefined();
    return beast;
  }

  it('下限で消すと、その宣言が名乗った名前が残る', () => {
    const beast = release('thirsty_beast');

    beast.tick();

    expect(beast.parent, '尽きた個体は世界から消える').toBeUndefined();
    expect(beast.destroyedReason).toBe('dehydrated');
  });

  it('上限で消す場合も名乗れる', () => {
    // 判定が下限側しか見ていなかった頃は、上限で消えた個体は何も答えられなかった。
    const beast = release('burning_beast');

    beast.tick();

    expect(beast.parent).toBeUndefined();
    expect(beast.destroyedReason).toBe('burnt');
  });

  it('段を通らずに消す即死も名乗れる', () => {
    const beast = release('doomed_beast');

    expect(beast.tryGetAction('smite', undefined)?.tryExecute()).toBe(true);

    expect(beast.parent).toBeUndefined();
    expect(beast.destroyedReason).toBe('smitten');
  });

  it('名乗らずに消えた個体は、何も名乗らない', () => {
    // 立ち去りは死ではない。値が尽きた形は上の渇きと同じなので、**残った値から読む限り区別が付かない**。
    const beast = release('visiting_beast');

    beast.tick();

    expect(beast.parent, '立ち去った個体も世界から消える').toBeUndefined();
    expect(beast.destroyedReason, '名前の無い消滅は理由を持たない').toBeUndefined();
  });
});
