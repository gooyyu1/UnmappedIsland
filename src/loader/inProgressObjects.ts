import { stringify } from 'yaml';
import type { ObjectDef } from '../domain/defs/ObjectDef';
import type { NameRegistry } from '../domain/defs/NameRegistry';

/** 生成した定義の出所として、エラーメッセージに出す名前。 */
export const IN_PROGRESS_SOURCE = '<製作中オブジェクトの自動生成>';

/** 製作中であることを表すタグ。完成品のタグを引き継ぐため、機能判定はこのタグで除外する。 */
export const IN_PROGRESS_TAG = 'wip';

/** 進捗を持つプロパティ名。工程の所要時間の合計が上限になる。 */
export const PROGRESS_PROPERTY = 'progress';

/**
 * 終えた工程の数を持つプロパティ名（工程が2つ以上のレシピにだけ宣言する）。`progress`が工程の
 * 所要時間で動くのに対し、こちらは工程を1つ終えるたびに1増える純粋な回数なので、`range`に対する
 * 割合（`gauge`宣言、CardView.md 10.1節）がそのまま「終えた工程の数 ÷ 全工程数」になる。
 * `progress`と役割が重なるが、`progress`は所要時間で完成（on_overflow）を起こす側なので、
 * 表示専用の割合をここへ分ける（時間の不揃いな工程では両者の割合が一致しないため）。
 */
export const FINISHED_STEPS_PROPERTY = 'finished_steps';

/** 素材と道具をまとめて入れるスロット名。 */
export const MATERIALS_SLOT = 'materials';

/**
 * 製作中オブジェクトの型の名前（RecipeSystem.md 1節）。人間もMOD作成者もこの型を直接書かないため、
 * 読みやすさより衝突しにくさを優先して完成品とレシピの両方を含める。著者が同じ名前を宣言していた
 * 場合は、通常の重複としてロード時エラーになる（addUnique）。
 */
export function inProgressObjectName(productName: string, recipeName: string): string {
  return `${productName}${NAME_SEPARATOR}${recipeName}`;
}

/** inProgressObjectNameで組み立てた名前から、完成品のグローバルIDを取り出す。 */
export function productGlobalIdOf(inProgressName: string, objectNames: NameRegistry): number {
  return objectNames.getId(inProgressName.slice(0, inProgressName.lastIndexOf(NAME_SEPARATOR)));
}

const NAME_SEPARATOR = '__';

/**
 * レシピを持つ型から、製作中オブジェクトの`object_defs`をYAMLとして組み立てる。レシピが1つも
 * 無ければundefined。
 *
 * 生成した定義を直接ObjectDefとして組み立てず、YAMLに戻してローダーへ食わせているのは、
 * 人が書いた定義とまったく同じ検証を通すため。
 */
export function inProgressObjectsYaml(
  defs: readonly ObjectDef[],
  tagNames: NameRegistry,
  objectNames: NameRegistry,
): string | undefined {
  const objectDefs: Record<string, unknown> = {};

  for (const def of defs)
    for (const recipe of def.recipes)
      objectDefs[inProgressObjectName(def.name, recipe.name)] = inProgressObjectDef(
        def,
        recipe,
        tagNames,
        objectNames,
      );

  if (Object.keys(objectDefs).length === 0) return undefined;
  return stringify({ object_defs: objectDefs });
}

function inProgressObjectDef(
  product: ObjectDef,
  recipe: ObjectDef['recipes'][number],
  tagNames: NameRegistry,
  objectNames: NameRegistry,
): Record<string, unknown> {
  const totalMinutes = recipe.steps.reduce((sum, step) => sum + step.durationMinutes, 0);

  return {
    // 完成品のタグを引き継ぐ（RecipeSystem.md 5節）。枠のacceptがタグで書かれている場所へ、
    // 完成させる前に置けるようにするため。機能しているかの判定はwipタグで除外する。
    tags: [...product.tags.map((id) => tagNames.getName(id)), IN_PROGRESS_TAG],
    // 個体ごとに進捗も中身も違うので束ねない（SlotSystem.md 4節）。
    stackable: false,
    // カードを押したとき、材料スロットの中身をレーンに並べる（7.8節）。
    main_item_slot: MATERIALS_SLOT,
    props: {
      [PROGRESS_PROPERTY]: {
        value: 0,
        // 完成はrangeの上限を超えた瞬間に起こす。stagesのpassivesにはspawn/destroyを書けない
        // （GameElementDefinition.md 9.7節・10節）ため、段ではなくrangeイベントで表す。
        //
        // 上限を合計より1つ内側に置くのは、境界値ちょうどでは発火しないため（同6.3節）。
        // 全工程を終えると進捗は合計と等しくなるので、そこが上限だと完成しない。
        range: { min: 0, max: totalMinutes - 1 },
        on_overflow: {
          destroy: 'self',
          // intoを省略しているので、自分がいたスロットへ完成品が生まれる（9.4節）。
          spawn: { object: product.name },
        },
      },
      // 工程が1つのレシピでは、この値が動く前に最初の作業でそのまま完成してカードが入れ替わるので、
      // そもそも宣言しない（CardView.md 10.1節）。「gaugeを宣言したプロパティが無ければバーも
      // 出ない」という1つの規約だけで「工程が1つなら出さない」まで決まり、UI側は工程数を意識しない。
      ...(recipe.steps.length >= 2
        ? {
            [FINISHED_STEPS_PROPERTY]: {
              // 良し悪しではなく「ここまで終えた」量なので、両端とも良し悪しを言わない（1色で塗る）。
              gauge: { min: 'neutral', max: 'neutral' },
              value: 0,
              // 完成した瞬間にこの物自体が消える（progressのon_overflow）ため、rangeの上限
              // （全工程数）そのものへ到達したあとを気にする必要がない。progressと違い、
              // 境界を1つ内側へ避ける調整は要らない。
              range: { min: 0, max: recipe.steps.length },
            },
          }
        : {}),
    },
    slots: {
      // 素材も道具も同じスロットへ入れる。何が何個要るかが、そのまま枠の形になる
      // （RecipeSystem.md 3節）。
      [MATERIALS_SLOT]: {
        cells: materialCells(recipe, objectNames),
        // 自動配置（7.7節）から外す。終わった工程の枠は表示から消すので、そこへ勝手に物が
        // 入ると取り出せなくなる。入れるのは投入操作と自動補充だけに限る。
        auto_placement: false,
      },
    },
  };
}

/**
 * 全工程の要求を型ごとにまとめた枠の並び。同じ型を複数の工程が要求する場合は、合計を1つの枠の
 * `max`にする（枠は「置ける場所」なので、上限は要求の合計で足りる）。
 */
function materialCells(
  recipe: ObjectDef['recipes'][number],
  objectNames: NameRegistry,
): Array<Record<string, unknown>> {
  const totalByObject = new Map<number, number>();
  for (const step of recipe.steps)
    for (const requirement of step.requirements)
      totalByObject.set(
        requirement.objectGlobalId,
        (totalByObject.get(requirement.objectGlobalId) ?? 0) + requirement.count,
      );

  return [...totalByObject].map(([objectGlobalId, max]) => ({
    accept: { object: objectNames.getName(objectGlobalId) },
    max,
  }));
}
