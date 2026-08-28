import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * 装備の排他制御（covers / layer、GameElementDefinition.md 7.5節）。同じ部位の同じ階層は1つしか
 * 占められず、階層が違えば重ねられる。競合はブロック型なので、先に外すまで着られない。
 */
describe('covers / layer（装備の排他制御）', () => {
  // 身につける枠の名前（equipment）はWorldVocabularyが知っている——排他が効くのはこの枠だけ。
  const yaml = `
object_defs:
  character:
    slots:
      hand: {cell: {accept: {tag: item}}}
      equipment: {cell: {accept: {tag: item}}}

  shirt:
    tags: [item]
    covers: [torso]
    layer: base

  vest:
    tags: [item]
    covers: [torso]
    layer: outer

  trousers:
    tags: [item]
    covers: [legs]
    layer: base

  coverall:
    tags: [item]
    covers: [torso, legs]
    layer: base

  stone:
    tags: [item]
`;

  interface Fixture {
    readonly codex: WorldCodex;
    readonly session: WorldSession;
    readonly player: WorldObject;
  }

  const setUp = (): Fixture => {
    const loader = new WorldCodexYamlLoader();
    loader.load('worn.yaml', yaml);
    const codex = loader.buildAndReset();
    const session = new WorldSession(codex);

    return { codex, session, player: session.createObject(codex.objectNames.getId('character')) };
  };

  /** objectNameの物を1つ作って、装備の枠へ入れた結果（成功ならundefined、失敗ならその理由）。 */
  function wear({ codex, session, player }: Fixture, objectName: string): string | undefined {
    const item = session.createObject(codex.objectNames.getId(objectName));
    return item.moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.equipmentSlotId));
  }

  it('同じ部位の同じ階層は、2つ目を着られない', () => {
    const fixture = setUp();

    expect(wear(fixture, 'shirt')).toBeUndefined();
    expect(wear(fixture, 'shirt')).toContain('同じ部位の同じ階層');
  });

  it('外せば、同じ場所へ別の1着を着られる（ブロック型の競合解決）', () => {
    const fixture = setUp();
    const { codex, session, player } = fixture;
    const equipment = player.getSlot(codex.vocabulary.world.equipmentSlotId);
    const worn = session.createObject(codex.objectNames.getId('shirt'));

    expect(worn.moveToSlotOrRejection(equipment)).toBeUndefined();
    expect(wear(fixture, 'coverall'), '着たまま重ねられない').toContain('同じ部位の同じ階層');

    expect(
      worn.moveToSlotOrRejection(player.getSlot(codex.vocabulary.world.handSlotId)),
      '脱ぐ',
    ).toBeUndefined();
    expect(wear(fixture, 'coverall'), '脱いだ後なら着られる').toBeUndefined();
  });

  it('階層が違えば、同じ部位でも重ね着できる', () => {
    const fixture = setUp();

    expect(wear(fixture, 'shirt')).toBeUndefined();
    expect(wear(fixture, 'vest')).toBeUndefined();
  });

  it('部位が違えば、同じ階層でも並べて着られる', () => {
    const fixture = setUp();

    expect(wear(fixture, 'shirt')).toBeUndefined();
    expect(wear(fixture, 'trousers')).toBeUndefined();
  });

  it('覆う部位が1つでも重なれば競合する', () => {
    const fixture = setUp();

    expect(wear(fixture, 'trousers')).toBeUndefined();
    expect(wear(fixture, 'coverall'), '脚が重なる').toContain('同じ部位の同じ階層');
  });

  it('部位を持たない物は、何個でも同じ枠へ入る', () => {
    const fixture = setUp();

    expect(wear(fixture, 'stone')).toBeUndefined();
    expect(wear(fixture, 'stone')).toBeUndefined();
  });

  it('排他が効くのは身につける枠だけで、手持ちには同じ衣類を並べられる', () => {
    const { codex, session, player } = setUp();
    const hand = player.getSlot(codex.vocabulary.world.handSlotId);

    for (const nth of [1, 2])
      expect(
        session.createObject(codex.objectNames.getId('shirt')).moveToSlotOrRejection(hand),
        `${nth}着目`,
      ).toBeUndefined();

    expect(hand.contents).toHaveLength(2);
  });

  it('まとめて落としても、身につくのは1着だけ', () => {
    const { codex, session, player } = setUp();
    const equipment = player.getSlot(codex.vocabulary.world.equipmentSlotId);
    const [first, ...followers] = [0, 1, 2].map(() => session.createObject(codex.objectNames.getId('shirt')));

    expect(first.acceptedCountForMoveToIncludingSelf(followers, equipment)).toBe(1);
  });

  it('coversとlayerの片方だけの宣言は、ロード時に弾く', () => {
    const load = (body: string): void => {
      new WorldCodexYamlLoader().load('worn.yaml', `object_defs: {shirt: ${body}}`).buildAndReset();
    };

    expect(() => load('{covers: [torso]}')).toThrow(YamlLoadError);
    expect(() => load('{covers: [torso]}')).toThrow(/layer がありません/);
    expect(() => load('{layer: base}')).toThrow(/covers がありません/);
  });

  it('traitが宣言した部位と階層も効く（宣言一式として混ざる）', () => {
    const loader = new WorldCodexYamlLoader();
    loader.load(
      'worn.yaml',
      `
traits:
  torso_base: {covers: [torso], layer: base}
object_defs:
  character:
    slots:
      equipment: {cell: {accept: {tag: item}}}
  shirt:
    tags: [item]
    traits: [torso_base]
  tunic:
    tags: [item]
    traits: [torso_base]
`,
    );
    const codex = loader.buildAndReset();
    const session = new WorldSession(codex);
    const player = session.createObject(codex.objectNames.getId('character'));
    const equipment = player.getSlot(codex.vocabulary.world.equipmentSlotId);

    expect(
      session.createObject(codex.objectNames.getId('shirt')).moveToSlotOrRejection(equipment),
    ).toBeUndefined();
    expect(session.createObject(codex.objectNames.getId('tunic')).moveToSlotOrRejection(equipment)).toContain(
      '同じ部位の同じ階層',
    );
  });
});
