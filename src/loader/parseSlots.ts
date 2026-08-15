import type { YAMLMap } from 'yaml';
import {
  asMap,
  entriesInOrder,
  tryGetBool,
  tryGetInt,
  tryGetMap,
  tryGetNumber,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import { parseTypeMatchRule, tryGetNode } from './parseCommon';
import { parseWeight } from './parseActiveEffects';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { CellDef, SlotDef } from '../domain/defs/SlotDef';
import type { WeightSpec } from '../domain/defs/PickEffect';

/** 廃止したキーと、その内容を今どこへ書くか。黙って無視すると、効いているつもりの宣言が通ってしまう。 */
const RETIRED_KEYS: readonly (readonly [string, string])[] = [
  ['accepts', "枠ごとの'cell'/'cells'の'accept'"],
  ['unit_capacity', "枠の数を表す'cell_count'"],
  ['fixed_positions', "枠の数を表す'cell_count'（数を決めれば位置も安定する）"],
  ['stackable', "object_def側の'stackable'"],
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
          parseCell(loader, asMap(cellNode, context), `${context}.cells[${index}]`),
        );
  const sharedCell =
    sharedCellNode === undefined ? undefined : parseCell(loader, sharedCellNode, `${context}.cell`);

  const putInNode = tryGetMap(node, 'put_in', context);

  return new SlotDef(
    slotGlobalId,
    slotName,
    cells,
    sharedCell,
    cellCount,
    tryGetNumber(node, 'capacity', context),
    tryGetBool(node, 'auto_placement', context, true),
    putInNode === undefined ? undefined : parsePutIn(loader, putInNode, `${context}.put_in`),
  );
}

/** `put_in: {duration: ...}`（ここへ入れるのにかかる時間）を読む。出す側に時間は課さない。 */
function parsePutIn(loader: WorldCodexYamlLoader, node: YAMLMap, context: string): WeightSpec {
  const unknownKeys = entriesInOrder(node)
    .map(([key]) => key)
    .filter((key) => key !== 'duration');
  if (unknownKeys.length > 0)
    throw new YamlLoadError(`${context}: 未知のキー '${unknownKeys.join(', ')}' です。`);

  const durationNode = tryGetNode(node, 'duration');
  if (durationNode === undefined) throw new YamlLoadError(`${context}: 'duration'が必要です。`);
  return parseWeight(loader, `${context}.duration`, durationNode, true, 'duration');
}

/** 1つの枠の定義（`{accept: {tag|object}, max: N}`）を読む。 */
function parseCell(loader: WorldCodexYamlLoader, node: YAMLMap, context: string): CellDef {
  const acceptNode = tryGetMap(node, 'accept', context);
  return new CellDef(
    acceptNode === undefined ? undefined : parseTypeMatchRule(loader, acceptNode, `${context}.accept`),
    tryGetInt(node, 'max', context),
  );
}
