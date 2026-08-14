import { beforeAll, describe, expect, it } from 'vitest';
import type { ObjectDef } from '../../src/domain/defs/ObjectDef';
import type { WorldCodex } from '../../src/domain/defs/WorldCodex';
import { WorldCodexYamlLoader } from '../../src/loader/WorldCodexYamlLoader';
import { loadYamlDirectory, WORLD_CODEX_DIR } from '../support/worldCodexFiles';

/**
 * カードの値バー（`gauge`プロパティタグ、CardView.md 8節）が、物ごとに高々1つであることの自動テスト。
 *
 * PlayScreenViewはgaugeタグの付いたプロパティをprops宣言順で最初の1つしか読まない
 * （WorldObject.exhaustedStageと同じ規約）。2つ以上付けても片方が静かに出なくなるだけでエラーには
 * ならないので、付け過ぎをここで捕まえる。
 */
describe('gaugeタグ', () => {
  let codex: WorldCodex;
  let defs: readonly ObjectDef[];

  beforeAll(() => {
    codex = loadYamlDirectory(new WorldCodexYamlLoader(), WORLD_CODEX_DIR).build();
    defs = Array.from({ length: codex.objects.count }, (_, globalId) => codex.objects.get(globalId));
  });

  it('1つのobject_defにgaugeタグの付いたプロパティは高々1つ', () => {
    const gaugeTagId = codex.propertyTagNames.getId('gauge');
    const tooMany = defs
      .filter((def) => def.enumeratePropertyDefs().filter((prop) => prop.hasTag(gaugeTagId)).length > 1)
      .map((def) => def.name);

    expect(tooMany).toEqual([]);
  });
});
