import type { WorldObject } from '../../src/domain/WorldObject';
import type { WorldSession } from '../../src/domain/WorldSession';

/**
 * 操作を引くには動作主が要る（GameElementDefinition.md 11.5節）が、**誰が起こしても同じ**ことを
 * 見る試験のための足場。合成YAMLで組んだ世界には人が居ないので、何も持たない1体をここから配る。
 *
 * 実物のcodexを読む試験は、同じ役目に`illumination.createBrightEnoughAgent`を使う（そちらは
 * 明るさの条件まで満たす必要があるため）。
 */

/** 動作主の定義。props も slots も要らない——役に就くことだけが要る。 */
export const AGENT_YAML = `
object_defs:
  agent: {}
`;

/** AGENT_YAMLを読んだcodexから動作主を1体作る。**どのスロットへも入れない**ので置き場所は要らない。 */
export function createAgent(session: WorldSession): WorldObject {
  return session.createObject(session.codex.objectNames.getId('agent'));
}
