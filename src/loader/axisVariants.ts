import { stringify } from 'yaml';
import type { YAMLMap } from 'yaml';
import type { GeneratedCoordinate } from '../domain/GeneratedTypes';
import type { ObjectDef } from '../domain/ObjectDef';
import { parseTypeMatchRule } from './parseCommon';
import type { RawObjectDef } from './RawObjectDef';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { YamlLoadError } from './YamlLoadError';
import { asMap, entriesInOrder, tryGetMap, tryGetScalar } from './yamlMapping';

/** 生成した定義の出所として、エラーメッセージに出す名前。 */
export const AXIS_VARIANT_SOURCE = '<軸による変種の自動生成>';

/** 生成した型の識別子。人もパック作成者もこの名前を書かないので、読みやすさより衝突しにくさを優先する。 */
function variantName(baseName: string, axisName: string, valueName: string): string {
  return `${baseName}__${axisName}_${valueName}`;
}

/** 軸1本の宣言（`variation_axes`の1エントリ、GameElementDefinition.md 3.5節）。 */
interface AxisDecl {
  /** 軸の値になれる型。 */
  readonly values: readonly ObjectDef[];

  /**
   * その軸の値を持つ変種にだけ足すprops。**素の型ごとに違う値（容器ごとの上限など）を、変種の宣言
   * として渡すための口**——ここに何を書くかは著者の裁量で、生成器は名前も意味も見ない。
   */
  readonly props: unknown;

  /**
   * 尽きるとこの軸が外れるプロパティの名前（省略可）。**どのプロパティが「量」かはYAMLが決めます**
   * （WorldObject.settleExhaustedVariations）。
   */
  readonly exhaustedWhen: string | undefined;
}

/**
 * `variation_axes`を宣言した型から、軸の値ごとの変種を`object_defs`のYAMLとして組み立てる
 * （GameElementDefinition.md 3.5節）。宣言が1つも無ければundefined。
 *
 * **変種は「素の型に、軸の値の型が持つtraitを配ったもの」です。** props・tags・actions・combinations・
 * passivesの合成は既存のmixin（5節）がそのまま行うので、ここは trait 名を繋ぐだけで済む。**何が
 * 配られるかも、変種にだけ足すpropsが何を意味するかも、生成器は知りません**。
 * 生成した定義をYAMLへ戻してローダーへ食わせるのも、人が書いた定義とまったく同じ検証を通すため
 * （inProgressObjectsと同じ）。
 */
export function axisVariantsYaml(
  rawDefs: ReadonlyMap<string, RawObjectDef>,
  defs: readonly ObjectDef[],
  loader: WorldCodexYamlLoader,
): { yaml: string; coordinates: ReadonlyMap<string, GeneratedCoordinate> } | undefined {
  const objectDefs: Record<string, unknown> = {};
  const coordinates = new Map<string, GeneratedCoordinate>();

  for (const raw of rawDefs.values()) {
    if (raw.variationAxes === undefined) continue;

    for (const [axisName, axis] of readAxes(raw, defs, loader)) {
      for (const value of axis.values) {
        const name = variantName(raw.name, axisName, value.name);
        objectDefs[name] = variantBody(raw, value, axis, rawDefs);
        coordinates.set(name, {
          baseGlobalId: raw.globalId,
          axisValues: new Map([[axisName, value.name]]),
          exhaustedWhen:
            axis.exhaustedWhen === undefined
              ? undefined
              : new Map([[axisName, loader.propertyNames.intern(axis.exhaustedWhen)]]),
        });
      }
    }
  }

  if (coordinates.size === 0) return undefined;
  // **同じ宣言を共有していてもアンカーにしない。** 軸のpropsは変種すべてに同じオブジェクトとして
  // 配られるので、既定のままだと2つ目以降がエイリアス（`*a1`）になり、ローダーがマッピングとして
  // 読めない。人が書いたYAMLと同じ形で食わせるための指定。
  return { yaml: stringify({ object_defs: objectDefs }, { aliasDuplicateObjects: false }), coordinates };
}

/** `variation_axes`の各エントリを読む。軸の名前は著者が付け、値になれる型は`of`が選ぶ。 */
function readAxes(
  raw: RawObjectDef,
  defs: readonly ObjectDef[],
  loader: WorldCodexYamlLoader,
): Array<[string, AxisDecl]> {
  const context = `object_defs.'${raw.name}'.variation_axes`;

  return entriesInOrder(raw.variationAxes!).map(([axisName, node]) => {
    const axisContext = `${context}.'${axisName}'`;
    const map = asMap(node, axisContext);
    const ofNode = tryGetMap(map, 'of', axisContext);
    if (ofNode === undefined) throw new YamlLoadError(`${axisContext}: 'of'は必須です。`);
    const rule = parseTypeMatchRule(loader, ofNode, `${axisContext}.of`);
    return [
      axisName,
      {
        values: rule.candidates(defs),
        props: tryGetMap(map, 'props', axisContext)?.toJSON(),
        exhaustedWhen: tryGetScalar(map, 'exhausted_when', axisContext),
      },
    ];
  });
}

/**
 * 変種1つの定義。素の型の宣言をそのまま写し、軸の値のtraitと、軸が宣言しているpropsを足す。
 *
 * `variation_axes`と`recipes`は写しません——変種の変種は作らず、作れるのは素の型のほう（空の容器を作ってから
 * 中身を入れる）だからです。
 */
function variantBody(
  raw: RawObjectDef,
  value: ObjectDef,
  axis: AxisDecl,
  rawDefs: ReadonlyMap<string, RawObjectDef>,
): Record<string, unknown> {
  const body = (raw.node.toJSON() ?? {}) as Record<string, unknown>;
  delete body.variation_axes;
  delete body.recipes;

  body.traits = [...raw.traitNames, ...valueTraitNames(value, rawDefs)];
  if (axis.props !== undefined)
    body.props = { ...((body.props as Record<string, unknown> | undefined) ?? {}), ...axis.props };
  return body;
}

/**
 * 軸の値になる型が配るtraitの名前。**値になれるのはtraitの束だけ**で、自前のメンバーを持つ型は
 * ロードエラーにする——配る仕組みはmixinそのものなので、mixinに載らない宣言は配りようがない。
 */
function valueTraitNames(value: ObjectDef, rawDefs: ReadonlyMap<string, RawObjectDef>): readonly string[] {
  const raw = rawDefs.get(value.name);
  if (raw === undefined) throw new YamlLoadError(`軸の値 '${value.name}' の宣言が見つかりません。`);

  const declared = declaredKeys(raw.node).filter((key) => key !== 'traits');
  if (declared.length > 0)
    throw new YamlLoadError(
      `'${value.name}': 軸の値になる型は 'traits' だけを宣言できます（'${declared.join("', '")}' は配れません）。`,
    );

  return raw.traitNames;
}

function declaredKeys(node: YAMLMap): string[] {
  return entriesInOrder(node).map(([key]) => key);
}
