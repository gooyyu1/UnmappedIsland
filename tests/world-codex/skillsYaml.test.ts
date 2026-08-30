import { readFileSync } from 'node:fs';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RecipeDef } from '../../src/domain/RecipeDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR, worldCodexYamlPaths } from '../support/worldCodexFiles';

/**
 * 腕前（characters/player_character.yaml）と、レシピの解放条件（docs/engine/SkillSystem.md 4節）の
 * 自動テスト。
 *
 * ここで見張るのは、**宣言が散らばっていて目視では揃わない3つ**。
 *
 * - 11本の段が揃っていること（本ごとに境目が違うと、連言で並べた条件を読み比べられなくなる）。
 * - 解放条件が、腕が上がった後も満たされ続けること（`in_stage`は今いる段ちょうどの判定なので、
 *   1つだけ書くと上の段でレシピが閉じ直す。GameElementDefinition.md 14.1節）。
 * - 解放条件が名指しする腕に、それを伸ばす操作が世界のどこかにあること（SkillSystem.md 3.2節。
 *   無ければそのレシピは永久に開かない）。
 */

/** 腕前のプロパティの名前の頭。 */
const SKILL_PREFIX = 'skill_';

/** docs/world/Skills.md 2節の11本。宣言順（characters/player_character.yaml）で並べる。 */
const SKILLS = [
  'skill_knapping',
  'skill_cordage',
  'skill_woodwork',
  'skill_joinery',
  'skill_building',
  'skill_leatherwork',
  'skill_cooking',
  'skill_preserving',
  'skill_firecraft',
  'skill_hunting',
  'skill_smelting',
] as const;

/** 11本で共通の段（SkillSystem.md 6節の目安そのままの4段・比3）。 */
const STAGES = [
  { name: 'novice', min: 0 },
  { name: 'basic', min: 20 },
  { name: 'skilled', min: 60 },
  { name: 'expert', min: 180 },
] as const;

/** 1回の作業で伸びる量（SkillSystem.md 3節の実行経路）。作業の長さに依らず一律。 */
const GAIN_PER_ACTION = 2;

/**
 * 定義ファイルが `add` で `agent` の腕前へ配っている量を、腕ごとに集める。効果はロード後には木へ
 * 畳まれていて列挙できないため、理由（reason）を集める bundledLocale.test.ts と同じく構文木を辿る。
 */
function declaredSkillGains(): ReadonlyMap<string, ReadonlySet<number>> {
  const gains = new Map<string, Set<number>>();

  /** stateは、この節の直下のキーが `add` の何段目に居るか。 */
  const walk = (node: unknown, state: 'none' | 'add' | 'add_agent'): void => {
    if (isSeq(node)) {
      for (const item of node.items) walk(item, state);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (state === 'add_agent' && key.startsWith(SKILL_PREFIX)) {
        const amount = isScalar(pair.value) ? Number(pair.value.value) : Number.NaN;
        const amounts = gains.get(key);
        if (amounts === undefined) gains.set(key, new Set([amount]));
        else amounts.add(amount);
        continue;
      }
      walk(pair.value, state === 'add' && key === 'agent' ? 'add_agent' : key === 'add' ? 'add' : 'none');
    }
  };

  for (const path of worldCodexYamlPaths()) walk(parseDocument(readFileSync(path, 'utf8')).contents, 'none');
  return gains;
}

