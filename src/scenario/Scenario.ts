import { parseDocument } from 'yaml';
import type { WorldCodex } from '../domain/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { asMap, entriesInOrder, requireInt, tryGetMap, tryGetScalar, tryGetSeq } from '../loader/yamlMapping';
import { YamlLoadError } from '../loader/YamlLoadError';
import type { YamlNode } from '../loader/yamlMapping';
import { asScalarText } from '../loader/yamlMapping';

/**
 * 同梱シナリオの中身。置き場所と名前の規約は `src/assets/scenarios/<シナリオ名>.yaml` のみで、
 * コード側への登録は要らない。一覧はimport.meta.globがビルド時に作る——画面にシナリオを並べるには
 * 名前を列挙できる必要があるが、public/配下に置くと実行時に一覧を得る手段が無いため。
 */
const FILES = import.meta.glob('../assets/scenarios/*.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** 同梱シナリオの名前と、そのファイルの中身。 */
const SCENARIO_TEXTS: ReadonlyMap<string, string> = new Map(
  Object.entries(FILES)
    .map(([path, text]): [string, string] => [path.replace(/^.*\/(.+)\.yaml$/, '$1'), text])
    .sort(([a], [b]) => a.localeCompare(b)),
);

/** 同梱シナリオの名前一覧（名前順）。 */
export function scenarioNames(): readonly string[] {
  return [...SCENARIO_TEXTS.keys()];
}

/** 同梱シナリオを読む。名前が無ければundefined（URLで指定された名前は存在しないことがある）。 */
export function bundledScenario(name: string): Scenario | undefined {
  const text = SCENARIO_TEXTS.get(name);
  return text === undefined ? undefined : parseScenario(`scenarios/${name}.yaml`, text);
}

/** 1つのスロットへ入れるobject_defの識別子の並び。同じ名前が並んだ数だけ作られる。 */
export type SlotContents = readonly string[];

/** 個数の指定（`stone x100`）。同じものを並べる代わりに数で書ける。 */
const COUNT_PATTERN = /^(\S+)\s*x\s*(\d+)$/;

/** 1つの指定で作れる個数の上限。これを超えるのは書き間違いとみなして弾く。 */
const MAX_COUNT = 1000;

/**
 * テスト用の開始状態（SaveDataManagement.md ワールド状態の保存節）。
 *
 * ワールド状態そのものを保存する仕組みはまだ無いため、「シードで世界を作り直し、その後に決まった
 * 手順で中身を置く」という形で開始状態を再現する。置けるのは正当なスロット移動で到達できる状態だけで、
 * 不正な状態は作れない。
 */
export interface Scenario {
  /** 一覧に出す表示名。省略するとシナリオ名がそのまま出る。 */
  readonly title: string;
  /** 島のシード。新規ゲームのシードと同じ意味で、地形はこれだけで決まる。 */
  readonly seed: number;
  readonly hand: SlotContents;
  readonly equipment: SlotContents;
  /** 負った状態で始める怪我（injuries.yaml）。実際に負う契機は確率なので、狙って再現できない。 */
  readonly injuries: SlotContents;
  /**
   * 開始地点にする土地のobject_def名。省略すると通常の漂着地（砂浜優先、IslandSpawner.placePlayer）。
   * シードだけでは地形の種類を選べないため、特定の土地から試したいシナリオはこれで指定する。
   */
  readonly locationType: string | undefined;
  /** 開始地点の土地に置くもの。 */
  readonly items: SlotContents;
  readonly fixtures: SlotContents;
  /**
   * 置いた設置物の**中**に入れるもの（キーはその設置物のobject_def名）。積荷を積んだ筏
   * （docs/world/Voyage.md）のように、中身まで揃った状態から始めるために使う。
   */
  readonly inside: ReadonlyMap<string, SlotContents>;
  /** キャラクターのプロパティの上書き。値はYAMLに書かれたまま（整数かシンボル名、6.6節）。 */
  readonly props: ReadonlyMap<string, string>;
  /**
   * worldのプロパティの上書き。天候・季節・時刻はシードでは選べないため、それらに依存する挙動
   * （雨で水が溜まる、日差しで蒸発する）を試すシナリオはここで直接置く。
   */
  readonly worldProps: ReadonlyMap<string, string>;
}

/** シナリオファイルを読む。書式の誤りはYamlLoadErrorで、読み込んだ側が画面に出す。 */
export function parseScenario(fileName: string, text: string): Scenario {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    throw new YamlLoadError(`${fileName}: YAMLの構文エラー: ${document.errors[0].message}`);
  }

  const root = asMap(document.contents, fileName);
  const seed = requireInt(root, 'seed', fileName);

  const player = tryGetMap(root, 'player', fileName);
  const location = tryGetMap(root, 'location', fileName);
  const world = tryGetMap(root, 'world', fileName);

  return {
    title: tryGetScalar(root, 'title', fileName) ?? fileName.replace(/^.*\/(.+)\.yaml$/, '$1'),
    seed,
    hand: readSlotContents(player, 'hand', `${fileName}.player`),
    equipment: readSlotContents(player, 'equipment', `${fileName}.player`),
    injuries: readSlotContents(player, 'injuries', `${fileName}.player`),
    locationType: location === undefined ? undefined : tryGetScalar(location, 'type', `${fileName}.location`),
    items: readSlotContents(location, 'items', `${fileName}.location`),
    fixtures: readSlotContents(location, 'fixtures', `${fileName}.location`),
    inside: contentsByOwner(location, `${fileName}.location`),
    props: propertyValues(player, 'props', `${fileName}.player`),
    worldProps: propertyValues(world, 'props', `${fileName}.world`),
  };
}

