import type { WorldCodex } from '../domain/WorldCodex';

/** 行動の可否を決める明るさが名乗るプロパティタグ（GameElementDefinition.md 6.7節）。 */
const ACTION_BRIGHTNESS_TAG = 'action_brightness';

/**
 * 行動の可否を決める明るさ（IlluminationSystem.md 2節）のプロパティ名を、宣言のタグ
 * （`action_brightness`）から数える。**読む側はこの一覧を書き写さない**——明るさを足した宣言が
 * 解析と検査のすべてへ届くのは、ここを通るときだけ（同 2節）。
 *
 * 型をまたいで同じ名前は1つに数える（宣言順）。1つも無ければ例外にする——空の一覧を受け取った側は、
 * 何も見ずに緑になる。
 *
 * **タグは `tryGetId` で引く**（`PlayScreenView` の `STATUS_TAG` と同じ）。`WorldVocabulary` のように
 * intern すると、宣言していない世界のプロパティタグの名前空間にも、誰も宣言していない名前が載る。
 */
export function actionBrightnessPropertiesOf(codex: WorldCodex): readonly string[] {
  const tagId = codex.propertyTagNames.tryGetId(ACTION_BRIGHTNESS_TAG);
  const names = new Set<string>();
  if (tagId !== undefined)
    for (const objectDef of codex.objects)
      for (const propertyDef of objectDef.enumeratePropertyDefs())
        if (propertyDef.hasTag(tagId)) names.add(propertyDef.name);

  if (names.size === 0)
    throw new Error(
      `${ACTION_BRIGHTNESS_TAG} のタグを持つプロパティが1つもありません（IlluminationSystem.md 2節）。`,
    );
  return [...names];
}
