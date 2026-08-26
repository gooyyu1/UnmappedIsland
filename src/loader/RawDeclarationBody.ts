import { Scalar, YAMLMap, YAMLSeq, isSeq } from 'yaml';
import type { YamlNode } from './yamlMapping';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireKnownKeys,
  tryGetBool,
  tryGetMap,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';

/**
 * 宣言一式そのものが読むキー。`covers`/`layer`はローダーが解釈しないが文法として文書化済みなので、
 * 未知キーにはしない（RawObjectDef.resolve参照）。
 */
const KNOWN_BODY_KEYS = [
  'tags',
  'props',
  'slots',
  'passives',
  'stack_order',
  'visible_slots',
  'storage',
  'art_by_stage',
  'bound_to_owner',
  'resists',
  'stackable',
  'interactions',
  'covers',
  'layer',
];

/**
 * trait が宣言一式に足して読むキー。`recipes`はtraitには書けないが、ここで未知キーとして弾くと
 * どこへ書けばよいかを言えないので、通したうえでRawTraitが弾く。
 */
const TRAIT_OWN_KEYS = ['recipes'];

/**
 * object_def と trait が共有する「**混ぜ込める宣言一式**」（GameElementDefinition.md 5節）。
 * trait はこれだけのもので、object_def はこれに素性（globalId・traits・recipes・variation_axes）を
 * 足したもの。
 *
 * trait 合成がまだ起こりうるフィールドは、意味解釈済みの型にせず生YAMLノードのまま持つ。
 * **いつ読み直すかは持ち主が決める**——object_def は patch（3.4節）のたびに読み直し、trait は一度きり。
 */
export class RawDeclarationBody {
  tags: string[] = [];
  props: YAMLMap | undefined;
  slots: YAMLMap | undefined;

  /** 読んだ時点でmappingとして確かめてある（どの宣言に書かれていたかは、その時点でしか分からない）。 */
  passives: readonly YAMLMap[] = [];

  stackOrder: YAMLMap | undefined;

  /** visible_slots（7.11節）で並べられたスロット名。未指定なら空。 */
  visibleSlots: readonly string[] = [];

  /** storage（7.12節）。物を溜める入れ物として使う型か。tagsと同じくORで合成する。 */
  isStorage = false;

  /** art_by_stage（6.4節）で指定されたプロパティ名。未指定ならundefined。 */
  artByStage: string | undefined;

  /** bound_to_owner（7.9節）。単独では存在できない型か。 */
  boundToOwner = false;

  /**
   * resists（7.13節）。成立している間、土地以外の親へ移れなくなる条件の並び。宣言が無ければundefined。
   * 条件の意味解釈はマージ後に行うので、ここでは生YAMLノードのまま持つ。
   */
  resists: YAMLSeq | undefined;

  /** stackable。同種と束ねてよい型か（既定true）。束ねない宣言が1つでもあれば束ねない。 */
  notStackable = false;

  interactions: YAMLMap | undefined;

  /**
   * 宣言から各フィールドを取り直す。**読む側はここ1箇所**で、object_def と trait で分かれない。
   * 未知キーの判定も宣言全体に対してここで行うので、持ち主は自分で読むキー（object_defの素性など）を
   * ownKeysで名乗ること——名乗らなければ綴り間違いとして弾かれる。
   */
  readFields(node: YAMLMap, context: string, ownKeys: readonly string[] = TRAIT_OWN_KEYS): void {
    requireKnownKeys(node, [...KNOWN_BODY_KEYS, ...ownKeys], context);

    this.tags = namesIn(tryGetSeq(node, 'tags', context), context);
    this.props = tryGetMap(node, 'props', context);
    this.slots = tryGetMap(node, 'slots', context);
    this.passives = ((tryGetSeq(node, 'passives', context)?.items ?? []) as YamlNode[]).map((item) =>
      asMap(item, `${context}.passives`),
    );
    this.stackOrder = tryGetMap(node, 'stack_order', context);
    this.visibleSlots = namesIn(tryGetSeq(node, 'visible_slots', context), `${context}.visible_slots`);
    this.isStorage = tryGetBool(node, 'storage', context) ?? false;
    this.artByStage = tryGetScalar(node, 'art_by_stage', context);
    this.boundToOwner = tryGetBool(node, 'bound_to_owner', context) ?? false;
    this.resists = tryGetSeq(node, 'resists', context);
    this.notStackable = !(tryGetBool(node, 'stackable', context) ?? true);
    this.interactions = tryGetMap(node, 'interactions', context);
  }

