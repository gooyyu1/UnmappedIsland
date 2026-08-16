import { YAMLMap, YAMLSeq, Scalar, isSeq } from 'yaml';
import type { YamlNode } from './yamlMapping';
import {
  asMap,
  asScalarText,
  entriesInOrder,
  requireScalar,
  tryGetBool,
  tryGetMap,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseProp } from './parseProperties';
import { parseSlot } from './parseSlots';
import { parsePassive } from './parsePassives';
import { parseActions, parseCombinations } from './parseActionsAndCombinations';
import { parseRecipes } from './parseRecipes';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import type { RawTrait } from './RawTrait';
import { LocalIndexMap } from '../domain/defs/LocalIndexMap';
import { ObjectDef } from '../domain/defs/ObjectDef';
import type { PassiveEffect } from '../domain/defs/PassiveEffect';
import type { PropertyDef } from '../domain/defs/PropertyDef';
import type { SlotDef } from '../domain/defs/SlotDef';
import { StackOrderDef } from '../domain/defs/StackOrderDef';

/**
 * object_defs（GameElementDefinition.md 4節）の1エントリの、まだtrait解決を経ていない生の形。
 * trait上書きマージ（resolve参照）がまだ起こりうるフィールドは、意味解釈済みの型にせず
 * 生YAMLノードのまま持つ。globalIdのみパース時点で確定し、tags・prop/slot名等はresolveで
 * 初めて確定する。
 */
export class RawObjectDef {
  readonly name: string;

  /** 読み込み元。重複エラーメッセージの出所表示にのみ使う。 */
  readonly source: string;

  /** objectNames.internによるグローバルID。trait解決を待たずパース時点で確定する。 */
  readonly globalId: number;

  /**
   * 宣言そのもの。patch（3.4節）はこのノードを書き換え、書き換えたら readFields を呼び直して
   * 下の各フィールドを取り直す。フィールドはこのノードの一部を指しているだけなので、両者が
   * 食い違ったまま resolve へ進まないよう、取り直しはこのクラス自身が引き受ける。
   */
  readonly node: YAMLMap;

  isSingleton = false;
  traitNames: string[] = [];
  tags: string[] = [];
  props: YAMLMap | undefined;
  slots: YAMLMap | undefined;
  passives: YAMLSeq | undefined;
  stackOrder: YAMLMap | undefined;

  /** represented_by（7.6節）で指定されたスロット名。未指定ならundefined。 */
  representedBy: string | undefined;

  /** main_item_slot（7.8節）で指定されたスロット名。未指定ならundefined。 */
  mainItemSlot: string | undefined;

  /** art_by_stage（6.4節）で指定されたプロパティ名。未指定ならundefined。 */
  artByStage: string | undefined;

  /** quantitative（7.6節）。個数ではなく量で存在する型か。traitのどれか1つでも宣言していれば真。 */
  quantitative = false;

  /** bound_to_owner（7.9節）。単独では存在できない型か。quantitativeと同じくORで合成する。 */
  boundToOwner = false;

  /** stackable。同種と束ねてよい型か（既定true）。束ねない宣言が1つでもあれば束ねない。 */
  notStackable = false;

  actions: YAMLMap | undefined;
  combinations: YAMLMap | undefined;

  /** recipes（13節）。成果物ごとの内容なのでtrait合成の対象にしない（resolve参照）。 */
  recipes: YAMLMap | undefined;

  constructor(name: string, source: string, globalId: number, node: YAMLMap) {
    this.name = name;
    this.source = source;
    this.globalId = globalId;
    this.node = node;
    this.readFields();
  }

