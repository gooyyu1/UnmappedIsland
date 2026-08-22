import type { WorldCodex } from '../../src/domain/WorldCodex';
import type { Location } from '../../src/domain/wrappers/Location';
import type { WorldObject } from '../../src/domain/WorldObject';

/**
 * その土地の発見済みの道。道は「持ち歩けないもの」として木や建物と同じfixturesスロットに並ぶので、
 * 道だけを見たいテストはpathタグで絞る。
 */
export function pathsIn(location: Location, codex: WorldCodex): readonly WorldObject[] {
  const pathTagId = codex.tagNames.getId('path');
  return location.fixtures.filter((fixture) => fixture.def.tags.includes(pathTagId));
}