  /**
   * trait 由来の本体を宣言順に混ぜ、自分自身の宣言を最後に重ねた結果（5節）。
   *
   * - props/slots/interactions: 同名エントリが複数のtraitにあればエラー。自分自身が
   *   同名を持つ場合はフィールド単位で上書き（残りはtrait側を引き継ぐ）。
   * - passives・tags・visible_slots: 識別子で突き合わせようがないので、trait由来→自分自身の順に連結。
   *   **並びが表示順**（visible_slots）なので、混ぜる順序そのものに意味がある。
   * - stack_order/art_by_stage/resists: 自分自身の指定を優先。無ければちょうど1つのtraitが指定して
   *   いること。`resists`の並びは暗黙のANDで結ばれた1つの条件木なので、連結すると書いた覚えのない
   *   合わせ技になる——どれが効くかを混ぜる順序に頼らせない。
   * - 真偽値: 重複エラーにせずORで合成する（tagsと同じ扱い）。
   */
  merged(traits: readonly (readonly [string, RawDeclarationBody])[], ownerName: string): RawDeclarationBody {
    const result = new RawDeclarationBody();

    result.props = mergeIdentifierMaps(
      traits.map(([name, body]) => [name, body.props] as const),
      this.props,
      `'${ownerName}'のprops`,
      PROP_UNION_KEYS,
    );
    result.slots = mergeIdentifierMaps(
      traits.map(([name, body]) => [name, body.slots] as const),
      this.slots,
      `'${ownerName}'のslots`,
    );
    result.interactions = mergeIdentifierMaps(
      traits.map(([name, body]) => [name, body.interactions] as const),
      this.interactions,
      `'${ownerName}'のinteractions`,
    );

    result.passives = [...traits.flatMap(([, body]) => body.passives), ...this.passives];
    result.tags = [...traits.flatMap(([, body]) => body.tags), ...this.tags];
    result.visibleSlots = [...traits.flatMap(([, body]) => body.visibleSlots), ...this.visibleSlots];

    result.isStorage = this.isStorage || traits.some(([, body]) => body.isStorage);
    result.boundToOwner = this.boundToOwner || traits.some(([, body]) => body.boundToOwner);
    result.notStackable = this.notStackable || traits.some(([, body]) => body.notStackable);

    result.stackOrder =
      this.stackOrder ??
      onlyDeclaration(
        traits.map(([name, body]) => [name, body.stackOrder] as const),
        ownerName,
        'stack_order',
      );
    result.artByStage =
      this.artByStage ??
      onlyDeclaration(
        traits.map(([name, body]) => [name, body.artByStage] as const),
        ownerName,
        'art_by_stage',
      );
    result.resists =
      this.resists ??
      onlyDeclaration(
        traits.map(([name, body]) => [name, body.resists] as const),
        ownerName,
        'resists',
      );

    return result;
  }
}

/** `traits`・`tags`・`visible_slots` のような、識別子を並べただけの配列を読む。 */
export function namesIn(seq: YAMLSeq | undefined, context: string): string[] {
  return seq === undefined ? [] : (seq.items as YamlNode[]).map((item) => asScalarText(item, context));
}

