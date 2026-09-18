import { readFileSync } from 'node:fs';
import type { YAMLMap } from 'yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { Combination } from '../../src/domain/Interaction';
import type { RecipeDef } from '../../src/domain/RecipeDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { bundledCodex, worldCodexYamlPaths } from '../support/worldCodexFiles';
import type { PropertyGlobalId } from '../../src/domain/GlobalId';

/**
 * 腕前（characters/player_character.yaml）と、レシピの解放条件（docs/engine/SkillSystem.md 4節）の
 * 自動テスト。
 *
 * 見張るのは、**宣言が世界じゅうに散らばっていて、目視では揃っているか分からないもの**。段の境目は
 * 腕どうしのあいだで、解放条件は段が上がった後も、配る腕は同じ仕事の入口どうしで揃っていなければ
 * ならないが、いずれも1つのファイルを読んでも確かめられない。
 *
 * **どれも「揃っているか」しか見ない。** どの腕を配るのが正しいか・どのレシピに条件を置くべきかは
 * 内容の判断で、その拠り所は docs/world/Skills.md と、characters/player_character.yaml のコメント。
 */

/** 腕前のプロパティの名前の頭。 */
const SKILL_PREFIX = 'skill_';

/** docs/world/Skills.md 2節が挙げる腕。宣言順（characters/player_character.yaml）で並べる。 */
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

/**
 * 製作系の腕（Skills.md 2節）。**アクセス系と分かれるのは、レシピを開けるかと速さへ効くか**
 * ——こちらは解放も速さも歩留まりも持つ（同6節【確定】）。
 */
const CRAFTING_SKILLS = [
  'skill_knapping',
  'skill_cordage',
  'skill_woodwork',
  'skill_joinery',
  'skill_building',
  'skill_leatherwork',
  'skill_cooking',
  'skill_preserving',
] as const;

/** どの腕にも共通の段（SkillSystem.md 6節の目安そのままの4段・比3）。 */
const STAGES = [
  { name: 'novice', min: 0 },
  { name: 'basic', min: 20 },
  { name: 'skilled', min: 60 },
  { name: 'expert', min: 180 },
] as const;

/**
 * 腕が伸びる経路（SkillSystem.md 3節の表）。**書かれている場所で決まる**——操作の直下の `add` が実行、
 * `pick` の候補に埋めた `add` が発見（同3.3節）。練習はまだ世界に無い。
 */
type SkillRoute = 'execution' | 'discovery';

/** 1回で伸びる量（SkillSystem.md 3節の表の「中」と「小」）。どちらも作業の長さに依らず一律。 */
const GAIN_BY_ROUTE: Readonly<Record<SkillRoute, number>> = { execution: 2, discovery: 1 };

/**
 * 島を何個生成して発見の契機の行き渡りを見るか。**1つでも取りこぼせば落ちる**ので、必要なのは
 * 「稀にしか起きない取りこぼしが1件は現れる」規模。土地の型ごとに、それが1つも生成されなかった島の
 * 割合は `stats/island_escape_reach.yaml` の `island_missing_location` にあり、稀なものほど多く回さないと
 * 現れないので、その統計と同じ規模で回す。
 *
 * **測った範囲で1件も取りこぼさない土地もある**ので、そこだけに頼った契機はこの検査では捕まらない。
 * そこを保証するのは土地の生成の側で、ここが見るのは「またいでいるか」だけ。
 */
const ISLAND_SEED_COUNT = 2000;

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
 * 手際を名乗らないと決めたレシピ（`<完成品>.<レシピ>`）。**名乗れない理由は2通り**——どの技術の
 * 仕事でもないものと、工程がtickの刻み1つ（15分）でそこから縮める先が無いもの。理由は1件ずつ、
 * そのレシピのコメントに書いてある（docs/world/Skills.md 7.1節。書いてあることは下の検査が見張る）。
 */
const RECIPES_WITHOUT_DEFTNESS = [
  'bed.spread',
  'campfire.stacked',
  'earth_kiln.heaped',
  'field.tilled',
  'pitfall.dug',
  'salt_pan.laid',
  'torch.wrapped',
  'unfired_jar.coiled',
];

/**
 * 入口（実行経路で腕を配る操作、SkillSystem.md 3節）が1本だけの腕。**1本でよいと決めた分だけ**が
 * 並ぶ——理由は1本ずつ、その入口のコメントに書いてある（同3.2.1節。書いてあることは下の検査が見張る）。
 *
 * **並べるのは「担う手がその1つだけ」と決めた腕で、理由の種類は問わない**——火と保存は担う手そのものが
 * 1つ、料理は置ける相手が1つ（docs/world/Skills.md 2.2・2.4・2.5・2.6節）。どちらであるかは内容の
 * 判断なので、ここが見るのは決めずに素通りできないことだけ。
 */
const SKILLS_WITH_ONE_ENTRY = ['skill_cooking', 'skill_firecraft', 'skill_knapping', 'skill_preserving'];

/**
 * 製作系の腕（Skills.md 2節）と、その段が押し上げる上乗せ（同7節）。**速さの上乗せはここに無い**
 * ——どの腕がどの行動をどれだけ速くするかは行動の側が個別に宣言するので、腕の側に読まれる値が
 * 立たない（同7節。速さの側を見張るのは下の`skillsShorteningTime`を使う検査）。
 */
const CRAFTING_BONUSES = [
  { skill: 'skill_cordage', bonus: 'cordage_thrift', byStage: [0, 10, 25, 60] },
] as const;

/** 無駄の無さの上乗せの名前の尻尾（docs/world/Skills.md 7節の`<腕>_thrift`）。 */
const THRIFT_SUFFIX = '_thrift';

/**
 * その節の下にある `add: {agent: {<腕>: n}}` を、腕の名前・量・経路の組で1件ずつ渡す。効果はロード後には
 * 木へ畳まれていて列挙できないため、理由（reason）を集める bundledLocale.test.ts と同じく構文木を辿る。
 *
 * **配っている量を集めるのも、配っているかを問うのも、この1本を通す。** 同じ状態機械
 * （`add` の何段目に居るか）を2つ持つと、片方だけが `agent` 以外の役を数え始めても気付けない。
 *
 * **経路は `pick` をくぐったかで決まる。** 候補に埋めた `add` が発見で、操作の直下のものが実行
 * （SkillSystem.md 3.3節）——この2つを一緒に数えると、量の違い（+1と+2）が「作業ごとに違う量」に
 * 見えてしまう。
 */