/** `inside`（設置物の名前 → その中へ入れる物の並び）。書かれていなければ空。 */
function contentsByOwner(
  parent: ReturnType<typeof tryGetMap>,
  context: string,
): ReadonlyMap<string, SlotContents> {
  const byOwner = new Map<string, SlotContents>();
  if (parent === undefined) return byOwner;

  const map = tryGetMap(parent, 'inside', context);
  if (map === undefined) return byOwner;

  for (const [owner] of entriesInOrder(map)) {
    byOwner.set(owner, readSlotContents(map, owner, `${context}.inside`));
  }
  return byOwner;
}

function readSlotContents(parent: ReturnType<typeof tryGetMap>, key: string, context: string): SlotContents {
  if (parent === undefined) return [];
  const seq = tryGetSeq(parent, key, context);
  if (seq === undefined) return [];
  return (seq.items as YamlNode[]).flatMap((item) =>
    expandCount(asScalarText(item, `${context}.${key}`), `${context}.${key}`),
  );
}

/** `stone x100` を100個の'stone'へ展開する。個数の指定が無ければ、その名前1つ。 */
function expandCount(text: string, context: string): readonly string[] {
  const matched = COUNT_PATTERN.exec(text.trim());
  if (matched === null) return [text.trim()];

  const [, name, digits] = matched;
  const count = Number(digits);
  if (count < 1 || count > MAX_COUNT) {
    throw new YamlLoadError(`${context}: 個数は1以上${MAX_COUNT}以下である必要があります（値: '${text}'）。`);
  }
  return Array.from({ length: count }, () => name);
}

/** プロパティ名 → YAMLに書かれた値のまま。実体値への解決は適用時（codexが要るため、resolveValue）。 */
function propertyValues(
  parent: ReturnType<typeof tryGetMap>,
  key: string,
  context: string,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  if (parent === undefined) return values;

  const map = tryGetMap(parent, key, context);
  if (map === undefined) return values;

  for (const [name, node] of entriesInOrder(map)) {
    values.set(name, asScalarText(node, `${context}.${key}.'${name}'`));
  }
  return values;
}

/**
 * シードから作り直した世界へ、シナリオの開始状態を置く。
 *
 * 置き方は通常のスロット移動（WorldObject.moveToSlot）そのもので、シナリオ専用の抜け道は持たない。
 * 受け入れられない組み合わせ（手持ちの上限超過など）はその場でエラーにする——黙って落ちると、
 * テストしたかった状態と違う状態でゲームが始まってしまうため。
 */
