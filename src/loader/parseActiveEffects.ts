import type { YAMLMap, YAMLSeq } from 'yaml';
import { isMap, isScalar, isSeq } from 'yaml';
import {
  asMap,
  asScalarText,
  asSeq,
  entriesInOrder,
  requireKnownKeys,
  requireNumber,
  requireScalar,
  tryGetBool,
  tryGetMap,
  tryGetNode,
  tryGetNumber,
  tryGetScalar,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseNumberLiteral, parseScalarNumber } from './parseCommon';
import { ACTION_CONDITION_ROOTS, COMBINATION_CONDITION_ROOTS, parseSubjectRoot } from './parseConditions';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import { PropertyPath } from '../domain/ReferenceRoot';
import {
  ActiveEffects,
  AddEffect,
  DestroyEffect,
  SetEffect,
  SpawnEffect,
  TransferEffect,
} from '../domain/ActiveEffect';
import type { ActiveEffect, SpawnTargetRoot } from '../domain/ActiveEffect';
import { BecomeEffect } from '../domain/BecomeEffect';
import { MoveEffect } from '../domain/MoveEffect';
import { ObjectRef } from '../domain/ObjectRef';
import { PickCandidateDef, PickEffect, WeightSpec } from '../domain/PickEffect';
import { SignalEffect } from '../domain/SignalEffect';

/**
 * 効果の中身（9節の命令と、10節の`pick`）を読む。文法は「操作(set/add)が上位、
 * 対象(self/parent/actor/dragged)が下位」（例: `add: {self: {hour: 1}}`）。spawnは常にselfが実行する
 * ものとみなすため対象キーを持たない。signalは対象を省ける（`signal: missed`＝selfへ告げる、9.8節）。
 *
 * **適用順はYAMLに書かれた順**で、動詞ごとの優先順位は無い（9.7節）。bodyNodeには効果以外の兄弟キーも
 * 同居しうるため、reservedKeysに「呼び出し側がすでに読み終えている兄弟キー」を渡して未知キー判定から
 * 除外する。
 */
export function parseActiveEffectBody(
  loader: WorldCodexYamlLoader,
  context: string,
  bodyNode: YAMLMap,
  allowDragged: boolean,
  selfOnly: boolean,
  reservedKeys?: ReadonlyArray<string>,
): ActiveEffects {
  const operations: ActiveEffect[] = [];
  const unknownKeys: string[] = [];

  for (const [key, valueNode] of entriesInOrder(bodyNode)) {
    const keyContext = `${context}.${key}`;
    switch (key) {
      case 'set':
        operations.push(
          ...parseSets(loader, keyContext, asMap(valueNode, keyContext), allowDragged, selfOnly),
        );
        break;
      case 'add':
        operations.push(
          ...parseAdds(loader, keyContext, asMap(valueNode, keyContext), allowDragged, selfOnly),
        );
        break;
      case 'transfer':
        operations.push(...parseTransfers(loader, keyContext, valueNode, allowDragged, selfOnly));
        break;
      case 'move':
        operations.push(...parseMoves(loader, keyContext, valueNode, selfOnly));
        break;
      case 'destroy':
        for (const target of parseDestroyTargets(loader, keyContext, valueNode, allowDragged, selfOnly))
          operations.push(new DestroyEffect(target));
        break;
      case 'spawn':
        operations.push(...parseSpawns(loader, keyContext, valueNode));
        break;
      case 'become':
        operations.push(
          parseBecome(loader, keyContext, asMap(valueNode, keyContext), allowDragged, selfOnly),
        );
        break;
      case 'signal':
        operations.push(...parseSignals(keyContext, valueNode, allowDragged, selfOnly));
        break;
      case 'pick':
        operations.push(
          new PickEffect(
            parsePickList(loader, context, asSeq(valueNode, keyContext), allowDragged, selfOnly),
          ),
        );
        break;
      default:
        if (reservedKeys === undefined || !reservedKeys.includes(key)) unknownKeys.push(key);
    }
  }

  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  return new ActiveEffects(operations);
}

/** pick候補が持つ、効果以外の兄弟キー。 */
const PICK_CANDIDATE_RESERVED_KEYS = ['weight'] as const;

