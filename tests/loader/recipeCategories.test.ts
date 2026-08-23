import { describe, expect, it } from 'vitest';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';

/** レシピ一覧の棚の宣言（`recipe_categories`、Windows.md 9.2節）のロードに対する自動テスト。 */
describe('recipe_categories', () => {
  function build(...files: string[]): WorldCodex {
    const loader = new WorldCodexYamlLoader();
    files.forEach((yaml, index) => loader.load(`file${index}.yaml`, yaml));
    return loader.buildAndReset();
  }

  const namesOf = (codex: WorldCodex): string[] =>
    codex.recipeCategoryTagIdsByPriority.map((tagId) => codex.tagNames.getName(tagId));

  it('宣言した順に並ぶ（タグを1つも使っていないファイルでも、名前は登録される）', () => {
    expect(namesOf(build('recipe_categories: [tool, container, item]'))).toEqual([
      'tool',
      'container',
      'item',
    ]);
  });

  it('ファイルをまたいで足せる。重複は先に宣言された位置を保つ', () => {
    const codex = build('recipe_categories: [tool, item]', 'recipe_categories: [container, tool]');

    expect(namesOf(codex)).toEqual(['tool', 'item', 'container']);
  });

  it('宣言が無ければ棚も無い（レシピ一覧は全部その他になる）', () => {
    expect(build('object_defs:\n  stone: {}\n').recipeCategoryTagIdsByPriority).toEqual([]);
  });
});
