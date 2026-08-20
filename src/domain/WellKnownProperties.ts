import type { NameRegistry } from './NameRegistry';

/**
 * エンジン側の汎用ロジック（容量・重さ・負荷、ContainerSystem.md）が規約として直接参照するプロパティ名。
 * ロード処理の最後、他の全プロパティ名のinternが終わったタイミングで1回構築する。
 *
 * - volume: かさ（mL）。capacityの検証（Slot.canAccept）と、量的オブジェクト（7.6節）の量を兼ねる。
 * - weight: 物の重さ。子のweightをそのまま合算する（率はかけない）。
 * - density: 量的オブジェクトの単位量あたりの重さ（g/mL。水=1）。volume × density が重さになる。
 * - load: 担いだ人が感じる負荷。直接の子のweightに、その子のload_reduction_rateを効かせた分。
 * - load_reduction_rate: 担ぎ方による体感の軽減率（0〜1、既定0）。アイテムが持ちスロット位置で切り替える。
 */
export class WellKnownProperties {
  readonly volumeId: number;

  /** 中身入りの変種（3.5節）が抱えている量。0になった変種は素の型へ戻る（WorldObject.settleFill）。 */
  readonly fillId: number;
  readonly weightId: number;
  readonly densityId: number;
  readonly loadId: number;
  readonly loadReductionRateId: number;

  constructor(propertyNames: NameRegistry) {
    this.volumeId = propertyNames.intern('volume');
    this.fillId = propertyNames.intern('fill');
    this.weightId = propertyNames.intern('weight');
    this.densityId = propertyNames.intern('density');
    this.loadId = propertyNames.intern('load');
    this.loadReductionRateId = propertyNames.intern('load_reduction_rate');
  }
}
