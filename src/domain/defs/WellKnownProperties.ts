import type { NameRegistry } from './NameRegistry';

/**
 * エンジン側の汎用ロジック（容量・重さ・負荷、ContainerSystem.md）が規約として直接参照するプロパティ名。
 * ロード処理の最後、他の全プロパティ名のinternが終わったタイミングで1回構築する。
 *
 * - size: capacityの検証（Slot.canAccept）と、量的オブジェクト（7.6節）の量。
 * - weight: 物の重さ。子のweightをそのまま合算する（率はかけない）。
 * - density: 量的オブジェクトの単位量あたりの重さ（g/mL。水=1）。
 * - load: 担いだ人が感じる負荷。直接の子のweightに、その子のload_reduction_rateを効かせた分。
 * - load_reduction_rate: 担ぎ方による体感の軽減率（%、既定0）。アイテムが持ちスロット位置で切り替える。
 */
export class WellKnownProperties {
  readonly sizeId: number;
  readonly weightId: number;
  readonly densityId: number;
  readonly loadId: number;
  readonly loadReductionRateId: number;

  constructor(propertyNames: NameRegistry) {
    this.sizeId = propertyNames.intern('size');
    this.weightId = propertyNames.intern('weight');
    this.densityId = propertyNames.intern('density');
    this.loadId = propertyNames.intern('load');
    this.loadReductionRateId = propertyNames.intern('load_reduction_rate');
  }
}
