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
import { withYamlContext, parseNumberLiteral, parseNumberOrSymbol, parseTypeMatchRule } from './parseCommon';
import { parseSubjectRoot, requireResolvable } from './parseConditions';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { ReferenceRoot } from '../domain/ReferenceRoot';
import { ReferenceScope } from '../domain/ReferenceRoot';
import { PropertyPath } from '../domain/ReferenceRoot';
import {
  ActiveEffectSequence,
  AddEffect,
  DestroyEffect,
  SetEffect,
  SpawnEffect,
  TransferEffect,
} from '../domain/ActiveEffect';
import type { ActiveEffect, SpawnTarget } from '../domain/ActiveEffect';
import { BecomeEffect } from '../domain/BecomeEffect';
import { MoveEffect } from '../domain/MoveEffect';
import { ObjectRef } from '../domain/ObjectRef';
import { AmongSpec } from '../domain/AmongSpec';
import { PickCandidateDef, PickEffect } from '../domain/PickEffect';
import { DeclaredNumber } from '../domain/DeclaredNumber';
import { SignalEffect } from '../domain/SignalEffect';

/**
 * 効果の中身（9節の命令と、10節の`pick`）を読む。文法は「操作が上位、対象が下位」（9.1節。例:
 * `add: {self: {hour: 1}}`）で、**対象に何を書けるかはその宣言が置かれた場所が決める**
 * （parseActiveTargetRoot。書ける対象の一覧はGameElementDefinition.md 14.1節の表、操作の関係の役は
 * 11.5節「役を書ける場所」）。spawnは常にselfが実行するものとみなすため対象キーを持たない。
 * signalは対象を省ける（`signal: missed`＝selfへ告げる、9.8節）。
 *
 * **適用順はYAMLに書かれた順**で、動詞ごとの優先順位は無い（9.7節）。bodyNodeには効果以外の兄弟キーも
 * 同居しうるため、reservedKeysに「呼び出し側がすでに読み終えている兄弟キー」を渡して未知キー判定から
 * 除外する。
 */
export function parseActiveEffectBody(
  loader: WorldCodexYamlLoader,
  context: string,
  bodyNode: YAMLMap,
  scope: ReferenceScope,
  reservedKeys?: ReadonlyArray<string>,
): ActiveEffectSequence {
  const operations: ActiveEffect[] = [];
  const unknownKeys: string[] = [];

  for (const [key, valueNode] of entriesInOrder(bodyNode)) {
    const keyContext = `${context}.${key}`;
    switch (key) {
      case 'set':
        operations.push(...parseSets(loader, keyContext, asMap(valueNode, keyContext), scope));
        break;
      case 'add':
        operations.push(...parseAdds(loader, keyContext, asMap(valueNode, keyContext), scope));
        break;
      case 'transfer':
        operations.push(...parseTransfers(loader, keyContext, valueNode, scope));
        break;
      case 'move':
        operations.push(...parseMoves(loader, keyContext, valueNode, scope));
        break;
      case 'destroy':
        operations.push(...parseDestroys(loader, keyContext, valueNode, scope));
        break;
      case 'spawn':
        operations.push(...parseSpawns(loader, keyContext, valueNode, scope));
        break;
      case 'become':
        operations.push(parseBecome(loader, keyContext, asMap(valueNode, keyContext), scope));
        break;
      case 'signal':
        operations.push(...parseSignals(keyContext, valueNode, scope));
        break;
      case 'pick':
        operations.push(new PickEffect(parsePickList(loader, context, asSeq(valueNode, keyContext), scope)));
        break;
      default:
        if (reservedKeys === undefined || !reservedKeys.includes(key)) unknownKeys.push(key);
    }
  }

  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  return new ActiveEffectSequence(operations);
}

/** pick候補が持つ、効果以外の兄弟キー。 */
const PICK_CANDIDATE_RESERVED_KEYS = ['weight', 'among'] as const;

