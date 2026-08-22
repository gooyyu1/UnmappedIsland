import type { WorldCodex } from '../WorldCodex';
import type { WorldRuleVocabulary } from '../WorldVocabulary';
import type { WorldObject } from '../WorldObject';

/**
 * 道（locations.yamlのpath object_def）に対する、UI/ゲームロジック向けの型付きビュー。Worldと同じ理由で継承では
 * なくラップにしている。
 *
 * インスタンスごとの値（行き先・所要時間・要る進捗・戻る道）は生成時にIslandSpawnerが書き込む。
 * 移動そのもの（actorの所属差し替え・時間消費）はYAML側のtravelアクションが担う。
 */
export class Path {
  readonly instance: WorldObject;

  private readonly words: WorldRuleVocabulary;

  constructor(instance: WorldObject, codex: WorldCodex) {
    this.instance = instance;
    this.words = codex.vocabulary.world;
  }

  /** 移動時間（分）。 */
  get travelMinutes(): number {
    return this.instance.tryGetProperty(this.words.travelMinutesId)?.getEffectiveValue() ?? 0;
  }

  /** 発見に必要な、親の土地の探索進捗。 */
  get requiredProgress(): number {
    return this.instance.tryGetProperty(this.words.requiredProgressId)?.getEffectiveValue() ?? 0;
  }

  /** 移動先LocationのインスタンスID。 */
  get destinationInstanceId(): number {
    return this.instance.tryGetProperty(this.words.destinationIdId)?.getEffectiveValue() ?? 0;
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
    return this.instance.tryGetProperty(this.words.returnPathIdId)?.getEffectiveValue() ?? 0;
  }

  /** この道を通って移動する（YAML側のtravelアクション: 未発見なら不成立、成功ならactorが移動先へ移り、travel_minutes分の時間が進む）。 */
  travel(actor: WorldObject | undefined): boolean {
    return this.instance.tryGetAction(this.words.travelAction, actor)?.tryExecute() === true;
  }
}
