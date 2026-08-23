import { stringify } from 'yaml';
import type { ObjectDef } from '../domain/ObjectDef';
import type { GeneratedCoordinate } from '../domain/GeneratedTypes';
import type { GeneratedObjectDefs } from './generatedObjectDefs';
import { NO_AXIS_VALUE } from '../domain/GeneratedTypes';
import type { NameRegistry } from '../domain/NameRegistry';
import { IN_PROGRESS_TAG, RECIPE_AXIS } from '../domain/RecipeDef';
import type { TypeMatchRule } from '../domain/TypeMatchRule';

/** 生成した定義の出所として、エラーメッセージに出す名前。 */
export const IN_PROGRESS_SOURCE = '<製作中オブジェクトの自動生成>';

/**
 * 製作中オブジェクトが持つ単語（宣言はWorldVocabulary）。
 *
 * `finished_steps`は工程が2つ以上のレシピにだけ宣言する。`progress`が工程の所要時間で動くのに対し、
 * こちらは工程を1つ終えるたびに1増える純粋な回数なので、`range`に対する割合（`gauge`宣言、
 * CardView.md 10.1節）がそのまま「終えた工程の数 ÷ 全工程数」になる。`progress`は所要時間で完成
 * （on_max）を起こす側なので、表示専用の割合をこちらへ分ける（時間の不揃いな工程では両者の割合が
 * 一致しないため）。
 */
import {
  FINISHED_STEPS_PROPERTY,
  MATERIALS_SLOT,
  PROGRESS_PROPERTY,
  VOLUME_PROPERTY,
} from '../domain/WorldVocabulary';

/**
 * 製作中オブジェクトの型の名前（RecipeSystem.md 1節）。人間もMOD作成者もこの型を直接書かないため、
 * 読みやすさより衝突しにくさを優先して完成品とレシピの両方を含める。著者が同じ名前を宣言していた
 * 場合は、通常の重複としてロード時エラーになる（addUnique）。
 */
export function inProgressObjectName(productName: string, recipeName: string): string {
  return `${productName}${NAME_SEPARATOR}${recipeName}`;
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
  propertyNames: NameRegistry,
): GeneratedObjectDefs | undefined {
  const objectDefs: Record<string, unknown> = {};
  const coordinates = new Map<string, GeneratedCoordinate>();

  for (const def of defs)
    for (const recipe of def.recipes) {
      const name = inProgressObjectName(def.name, recipe.name);
      objectDefs[name] = inProgressObjectDef(def, recipe, tagNames, objectNames, propertyNames);
      // 素の型は完成品で、軸`recipe`の値がレシピの名前（GameElementDefinition.md 3.5節）。
      coordinates.set(name, {
        baseGlobalId: def.globalId,
        axisValues: new Map([[RECIPE_AXIS, recipe.name]]),
      });
    }

  if (coordinates.size === 0) return undefined;
  return { yaml: stringify({ object_defs: objectDefs }), coordinates };
}

function inProgressObjectDef(
  product: ObjectDef,
  recipe: ObjectDef['recipes'][number],
  tagNames: NameRegistry,
  objectNames: NameRegistry,
  propertyNames: NameRegistry,
): Record<string, unknown> {
  const totalMinutes = recipe.steps.reduce((sum, step) => sum + step.durationMinutes, 0);

  return {
    // 完成品のタグを引き継ぐ（RecipeSystem.md 5節）。枠のacceptがタグで書かれている場所へ、
    // 完成させる前に置けるようにするため。機能しているかの判定はwipタグで除外する。
    tags: [...product.tags.map((id) => tagNames.getName(id)), IN_PROGRESS_TAG],
    // 個体ごとに進捗も中身も違うので束ねない（SlotSystem.md 4節）。
    stackable: false,
    // カードを押したとき、材料スロットの中身をレーンに並べる（7.8節）。
    // 素材の枠は外から見える（7.11節）。何がどれだけ入っているかが、作りかけの札の存在意義そのもの。
    visible_slots: [MATERIALS_SLOT],
    props: {
      // 作りかけそのものには目方が無く、**重さは材料スロットに入っている物がそのまま持つ**
      // （ContainerSystem.md 1節）。完成品のweightを引き継がないのは、まだその形になっていない
      // ため——投入した材料の重さを担ぐことになる。
      weight: { value: 0 },
      // **かさは完成品のものを写す。** 重さと違って中身から導出されない（入れ物のかさは外側の
      // 大きさで、中身を足しても膨らまない）ので、写さないと0になり、容量のある入れ物へ
      // 作りかけを無限に詰め込めてしまう。編みかけの籠は、編み上がった籠とほぼ同じ場所を取る。
      ...declaredVolume(product, propertyNames),
      [PROGRESS_PROPERTY]: {
        value: 0,
        // 完成は進捗が上限（＝工程の所要時間の合計）に達した瞬間に起こす。stagesのpassivesには
        // becomeを書けない（GameElementDefinition.md 9.7節・10節）ため、段ではなくrangeイベントで表す。
        range: { min: 0, max: totalMinutes },
        // レシピの軸を落とした座標＝完成品そのものへ、同じ個体のまま変わる（9.9節・3.5節）。
        // 残った素材はmaterialsスロットごと無くなるので親へこぼれる（RecipeSystem.md 3節）。
        on_max: { become: { [RECIPE_AXIS]: NO_AXIS_VALUE } },
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
              // 完成した瞬間にこの物自体が消える（progressのon_max）ため、rangeの上限
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
        cells: requirementCells(recipe, tagNames, objectNames),
        // 入れるのはプレイヤーの投入操作と自動補充だけ（7.7節）。終わった工程の枠は表示から消すので、
        // エンジンが勝手に選んで入れると取り出せなくなる。
        placement: ['manual'],
      },
    },
  };
}

/** 完成品が宣言しているかさ（volume）を、そのままの形で写した`props`の断片。無ければ空。 */
function declaredVolume(product: ObjectDef, propertyNames: NameRegistry): Record<string, unknown> {
  const declared = product.tryGetPropertyDef(propertyNames.intern(VOLUME_PROPERTY))?.initialValueReading;
  if (declared === undefined) return {};
  return {
    [VOLUME_PROPERTY]: {
      value: declared.kind === 'fixed' ? declared.value : { min: declared.min, max: declared.max },
    },
  };
}

/**
 * 全工程の要求を型ごとにまとめた枠の並び。同じ型を複数の工程が要求する場合は、合計を1つの枠の
 * `max`にする（枠は「置ける場所」なので、上限は要求の合計で足りる）。
 */
function requirementCells(
  recipe: ObjectDef['recipes'][number],
  tagNames: NameRegistry,
  objectNames: NameRegistry,
): Array<Record<string, unknown>> {
  const totals = new Map<string, { match: TypeMatchRule; max: number }>();
  for (const step of recipe.steps)
    for (const requirement of step.requirements) {
      const entry = totals.get(requirement.match.key);
      if (entry === undefined)
        totals.set(requirement.match.key, { match: requirement.match, max: requirement.count });
      else entry.max += requirement.count;
    }

  const names = {
    objectName: (globalId: number) => objectNames.getName(globalId),
    tagName: (globalId: number) => tagNames.getName(globalId),
  };
  return [...totals.values()].map(({ match, max }) => ({ accept: match.toAcceptSpec(names), max }));
}