/** pick（10節）の候補リストを読む。候補の中身は9節の命令と同じで、さらにpickを入れ子にできる。 */
function parsePickList(
  loader: WorldCodexYamlLoader,
  context: string,
  pickNode: YAMLSeq,
  scope: ReferenceScope,
): PickCandidateDef[] {
  const result: PickCandidateDef[] = [];

  for (const node of pickNode.items as YamlNode[]) {
    const map = asMap(node, context);
    const candidateContext = `${context}.pick[${result.length}]`;

    const weightNode = tryGetNode(map, 'weight');
    if (weightNode === undefined) throw new YamlLoadError(`${candidateContext}: 'weight'は必須です。`);
    const weight = parseDeclaredNumber(loader, candidateContext, weightNode, scope, 'weight');

    // amongを書いた候補の中だけがpickedを指せる（10.3節）。重みも効果も同じ場所として読む。
    const amongNode = tryGetMap(map, 'among', candidateContext);
    const among =
      amongNode === undefined ? undefined : parseAmong(loader, candidateContext, amongNode, scope);
    const bodyScope = among === undefined ? scope : scope.withPicked;

    // weightだけの候補は「選ばれても何も起きない回」（外した回・寄って来なかった回）を表す。
    const effect = parseActiveEffectBody(
      loader,
      candidateContext,
      map,
      bodyScope,
      PICK_CANDIDATE_RESERVED_KEYS,
    );

    result.push(new PickCandidateDef(weight, effect, among));
  }

  return result;
}

/** `among`が持てるキー。 */
const AMONG_KEYS = ['subject', 'slot', 'matches', 'weight'] as const;

/**
 * `among: {subject, slot, matches, weight}`（10.3節）を読む。集合の指し方は条件の
 * `{subject, slot, matches}`（14.4節）と同じで、足しているのは候補ごとの重みだけ。
 *
 * **重みの参照は候補自身を指す**ので `{subject: picked, prop: ...}` と書く——`subject`の既定が
 * `self`である規則はここでも変えない。
 */
function parseAmong(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YAMLMap,
  scope: ReferenceScope,
): AmongSpec {
  const amongContext = `${context}.among`;
  requireKnownKeys(node, AMONG_KEYS, amongContext);

  const subjectName = tryGetScalar(node, 'subject', amongContext);
  const root =
    subjectName === undefined
      ? 'self'
      : parseSubjectRoot(amongContext, subjectName, scope.withoutPropertyName);

  const slotName = tryGetScalar(node, 'slot', amongContext);
  if (slotName === undefined) throw new YamlLoadError(`${amongContext}: 'slot'は必須です。`);

  const matchNode = tryGetMap(node, 'matches', amongContext);
  const match =
    matchNode === undefined ? undefined : parseTypeMatchRule(loader, `${amongContext}.matches`, matchNode);

  const weightNode = tryGetNode(node, 'weight');
  const weight =
    weightNode === undefined
      ? undefined
      : parseDeclaredNumber(loader, amongContext, weightNode, scope.withPicked, 'weight');

  return new AmongSpec(root, loader.slotNames.intern(slotName), match, weight);
}

/**
 * リテラル数値か`{subject, prop}`参照、またはその参照2つの積（GameElementDefinition.md 10.2節）を読む。
 * pickのweightもdurationもこの形で、「今の状態から見ていくらか」を書けるようにするため（切れ味の
 * 悪い刃物ほど時間がかかる、荷が重いほど道は遠い）。何を表す数値かは持ち主が決める（DeclaredNumber）。
 *
 * `fieldName`はエラー文が名乗るYAMLのキー名。**常に呼び出し側が言う**——既定を持たせると、
 * この読み手が最初に読んだキーの名前が、他のキーを読むときにも既定として残る。
 */
export function parseDeclaredNumber(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  scope: ReferenceScope,
  fieldName: string,
): DeclaredNumber {
  if (isScalar(node)) {
    const raw = asScalarText(node, context);
    const literal = Number(raw);
    if (raw.trim() === '' || Number.isNaN(literal))
      throw new YamlLoadError(`${context}: ${fieldName}は数値である必要があります（値: '${raw}'）。`);
    return DeclaredNumber.ofLiteral(literal);
  }

  if (isMap(node)) {
    requireKnownKeys(node, ['subject', 'prop', 'times'], context);
    const path = parsePropertyRef(loader, context, node, scope);

    // times: 掛ける相手（10.2節）。**参照しか書けない形**——リテラルはスカラーで書く綴りなので、
    // ここがマップである限り「参照2つの積」から外れようがない。
    const timesNode = tryGetNode(node, 'times');
    if (timesNode === undefined) return DeclaredNumber.ofPath(path);
    if (!isMap(timesNode))
      throw new YamlLoadError(
        `${context}: ${fieldName}の'times'は{subject, prop}参照である必要があります（積を取れるのは参照2つだけです）。`,
      );

    const timesContext = `${context}.times`;
    requireKnownKeys(timesNode, ['subject', 'prop'], timesContext);
    return DeclaredNumber.ofProduct(path, parsePropertyRef(loader, timesContext, timesNode, scope));
  }

  throw new YamlLoadError(
    `${context}: ${fieldName}はリテラル数値か{subject, prop}のいずれかである必要があります。`,
  );
}

