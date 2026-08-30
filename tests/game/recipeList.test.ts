import { describe, expect, it } from 'vitest';
import { recipeCategories } from '../../src/game/view/recipeList';
import { parseLocale } from '../../src/locale/Localization';
import { miniGame } from '../support/miniGame';

/**
 * レシピ一覧の棚の組み立て（Windows.md 9.2節）の自動テスト。**画面を作らずに確かめられる**——
 * 何が何番目の棚に載るかは、タグと`recipe_categories`だけで決まる。
 *
 * **同梱の定義は読まない**。棚の並びも「その他」への落とし方も、宣言をこの場で書けば全部言える。
 */
describe('レシピ一覧の棚', () => {
  const locale = parseLocale(
    'ja.yaml',
    `
tag_texts:
  tool: 道具
  weapon: 武器
ui_texts:
  recipe_other: その他
object_texts:
  stone: {display_name: 石}
  stone_axe: {display_name: 石斧}
  charm: {display_name: お守り}
`,
  );

  /** 材料に石を1つ使うだけのレシピ。棚の話に要らない差は付けない。 */
  const recipe = (name: string): string => `
    recipes:
      ${name}:
        steps:
          - requires: [{object: stone, count: 1, consume: true}]
            duration: 30`;

  /** その宣言のもとで棚を組み立てる（載る順に見出しと中身を返す）。 */
  const shelves = (yaml: string) => {
    const mini = miniGame(`
recipe_categories: [tool, weapon]

object_defs:
  stone:
    tags: [item]
${yaml}
`);
    return recipeCategories(mini.game, mini.codex, locale, () => {}).map((shelf) => ({
      label: shelf.label,
      names: shelf.entries.map((entry) => entry.card.name),
    }));
  };

  it('棚の見出しと並びは、recipe_categoriesの宣言順', () => {
    expect(
      shelves(`
  club:
    tags: [item, weapon]${recipe('carved')}
  digging_stick:
    tags: [item, tool]${recipe('carved')}
`).map((shelf) => shelf.label),
      '宣言がtool・weaponの順なので、武器を先に宣言しても道具の棚が先',
    ).toEqual(['道具', '武器']);
  });

  it('用途のタグを複数持つ物も、最初に一致した棚にだけ載る', () => {
    // 石斧は道具でも武器でもあるが、並ぶのは宣言順で先に当たる道具の棚に1枚だけ。
    expect(
      shelves(`
  stone_axe:
    tags: [item, tool, weapon]${recipe('knapped')}
`),
    ).toEqual([{ label: '道具', names: ['石斧'] }]);
  });

  it('どの棚のタグも持たない完成品は、その他へ落ちる', () => {
    expect(
      shelves(`
  charm:
    tags: [item]${recipe('carved')}
`),
    ).toEqual([{ label: 'その他', names: ['お守り'] }]);
  });

  it('中身の無い棚は出さない', () => {
    expect(
      shelves(`
  digging_stick:
    tags: [item, tool]${recipe('carved')}
`).map((shelf) => shelf.label),
      '武器のレシピが1つも無ければ、武器の棚ごと出ない',
    ).toEqual(['道具']);
  });
});

/**
 * 未解放のレシピの札（Windows.md 9.3節）。**理由は札には載らない**——名前の板に収まるのは全角10文字
 * までで、完成品の名前だけでその予算を使い切る。札に出るのは鍵の印だけで、理由は押している間の
 * 吹き出しへ回る。
 */
describe('未解放のレシピの札', () => {
  const locale = parseLocale(
    'ja.yaml',
    `
tag_texts:
  tool: 道具
ui_texts:
  recipe_locked: まだ作り方が分からない。
reason_texts:
  needs_knapping: 石を打ち欠く手つきをまだ覚えていない。
object_texts:
  stone: {display_name: 石}
  stone_axe: {display_name: 石斧}
`,
  );

  /** 石斧のレシピ1つだけの世界。解放条件（求める段と理由の宣言）だけを試験ごとに変える。 */
  const axeEntry = (conditions: string) => {
    const mini = miniGame(
      `
recipe_categories: [tool]

object_defs:
  stone:
    tags: [item]

  knapper:
    traits: [carrier]
    props:
      skill_knapping:
        value: 0
        stages:
          - {name: novice, min: 0}
          - {name: skilled, min: 60}

  stone_axe:
    tags: [item, tool]
    recipes:
      knapped:
        conditions:
${conditions}
        steps:
          - requires: [{object: stone, count: 1, consume: true}]
            duration: 30
`,
      { player: 'knapper' },
    );
    return recipeCategories(mini.game, mini.codex, locale, () => {})[0]?.entries[0];
  };

  /** 段に届いていない解放条件（理由の宣言はconditionsごとに変える）。 */
  const unmet = (reason = '') =>
    `          - {subject: agent, prop: skill_knapping, in_stage: skilled${reason}}`;

  it('名前は完成品の名前のままで、押せないことは鍵の印が言う', () => {
    const entry = axeEntry(unmet(', reason: needs_knapping'));

    expect(entry.card.name, '理由を名前へ混ぜない（板からはみ出すため）').toBe('石斧');
    expect(entry.card.mark).toBe('🔒');
    expect(entry.lockedReason, '文の形の理由がそのまま吹き出しへ回る').toBe(
      '石を打ち欠く手つきをまだ覚えていない。',
    );
  });

  it('理由を宣言していない解放条件は、決まり文句で断る', () => {
    expect(axeEntry(unmet()).lockedReason).toBe('まだ作り方が分からない。');
  });

  it('解放済みのレシピは、印も理由も持たない', () => {
    // 今いる段（min: 0のnovice）そのものを求める条件なので、初めから満たしている。
    const entry = axeEntry(
      `          - {subject: agent, prop: skill_knapping, in_stage: novice, reason: needs_knapping}`,
    );

    expect(entry.card.mark).toBeUndefined();
    expect(entry.lockedReason).toBeUndefined();
  });
});