/** pick（10節）の候補リストを読む。候補の中身は9節の命令と同じで、さらにpickを入れ子にできる。 */
function parsePickList(
  loader: WorldCodexYamlLoader,
  context: string,
  pickNode: YAMLSeq,
  allowDragged: boolean,
  // selfOnly（on_min等のrangeイベント内のpick）は、ネストした候補にもそのまま引き継ぐ。
  selfOnly = false,
): PickCandidateDef[] {
  const result: PickCandidateDef[] = [];

  for (const node of pickNode.items as YamlNode[]) {
    const map = asMap(node, context);
    const candidateContext = `${context}.pick[${result.length}]`;

    const weightNode = tryGetNode(map, 'weight');
    if (weightNode === undefined) throw new YamlLoadError(`${candidateContext}: 'weight'は必須です。`);
    const weight = parseWeight(loader, candidateContext, weightNode, allowDragged);

    // weightだけの候補は「選ばれても何も起きない回」（外した回・寄って来なかった回）を表す。
    const effect = parseActiveEffectBody(
      loader,
      candidateContext,
      map,
      allowDragged,
      selfOnly,
      PICK_CANDIDATE_RESERVED_KEYS,
    );

    result.push(new PickCandidateDef(weight, effect));
  }

  return result;
}

/**
 * リテラル数値か`{subject, prop}`参照（GameElementDefinition.md 10.2節）を読む。durationもこの形で、
 * 「今の状態から見ていくらか」を書けるようにするため（切れ味の悪い刃物ほど時間がかかる）。
 */
export function parseWeight(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  allowDragged: boolean,
  fieldName = 'weight',
): WeightSpec {
  if (isScalar(node)) {
    const raw = asScalarText(node, context);
    const literal = Number(raw);
    if (raw.trim() === '' || Number.isNaN(literal))
      throw new YamlLoadError(`${context}: ${fieldName}は数値である必要があります（値: '${raw}'）。`);
    return WeightSpec.ofLiteral(literal);
  }

  if (isMap(node)) {
    const allowedRoots = allowDragged ? COMBINATION_CONDITION_ROOTS : ACTION_CONDITION_ROOTS;
    const subjectName = tryGetScalar(node, 'subject', context);
    const root = subjectName !== undefined ? parseSubjectRoot(context, subjectName, allowedRoots) : 'self';
    const propName = requireScalar(node, 'prop', context);

    requireKnownKeys(node, ['subject', 'prop'], context);

    return WeightSpec.ofPath(new PropertyPath(root, loader.propertyNames.intern(propName)));
  }

  throw new YamlLoadError(
    `${context}: ${fieldName}はリテラル数値か{subject, prop}のいずれかである必要があります。`,
  );
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
 * transfer（9.5節）。from/toの参照はフラットな2フィールド（from/from_prop, to/to_prop）で表し、
 * from/toは省略時self。対象ルートはset/add/destroyと
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
  const fromRaw = tryGetScalar(map, 'from', context);
  const fromObject =
    fromRaw !== undefined ? parseActiveTargetRoot(context, fromRaw, allowDragged, selfOnly) : 'self';
  const fromProp = loader.propertyNames.intern(requireScalar(map, 'from_prop', context));

  const toRaw = tryGetScalar(map, 'to', context);
  const toObject =
    toRaw !== undefined ? parseActiveTargetRoot(context, toRaw, allowDragged, selfOnly) : 'self';
  const toProp = loader.propertyNames.intern(requireScalar(map, 'to_prop', context));

  const amount = requireNumber(map, 'amount', context);
  // 単位が同じなら省略できる（1対1）。0では移送先が増えないうえ割り戻しが割れないため弾く。
  const toAmount = tryGetNumber(map, 'to_amount', context) ?? amount;
  if (toAmount <= 0) throw new YamlLoadError(`${context}: 'to_amount' は正の数である必要があります。`);
  const allowOverflow = tryGetBool(map, 'allow_overflow', context) ?? false;

  const linkedAddMap = tryGetMap(map, 'linked_add', context);
  const linkedAdd =
    linkedAddMap !== undefined
      ? parseAdds(loader, `${context}.linked_add`, linkedAddMap, allowDragged, selfOnly)
      : [];

  requireKnownKeys(
    map,
    ['from', 'from_prop', 'to', 'to_prop', 'amount', 'to_amount', 'allow_overflow', 'linked_add'],
    context,
  );

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
    const target = parseActiveTargetRoot(context, targetName, allowDragged, selfOnly);
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
    const target = parseActiveTargetRoot(context, targetName, allowDragged, selfOnly);
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

  requireKnownKeys(map, SPAWN_KEYS, context);

  const count = tryGetNumber(map, 'count', context) ?? 1;
  if (!Number.isInteger(count) || count < 1)
    throw new YamlLoadError(`${context}: countは1以上の整数である必要があります（値: ${count}）。`);

  return new SpawnEffect(
    loader.objectNames.intern(requireScalar(map, 'object', context)),
    parseSpawnTargetRoot(context, into),
    count,
  );
}

