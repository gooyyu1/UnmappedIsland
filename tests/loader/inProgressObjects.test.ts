import { describe, expect, it } from 'vitest';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { YamlLoadError } from '../../src/loader/YamlLoadError';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';

/**
 * レシピから自動生成される製作中オブジェクト（RecipeSystem.md 1節）の検証。
 */
describe('製作中オブジェクトの自動生成', () => {
  const AXE = `
in_progress_tags: [item]
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

  const load = (yaml: string) => new WorldCodexYamlLoader().load('core.yaml', yaml).buildAndReset();

  it('レシピごとに1つ生成され、置き場所のタグとwipだけを持つ', () => {
    const codex = load(AXE);
    const def = codex.objects.get(codex.objectNames.getId(inProgressObjectName('axe', 'basic')));

    const tagNames = def.tags.map((id) => codex.tagNames.getName(id));
    expect(tagNames, 'in_progress_tagsのタグは引き継ぐ（枠のacceptを通るため）').toContain('item');
    expect(tagNames, '働きを言うタグは引き継がない').not.toContain('tool');
    expect(tagNames, '作りかけであることの印').toContain('wip');
    expect(def.stackable, '進捗も中身も個体ごとに違うので束ねない').toBe(false);
  });

  it('in_progress_tagsを宣言しない世界では、どのタグも引き継がない', () => {
    // 引き継ぐタグは**その世界が挙げる**（RecipeSystem.md 5節）。挙げていない世界で勝手に引き継ぐと、
    // 置き場所を言うタグと働きを言うタグの区別が付かないまま全部が付く。
    const codex = load(AXE.replace('in_progress_tags: [item]\n', ''));
    const def = codex.objects.get(codex.objectNames.getId(inProgressObjectName('axe', 'basic')));

    expect(def.tags.map((id) => codex.tagNames.getName(id))).toEqual(['wip']);
  });

  it('重さは0で、かさは完成品のものを写す', () => {
    // 重さは材料スロットの中身から導出されるが、かさは導出されない（入れ物のかさは外側の
    // 大きさなので中身を足しても膨らまない）。写さないと容量のある入れ物へ無限に詰め込める。
    const codex = load(`
object_defs:
  wood:
    tags: [item]
  axe:
    tags: [item]
    props:
      weight: {value: 900}
      volume: {value: 6000}
    recipes:
      basic:
        steps:
          - requires: [{object: wood, count: 2, consume: true}]
            duration: 30
`);
    const def = codex.objects.get(codex.objectNames.getId(inProgressObjectName('axe', 'basic')));

    expect(def.tryGetPropertyDef(codex.propertyNames.getId('weight'))!.initialValueWithoutRoll).toBe(0);
    expect(def.tryGetPropertyDef(codex.propertyNames.getId('volume'))!.initialValueWithoutRoll).toBe(6000);
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

    const wip = session.createObject(codex.objectNames.getId(inProgressObjectName('axe', 'basic')));
    expect(wip.moveToSlotOrRejection(ground.getSlot(codex.slotNames.getId('items')))).toBeUndefined();

    // 工程の合計は30 + 10 = 40分。超えた瞬間にon_maxが発火する。
    wip.tryGetProperty(codex.propertyNames.getId('progress'))?.setNumber(41);

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
