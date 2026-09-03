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
 * 見張るのは、**宣言が世界じゅうに散らばっていて、目視では揃っているか分からないもの**。段の境目は
 * 11本のあいだで、解放条件は段が上がった後も、配る腕は同じ仕事の入口どうしで揃っていなければ
 * ならないが、いずれも1つのファイルを読んでも確かめられない。
 *
 * **どれも「揃っているか」しか見ない。** どの腕を配るのが正しいか・どのレシピに条件を置くべきかは
 * 内容の判断で、その拠り所は docs/world/Skills.md と、characters/player_character.yaml のコメント。
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
 * アクセス系の腕（Skills.md 2節）と、その段が押し上げる倍率（同5節）。レシピを開けない腕なので、
 * 効き先はここにしか無い——**この対応が切れると、伸びるだけで何にも効かない腕に戻る**。
 */
const ACCESS_MULTIPLIERS = [
  { skill: 'skill_firecraft', multiplier: 'ignition_ease' },
  { skill: 'skill_hunting', multiplier: 'quarry_sense' },
] as const;

/** 段ごとの倍率（Skills.md 5節）。素は等倍で、2本とも同じ刻み。 */
const MULTIPLIER_BY_STAGE = [1, 1.5, 2, 3] as const;

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

/** その節の下のどこかに `add: {agent: {<腕>: n}}` があるか。 */
function grantsSkillUnder(node: unknown, skillName: string): boolean {
  const walk = (current: unknown, state: 'none' | 'add' | 'add_agent'): boolean => {
    if (isSeq(current)) return current.items.some((item) => walk(item, state));
    if (!isMap(current)) return false;

    return current.items.some((pair) => {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (state === 'add_agent' && key === skillName) return true;
      return walk(
        pair.value,
        state === 'add' && key === 'agent' ? 'add_agent' : key === 'add' ? 'add' : 'none',
      );
    });
  };
  return walk(node, 'none');
}

/**
 * 狩猟の腕を配る型の名前。**trait 経由も数える**——獣を殴る手（`strike`）は `beast` trait が配って
 * いて、獣の型そのものには書かれていない。海の群れは逆に、型が直接持っている。
 */
function huntingQuarryTypes(): ReadonlySet<string> {
  const grantingNames = new Set<string>();
  const traitsOfType = new Map<string, readonly string[]>();
  const typeNames: string[] = [];

  for (const path of worldCodexYamlPaths()) {
    const root = parseDocument(readFileSync(path, 'utf8')).contents;
    if (!isMap(root)) continue;
    for (const section of root.items) {
      const sectionKey = isScalar(section.key) ? String(section.key.value) : '';
      if ((sectionKey !== 'traits' && sectionKey !== 'object_defs') || !isMap(section.value)) continue;

      for (const entry of section.value.items) {
        const name = isScalar(entry.key) ? String(entry.key.value) : '';
        if (grantsSkillUnder(entry.value, 'skill_hunting')) grantingNames.add(name);
        if (sectionKey !== 'object_defs') continue;

        typeNames.push(name);
        const declared = isMap(entry.value) ? entry.value.get('traits', true) : undefined;
        traitsOfType.set(
          name,
          isSeq(declared) ? declared.items.map((item) => (isScalar(item) ? String(item.value) : '')) : [],
        );
      }
    }
  }

  return new Set(
    typeNames.filter(
      (name) => grantingNames.has(name) || traitsOfType.get(name)!.some((trait) => grantingNames.has(trait)),
    ),
  );
}

/**
 * 操作の `pick` が湧かせる相手のうち、狩猟の腕を配る型を出す候補を「どこで・何を」の形で並べる。
 * 倍率（`times`）が掛かっているかを添える。
 *
 * **見るのは `interactions` の下だけ。** 罠の抽選（`catch_remaining` の `on_min`）も獣を湧かせるが、
 * あちらは誰も操作していない場面なので `agent` を書けない（docs/engine/TrapSystem.md 8節）。
 */
