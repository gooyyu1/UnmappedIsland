import { isMap, isScalar, isSeq, Scalar } from 'yaml';
import type { YAMLMap, YAMLSeq } from 'yaml';
import type { LoadReport } from './LoadReport';
import type { RawObjectDef } from './RawObjectDef';
import { asMap, entriesInOrder, tryGetNode } from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { messageOf } from './errorMessage';

/**
 * 既存のobject_defへの変更（`patch_object_defs`、GameElementDefinition.md 3.4節）。
 *
 * **動詞がパスの読み方を決める。** `add` のパスは「まだ無いキー」、`append` のパスは「既にある
 * 配列」を指す。1つの動詞にまとめると、配列名の打ち間違いが「新しいキーの作成」として通ってしまい、
 * 誤りが patch から遠い場所で表面化する。
 */
const VERBS = ['add', 'append', 'set', 'remove'] as const;
type Verb = (typeof VERBS)[number];

/** 動詞以外に書けるキー。 */
const MATERIAL_KEYS = ['value', 'where'] as const;

export class RawPatch {
  readonly verb: Verb;

  /** ドット区切りのパス。先頭がobject_defの識別子（識別子に`.`は入らない、3.2節）。 */
  readonly path: string;

  readonly value: YamlNode | undefined;

  /** 配列の要素を指すときの目印（部分一致）。位置ではなく中身で指す。 */
  readonly where: YamlNode | undefined;

  /** 読み込み元。報告の出所表示に使う。 */
  readonly source: string;

  /**
   * この操作が行えなかったときの報告先。undefinedなら例外にする——同梱ぶんの誤りは
   * ゲーム自身のバグで、外して続ける先が無い（AssetPack.md 6.1節）。
   */
  readonly report: LoadReport | undefined;

  constructor(
    verb: Verb,
    path: string,
    value: YamlNode | undefined,
    where: YamlNode | undefined,
    source: string,
    report: LoadReport | undefined,
  ) {
    this.verb = verb;
    this.path = path;
    this.value = value;
    this.where = where;
    this.source = source;
    this.report = report;
  }

  /** 報告に出す1行（何をしようとしたか）。 */
  get description(): string {
    return `${this.verb} ${this.path}`;
  }
}

/** `patch_object_defs`の1エントリを読む。 */
export function parsePatch(
  node: YamlNode,
  index: number,
  source: string,
  report: LoadReport | undefined,
): RawPatch {
  const context = `patch_object_defs[${index}]`;
  const map = asMap(node, context);

  const verbs = VERBS.filter((verb) => tryGetNode(map, verb) !== undefined);
  if (verbs.length !== 1)
    throw new YamlLoadError(
      `${context}: ${VERBS.map((verb) => `'${verb}'`).join('・')}のうち、ちょうど1つを書いてください（今: ${verbs.length}個）。`,
    );

  const verb = verbs[0];
  for (const [key] of entriesInOrder(map))
    if (!VERBS.includes(key as Verb) && !MATERIAL_KEYS.includes(key as (typeof MATERIAL_KEYS)[number]))
      throw new YamlLoadError(`${context}: '${key}'は書けません。`);

  const path = scalarText(tryGetNode(map, verb), `${context}.${verb}`);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(path))
    throw new YamlLoadError(
      `${context}.${verb}: '${path}'はパスとして読めません（'型の識別子.以下の場所'をドット区切りで書きます）。`,
    );

  const value = tryGetNode(map, 'value');
  const where = tryGetNode(map, 'where');
  if ((verb === 'add' || verb === 'append' || verb === 'set') && value === undefined)
    throw new YamlLoadError(`${context}: '${verb}'には'value'が要ります。`);
  if (verb === 'remove' && value !== undefined)
    throw new YamlLoadError(`${context}: 'remove'に'value'は書けません。`);
  if (where !== undefined && verb !== 'set' && verb !== 'remove')
    throw new YamlLoadError(`${context}: 'where'は'set'と'remove'にだけ書けます。`);

  return new RawPatch(verb, path, value, where, source, report);
}

/**
 * 読み込んだ全patchを、object_defの宣言へ順に当てる（trait合成の前）。
 *
 * 行えなかった操作は、報告先があればその1操作だけを捨てて次へ進む。同じ場所を2つのpatchが
 * 差し替えることは許さない——**先に読んだ方が残る**。後勝ちにすると、読み込み順という見えない
 * 要因で結果が変わり、勝った側も自分が上書きしたことを知らないままになる。
 */
export function applyPatches(patches: readonly RawPatch[], defs: ReadonlyMap<string, RawObjectDef>): void {
  const replaced = new Set<string>();

  for (const patch of patches) {
    try {
      apply(patch, defs, replaced);
    } catch (error) {
      if (patch.report === undefined) throw error;
      patch.report.add(patch.source, patch.description, messageOf(error));
    }
  }
}

function apply(patch: RawPatch, defs: ReadonlyMap<string, RawObjectDef>, replaced: Set<string>): void {
  const [defName, ...rest] = patch.path.split('.');
  const def = defs.get(defName);
  if (def === undefined) throw new YamlLoadError(`object_def '${defName}' がありません。`);

  if (patch.verb === 'set' || patch.verb === 'remove') {
    if (patch.where === undefined && replaced.has(patch.path))
      throw new YamlLoadError(`'${patch.path}' は既に別のpatchが変更しています（先に読んだ方が残ります）。`);
    if (patch.where === undefined) replaced.add(patch.path);
  }

  switch (patch.verb) {
    case 'add':
      addKey(descendToMap(def.node, defName, rest.slice(0, -1)), rest[rest.length - 1], patch);
      break;
    case 'append':
      seqAt(def.node, defName, rest).items.push(patch.value);
      break;
    case 'set':
      setValue(def, defName, rest, patch);
      break;
    case 'remove':
      removeValue(def, defName, rest, patch);
      break;
  }

  // 書き換えたので、フィールドを宣言から取り直す（RawObjectDef.readFields）。
  def.readFields();
}

