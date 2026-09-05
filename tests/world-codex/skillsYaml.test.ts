import { readFileSync } from 'node:fs';
import type { YAMLMap } from 'yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RecipeDef } from '../../src/domain/RecipeDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { bundledCodex, worldCodexYamlPaths } from '../support/worldCodexFiles';

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
 * アクセス系の腕（Skills.md 2節）と、その段が押し上げる上乗せ（同5節）。レシピを開けない腕なので、
 * 効き先はここにしか無い——**この対応が切れると、伸びるだけで何にも効かない腕に戻る**。
 *
 * **段ごとの量は上乗せで違う**——押す先の桁が違うため（着火の重みは60前後、獣のつまみは2〜4、
 * 当てる側は15〜78）。狩猟だけ2本あるのはそのため。見張るのは値そのものではなく、
 * **素が0で、段が上がるほど大きくなる**こと。
 */
const ACCESS_BONUSES = [
  { skill: 'skill_firecraft', bonus: 'ignition_ease', byStage: [0, 20, 50, 120] },
  { skill: 'skill_hunting', bonus: 'quarry_sense', byStage: [0, 1, 2, 4] },
  { skill: 'skill_hunting', bonus: 'hunting_aim', byStage: [0, 10, 20, 40] },
] as const;

/**
 * その節の下にある `add: {agent: {<腕>: n}}` を、腕の名前と量の組で1件ずつ渡す。効果はロード後には
 * 木へ畳まれていて列挙できないため、理由（reason）を集める bundledLocale.test.ts と同じく構文木を辿る。
 *
 * **配っている量を集めるのも、配っているかを問うのも、この1本を通す。** 同じ状態機械
 * （`add` の何段目に居るか）を2つ持つと、片方だけが `agent` 以外の役を数え始めても気付けない。
 */
function walkAgentSkillGains(node: unknown, visit: (skillName: string, amount: number) => void): void {
  /** stateは、この節の直下のキーが `add` の何段目に居るか。 */
  const walk = (current: unknown, state: 'none' | 'add' | 'add_agent'): void => {
    if (isSeq(current)) {
      for (const item of current.items) walk(item, state);
      return;
    }
    if (!isMap(current)) return;

    for (const pair of current.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (state === 'add_agent' && key.startsWith(SKILL_PREFIX)) {
        visit(key, isScalar(pair.value) ? Number(pair.value.value) : Number.NaN);
        continue;
      }
      walk(pair.value, state === 'add' && key === 'agent' ? 'add_agent' : key === 'add' ? 'add' : 'none');
    }
  };
  walk(node, 'none');
}

/** 定義ファイルが `add` で `agent` の腕前へ配っている量を、腕ごとに集める。 */
function declaredSkillGains(): ReadonlyMap<string, ReadonlySet<number>> {
  const gains = new Map<string, Set<number>>();
  for (const path of worldCodexYamlPaths())
    walkAgentSkillGains(parseDocument(readFileSync(path, 'utf8')).contents, (skillName, amount) => {
      const amounts = gains.get(skillName);
      if (amounts === undefined) gains.set(skillName, new Set([amount]));
      else amounts.add(amount);
    });
  return gains;
}

/**
 * `spawn:` の節（1件でも並びでも）が出す型の名前。**`spawn` の綴りを読むのはここ1箇所**で、候補の
 * 直下だけを見る側（beastSpawningCandidates）も、入れ子ごと集める側（productsUnder）もここを通す。
 */
function spawnedTypesOf(spawnNode: unknown): readonly string[] {
  if (spawnNode === undefined || spawnNode === null) return [];
  const entries = isSeq(spawnNode) ? spawnNode.items : [spawnNode];
  return entries.flatMap((entry) => {
    const object = isMap(entry) ? entry.get('object', true) : undefined;
    return isScalar(object) ? [String(object.value)] : [];
  });
}

/** その節の下のどこかに `add: {agent: {<腕>: n}}` があるか。 */
function grantsSkillUnder(node: unknown, skillName: string): boolean {
  let found = false;
  walkAgentSkillGains(node, (name) => {
    if (name === skillName) found = true;
  });
  return found;
}

/**
 * 狩猟の腕を配る操作を持つ型の名前。**trait 経由も数える**——獣を殴る手（`strike`）は `beast` trait が
 * 配っていて、獣の型そのものには書かれていない。海の群れは逆に、型が直接持っている。
 *
 * **獲物そのものの一覧ではありません。** 突く手を持つ筏（`voyage.yaml` の `spear_sea`）も入ります
 * ——今はどの `pick` も筏を湧かせないので、下の検査には出てきません。
 */
