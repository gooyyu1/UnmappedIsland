import { parseDocument } from 'yaml';
import type { WorldCodex } from '../domain/defs/WorldCodex';
import type { NewGameSession } from '../domain/generation/NewGame';
import { asMap, entriesInOrder, requireInt, tryGetMap, tryGetScalar, tryGetSeq } from '../loader/yamlMapping';
import { YamlLoadError } from '../loader/YamlLoadError';
import type { YamlNode } from '../loader/yamlMapping';
import { asScalarText } from '../loader/yamlMapping';

/**
 * 同梱シナリオの中身。置き場所と名前の規約は `src/scenarios/<シナリオ名>.yaml` のみで、
 * コード側への登録は要らない。一覧はimport.meta.globがビルド時に作る——画面にシナリオを並べるには
 * 名前を列挙できる必要があるが、public/配下に置くと実行時に一覧を得る手段が無いため。
 */
const FILES = import.meta.glob('../scenarios/*.yaml', {
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

/** 1つのスロットへ入れるobject_defの識別子の並び。同じ名前を並べると、その数だけ作られる。 */
export type SlotContents = readonly string[];

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
  /** 開始地点の土地に置くもの。 */
  readonly items: SlotContents;
  readonly fixtures: SlotContents;
  /** キャラクターのプロパティの上書き（実体値）。 */
  readonly props: ReadonlyMap<string, number>;
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

  return {
    title: tryGetScalar(root, 'title', fileName) ?? fileName.replace(/^.*\/(.+)\.yaml$/, '$1'),
    seed,
    hand: names(player, 'hand', `${fileName}.player`),
    equipment: names(player, 'equipment', `${fileName}.player`),
    items: names(location, 'items', `${fileName}.location`),
    fixtures: names(location, 'fixtures', `${fileName}.location`),
    props: numbers(player, 'props', `${fileName}.player`),
  };
}

function names(parent: ReturnType<typeof tryGetMap>, key: string, context: string): SlotContents {
  if (parent === undefined) return [];
  const seq = tryGetSeq(parent, key, context);
  if (seq === undefined) return [];
  return (seq.items as YamlNode[]).map((item) => asScalarText(item, `${context}.${key}`));
}

function numbers(
  parent: ReturnType<typeof tryGetMap>,
  key: string,
  context: string,
): ReadonlyMap<string, number> {
  const values = new Map<string, number>();
  if (parent === undefined) return values;

  const map = tryGetMap(parent, key, context);
  if (map === undefined) return values;

  for (const [name, node] of entriesInOrder(map)) {
    const raw = asScalarText(node, `${context}.${key}.'${name}'`);
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      throw new YamlLoadError(`${context}.${key}.'${name}': 整数である必要があります（値: '${raw}'）。`);
    }
    values.set(name, value);
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
  place(game, codex, scenario.hand, 'hand');
  place(game, codex, scenario.equipment, 'equipment');
  place(game, codex, scenario.items, 'items');
  place(game, codex, scenario.fixtures, 'fixtures');

  for (const [name, value] of scenario.props) {
    game.player.instance.setProperty(propertyIdOf(codex, name), value);
  }
}

/** 名前で並べたobject_defを1つずつ生成し、そのスロットへ入れる。 */
function place(game: NewGameSession, codex: WorldCodex, contents: SlotContents, slot: string): void {
  if (contents.length === 0) return;

  // 手持ち・装備はキャラクターのスロット、それ以外は開始地点の土地のスロット。
  const owner = slot === 'hand' || slot === 'equipment' ? game.player.instance : game.startLocation.instance;
  const slotId = slotIdOf(codex, slot);

  for (const name of contents) {
    const spawned = game.session.spawn(objectIdOf(codex, name));
    const failure = spawned.moveToSlot(owner, slotId, codex.wellKnown);
    if (failure !== undefined) {
      throw new YamlLoadError(`シナリオ: '${name}' を '${slot}' へ置けません: ${failure}`);
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