function walkAgentSkillGains(
  node: unknown,
  visit: (skillName: string, amount: number, route: SkillRoute) => void,
): void {
  /** stateは、この節の直下のキーが `add` の何段目に居るか。 */
  const walk = (current: unknown, state: 'none' | 'add' | 'add_agent', route: SkillRoute): void => {
    if (isSeq(current)) {
      for (const item of current.items) walk(item, state, route);
      return;
    }
    if (!isMap(current)) return;

    for (const pair of current.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (state === 'add_agent' && key.startsWith(SKILL_PREFIX)) {
        visit(key, isScalar(pair.value) ? Number(pair.value.value) : Number.NaN, route);
        continue;
      }
      walk(
        pair.value,
        state === 'add' && key === 'agent' ? 'add_agent' : key === 'add' ? 'add' : 'none',
        key === 'pick' ? 'discovery' : route,
      );
    }
  };
  walk(node, 'none', 'execution');
}

/**
 * 定義ファイルが `add` で `agent` の腕前へ配っている量を、腕ごと・経路ごとに集める。
 *
 * 腕が引けること自体が「その腕には伸ばす経路がある」で、経路の別は問わない——発見だけで伸びる腕も、
 * 解放条件に書いてよい（SkillSystem.md 3.2節のブートストラップ）。
 */
