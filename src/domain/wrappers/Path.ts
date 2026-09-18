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

  /** 移動先LocationのインスタンスID。生成が書き込む前は`NO_INSTANCE`（WorldObject）。 */
  get destinationInstanceId(): number {
    return this.effectiveNumberOf(this.words.destinationIdId);
  }

  /**
   * 移動先のLocation。世界のツリーから引く（MoveEffectの移動先の解決と同じ引き方）ので、
   * 呼び出し側はインスタンスIDから実体を辿る手順を知らなくてよい。
   *
   * **行き先がツリーに居なければundefined。行き先を書き込まれていない道も同じ**
   * ——`NO_INSTANCE`（WorldObject）はどの個体も持たないので、既定値のまま引けば「該当なし」になる。
   */
  get destination(): WorldObject | undefined {
    return this.instance.findRoot().findSelfOrDescendantByInstanceId(this.destinationInstanceId);
  }

  /**
   * 移動先の土地にある、こちらへ戻る道（辺の両端の道は互いを指す。{@link destination}と同じ引き方）。
   * **両端を一緒に公開する側（Location.reveal）が、インスタンスIDから実体を辿る手順を
   * 持たなくて済むように置く。** 指す先がツリーに居ない道・書き込まれていない道ではundefined。
   */
  get returnPath(): WorldObject | undefined {
    return this.instance
      .findRoot()
      .findSelfOrDescendantByInstanceId(this.effectiveNumberOf(this.words.returnPathIdId));
  }

  /**
   * この道を通って移動する（YAML側のtravelアクション: 未発見なら不成立、成功ならagentが移動先へ移り、
   * 担ぎ手の遅れ（travel_delay）を継いだtravel_minutesの時間が進む）。
   */
  travel(agent: WorldObject): boolean {
    return this.instance.tryGetAction(this.words.travelAction, agent)?.tryExecute() === true;
  }
}
