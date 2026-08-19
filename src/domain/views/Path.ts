import type { NameRegistry } from '../NameRegistry';
import type { WorldObject } from '../WorldObject';
import type { WorldSession } from '../WorldSession';

/**
 * 道（locations.yamlのpath object_def）に対する、UI/ゲームロジック向けの型付きビュー。Worldと同じ理由で継承では
 * なくラップにしている。
 *
 * travel_minutes/required_progress/destination_idは生成時（IslandSpawner）にインスタンスごとへ上書きされる値。
 * 移動そのもの（actorの所属差し替え・時間消費）はYAML側のtravelアクションが担う。
 */
export class Path {
  readonly instance: WorldObject;

  private readonly travelMinutesId: number;
  private readonly requiredProgressId: number;
  private readonly destinationIdId: number;
  private readonly returnPathIdId: number;

  constructor(instance: WorldObject, propertyNames: NameRegistry) {
    this.instance = instance;
    this.travelMinutesId = Path.idOrMissing(propertyNames, 'travel_minutes');
    this.requiredProgressId = Path.idOrMissing(propertyNames, 'required_progress');
    this.destinationIdId = Path.idOrMissing(propertyNames, 'destination_id');
    this.returnPathIdId = Path.idOrMissing(propertyNames, 'return_path_id');
  }

  /** 未登録の名前は-1（LocalIndexMap.missing扱い）にする（理由はLocation.idOrMissing参照）。 */
  private static idOrMissing(names: NameRegistry, name: string): number {
    return names.tryGetId(name) ?? -1;
  }

  /** 移動時間（分）。 */
  get travelMinutes(): number {
    return this.instance.getEffectiveValue(this.travelMinutesId);
  }

  /** 発見に必要な、親の土地の探索進捗。 */
  get requiredProgress(): number {
    return this.instance.getEffectiveValue(this.requiredProgressId);
  }

  /** 移動先LocationのインスタンスID。 */
  get destinationInstanceId(): number {
    return this.instance.getEffectiveValue(this.destinationIdId);
  }

  /**
   * 移動先のLocation。世界のツリーから引く（MoveEffectの移動先の解決と同じ引き方）ので、
   * 呼び出し側はインスタンスIDから実体を辿る手順を知らなくてよい。まだ実体化していなければundefined。
   */
  get destination(): WorldObject | undefined {
    return this.instance.findRoot().findDescendantByInstanceId(this.destinationInstanceId);
  }

  /** 移動先の土地にある、こちらへ戻る道のインスタンスID（辺の両端の道は互いを指す）。 */
  get returnPathInstanceId(): number {
    return this.instance.getEffectiveValue(this.returnPathIdId);
  }

  /** この道を通って移動する（YAML側のtravelアクション: 未発見なら不成立、成功ならactorが移動先へ移り、travel_minutes分の時間が進む）。 */
  travel(actor: WorldObject | undefined, session: WorldSession): boolean {
    return this.instance.tryExecuteAction('travel', actor, session);
  }
}