describe('腕前とレシピの解放条件', () => {
  let codex: WorldCodex;
  let skillIds: readonly number[];

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).buildAndReset();
    skillIds = SKILLS.map((name) => codex.propertyNames.getId(name));
  });

  /** プレイヤーキャラクタを1体作り、11本すべてをその値にする。 */
  function characterWithSkills(value: number, characterName = 'medic'): WorldObject {
    const character = new WorldSession(codex).createObject(codex.objectNames.getId(characterName));
    for (const id of skillIds) character.getProperty(id).setNumberWithoutEvents(value);
    return character;
  }

  /** 解放条件を持つレシピすべて（完成品の名前を添える）。 */
  function gatedRecipes(): readonly { product: string; recipe: RecipeDef }[] {
    const found: { product: string; recipe: RecipeDef }[] = [];
    for (let globalId = 0; globalId < codex.objects.count; globalId++) {
      const product = codex.objects.get(globalId);
      for (const recipe of product.recipesProducingThis)
        // 作りかけの型（レシピの軸を持つ変種）は同じレシピを二度数えさせるので、素の型だけを見る。
        if (recipe.unmetUnlockRequirement(undefined) !== undefined && codex.baseOf(product) === product)
          found.push({ product: product.name, recipe });
    }
    return found;
  }

  it('プレイヤーキャラクタは、Skills.md 2節の11本を腕前のタグ付きで持つ', () => {
    // タブに並ぶ順は宣言順（GameElementDefinition.md 6.7節）なので、集合ではなく並びで見る。
    const skillTagId = codex.propertyTagNames.getId('skill');

    for (const name of ['medic', 'captain', 'engineer', 'farmer']) {
      const character = characterWithSkills(0, name);
      expect(
        character.propertiesWithTag(skillTagId).map((property) => property.def.name),
        `${name} の腕前`,
      ).toEqual([...SKILLS]);
    }
  });

  it('11本の段は同じ境目を持つ（本ごとに basic の遠さが変わらない）', () => {
    const character = characterWithSkills(0);

    for (const [index, stage] of STAGES.entries()) {
      // 段の中の下端と、次の境目の1つ手前。上端の段は十分に大きい値でも同じ段のままであること。
      const upper = index + 1 < STAGES.length ? STAGES[index + 1].min - 1 : STAGES[index].min * 10;
      for (const value of [stage.min, upper])
        for (const id of skillIds) {
          const property = character.getProperty(id);
          property.setNumberWithoutEvents(value);
          expect(property.stage?.name, `${property.def.name} の ${value}`).toBe(stage.name);
        }
    }
  });

  it('解放条件は、腕が上がった後も満たされ続ける（上の段で閉じ直さない）', () => {
    // `in_stage`は今いる段ちょうどの判定なので、要求を1つの段だけで書くと、腕が伸びた瞬間に
    // レシピが消える。段の名前をanyで束ねる形（characters/player_character.yaml）がそれを防ぐ。
    const recipes = gatedRecipes();
    expect(recipes.length, '解放条件を持つレシピが1つも無い').toBeGreaterThan(0);

    for (const { product, recipe } of recipes) {
      const unlocked = STAGES.map(
        (stage) => recipe.unmetUnlockRequirement(characterWithSkills(stage.min)) === undefined,
      );

      expect(unlocked.at(0), `'${product}': 素人には作れない`).toBe(false);
      expect(unlocked.at(-1), `'${product}': 熟達しても作れる`).toBe(true);
      // 一度開いたら閉じない（falseがtrueの後ろに来ない）。
      expect(unlocked, `'${product}': 段ごとの可否`).toEqual([...unlocked].sort());
    }
  });

  it('解放条件が名指しする腕には、それを伸ばす操作がある（永久に開かないレシピを作らない）', () => {
    // SkillSystem.md 3.2節のブートストラップ。要求している腕は、全部を熟達させた状態から1本ずつ
    // 素人へ落として、条件が落ちるかで割り出す（条件木は畳まれていて読めない）。
    const gains = declaredSkillGains();

    for (const { product, recipe } of gatedRecipes()) {
      // 落とす前が開いていなければ、落ちたことが「その腕を要求している」の証拠にならない。
      // 開かないレシピは上のテストが捕まえるので、ここでは割り出しの前提だけを確かめる。
      expect(
        recipe.unmetUnlockRequirement(characterWithSkills(STAGES.at(-1)!.min)),
        `'${product}': 熟達しても開かない`,
      ).toBeUndefined();

      for (const [index, skillName] of SKILLS.entries()) {
        const character = characterWithSkills(STAGES.at(-1)!.min);
        character.getProperty(skillIds[index]).setNumberWithoutEvents(0);
        if (recipe.unmetUnlockRequirement(character) === undefined) continue;

        expect(gains.has(skillName), `'${product}' が要求する ${skillName} を伸ばす操作が世界に無い`).toBe(
          true,
        );
      }
    }
  });

  it('腕を配る操作は、作業の長さに依らず一律の量を配る', () => {
    // 量を作業ごとに変えると、短い作業を繰り返すのが最も速い伸ばし方になる。繰り返しの稼ぎを
    // 抑えるのは時間のコストだけ（SkillSystem.md 7節）。
    for (const [skillName, amounts] of declaredSkillGains())
      expect([...amounts], `${skillName} が配る量`).toEqual([GAIN_PER_ACTION]);
  });

  it('伸ばす操作をまだ持たない腕は、開ける物が世界に無い4本だけ', () => {
    // 宣言だけあって動かない本があること自体は、Skills.md 2節の一覧を先に置いているため。
    // どれが動かないかをここで数え上げておき、開ける物が入ったときに直し忘れないようにする。
    const gains = declaredSkillGains();

    expect(SKILLS.filter((name) => !gains.has(name))).toEqual([
      'skill_joinery',
      'skill_building',
      'skill_cooking',
      'skill_smelting',
    ]);
  });
});