/** `{subject, prop}`（10.2節）の1つ分。`subject`を省けば`self`。 */
function parsePropertyRef(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YAMLMap,
  scope: ReferenceScope,
): PropertyPath {
  const subjectName = tryGetScalar(node, 'subject', context);
  const root = subjectName !== undefined ? parseSubjectRoot(context, subjectName, scope) : 'self';
  return new PropertyPath(root, loader.propertyNames.intern(requireScalar(node, 'prop', context)));
}

/**
 * setの1エントリの値（9.2節）。スカラーはリテラル（数値・真偽値・シンボル名）、`{subject: ...}`は
 * **その対象キーが名指す個体**で、書き込まれるのはその個体のインスタンスID。
 *
 * 参照をマップの形に限るのは、値の位置ではスカラーが既にリテラルの綴りだから——`parent`と書けた
 * ところで、それがシンボル名なのか親そのものなのかを読む側が決められない。
 *
 * **`prop`は書けない。** 他のプロパティの実効値を値として読む形が無いのは9.2節の規則そのままで、
 * 値の算出をYAMLへ持ち込まないため。ここで書けるのは「今この場が名指せる相手」だけ。
 */
function parseSetEffect(
  loader: WorldCodexYamlLoader,
  context: string,
  target: ReferenceRoot,
  propertyGlobalId: number,
  valueNode: YamlNode,
  scope: ReferenceScope,
): SetEffect {
  const path = new PropertyPath(target, propertyGlobalId);
  if (isMap(valueNode)) {
    requireKnownKeys(valueNode, ['subject'], context);
    const subjectName = requireScalar(valueNode, 'subject', context);
    return new SetEffect(path, ObjectRef.ofRoot(parseObjectTargetRoot(context, subjectName, scope)));
  }

  const [value] = parseNumberOrSymbol(loader, context, asScalarText(valueNode, context));
  return new SetEffect(path, value);
}

/**
 * transfer（9.5節）。from/toの参照はフラットな2フィールド（from/from_prop, to/to_prop）で表し、
 * from/toは省略時self。対象ルートに何を書けるかは、受け取ったscopeが決める
 * （parseActiveTargetRoot）。linked_add（省略可）はaddと同じ構造で、
 * 実際の移動量に比例してスケールされる副効果。to_amount（省略可）は、移送元と移送先で単位が違うときに
 * 「amount分を出すと移送先がどれだけ増えるか」を持つ。
 */
function parseTransfer(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
): TransferEffect {
  const fromRaw = tryGetScalar(map, 'from', context);
  const fromObject = fromRaw !== undefined ? parseActiveTargetRoot(context, fromRaw, scope) : 'self';
  const fromProp = loader.propertyNames.intern(requireScalar(map, 'from_prop', context));

  const toRaw = tryGetScalar(map, 'to', context);
  const toObject = toRaw !== undefined ? parseActiveTargetRoot(context, toRaw, scope) : 'self';
  const toProp = loader.propertyNames.intern(requireScalar(map, 'to_prop', context));

  const amount = requireNumber(map, 'amount', context);
  // 単位が同じなら省略できる（1対1）。0では移送先が増えないうえ割り戻しが割れないため弾く。
  const toAmount = tryGetNumber(map, 'to_amount', context) ?? amount;
  const allowOverflow = tryGetBool(map, 'allow_overflow', context) ?? false;

  const linkedAddMap = tryGetMap(map, 'linked_add', context);
  const linkedAdd =
    linkedAddMap !== undefined ? parseAdds(loader, `${context}.linked_add`, linkedAddMap, scope) : [];

  requireKnownKeys(
    map,
    ['from', 'from_prop', 'to', 'to_prop', 'amount', 'to_amount', 'allow_overflow', 'linked_add'],
    context,
  );

  return withYamlContext(
    context,
    () =>
      new TransferEffect(
        new PropertyPath(fromObject, fromProp),
        new PropertyPath(toObject, toProp),
        amount,
        allowOverflow,
        linkedAdd,
        toAmount,
      ),
  );
}

