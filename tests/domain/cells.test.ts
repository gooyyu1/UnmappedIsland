import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/**
 * 枠（セル）ごとの要件（GameElementDefinition.md 7.2節・SlotSystem.md 2節）に対する自動テスト。
 * 「何が」は枠のaccept、「その枠に何個」は枠のmax、「枠がいくつ」はcell_count/cellsの長さが答える。
 */
describe('枠ごとの要件', () => {
  const build = (yaml: string): WorldCodex => new WorldCodexYamlLoader().load('cells.yaml', yaml).build();

  describe('cells（枠ごとに違う要件）', () => {
    // 椅子のレシピ: 板が1枚と、棒が4本。板の枠に棒は入らないし、その逆も入らない。
    const codex = build(`
object_defs:
  chair_in_progress:
    slots:
      materials:
        cells:
          - {accept: {object: board}, max: 1}
          - {accept: {object: stick}, max: 4}
  board: {}
  stick: {}
`);
    const materialsId = codex.slotNames.getId('materials');

    interface Bench {
      readonly bench: WorldObject;
      put: (name: string) => string | undefined;
    }

    const setUp = (): Bench => {
      const session = new WorldSession(codex);
      const bench = session.spawn(codex.objectNames.getId('chair_in_progress'));
      return {
        bench,
        put: (name) => session.spawn(codex.objectNames.getId(name)).moveToSlot(bench.getSlot(materialsId)),
      };
    };

    it('枠の数がそのまま「何を何個」になる', () => {
      const { bench, put } = setUp();

      expect(put('board'), '板は板の枠へ').toBeUndefined();
      for (let i = 0; i < 4; i++) expect(put('stick'), `棒${i + 1}本目`).toBeUndefined();

      expect(put('stick'), '5本目の棒は棒の枠に入らない').toBeDefined();
      expect(put('board'), '2枚目の板も入らない（棒の枠は板を受け入れない）').toBeDefined();

      const cells = bench.tryGetSlot(materialsId)?.cells ?? [];
      expect(cells.map((cell) => cell?.members.length)).toEqual([1, 4]);
    });

    it('枠は宣言順に埋まらず、型の合う枠へ入る', () => {
      const { bench, put } = setUp();

      expect(put('stick')).toBeUndefined();

      const cells = bench.tryGetSlot(materialsId)?.cells ?? [];
      expect(cells[0], '板の枠は空いたまま').toBeUndefined();
      expect(cells[1]?.members.map((o) => o.def.name)).toEqual(['stick']);
    });

    it('宣言していない型はどの枠にも入らない', () => {
      const { put } = setUp();

      expect(put('chair_in_progress')).toContain('受け入れられません');
    });
  });

  describe('stackable（束ねてよい型か）', () => {
    const codex = build(`
object_defs:
  shelf:
    slots:
      things:
        cell_count: 2
  stone: {}
  basket:
    # 中身が個体ごとに違うので束ねない（SlotSystem.md 4節）。
    stackable: false
`);
    const thingsId = codex.slotNames.getId('things');

    const fill = (name: string, count: number): (string | undefined)[] => {
      const session = new WorldSession(codex);
      const shelf = session.spawn(codex.objectNames.getId('shelf'));
      return Array.from({ length: count }, () =>
        session.spawn(codex.objectNames.getId(name)).moveToSlot(shelf.getSlot(thingsId)),
      );
    };

    it('束ねてよい型は、何個入れても枠を1つしか使わない', () => {
      expect(fill('stone', 5).filter((error) => error !== undefined)).toEqual([]);
    });

    it('束ねない型は、1個ずつ枠を使う', () => {
      const errors = fill('basket', 3);

      expect(errors.slice(0, 2), '2枠ぶんは入る').toEqual([undefined, undefined]);
      expect(errors[2], '3個目は枠が無い').toBeDefined();
    });
  });
});