function beastSpawningCandidates(): readonly { where: string; multiplied: boolean }[] {
  const quarryTypes = huntingQuarryTypes();
  const found: { where: string; multiplied: boolean }[] = [];

  /** 候補1つ（weightを持つmap）が湧かせる型の名前。入れ子のpickは各候補が自分で見る。 */
  const spawnedTypesIn = (candidate: unknown): readonly string[] => {
    if (!isMap(candidate)) return [];
    const spawn = candidate.get('spawn', true);
    const entries = isSeq(spawn) ? spawn.items : [spawn];
    return entries.flatMap((entry) => {
      const object = isMap(entry) ? entry.get('object', true) : undefined;
      return isScalar(object) ? [String(object.value)] : [];
    });
  };

  /** その候補の重みが、狩猟の倍率を掛けているか。 */
  const multiplies = (candidate: unknown): boolean => {
    const weight = isMap(candidate) ? candidate.get('weight', true) : undefined;
    const times = isMap(weight) ? weight.get('times', true) : undefined;
    if (!isMap(times)) return false;
    const subject = times.get('subject', true);
    const prop = times.get('prop', true);
    return (
      isScalar(subject) &&
      String(subject.value) === 'agent' &&
      isScalar(prop) &&
      String(prop.value) === 'quarry_sense'
    );
  };

  let file = '';
  const walk = (node: unknown, owner: string, inInteractions: boolean): void => {
    if (isSeq(node)) {
      for (const item of node.items) walk(item, owner, inInteractions);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (inInteractions && key === 'pick' && isSeq(pair.value))
        for (const candidate of pair.value.items)
          for (const spawned of spawnedTypesIn(candidate))
            if (quarryTypes.has(spawned))
              found.push({ where: `${file} の ${owner}: ${spawned}`, multiplied: multiplies(candidate) });
      walk(pair.value, key === 'pick' ? owner : key, inInteractions || key === 'interactions');
    }
  };

  for (const path of worldCodexYamlPaths()) {
    file = path.slice(path.lastIndexOf('/') + 1);
    walk(parseDocument(readFileSync(path, 'utf8')).contents, '', false);
  }
  return found;
}

/** 操作1つ分の、出す物と配る腕。 */
interface InteractionGains {
  readonly name: string;
  /** その操作が`spawn`で出す型の名前（`pick`の候補の中のものも含む）。 */
  readonly products: readonly string[];
  readonly skills: readonly string[];
}

/** ノードの下にある`spawn`が出す型の名前を、入れ子の`pick`ごと集める。 */
function productsUnder(node: unknown, found: Set<string>): void {
  if (isSeq(node)) {
    for (const item of node.items) productsUnder(item, found);
    return;
  }
  if (!isMap(node)) return;

  for (const pair of node.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if (key !== 'spawn') {
      productsUnder(pair.value, found);
      continue;
    }
    const spawned = isSeq(pair.value) ? pair.value.items : [pair.value];
    for (const entry of spawned) {
      if (!isMap(entry)) continue;
      const object = entry.get('object', true);
      if (isScalar(object)) found.add(String(object.value));
    }
  }
}

