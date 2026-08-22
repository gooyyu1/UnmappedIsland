import type { YAMLMap } from 'yaml';
import {
  asMap,
  asScalarText,
  requireKnownKeys,
  tryGetInt,
  tryGetMap,
  tryGetNode,
  tryGetNumber,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseTypeMatchRule } from './parseCommon';
import { parseWeight } from './parseActiveEffects';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { CellDef, SlotDef } from '../domain/SlotDef';
import type { WeightSpec } from '../domain/PickEffect';

/** 廃止したキーと、その内容を今どこへ書くか。黙って無視すると、効いているつもりの宣言が通ってしまう。 */
const RETIRED_KEYS: readonly (readonly [string, string])[] = [
  ['accepts', "枠ごとの'cell'/'cells'の'accept'"],
  ['unit_capacity', "枠の数を表す'cell_count'"],
  ['fixed_positions', "枠の数を表す'cell_count'（数を決めれば位置も安定する）"],
  ['stackable', "object_def側の'stackable'"],
  ['auto_placement', "誰が入れてよいかを並べる'placement'（7.7節）"],
];

/** slots.'slotName'エントリを1つ読む。trait合成済みのノードを渡すこと。 */
export function parseSlot(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  slotName: string,
  node: YAMLMap,
): SlotDef {
  const context = `'${objectDefName}'.slots.'${slotName}'`;
  const slotGlobalId = loader.slotNames.intern(slotName);

  for (const [key, replacement] of RETIRED_KEYS)
    if (node.has(key))
      throw new YamlLoadError(
        `${context}: '${key}'は廃止されました。${replacement}で表します（SlotSystem.md 2節）。`,
      );

  const cellsNode = tryGetSeq(node, 'cells', context);
  const sharedCellNode = tryGetMap(node, 'cell', context);
  const cellCount = tryGetInt(node, 'cell_count', context);

  if (cellsNode !== undefined && sharedCellNode !== undefined)
    throw new YamlLoadError(`${context}: 'cells'と'cell'は同時に指定できません。`);
  if (cellsNode !== undefined && cellCount !== undefined)
    throw new YamlLoadError(
      `${context}: 'cells'を並べた数がそのまま枠の数なので、'cell_count'は書けません。`,
    );

  const cells =
    cellsNode === undefined
      ? undefined
      : (cellsNode.items as YamlNode[]).map((cellNode, index) =>
          parseCell(loader, `${context}.cells[${index}]`, asMap(cellNode, context)),
        );
  const sharedCell =
    sharedCellNode === undefined ? undefined : parseCell(loader, `${context}.cell`, sharedCellNode);

  const putInNode = tryGetMap(node, 'put_in', context);
  const placement = parsePlacement(context, node);

  return new SlotDef(
    slotGlobalId,
    slotName,
    cells,
    sharedCell,
    cellCount,
    tryGetNumber(node, 'capacity', context),
    placement.includes('auto'),
    putInNode === undefined ? undefined : parsePutIn(loader, `${context}.put_in`, putInNode),
    placement.includes('manual'),
  );
}

/** 誰がここへ物を入れてよいか（`placement`、7.7節）。省略すればエンジンもプレイヤーも入れられる。 */
const PLACERS = ['auto', 'manual'] as const;

function parsePlacement(context: string, node: YAMLMap): readonly string[] {
  const seq = tryGetSeq(node, 'placement', context);
  if (seq === undefined) return PLACERS;

  const names = (seq.items as YamlNode[]).map((item) => asScalarText(item, `${context}.placement`));
  for (const name of names)
    if (!(PLACERS as readonly string[]).includes(name))
      throw new YamlLoadError(
        `${context}.placement: 未知の指定 '${name}' です（'${PLACERS.join("' か '")}'）。`,
      );
  return names;
}

/** `put_in: {duration: ...}`（ここへ入れるのにかかる時間）を読む。出す側に時間は課さない。 */
function parsePutIn(loader: WorldCodexYamlLoader, context: string, node: YAMLMap): WeightSpec {
  requireKnownKeys(context, node, ['duration']);

  const durationNode = tryGetNode(node, 'duration');
  if (durationNode === undefined) throw new YamlLoadError(`${context}: 'duration'が必要です。`);
  return parseWeight(loader, `${context}.duration`, durationNode, true, 'duration');
}

/** 1つの枠の定義（`{accept: {tag|object}, max: N}`）を読む。 */
function parseCell(loader: WorldCodexYamlLoader, context: string, node: YAMLMap): CellDef {
  const acceptNode = tryGetMap(node, 'accept', context);
  return new CellDef(
    acceptNode === undefined ? undefined : parseTypeMatchRule(loader, `${context}.accept`, acceptNode),
    tryGetInt(node, 'max', context),
  );
}