function huntingGrantingTypes(): ReadonlySet<string> {
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

/** そのpropの宣言が、その上乗せを `base` の土台にしているか（土台は操作をしている人＝`agent`）。 */
function standsOnBonus(propBody: unknown, bonusName: string): boolean {
  const base = isMap(propBody) ? propBody.get('base', true) : undefined;
  if (!isMap(base)) return false;
  const subject = base.get('subject', true);
  const prop = base.get('prop', true);
  return (
    isScalar(subject) &&
    String(subject.value) === 'agent' &&
    isScalar(prop) &&
    String(prop.value) === bonusName
  );
}

/** 世界じゅうのプロパティ宣言を「どこの・どの名前の」の形で並べる（traitのpropsも型のpropsも）。 */
function declaredProps(): readonly { where: string; name: string; body: unknown }[] {
  const found: { where: string; name: string; body: unknown }[] = [];

  for (const path of worldCodexYamlPaths()) {
    const file = path.slice(path.lastIndexOf('/') + 1);
    const root = parseDocument(readFileSync(path, 'utf8')).contents;
    if (!isMap(root)) continue;

    for (const section of root.items) {
      const sectionKey = isScalar(section.key) ? String(section.key.value) : '';
      if ((sectionKey !== 'traits' && sectionKey !== 'object_defs') || !isMap(section.value)) continue;

      for (const entry of section.value.items) {
        const defName = isScalar(entry.key) ? String(entry.key.value) : '';
        const props = isMap(entry.value) ? entry.value.get('props', true) : undefined;
        if (!isMap(props)) continue;
        for (const prop of props.items)
          found.push({
            where: `${file} の ${defName}`,
            name: isScalar(prop.key) ? String(prop.key.value) : '',
            body: prop.value,
          });
      }
    }
  }
  return found;
}

/** そのpropの宣言が持つ素の値（書いていなければ0）。 */
function declaredValueOf(propBody: unknown): number {
  const value = isMap(propBody) ? propBody.get('value', true) : undefined;
  return isScalar(value) ? Number(value.value) : 0;
}

/**
 * 島の生成が亜種へ配る個体差（terrain_generation.yaml の `location_types`）を、型ごと・prop ごとの
 * 最大値で並べる。**素の宣言が0でも、亜種が値を配ればその土地はその候補を名乗っている**——実体化の
 * ときに土地のプロパティへ書き込まれる（`IslandSpawner`、docs/world/TerrainGeneration.md 3.6節）。
 *
 * 書き込むのは素の値だけで、`base` の土台は消えない。亜種の側に土台は要らない。
 */
function variantValues(): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const byDef = new Map<string, Map<string, number>>();

  for (const path of worldCodexYamlPaths()) {
    const root = parseDocument(readFileSync(path, 'utf8')).contents;
    if (!isMap(root)) continue;
    const types = root.get('location_types', true);
    if (!isMap(types)) continue;

    for (const entry of types.items) {
      const objectDef = isMap(entry.value) ? entry.value.get('object_def', true) : undefined;
      const variants = isMap(entry.value) ? entry.value.get('variants', true) : undefined;
      if (!isScalar(objectDef) || !isSeq(variants)) continue;

      const values = byDef.get(String(objectDef.value)) ?? new Map<string, number>();
      byDef.set(String(objectDef.value), values);
      for (const variant of variants.items) {
        const props = isMap(variant) ? variant.get('props', true) : undefined;
        if (!isMap(props)) continue;
        for (const prop of props.items) {
          if (!isScalar(prop.key) || !isScalar(prop.value)) continue;
          const name = String(prop.key.value);
          values.set(name, Math.max(values.get(name) ?? 0, Number(prop.value.value)));
        }
      }
    }
  }
  return byDef;
}

/**
 * 操作の `pick` が湧かせる相手のうち、狩猟の腕を配る型を出す候補を「どこで・何を」の形で並べる。
 * その候補の重みが読むつまみが、**名乗られていて**（素の値か亜種の配る値が0より大きい）、なお狩猟の腕を
 * `base` の土台にしていないものを `missingSkill` として立てる。
 *
 * **素の値が0のつまみには積まない。** 「その場所が名乗らなかった候補は、そこには無い」を素の0で
 * 表しているので（docs/world/Voyage.md 3.3節）、積むと名乗っていない海区にも群れが立つ。
 *
 * **見るのは `interactions` の下だけ。** 罠の抽選（`catch_remaining` の `on_min`）も獣を湧かせるが、
 * あちらは誰も操作していない場面なので、つまみが `agent` を土台にしても解けない
 * （docs/engine/TrapSystem.md 8節）。
 */
