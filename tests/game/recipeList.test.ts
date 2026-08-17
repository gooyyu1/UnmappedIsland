import { beforeAll, describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { start as startNewGame } from '../../src/domain/generation/NewGame';
import { recipeCategories } from '../../src/game/view/recipeList';
import { bundledLocaleText, LOCALE_FILE, parseLocale } from '../../src/locale/Localization';
import type { Localization } from '../../src/locale/Localization';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { SeededRng } from '../support/SeededRng';
import { loadYamlDirectory, SAMPLE_CHARACTER, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * レシピ一覧の棚の組み立て（Windows.md 9.2節）の自動テスト。**画面を作らずに確かめられる**——
 * 何が何番目の棚に載るかは、タグと`recipe_categories`だけで決まる。
 */
describe('レシピ一覧の棚', () => {
  let locale: Localization;

  beforeAll(() => {
    locale = parseLocale(LOCALE_FILE, bundledLocaleText());
  });

  /** 同梱の定義に、追加のYAMLを1枚だけ足して読む。 */
  const load = (extra?: string): WorldCodex => {
    const loader = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR);
    if (extra !== undefined) loader.load('test.yaml', extra);
    return loader.build();
  };

  const shelves = (codex: WorldCodex) => {
    const game = startNewGame(codex, SAMPLE_CHARACTER, 11, new SeededRng(1234));
    return recipeCategories(game, codex, locale, () => {});
  };

  it('棚の見出しと並びは、recipe_categoriesの宣言順', () => {
    expect(shelves(load()).map((shelf) => shelf.label)).toEqual(['道具', '入れ物', '設備', '持ち物']);
  });

  it('用途のタグを複数持つ物も、最初に一致した棚にだけ載る', () => {
    const codex = load();
    const found = shelves(codex).flatMap((shelf) => shelf.entries.map((entry) => entry.card.name));

    // 石斧はitem・tool・cutting_tool・chopping_tool・weaponを持つが、並ぶのは道具の棚に1枚だけ。
    const axe = locale.object('stone_axe').displayName;
    expect(found.filter((name) => name === axe)).toEqual([axe]);
    expect(new Set(found).size, '同じ完成品が複数の棚に出ない').toBe(found.length);
  });

  it('どの棚のタグも持たない完成品は、その他へ落ちる', () => {
    const codex = load(`
object_defs:
  mystery_charm:
    tags: [charm]
    recipes:
      carved:
        steps:
          - requires: [{object: stone, count: 1, consume: true}]
            duration: 30
`);
    const last = shelves(codex).at(-1);

    expect(last?.label).toBe('その他');
    expect(last?.entries.map((entry) => entry.card.name)).toEqual([
      locale.object('mystery_charm').displayName,
    ]);
  });
});
