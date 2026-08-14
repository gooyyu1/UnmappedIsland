import type { YAMLMap } from 'yaml';
import { isMap, isSeq } from 'yaml';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireNumber,
  requireScalar,
  tryGetBool,
  tryGetMap,
  tryGetNumber,
  tryGetScalar,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { ACTIVE_VERB_KEYS, parseNumberLiteral, parseScalarNumber, tryGetNode } from './parseCommon';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ReferenceRoot } from '../domain/defs/ReferenceRoot';
import {
  ActiveEffects,
  AddEffect,
  DestroyEffect,
  SetEffect,
  SpawnEffect,
  TransferEffect,
} from '../domain/defs/ActiveEffect';
import type { ActiveEffect, SpawnTargetRoot } from '../domain/defs/ActiveEffect';
import type { MoveDestination } from '../domain/defs/MoveEffect';
import { MoveEffect } from '../domain/defs/MoveEffect';
import { SignalEffect } from '../domain/defs/SignalEffect';

/**
 * active内容（9節）を読む。文法は「操作(set/add)が上位、対象(self/parent/actor/dragged)が下位」
 * （例: `add: {self: {hour: 1}}`）。bodyNodeにはactive以外の兄弟キーも同居しうるため、
 * reservedKeysに「呼び出し側がすでに読み終えている兄弟キー」を渡して未知キー判定から除外する。
 * spawnは常にselfが実行するものとみなすため対象キーを持たない。signalは対象を省ける
 * （`signal: missed`＝selfへ告げる、9.8節）。
 */
export function parseActiveEffectBody(
  loader: WorldCodexYamlLoader,
  context: string,
  bodyNode: YAMLMap,
  allowDragged: boolean,
  selfOnly: boolean,
  reservedKeys?: ReadonlyArray<string>,
): ActiveEffects {
  // 適用順はset→add→transfer→move→destroy→spawn→signalで固定（set後add、destroyで空いた位置への
  // spawn(same_slot)、moveはdestroyで対象が消える前、という依存関係のため。signalは世界を変えないので
  // 依存を持たず、起きたことの告知として末尾に置く。ActiveEffects.applyはこのリスト順にそのまま適用する）。
  const operations: ActiveEffect[] = [];

  const setMap = tryGetMap(bodyNode, 'set', context);
  if (setMap !== undefined)
    operations.push(...parseSets(loader, `${context}.set`, setMap, allowDragged, selfOnly));

  const addMap = tryGetMap(bodyNode, 'add', context);
  if (addMap !== undefined)
    operations.push(...parseAdds(loader, `${context}.add`, addMap, allowDragged, selfOnly));

  const transferNode = tryGetNode(bodyNode, 'transfer');
  if (transferNode !== undefined)
    operations.push(...parseTransfers(loader, `${context}.transfer`, transferNode, allowDragged, selfOnly));

  const moveNode = tryGetMap(bodyNode, 'move', context);
  if (moveNode !== undefined) operations.push(parseMove(loader, `${context}.move`, moveNode, selfOnly));

  const destroyNode = tryGetNode(bodyNode, 'destroy');
  if (destroyNode !== undefined)
    for (const target of parseDestroyTargets(`${context}.destroy`, destroyNode, allowDragged, selfOnly))
      operations.push(new DestroyEffect(target));

  const spawnNode = tryGetNode(bodyNode, 'spawn');
  if (spawnNode !== undefined) operations.push(...parseSpawns(loader, `${context}.spawn`, spawnNode));

  const signalNode = tryGetNode(bodyNode, 'signal');
  if (signalNode !== undefined)
    operations.push(...parseSignals(`${context}.signal`, signalNode, allowDragged, selfOnly));

  const knownKeys = new Set<string>(ACTIVE_VERB_KEYS);
  if (reservedKeys !== undefined) for (const key of reservedKeys) knownKeys.add(key);

  const unknownKeys = entriesInOrder(bodyNode)
    .map(([key]) => key)
    .filter((key) => !knownKeys.has(key));
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  return new ActiveEffects(operations);
}

/** setの1エントリの値。リテラル（数値・真偽値・シンボル名）のみ（9.2節）。 */
function parseSetEffect(
  loader: WorldCodexYamlLoader,
  context: string,
  target: ReferenceRoot,
  propertyGlobalId: number,
  valueNode: YamlNode,
): SetEffect {
  const [value] = parseScalarNumber(loader, context, asScalarText(valueNode, context));
  return new SetEffect(target, propertyGlobalId, value);
}