function declaredSkillGains(): ReadonlyMap<string, ReadonlyMap<SkillRoute, ReadonlySet<number>>> {
  const gains = new Map<string, Map<SkillRoute, Set<number>>>();
  for (const path of worldCodexYamlPaths())
    walkAgentSkillGains(parseDocument(readFileSync(path, 'utf8')).contents, (skillName, amount, route) => {
      const byRoute = gains.get(skillName) ?? new Map<SkillRoute, Set<number>>();
      gains.set(skillName, byRoute);
      const amounts = byRoute.get(route) ?? new Set<number>();
      byRoute.set(route, amounts);
      amounts.add(amount);
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

/**
 * 世界のどこかで `{subject: agent, prop: ...}` として読まれているプロパティ。**読む側の書き方は1つ**
 * なので、レシピの解放条件（docs/engine/SkillSystem.md 4節）も、操作の `conditions` も、`base` の
 * 土台も、レシピの `deftness`・`surplus` の重み（GameElementDefinition.md 13.5節）も、この1本で
 * 拾える——**どこで読まれているかではなく、読まれているかだけを問う。**
 */
function propsReadFromAgent(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const path of worldCodexYamlPaths())
    agentReadsUnder(parseDocument(readFileSync(path, 'utf8')).contents, found);
  return found;
}

/** その節の下で `{subject: agent, prop: ...}` として読まれているプロパティを集める。 */
function agentReadsUnder(node: unknown, found: Set<string>): void {
  if (isSeq(node)) {
    for (const item of node.items) agentReadsUnder(item, found);
    return;
  }
  if (!isMap(node)) return;

  const subject = node.get('subject', true);
  const prop = node.get('prop', true);
  if (isScalar(subject) && String(subject.value) === 'agent' && isScalar(prop)) found.add(String(prop.value));
  for (const pair of node.items) agentReadsUnder(pair.value, found);
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

/**
 * そのpropの宣言の`passives`が、その腕の段を条件にして自分を縮めているか（docs/world/Skills.md 7節）。
 *
 * **見るのは条件が名指した腕だけ**——縮む分数と効き始める段は行動ごとに選んでよいので、揃っている
 * ことを求めるものではない。**主語はagent**（今その操作をしている人）で、そこが `self` になると
 * 相手の腕で縮む宣言になる。
 */
function shortensWithSkill(propBody: unknown, skillName: string): boolean {
  const passives = isMap(propBody) ? propBody.get('passives', true) : undefined;
  if (!isSeq(passives)) return false;

  return passives.items.some((passive) => {
    if (!isMap(passive)) return false;
    const conditions = passive.get('conditions', true);
    if (!isSeq(conditions)) return false;
    return conditions.items.some((condition) => {
      if (!isMap(condition)) return false;
      const subject = condition.get('subject', true);
      const prop = condition.get('prop', true);
      return (
        isScalar(subject) &&
        String(subject.value) === 'agent' &&
        isScalar(prop) &&
        String(prop.value) === skillName
      );
    });
  });
}

/**
 * そのノードの手前に書いてあるコメント（無ければ空文字）。
 *
 * **並びの最初の要素に付けたコメントは、要素ではなく入れ物のほうに付く**（yamlの構文木の作り）ので、
 * 拾う側はキーと値の両方を見る。
 */
function commentBeforeOf(node: unknown): string {
  return typeof (node as { commentBefore?: unknown } | undefined)?.commentBefore === 'string'
    ? (node as { commentBefore: string }).commentBefore
    : '';
}

/**
 * レシピの手前に書いてあるコメントを、`<完成品>.<レシピ>` ごとに集める。拾うのは **`recipes` の直上と
 * レシピ自身の直上だけ**——型の側のコメントまで拾うと、**別の話で同じ語を使っている型**へレシピを
 * 足したときに、理由を書かないまま通ってしまう。
 *
 * ロード後の`RecipeDef`はコメントを持たない（読み捨てられる）ので、構文木を辿る。
 */
function commentsAboveRecipes(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();

  for (const path of worldCodexYamlPaths()) {
    const root = parseDocument(readFileSync(path, 'utf8')).contents;
    if (!isMap(root)) continue;

    for (const section of root.items) {
      const sectionKey = isScalar(section.key) ? String(section.key.value) : '';
      if ((sectionKey !== 'traits' && sectionKey !== 'object_defs') || !isMap(section.value)) continue;

      for (const entry of section.value.items) {
        const defName = isScalar(entry.key) ? String(entry.key.value) : '';
        if (!isMap(entry.value)) continue;
        const recipes = entry.value.items.find(
          (pair) => isScalar(pair.key) && String(pair.key.value) === 'recipes',
        );
        if (recipes === undefined || !isMap(recipes.value)) continue;

        const aboveRecipes = commentBeforeOf(recipes.key);
        for (const [index, recipe] of recipes.value.items.entries())
          found.set(
            `${defName}.${isScalar(recipe.key) ? String(recipe.key.value) : ''}`,
            [
              aboveRecipes,
              // 最初のレシピの手前のコメントは、レシピではなく`recipes`の値のほうに付く。
              index === 0 ? commentBeforeOf(recipes.value) : '',
              commentBeforeOf(recipe.key),
            ].join('\n'),
          );
      }
    }
  }
  return found;
}

/** 世界じゅうのプロパティ宣言を「どこの・どの名前の」の形で並べる（traitのpropsも型のpropsも）。 */
function declaredProps(): readonly { where: string; def: string; name: string; body: unknown }[] {
  const found: { where: string; def: string; name: string; body: unknown }[] = [];

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
            def: defName,
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

/** 世界じゅうのプロパティ宣言を、型の名前 → プロパティの名前 で引けるようにしたもの。 */
function declaredPropsByDef(): ReadonlyMap<string, ReadonlyMap<string, unknown>> {
  const byDef = new Map<string, Map<string, unknown>>();
  for (const { def, name, body } of declaredProps()) {
    const props = byDef.get(def) ?? new Map<string, unknown>();
    byDef.set(def, props);
    props.set(name, body);
  }
  return byDef;
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

/**
 * 発見の契機（SkillSystem.md 3.3節）が配る腕ごとに、**その契機を持つ探索を宣言している型の名前**を
 * 集める。
 *
 * **数えるのは「どの型が契機を担うか」ではなく「どこで配られるか」。** 3.3節が置いた線は
 * 「同じ腕前へ配る型を、土地の型をまたいで置く」で、破れたときに起きるのは**その腕の契機が丸ごと
 * 無い島が生成されること**。契機が在るかは土地の側で決まるので、出す型を数え上げるより直に引ける
 * ——候補は複数の型を出すため、型の側から数えると「腕と関わりの無い型（石と一緒に出る小枝）が
 * どの島にも在るぶんで緑になる」を避ける算段が要る。
 *
 * **見るのは `explore` の下だけ。** 契機を書けるのは操作している人が居る場面に限られ（`agent` を
 * 書けない `on_max`/`on_min` からは腕の持ち主を指せない、docs/engine/TrapSystem.md 8節）、罠と囲いの
 * 抽選は契機を持ちようが無い。入れ子の `pick`（山頂の `on_max` など）も候補として同じように辿る。
 *
 * **島に出ない土地もそのまま並ぶ**（海区・沖の小島）。島の生成に現れないので、突き合わせる側で
 * 落ちる——渡って行く先は、島に流れ着いた時点での契機にならない。
 */
function discoveryGrantLocations(): ReadonlyMap<string, ReadonlySet<string>> {
  const bySkill = new Map<string, Set<string>>();

  /** 探索1つの `pick`（入れ子も含む）の候補が配る腕を、その探索を宣言している型へ結び付ける。 */
  const collectCandidates = (node: unknown, defName: string): void => {
    if (isSeq(node)) {
      for (const item of node.items) collectCandidates(item, defName);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      if (isScalar(pair.key) && String(pair.key.value) === 'pick' && isSeq(pair.value))
        for (const candidate of pair.value.items) {
          if (!isMap(candidate)) continue;
          // 候補から見て `pick` をくぐらないもの＝この候補自身の `add`。入れ子の候補の `add` は
          // `discovery` で届くので、そちらと混ざらない（入れ子は下の再帰が自分で拾う）。
          walkAgentSkillGains(candidate, (skillName, _amount, route) => {
            if (route !== 'execution') return;
            const found = bySkill.get(skillName) ?? new Set<string>();
            bySkill.set(skillName, found);
            found.add(defName);
          });
        }
      collectCandidates(pair.value, defName);
    }
  };

  for (const path of worldCodexYamlPaths()) {
    const root = parseDocument(readFileSync(path, 'utf8')).contents;
    if (!isMap(root)) continue;
    for (const section of root.items) {
      const sectionKey = isScalar(section.key) ? String(section.key.value) : '';
      if ((sectionKey !== 'traits' && sectionKey !== 'object_defs') || !isMap(section.value)) continue;

      for (const entry of section.value.items) {
        const defName = isScalar(entry.key) ? String(entry.key.value) : '';
        const interactions = isMap(entry.value) ? entry.value.get('interactions', true) : undefined;
        const explore = isMap(interactions) ? interactions.get('explore', true) : undefined;
        if (explore !== undefined) collectCandidates(explore, defName);
      }
    }
  }
  return bySkill;
}

/** 操作1つ分の、出す物と配る腕。 */
interface InteractionGains {
  /** この操作を宣言している型（`interactions` を持つ節の名前）。 */
  readonly owner: string;
  readonly name: string;
  /** その操作が`spawn`で出す型の名前（`pick`の候補の中のものも含む）。 */
  readonly products: readonly string[];
  readonly skills: readonly string[];
  /** 相手へ重ねて始まる操作か（`trigger`が`drag`）。 */
  readonly needsInstrument: boolean;
  /** `duration` が読んでいるプロパティの名前。リテラルの分数で書いていればundefined。 */
  readonly durationProp: string | undefined;
  /** その操作が `{subject: agent, prop: ...}` で読んでいるもの（余分の卓の重みもここに出る）。 */
  readonly agentReads: readonly string[];
  /**
   * その操作の手前に書いてあるコメント。**拾うのは操作自身の直上だけ**で、`interactions` の
   * 直上（型の側の話）までは拾わない——拾うと、別の話で同じ語を使っている型へ操作を足したときに
   * 理由を書かないまま通ってしまう（`commentsAboveRecipes` と同じ線）。
   */
  readonly comment: string;
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

  /** ownerは、今辿っている節を持つキー（`interactions`へ着いたとき、それを宣言している型の名前）。 */
  const walk = (node: unknown, owner: string): void => {
    if (isSeq(node)) {
      for (const item of node.items) walk(item, owner);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (key !== 'interactions' || !isMap(pair.value)) {
        walk(pair.value, key);
        continue;
      }
      for (const [index, entry] of pair.value.items.entries()) {
        const body = entry.value;
        if (!isMap(body)) continue;
        const products = new Set<string>();
        productsUnder(body, products);
        const agentReads = new Set<string>();
        agentReadsUnder(body, agentReads);

        const add = body.get('add', true);
        const agent = isMap(add) ? add.get('agent', true) : undefined;
        const skills = isMap(agent)
          ? agent.items
              .map((item) => (isScalar(item.key) ? String(item.key.value) : ''))
              .filter((name) => name.startsWith(SKILL_PREFIX))
          : [];
        const duration = body.get('duration', true);
        const durationProp = isMap(duration) ? duration.get('prop', true) : undefined;

        const trigger = body.get('trigger', true);

        found.push({
          owner,
          name: isScalar(entry.key) ? String(entry.key.value) : '',
          products: [...products].sort(),
          skills: skills.sort(),
          needsInstrument: isMap(trigger) && trigger.get('drag', true) !== undefined,
          durationProp: isScalar(durationProp) ? String(durationProp.value) : undefined,
          agentReads: [...agentReads].sort(),
          // 最初の操作の手前のコメントは、操作ではなく`interactions`の値のほうに付く。
          comment: [index === 0 ? commentBeforeOf(pair.value) : '', commentBeforeOf(entry.key)].join('\n'),
        });
      }
    }
  };

  for (const path of worldCodexYamlPaths()) walk(parseDocument(readFileSync(path, 'utf8')).contents, '');
  return found;
}

/**
 * 余分の卓が1つ引き当てる枝（docs/world/Skills.md 7.2節）。`baseCount`は同じ節が宣言している素の
 * 産出で、見つからなければundefined——**素が何個かを言わない卓は、上限を満たすとも言えない**。
 */
interface SurplusBranch {
  readonly where: string;
  readonly object: string | undefined;
  readonly baseCount: number | undefined;
  readonly surplusCount: number | undefined;
}

/** `spawn:`（1件でも並びでも）が出す型と、その個数（`count`を省けば1つ）。 */
function spawnCountsOf(spawnNode: unknown): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const entry of isSeq(spawnNode) ? spawnNode.items : [spawnNode]) {
    if (!isMap(entry)) continue;
    const object = entry.get('object', true);
    if (!isScalar(object)) continue;
    const count = entry.get('count', true);
    const name = String(object.value);
    counts.set(name, (counts.get(name) ?? 0) + (isScalar(count) ? Number(count.value) : 1));
  }
  return counts;
}

/** その枝の重みが無駄の無さを読んでいるか（読んでいれば、その枝が「当たり」）。 */
function readsThriftWeight(branch: unknown): boolean {
  const weight = isMap(branch) ? branch.get('weight', true) : undefined;
  const prop = isMap(weight) ? weight.get('prop', true) : undefined;
  return isScalar(prop) && String(prop.value).endsWith(THRIFT_SUFFIX);
}

/**
 * 世界じゅうの余分の卓の「当たり」の枝。**在り処では探さない**——レシピの `surplus` も手作業の
 * `pick` も同じ並びなので、**重みが無駄の無さを読んでいること**だけで拾う。名指しで数え上げると、
 * 次に足された卓が素通りする。**無駄の無さと見分けるのは名前の尻尾**（`<腕>_thrift`、
 * docs/world/Skills.md 7節の表）なので、別の名前で置かれた上乗せは拾えない。
 *
 * 素の産出は、`pick` ならその卓と同じ節の `spawn`、`surplus` なら常に1つ——レシピが出す成果物は
 * 進捗が上限へ届いた瞬間の `become` 1回ぶんだから（docs/engine/RecipeSystem.md 1節）。
 */
function declaredSurplusBranches(): readonly SurplusBranch[] {
  const found: SurplusBranch[] = [];

  const walk = (node: unknown, where: string): void => {
    if (isSeq(node)) {
      for (const item of node.items) walk(item, where);
      return;
    }
    if (!isMap(node)) return;

    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      const here = where === '' ? key : `${where}.${key}`;
      if ((key === 'pick' || key === 'surplus') && isSeq(pair.value)) {
        const baseCounts = key === 'surplus' ? undefined : spawnCountsOf(node.get('spawn', true));
        for (const branch of pair.value.items) {
          if (!readsThriftWeight(branch)) continue;
          const spawns = spawnCountsOf(isMap(branch) ? branch.get('spawn', true) : undefined);
          // **物を出さない当たりの枝は、1件として数えてから落とす。** 黙って読み飛ばすと、余分を
          // `spawn` 以外（`transfer` など）で渡す卓が、走査しても1件も拾われないまま通る。
          if (spawns.size === 0)
            found.push({ where: here, object: undefined, baseCount: undefined, surplusCount: undefined });
          for (const [object, surplusCount] of spawns)
            found.push({
              where: here,
              object,
              baseCount: baseCounts === undefined ? 1 : baseCounts.get(object),
              surplusCount,
            });
        }
      }
      walk(pair.value, here);
    }
  };

  for (const path of worldCodexYamlPaths()) walk(parseDocument(readFileSync(path, 'utf8')).contents, '');
  return found;
}

/**
 * 腕ごとの入口——実行経路でその腕を配る操作（SkillSystem.md 3節）を、腕の名前で引けるようにしたもの。
 *
 * **発見の契機は入らない。** `declaredInteractions`が数える`skills`は操作の直下の`add`だけで、`pick`の
 * 候補に埋めたものは拾わない（同3.3節）——**時間を投じて繰り返せる手はこちらだけ**で、探索の契機は
 * 何に出くわしたかが決めるので、投じ先として選べない。
 */
function entriesBySkill(): ReadonlyMap<string, readonly InteractionGains[]> {
  const bySkill = new Map<string, InteractionGains[]>();

  for (const interaction of declaredInteractions())
    for (const skill of interaction.skills) {
      const entries = bySkill.get(skill) ?? [];
      bySkill.set(skill, entries);
      entries.push(interaction);
    }
  return bySkill;
}

describe('腕前とレシピの解放条件', () => {
  let codex: WorldCodex;
  let skillIds: readonly PropertyGlobalId[];

  beforeAll(() => {
    codex = bundledCodex();
    skillIds = SKILLS.map((name) => codex.propertyNames.getId(name));
  });

  /** プレイヤーキャラクタを1体作り、腕をすべてその値にする。 */
  function characterWithSkills(value: number, characterName = 'medic'): WorldObject {
    const character = new WorldSession(codex).createObject(codex.objectNames.getId(characterName));
    for (const id of skillIds) character.getProperty(id).setNumberWithoutEvents(value);
    return character;
  }

  /**
   * そのレシピの解放条件が要求している腕。**条件木は畳まれていて読めない**ので、全部を熟達させた
   * 状態から1本ずつ素人へ落として、条件が落ちるかで割り出す。
   *
   * **割り出しを1本にまとめてある**——要求している腕を問う側は複数あり、落とし方が2つあると、
   * 片方だけが連言の2本目を数え落としても気付けない。
   */
  function requiredSkills(product: string, recipe: RecipeDef): ReadonlySet<string> {
    // 落とす前が開いていなければ、落ちたことが「その腕を要求している」の証拠にならない。開かない
    // レシピは「解放条件は、腕が上がった後も満たされ続ける」が捕まえるので、ここは前提だけを確かめる。
    expect(
      recipe.unmetUnlockRequirement(characterWithSkills(STAGES.at(-1)!.min)),
      `'${product}': 熟達しても開かない`,
    ).toBeUndefined();

    const required = new Set<string>();
    for (const [index, skillName] of SKILLS.entries()) {
      const character = characterWithSkills(STAGES.at(-1)!.min);
      character.getProperty(skillIds[index]).setNumberWithoutEvents(0);
      if (recipe.unmetUnlockRequirement(character) !== undefined) required.add(skillName);
    }
    return required;
  }

  /** 世界じゅうのレシピすべて（完成品の名前を添える）。 */
  function allRecipes(): readonly { product: string; recipe: RecipeDef }[] {
    const found: { product: string; recipe: RecipeDef }[] = [];
    for (const product of codex.objects) {
      for (const recipe of product.recipesProducingThis)
        // 作りかけの型（レシピの軸を持つ変種）は同じレシピを二度数えさせるので、素の型だけを見る。
        if (codex.baseOf(product) === product) found.push({ product: product.name, recipe });
    }
    return found;
  }

  /** 解放条件を持つレシピすべて（完成品の名前を添える）。 */
  function gatedRecipes(): readonly { product: string; recipe: RecipeDef }[] {
    return allRecipes().filter(({ recipe }) => recipe.unlock !== undefined);
  }

  /**
   * 世界のどこかで、行動の時間を縮めている腕（docs/world/Skills.md 7節）。
   *
   * **宣言は行動の側に散っている**——レシピは`deftness`で名乗り、手作業は所要時間の`passives`で
   * 段を読む。**どちらか片方だけを見ると、もう片方でしか効いていない腕を「効いていない」と数える。**
   */
  function skillsShorteningTime(): ReadonlySet<string> {
    const found = new Set<string>();
    for (const { recipe } of allRecipes())
      if (recipe.deftness !== undefined)
        found.add(codex.propertyNames.getName(recipe.deftness.skillGlobalId));
    for (const props of declaredPropsByDef().values())
      for (const body of props.values())
        for (const skill of SKILLS) if (shortensWithSkill(body, skill)) found.add(skill);
    return found;
  }

  it('プレイヤーキャラクタは、Skills.md 2節の腕を腕前のタグ付きで持つ', () => {
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

  it('どの腕も段は同じ境目を持つ（本ごとに basic の遠さが変わらない）', () => {
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

  it('どの腕も、段が下端を名乗っている（受け皿にして進みを消さない）', () => {
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

  it('発見の契機は、どの島にも1つは残る（同じ腕へ配る型が土地の型をまたぐ）', () => {
    // SkillSystem.md 3.3節。契機は土地の探索の候補へ書くので、**その土地が生成されなかった島では
    // 契機ごと消える**——1つの土地の型に頼ると、その型が出なかった島でその腕の発見経路が無くなる
    // （密林だけのマニラ麻なら半分の島）。土地の型をまたいで並べることでしか防げず、並んでいるかは
    // 定義を読んでも分からない（どの土地がどの島に出るかは生成が決める）ので、実際に島を生成する。
    const grantLocations = discoveryGrantLocations();

    // **契機を受け取っている腕は、下の突き合わせにも必ず並ぶ。** 契機の在り処が1つも立たなかった腕は
    // `grantLocations` から消えるので、そのまま回すと**見られていないことが緑と見分けられない**
    // ——残りの腕だけで非空になり、その腕の契機をどこへ寄せても落ちない。
    const granted = [...declaredSkillGains()]
      .filter(([, byRoute]) => byRoute.has('discovery'))
      .map(([skillName]) => skillName);

    expect(granted.length, '発見の契機が1つも無い').toBeGreaterThan(0);
    expect(
      granted.filter((skillName) => (grantLocations.get(skillName)?.size ?? 0) === 0),
      '契機を配っているのに、その在り処が1つも立たない腕',
    ).toEqual([]);

    const lost: string[] = [];
    for (let seed = 0; seed < ISLAND_SEED_COUNT; seed++) {
      // サイトの型は生成の最後までに必ず決まる（LocationTypeMatcherが受け皿へ倒す、
      // src/analysis/discoveryCoverage.ts）。決まらないまま残ると、その島は「土地が無い」側に
      // 数えられて下が落ちるので、黙って取りこぼす形にはならない。
      const present = new Set(
        generateIsland(codex.generation!, 'island', seed).sites.map((site) =>
          site.type === undefined ? '' : codex.objects.get(site.type.objectDefGlobalId).name,
        ),
      );
      for (const [skillName, locationNames] of grantLocations)
        if (![...locationNames].some((name) => present.has(name))) lost.push(`種${seed}: ${skillName}`);
    }

    expect(lost.slice(0, 5), `${ISLAND_SEED_COUNT}個の島で、契機が丸ごと消えた腕`).toEqual([]);
  });

  it('探索そのものは腕を配らない（配るのは当たった候補の側）', () => {
    // SkillSystem.md 3.3節。土地を調べる1手ではなく**何に出くわしたか**が腕を分けるので、`explore`の
    // 直下へ`add`を書いてはいけない。書くと、獣も石も出なかった回まで同じだけ伸びる。
    // **直下に書かれた`add`は実行経路として数えられる**ので、量の検査（+2なら緑）では捕まらない。
    expect(
      declaredInteractions()
        .filter((interaction) => interaction.name === 'explore' && interaction.skills.length > 0)
        .map((interaction) => interaction.skills.join('・')),
    ).toEqual([]);
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

    for (const { product, recipe } of gatedRecipes())
      for (const skillName of requiredSkills(product, recipe))
        expect(gains.has(skillName), `'${product}' が要求する ${skillName} を伸ばす操作が世界に無い`).toBe(
          true,
        );
  });

  it('製作系の腕は、段が上がるほど上乗せを強くする', () => {
    // アクセス系（上のテスト）と同じ形。**素は0**で、上の段ほど効きが強い。**ここに並ぶのは
    // 歩留まりだけ**——速さは腕の側に読まれる値を立てず、行動ごとに宣言する
    // （docs/world/Skills.md 6節）ので、上乗せとして数えられるものが無い。
    // 見るのは大小ではなく、**符号が揃っていることと、絶対値が段ごとに伸びること**。
    for (const { skill, bonus, byStage } of CRAFTING_BONUSES) {
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
      expect(new Set(byStage.filter((value) => value !== 0).map(Math.sign)).size, `${bonus} の符号`).toBe(1);
      const strength = byStage.map(Math.abs);
      expect(strength, `${bonus} は段が上がるほど効きが強い`).toEqual([...strength].sort((a, b) => a - b));
      expect(strength.at(-1), `${bonus} は段で動く`).toBeGreaterThan(0);
    }
  });

  it('腕を上げると、その腕を名乗るレシピの工程は短くなる', () => {
    // **名乗った腕が実際にその工程へ届いていることを、実データで押さえるのはここだけ。** 宣言の形
    // （符号・刻み）はロード時が弾くが、**名指した腕を作り手が持っていなければ黙って効かない**
    // ——`skill` の綴り違いも、伸ばす操作を持たない腕を名乗った場合も、そこでは何も落ちない。
    //
    // 合成YAMLに手で値を入れる側（tests/domain/crafting.test.ts）では代われない。あちらが見るのは
    // エンジンの積み方で、世界が名指した腕を誰が持っているかは読んでいない。
    const novice = characterWithSkills(STAGES[0].min);
    const expert = characterWithSkills(STAGES.at(-1)!.min);
    // **解放を要求しないレシピも名乗る**（Skills.md 7.1節）ので、見るのは世界じゅうのレシピ。
    const named = allRecipes().filter(({ recipe }) => recipe.deftness !== undefined);
    expect(named.length, '手際を名乗るレシピが1つも無い').toBeGreaterThan(0);

    for (const { product, recipe } of named)
      for (const [index, step] of recipe.steps.entries())
        expect(
          recipe.minutesFor(step, expert),
          `'${product}' の工程${index + 1}: 熟達しても短くならない`,
        ).toBeLessThan(recipe.minutesFor(step, novice));
  });

  it('腕を要求するレシピは、要求している腕の手際を名乗る', () => {
    // **名乗りは解放条件から導けない**（連言なので1つに定まらない、docs/world/Skills.md 7節）ので、
    // レシピごとに書く。書き忘れると、その1本だけ腕を上げても速くならないレシピになる——目視では
    // 揃っているか分からないので、ここで塞ぐ。**要求していない腕を名乗るのも誤り**で、作れるように
    // なった腕とは別の腕を上げないと速くならない形になる。
    const recipes = gatedRecipes();
    expect(recipes.length, '腕を要求するレシピが1つも無い').toBeGreaterThan(0);

    for (const { product, recipe } of recipes) {
      const deftness = recipe.deftness;
      expect(deftness, `'${product}': 速さを決める腕を名乗っていない`).toBeDefined();

      const skill = codex.propertyNames.getName(deftness!.skillGlobalId);
      expect([...requiredSkills(product, recipe)], `'${product}' が名乗る ${skill}`).toContain(skill);
    }
  });

  it('手際を名乗らないレシピは、名乗らないと決めた分だけ', () => {
    // **解放条件を持たないレシピも名乗る**（docs/world/Skills.md 7.1節）ので、名乗っていないことは
    // 「どの技術の仕事でもないと決めた」の印になる。決めた覚えの無いレシピがここへ落ちてくるのを
    // 止める——**新しいレシピは、名乗るか、ここへ足すかのどちらかを選ぶことになる。**
    //
    // **どの腕が正しいかは見ない**（それは内容の判断で、拠り所はSkills.md 7.1節と各レシピの
    // コメント）。見るのは、決めずに素通りできないことだけ。
    expect(
      allRecipes()
        .filter(({ recipe }) => recipe.deftness === undefined)
        .map(({ product, recipe }) => `${product}.${recipe.name}`)
        .sort(),
    ).toEqual(RECIPES_WITHOUT_DEFTNESS);
  });

  it('手際を名乗らないと決めたレシピは、その理由がコメントに書いてある', () => {
    // 一つ上の数え上げは、**足せば黙って通せる**——理由を書かせるのはここ。Skills.md 7.1節が
    // 「名乗らないと決めた側は、そのレシピのコメントに理由を書きます」と言っている以上、それが
    // 破れたときに落ちるものが要る（書いてあるかを見るだけで、中身の当否は人が読む）。
    //
    // **語を2つとも求める**——どちらか1つなら、手際と関わりのない文でも当たってしまう。
    const comments = commentsAboveRecipes();

    expect(
      RECIPES_WITHOUT_DEFTNESS.filter((where) => {
        const comment = comments.get(where) ?? '';
        return !comment.includes('手際') || !comment.includes('名乗らない');
      }),
      '名乗らない理由が書いていないレシピ',
    ).toEqual([]);
  });

  it('レシピが名乗る手際は、伸ばす操作を持つ腕のもの', () => {
    // **上げようのない腕が速さを握らない**（docs/world/Skills.md 7.1節）。伸ばす操作をまだ持たない
    // 腕を名乗ると、そのレシピの工程は誰にも縮められない時間になる——腕は宣言だけ先に置かれる
    // （SkillSystem.md 3.2節）ので、名乗る側が先走れてしまう。
    //
    // **アクセス系も同じくここで落ちる**（それを配る操作は無いので）。火の腕が決めるのは着火の
    // 重みだけで、火起こし具を削る速さではない（同5節）。
    const gains = declaredSkillGains();

    expect(
      allRecipes()
        .filter(({ recipe }) => recipe.deftness !== undefined)
        .map(({ product, recipe }) => ({
          where: `${product}.${recipe.name}`,
          skill: codex.propertyNames.getName(recipe.deftness!.skillGlobalId),
        }))
        .filter(({ skill }) => !gains.has(skill))
        .map(({ where, skill }) => `${where}: ${skill}`),
      '伸ばしようのない腕を名乗るレシピ',
    ).toEqual([]);
  });

  /**
   * 腕で縮むはずの手作業——**製作系の腕を配る操作**（docs/world/Skills.md 7節）と、配っている腕。
   * 伸びる場面と速くなる場面を揃えるので、**引き当ては配る腕から出す**。アクセス系（火・狩猟）を配る
   * 操作は速さを持たないので、ここには現れない。
   */
  function handworkShortenedBySkill(): readonly { interaction: InteractionGains; skill: string }[] {
    const crafting = new Set<string>(CRAFTING_SKILLS);
    const found: { interaction: InteractionGains; skill: string }[] = [];
    for (const interaction of declaredInteractions())
      for (const skill of interaction.skills) if (crafting.has(skill)) found.push({ interaction, skill });
    return found;
  }

  /** その手作業が所要時間として読んでいるプロパティの宣言（読んでいなければundefined）。 */
  function durationPropBody(
    interaction: InteractionGains,
    props: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  ): unknown {
    return interaction.durationProp === undefined
      ? undefined
      : props.get(interaction.owner)?.get(interaction.durationProp);
  }

  /** その手作業を、腕がすべてその値の人が行うときの所要時間（分）。 */
  function handworkMinutes(interaction: InteractionGains, skillValue: number): number {
    // **相手は作業者と同じ世界に作る**——役（11.5節）は1つの関係の中でしか結べないので、
    // 別のセッションに居ると手際の土台が辿り着かない。
    const agent = characterWithSkills(skillValue);
    const session = agent.session;
    const self = session.createObject(codex.objectNames.getId(interaction.owner));

    const action = self.tryGetAction(interaction.name, agent);
    if (action !== undefined) return action.executionMinutes();

    // 重ねて起こす操作（12節）。**instrumentは何でもよい**——見るのは所要時間で、そこが読む土台は
    // agentの側だけを指している。
    const trigger = self.def.dragTriggers.find(
      (candidate) => candidate.interaction.name === interaction.name,
    );
    expect(trigger, `${interaction.owner} の ${interaction.name} が引けない`).toBeDefined();
    const instrumentDef = [...codex.objects].find((def) => trigger!.acceptsInstrument(def));
    expect(instrumentDef, `${interaction.owner} の ${interaction.name} に重ねられる型が無い`).toBeDefined();
    return new Combination(
      trigger!,
      self,
      agent,
      session.createObject(instrumentDef!.globalId),
    ).executionMinutes();
  }

  it('製作系の腕を配る手作業は、その腕で縮む時間を名乗る', () => {
    // レシピの`deftness`（一つ上の検査）と対になるもの。**手で作る側は、作る相手が自分の時間を持ち、
    // その`passives`で作り手の腕の段を読む**（docs/world/Skills.md 7節）。見るのは**配る腕と縮める腕が
    // 同じであること**——揃っていないと、伸ばしたのとは別の腕を上げないと速くならない手作業になる。
    // 書き忘れればその1つだけが腕で縮まないまま残るが、宣言は世界じゅうに散っていて目視では分からない。
    const props = declaredPropsByDef();
    const handwork = handworkShortenedBySkill();
    expect(handwork.length, '製作系の腕を配る操作が1つも無い').toBeGreaterThan(0);

    for (const { interaction, skill } of handwork) {
      const where = `${interaction.owner} の ${interaction.name}`;
      expect(interaction.durationProp, `${where}: 所要時間がプロパティを読んでいない`).toBeDefined();
      const body = durationPropBody(interaction, props);
      expect(body, `${where}: ${interaction.durationProp} を自分のpropsで宣言していない`).toBeDefined();
      expect(shortensWithSkill(body, skill), `${where}: 所要時間が ${skill} の段を読んでいない`).toBe(true);
    }
  });

  it('腕を上げると、その腕を配る手作業は実際に短くなる', () => {
    // 一つ上は宣言の形しか見ないので、**縮める向きが逆でも通る**（正の量をmodifyすれば腕が上がるほど
    // 長くなる）。向きは、実際に分数を引き比べないと出ない——レシピ側の同じ検査と対。
    //
    // **素人の分数が宣言どおりであることも一緒に見る。** 参照が解けなければ所要時間は0分になるが
    // （GameElementDefinition.md 10.2節）、「短くなった」だけでは0分と見分けが付かない。
    const props = declaredPropsByDef();

    for (const { interaction } of handworkShortenedBySkill()) {
      const where = `${interaction.owner} の ${interaction.name}`;
      const novice = handworkMinutes(interaction, STAGES[0].min);
      expect(novice, `${where}: 素人の所要時間が宣言と違う`).toBe(
        declaredValueOf(durationPropBody(interaction, props)),
      );
      expect(
        handworkMinutes(interaction, STAGES.at(-1)!.min),
        `${where}: 熟達しても短くならない`,
      ).toBeLessThan(novice);
    }
  });

  it('手作業が引く余分の卓は、その手作業が配る腕の無駄の無さを読む', () => {
    // レシピの`surplus`と違い、手作業は効く腕を名乗らない（配る腕がそのまま効く腕、
    // docs/world/Skills.md 7節）。**別の腕の卓を引いてしまうと、伸ばしたのとは違う腕で歩留まりが
    // 変わる**——`pick`の重みは他のどの重みとも同じ書き方なので、読み違えても形は整って見える。
    const skillOfThrift = new Map<string, string>(
      CRAFTING_BONUSES.filter((entry) => entry.bonus.endsWith(THRIFT_SUFFIX)).map((entry) => [
        entry.bonus,
        entry.skill,
      ]),
    );
    let drawn = 0;

    for (const interaction of declaredInteractions())
      for (const bonus of interaction.agentReads.filter((name) => name.endsWith(THRIFT_SUFFIX))) {
        drawn += 1;
        expect(
          interaction.skills,
          `${interaction.owner} の ${interaction.name}: ${bonus} は、この手が配る腕のものではない`,
        ).toContain(skillOfThrift.get(bonus));
      }

    expect(drawn, '余分の卓を引く手作業が1つも無い').toBeGreaterThan(0);
  });

  it('余分の卓が足すのは、素の産出の1/3まで', () => {
    // docs/world/Skills.md 7.2節【確定】。**上限は当たったときの増分で置く**ので、刻み
    // （`<腕>_thrift`）がいくら大きくても、枝を1つしか引かない`pick`では平均もこの水準に収まる。
    //
    // **物は割れないので、素が3つ以上ある卓だけが余分を1つ足せる。** 素が2つの卓へ1つ足せば
    // +50%で、ここで落ちる。
    const branches = declaredSurplusBranches();
    expect(branches.length, '余分の卓が世界に1つも無い').toBeGreaterThan(0);

    for (const branch of branches) {
      const where = `${branch.where} の ${branch.object ?? '当たりの枝'}`;
      // 出す物を持たない枝は、足す量を数えられない（`spawn` 以外で余分を渡す形は見張れない）。
      expect(branch.surplusCount, `${where}: 当たっても物を出していない`).toBeDefined();
      // 素を名乗らない卓は、上限を満たすとも言えない——別の物を出す枝も、ここで落ちる。
      expect(branch.baseCount, `${where}: 素の産出が同じ節に無い`).toBeDefined();
      expect(
        branch.surplusCount! * 3,
        `${where}: 素の${branch.baseCount}個へ${branch.surplusCount}個を足している`,
      ).toBeLessThanOrEqual(branch.baseCount!);
    }
  });

  it('腕を配る操作は、経路ごとに一律の量を配る（作業の長さでは変えない）', () => {
    // 量を作業ごとに変えると、短い作業を繰り返すのが最も速い伸ばし方になる。繰り返しの稼ぎを
    // 抑えるのは時間のコストだけ（SkillSystem.md 7節）。**経路の間でだけ差を置く**——発見は実行より
    // 小さい（同3節の表）ので、同じ+2で並べると探索が仕事と同じ重みの入口になる。
    for (const [skillName, byRoute] of declaredSkillGains())
      for (const [route, amounts] of byRoute)
        expect([...amounts], `${skillName} が ${route} で配る量`).toEqual([GAIN_BY_ROUTE[route]]);
  });

  it('腕を配る操作は、物を出すか相手を要する（腕だけが伸びる操作を置かない）', () => {
    // SkillSystem.md 3.1節。**練習は専用のアクションではなく、その腕の最も初歩的な行動そのもの**
    // なので、腕だけが伸びる操作——何も出さず、重ねる相手も要らないもの——は世界に1つも無い。
    // 腕前ごとに1つ並ぶ専用の練習アクションを足すと、ここで落ちる。
    //
    // **見ているのは相手が居ることまでで、何を消費するかまでは見ない**——`become`で相手を変える
    // だけの操作（塩漬け）も、出す物を持たないまま通る。
    const gaining = declaredInteractions().filter((interaction) => interaction.skills.length > 0);
    expect(gaining.length, '腕を配る操作が1つも無い').toBeGreaterThan(0);

    expect(
      gaining
        .filter((interaction) => interaction.products.length === 0 && !interaction.needsInstrument)
        .map((interaction) => interaction.name),
      '何も出さず、重ねる相手も要らない操作が腕を配っている',
    ).toEqual([]);
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

    for (const [products, group] of shared) {
      const where = `'${products}' を出す ${group.map((i) => i.name).join('・')}`;
      expect(
        new Set(group.map((interaction) => interaction.skills.join(','))).size,
        `${where} で、配る腕が食い違う`,
      ).toBe(1);
      // **余分の卓も揃える**（docs/world/Skills.md 7節）。片方だけが余分を出すと、配る腕を揃えた
      // のと同じ理由で、どの島に流れ着いたかが歩留まりに化ける。卓は`pick`の重みとして書くので、
      // 出す物の一覧には現れず、上の検査では捕まらない。
      expect(
        new Set(
          group.map((interaction) =>
            interaction.agentReads.filter((name) => name.endsWith(THRIFT_SUFFIX)).join(','),
          ),
        ).size,
        `${where} で、余分の卓が食い違う`,
      ).toBe(1);
    }
  });

  it('伸ばす操作をまだ持たない腕は、開ける物も操作の置き場も世界に無いものだけ', () => {
    // 宣言だけあって動かない本があること自体は、Skills.md 2節の一覧を先に置いているため。
    // どれが動かないかをここで並べておき、伸ばす操作が入ったときに直し忘れないようにする。
    //
    // **料理はここに居ない。** 開けるレシピはまだ無いが、伸ばす操作（foods.yamlのchop）が先に
    // 入った——この2つは別の軸で、伸ばす操作が在れば手際の積む先も在る（Skills.md 7節）。
    const gains = declaredSkillGains();

    expect(SKILLS.filter((name) => !gains.has(name))).toEqual([
      'skill_joinery',
      'skill_building',
      'skill_smelting',
    ]);
  });

  it('入口が1本しか無い腕は、1本と決めた分だけ', () => {
    // SkillSystem.md 3.2.1節。**一つ上が数えるのは0本の腕**だが、1本の腕も素通りしてよいわけでは
    // ない——3.2節の「最低1つ」は立ち上がりの条件で、足りているかの条件ではなく、**1本しか無い腕では
    // 段へ届くまでその1手を繰り返すことになる。**
    //
    // 決めた覚えの無い腕がここへ落ちてくるのを止める——**新しい腕も、入口が減った腕も、口を足すか、
    // 数え上げへ足すかを選ぶことになる。** 1本でよいかは内容の判断（拠り所はdocs/world/Skills.mdが
    // 腕ごとに持つ）で、見るのは決めずに素通りできないことだけ。
    const entries = entriesBySkill();

    expect(SKILLS.filter((name) => entries.get(name)?.length === 1).sort()).toEqual(SKILLS_WITH_ONE_ENTRY);
  });

  it('入口が1本と決めた腕は、その理由がその入口のコメントに書いてある', () => {
    // 一つ上の数え上げは、**足せば黙って通せる**——理由を書かせるのはここ。SkillSystem.md 3.2.1節が
    // 「1本と決めたら、その理由をその入口のコメントへ書きます」と言っている以上、それが破れたときに
    // 落ちるものが要る（書いてあるかを見るだけで、中身の当否は人が読む）。
    //
    // **語を2つとも求める**——どちらか1つなら、本数と関わりのない文でも当たってしまう。
    const entries = entriesBySkill();

    expect(
      SKILLS_WITH_ONE_ENTRY.filter((name) => {
        const comment = entries.get(name)?.[0]?.comment ?? '';
        return !comment.includes('入口') || !comment.includes('1本');
      }),
      '入口が1本である理由が書いていない腕',
    ).toEqual([]);
  });

  it('伸ばす操作を持つ腕は、どれも効き先を持つ', () => {
    // 一つ上の数え上げと逆向き。**伸ばす操作を持つ腕は段が動く**が、効き先が無ければ、動いても
    // 何も起きないバーが画面に並ぶ（docs/ui/StatusArea.md 9節）。伸ばす操作を先に入れて効き先を
    // 後から入れる順で世界が育つので、その間が空いたままにならないよう、ここで塞ぐ。
    //
    // 効き先は2通りある（Skills.md 2節）。**腕そのものが読まれる**（レシピの解放条件・操作の
    // 条件）か、**段が押し上げる上乗せが読まれる**（アクセス系は同5節、製作系は同7節）か。
    // アクセス系はレシピを開けないので前者には現れず、製作系は解放も速さも歩留まりも持つ。
    //
    // **数えるのは、読まれている上乗せだけ**——宣言しただけで誰も読まないものを数えると、
    // 「動いても何も起きない」をそのまま通してしまう。
    const gains = declaredSkillGains();
    const read = propsReadFromAgent();
    const effective = new Set<string>([
      ...[...read].filter((name) => name.startsWith(SKILL_PREFIX)),
      ...[...ACCESS_BONUSES, ...CRAFTING_BONUSES]
        .filter((entry) => read.has(entry.bonus))
        .map((entry) => entry.skill),
      ...skillsShorteningTime(),
    ]);

    expect(SKILLS.filter((name) => gains.has(name) && !effective.has(name))).toEqual([]);
  });

  it('製作系は、解放だけでなく速さにも効いている', () => {
    // 一つ上は「効き先が1つでもあるか」なので、**製作系は解放条件に名前が出るだけで通ってしまう**
    // ——そこを通すと、解放しか効かない腕（Skills.md 6節が【確定】で否定した形）へ黙って戻れる。
    // 速さへ効いていることは、ここだけが見ている。
    //
    // **速さの宣言は行動の側に散っている**（同7節）ので、腕の側を見ても分からない——集めるのは
    // レシピの`deftness`と手作業の所要時間の`passives`の両方から。
    const gains = declaredSkillGains();
    const shortening = skillsShorteningTime();

    expect(
      CRAFTING_SKILLS.filter((skill) => gains.has(skill) && !shortening.has(skill)),
      '伸ばせるのに、どの行動も速くしない腕',
    ).toEqual([]);
  });
});
