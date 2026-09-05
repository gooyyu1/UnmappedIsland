import { ObjectWrapper } from './ObjectWrapper';
import type { WorldObject } from '../WorldObject';

/**
 * 道（locations.yamlのpath object_def）の包み（ObjectWrapper）。
 *
 * インスタンスごとの値（行き先・所要時間・要る進捗・戻る道）は生成時にIslandSpawnerが書き込む。
 * 移動そのもの（agentの所属差し替え・時間消費）はYAML側のtravelアクションが担う。
 */
export class Path extends ObjectWrapper {
  /** 移動時間（分）。 */
  get travelMinutes(): number {
    return this.effectiveNumberOf(this.words.travelMinutesId);
  }

  /** 発見に必要な、親の土地の探索進捗。 */
  get requiredProgress(): number {
    return this.effectiveNumberOf(this.words.requiredProgressId);
  }

  /** 移動先LocationのインスタンスID。 */
  get destinationInstanceId(): number {
    return this.effectiveNumberOf(this.words.destinationIdId);
  }

  /**
   * 移動先のLocation。世界のツリーから引く（MoveEffectの移動先の解決と同じ引き方）ので、
   * 呼び出し側はインスタンスIDから実体を辿る手順を知らなくてよい。まだ実体化していなければundefined。
   */
  get destination(): WorldObject | undefined {
    return this.instance.findRoot().findSelfOrDescendantByInstanceId(this.destinationInstanceId);
  }

  /** 移動先の土地にある、こちらへ戻る道のインスタンスID（辺の両端の道は互いを指す）。 */
  get returnPathInstanceId(): number {
    return this.effectiveNumberOf(this.words.returnPathIdId);
  }

  /**
   * この道を通って移動する（YAML側のtravelアクション: 未発見なら不成立、成功ならagentが移動先へ移り、
   * 担ぎ手の遅れ（travel_delay）を継いだtravel_minutesの時間が進む）。
   */
  travel(agent: WorldObject | undefined): boolean {
    return this.instance.tryGetAction(this.words.travelAction, agent)?.tryExecute() === true;
  }
}
