import type { Rect } from '../../ui/Rect';
import type { CardLane } from './CardLane';
import type { ObjectWindowLane, ObjectWindowLaneRole, ObjectWindowPane } from './ObjectWindowPane';

/**
 * 子ウィンドウが今開いている面と、そこから借りた札が居た枠（ObjectWindow）。
 *
 * **面を捨てられるのはここからだけ。** 捨て方が分かれる（タブの切り替えと窓を閉じる）ので、
 * 「捨てる前に枠を控える」を捨てる側それぞれに書くと、片方だけ書き忘れる。
 */
export class OpenPane {
  private pane: ObjectWindowPane | undefined;

  /**
   * 役割ごとの、レーンの枠が最後に在った場所（位置＝添字）。**役割を選ばずに全部控える**
   * ——借りるレーンが増えるたびに控える側へ足すことになると、そのレーンだけ枠を答えられなくなる。
   */
  private readonly lastRects = new Map<ObjectWindowLaneRole, readonly Rect[]>();

  /** 今の面が持つレーン（役割つき）。面が無ければ空。 */
  get lanes(): readonly ObjectWindowLane[] {
    return this.pane?.lanes ?? [];
  }

  /** その役割のレーン。今の面が持たなければundefined。 */
  laneOf(role: ObjectWindowLaneRole): CardLane | undefined {
    return this.lanes.find((entry) => entry.role === role)?.lane;
  }

  /**
   * その役割のレーンの、添字の位置の枠。借りた札を運んでくる先・返すときの出発点で、
   * **面を捨てたあとも最後の枠を答える**——帰りの出発点を測りに来るのは窓が閉じたあと
   * （PlayScene.closeChildWindowReturningOrigins）。
   */
  cellRect(role: ObjectWindowLaneRole, index: number): Rect | undefined {
    const lane = this.laneOf(role);
    return lane === undefined ? this.lastRects.get(role)?.[index] : lane.cellRect(index);
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
    // 枠はレーンごと消えるので、消える前に位置を控える（cellRect）。
    for (const { role, lane } of this.lanes) this.lastRects.set(role, lane.cellRects);

    this.pane?.destroy();
    this.pane = undefined;
  }
}
