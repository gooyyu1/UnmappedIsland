import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import type { ReferenceRoot } from '../domain/defs/ReferenceRoot';
import type { WorldObject } from '../domain/runtime/WorldObject';
import type { Localization } from '../locale/Localization';
import { IN_PROGRESS_TAG, inProgressObjectName } from '../loader/inProgressObjects';
import type { Rect } from './layout/ScreenMetrics';
import type { RecipeCategory, RecipeEntry } from './ui/RecipeWindow';

/** 解放条件に理由（reason、14.6節）が書かれていないときに出す、代わりの1行。 */
const LOCKED = 'まだ作り方が分からない';

/** 完成品のカードの絵が無いときに代わりに出す絵文字。 */
const PRODUCT_ICON = '📦';

/**
 * レシピ一覧に並べるカテゴリを組み立てる（RecipeSystem.md）。
 *
 * カテゴリは**完成品のタグ**で、1つのレシピは自分の持つタグすべてのタブに現れる。タグは型の
 * グループを指す唯一の手段なので、分類のために別の語彙を持ち込まない。
 */
export function recipeCategories(
  game: NewGameSession,
  codex: WorldCodex,
  locale: Localization,
  onSelect: (inProgressDefGlobalId: number, origin: Rect) => void,
): readonly RecipeCategory[] {
  const wipTagId = codex.tagNames.tryGetId(IN_PROGRESS_TAG);
  const resolveRoot = actorOnly(game.player.instance);

  /** タグのグローバルID → そのタグを持つ完成品のレシピ。タグの宣言順で並ぶ。 */
  const byTag = new Map<number, RecipeEntry[]>();

  for (let globalId = 0; globalId < codex.objects.count; globalId++) {
    const product = codex.objects.get(globalId);
    if (product.recipes.length === 0) continue;

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

      for (const tagId of product.tags) {
        if (tagId === wipTagId) continue;
        const entries = byTag.get(tagId);
        if (entries === undefined) byTag.set(tagId, [entry]);
        else entries.push(entry);
      }
    }
  }

  return [...byTag.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tagId, entries]) => ({ label: codex.tagNames.getName(tagId), entries }));
}

/**
 * 解放条件が参照できるのはactorだけ（GameElementDefinition.md 13.3節）。まだ成果物の
 * インスタンスが無いため、self/parent/ancestorは解決先を持たない。
 */
function actorOnly(actor: WorldObject): (root: ReferenceRoot) => WorldObject | undefined {
  return (root) => (root === 'actor' ? actor : undefined);
}