/** `add`: パスの末尾は、まだ無いキー。 */
function addKey(parent: YAMLMap, key: string, patch: RawPatch): void {
  if (tryGetNode(parent, key) !== undefined)
    throw new YamlLoadError(`'${patch.path}' は既にあります（差し替えるなら'set'です）。`);
  // キーはScalarノードとして入れる（生の文字列のままだと、読む側の走査が拾えない）。
  parent.set(new Scalar(key), patch.value);
}

/** `set`: 配列の要素（where付き）か、既にあるキーの値。 */
function setValue(def: RawObjectDef, defName: string, rest: readonly string[], patch: RawPatch): void {
  if (patch.where !== undefined) {
    const seq = seqAt(def.node, defName, rest);
    seq.items[indexOfMatch(seq, patch)] = patch.value;
    return;
  }

  const parent = descendToMap(def.node, defName, rest.slice(0, -1));
  const key = rest[rest.length - 1];
  if (tryGetNode(parent, key) === undefined)
    throw new YamlLoadError(`'${patch.path}' がありません（新しく作るなら'add'です）。`);
  parent.set(new Scalar(key), patch.value);
}

/** `remove`: 配列の要素（where付き）か、既にあるキー。 */
function removeValue(def: RawObjectDef, defName: string, rest: readonly string[], patch: RawPatch): void {
  if (patch.where !== undefined) {
    const seq = seqAt(def.node, defName, rest);
    seq.items.splice(indexOfMatch(seq, patch), 1);
    return;
  }

  const parent = descendToMap(def.node, defName, rest.slice(0, -1));
  const key = rest[rest.length - 1];
  if (tryGetNode(parent, key) === undefined) throw new YamlLoadError(`'${patch.path}' がありません。`);
  parent.delete(key);
}

/** whereに当てはまる要素の位置。0件でも2件以上でもエラー（どれを指すのか決まらない）。 */
function indexOfMatch(seq: YAMLSeq, patch: RawPatch): number {
  const found = (seq.items as YamlNode[])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => matches(item, patch.where as YamlNode));

  if (found.length === 0) throw new YamlLoadError(`'${patch.path}' に'where'の当てはまる要素がありません。`);
  if (found.length > 1)
    throw new YamlLoadError(`'${patch.path}' に'where'の当てはまる要素が${found.length}個あります。`);
  return found[0].index;
}

/**
 * whereの当てはめ。**書いたキーだけを見る部分一致**で、書いていないキーは何であってもよい。
 * 配列だけは、書いた通りの並びと個数であることを求める（一部だけ書けても意味が決まらないため）。
 */
function matches(target: YamlNode, where: YamlNode): boolean {
  if (isScalar(where)) return isScalar(target) && target.value === where.value;

  if (isMap(where)) {
    if (!isMap(target)) return false;
    for (const [key, node] of entriesInOrder(where)) {
      const found = tryGetNode(target as YAMLMap, key);
      if (found === undefined || !matches(found, node)) return false;
    }
    return true;
  }

  if (isSeq(where)) {
    if (!isSeq(target) || target.items.length !== where.items.length) return false;
    return (where.items as YamlNode[]).every((node, index) =>
      matches((target.items as YamlNode[])[index], node),
    );
  }
  return false;
}

/** パスを辿ってマップへ降りる。 */
function descendToMap(node: YAMLMap, defName: string, steps: readonly string[]): YAMLMap {
  let at: YamlNode = node;
  let walked = defName;
  for (const step of steps) {
    if (!isMap(at)) throw new YamlLoadError(`'${walked}' はマップではありません。`);
    const next: YamlNode | undefined = tryGetNode(at as YAMLMap, step);
    if (next === undefined)
      throw new YamlLoadError(`'${walked}.${step}' がありません。${keysOf(at as YAMLMap)}`);
    at = next;
    walked = `${walked}.${step}`;
  }
  if (!isMap(at)) throw new YamlLoadError(`'${walked}' はマップではありません。`);
  return at as YAMLMap;
}

/** パスを辿って配列へ降りる。 */
function seqAt(node: YAMLMap, defName: string, steps: readonly string[]): YAMLSeq {
  const parent = descendToMap(node, defName, steps.slice(0, -1));
  const key = steps[steps.length - 1];
  const target = tryGetNode(parent, key);
  if (target === undefined)
    throw new YamlLoadError(`'${[defName, ...steps].join('.')}' がありません。${keysOf(parent)}`);
  if (!isSeq(target)) throw new YamlLoadError(`'${[defName, ...steps].join('.')}' は配列ではありません。`);
  return target as YAMLSeq;
}

/** 打ち間違いを見つけやすいよう、その場所が持っているキーを添える。 */
function keysOf(map: YAMLMap): string {
  const keys = [...entriesInOrder(map)].map(([key]) => key);
  return keys.length === 0 ? '' : `（持っているキー: ${keys.join('・')}）`;
}

function scalarText(node: YamlNode | undefined, context: string): string {
  if (node === undefined || !isScalar(node) || typeof node.value !== 'string')
    throw new YamlLoadError(`${context}: 文字列で書いてください。`);
  return node.value;
}
