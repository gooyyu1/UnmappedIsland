import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * 用途のタグ（food・container・liquid_container・tool）が、物の現実と食い違っていないかの自動テスト。
 *
 * **付け忘れは画面を見ても気付けない**——タグの無い物はエラーにならず、素材と同じ既定の枠で静かに
 * 出るだけなので、食べられるのに食事のタグを持たない物をここで捕まえる（CardView.md 2.1節）。
 */
describe('用途のタグ', () => {
  let codex: WorldCodex;
  let defs: readonly ObjectDef[];

  beforeAll(() => {
    // 用途のタグはファイルをまたいで付くので、ディレクトリ全体を一括ロードする。
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    defs = Array.from({ length: codex.objects.count }, (_, globalId) => codex.objects.get(globalId));
  });

  it('口に入れると体の値が動く物には、食事のタグが付いている', () => {
    const foodTagId = codex.tagNames.getId('food');
    const itemTagId = codex.tagNames.getId('item');
    const satietyId = codex.propertyNames.getId('satiety');
    const hydrationId = codex.propertyNames.getId('hydration');

    // 自分の操作が「自分以外」（＝食べる本人）の満腹度か水分を動かすなら、それは口に入る物
    // （affectsの第2引数がfalse＝宣言元の物のプロパティではない、ActiveEffect参照）。
    const feedsTheEater = (def: ObjectDef): boolean =>
      [...def.actions, ...def.combinations].some((interaction) =>
        interaction.hasEffectMatching(
          (effect) => effect.affects(satietyId, false) || effect.affects(hydrationId, false),
        ),
      );
    // カードとして並ぶ物だけを見る。液体そのもの（水・茶）は容器のカードが代表するので、枠の色を持たない。
    const edible = defs.filter((def) => def.tags.includes(itemTagId) && feedsTheEater(def));

    expect(edible.length).toBeGreaterThan(0);
    expect(edible.filter((def) => !def.tags.includes(foodTagId)).map((def) => def.name)).toEqual([]);
  });

  it('レシピを持つ物には、レシピ一覧の棚のタグが1つは付いている', () => {
    // 棚に載らない完成品は画面で「その他」へ落ちる（Windows.md 9.2節）。UIは落ちても壊れないが、
    // 同梱データでそれが起きるのは棚（recipe_categories）の付け忘れなので、ここで捕まえる。
    const craftable = defs.filter((def) => def.recipes.length > 0);

    expect(craftable.length).toBeGreaterThan(0);
    expect(
      craftable
        .filter((def) => !codex.recipeCategoryTagIds.some((tagId) => def.tags.includes(tagId)))
        .map((def) => def.name),
    ).toEqual([]);
  });

  it('液体の容器には、入れ物のタグが付いている', () => {
    const liquidContainerTagId = codex.tagNames.getId('liquid_container');
    const contentSlotId = codex.slotNames.getId('content');
    // 中身の液体を代表にしている（represented_by: content）のが液体の容器（LiquidContainerSystem.md 3節）。
    const containers = defs.filter((def) => def.representedBySlotGlobalId === contentSlotId);

    expect(containers.length).toBeGreaterThan(0);
    expect(
      containers.filter((def) => !def.tags.includes(liquidContainerTagId)).map((def) => def.name),
    ).toEqual([]);
  });
});
