import type { WorldSession } from '../../src/domain/WorldSession';

/**
 * その型が生まれたときに持つ値。作りたての1つを作って読むので、ロールのある値はセッションの乱数で
 * 1つに決まる。
 *
 * **型の名前を受けて定義の数値を読む助けは、ここ1つ**（`tests/architecture/localHelpers.test.ts`）——同じ
 * 助けが検査ごとに写しで生えると、読み方を1つ直したときに他の写しが古いまま残る。
 */
export function declaredNumberOf(session: WorldSession, objectName: string, propertyName: string): number {
  const { codex } = session;
  return session
    .createObject(codex.objectNames.getId(objectName))
    .getProperty(codex.propertyNames.getId(propertyName)).number;
}