/** setを「対象付きの1操作(SetEffect)」の宣言順フラットリストへ読む。 */
function parseSets(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
): SetEffect[] {
  const sets: SetEffect[] = [];
  for (const [targetName, targetBody] of entriesInOrder(map)) {
    const target = parseActiveTargetRoot(context, targetName, scope);
    for (const [propName, valueNode] of entriesInOrder(asMap(targetBody, `${context}.'${targetName}'`)))
      sets.push(
        parseSetEffect(
          loader,
          `${context}.'${targetName}'.'${propName}'`,
          target,
          loader.propertyNames.intern(propName),
          valueNode,
          scope,
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
  scope: ReferenceScope,
): AddEffect[] {
  const adds: AddEffect[] = [];
  for (const [targetName, targetBody] of entriesInOrder(map)) {
    const target = parseActiveTargetRoot(context, targetName, scope);
    for (const [propName, amountNode] of entriesInOrder(asMap(targetBody, `${context}.'${targetName}'`)))
      adds.push(
        new AddEffect(
          new PropertyPath(target, loader.propertyNames.intern(propName)),
          parseNumberLiteral(context, asScalarText(amountNode, context)),
        ),
      );
  }

  return adds;
}

/** spawn（9.4節）の1エントリが持てるキー。これ以外はロードエラー（綴り間違いをその場で捕まえる）。 */
const SPAWN_KEYS = new Set(['object', 'into', 'into_prop', 'into_object', 'count']);

function parseSpawns(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  scope: ReferenceScope,
): SpawnEffect[] {
  return oneOrMany(context, node, (itemContext, map) => parseSpawn(loader, itemContext, map, scope));
}

function parseSpawn(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
): SpawnEffect {
  requireKnownKeys(map, SPAWN_KEYS, context);

  const count = tryGetNumber(map, 'count', context) ?? 1;

  return withYamlContext(
    context,
    () =>
      new SpawnEffect(
        loader.objectNames.intern(requireScalar(map, 'object', context)),
        parseSpawnTarget(loader, context, map, scope),
        count,
      ),
  );
}

/**
 * spawnの配置先（9.4節）。**個体を指す形は`move`の移動先と同じ三択**（parseDestinationRef）で、
 * `into`だけが個体ではないものも名乗れる——`same_slot`（selfが今占めている位置）と`child`
 * （selfの子を順に走査する）。どれも書かなければ`same_slot`。
 *
 * 書ける相手も`move`の移動先と同じく、周囲のscopeが用意できるものだけ（9.4節）。
 */
function parseSpawnTarget(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
): SpawnTarget {
  const intoNode = tryGetNode(map, 'into');
  if (intoNode !== undefined && isScalar(intoNode)) {
    const raw = asScalarText(intoNode, context);
    if (raw === 'same_slot' || raw === 'child') return raw;
  }

  return parseDestinationRef(loader, context, map, scope, 'into') ?? 'same_slot';
}

/**
 * passivesの中の transfer（8.4節）。文法はactiveのものと同一で、違うのは渡すscopeだけ
 * （ReferenceScope.declaration。どの起点を書けるかはそれが決める）。操作の関係の役は仕様のうえでは
 * ここへ書けるが（11.5節「役を書ける場所」）、その【未実装: 操作の関係】が外れるまで解決先を持たない。
 */
export function parsePassiveTransfers(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
): TransferEffect[] {
  return parseTransfers(loader, context, node, ReferenceScope.declaration);
}

function parseTransfers(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  scope: ReferenceScope,
): TransferEffect[] {
  return oneOrMany(context, node, (itemContext, map) => parseTransfer(loader, itemContext, map, scope));
}

/** move（1つ、またはその配列）。同じ一手で2つ動かす（乗り込んでから漕ぎ出す）ために並べられる。 */
function parseMoves(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  scope: ReferenceScope,
): MoveEffect[] {
  return oneOrMany(context, node, (itemContext, map) => parseMove(loader, itemContext, map, scope));
}

/**
 * 「1つ、またはその配列」で書ける宣言を読む（spawn・transfer・move）。**どちらで書いても同じ**なので、
 * 1件だけのときに配列を強いない。要素ごとのcontextには添字が付く。
 */
function oneOrMany<T>(context: string, node: YamlNode, parseOne: (context: string, map: YAMLMap) => T): T[] {
  if (isMap(node)) return [parseOne(context, node)];
  if (!isSeq(node)) throw new YamlLoadError(`${context}: mappingかmappingの配列である必要があります。`);

  return (node.items as YamlNode[]).map((item, index) => {
    if (!isMap(item)) throw new YamlLoadError(`${context}[${index}]: 各要素はmappingである必要があります。`);
    return parseOne(`${context}[${index}]`, item);
  });
}

/**
 * move（subjectのオブジェクトを、移動先の中へ移動する。MoveEffect参照）。
 * transferと同じフラットフィールド規約（`move: {subject: agent, to_prop: destination_id}`）。
 *
 * 動かす物も行き先も「対象キーか、インスタンスIDを持つプロパティか、型か」の三択（ObjectRef）で、
 * subjectは`subject`/`subject_prop`、移動先は`to`/`to_prop`/`to_object`の**どれか1つ**で指す
 * （複数・どれも無しはエラー）。移動先の三択は`spawn`の配置先と同じ読み手（parseDestinationRef）。
 * `to_slot`は行き先の中のどの枠へ入れるかで、省けば宣言順で最初に受け入れた枠になる。
 *
 * **その場所で禁じられるのは、解決先を持たない対象キーを指す形だけ**（どれがそうかはscopeが答える。
 * ReferenceScope）。型で書いた移動先（本土への到達、Voyage.md 4節）は対象キーではないので、
 * 操作者の居ない場所（rangeイベント）でも同じ理由には当たらない。
 */
function parseMove(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
): MoveEffect {
  requireKnownKeys(map, MOVE_KEYS, context);

  const subject = parseMoveSubject(loader, context, map, scope);
  const destination = parseMoveDestination(loader, context, map, scope);

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
 * `subject`はオブジェクトそのものを指すので、解決先を持つrootはその宣言が置かれた場所が決める
 * （ReferenceScope）。**動かす相手は1つに決まる必要がある**ので、childはどの場所でも指せない。
 * `{subject: picked, prop: ...}`の形で、他の個体が持つインスタンスIDも指せる（ObjectRef）。
 */
function parseMoveSubject(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
): ObjectRef {
  const subjectNode = tryGetNode(map, 'subject');
  const subjectProp = tryGetScalar(map, 'subject_prop', context);

  if ((subjectNode === undefined) === (subjectProp === undefined))
    throw new YamlLoadError(
      `${context}: moveの動かす物はsubjectかsubject_propのどちらか一方で指定してください。`,
    );

  if (subjectProp !== undefined)
    return ObjectRef.ofProperty(new PropertyPath('self', loader.propertyNames.intern(subjectProp)));

  return parseObjectRef(loader, `${context}.subject`, subjectNode!, scope);
}

/** moveの移動先（to / to_prop / to_object のどれか1つ、parseDestinationRef）。省略はできない。 */
function parseMoveDestination(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
): ObjectRef {
  const destination = parseDestinationRef(loader, context, map, scope, 'to');
  if (destination === undefined)
    throw new YamlLoadError(
      `${context}: moveの移動先はto・to_prop・to_objectのどれか1つで指定してください。`,
    );

  return destination;
}

/** activeの対象キー。解決先を持つrootかどうかは、その宣言が置かれた場所が決める（ReferenceScope）。 */
function parseActiveTargetRoot(context: string, key: string, scope: ReferenceScope): ReferenceRoot {
  switch (key) {
    case 'self':
    case 'parent':
    case 'ancestor':
    case 'agent':
    case 'instrument':
    case 'picked':
    case 'child':
      return requireResolvable(context, key, scope);
    default:
      throw new YamlLoadError(`${context}: 未知の対象キー '${key}' です。`);
  }
}

/**
 * signal（9.8節）を読む。対象を省いた `signal: missed`（selfへ告げる）と、他の命令と同じ
 * 「操作が上位、対象が下位」の `signal: {instrument: missed}` の2つの形を許容する。
 *
 * 省略形を持つのは、告げる相手が効果を宣言した側そのものである場合が大半だから（動物のカードへ
 * 武器を重ねる、9.8節）。対象を書くのは、宣言した側と起きた側が違うときだけになる。
 */
function parseSignals(context: string, node: YamlNode, scope: ReferenceScope): SignalEffect[] {
  if (isSeq(node))
    throw new YamlLoadError(`${context}: 出来事の識別子か、対象ごとの識別子である必要があります。`);

  if (!isMap(node)) return [new SignalEffect(asScalarText(node, context), 'self')];

  return entriesInOrder(node).map(([targetName, nameNode]) => {
    const target = parseObjectTargetRoot(context, targetName, scope);
    return new SignalEffect(asScalarText(nameNode, `${context}.'${targetName}'`), target);
  });
}

/** destroy（削除対象の直接指定、9.3節）を読む。単一の対象か対象のリストを許容する。 */
function parseDestroys(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  scope: ReferenceScope,
): DestroyEffect[] {
  if (isSeq(node)) return (node.items as YamlNode[]).map((n) => parseDestroy(loader, context, n, scope));

  return [parseDestroy(loader, context, node, scope)];
}

/**
 * destroyの対象1つ（9.3節）。指し方は他の命令と同じ（parseObjectRef）で、足しているのは`reason`
 * だけ——この消滅が名乗る名前で、消された側に残る（WorldObject.destroyedReason）。書かなければ
 * 何も残らないので、その消滅は死因として読まれない。
 */
function parseDestroy(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  scope: ReferenceScope,
): DestroyEffect {
  const reason = isMap(node) ? tryGetScalar(node, 'reason', context) : undefined;
  return new DestroyEffect(parseObjectRef(loader, context, node, scope, ['reason']), reason);
}

/**
 * オブジェクトそのものを1つ指す参照（ObjectRef）を読む。**ここを通るのは`{subject, prop}`の形まで
 * 許す口**で、対象キーしか取らない口はparseObjectTargetRootを直に呼ぶ。
 *
 * 対象キー（`self`）か、`{subject, prop}`のマップ——`prop`を書けばその実効値がインスタンスIDとして
 * 指す相手、書かなければ`subject`（省略時はself）そのもの。reservedKeysは、呼び出し側が別に読む
 * 兄弟キー（`destroy`の`reason`）を未知キー判定から外すためのもの。
 *
 * ancestorはプロパティ名が無いと解決先が決まらないため、`prop`を伴わない形では使えない。
 *
 * **中身が空のマップは弾く。** `subject`の既定がselfなので`{}`も動いてしまうが、それは何も書かずに
 * `self`を得る抜け道で、書く理由が無い（policies.md「宣言漏れの扱い」）。
 */
function parseObjectRef(
  loader: WorldCodexYamlLoader,
  context: string,
  node: YamlNode,
  scope: ReferenceScope,
  reservedKeys: readonly string[] = [],
): ObjectRef {
  if (!isMap(node))
    return ObjectRef.ofRoot(parseObjectTargetRoot(context, asScalarText(node, context), scope));

  if (node.items.length === 0)
    throw new YamlLoadError(
      `${context}: マップが空です。指す相手（'subject'か'prop'）を書いてください（相手がself自身なら 'self'）。`,
    );

  requireKnownKeys(node, ['subject', 'prop', ...reservedKeys], context);
  const subjectName = tryGetScalar(node, 'subject', context);
  const propName = tryGetScalar(node, 'prop', context);

  if (propName === undefined)
    return ObjectRef.ofRoot(parseObjectTargetRoot(context, subjectName ?? 'self', scope));

  const root = subjectName === undefined ? 'self' : parseSubjectRoot(context, subjectName, scope);
  return ObjectRef.ofProperty(new PropertyPath(root, loader.propertyNames.intern(propName)));
}

/**
 * 行き先を三択（`X` / `X_prop` / `X_object`）で読む。**`move`の移動先と`spawn`の配置先が共有する**
 * ——どちらも「1つの個体をどう指すか」だけの話で、違うのはキーの綴りだけ（9.4節・9.6節）。
 *
 * - `X`: その場所が用意できる相手（対象キーか`{subject, prop}`、parseObjectRef）。
 * - `X_prop`: `self`が持つプロパティ名。その実効値をインスタンスIDとして解釈する。
 * - `X_object`: 行き先の型。**スカラーなら`object_defs`の識別子そのもの、マップ（`{prop: ...}`）なら
 *   型を値に持つ`self`のプロパティ**（6.9節）で、探し方はどちらも同じ（世界にただ1つ在る型を探す、
 *   15節）。リテラルと参照の見分けがスカラーかマップかなのは`set`の値（9.2節）と同じ規約。
 *   **どちらの書き方も、正しく型を指せているかの検査はWorldCodexが受ける**（相手の宣言を読み終えるまで
 *   分からないため）——識別子ならsingletonか、プロパティなら型を値に持つと宣言されているか。
 *
 * どれも書かれていなければundefined（省略を許すかは呼び出し側が決める）。2つ以上はロード時エラー。
 */
function parseDestinationRef(
  loader: WorldCodexYamlLoader,
  context: string,
  map: YAMLMap,
  scope: ReferenceScope,
  prefix: string,
): ObjectRef | undefined {
  const refNode = tryGetNode(map, prefix);
  const propName = tryGetScalar(map, `${prefix}_prop`, context);
  const objectNode = tryGetNode(map, `${prefix}_object`);

  const given = [refNode, propName, objectNode].filter((value) => value !== undefined);
  if (given.length > 1)
    throw new YamlLoadError(
      `${context}: ${prefix}・${prefix}_prop・${prefix}_objectのどれか1つで指定してください。`,
    );
  if (given.length === 0) return undefined;

  if (propName !== undefined)
    return ObjectRef.ofProperty(new PropertyPath('self', loader.propertyNames.intern(propName)));
  if (objectNode !== undefined) return parseObjectDefRef(loader, `${context}.${prefix}_object`, objectNode);

  return parseObjectRef(loader, `${context}.${prefix}`, refNode!, scope);
}

/**
 * 行き先の型（`to_object`/`into_object`）。スカラーは`object_defs`の識別子、`{prop: ...}`は
 * 型を値に持つ`self`のプロパティ（6.9節）。
 */
function parseObjectDefRef(loader: WorldCodexYamlLoader, context: string, node: YamlNode): ObjectRef {
  if (isMap(node)) {
    requireKnownKeys(node, ['prop'], context);
    const propertyGlobalId = loader.propertyNames.intern(requireScalar(node, 'prop', context));
    loader.noteObjectDefPropertyDestination(propertyGlobalId, context);
    return ObjectRef.ofObjectDefProperty(propertyGlobalId);
  }

  const objectGlobalId = loader.objectNames.intern(asScalarText(node, context));
  loader.noteObjectDefDestination(objectGlobalId, context);
  return ObjectRef.ofObjectDef(objectGlobalId);
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
  scope: ReferenceScope,
): BecomeEffect {
  let subject: ObjectRef | undefined;
  const axisValues = new Map<string, string>();

  for (const [key, valueNode] of entriesInOrder(node)) {
    if (key === 'subject') {
      subject = parseObjectRef(loader, `${context}.subject`, valueNode, scope);
      continue;
    }
    axisValues.set(key, asScalarText(valueNode, `${context}.${key}`));
  }

  if (axisValues.size === 0)
    throw new YamlLoadError(`${context}: 動かす軸を1つ以上書いてください（例: 'content: water_liquid'）。`);

  return new BecomeEffect(subject ?? ObjectRef.ofRoot('self'), axisValues);
}

/** プロパティ名を伴わず、オブジェクトそのものを指す対象。何を書けるかはその場所が決める（ReferenceScope）。 */
function parseObjectTargetRoot(context: string, key: string, scope: ReferenceScope): ReferenceRoot {
  return parseActiveTargetRoot(context, key, scope.withoutPropertyName);
}
