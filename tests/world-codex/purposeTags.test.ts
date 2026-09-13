import { beforeAll, describe, expect, it } from 'vitest';
import { craftingStepsOf } from '../../src/analysis/craftingSteps';
import { writesToProperty } from '../../src/codex-viewer/describe/effectQueries';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { bundledCodex } from '../support/worldCodexFiles';

/**
 * 用途のタグが、物の現実と食い違っていないかの自動テスト。**食い違いは両向きに起きる**——名乗って
 * いないのにそう振る舞う物と、名乗っただけで何もできない物の両方をここで捕まえる。
 *
 * **どちらも画面を見ても気付けない**——タグの無い物はエラーにならず、素材と同じ既定の枠で静かに
 * 出るだけで（CardView.md 2.1節）、名乗りだけの物は操作が1つ出ないだけだから。
 */
describe('用途のタグ', () => {
  let codex: WorldCodex;
  let defs: readonly ObjectDef[];

  beforeAll(() => {
    // 用途のタグはファイルをまたいで付くので、ディレクトリ全体を一括ロードする。
    codex = bundledCodex();
    defs = [...codex.objects];
  });

  it('口に入れると体の値が動く物には、食事のタグが付いている', () => {
    const foodTagId = codex.tagNames.getId('food');
    const itemTagId = codex.tagNames.getId('item');
    const satietyId = codex.propertyNames.getId('satiety');
    const hydrationId = codex.propertyNames.getId('hydration');

    // 自分の操作が「自分以外」（＝食べる本人）の満腹度か水分を動かすなら、それは口に入る物
    // （writesToPropertyの第3引数がfalse＝宣言元の物のプロパティではない、effectQueries参照）。
    const feedsTheEater = (def: ObjectDef): boolean =>
      def.triggers.some(
        (trigger) =>
          writesToProperty(trigger.interaction, satietyId, false) ||
          writesToProperty(trigger.interaction, hydrationId, false),
      );
    // カードとして並ぶ物だけを見る。**液体の容器は除く**——飲めるのは中身であって、枠の色が言うのは
    // その物が何であるか（器は器）。水入りの水筒は食べ物の枠では出ない（CardView.md 2.1節）。
    const liquidContainerTagId = codex.tagNames.getId('liquid_container');
    const edible = defs.filter(
      (def) => def.tags.includes(itemTagId) && !def.tags.includes(liquidContainerTagId) && feedsTheEater(def),
    );

    expect(edible.length).toBeGreaterThan(0);
    expect(edible.filter((def) => !def.tags.includes(foodTagId)).map((def) => def.name)).toEqual([]);
  });

  it('レシピを持つ物には、レシピ一覧の棚のタグが1つは付いている', () => {
    // 棚に載らない完成品は画面で「その他」へ落ちる（Windows.md 9.2節）。UIは落ちても壊れないが、
    // 同梱データでそれが起きるのは棚（recipe_categories）の付け忘れなので、ここで捕まえる。
    const craftable = defs.filter((def) => def.recipesProducingThis.length > 0);

    expect(craftable.length).toBeGreaterThan(0);
    expect(
      craftable
        .filter((def) => !codex.recipeCategoryTagIdsByPriority.some((tagId) => def.tags.includes(tagId)))
        .map((def) => def.name),
    ).toEqual([]);
  });

  it('液体の容器には、入れ物のタグが付いている', () => {
    const liquidContainerTagId = codex.tagNames.getId('liquid_container');
    const liquidTagId = codex.tagNames.getId('liquid');
    // 中身の液体をtraitとして配られた変種が、中身入りの容器（LiquidContainerSystem.md 2節）。
    // 配る側の束（water_liquid等）はインスタンスにならないので見ない。
    const containers = defs.filter((def) => codex.isGenerated(def) && def.tags.includes(liquidTagId));

    expect(containers.length).toBeGreaterThan(0);
    expect(
      containers.filter((def) => !def.tags.includes(liquidContainerTagId)).map((def) => def.name),
    ).toEqual([]);
  });

  it('水源のタグを持つ物には、器へ水を渡す口が1つはある', () => {
    // **名乗るだけの水源を捕まえる**——見つかっても何も返さない設置物は、探索の当たりとして出て
    // しまう（湧き水がそうだった。docs/engine/LiquidContainerSystem.md 10節）。
    //
    // 口かどうかは工程の産物で見る。ドラッグで相手を変える操作（become）は、行き先の型を生む工程
    // として読まれる（CraftingStep）ので、器の型を名指ししていなくても産物から分かる。
    const waterSourceTagId = codex.tagNames.getId('water_source');
    const waterTagId = codex.tagNames.getId('water');
    const sources = defs.filter((def) => def.tags.includes(waterSourceTagId));

    const yieldsWater = (def: ObjectDef): boolean =>
      craftingStepsOf(codex, def).some((step) =>
        step.outputs.some((output) => codex.objects.get(output.objectGlobalId).hasTag(waterTagId)),
      );

    expect(sources.length).toBeGreaterThan(0);
    expect(sources.filter((def) => !yieldsWater(def)).map((def) => def.name)).toEqual([]);
  });
});