/**
 * transfer（9.5節）。from/toの参照はフラットな2フィールド（from_object/from_prop,
 * to_object/to_prop）で表し、from_object/to_objectは省略時self。対象ルートはset/add/destroyと
 * 同じ制約（selfOnly・allowDragged）を共有する。linked_add（省略可）はaddと同じ構造で、
 * 実際の移動量に比例してスケールされる副効果。to_amount（省略可）は、移送元と移送先で単位が違うときに
 * 「amount分を出すと移送先がどれだけ増えるか」を持つ。
 */
function parseTransfer(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  allowDragged: boolean,
  selfOnly: boolean,
): TransferEffect {
  const fromObjectRaw = tryGetScalar(map, 'from_object', context);
  const fromObject =
    fromObjectRaw !== undefined
      ? parseActiveTargetKey(context, fromObjectRaw, allowDragged, selfOnly)
      : 'self';
  const fromProp = loader.propertyNames.intern(requireScalar(map, 'from_prop', context));

  const toObjectRaw = tryGetScalar(map, 'to_object', context);
  const toObject =
    toObjectRaw !== undefined ? parseActiveTargetKey(context, toObjectRaw, allowDragged, selfOnly) : 'self';
  const toProp = loader.propertyNames.intern(requireScalar(map, 'to_prop', context));

  const amount = requireNumber(map, 'amount', context);
  // 単位が同じなら省略できる（1対1）。0では移送先が増えないうえ割り戻しが割れないため弾く。
  const toAmount = tryGetNumber(map, 'to_amount', context) ?? amount;
  if (toAmount <= 0) throw new YamlLoadError(`${context}: 'to_amount' は正の数である必要があります。`);
  const allowOverflow = tryGetBool(map, 'allow_overflow', context, false);

  const linkedAddMap = tryGetMap(map, 'linked_add', context);
  const linkedAdd =
    linkedAddMap !== undefined
      ? parseAdds(loader, `${context}.linked_add`, linkedAddMap, allowDragged, selfOnly)
      : [];

  const unknownKeys = entriesInOrder(map)
    .map(([key]) => key)
    .filter(
      (key) =>
        key !== 'from_object' &&
        key !== 'from_prop' &&
        key !== 'to_object' &&
        key !== 'to_prop' &&
        key !== 'amount' &&
        key !== 'to_amount' &&
        key !== 'allow_overflow' &&
        key !== 'linked_add',
    );
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  return new TransferEffect(
    fromObject,
    fromProp,
    toObject,
    toProp,
    amount,
    allowOverflow,
    linkedAdd,
    toAmount,
  );
}

/** setを「対象付きの1操作(SetEffect)」の宣言順フラットリストへ読む。 */
function parseSets(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  allowDragged: boolean,
  selfOnly: boolean,
): SetEffect[] {
  const sets: SetEffect[] = [];
  for (const [targetName, targetBody] of entriesInOrder(map)) {
    const target = parseActiveTargetKey(context, targetName, allowDragged, selfOnly);
    for (const [propName, valueNode] of entriesInOrder(asMap(targetBody, `${context}.'${targetName}'`)))
      sets.push(
        parseSetEffect(
          loader,
          `${context}.'${targetName}'.'${propName}'`,
          target,
          loader.propertyNames.intern(propName),
          valueNode,
        ),
      );
  }

  return sets;
}

/** addを「対象付きの1操作(AddEffect)」の宣言順フラットリストへ読む。 */
function parseAdds(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  allowDragged: boolean,
  selfOnly: boolean,
): AddEffect[] {
  const adds: AddEffect[] = [];
  for (const [targetName, targetBody] of entriesInOrder(map)) {
    const target = parseActiveTargetKey(context, targetName, allowDragged, selfOnly);
    for (const [propName, amountNode] of entriesInOrder(asMap(targetBody, `${context}.'${targetName}'`)))
      adds.push(
        new AddEffect(
          target,
          loader.propertyNames.intern(propName),
          parseNumberLiteral(context, asScalarText(amountNode, context)),
        ),
      );
  }

  return adds;
}