export function applyScenario(game: NewGameSession, scenario: Scenario, codex: WorldCodex): void {
  // 置き場所は開始地点を基準にするため、地形の指定は中身を置く前に効かせる。
  if (scenario.locationType !== undefined && !game.startAt(objectIdOf(codex, scenario.locationType))) {
    throw new YamlLoadError(
      `シナリオ: シード ${scenario.seed} の島に '${scenario.locationType}' の土地がありません。`,
    );
  }

  place(game, codex, scenario.hand, 'hand');
  place(game, codex, scenario.equipment, 'equipment');
  place(game, codex, scenario.injuries, 'injuries');
  place(game, codex, scenario.items, 'items');
  place(game, codex, scenario.fixtures, 'fixtures');
  placeInside(game, codex, scenario.inside);

  for (const [name, raw] of scenario.props) {
    game.player.instance
      .getProperty(propertyIdOf(codex, name))
      .setNumberWithoutEvents(resolveValue(codex, name, raw));
  }
  for (const [name, raw] of scenario.worldProps) {
    game.world.instance
      .getProperty(propertyIdOf(codex, name))
      .setNumberWithoutEvents(resolveValue(codex, name, raw));
  }
}

/**
 * プロパティへ書く実体値を決める。整数はそのまま、それ以外はシンボル名（6.6節）とみなしてIDへ直す。
 * 未知のシンボル名はエラー——`weather: rainy` のような綴り間違いが「シンボルではない何か」として
 * 黙って通ると、雨を待っているのに一生降らない世界で始まってしまうため。
 */
function resolveValue(codex: WorldCodex, propertyName: string, raw: string): number {
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber)) return asNumber;

  const symbolId = codex.symbolNames.tryGetId(raw);
  if (symbolId === undefined) {
    throw new YamlLoadError(
      `シナリオ: プロパティ '${propertyName}' の値 '${raw}' は整数でもシンボル名でもありません。`,
    );
  }
  return symbolId;
}

/** 名前で並べたobject_defを1つずつ生成し、そのスロットへ入れる。 */
function place(game: NewGameSession, codex: WorldCodex, contents: SlotContents, slot: string): void {
  if (contents.length === 0) return;

  const slotId = slotIdOf(codex, slot);

  // 手持ち・装備・怪我はキャラクター自身のスロット、それ以外は開始地点の土地のスロット。
  const world = codex.vocabulary.world;
  const ownedByCharacter = [world.handSlotId, world.equipmentSlotId, world.injuriesSlotId].includes(slotId);
  const owner = ownedByCharacter ? game.player.instance : game.startLocation.instance;

  for (const name of contents) {
    const spawned = game.session.createObject(objectIdOf(codex, name));
    const failure = spawned.moveToSlot(owner.getSlot(slotId));
    if (failure !== undefined) {
      throw new YamlLoadError(`シナリオ: '${name}' を '${slot}' へ置けません: ${failure}`);
    }
  }
}

/**
 * 置いた設置物の中へ物を入れる（Scenario.inside）。行き先はその物のスロットを宣言順に走査して
 * 決めるので（spawnの`into`と同じ規約）、シナリオ側はスロット名を書かない。
 *
 * 入れる先が見つからない・受け入れられない（かさの上限を超える）場合はエラーにする——黙って
 * 落とすと、積んだつもりの物が地面に落ちた状態でゲームが始まってしまう。
 */
function placeInside(
  game: NewGameSession,
  codex: WorldCodex,
  inside: ReadonlyMap<string, SlotContents>,
): void {
  for (const [ownerName, contents] of inside) {
    const ownerDefId = objectIdOf(codex, ownerName);
    const owner = game.startLocation.fixtures.find((fixture) => fixture.def.globalId === ownerDefId);
    if (owner === undefined)
      throw new YamlLoadError(
        `シナリオ: '${ownerName}' が開始地点に置かれていないので、中へ入れられません。`,
      );

    for (const name of contents) {
      const spawned = game.session.createObject(objectIdOf(codex, name));
      if (!spawned.moveIntoFirstAcceptingSlot(owner))
        throw new YamlLoadError(`シナリオ: '${name}' を '${ownerName}' の中へ入れられません。`);
    }
  }
}

function objectIdOf(codex: WorldCodex, name: string): number {
  const id = codex.objectNames.tryGetId(name);
  if (id === undefined) throw new YamlLoadError(`シナリオ: object_def '${name}' がありません。`);
  return id;
}

function slotIdOf(codex: WorldCodex, name: string): number {
  const id = codex.slotNames.tryGetId(name);
  if (id === undefined) throw new YamlLoadError(`シナリオ: スロット '${name}' がありません。`);
  return id;
}

function propertyIdOf(codex: WorldCodex, name: string): number {
  const id = codex.propertyNames.tryGetId(name);
  if (id === undefined) throw new YamlLoadError(`シナリオ: プロパティ '${name}' がありません。`);
  return id;
}
