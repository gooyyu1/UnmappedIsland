import type { Rect } from '../../ui/Rect';
import type { CardLane } from './CardLane';
import type { ObjectWindowLane, ObjectWindowLaneRole, ObjectWindowPane } from './ObjectWindowPane';

/**
 * 子ウィンドウが今開いている面と、そこから借りた札の枠（ObjectWindow）。
 *
 * **面を捨てられるのはここからだけ。** 捨て方が2つある（タブの切り替えと窓を閉じる）ので、
 * 「捨てる前に札の枠を控える」を捨てる側それぞれに書くと、片方だけ書き忘れる。
 */
export class OpenPane {
  private pane: ObjectWindowPane | undefined;

  /** 借りた札が最後に居た枠。札の枠を持たない面では描かないので、面を捨てるたびに控える。 */
  private lastCardRect: Rect | undefined;

  /** 今の面が持つレーン（役割つき）。面が無ければ空。 */
  get lanes(): readonly ObjectWindowLane[] {
    return this.pane?.lanes ?? [];
  }

  /** その役割のレーン。今の面が持たなければundefined。 */
  laneOf(role: ObjectWindowLaneRole): CardLane | undefined {
    return this.lanes.find((entry) => entry.role === role)?.lane;
  }

  /**
   * 借りた札の枠。運んでくる先・返すときの出発点で、**面を捨てたあとも最後の枠を答える**
   * ——帰りの出発点を測りに来るのは窓が閉じたあと（PlayScene.closeChildWindowReturningOrigins）。
   */
  get cardRect(): Rect | undefined {
    return this.laneOf('card')?.cellRect(0) ?? this.lastCardRect;
  }

  /** 今の面に、元にしている内容を読み直させる。 */
  refresh(): void {
    this.pane?.refresh();
  }

  /** 今の面を捨てて、次の面を開く。 */
  replace(create: () => ObjectWindowPane): void {
    this.close();
    this.pane = create();
  }

  /** 今の面を捨てる（次は開かない）。 */
  close(): void {
    // 札の枠は面と一緒に消えるので、消える前に位置を控える（cardRect）。
    const card = this.laneOf('card');
    if (card !== undefined) this.lastCardRect = card.cellRect(0);

    this.pane?.destroy();
    this.pane = undefined;
  }
}
