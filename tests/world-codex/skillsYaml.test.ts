import { readFileSync } from 'node:fs';
import type { YAMLMap } from 'yaml';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { characterDefNames } from '../../src/domain/generation/NewGame';
import { generateIsland } from '../../src/domain/generation/TerrainGenerator';
import { Combination } from '../../src/domain/Interaction';
import type { ObjectDef } from '../../src/domain/ObjectDef';
import type { RecipeDef, RecipeStepDef } from '../../src/domain/RecipeDef';
import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { WorldObject } from '../../src/domain/WorldObject';
import { WorldSession } from '../../src/domain/WorldSession';
import { materialsSlotOf, spawnInProgressObject, tryAdvanceCrafting } from '../../src/domain/crafting';
import { World } from '../../src/domain/wrappers/World';
import { inProgressObjectName } from '../../src/loader/inProgressObjects';
import { bundledCodex, worldCodexYamlPaths } from '../support/worldCodexFiles';
import { createBrightEnoughAgent } from '../support/illumination';
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

/**
 * アクセス系の腕（Skills.md 2節）。素材・機会へのアクセスを広げるだけで、レシピは開けない（同5節）。
 *
 * **製作系の余りとして置く。** 系統はデータのどこにも書かれておらず、分かれ目は文書の表だけが持つので、
 * **どちらかへ名乗らせないと、腕を1本足したときに「製作系ではない」へ黙って倒れる**——その腕は
 * 「伸ばせるのに、どの行動も速くしない腕」の射程から外れたまま緑で通る。両方を合わせて`SKILLS`に
 * なることは下の「系統の表は、腕を1本残らず、どちらか一方へ振り分けている」が見る。
 */
const ACCESS_SKILLS = ['skill_firecraft', 'skill_hunting', 'skill_smelting'] as const;

/** どの腕にも共通の段（SkillSystem.md 6節の目安そのままの4段・比3）。 */
const STAGES = [
  { name: 'novice', min: 0 },
  { name: 'basic', min: 20 },
  { name: 'skilled', min: 60 },
  { name: 'expert', min: 180 },
] as const;

/**
 * 腕が伸びる経路（SkillSystem.md 3節の表）。**書かれている場所で決まる**——操作の直下の `add` が実行、
 * `pick` の候補に埋めた `add` が発見（同3.3節）。**経路はこの2つで全部**——練習は経路ではなく、その腕の
 * 初歩の行動がそれを兼ねる（同3.1節【確定】。打ちかかる腕なら hunting_practice.yaml の的）。
 */
type SkillRoute = 'execution' | 'discovery';

/**
 * 発見が1回で配る量（SkillSystem.md 3.3節）。**こちらは長さに依らず一律**——契機は候補を
 * 引き当てたことそのもので、`explore` にかけた時間ではない（同3.3節）。
 */
const DISCOVERY_GAIN = 1;

/**
 * 実行が1回で配る量の刻み（SkillSystem.md 3節）。**この分数につき1**を、端数は切り上げて
 * 配る——一律にすると、同じ量が15分の手にも1時間の手にも届く。
 */
const MINUTES_PER_GAIN = 30;

/**
 * 上の刻みが保つ、腕が時間あたりに伸びる速さの幅（SkillSystem.md 3節）。整数で配るので端数は切り上がり、
 * ちょうど刻みどおりの操作で`min`、短い操作ほど`max`へ寄る。**`max`に当たるのが15分**で、それより短い
 * 操作へ配ると跳ねる。
 *
 * **縮みきった後も同じ幅**。腕で縮む分は行動の側が宣言し（docs/world/Skills.md 7節）、縮めるのは分の
 * 絶対値なので短い作業ほど比では大きく縮むが、**所要時間が15分の格子に乗っていて縮む量もその1目盛り**
 * （docs/engine/ActionSystem.md 6.2節）なので、30分が15分になっても`max`にちょうど届くだけで済む。
 * **1目盛りより深く縮める宣言を置くと、そこが幅から出る。**
 *
 * **素の分数の側は、単独では破れない**——量が`ceil(分/30)`で、所要時間が15分の格子に乗っている限り、
 * 時間あたりは必ず2〜4に収まる。**受け止めるのは縮んだ側**で、素の側が受け持つのは、量の規則か格子の
 * どちらかが緩んだときになる。**守りたいのは幅そのもの**で、その2つは書き方でしかないので残す。
 */
const GAIN_PER_HOUR = { min: 2, max: 4 } as const;

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
 * そのレシピのコメントに書いてある（docs/world/Skills.md 7.1節。**コメントが名乗らないことに
 * 触れているところまで**を下の検査が見張る）。
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
  'unfired_jar_lid.pressed',
];