/**
 * 自分自身が指定していないフィールドを trait から引き継ぐ。**指定できるのは1つのtraitだけ**——
 * 2つ以上が指定していると、どちらが効くかを混ぜる順序に頼ることになる。
 */
function onlyDeclaration<T>(
  candidates: readonly (readonly [string, T | undefined])[],
  ownerName: string,
  fieldName: string,
): T | undefined {
  const declared = candidates.filter(([, value]) => value !== undefined);
  if (declared.length > 1)
    throw new YamlLoadError(
      `'${ownerName}': ${fieldName} が複数のtrait（'${declared[0][0]}' と '${declared[1][0]}'）で重複して宣言されています。`,
    );
  return declared.at(0)?.[1];
}

/**
 * propsのフィールドのうち、trait側と自分自身の指定を上書きではなく足し合わせるもの（6.7節）。
 * タグは集合であり、object_def側が1つ足しただけでtrait由来のカテゴリを失うのは事故になるため。
 */
const PROP_UNION_KEYS = ['tags'];

function mergeIdentifierMaps(
  traitMaps: ReadonlyArray<readonly [string, YAMLMap | undefined]>,
  ownMap: YAMLMap | undefined,
  fieldLabel: string,
  unionKeys: readonly string[] = [],
): YAMLMap | undefined {
  const order: string[] = [];
  const byKey = new Map<string, YamlNode>();
  const owningTrait = new Map<string, string>();

  for (const [traitName, map] of traitMaps) {
    if (map === undefined) continue;
    for (const [key, value] of entriesInOrder(map)) {
      if (owningTrait.has(key))
        throw new YamlLoadError(
          `${fieldLabel} '${key}' が複数のtrait（'${owningTrait.get(key)}' と '${traitName}'）で重複して宣言されています。`,
        );
      owningTrait.set(key, traitName);
      order.push(key);
      byKey.set(key, value);
    }
  }

  if (ownMap !== undefined) {
    for (const [key, value] of entriesInOrder(ownMap)) {
      if (byKey.has(key)) {
        const traitValue = byKey.get(key) as YAMLMap;
        byKey.set(
          key,
          shallowMergeFields(asMap(traitValue, fieldLabel), asMap(value, fieldLabel), unionKeys),
        );
      } else {
        order.push(key);
        byKey.set(key, value);
      }
    }
  }

  if (order.length === 0) return undefined;

  const result = new YAMLMap();
  for (const key of order) result.add({ key: new Scalar(key), value: byKey.get(key) });
  return result;
}

/**
 * baseNodeのフィールドを持ちつつ、overlayNodeにあるフィールドで上書き・追加する（5節）。
 * unionKeysに挙げたフィールドだけは、両方が配列なら上書きせず連結する（PROP_UNION_KEYS参照）。
 */
function shallowMergeFields(baseNode: YAMLMap, overlayNode: YAMLMap, unionKeys: readonly string[]): YAMLMap {
  const order: string[] = [];
  const byKey = new Map<string, YamlNode>();

  for (const [key, value] of entriesInOrder(baseNode)) {
    order.push(key);
    byKey.set(key, value);
  }

  for (const [key, value] of entriesInOrder(overlayNode)) {
    const base = byKey.get(key);
    if (base === undefined) order.push(key);
    byKey.set(key, unionKeys.includes(key) ? concatSeqs(base, value) : value);
  }

  const result = new YAMLMap();
  for (const key of order) result.add({ key: new Scalar(key), value: byKey.get(key) });
  return result;
}

/** baseとoverlayがどちらも配列なら連結した新しい配列を、そうでなければoverlayをそのまま返す。 */
function concatSeqs(base: YamlNode | undefined, overlay: YamlNode): YamlNode {
  if (base === undefined || !isSeq(base) || !isSeq(overlay)) return overlay;

  const merged = new YAMLSeq();
  for (const item of [...base.items, ...overlay.items]) merged.add(item);
  return merged;
}
