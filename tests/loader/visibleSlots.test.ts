import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';

/** 外から中身が見えるスロットの宣言（`visible_slots`、GameElementDefinition.md 7.11節）のロード。 */
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

  it('main_item_slotとは独立（重ねて入る先と、外から見えるかは別）', () => {
    const codex = load(`
object_defs:
  raft:
    slots:
      items: {cell: {accept: {tag: item}}}
      structure: {cell: {accept: {tag: sail}}}
    main_item_slot: items
    visible_slots: [structure]
`);
    const raft = codex.objects.get(codex.objectNames.getId('raft'));

    expect(codex.slotNames.getName(raft.mainItemSlotGlobalId!), '重ねた物は積荷へ').toBe('items');
    expect(visibleNamesOf(codex, 'raft'), '外から見えるのは帆だけ').toEqual(['structure']);
  });
});
