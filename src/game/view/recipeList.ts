import type { WorldCodex } from '../../domain/WorldCodex';
import type { NewGameSession } from '../../domain/generation/NewGame';
import type { RecipeDef } from '../../domain/RecipeDef';
import type { ReferenceRoot } from '../../domain/ReferenceRoot';
import type { WorldObject } from '../../domain/WorldObject';
import type { Localization } from '../../locale/Localization';
import { inProgressObjectName } from '../../loader/inProgressObjects';
import type { Rect } from '../../ui/Rect';
import type { RecipeCategory, RecipeEntry } from '../ui/RecipeWindow';

/** 解放条件に理由（reason、14.6節）が書かれていないときに出す、代わりの1行。 */
const LOCKED = 'まだ作り方が分からない';

/** どの棚のタグも持たない完成品を集める、最後の棚の見出し。 */
const OTHER = 'その他';

/** 完成品のカードの絵が無いときに代わりに出す絵文字。 */
const PRODUCT_ICON = '📦';

/**
 * その製作中オブジェクトが従っているレシピ（製作中オブジェクトでなければundefined）。
 *
 * 型自身はどのレシピから生まれたかを持てない（YAMLの語彙に無い、WorldCodex.productOf参照）ので、
 * 完成品のレシピのうち、生成した型名（inProgressObjectName）が一致するものを引く。
 */
export function recipeOf(target: WorldObject, codex: WorldCodex): RecipeDef | undefined {
  const product = codex.productOf(target.def);
  return product?.recipes.find(
    (candidate) => inProgressObjectName(product.name, candidate.name) === target.def.name,
  );
}

/**
 * レシピ一覧に並べる棚を組み立てる（Windows.md 9節）。
 *
 * 棚は**完成品のタグ**で、どのタグを棚にするかと、その並びは `recipe_categories` が持つ。タグは型の
 * グループを指す唯一の手段なので、分類のために別の語彙を持ち込まない。
 *
 * **1つの完成品が載る棚は1つだけ。** 物は用途のぶんだけタグを持つ（石斧は道具でも刃物でも武器でも
 * ある）ので、持っているタグ全部の棚に載せると、同じ札が何度も並ぶ。宣言の並びで最初に一致した
 * 棚を採り、どれにも当たらない物は「その他」へ落とす。
 */
export function recipeCategories(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
  onSelect: (inProgressDefGlobalId: number, origin: Rect) => void,
): readonly RecipeCategory[] {
  const resolveRoot = actorOnly(game.player.instance);

  /** 棚のタグのグローバルID → その棚に載るレシピ。どの棚にも載らないものはothersへ。 */
  const byShelf = new Map<number, RecipeEntry[]>();
  const others: RecipeEntry[] = [];

  for (let globalId = 0; globalId < codex.objects.count; globalId++) {
    const product = codex.objects.get(globalId);
    if (product.recipes.length === 0) continue;

    const shelfTagId = codex.recipeCategoryTagIds.find((tagId) => product.tags.includes(tagId));

    for (const recipe of product.recipes) {
      const unmet = recipe.unmetUnlockRequirement(resolveRoot);
      const inProgressId = codex.objectNames.tryGetId(inProgressObjectName(product.name, recipe.name));
      if (inProgressId === undefined) continue;

      const entry: RecipeEntry = {
        card: {
          icon: PRODUCT_ICON,
          name: locale.object(product.name).displayName,
          art: product.name,
        },
        lockedReason:
          unmet === undefined
            ? undefined
            : ((unmet.reasonName === undefined ? undefined : locale.reason(unmet.reasonName)) ?? LOCKED),
        onSelect: (origin) => onSelect(inProgressId, origin),
      };

      if (shelfTagId === undefined) {
        others.push(entry);
        continue;
      }
      const entries = byShelf.get(shelfTagId);
      if (entries === undefined) byShelf.set(shelfTagId, [entry]);
      else entries.push(entry);
    }
  }

  const shelves = codex.recipeCategoryTagIds
    .map((tagId) => ({ label: locale.tag(codex.tagNames.getName(tagId)), entries: byShelf.get(tagId) ?? [] }))
    .filter((shelf) => shelf.entries.length > 0);

  return others.length === 0 ? shelves : [...shelves, { label: OTHER, entries: others }];
}

/**
 * 解放条件が参照できるのはactorだけ（GameElementDefinition.md 13.3節）。まだ成果物の
 * インスタンスが無いため、self/parent/ancestorは解決先を持たない。
 */
function actorOnly(actor: WorldObject): (root: ReferenceRoot) => WorldObject | undefined {
  return (root) => (root === 'actor' ? actor : undefined);
}