/**
 * passivesの中の transfer（8.4節）。文法はactiveのものと同一で、対象から `actor` だけを外す
 * ——持続的な関係に紐づかないため（modify/addのpassiveが `actor` を持たないのと同じ理由）。
 */
export function parsePassiveTransfers(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
): TransferEffect[] {
  for (const map of isSeq(node) ? (node.items as YamlNode[]) : [node]) {
    if (!isMap(map)) continue;
    for (const key of ['from', 'to'])
      if (tryGetScalar(map, key, context) === 'actor')
        throw new YamlLoadError(
          `${context}.${key}: passivesの対象に'actor'は使えません（持続的な関係に紐づかないため）。`,
        );
  }
  return parseTransfers(loader, context, node, false, false);
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

/** move（1つ、またはその配列）。同じ一手で2つ動かす（乗り込んでから漕ぎ出す）ために並べられる。 */
function parseMoves(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  selfOnly: boolean,
): MoveEffect[] {
  if (isMap(node)) return [parseMove(loader, context, node, selfOnly)];

  if (isSeq(node)) {
    const items = node.items as YamlNode[];
    return items.map((item, i) => {
      if (!isMap(item)) throw new YamlLoadError(`${context}[${i}]: 各要素はmappingである必要があります。`);
      return parseMove(loader, `${context}[${i}]`, item, selfOnly);
    });
  }

  throw new YamlLoadError(`${context}: mappingかmappingの配列である必要があります。`);
}

/**
 * move（subjectのオブジェクトを、移動先の中へ移動する。MoveEffect参照）。
 * transferと同じフラットフィールド規約（`move: {subject: actor, to_prop: destination_id}`）。
 *
 * 動かす物も行き先も「対象キーか、インスタンスIDを持つプロパティか、型か」の三択（ObjectRef）で、
 * subjectは`subject`/`subject_prop`、移動先は`to`/`to_prop`/`to_object`の**どれか1つ**で指す
 * （複数・どれも無しはエラー）。`to_slot`は行き先の中のどの枠へ入れるかで、省けば宣言順で最初に
 * 受け入れた枠になる。
 *
 * selfOnly文脈（rangeイベント）で禁じるのは**actor/draggedを指す形だけ**。そこに実行者が居ないのは
 * 対象キーの解決先が無いという理由なので、`self`と型で書いた移動（本土への到達、Voyage.md 4節）は
 * 同じ理由に当たらない。
 */
function parseMove(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  selfOnly: boolean,
): MoveEffect {
  requireKnownKeys(map, MOVE_KEYS, context);

  const subject = parseMoveSubject(loader, context, map);
  const destination = parseMoveDestination(loader, context, map);
  if (selfOnly && (subject.needsInteraction() || destination.needsInteraction()))
    throw new YamlLoadError(
      `${context}: on_max/on_minのmoveでは、actor・draggedを指せません（存在しないため）。`,
    );

  const slotName = tryGetScalar(map, 'to_slot', context);
  return new MoveEffect(
    subject,
    destination,
    slotName === undefined ? undefined : loader.slotNames.intern(slotName),
  );
}

/** moveが持てるキー。これ以外はロードエラー（綴り間違いをその場で捕まえる）。 */
const MOVE_KEYS = new Set(['subject', 'subject_prop', 'to', 'to_prop', 'to_object', 'to_slot']);

/**
 * moveの動かす物（subject か subject_prop のどちらか一方）。
 *
 * 対象キーは`self`（moveを宣言したオブジェクト自身）・`actor`（アクション実行者）・`dragged`
 * （combinationsでドラッグされてきたカード）のみ対応する。`parent`/`ancestor`/`child`は
 * 「一度きりの命令に対してどれを動かすか」の意味論が未確定のため未対応。
 */
function parseMoveSubject(loader: WorldCodexYamlLoader, context: string, map: YAMLMap): ObjectRef {
  const subject = tryGetScalar(map, 'subject', context);
  const subjectProp = tryGetScalar(map, 'subject_prop', context);

  if ((subject === undefined) === (subjectProp === undefined))
    throw new YamlLoadError(
      `${context}: moveの動かす物はsubjectかsubject_propのどちらか一方で指定してください。`,
    );

  if (subjectProp !== undefined) return ObjectRef.ofProperty(loader.propertyNames.intern(subjectProp));

  if (subject !== 'self' && subject !== 'actor' && subject !== 'dragged')
    throw new YamlLoadError(
      `${context}: moveのsubjectは'self'/'actor'/'dragged'のみ対応しています（値: '${subject}'）。`,
    );
  return ObjectRef.ofRoot(subject);
}

/**
 * moveの移動先（to / to_prop / to_object のどれか1つ）。
 *
 * `to_object`は、世界にただ1つ在る型（`singleton`、15節）をその名前で指す。生成時に確定する個体を
 * 指すto_propと違い、**定義の時点で名前の分かっている行き先**（外洋・本土）のためのもの。
 */
function parseMoveDestination(loader: WorldCodexYamlLoader, context: string, map: YAMLMap): ObjectRef {
  const to = tryGetScalar(map, 'to', context);
  const toProp = tryGetScalar(map, 'to_prop', context);
  const toObject = tryGetScalar(map, 'to_object', context);

  const given = [to, toProp, toObject].filter((value) => value !== undefined);
  if (given.length !== 1)
    throw new YamlLoadError(
      `${context}: moveの移動先はto・to_prop・to_objectのどれか1つで指定してください。`,
    );

  if (toProp !== undefined) return ObjectRef.ofProperty(loader.propertyNames.intern(toProp));
  if (toObject !== undefined) return ObjectRef.ofObjectDef(loader.objectNames.intern(toObject));

  if (to !== 'self' && to !== 'parent')
    throw new YamlLoadError(`${context}: moveのtoは'self'か'parent'のみ対応しています（値: '${to}'）。`);
  return ObjectRef.ofRoot(to);
}

/**
 * activeの対象キー（self/parent/ancestor/actor、combinations内はdraggedも）を解決する。
 * childは「どの子か」を一意に絞る規約が無いため未対応。selfOnly（rangeイベント）は
 * self以外を一律エラーにする。
 */
function parseActiveTargetRoot(
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
    const target = parseObjectTargetRoot(context, targetName, allowDragged, selfOnly);
    return new SignalEffect(asScalarText(nameNode, `${context}.'${targetName}'`), target);
  });
}