/** spawn（9.4節）の1エントリが持てるキー。これ以外はロードエラー（綴り間違いをその場で捕まえる）。 */
const SPAWN_KEYS = new Set(['object', 'into', 'count']);

function parseSpawns(loader: WorldCodexYamlLoader, context: string, node: YamlNode): SpawnEffect[] {
  if (isMap(node)) return [parseSpawn(loader, context, node)];

  if (isSeq(node)) {
    const result: SpawnEffect[] = [];
    const items = node.items as YamlNode[];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isMap(item)) throw new YamlLoadError(`${context}[${i}]: 各要素はmappingである必要があります。`);
      result.push(parseSpawn(loader, `${context}[${i}]`, item));
    }
    return result;
  }

  throw new YamlLoadError(`${context}: mappingかmappingの配列である必要があります。`);
}

function parseSpawn(loader: WorldCodexYamlLoader, context: string, map: YAMLMap): SpawnEffect {
  const into = tryGetScalar(map, 'into', context);

  const unknownKeys = entriesInOrder(map)
    .map(([key]) => key)
    .filter((key) => !SPAWN_KEYS.has(key));
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  const count = tryGetNumber(map, 'count', context) ?? 1;
  if (!Number.isInteger(count) || count < 1)
    throw new YamlLoadError(`${context}: countは1以上の整数である必要があります（値: ${count}）。`);

  return new SpawnEffect(
    loader.objectNames.intern(requireScalar(map, 'object', context)),
    parseSpawnTargetRoot(context, into),
    count,
  );
}

function parseTransfers(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  allowDragged: boolean,
  selfOnly: boolean,
): TransferEffect[] {
  if (isMap(node)) return [parseTransfer(loader, context, node, allowDragged, selfOnly)];

  if (isSeq(node)) {
    const result: TransferEffect[] = [];
    const items = node.items as YamlNode[];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!isMap(item)) throw new YamlLoadError(`${context}[${i}]: 各要素はmappingである必要があります。`);
      result.push(parseTransfer(loader, `${context}[${i}]`, item, allowDragged, selfOnly));
    }
    return result;
  }

  throw new YamlLoadError(`${context}: mappingかmappingの配列である必要があります。`);
}

/**
 * move（対象のオブジェクトを、移動先の中へ移動する。MoveEffect参照）。
 * transferと同じフラットフィールド規約（`move: {object: actor, to_prop: destination_id}`）。
 *
 * objectはactor（アクション実行者）とdragged（combinationsでドラッグされてきたカード）のみ対応する。
 * self/parent/child等は「一度きりの命令に対してどれを動かすか」の意味論が未確定のため未対応。
 * 移動先はtoかto_propのどちらか一方で指す（両方・どちらも無しはエラー）。
 * selfOnly文脈（rangeイベント）にはactorもdraggedも存在しないため使えない。
 */
function parseMove(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  selfOnly: boolean,
): MoveEffect {
  if (selfOnly)
    throw new YamlLoadError(
      `${context}: moveはon_overflow/on_shortfallでは使えません（actorが存在しないため）。`,
    );

  const objectRaw = requireScalar(map, 'object', context);
  if (objectRaw !== 'actor' && objectRaw !== 'dragged')
    throw new YamlLoadError(
      `${context}: moveのobjectは'actor'か'dragged'のみ対応しています（値: '${objectRaw}'）。`,
    );

  const unknownKeys = entriesInOrder(map)
    .map(([key]) => key)
    .filter((key) => key !== 'object' && key !== 'to' && key !== 'to_prop');
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  return new MoveEffect(objectRaw, parseMoveDestination(loader, context, map));
}

/** moveの移動先（to か to_prop のどちらか一方）。 */
function parseMoveDestination(loader: WorldCodexYamlLoader, context: string, map: YAMLMap): MoveDestination {
  const to = tryGetScalar(map, 'to', context);
  const toProp = tryGetScalar(map, 'to_prop', context);

  if ((to === undefined) === (toProp === undefined))
    throw new YamlLoadError(`${context}: moveの移動先はtoかto_propのどちらか一方で指定してください。`);

  if (toProp !== undefined) {
    return { kind: 'instance_id_prop', propertyGlobalId: loader.propertyNames.intern(toProp) };
  }
  if (to === 'self') return { kind: 'self' };
  if (to === 'parent') return { kind: 'parent' };
  throw new YamlLoadError(`${context}: moveのtoは'self'か'parent'のみ対応しています（値: '${to}'）。`);
}

