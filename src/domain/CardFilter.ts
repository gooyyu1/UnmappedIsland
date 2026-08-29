import type { WorldObject } from './WorldObject';

/**
 * フィルターバーのボタン1つ（`card_filters`、docs/ui/ScreenLayout.md 8.1.3節）。**既にあるタグを
 * 複数指すだけ**で、フィルター専用のタグは持たない（同8.1.5節）。
 *
 * **「すべて」はここに現れない。** 絞り込みを解除するボタンであってフィルターではないので、UIが
 * 常に先頭へ置く（同8.1.1節）。
 */
export class CardFilter {
  /** ボタンの絵の名前（`src/assets/icons/<id>.png`）。 */
  readonly id: string;

  /** 絵がまだ無いときに代わりに置く絵文字（同4.2節）。 */
  readonly icon: string;

  /** このボタンが残す札のタグ。どれか1つでも持てば残る（宣言順）。 */
  readonly tagGlobalIds: readonly number[];

  constructor(id: string, icon: string, tagGlobalIds: readonly number[]) {
    this.id = id;
    this.icon = icon;
    this.tagGlobalIds = tagGlobalIds;
  }

  /**
   * その物をレーンに残すか。**自分が当たらなくても、外から開いて見られるスロット（`visible_slots`、
   * GameElementDefinition.md 7.11節）の中に当たる物が入っていれば残る**（ScreenLayout.md 8.1.4節）。
   * 辿る深さに上限は無い——袋の中の籠の中の干し肉でも袋が残る。
   */
  matches(object: WorldObject): boolean {
    if (this.tagGlobalIds.some((tagGlobalId) => object.def.hasTag(tagGlobalId))) return true;

    return object.def.visibleSlotGlobalIds.some((slotGlobalId) =>
      object.getSlot(slotGlobalId).contents.some((content) => this.matches(content)),
    );
  }
}