  /** 宣言から各フィールドを取り直す。trait合成がまだ起こりうるものは生YAMLノードのまま持つ。 */
  readFields(): void {
    const context = `object_defs.'${this.name}'`;

    this.isSingleton = tryGetBool(this.node, 'singleton', context, false);
    this.props = tryGetMap(this.node, 'props', context);
    this.slots = tryGetMap(this.node, 'slots', context);
    this.passives = tryGetSeq(this.node, 'passives', context);
    this.stackOrder = tryGetMap(this.node, 'stack_order', context);
    this.representedBy = tryGetScalar(this.node, 'represented_by', context);
    this.mainItemSlot = tryGetScalar(this.node, 'main_item_slot', context);
    this.artByStage = tryGetScalar(this.node, 'art_by_stage', context);
    this.quantitative = tryGetBool(this.node, 'quantitative', context, false);
    this.boundToOwner = tryGetBool(this.node, 'bound_to_owner', context, false);
    this.notStackable = !tryGetBool(this.node, 'stackable', context, true);
    this.actions = tryGetMap(this.node, 'actions', context);
    this.combinations = tryGetMap(this.node, 'combinations', context);
    this.recipes = tryGetMap(this.node, 'recipes', context);
    this.traitNames = namesIn(tryGetSeq(this.node, 'traits', context), context);
    this.tags = namesIn(tryGetSeq(this.node, 'tags', context), context);
  }