/**
 * 入口（実行経路で腕を配る口、SkillSystem.md 3節）が1本だけの腕。**1本でよいと決めた分だけ**が
 * 並ぶ——理由は1本ずつ、その入口のコメントに書いてある（同3.2.1節。**コメントが本数に触れている
 * ところまで**を下の検査が見張る）。
 *
 * **口は手作業だけではない**——手際を名乗るレシピの工程も伸ばす（同3.4節）ので、そちらを持つ腕は
 * ここに並ばない。残っているのは、名乗るレシピを1つも持たない腕だけ：火はアクセス系なので名乗れず
 * （docs/world/Skills.md 2.2節）、料理は開けるレシピも名乗るレシピもまだ無い（同2.5節）。
 * どちらであるかは内容の判断なので、ここが見るのは決めずに素通りできないことだけ。
 */
const SKILLS_WITH_ONE_ENTRY = ['skill_cooking', 'skill_firecraft'];

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
 * 土台も、卓の枝の重み（GameElementDefinition.md 10節）も、この1本で拾える——**どこで読まれて
 * いるかではなく、読まれているかだけを問う。**
 */
function propsReadFromAgent(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const path of worldCodexYamlPaths())
    agentReadsUnder(parseDocument(readFileSync(path, 'utf8')).contents, found);
  return found;
}

/**
 * 型の名前 → それを宣言しているファイルの名前。**獣から出る物はどれも `animals.yaml` が宣言する**
 * （同ファイルの前書き——死体と、解体して得られる素材もそこが持つ）ので、材料の連鎖に獣が混じって
 * いるかは、この対応で見られる。
 */