/** destroy（削除対象の直接指定）を読む。単一の対象か対象のリストを許容する。 */
function parseDestroyTargets(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  allowDragged: boolean,
  selfOnly: boolean,
): ObjectRef[] {
  if (isSeq(node))
    return (node.items as YamlNode[]).map((n) => parseObjectRef(loader, context, n, allowDragged, selfOnly));

  return [parseObjectRef(loader, context, node, allowDragged, selfOnly)];
}

/**
 * オブジェクトそのものを1つ指す参照（ObjectRef）を読む。対象キー（`self`）か、インスタンスIDを
 * 持つプロパティ（`{prop: smash_target}`）のいずれか。
 *
 * ancestorはプロパティ名が無いと解決先が決まらないため、オブジェクトを指す文脈では使えない。
 */
function parseObjectRef(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  allowDragged: boolean,
  selfOnly: boolean,
): ObjectRef {
  if (!isMap(node))
    return ObjectRef.ofRoot(
      parseObjectTargetRoot(context, asScalarText(node, context), allowDragged, selfOnly),
    );

  const propName = requireScalar(node, 'prop', context);
  requireKnownKeys(node, ['prop'], context);

  return ObjectRef.ofProperty(loader.propertyNames.intern(propName));
}

/**
 * become（9.9節）を読む。`subject`以外のキーはすべて**動かす軸とその値**で、軸の名前は生成器が
 * 決めるためエンジン側の語彙には無い（3.5節）。だからここは名前を検証せず、識別子としてそのまま持つ
 * ——存在しない座標を指した宣言は、ロード時ではなく実行時に「そこへは変われない」として現れる。
 */
function parseBecome(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YAMLMap,
  allowDragged: boolean,
  selfOnly: boolean,
): BecomeEffect {
  let subject: ObjectRef | undefined;
  const axisValues = new Map<string, string>();

  for (const [key, valueNode] of entriesInOrder(node)) {
    if (key === 'subject') {
      subject = parseObjectRef(loader, `${context}.subject`, valueNode, allowDragged, selfOnly);
      continue;
    }
    axisValues.set(key, asScalarText(valueNode, `${context}.${key}`));
  }

  if (axisValues.size === 0)
    throw new YamlLoadError(`${context}: 動かす軸を1つ以上書いてください（例: 'content: water_liquid'）。`);

  return new BecomeEffect(subject ?? ObjectRef.ofRoot('self'), axisValues);
}

/**
 * オブジェクトそのものを指す対象（destroy・signal）。ancestorはプロパティ名が無いと解決先が
 * 決まらないため、ここでは使えない。
 */
function parseObjectTargetRoot(
  context: string,
  key: string,
  allowDragged: boolean,
  selfOnly: boolean,
): ReferenceRoot {
  const root = parseActiveTargetRoot(context, key, allowDragged, selfOnly);
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
