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
  const build = (yaml: string): WorldCodex =>
    new WorldCodexYamlLoader().load('cells.yaml', yaml).buildAndReset();

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
      const bench = session.createObject(codex.objectNames.getId('chair_in_progress'));
      return {
        bench,
        put: (name) =>
          session
            .createObject(codex.objectNames.getId(name))
            .moveToSlotOrRejection(bench.getSlot(materialsId)),
      };
    };

    it('枠の数がそのまま「何を何個」になる', () => {
      const { bench, put } = setUp();

      expect(put('board'), '板は板の枠へ').toBeUndefined();
      for (let i = 0; i < 4; i++) expect(put('stick'), `棒${i + 1}本目`).toBeUndefined();

      expect(put('stick'), '5本目の棒は棒の枠に入らない').toBeDefined();
      expect(put('board'), '2枚目の板も入らない（棒の枠は板を受け入れない）').toBeDefined();

      const cells = bench.tryGetSlot(materialsId)?.cells ?? [];
      expect(cells.map((cell) => cell.stack?.members.length)).toEqual([1, 4]);
    });

    it('枠は宣言順に埋まらず、型の合う枠へ入る', () => {
      const { bench, put } = setUp();

      expect(put('stick')).toBeUndefined();

      const cells = bench.tryGetSlot(materialsId)?.cells ?? [];
      expect(cells[0].isEmpty, '板の枠は空いたまま').toBe(true);
      expect(cells[1].stack?.members.map((o) => o.def.name)).toEqual(['stick']);
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
      const shelf = session.createObject(codex.objectNames.getId('shelf'));
      return Array.from({ length: count }, () =>
        session.createObject(codex.objectNames.getId(name)).moveToSlotOrRejection(shelf.getSlot(thingsId)),
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

  /**
   * 空き枠が画面へ名乗る型（`typesShownInEmptyCells`、docs/ui/CardView.md 11節）。**名乗るのは、
   * 同じ並びの中で枠によって受け入れの宣言が違うときだけ**——どの枠も同じなら、そこへ何が入るかは
   * その場所そのものが既に言っている。
   */
  describe('空き枠が名乗る型', () => {
    const names = (codex: WorldCodex, ownerName: string, slotName: string): readonly string[][] => {
      const owner = codex.objects.get(codex.objectNames.getId(ownerName));
      const slotDef = owner.tryGetSlotDef(codex.slotNames.getId(slotName))!;
      return codex
        .typesShownInEmptyCells(slotDef)
        .map((types) => types.map((id) => codex.objects.get(id).name));
    };

    // 炉の火床（docs/engine/FireSystem.md 1.1節）。火の中の枠は焼く物だけ、石の上の枠は器だけを受ける。
    const hearth = build(`
object_defs:
  three_stone_hearth:
    slots:
      fire:
        cells:
          - {accept: {tag: roastable}}
          - {accept: {tag: cookware}}
  raw_meat: {tags: [roastable]}
  taro: {tags: [roastable]}
  clay_pot: {tags: [cookware]}
`);

    it('枠によって受け入れの宣言が違えば、その枠が受ける型を名乗る', () => {
      expect(names(hearth, 'three_stone_hearth', 'fire')).toEqual([['raw_meat', 'taro'], ['clay_pot']]);
    });

    it('絵にならない受け入れは名乗らない', () => {
      // 何でも受ける枠と、否定で書かれた枠。どちらも「当てはまる型すべて」が世界の札とほぼ同じに
      // なるので、順に送っても何も絞られない。
      const bench = build(`
object_defs:
  bench:
    slots:
      things:
        cells:
          - {}
          - {accept: {not: {tag: quarry}}}
          - {accept: {tag: gear}}
  boar: {tags: [quarry]}
  helmet: {tags: [gear]}
`);

      expect(names(bench, 'bench', 'things')).toEqual([[], [], ['helmet']]);
    });

    it('どの枠も同じものを受けるなら、何も名乗らない', () => {
      // 焚き火の火床。枠は2つあるが、どちらも焼く物を受けるので、枠が言えることは並びと同じ。
      const campfire = build(`
object_defs:
  campfire:
    slots:
      fire:
        cells:
          - {accept: {tag: roastable}}
          - {accept: {tag: roastable}}
  raw_meat: {tags: [roastable]}
`);

      expect(names(campfire, 'campfire', 'fire')).toEqual([]);
    });

    it('枠数を宣言していないスロットは、枠ごとの違いを持てないので何も名乗らない', () => {
      const ground = build(`
object_defs:
  ground:
    slots:
      items:
        cell: {accept: {tag: item}}
  stone: {tags: [item]}
`);

      expect(names(ground, 'ground', 'items')).toEqual([]);
    });

    it('単独で在れない型は、探してくる先が無いので名乗らない', () => {
      const body = build(`
object_defs:
  body:
    slots:
      parts:
        cells:
          - {accept: {tag: organ}}
          - {accept: {tag: gear}}
  heart: {tags: [organ], bound_to_owner: true}
  prosthetic: {tags: [organ]}
  helmet: {tags: [gear]}
`);

      expect(names(body, 'body', 'parts'), '心臓は挙がらない').toEqual([['prosthetic'], ['helmet']]);
    });
  });
});