function beastSpawningCandidates(): readonly { where: string; missingSkill: boolean }[] {
  const grantingTypes = huntingGrantingTypes();
  const found: { where: string; missingSkill: boolean }[] = [];

  /** 候補1つ（weightを持つmap）が湧かせる型の名前。入れ子のpickは各候補が自分で見る。 */
  const spawnedTypesIn = (candidate: unknown): readonly string[] =>
    isMap(candidate) ? spawnedTypesOf(candidate.get('spawn', true)) : [];

  /** その候補の重みが読むプロパティ名（リテラルの重みならundefined）。 */
  const weightPropOf = (candidate: unknown): string | undefined => {
    const weight = isMap(candidate) ? candidate.get('weight', true) : undefined;
    const prop = isMap(weight) ? weight.get('prop', true) : undefined;
    return isScalar(prop) ? String(prop.value) : undefined;
  };

  // **宣言はtraitと型に分かれて置かれる**——海区は`sea_zone` traitがexploreを、各海区がつまみを持つ。
  // 型ごとに、自分とtraitのpropsを1つの表へ畳んでから引く（自分の宣言が勝つ）。
  const bodies = new Map<string, YAMLMap>();
  const traitNamesOf = new Map<string, readonly string[]>();
  const fileOf = new Map<string, string>();
  const documents: { file: string; root: unknown }[] = [];

  for (const path of worldCodexYamlPaths())
    documents.push({
      file: path.slice(path.lastIndexOf('/') + 1),
      root: parseDocument(readFileSync(path, 'utf8')).contents,
    });

  for (const { file, root } of documents) {
    if (!isMap(root)) continue;
    for (const section of root.items) {
      const sectionKey = isScalar(section.key) ? String(section.key.value) : '';
      if ((sectionKey !== 'traits' && sectionKey !== 'object_defs') || !isMap(section.value)) continue;
      for (const entry of section.value.items) {
        const defName = isScalar(entry.key) ? String(entry.key.value) : '';
        if (!isMap(entry.value)) continue;
        bodies.set(defName, entry.value);
        fileOf.set(defName, file);
        const declared = entry.value.get('traits', true);
        traitNamesOf.set(
          defName,
          isSeq(declared) ? declared.items.map((item) => (isScalar(item) ? String(item.value) : '')) : [],
        );
      }
    }
  }

  /** その型が使うpropの宣言（自分に無ければtraitから）。 */
  const propBodyOf = (defName: string, propName: string): unknown => {
    for (const name of [defName, ...(traitNamesOf.get(defName) ?? [])]) {
      const props = bodies.get(name)?.get('props', true);
      const declared = isMap(props) ? props.get(propName, true) : undefined;
      if (declared !== undefined) return declared;
    }
    return undefined;
  };

  const fromVariants = variantValues();

  for (const defName of bodies.keys()) {
    // 操作は自分かtraitのどちらかに在る。どちらの`pick`も、読むつまみは型ごとに解く。
    for (const owner of [defName, ...(traitNamesOf.get(defName) ?? [])]) {
      const interactions = bodies.get(owner)?.get('interactions', true);
      if (!isMap(interactions)) continue;

      for (const interaction of interactions.items) {
        const name = isScalar(interaction.key) ? String(interaction.key.value) : '';
        const picks = isMap(interaction.value) ? interaction.value.get('pick', true) : undefined;
        if (!isSeq(picks)) continue;

        for (const candidate of picks.items)
          for (const spawned of spawnedTypesIn(candidate))
            if (grantingTypes.has(spawned)) {
              const knob = weightPropOf(candidate);
              const declared = knob === undefined ? undefined : propBodyOf(defName, knob);
              // 素の宣言が0でも、亜種が値を配っていればその土地は候補を名乗っている。
              const value = Math.max(
                declaredValueOf(declared),
                (knob === undefined ? undefined : fromVariants.get(defName)?.get(knob)) ?? 0,
              );
              found.push({
                where: `${fileOf.get(defName)} の ${defName}.${name}: ${spawned}`,
                missingSkill: value > 0 && !standsOnBonus(declared, 'quarry_sense'),
              });
            }
      }
    }
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
    for (const name of spawnedTypesOf(pair.value)) found.add(name);
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
    codex = bundledCodex();
    skillIds = SKILLS.map((name) => codex.propertyNames.getId(name));
  });

  /** プレイヤーキャラクタを1体作り、11本すべてをその値にする。 */
  function characterWithSkills(value: number, characterName = 'medic'): WorldObject {
    const character = new WorldSession(codex).createObject(codex.objectNames.getId(characterName));
    for (const id of skillIds) character.getProperty(id).setNumberWithoutEvents(value);
    return character;
  }

  /**
   * そのレシピの解放条件が名指ししている腕。**条件木は畳まれていて読めない**ので、全部を熟達させた
   * 状態から1本ずつ素人へ落として、条件が落ちるかで割り出す。
   */
  function requiredSkillsOf(recipe: RecipeDef): readonly string[] {
    return SKILLS.filter((_, index) => {
      const character = characterWithSkills(STAGES.at(-1)!.min);
      character.getProperty(skillIds[index]).setNumberWithoutEvents(0);
      return recipe.unmetUnlockRequirement(character) !== undefined;
    });
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

  it('アクセス系の腕は、段が上がるほど上乗せを押し上げる', () => {
    // 火と狩猟はレシピを開けない（Skills.md 2節）ので、段が動かすのはこの上乗せだけ。**素は0**で、
    // 上の段ほど大きくなる。量が2本で違うのは、上乗せする先の桁が違うから（同5節）。
    for (const { skill, bonus, byStage } of ACCESS_BONUSES) {
      const character = characterWithSkills(0);
      const skillProperty = character.getProperty(codex.propertyNames.getId(skill));
      const bonusProperty = character.getProperty(codex.propertyNames.getId(bonus));

      for (const [index, stage] of STAGES.entries()) {
        skillProperty.setNumberWithoutEvents(stage.min);
        expect(bonusProperty.getEffectiveValue(), `${skill} が ${stage.name} のときの ${bonus}`).toBe(
          byStage[index],
        );
      }
      expect(byStage[0], `${bonus} の素`).toBe(0);
      expect([...byStage], `${bonus} は段が上がるほど大きい`).toEqual([...byStage].sort((a, b) => a - b));
    }
  });

  it('狩猟の腕を配る相手を湧かせる候補は、腕を土台にしたつまみを読む', () => {
    // 「出くわす機会」は探索の`pick`が湧かせる（Skills.md 5節）。**宣言の場所が散らばっているので、
    // 目視では揃っているか分からない**——地上の獣は`beast` traitの`strike`が腕を配り、海の群れは
    // 型自身の`spear_shoal`・`catch_seabird`が配る。積み忘れた候補は、腕を上げても増えない相手になる。
    const candidates = beastSpawningCandidates();

    expect(candidates.length, '狩猟の相手を湧かせる候補が1つも無い').toBeGreaterThan(0);
    expect(candidates.filter((candidate) => candidate.missingSkill).map((c) => c.where)).toEqual([]);
  });

  it('着火の重みを名乗る火口は、火の腕を土台にする', () => {
    // 火口は3つのファイルに散らばっている（fire.yaml・fiber.yaml・coconut.yaml）ので、目視では
    // 揃っているか分からない。積み忘れた火口は、腕を上げても付きやすくならない相手になる。
    const tinders = declaredProps().filter((prop) => prop.name === 'ignition_chance');

    expect(
      tinders.some((tinder) => declaredValueOf(tinder.body) > 0),
      '火口が1つも無い',
    ).toBe(true);
    expect(
      tinders
        .filter((tinder) => declaredValueOf(tinder.body) > 0 && !standsOnBonus(tinder.body, 'ignition_ease'))
        .map((tinder) => tinder.where),
    ).toEqual([]);
  });

  it('打ちかかる手の卓は、最も太い当たり方1つだけが狙いを土台にする', () => {
    // 当たり所は武器ごと（tools.yaml）、突き漁の釣果は筏と群れ（voyage.yaml）が名乗るので、宣言は
    // 散らばっている。**積むのを1つに限るのは、卓の合計をどの武器でも同じだけ伸ばすため**
    // ——当たり方の数だけ積むと、2つ名乗る石斧だけが倍受け取り、仕留めの重みと並ぶ目盛りが武器で
    // 変わる（docs/engine/HuntingSystem.md 1.2節）。積み忘れれば、腕を上げても当たらない手になる。
    const AIMED_WEIGHTS = ['heavy_blow', 'light_blow', 'thrust', 'catch_chance'];
    const tables = new Map<string, { name: string; value: number; stands: boolean }[]>();
    for (const prop of declaredProps()) {
      if (!AIMED_WEIGHTS.includes(prop.name) || declaredValueOf(prop.body) <= 0) continue;
      const hits = tables.get(prop.where) ?? [];
      hits.push({
        name: prop.name,
        value: declaredValueOf(prop.body),
        stands: standsOnBonus(prop.body, 'hunting_aim'),
      });
      tables.set(prop.where, hits);
    }

    expect(tables.size, '当たり方を名乗る型が1つも無い').toBeGreaterThan(0);
    expect(
      [...tables].flatMap(([where, hits]) => {
        const standing = hits.filter((hit) => hit.stands);
        const widest = hits.reduce((best, hit) => (hit.value > best.value ? hit : best));
        return standing.length === 1 && standing[0].name === widest.name
          ? []
          : [`${where}: ${standing.map((hit) => hit.name).join('・') || 'どれも積んでいない'}`];
      }),
      '最も太い当たり方1つが積んでいる型だけが並ぶ',
    ).toEqual([]);
    // **外れへは積まない**——押すのは当たる側だけにして、卓が増えるぶんで外れの割合が落ちる形に
    // している（Skills.md 5節）。積むと腕が上がるほど空を切る。
    expect(
      declaredProps()
        .filter((prop) => prop.name === 'whiff' && standsOnBonus(prop.body, 'hunting_aim'))
        .map((prop) => prop.where),
    ).toEqual([]);
  });

  it('腕を土台にしたつまみは、素の値も名乗る（土台だけをtraitへ置かない）', () => {
    // **土台を書いてよいのは、値を名乗った側だけ。** trait に土台だけ置くと、素の値を書き忘れた
    // 継承先が0＋腕で立ってしまう——火口なら書き忘れたまま火が付き、海区なら「名乗らなかった候補は
    // その海に無い」（docs/world/Voyage.md 3.3節）が破れて群れが立つ。
    const bonuses = ACCESS_BONUSES.map((entry) => entry.bonus);
    const standing = declaredProps().filter((prop) =>
      bonuses.some((bonus) => standsOnBonus(prop.body, bonus)),
    );

    expect(standing.length, '腕を土台にしたつまみが1つも無い').toBeGreaterThan(0);
    expect(
      standing.filter((prop) => declaredValueOf(prop.body) <= 0).map((prop) => `${prop.where}.${prop.name}`),
    ).toEqual([]);
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
    // SkillSystem.md 3.2節のブートストラップ。
    const gains = declaredSkillGains();

    for (const { product, recipe } of gatedRecipes()) {
      // 落とす前が開いていなければ、落ちたことが「その腕を要求している」の証拠にならない。
      // 開かないレシピは上のテストが捕まえるので、ここでは割り出しの前提だけを確かめる。
      expect(
        recipe.unmetUnlockRequirement(characterWithSkills(STAGES.at(-1)!.min)),
        `'${product}': 熟達しても開かない`,
      ).toBeUndefined();

      for (const skillName of requiredSkillsOf(recipe))
        expect(gains.has(skillName), `'${product}' が要求する ${skillName} を伸ばす操作が世界に無い`).toBe(
          true,
        );
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

  it('伸ばす操作を持つのに効き先が無い腕は、木材加工と保存だけ', () => {
    // 一つ上の数え上げと逆向き。**伸ばす操作を持つ腕は、画面で段の動くバーになる**
    // （docs/ui/StatusArea.md 9節）ので、効き先が無ければ動いても何も起きないバーが並ぶ。
    // 効き先が入った本はここから外れ、まだ無い本は名前で残る。
    //
    // 効き先は系統で分かれる（Skills.md 2節）。**製作系はレシピの解放条件、アクセス系は重みへの
    // 上乗せ**で、アクセス系はレシピを開けないので解放条件の側には現れない。
    const gains = declaredSkillGains();
    const effective = new Set<string>([
      ...gatedRecipes().flatMap(({ recipe }) => requiredSkillsOf(recipe)),
      ...ACCESS_BONUSES.map((entry) => entry.skill),
    ]);

    expect(SKILLS.filter((name) => gains.has(name) && !effective.has(name))).toEqual([
      'skill_woodwork',
      'skill_preserving',
    ]);
  });
});
