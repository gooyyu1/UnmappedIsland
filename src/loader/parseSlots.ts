import type { YAMLMap } from 'yaml';
import {
  asMap,
  requireInt,
  tryGetBool,
  tryGetInt,
  tryGetNumber,
  tryGetScalar,
  tryGetSeq,
} from './yamlMapping';
import type { YamlNode } from './yamlMapping';
import { YamlLoadError } from './YamlLoadError';
import type { WorldCodexYamlLoader } from './WorldCodexYamlLoader';
import { SlotAcceptRule, SlotDef } from '../domain/defs/SlotDef';
import type { SlotAcceptTargetKind } from '../domain/defs/SlotDef';

/** slots.'slotName'エントリを1つ読む。trait合成済みのノードを渡すこと。 */
export function parseSlot(
  loader: WorldCodexYamlLoader,
  objectDefName: string,
  slotName: string,
  node: YAMLMap,
): SlotDef {
  const context = `'${objectDefName}'.slots.'${slotName}'`;
  const slotGlobalId = loader.slotNames.intern(slotName);

  const accepts: SlotAcceptRule[] = [];
  const acceptsNode = tryGetSeq(node, 'accepts', context);
  if (acceptsNode !== undefined)
    for (const acceptNode of acceptsNode.items as YamlNode[]) {
      const acceptMap = asMap(acceptNode, context);
      const acceptContext = `${context}.accepts`;
      const tagName = tryGetScalar(acceptMap, 'tag', acceptContext);
      const objectName = tryGetScalar(acceptMap, 'object', acceptContext);

      if (tagName !== undefined && objectName !== undefined)
        throw new YamlLoadError(`${acceptContext}: 'tag'と'object'は同時に指定できません。`);
      if (tagName === undefined && objectName === undefined)
        throw new YamlLoadError(`${acceptContext}: 'tag'または'object'のいずれかが必要です。`);

      const targetKind: SlotAcceptTargetKind = tagName !== undefined ? 'tag' : 'object';
      // objectNameは、直前の2つのチェックにより、tagNameが未指定の場合は必ず定義されている。
      const withId =
        tagName !== undefined ? loader.tagNames.intern(tagName) : loader.objectNames.intern(objectName!);

      accepts.push(
        new SlotAcceptRule(
          targetKind,
          withId,
          requireInt(acceptMap, 'max', context),
          tryGetBool(acceptMap, 'consume', context, false),
        ),
      );
    }

  const capacity = tryGetNumber(node, 'capacity', context);
  const weightRate = tryGetNumber(node, 'weight_rate', context) ?? 1.0;
  const stackable = tryGetBool(node, 'stackable', context, true);
  const unitCapacity = tryGetInt(node, 'unit_capacity', context);
  const fixedPositions = tryGetBool(node, 'fixed_positions', context, false);

  return new SlotDef(
    slotGlobalId,
    slotName,
    accepts,
    capacity,
    weightRate,
    stackable,
    unitCapacity,
    fixedPositions,
  );
}
