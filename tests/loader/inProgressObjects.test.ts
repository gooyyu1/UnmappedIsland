import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { WorldObject } from '../../src/domain/runtime/WorldObject';
import { WorldSession } from '../../src/domain/runtime/WorldSession';

/**
 * レシピから自動生成される製作中オブジェクト（RecipeSystem.md 1節）の検証。
 */
describe('製作中オブジェクトの自動生成', () => {
  // 2工程以上のレシピは、進捗バー用のfinished_stepsにprogress_gaugeタグを付けて生成する
  // （inProgressObjects.ts）ため、このタグを宣言しておく必要がある。
  const AXE = `
property_tags:
  progress_gauge:
object_defs:
  ground:
    slots:
      items:
        cell: {accept: {tag: item}}
  wood:
    tags: [item]
  stone_knife:
    tags: [item, cutting_tool]
  axe:
    tags: [item, tool]
    recipes:
      basic:
        steps:
          - requires:
              - {object: wood, count: 2, consume: true}
              - {object: stone_knife, consume: false}
            duration: 30
          - requires:
              - {object: wood, count: 1, consume: true}
            duration: 10
`;

  const load = (yaml: string) => new WorldCodexYamlLoader().load('core.yaml', yaml).build();

  it('レシピごとに1つ生成され、完成品のタグとwipを持つ', () => {
    const codex = load(AXE);
    const def = codex.objects.get(codex.objectNames.getId(inProgressObjectName('axe', 'basic')));

    const tagNames = def.tags.map((id) => codex.tagNames.getName(id));
    expect(tagNames, '完成品のタグを引き継ぐ（枠のacceptを通るため）').toContain('item');
    expect(tagNames).toContain('tool');
    expect(tagNames, '機能判定で除外できるようwipが付く').toContain('wip');
    expect(def.stackable, '進捗も中身も個体ごとに違うので束ねない').toBe(false);
  });

  it('素材と道具が同じスロットに並び、枠の上限は全工程の要求の合計になる', () => {
    const codex = load(AXE);
    const def = codex.objects.get(codex.objectNames.getId(inProgressObjectName('axe', 'basic')));

    const slot = def.slotDefs.find((s) => s.name === 'materials');
    expect(slot, '素材と道具は同じスロットへ入れる').toBeDefined();
    expect(slot!.cellCount, '要求する型の数だけ枠が並ぶ').toBe(2);

    const wood = codex.objects.get(codex.objectNames.getId('wood'));
    const knife = codex.objects.get(codex.objectNames.getId('stone_knife'));
    const cells = [slot!.cellAt(0), slot!.cellAt(1)];

    // 木は2つの工程が合わせて3個要求する。道具は消費されないので1個。
    expect(cells.find((cell) => cell.accepts(wood))?.max).toBe(3);
    expect(cells.find((cell) => cell.accepts(knife))?.max).toBe(1);
  });

  it('進捗が工程の合計時間を超えると、完成品が生まれて自分は消える', () => {
    const codex = load(AXE);
    const session = new WorldSession(codex);
    const ground = new WorldObject(0, codex.objects.get(codex.objectNames.getId('ground')), session);

    const wip = session.spawn(codex.objectNames.getId(inProgressObjectName('axe', 'basic')));
    expect(wip.moveToSlot(ground, codex.slotNames.getId('items'))).toBeUndefined();

    // 工程の合計は30 + 10 = 40分。超えた瞬間にon_overflowが発火する。
    wip.setNumber(codex.propertyNames.getId('progress'), 41, session);

    const names = ground
      .tryGetSlot(codex.slotNames.getId('items'))!
      .contents.map((object) => object.def.name);
    expect(names, '完成した斧が、製作中オブジェクトのいた場所へ置き換わる').toEqual(['axe']);
  });

  it('著者が同じ名前の型を宣言していると重複エラーになる', () => {
    const yaml = `${AXE}
  axe__basic:
    tags: [item]
`;
    expect(() => load(yaml)).toThrow(YamlLoadError);
  });

  it('レシピが1つも無ければ何も生成しない', () => {
    const codex = load(`
object_defs:
  stone:
    tags: [item]
`);
    expect(codex.objectNames.tryGetId('stone__basic')).toBeUndefined();
  });
});