/** `interactions`の下の操作を、出す物と配る腕の組にして集める。 */
function declaredInteractions(): readonly InteractionGains[] {
  const found: InteractionGains[] = [];

  const walk = (node: unknown): void => {
    if (isSeq(node)) {
      for (const item of node.items) walk(item);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (key !== 'interactions' || !isMap(pair.value)) {
        walk(pair.value);
        continue;
      }
      for (const entry of pair.value.items) {
        const body = entry.value;
        if (!isMap(body)) continue;
        const products = new Set<string>();
        productsUnder(body, products);

        const add = body.get('add', true);
        const agent = isMap(add) ? add.get('agent', true) : undefined;
        const skills = isMap(agent)
          ? agent.items
              .map((item) => (isScalar(item.key) ? String(item.key.value) : ''))
              .filter((name) => name.startsWith(SKILL_PREFIX))
          : [];

        found.push({
          name: isScalar(entry.key) ? String(entry.key.value) : '',
          products: [...products].sort(),
          skills: skills.sort(),
        });
      }
    }
  };

  for (const path of worldCodexYamlPaths()) walk(parseDocument(readFileSync(path, 'utf8')).contents);
  return found;
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

  it('11本とも、段が下端を名乗っている（受け皿にして進みを消さない）', () => {
    // 腕前はrangeを持たないので、下端を書かない段（受け皿、GameElementDefinition.md 6.4節）は
    // 下端が決まらず、段の中の進みが計算できない。UIは進みの無い段でバーを出さない
    // （StatusArea.md 9節）ので、最下段を受け皿で書くと**全員が通る見習いの間だけ**バーが消える。
    const character = characterWithSkills(0);

    // 最上段には満ちる先が無く、そこで進みを言わないのはエンジンの決まり（stageProgress.test.ts）。
    for (const [index, stage] of STAGES.slice(0, -1).entries()) {
      const next = STAGES[index + 1];
      const middle = (stage.min + next.min) / 2;
      for (const id of skillIds) {
        const property = character.getProperty(id);
        property.setNumberWithoutEvents(middle);
        const progress = property.stageReading?.progress;

        expect(progress?.nextName, `${property.def.name} の ${middle}`).toBe(next.name);
        expect(progress?.ratio, `${property.def.name} の ${middle}: 段の中ほど`).toBeCloseTo(0.5);
      }
    }
  });

  it('アクセス系の腕は、段が上がるほど倍率を押し上げる', () => {
    // 火と狩猟はレシピを開けない（Skills.md 2節）ので、段が動かすのはこの倍率だけ。素人のうちは
    // 等倍で、上の段ほど大きくなる——2本で同じ刻みにしてあるのは、11本で段の境目を揃えている
    // のと同じ理由（同5節）。
    for (const { skill, multiplier } of ACCESS_MULTIPLIERS) {
      const character = characterWithSkills(0);
      const skillProperty = character.getProperty(codex.propertyNames.getId(skill));
      const multiplierProperty = character.getProperty(codex.propertyNames.getId(multiplier));

      for (const [index, stage] of STAGES.entries()) {
        skillProperty.setNumberWithoutEvents(stage.min);
        expect(
          multiplierProperty.getEffectiveValue(),
          `${skill} が ${stage.name} のときの ${multiplier}`,
        ).toBe(MULTIPLIER_BY_STAGE[index]);
      }
    }
  });

  it('狩猟の腕を配る相手を湧かせる候補には、狩猟の倍率が掛かっている', () => {
    // 「出くわす機会」は探索の`pick`が湧かせる（Skills.md 5節）。**宣言の場所が散らばっているので、
    // 目視では揃っているか分からない**——地上の獣は`beast` traitの`strike`が腕を配り、海の群れは
    // 型自身の`spear_shoal`・`catch_seabird`が配る。掛け忘れた候補は、腕を上げても増えない相手になる。
    const candidates = beastSpawningCandidates();

    expect(candidates.length, '狩猟の相手を湧かせる候補が1つも無い').toBeGreaterThan(0);
    expect(candidates.filter((candidate) => !candidate.multiplied).map((c) => c.where)).toEqual([]);
  });

  it('解放条件は、腕が上がった後も満たされ続ける（上の段で閉じ直さない）', () => {
    // `in_stage`は今いる段ちょうどの判定なので、そちらで要求を書くと、腕が伸びた瞬間にレシピが
    // 消える。`in_stage_or_above`で書く形（characters/player_character.yaml）がそれを防ぐ。
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

  it('出す物がそっくり同じ操作は、同じ腕を配る（同じ仕事の2つ目の入口で片方が抜けない）', () => {
    // 同じ仕事に入口が2つあるのは、島の当たり外れを吸収するための作り（植物繊維はバショウ属の草と
    // ヤシの実の皮）。片方だけが腕を配ると、**どの島に流れ着いたかが腕の伸びに化ける**。
    //
    // **束ねるのは出す物がそっくり同じ操作だけで、重なるだけの操作は束ねない。** 解体と漁はどちらも
    // 生肉を出すが別の仕事で、配る腕も違う（皮革と狩猟）。**この検査が届くのはそこまで**で、
    // 出す物が一部だけ重なる2つ目の入口が増えても捕まらない。
    const byProduct = new Map<string, InteractionGains[]>();
    for (const interaction of declaredInteractions()) {
      if (interaction.products.length === 0) continue;
      const key = interaction.products.join('+');
      const group = byProduct.get(key);
      if (group === undefined) byProduct.set(key, [interaction]);
      else group.push(interaction);
    }

    const shared = [...byProduct].filter(([, group]) => group.length > 1);
    expect(shared.length, '出す物が同じ操作の組が1つも無い').toBeGreaterThan(0);

    for (const [products, group] of shared)
      expect(
        new Set(group.map((interaction) => interaction.skills.join(','))).size,
        `'${products}' を出す ${group.map((i) => i.name).join('・')} で、配る腕が食い違う`,
      ).toBe(1);
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