function definingFileOf(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();

  for (const path of worldCodexYamlPaths()) {
    const root = parseDocument(readFileSync(path, 'utf8')).contents;
    if (!isMap(root)) continue;
    const file = path.slice(path.lastIndexOf('/') + 1);

    for (const section of root.items) {
      if ((isScalar(section.key) ? String(section.key.value) : '') !== 'object_defs') continue;
      if (!isMap(section.value)) continue;
      for (const entry of section.value.items)
        if (isScalar(entry.key)) found.set(String(entry.key.value), file);
    }
  }
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
 * ときに土地のプロパティへ書き込まれる（`IslandSpawner`、docs/engine/TerrainGeneration.md 3.6節）。
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
  /**
   * その操作が`agent`の腕前へ配っている量を、経路ごと（SkillSystem.md 3節の表）に。**`pick`の候補へ
   * 埋めたもの（発見）も数える**ので、上の`skills`（操作の直下だけ）とは件数が揃わないことがある。
   */
  readonly gains: readonly { readonly amount: number; readonly route: SkillRoute }[];
  /** 相手へ重ねて始まる操作か（`trigger`が`drag`）。 */
  readonly needsInstrument: boolean;
  /** `duration` が読んでいるプロパティの名前。リテラルの分数で書いていればundefined。 */
  readonly durationProp: string | undefined;
  /** `duration` にリテラルで書いた分数。プロパティを読んでいればundefined。 */
  readonly durationLiteral: number | undefined;
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
        const gains: { amount: number; route: SkillRoute }[] = [];
        walkAgentSkillGains(body, (_skillName, amount, route) => gains.push({ amount, route }));

        found.push({
          owner,
          name: isScalar(entry.key) ? String(entry.key.value) : '',
          products: [...products].sort(),
          skills: skills.sort(),
          gains,
          needsInstrument: isMap(trigger) && trigger.get('drag', true) !== undefined,
          durationProp: isScalar(durationProp) ? String(durationProp.value) : undefined,
          durationLiteral: isScalar(duration) ? Number(duration.value) : undefined,
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
 * 世界じゅうの余分の卓の「当たり」の枝。**在り処では探さない**——卓はどの操作の下にも入れ子にできる
 * ので、**重みが無駄の無さを読んでいること**だけで拾う。名指しで数え上げると、次に足された卓が
 * 素通りする。**無駄の無さと見分けるのは名前の尻尾**（`<腕>_thrift`、docs/world/Skills.md 7節の表）
 * なので、別の名前で置かれた上乗せは拾えない。
 *
 * 素の産出は、その卓と同じ節の `spawn`。
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
      if (key === 'pick' && isSeq(pair.value)) {
        const baseCounts = spawnCountsOf(node.get('spawn', true));
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
              baseCount: baseCounts.get(object),
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
 * 腕ごとの入口——実行経路でその腕を配る口（SkillSystem.md 3節）を、腕の名前で引けるようにしたもの。
 * **手作業とレシピの両方が並ぶ**（レシピの工程も実行経路、同3.4節）。
 *
 * **レシピの名乗りはロードしないと読めない**ので、`<完成品>.<レシピ>` と腕の組を呼び手が渡す。
 * コメントはどちらも構文木から引く（手作業は操作の直上、レシピは`commentsAboveRecipes`）。
 *
 * **発見の契機は入らない。** `declaredInteractions`が数える`skills`は操作の直下の`add`だけで、`pick`の
 * 候補に埋めたものは拾わない（同3.3節）——**時間を投じて繰り返せる手はこちらだけ**で、探索の契機は
 * 何に出くわしたかが決めるので、投じ先として選べない。
 */
function entriesBySkill(
  namedRecipes: readonly { where: string; skill: string }[],
): ReadonlyMap<string, readonly { where: string; comment: string }[]> {
  const bySkill = new Map<string, { where: string; comment: string }[]>();
  const push = (skill: string, entry: { where: string; comment: string }): void => {
    const entries = bySkill.get(skill) ?? [];
    bySkill.set(skill, entries);
    entries.push(entry);
  };

  for (const interaction of declaredInteractions())
    for (const skill of interaction.skills)
      push(skill, { where: interaction.name, comment: interaction.comment });

  const comments = commentsAboveRecipes();
  for (const { where, skill } of namedRecipes) push(skill, { where, comment: comments.get(where) ?? '' });

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
   * 手際を名乗っているレシピ——`<完成品>.<レシピ>` と、名乗った腕の名前。**名乗りは速さと伸びの
   * 両方を決める**（SkillSystem.md 3.4節）ので、入口を数える側も量を見る側もこの1本から引く。
   */
  function namedRecipes(): readonly { where: string; skill: string; product: string; recipe: RecipeDef }[] {
    return allRecipes()
      .filter(({ recipe }) => recipe.deftness !== undefined)
      .map(({ product, recipe }) => ({
        where: `${product}.${recipe.name}`,
        skill: codex.propertyNames.getName(recipe.deftness!.skillGlobalId),
        product,
        recipe,
      }));
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
    // **選べるキャラクタは数え上げる**（characterDefNames）——手で並べると、本を1冊足しても
    // ここは元の顔ぶれだけを見て通り、その本だけが腕の検査の外へ出る。
    const skillTagId = codex.propertyTagNames.getId('skill');
    const names = characterDefNames(codex);

    expect(names.length, '選べるキャラクタが1人も居なければ、この見張りは何も見ていない').toBeGreaterThan(0);
    for (const name of names) {
      const character = characterWithSkills(0, name);
      expect(
        character.propertiesWithTag(skillTagId).map((property) => property.def.name),
        `${name} の腕前`,
      ).toEqual([...SKILLS]);
    }
  });

  it('系統の表は、腕を1本残らず、どちらか一方へ振り分けている', () => {
    // 系統（Skills.md 2節）はデータのどこにも書かれていないので、CRAFTING_SKILLS・ACCESS_SKILLSは
    // 手で持つしかない。**どちらにも載らない腕が出ないこと**だけを、腕の一覧と突き合わせて見る
    // ——載らないまま残った腕は、製作系だけを見る検査（速さへ効いているか）を素通りする。
    expect([...CRAFTING_SKILLS, ...ACCESS_SKILLS].sort()).toEqual([...SKILLS].sort());
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

  /** 獣から出る物を宣言しているファイル（definingFileOf の注記）。 */
  const BEAST_FILE = 'animals.yaml';

  /** 狩猟の腕を配る操作の名前。**獣の側は trait が、的は型自身が宣言する**ので、名前で引く。 */
  function huntingInteractionNames(): ReadonlySet<string> {
    return new Set(
      declaredInteractions()
        .filter((interaction) => interaction.skills.includes('skill_hunting'))
        .map((interaction) => interaction.name),
    );
  }

  /**
   * 武器を重ねて打ちかかれて、狩猟の腕を配る相手（docs/engine/HuntingSystem.md 1.2節のドラッグ型の
   * 操作）。獣も的もここに並ぶ——**どちらも同じ操作**なので、分かれるのは作れるかどうかだけ。
   */
  function strikeTargets(): readonly ObjectDef[] {
    const granting = huntingInteractionNames();
    const weaponTagId = codex.tagNames.getId('weapon');
    const weapons = [...codex.objects].filter((def) => def.tags.includes(weaponTagId));

    return [...codex.objects].filter(
      (def) =>
        codex.baseOf(def) === def &&
        def.dragTriggers.some(
          (trigger) =>
            granting.has(trigger.interaction.name) &&
            weapons.some((weapon) => trigger.acceptsInstrument(weapon)),
        ),
    );
  }

  /**
   * その型が、獣から出る物を1つも通さずに手に入るか。**通るかどうかを見るのは材料の連鎖の全部**で、
   * レシピを持たない物（拾う・採るで手に入る先端）まで降りる。
   *
   * **タグで要求している材料は、受ける型のどれか1つが獣を要さなければ通る**——どれを使うかは
   * プレイヤーが選ぶので、獣由来の型が候補に混じっていること自体は「獣を要する」ではない。
   */
  function obtainableWithoutBeast(
    def: ObjectDef,
    files: ReadonlyMap<string, string>,
    visiting: ReadonlySet<string> = new Set(),
  ): boolean {
    if (files.get(def.name) === BEAST_FILE) return false;
    // 材料が巡っている枝は辿れない側として閉じる（辿れる枝が別に在れば、そちらが通す）。
    if (visiting.has(def.name)) return false;

    const recipes = def.recipesProducingThis;
    if (recipes.length === 0) return true;
    const deeper = new Set(visiting).add(def.name);

    return recipes.some((recipe) =>
      recipe.steps.every((step) =>
        step.requirements.every((requirement) =>
          [...codex.objects].some(
            (candidate) =>
              !codex.isGenerated(candidate) &&
              requirement.requires(candidate) &&
              obtainableWithoutBeast(candidate, files, deeper),
          ),
        ),
      ),
    );
  }

  it('打ちかかれる相手には、獣を1つも要さずに作れるものが在る', () => {
    // docs/engine/SkillSystem.md 3.1節【確定】が置く的。**狩猟の段は「出くわす重み」と「当てる重み」の
    // 両方へ積まれる**（docs/world/Skills.md 5節）ので、打ちかかる相手が生きた獣しか居ないと、腕が
    // 低いほど出くわさず、当たらず、そのぶん伸びない——この腕だけが自分で自分を塞ぐ。**作れる相手が
    // 1つ在ればそこが切れる**ので、消えればここが落ちる。
    //
    // **材料の連鎖まで見る。** 獣から出る物を通る的は「狩らないと狩りの練習ができない」へ戻るので、
    // 作れることだけでは足りない。
    const files = definingFileOf();
    const craftable = strikeTargets().filter((def) => def.recipesProducingThis.length > 0);

    expect(
      craftable.filter((def) => obtainableWithoutBeast(def, files)).map((def) => def.name),
      '獣を1つも要さずに作れる相手が無い',
    ).not.toEqual([]);
  });

  it('作れる相手へ武器を重ねると、狩猟の腕が実行経路のぶん伸びる', () => {
    // 一つ上は宣言の形しか見ないので、**重ねられるのに腕を配らない**相手でも通る（`trigger`と`add`は
    // 別の宣言なので、配る役を`agent`から動かしても形は整って見える）。実際に重ねて引き比べる。
    const granting = huntingInteractionNames();
    const weaponTagId = codex.tagNames.getId('weapon');
    const weapons = [...codex.objects].filter((def) => def.tags.includes(weaponTagId));
    const targets = strikeTargets().filter((def) => def.recipesProducingThis.length > 0);

    expect(targets.length, '作れる相手が1つも無い').toBeGreaterThan(0);

    for (const def of targets) {
      const trigger = def.dragTriggers.find(
        (candidate) =>
          granting.has(candidate.interaction.name) &&
          weapons.some((weapon) => candidate.acceptsInstrument(weapon)),
      )!;
      const weaponDef = weapons.find((weapon) => trigger.acceptsInstrument(weapon))!;
      const agent = characterWithSkills(STAGES[0].min);
      const session = agent.session;
      const target = session.createObject(def.globalId);
      const strike = target
        .combinationsWith(session.createObject(weaponDef.globalId), agent)
        .find((combination) => combination.name === trigger.interaction.name);

      expect(strike, `${def.name}: ${weaponDef.name} を重ねて打ちかかれない`).toBeDefined();
      // **伸びる量は、その手の長さから決まる**（SkillSystem.md 3節）ので、期待値もそこから引く
      // ——素人の分数は宣言どおり（下の「腕を上げると…短くなる」が見ている）。
      const expected = Math.ceil(strike!.executionMinutes() / MINUTES_PER_GAIN);
      expect(strike!.tryExecute(), `${def.name}: 打ちかかりが成立しない`).toBe(true);
      expect(
        agent.getProperty(codex.propertyNames.getId('skill_hunting')).getEffectiveValue(),
        `${def.name}: 1回の打ちかかりで伸びる量`,
      ).toBe(expected);
    }
  });

  it('打ちかかる相手は、どれも同じ長さの手で打つ（据えた的も、生きた獣も）', () => {
    // docs/world/Skills.md 5節が「的でも伸びる量は獣を殴るのと同じ」と言えるのは、**どちらも同じ
    // 長さの手だから**——量はその手の長さから決まる（SkillSystem.md 3節）ので、長さが割れた時点で
    // 量も割れ、5節がそこで嘘になる。
    const granting = huntingInteractionNames();
    const weaponTagId = codex.tagNames.getId('weapon');
    const weapons = [...codex.objects].filter((def) => def.tags.includes(weaponTagId));
    const targets = strikeTargets();

    // **両方が並んでいないと、長さが揃っていることを見たことにならない。** 片側が消えれば残った側
    // だけで揃ってしまう。
    expect(
      targets.filter((def) => def.recipesProducingThis.length > 0).length,
      '据えた的が1つも無い',
    ).toBeGreaterThan(0);
    expect(
      targets.filter((def) => def.recipesProducingThis.length === 0).length,
      '生きた獣が1つも無い',
    ).toBeGreaterThan(0);

    const minutes = targets.map((def) => {
      const trigger = def.dragTriggers.find(
        (candidate) =>
          granting.has(candidate.interaction.name) &&
          weapons.some((weapon) => candidate.acceptsInstrument(weapon)),
      )!;
      const weaponDef = weapons.find((weapon) => trigger.acceptsInstrument(weapon))!;
      const agent = characterWithSkills(STAGES[0].min);
      const session = agent.session;
      const strike = session
        .createObject(def.globalId)
        .combinationsWith(session.createObject(weaponDef.globalId), agent)
        .find((combination) => combination.name === trigger.interaction.name);

      expect(strike, `${def.name}: ${weaponDef.name} を重ねて打ちかかれない`).toBeDefined();

      return { name: def.name, minutes: strike!.executionMinutes() };
    });

    expect(
      [...new Set(minutes.map((entry) => entry.minutes))],
      `打ちかかる手の長さが割れている: ${minutes.map((entry) => `${entry.name}=${entry.minutes}`).join('・')}`,
    ).toHaveLength(1);
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

  it('手際を名乗らないと決めたレシピのコメントが、名乗らないことに触れている', () => {
    // 一つ上の数え上げは、**足せば黙って通せる**——コメントを書かせるのはここ。Skills.md 7.1節が
    // 「名乗らないと決めた側は、そのレシピのコメントに理由を書きます」と言っている以上、それが
    // 破れたときに落ちるものが要る。
    //
    // **見ているのは語の含有で、理由が書いてあるかではない。** 「手際」と「名乗らない」を並べれば
    // 通るので、**落ちるのはコメントごと忘れたときだけ**——理由として読めるかは人が読む。
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

  it('レシピが名乗る手際は、レシピの外にも伸ばす口を持つ腕のもの', () => {
    // **名乗りがその腕の唯一の口にならない**（docs/world/Skills.md 7.1節）。名乗ったレシピの工程は
    // その腕を伸ばすが（SkillSystem.md 3.4節）、**解放を要求した瞬間に自分で自分を塞ぐ**ので、
    // 立ち上がりは宣言の側（手作業か発見）が担っていなければならない（同3.2節）。腕は宣言だけ先に
    // 置かれるため、名乗る側が先走れてしまう。
    //
    // **アクセス系はここでは落ちない**——火も狩猟も手作業の口を持つので、名乗ってしまえば通る。
    // 名乗らないと決めているのは内容の側（docs/world/Skills.md 7.1節）で、そちらは人が読む。
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
   * そのレシピの作りかけを1つ据えた世界と、明るさに引っかからない作り手。
   *
   * **時間を進めるのでWorldを持つセッションが要る**（工程は分数を消費する）。据える土地は何でもよく、
   * 見ているのは作り手の腕前だけなので、土地の側の条件は関わらない。
   */
  function startCrafting(
    product: string,
    recipe: RecipeDef,
  ): { session: WorldSession; inProgress: WorldObject; maker: WorldObject } {
    const session = new WorldSession(codex);
    const worldInstance = session.createObject(codex.objectNames.getId('world'));
    session.adoptWorld(new World(worldInstance));

    const field = session.createObject(codex.objectNames.getId('rocky_field'));
    expect(
      field.moveToSlotOrRejection(worldInstance.getSlot(codex.slotNames.getId('locations'))),
      `'${product}.${recipe.name}': 土地を世界へ置けない`,
    ).toBeUndefined();

    return {
      session,
      inProgress: spawnInProgressObject(
        field,
        codex.objectNames.getId(inProgressObjectName(product, recipe.name)),
      ),
      maker: createBrightEnoughAgent(session),
    };
  }

  /**
   * その工程が要求する物を、作りかけの材料枠へ足りないぶんだけ入れる。
   *
   * **足りないぶんだけ**——道具（`consume: false`）は前の工程から残るので、毎回入れ直すと枠が溢れる。
   * どの型を入れるかは、要求に当てはまる素の型を名前順で1つ選ぶ（**当てはまればどれでもよい**
   * ——見ているのは腕前で、成果物の中身ではない）。
   */
  function supplyStep(inProgress: WorldObject, session: WorldSession, step: RecipeStepDef): void {
    const slot = materialsSlotOf(inProgress);
    expect(slot, '作りかけが材料枠を持たない').toBeDefined();

    for (const requirement of step.requirements) {
      const candidate = [...codex.objects]
        .filter((def) => requirement.requires(def) && codex.baseOf(def) === def)
        .map((def) => def.name)
        .sort()[0];
      expect(candidate, '要求に当てはまる型が世界に無い').toBeDefined();

      const already = slot!.contents.filter((item) => requirement.requires(item.def)).length;
      for (let n = already; n < requirement.count; n += 1)
        expect(
          session.createObject(codex.objectNames.getId(candidate)).moveToSlotOrRejection(slot!),
          `'${candidate}' を材料枠へ入れられない`,
        ).toBeUndefined();
    }
  }

  it('レシピの工程を進めると、名乗った腕だけが、その工程の長さぶん伸びる', () => {
    // SkillSystem.md 3.4節。**レシピの工程も実行経路**で、配る腕を決めるのは`deftness`の名乗り1本。
    //
    // **宣言を読むだけでは見えない。** 工程には`add`を書ける場所が無く、配っているのはengine
    // （crafting.tryAdvanceCrafting）なので、**実際に工程を回して腕前を引き比べる**しかない。
    //
    // **量は規則の側から組み直す**（MINUTES_PER_GAINで割って切り上げ）——engineの定数を引いてくると
    // 同じ式を2度書くだけになり、規則から外れても緑のままになる。
    //
    // **名乗っていない腕が動かないことも同じ回で見る**——名乗りとは別の腕へ配る実装は、伸びる側だけを
    // 見ていると素通りする。
    const named = namedRecipes();
    expect(named.length, '手際を名乗るレシピが1つも無い').toBeGreaterThan(0);

    for (const { where, skill, product, recipe } of named) {
      const { session, inProgress, maker } = startCrafting(product, recipe);
      // **熟達させてから回す**——素人の段でも名乗りは読まれるが（RecipeDef.minutesFor）、実際に縮む枝は
      // 通らない。腕が効いている側で見ておかないと、縮める枝の隣へ置かれた配り方を素通りする。
      const start = STAGES.at(-1)!.min;
      for (const id of skillIds) maker.getProperty(id).setNumberWithoutEvents(start);
      const namedSkillId = codex.propertyNames.getId(skill);
      let expected = start;

      for (const [index, step] of recipe.steps.entries()) {
        supplyStep(inProgress, session, step);
        expect(tryAdvanceCrafting(inProgress, maker), `'${where}' の工程${index + 1}が進まない`).toBe(true);
        expected += Math.ceil(step.durationMinutes / MINUTES_PER_GAIN);
        expect(
          maker.getProperty(namedSkillId).number,
          `'${where}' の工程${index + 1}（${step.durationMinutes}分）を終えた後の ${skill}`,
        ).toBe(expected);
      }

      for (const [index, id] of skillIds.entries())
        if (SKILLS[index] !== skill)
          expect(maker.getProperty(id).number, `'${where}' を作ったら ${SKILLS[index]} が動いた`).toBe(start);
    }
  });

  it('手際を名乗らないレシピは、どの腕も伸ばさない', () => {
    // 一つ上と対。**名乗らないことが「どの腕の仕事でもない」と決めた印**（docs/world/Skills.md 7.1節）
    // なので、名乗りを見ずに配る実装——工程の長さだけから適当な腕へ配るような——をここで止める。
    const unnamed = allRecipes().filter(({ recipe }) => recipe.deftness === undefined);
    expect(unnamed.length, '手際を名乗らないレシピが1つも無い').toBeGreaterThan(0);

    for (const { product, recipe } of unnamed) {
      const { session, inProgress, maker } = startCrafting(product, recipe);
      const start = STAGES.at(-1)!.min;
      for (const id of skillIds) maker.getProperty(id).setNumberWithoutEvents(start);

      for (const [index, step] of recipe.steps.entries()) {
        supplyStep(inProgress, session, step);
        expect(
          tryAdvanceCrafting(inProgress, maker),
          `'${product}.${recipe.name}' の工程${index + 1}が進まない`,
        ).toBe(true);
      }

      for (const [index, id] of skillIds.entries())
        expect(
          maker.getProperty(id).number,
          `'${product}.${recipe.name}' を作ったら ${SKILLS[index]} が動いた`,
        ).toBe(start);
    }
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

  /**
   * 実行経路で腕前へ配っている操作と、その量。**発見は外す**——長さから決まるのは実行だけで
   * （SkillSystem.md 3.3節）、発見の量は下の「発見が配る量」が別に見る。
   */
  function executionGains(): readonly { interaction: InteractionGains; amounts: readonly number[] }[] {
    return declaredInteractions()
      .map((interaction) => ({
        interaction,
        amounts: interaction.gains.filter((gain) => gain.route === 'execution').map((gain) => gain.amount),
      }))
      .filter(({ amounts }) => amounts.length > 0);
  }

  /**
   * 腕をすべて最上段まで上げた人が、その操作にかける分数。**リテラルで書いた長さは腕で動かない**
   * ので素の値のまま返す（`handworkMinutes`は型を1つ作るので、traitが持つ操作では引けない）。
   */
  function shortestMinutes(interaction: InteractionGains, declared: number): number {
    return interaction.durationLiteral !== undefined
      ? declared
      : handworkMinutes(interaction, STAGES.at(-1)!.min);
  }

  /**
   * その操作が宣言している素の分数（読めなければundefined）。**腕で縮む前の値**で、規則
   * （SkillSystem.md 3節）が量を決める土台はこちら。縮んだ側は`shortestMinutes`で別に見る
   * （GAIN_PER_HOURの注記）。
   */
  function declaredMinutes(
    interaction: InteractionGains,
    props: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  ): number | undefined {
    if (interaction.durationLiteral !== undefined) return interaction.durationLiteral;
    const body = durationPropBody(interaction, props);
    return body === undefined ? undefined : declaredValueOf(body);
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
    // レシピの`deftness`と違い、手作業は効く腕を名乗らない（配る腕がそのまま効く腕、
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

  it('実行が配る量は、その操作の長さから決まる（30分につき1、端数は切り上げ）', () => {
    // SkillSystem.md 3節。**一律にすると、同じ量が15分の手にも1時間の手にも届く**ので、短い手を
    // 繰り返すのが最も速い伸ばし方になり、繰り返しの稼ぎを抑える時間のコスト（同7節）が
    // そこだけ効かない。長さから決めれば、抑止はどの手にも同じだけ掛かる。
    //
    // **発見はここには来ない**——契機は候補を引き当てたことそのもので、`explore` にかけた時間では
    // ないので、長さでは決まらない（同3.3節。量を見るのは下の「発見が配る量」）。
    //
    // **見るのは宣言した素の分数**（declaredMinutes）。
    const props = declaredPropsByDef();
    let checked = 0;

    for (const { interaction, amounts } of executionGains()) {
      const where = `${interaction.owner} の ${interaction.name}`;
      const minutes = declaredMinutes(interaction, props);
      expect(minutes, `${where}: 所要時間が読めない`).toBeDefined();
      const expected = Math.ceil(minutes! / MINUTES_PER_GAIN);
      for (const amount of amounts) {
        checked += 1;
        expect(amount, `${where}（${minutes}分）が配る量`).toBe(expected);
      }
    }

    expect(checked, '実行で腕を配る操作が1つも無い').toBeGreaterThan(0);
  });

  it('実行で腕が時間あたりに伸びる速さは、どの口でも同じ幅に収まる', () => {
    // 一つ上は**長さとの対応しか見ない**ので、`ceil`が丸め上げるぶんは素通りする——1分の操作へ
    // 1を配れば規則どおりだが、時間あたりは60になる。**守りたいのは速さのほう**（SkillSystem.md
    // 3節）なので、そこはここで留める。**操作を数え上げない**ので、次に足された操作も同じ幅を
    // 要求される。
    //
    // **縮みきった側も見る**——腕で縮む分は行動の側が宣言する（docs/world/Skills.md 7節）ので、
    // 素の分数だけを見ていると、深く縮める宣言を置いた操作だけが腕を上げた後で跳ねるのを見逃す
    // （GAIN_PER_HOURの注記）。**縮んだ分数は実際に引く**——宣言の足し算をここで書き直すと、
    // 引き方が2つになる。
    const props = declaredPropsByDef();

    for (const { interaction, amounts } of executionGains()) {
      const minutes = declaredMinutes(interaction, props);
      const shortest = shortestMinutes(interaction, minutes!);
      for (const amount of amounts) {
        const where = `${interaction.owner} の ${interaction.name}（${minutes}分に${amount}）`;
        const perHour = (amount * 60) / minutes!;
        expect(perHour, `${where}: 時間あたりが速すぎる`).toBeLessThanOrEqual(GAIN_PER_HOUR.max);
        expect(perHour, `${where}: 時間あたりが遅すぎる`).toBeGreaterThanOrEqual(GAIN_PER_HOUR.min);
        expect(
          (amount * 60) / shortest,
          `${where}: 腕で${shortest}分まで縮んだとき、時間あたりが速すぎる`,
        ).toBeLessThanOrEqual(GAIN_PER_HOUR.max);
      }
    }

    // **レシピの工程も同じ幅に入る**（SkillSystem.md 3.4節）。**手作業と違って配らない選択肢が無い**
    // ので、刻み1つより短い工程を名乗るレシピへ置くと、ここでだけ止まる。
    const expert = characterWithSkills(STAGES.at(-1)!.min);
    for (const { where, recipe } of namedRecipes())
      for (const [index, step] of recipe.steps.entries()) {
        const minutes = step.durationMinutes;
        const amount = Math.ceil(minutes / MINUTES_PER_GAIN);
        const at = `${where} の工程${index + 1}（${minutes}分に${amount}）`;
        expect((amount * 60) / minutes, `${at}: 時間あたりが速すぎる`).toBeLessThanOrEqual(GAIN_PER_HOUR.max);
        expect((amount * 60) / minutes, `${at}: 時間あたりが遅すぎる`).toBeGreaterThanOrEqual(
          GAIN_PER_HOUR.min,
        );
        const shortest = recipe.minutesFor(step, expert);
        expect(
          (amount * 60) / shortest,
          `${at}: 腕で${shortest}分まで縮んだとき、時間あたりが速すぎる`,
        ).toBeLessThanOrEqual(GAIN_PER_HOUR.max);
      }
  });

  it('腕を配る `add` は、長さを持つ操作の中にしかない', () => {
    // 上2つは`interactions`の中しか見ないので、**外へ出た`add`は幅の外側で伸ばせる**——`passives`へ
    // 置けばtick毎に配れてしまい、3節が「tickごとの自然増加は持たせない」と言っているものになる。
    // 件数で突き合わせるのは、外に在るものを名指しで数えると数え上げになるため。
    let total = 0;
    for (const path of worldCodexYamlPaths())
      walkAgentSkillGains(parseDocument(readFileSync(path, 'utf8')).contents, () => {
        total += 1;
      });

    expect(
      declaredInteractions().reduce((sum, interaction) => sum + interaction.gains.length, 0),
      '操作の外で腕前へ配っている `add` がある',
    ).toBe(total);
  });

  it('発見が配る量は、どこでも一律（長さでも土地でも変えない）', () => {
    // SkillSystem.md 3.3節。**実行と違って長さから決めない**——契機は候補を引き当てた
    // ことそのもので、`explore` にかけた時間ではない（同3.3節）。土地ごとに変えると、どの島に
    // 流れ着いたかが腕の伸びに化ける。
    let checked = 0;

    for (const [skillName, byRoute] of declaredSkillGains()) {
      const amounts = byRoute.get('discovery');
      if (amounts === undefined) continue;
      checked += 1;
      expect([...amounts], `${skillName} が発見で配る量`).toEqual([DISCOVERY_GAIN]);
    }

    expect(checked, '発見の契機が1つも無い').toBeGreaterThan(0);
  });

  it('腕を配る操作は、物を出すか相手を要する（腕だけが伸びる操作を置かない）', () => {
    // SkillSystem.md 3.1節。**練習は専用のアクションではなく、その腕の最も初歩的な行動そのもの**
    // なので、腕だけが伸びる操作——何も出さず、重ねる相手も要らないもの——は世界に1つも無い。
    // 腕前ごとに1つ並ぶ専用の練習アクションを足すと、ここで落ちる。
    //
    // **見ているのは相手が居ることまでで、何を消費するかまでは見ない**——`become`で相手を変える
    // だけの操作（塩漬け）も、出す物を持たないまま通る。
    //
    // **見るのは手作業だけで、レシピの工程は入らない**（同3.2節がその理由を持つ）。射程をレシピへ
    // 広げるなら、あちらの1文も一緒に書き換えること——**広げたことに気づけるのはここを触る者だけ。**
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
    const props = declaredPropsByDef();

    for (const [products, group] of shared) {
      const where = `'${products}' を出す ${group.map((i) => i.name).join('・')}`;
      expect(
        new Set(group.map((interaction) => interaction.skills.join(','))).size,
        `${where} で、配る腕が食い違う`,
      ).toBe(1);
      // **1回に配る量は揃わない**——長さで決まるので、長くかかる入口ほど多い（SkillSystem.md 3節）。
      // 化けないのは**時間あたりが等しい**からで、そこはこの組の中では幅（一つ上の検査）ではなく
      // 一致を要る。片方だけが刻みの端に乗ると、同じ仕事なのに島で伸びが変わる。
      //
      // **分数が読めることをここでも見る**——読めないまま割ると組の全員が`NaN`になり、集合が1つに
      // 畳まれて緑のまま通る。上の検査が先に落とす前提へ寄りかからない。
      const perHourOf = (interaction: InteractionGains): string => {
        const minutes = declaredMinutes(interaction, props);
        expect(minutes, `${where}: ${interaction.name} の所要時間が読めない`).toBeDefined();
        return interaction.gains
          .filter((gain) => gain.route === 'execution')
          .map((gain) => (gain.amount * 60) / minutes!)
          .join(',');
      };

      expect(new Set(group.map(perHourOf)).size, `${where} で、時間あたりの伸びが食い違う`).toBe(1);
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
    const entries = entriesBySkill(namedRecipes());

    expect(SKILLS.filter((name) => entries.get(name)?.length === 1).sort()).toEqual(SKILLS_WITH_ONE_ENTRY);
  });

  it('入口が1本と決めた腕の、その入口のコメントが本数に触れている', () => {
    // 一つ上の数え上げは、**足せば黙って通せる**——コメントを書かせるのはここ。SkillSystem.md 3.2.1節が
    // 「1本と決めたら、その理由をその入口のコメントへ書きます」と言っている以上、それが破れたときに
    // 落ちるものが要る。
    //
    // **見ているのは語の含有で、理由が書いてあるかではない。** 「入口」と「1本」を並べれば通るので、
    // **落ちるのはコメントごと忘れたときだけ**——理由として読めるかは人が読む。
    //
    // **語を2つとも求める**——どちらか1つなら、本数と関わりのない文でも当たってしまう。
    const entries = entriesBySkill(namedRecipes());

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