  /**
   * 参照するtraitを合成し（フェーズ1: YAMLノードレベルのマージ）、そこから最終的なObjectDefを
   * 組み立てる（フェーズ2: loaderの各parse関数による意味解釈）。
   *
   * 合成規則（フェーズ1）:
   * - props/slots/actions/combinations: 同名エントリが複数のtraitにあればエラー（5節）。
   *   object_def自身が同名エントリを持つ場合はフィールド単位で上書き（残りはtrait側を引き継ぐ）。
   * - passives: 識別子を持たないため単純に連結（trait由来→自分自身の順）。
   * - stack_order/represented_by/main_item_slot/art_by_stage: 自分自身の指定を優先。無ければちょうど1つの
   *   traitが指定している必要がある（複数ならエラー）。
   * - recipes: 成果物ごとの内容なので合成せず、自分自身の宣言だけを読む。
   * 未対応（Codex側にビルド先の型が無いため意図的にスキップ）: covers/layer。
   */
  resolve(traitsByName: ReadonlyMap<string, RawTrait>, loader: WorldCodexYamlLoader): ObjectDef {
    const traitProps: Array<[string, YAMLMap | undefined]> = [];
    const traitSlots: Array<[string, YAMLMap | undefined]> = [];
    const traitActions: Array<[string, YAMLMap | undefined]> = [];
    const traitCombinations: Array<[string, YAMLMap | undefined]> = [];
    const passiveNodes: YAMLMap[] = [];
    const stackOrderCandidates: Array<[string, YAMLMap]> = [];
    const representedByCandidates: Array<[string, string]> = [];
    const mainItemSlotCandidates: Array<[string, string]> = [];
    const artByStageCandidates: Array<[string, string]> = [];
    const tags: string[] = [];
    let quantitative = this.quantitative;
    let boundToOwner = this.boundToOwner;
    let notStackable = this.notStackable;

    for (const traitName of this.traitNames) {
      const trait = traitsByName.get(traitName);
      if (trait === undefined)
        throw new YamlLoadError(`'${this.name}' が参照するtrait '${traitName}' が見つかりません。`);

      traitProps.push([traitName, trait.props]);
      traitSlots.push([traitName, trait.slots]);
      traitActions.push([traitName, trait.actions]);
      traitCombinations.push([traitName, trait.combinations]);
      if (trait.passives !== undefined)
        for (const passiveNode of trait.passives.items as YamlNode[])
          passiveNodes.push(asMap(passiveNode, `traits.'${traitName}'.passives`));
      if (trait.stackOrder !== undefined) stackOrderCandidates.push([traitName, trait.stackOrder]);
      if (trait.representedBy !== undefined) representedByCandidates.push([traitName, trait.representedBy]);
      if (trait.mainItemSlot !== undefined) mainItemSlotCandidates.push([traitName, trait.mainItemSlot]);
      if (trait.artByStage !== undefined) artByStageCandidates.push([traitName, trait.artByStage]);
      // quantitativeは真偽値なので、represented_byのような重複エラーにせずtagsと同じくORで合成する。
      if (trait.quantitative) quantitative = true;
      if (trait.boundToOwner) boundToOwner = true;
      if (trait.notStackable) notStackable = true;
      tags.push(...trait.tags);
    }

    const mergedProps = mergeIdentifierMaps(traitProps, this.props, `'${this.name}'のprops`, PROP_UNION_KEYS);
    const mergedSlots = mergeIdentifierMaps(traitSlots, this.slots, `'${this.name}'のslots`);
    const mergedActions = mergeIdentifierMaps(traitActions, this.actions, `'${this.name}'のactions`);
    const mergedCombinations = mergeIdentifierMaps(
      traitCombinations,
      this.combinations,
      `'${this.name}'のcombinations`,
    );

    if (this.passives !== undefined)
      for (const passiveNode of this.passives.items as YamlNode[])
        passiveNodes.push(asMap(passiveNode, `'${this.name}'.passives`));

    tags.push(...this.tags);

    let stackOrderNode = this.stackOrder;
    if (stackOrderNode === undefined) {
      if (stackOrderCandidates.length > 1)
        throw new YamlLoadError(
          `'${this.name}': stack_order が複数のtrait（'${stackOrderCandidates[0][0]}' と '${stackOrderCandidates[1][0]}'）で重複して宣言されています。`,
        );
      if (stackOrderCandidates.length === 1) stackOrderNode = stackOrderCandidates[0][1];
    }

    let representedByName = this.representedBy;
    if (representedByName === undefined) {
      if (representedByCandidates.length > 1)
        throw new YamlLoadError(
          `'${this.name}': represented_by が複数のtrait（'${representedByCandidates[0][0]}' と '${representedByCandidates[1][0]}'）で重複して宣言されています。`,
        );
      if (representedByCandidates.length === 1) representedByName = representedByCandidates[0][1];
    }

    // フェーズ2: マージ済みノードから最終的なObjectDefを組み立てる。
    const passives: PassiveEffect[] = [];

    const propertyDefs: PropertyDef[] = [];
    if (mergedProps !== undefined)
      for (const [propName, propValueNode] of entriesInOrder(mergedProps))
        propertyDefs.push(
          parseProp(
            loader,
            this.name,
            propName,
            asMap(propValueNode, `'${this.name}'.props.'${propName}'`),
            passives,
          ),
        );
    const propertyLayout = new LocalIndexMap(
      loader.propertyNames.count,
      propertyDefs.map((p) => p.globalId),
    );

    const slotDefs: SlotDef[] = [];
    if (mergedSlots !== undefined)
      for (const [slotName, slotValueNode] of entriesInOrder(mergedSlots))
        slotDefs.push(
          parseSlot(loader, this.name, slotName, asMap(slotValueNode, `'${this.name}'.slots.'${slotName}'`)),
        );
    const slotLayout = new LocalIndexMap(
      loader.slotNames.count,
      slotDefs.map((s) => s.globalId),
    );

    for (const passiveNode of passiveNodes)
      parsePassive(loader, passives, this.name, passiveNode, undefined, undefined);

    let stackOrder: StackOrderDef | undefined;
    if (stackOrderNode !== undefined) {
      const context = `'${this.name}'.stack_order`;
      stackOrder = new StackOrderDef(
        loader.propertyNames.intern(requireScalar(stackOrderNode, 'property', context)),
        tryGetBool(stackOrderNode, 'ascending', context, false),
      );
    }

    const actions = parseActions(loader, this.name, mergedActions);
    const combinations = parseCombinations(loader, this.name, mergedCombinations);
    const tagIds = [...new Set(tags.map((tag) => loader.tagNames.intern(tag)))];
    const representedBySlotGlobalId =
      representedByName !== undefined ? loader.slotNames.intern(representedByName) : undefined;

    let mainItemSlotName = this.mainItemSlot;
    if (mainItemSlotName === undefined) {
      if (mainItemSlotCandidates.length > 1)
        throw new YamlLoadError(
          `'${this.name}': main_item_slot が複数のtrait（'${mainItemSlotCandidates[0][0]}' と '${mainItemSlotCandidates[1][0]}'）で重複して宣言されています。`,
        );
      if (mainItemSlotCandidates.length === 1) mainItemSlotName = mainItemSlotCandidates[0][1];
    }
    const mainItemSlotGlobalId =
      mainItemSlotName !== undefined ? loader.slotNames.intern(mainItemSlotName) : undefined;

    let artByStageName = this.artByStage;
    if (artByStageName === undefined) {
      if (artByStageCandidates.length > 1)
        throw new YamlLoadError(
          `'${this.name}': art_by_stage が複数のtrait（'${artByStageCandidates[0][0]}' と '${artByStageCandidates[1][0]}'）で重複して宣言されています。`,
        );
      if (artByStageCandidates.length === 1) artByStageName = artByStageCandidates[0][1];
    }
    const artByStagePropertyGlobalId =
      artByStageName !== undefined ? loader.propertyNames.intern(artByStageName) : undefined;

    if (artByStagePropertyGlobalId !== undefined) {
      const target = propertyDefs.find((propertyDef) => propertyDef.globalId === artByStagePropertyGlobalId);
      if (target === undefined)
        throw new YamlLoadError(
          `'${this.name}': art_by_stage が指すプロパティ '${artByStageName}' を持ちません。`,
        );
      if (!target.hasStages)
        throw new YamlLoadError(
          `'${this.name}': art_by_stage が指すプロパティ '${artByStageName}' はstagesを持ちません。`,
        );
    }
    // 段のartを宣言できるのはart_by_stageが指すプロパティだけ（1オブジェクト1絵の原則、6.4節）。
    // 他のプロパティの段が黙って無視されるのを避けるため、ロード時に弾く。
    for (const propertyDef of propertyDefs)
      if (propertyDef.hasStageArt && propertyDef.globalId !== artByStagePropertyGlobalId)
        throw new YamlLoadError(
          `'${this.name}': プロパティ '${propertyDef.name}' の段がartを宣言していますが、` +
            `art_by_stage は${artByStageName !== undefined ? `'${artByStageName}'` : '未指定'}です。` +
            `段にartを書けるのはart_by_stageが指すプロパティだけです。`,
        );

    // 量的オブジェクトは注ぐたびにインスタンスが生まれ直すため、生成時ロール（6.2節）を持てない
    // （移すたびに振り直されてしまう、7.6節）。
    if (quantitative)
      for (const propertyDef of propertyDefs)
        if (propertyDef.hasInitialValueRoll)
          throw new YamlLoadError(
            `'${this.name}': quantitative な型のプロパティ '${propertyDef.name}' に生成時ロールの範囲値（value: {min, max}）は使えません（量を移すたびに振り直されるため）。`,
          );

    return new ObjectDef(
      this.globalId,
      this.name,
      this.isSingleton,
      propertyLayout,
      propertyDefs,
      slotLayout,
      slotDefs,
      passives,
      stackOrder,
      tagIds,
      actions,
      combinations,
      representedBySlotGlobalId,
      quantitative,
      mainItemSlotGlobalId,
      boundToOwner,
      !notStackable,
      parseRecipes(loader, this.name, this.recipes),
      artByStagePropertyGlobalId,
    );
  }
}

/**
 * propsのフィールドのうち、trait側と自分自身の指定を上書きではなく足し合わせるもの（6.7節）。
 * タグは集合であり、object_def側が1つ足しただけでtrait由来のカテゴリを失うのは事故になるため。
 */
const PROP_UNION_KEYS = ['tags'];

function mergeIdentifierMaps(
  traitMaps: ReadonlyArray<[string, YAMLMap | undefined]>,
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

/** `traits`・`tags` のような、識別子を並べただけの配列を読む。 */
function namesIn(seq: YAMLSeq | undefined, context: string): string[] {
  if (seq === undefined) return [];
  return (seq.items as YamlNode[]).map((item) => asScalarText(item, context));
}
