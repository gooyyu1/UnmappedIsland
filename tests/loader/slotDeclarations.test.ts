import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/**
 * 外から中身が見えるスロットの宣言（`visible_slots`、GameElementDefinition.md 7.11節）と、
 * 誰が入れてよいか（`placement`、同 7.7節）・入れ物であること（`storage`、同 7.12節）のロード。
 */
describe('visible_slots', () => {
  const load = (yaml: string): WorldCodex => new WorldCodexYamlLoader().load('test.yaml', yaml).build();

  const visibleNamesOf = (codex: WorldCodex, objectName: string): string[] =>
    codex.objects
      .get(codex.objectNames.getId(objectName))
      .visibleSlotGlobalIds.map((slotId) => codex.slotNames.getName(slotId));

  it('宣言した順に並ぶ。宣言しなければ空（外から中は見えない）', () => {
    const codex = load(`
object_defs:
  raft:
    slots:
      items: {cell: {accept: {tag: item}}}
      structure: {cell: {accept: {tag: sail}}}
    visible_slots: [structure]
  crate:
    slots:
      items: {cell: {accept: {tag: item}}}
`);

    expect(visibleNamesOf(codex, 'raft')).toEqual(['structure']);
    expect(visibleNamesOf(codex, 'crate'), '名乗らなければ中は見えない').toEqual([]);
  });

  it('traitの宣言と足し合わせる。trait由来が先で、重複は先に現れた位置を保つ', () => {
    const codex = load(`
traits:
  beast:
    slots:
      injuries: {cell: {accept: {tag: injury}}}
      spoils: {cell: {accept: {tag: item}}}
    visible_slots: [injuries]
object_defs:
  monkey:
    traits: [beast]
    visible_slots: [spoils, injuries]
`);

    expect(visibleNamesOf(codex, 'monkey')).toEqual(['injuries', 'spoils']);
  });

  it('持っていないスロットを指すとエラー（綴り間違いを黙って捨てない）', () => {
    expect(() =>
      load(`
object_defs:
  raft:
    slots:
      structure: {cell: {accept: {tag: sail}}}
    visible_slots: [structrue]
`),
    ).toThrow(YamlLoadError);
  });

  it('重ねて入る先とは独立（見えないスロットへも入れられる）', () => {
    const codex = load(`
object_defs:
  raft:
    slots:
      items: {cell: {accept: {tag: item}}}
      structure: {cell: {accept: {tag: sail}}}
    visible_slots: [structure]
  crate: {tags: [item]}
`);
    const raft = codex.objects.get(codex.objectNames.getId('raft'));
    const crate = codex.objects.get(codex.objectNames.getId('crate'));

    expect(visibleNamesOf(codex, 'raft'), '外から見えるのは帆だけ').toEqual(['structure']);
    expect(
      raft.getSlotDef(codex.slotNames.getId('items'))?.acceptsAnywhere(crate),
      '見えなくても積荷は受け取る',
    ).toBe(true);
  });

  it('placementは、エンジンとプレイヤーのどちらが入れてよいかを別々に言う', () => {
    const codex = load(`
object_defs:
  monkey:
    slots:
      injuries: {cell: {accept: {tag: injury}}}
      spoils: {cell: {accept: {tag: item}}, placement: [auto]}
      pouch: {cell: {accept: {tag: item}}, placement: [manual]}
      sealed: {cell: {accept: {tag: item}}, placement: []}
`);
    const monkey = codex.objects.get(codex.objectNames.getId('monkey'));
    const slot = (name: string) => monkey.getSlotDef(codex.slotNames.getId(name))!;

    expect([slot('injuries').autoPlacement, slot('injuries').manualPlacement], '既定は両方').toEqual([
      true,
      true,
    ]);
    expect([slot('spoils').autoPlacement, slot('spoils').manualPlacement]).toEqual([true, false]);
    expect([slot('pouch').autoPlacement, slot('pouch').manualPlacement]).toEqual([false, true]);
    expect([slot('sealed').autoPlacement, slot('sealed').manualPlacement], '名指しでしか入らない').toEqual([
      false,
      false,
    ]);
  });

  it('placementに知らない指定を書くとエラー', () => {
    expect(() =>
      load(`
object_defs:
  monkey:
    slots:
      spoils: {cell: {accept: {tag: item}}, placement: [engine]}
`),
    ).toThrow(YamlLoadError);
  });

  it('廃止したauto_placementはエラーにする（効いているつもりの宣言を通さない）', () => {
    expect(() =>
      load(`
object_defs:
  character:
    slots:
      equipment: {cell: {accept: {tag: item}}, auto_placement: false}
`),
    ).toThrow(YamlLoadError);
  });

  it('storageはtraitと自分自身のどちらかが名乗れば立つ', () => {
    const codex = load(`
traits:
  item_container:
    storage: true
    slots:
      contents: {cell: {accept: {tag: item}}, capacity: 100}
object_defs:
  basket:
    traits: [item_container]
  raft:
    storage: true
    slots:
      items: {cell: {accept: {tag: item}}, capacity: 500}
  stone: {tags: [item]}
`);
    const isStorage = (name: string) => codex.objects.get(codex.objectNames.getId(name)).isStorage;

    expect(isStorage('basket'), 'trait由来').toBe(true);
    expect(isStorage('raft'), '自分自身').toBe(true);
    expect(isStorage('stone'), '既定は入れ物ではない').toBe(false);
  });
});
