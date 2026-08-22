import type Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { CardLane } from './CardLane';
import type { LaneCell } from './laneCells';
import { laneWidthForCells } from './laneCells';
import type { ObjectWindowLane, ObjectWindowPane } from './ObjectWindowPane';
import { CONTENT_GAP } from '../looks/childWindowLayout';
import { COLOR, SIZE } from '../looks/theme';

/** ウィンドウが映しているスロット1つ＝タブ1つ。 */
export interface ObjectWindowSlot {
  /** タブの識別子（記憶の鍵）。呼び出し側はこれで「どのスロットのタブか」を引き当てる。 */
  readonly key: string;

  /** タブのラベル。スロットは必ず持ち主のものなので、持ち主込みの名前を呼び出し側が組み立てて渡す。 */
  readonly title: string;

  /** 並べる枠（slotCells）。カードも空き枠も枠の縁もこの1本が持ち、はみ出した分は横スクロールで送る。 */
  readonly cells: readonly LaneCell[];

  /** 落とせば枠が増えるスロットか（SlotView.cells）。増える前提で、レーンは頭打ちの枠数まで広げる。 */
  readonly grows: boolean;
}

/**
 * オブジェクトウィンドウのスロットのタブ（Windows.md 1.2節）。中段を丸ごと使って枠を1本のレーンに
 * 並べる——オブジェクト自身のカードは説明のタブが出すので、札の枠のぶんもここでは並びに使える。
 */
export class SlotPane implements ObjectWindowPane {
  /**
   * この面が要る幅。**枠の数は並べる枠そのもので決まる**——1枠しか無い場所に4枠空けると
   * 「4つ入る」と誤って伝わる。落とせば枠が増えるスロットは、増える前提で頭打ちまで取る。
   */
  static width(metrics: ScreenMetrics, slot: ObjectWindowSlot): number {
    // 枠を1つも並べないスロット（要求を満たし切った材料）でも、レーンは1枠ぶんの幅を保つ。
    const wanted = slot.grows ? Number.POSITIVE_INFINITY : Math.max(1, slot.cells.length);
    return laneWidthForCells(metrics, wanted);
  }

  /** この面が要る高さ。レーン1本ぶん。 */
  static height(metrics: ScreenMetrics): number {
    return metrics.px(SIZE.laneHeight);
  }

  readonly lanes: readonly ObjectWindowLane[];

  private readonly lane: CardLane;

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, area: Rect, slot: ObjectWindowSlot) {
    // 枠数の決まっているスロットは、レーンを枠の数まで縮めて中央へ寄せる。幅いっぱいのレーンに
    // 1枠だけ左詰めで置くと、どこへ落とすのかが読み取りにくい。
    const laneWidth = Math.min(area.width - metrics.px(CONTENT_GAP), SlotPane.width(metrics, slot));
    const laneHeight = SlotPane.height(metrics);
    this.lane = new CardLane(
      scene,
      metrics,
      {
        x: area.x + (area.width - laneWidth) / 2,
        y: area.y + (area.height - laneHeight) / 2,
        width: laneWidth,
        height: laneHeight,
      },
      COLOR.slotWindowLane,
      slot.cells,
      { clip: true },
    );
    this.lanes = [{ role: 'content', lane: this.lane }];
  }

  /** 並ぶ札の差し替えはレーンが受け持つ（PlayScene.laneViews）ので、この面から読み直すものは無い。 */
  refresh(): void {}

  destroy(): void {
    this.lane.destroy();
  }
}
