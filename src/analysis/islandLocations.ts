import type { ObjectDef } from '../domain/ObjectDef';
import type { WorldCodex } from '../domain/WorldCodex';

/**
 * 診断レポートが数える土地の集め方。**収支（`balanceTables`）と活動時間（`activityHours`）が同じ集合を
 * 見る**——どちらの表も答えたいのは「島の1日が賄えるか」で、集める条件が2箇所に割れると片方だけずれる。
 *
 * 集めるのは、探索できる土地（`location`タグ＋`exploration_progress`）のうち**海ではないもの**。
 * 海区（`voyage.yaml`）はその条件をそのまま満たす——探索でき、寝られ、雨も貯まる——が、島の土地では
 * ないので分母に入れない。
 */

/** 表に出す島の土地と、海として外した場所。 */
export interface IslandLocations {
  /** 島の土地。表の行になる。 */
  readonly island: readonly ObjectDef[];

  /**
   * 海として外した場所。**外したものも返す**のは、線を引いた位置をレポートへ書くため
   * （`.claude/policies.md`「道具が引く線」）——海区は集め方の条件をそのまま満たすので、外したことが
   * 数字の側には現れない。
   */
  readonly excludedSea: readonly ExcludedLocation[];
}

/** 表から外した場所1つ。 */
export interface ExcludedLocation {
  readonly def: ObjectDef;

  /** 外す根拠にしたタグの名前。**外した側が名乗る**ので、レポートはこれをそのまま書き出せる。 */
  readonly tag: string;
}

export function islandLocationsOf(codex: WorldCodex): IslandLocations {
  const { locationTagId, seaTagId, explorationProgressId } = codex.vocabulary.world;
  const seaTag = codex.tagNames.getName(seaTagId);

  const island: ObjectDef[] = [];
  const excludedSea: ExcludedLocation[] = [];
  for (const def of codex.objects) {
    if (!def.hasTag(locationTagId) || def.tryGetPropertyDef(explorationProgressId) === undefined) continue;
    if (def.hasTag(seaTagId)) excludedSea.push({ def, tag: seaTag });
    else island.push(def);
  }
  return { island, excludedSea };
}
