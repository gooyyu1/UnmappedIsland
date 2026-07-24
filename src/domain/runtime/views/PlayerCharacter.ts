import type { NameRegistry } from '../../defs/NameRegistry';
import type { WorldObject } from '../WorldObject';

/**
 * actor（プレイヤーキャラクター、GameElementDefinition.md 8.1節・11節）に対する、UI/ゲームロジック向けの型付き
 * ビュー。Worldと同じ理由で継承ではなくラップにしている。
 *
 * どのプロパティを持つべきかはまだ確定していないため、既存のサンプルに登場済みのものだけを実装している。
 */
export class PlayerCharacter {
  readonly instance: WorldObject;

  private readonly hpId: number;
  private readonly satietyId: number;

  constructor(instance: WorldObject, propertyNames: NameRegistry) {
    this.instance = instance;
    this.hpId = PlayerCharacter.idOrMissing(propertyNames, 'hp');
    this.satietyId = PlayerCharacter.idOrMissing(propertyNames, 'satiety');
  }

  /** 未登録の名前は-1（LocalIndexMap.missing扱い）にする。characters.yamlがこのビューの知る全プロパティを持つとは限らないため、「持っていなければ0を読む」姿勢に合わせる。 */
  private static idOrMissing(names: NameRegistry, name: string): number {
    return names.tryGetId(name) ?? -1;
  }

  get hp(): number {
    return this.instance.getEffectiveValue(this.hpId);
  }

  get satiety(): number {
    return this.instance.getEffectiveValue(this.satietyId);
  }
}
