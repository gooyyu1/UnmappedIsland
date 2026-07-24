import type { NameRegistry } from './NameRegistry';

/**
 * エンジン側の汎用ロジック（容量・重さ伝播、ContainerSystem.md）が規約として直接参照するプロパティ名。
 * "size"/"weight" の2つだけは move_to_slot の不変条件（Slot.canAccept / WorldObject.moveToSlot）が
 * 直接読みに行く。ロード処理の最後、他の全プロパティ名のinternが終わったタイミングで1回構築する。
 */
export class WellKnownProperties {
  readonly sizeId: number;
  readonly weightId: number;

  constructor(propertyNames: NameRegistry) {
    this.sizeId = propertyNames.intern('size');
    this.weightId = propertyNames.intern('weight');
  }
}
