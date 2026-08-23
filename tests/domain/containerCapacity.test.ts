import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 入れ物が自分の詰まり具合を答えること（ContainerSystem.md 1節）。上限はスロットのcapacity、
 * かさは中身のsizeが持つので、割合はその2つが出会う入れ物の主要なスロットでだけ出せる。
 */
describe('入れ物の詰まり具合', () => {
  const codex: WorldCodex = new WorldCodexYamlLoader()
    .load(
      'containerCapacity.yaml',
      `
object_defs:
  # 上限を持つ入れ物。入れ物と名乗った型（storage）の、上限つきスロットが詰まり具合の出所になる。
  basket:
    storage: true
    slots:
      contents:
        cell: {accept: {tag: item}}
        capacity: 100
  # 上限を持たない入れ物。いくらでも入るので、満たされ具合そのものが無い。
  cart:
    storage: true
    slots:
      contents:
        cell: {accept: {tag: item}}
  stone:
    tags: [item]
    props:
      volume: {value: 30}
  # かさを宣言していない物。上限のある枠へ入っても、詰まり具合は動かない。
  feather:
    tags: [item]
`,
    )
    .build();

  const contentsId = codex.slotNames.getId('contents');

  const spawn = (name: string): { session: WorldSession; object: WorldObject } => {
    const session = new WorldSession(codex);
    return { session, object: session.createObject(codex.objectNames.getId(name)) };
  };

  /** 入れ物と、そこへ物を入れる手段。 */
  const setUp = (containerName: string) => {
    const { session, object: container } = spawn(containerName);
    return {
      container,
      put: (name: string): string | undefined =>
        session.createObject(codex.objectNames.getId(name)).moveToSlot(container.getSlot(contentsId)),
    };
  };

  it('入れた物のかさが上限を占めるぶんだけ増える', () => {
    const { container, put } = setUp('basket');

    expect(container.storageFillRatio(), '空の入れ物は0（バーは出るが空）').toBe(0);

    expect(put('stone')).toBeUndefined();
    expect(container.storageFillRatio()).toBeCloseTo(0.3, 5);

    expect(put('stone')).toBeUndefined();
    expect(container.storageFillRatio()).toBeCloseTo(0.6, 5);
  });

  it('上限を超える物は入らないので、割合は1を超えない', () => {
    const { container, put } = setUp('basket');
    for (let i = 0; i < 3; i++) expect(put('stone'), `${i + 1}個目`).toBeUndefined();

    expect(put('stone'), '4個目は容量を超えるので弾かれる').toContain('容量');
    expect(container.storageFillRatio()).toBeCloseTo(0.9, 5);
  });

  it('かさを宣言していない物を入れても増えない', () => {
    // sizeを宣言し忘れた物はかさ0として扱われ、いくらでも入ってしまう。実ファイルの全アイテムが
    // 宣言していることはtests/world-codex/containersYaml.test.tsが検査する。
    const { container, put } = setUp('basket');

    expect(put('feather')).toBeUndefined();

    expect(container.storageFillRatio()).toBe(0);
  });

  it('上限を持たない入れ物は、詰まり具合そのものを持たない', () => {
    const { container, put } = setUp('cart');

    expect(put('stone')).toBeUndefined();

    expect(container.storageFillRatio()).toBeUndefined();
  });

  it('中身を持たない物は、詰まり具合そのものを持たない', () => {
    expect(spawn('stone').object.storageFillRatio()).toBeUndefined();
  });

  it('入れ物と名乗らない型は、上限つきのスロットを持っていてもバーの出所にならない', () => {
    // 液体の容器がこれ。上限は同じcapacityでも、量を持つのは中身の液体自身
    // （LiquidContainerSystem.md 2節）。
    const withoutStorage = new WorldCodexYamlLoader()
      .load(
        'noStorage.yaml',
        `
object_defs:
  canteen:
    slots:
      content:
        cell: {accept: {tag: item}}
        capacity: 100
`,
      )
      .build();
    const session = new WorldSession(withoutStorage);

    expect(
      session.createObject(withoutStorage.objectNames.getId('canteen')).storageFillRatio(),
    ).toBeUndefined();
  });
});
