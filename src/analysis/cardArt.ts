import { artUrl } from '../art/objectArt';
import type { ObjectDef } from '../domain/ObjectDef';
import { RECIPE_AXIS } from '../domain/RecipeDef';
import type { WorldCodex } from '../domain/WorldCodex';

/**
 * 札に**自分の**絵（`src/assets/objects/<絵の名前>.png`、objectArt.ts）を映す型。宣言順。
 * 絵を描く相手になるのはこれだけで、次の型は外れる。
 *
 * - **生成型**（作りかけ・中身入り、GameElementDefinition.md 3.5節）——札に出るが、映すのは素の型の絵
 *   （cardLooks.artNameOf）。
 * - **変種の軸の値**（3.5.1節）——軸の先の変種へtraitを配るだけで、この型自身の個体は作られない。
 * - **世界そのもの**——すべての物を抱える根で、どのスロットにも入らない。
 */
export function typesShowingOwnArtOnCard(codex: WorldCodex): ObjectDef[] {
  const axisValueNames = variationAxisValueNames(codex);
  const worldName = codex.vocabulary.world.worldObject;
  return [...codex.objects].filter(
    (def) => !codex.isGenerated(def) && !axisValueNames.has(def.name) && def.name !== worldName,
  );
}

/**
 * 札に自分の絵を映す型のうち、その絵がまだ無いもの。札には種別の代役アイコンで出る（cardLooks.iconOf）
 * ——ロードも画面も通るので、ここで数えないと足りていないことに気付けない。
 */
export function typesMissingCardArt(codex: WorldCodex): ObjectDef[] {
  return typesShowingOwnArtOnCard(codex).filter((def) => artUrl(def.artName) === undefined);
}

/**
 * どこかの変種の軸の値になっている型の名前。**作りかけの軸は外す**——その値はレシピの名前で、型ではない
 * （RecipeSystem.md 1節）。
 */
function variationAxisValueNames(codex: WorldCodex): Set<string> {
  const names = new Set<string>();
  for (const def of codex.objects) {
    for (const [axis, value] of codex.variationsOf(def)) if (axis !== RECIPE_AXIS) names.add(value);
  }
  return names;
}