/**
 * activeの対象キー（self/parent/ancestor/actor、combinations内はdraggedも）を解決する。
 * childは「どの子か」を一意に絞る規約が無いため未対応。selfOnly（rangeイベント）は
 * self以外を一律エラーにする。
 */
function parseActiveTargetKey(
  context: string,
  key: string,
  allowDragged: boolean,
  selfOnly: boolean,
): ReferenceRoot {
  if (selfOnly && key !== 'self')
    throw new YamlLoadError(`${context}: 現時点でselfのみ対応しています（未対応: '${key}'）。`);

  switch (key) {
    case 'self':
      return 'self';
    case 'parent':
      return 'parent';
    case 'ancestor':
      return 'ancestor';
    case 'actor':
      return 'actor';
    case 'dragged':
      if (!allowDragged) throw new YamlLoadError(`${context}: 'dragged'はcombinationsの中でのみ使えます。`);
      return 'dragged';
    case 'child':
      throw new YamlLoadError(
        `${context}: activeの対象'child'は未対応です（一度きりの命令に対して『どの子か』の意味が確定していないため）。`,
      );
    default:
      throw new YamlLoadError(`${context}: 未知の対象キー '${key}' です。`);
  }
}

/**
 * signal（9.8節）を読む。対象を省いた `signal: missed`（selfへ告げる）と、他の命令と同じ
 * 「操作が上位、対象が下位」の `signal: {dragged: missed}` の2つの形を許容する。
 *
 * 省略形を持つのは、告げる相手が効果を宣言した側そのものである場合が大半だから（動物のカードへ
 * 武器を重ねる、9.8節）。対象を書くのは、宣言した側と起きた側が違うときだけになる。
 */
function parseSignals(
  context: string,
  node: YamlNode,
  allowDragged: boolean,
  selfOnly: boolean,
): SignalEffect[] {
  if (isSeq(node))
    throw new YamlLoadError(`${context}: 出来事の識別子か、対象ごとの識別子である必要があります。`);

  if (!isMap(node)) return [new SignalEffect(asScalarText(node, context), 'self')];

  return entriesInOrder(node).map(([targetName, nameNode]) => {
    const target = parseObjectTargetKey(context, targetName, allowDragged, selfOnly);
    return new SignalEffect(asScalarText(nameNode, `${context}.'${targetName}'`), target);
  });
}

/** destroy（削除対象の直接指定）を読む。単一の対象名か対象名のリストを許容する。
 * ancestorはプロパティ名が無いと解決できないため、destroyの対象としては未対応。 */
function parseDestroyTargets(
  context: string,
  node: YamlNode,
  allowDragged: boolean,
  selfOnly: boolean,
): ReferenceRoot[] {
  if (isMap(node))
    throw new YamlLoadError(`${context}: destroyは対象名か、対象名のリストのいずれかである必要があります。`);

  if (isSeq(node))
    return (node.items as YamlNode[]).map((n) =>
      parseObjectTargetKey(context, asScalarText(n, context), allowDragged, selfOnly),
    );

  return [parseObjectTargetKey(context, asScalarText(node, context), allowDragged, selfOnly)];
}

/**
 * オブジェクトそのものを指す対象（destroy・signal）。ancestorはプロパティ名が無いと解決先が
 * 決まらないため、ここでは使えない。
 */
function parseObjectTargetKey(
  context: string,
  key: string,
  allowDragged: boolean,
  selfOnly: boolean,
): ReferenceRoot {
  const root = parseActiveTargetKey(context, key, allowDragged, selfOnly);
  if (root === 'ancestor')
    throw new YamlLoadError(
      `${context}: 対象'ancestor'は未対応です（プロパティではなくオブジェクトそのものを指すため）。`,
    );
  return root;
}

function parseSpawnTargetRoot(context: string, raw: string | undefined): SpawnTargetRoot {
  switch (raw) {
    case undefined:
    case 'same_slot':
      return 'same_slot';
    case 'self':
      return 'self';
    case 'actor':
      return 'actor';
    case 'child':
      return 'child';
    default:
      throw new YamlLoadError(
        `${context}: spawn.intoは 'same_slot'/'self'/'actor'/'child' のいずれかである必要があります（値: '${raw}'）。`,
      );
  }
}
