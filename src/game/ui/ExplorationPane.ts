import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { CardLane } from './CardLane';
import type { LaneCell } from './laneCells';
import type { ObjectWindowLane, ObjectWindowPane } from './ObjectWindowPane';
import { FOUND_CELLS, laneWidthForCells } from './laneCells';
import { CONTENT_GAP } from '../looks/childWindowLayout';
import { ProgressBar } from './ProgressBar';
import { addLabel } from '../../ui/labels';
import { COLOR, SIZE } from '../looks/theme';

/** 探索の進み具合を示すバーの高さ（ゲームの主操作なので、ステータスバーより大きく取る）。 */
const BAR_HEIGHT = 72;

/** 探索のタブに出すもの。発見物の並びはレーンが持つので、ここには入れない。 */
export interface ExplorationContent {
  /** 探索率（0〜1）。 */
  readonly ratio: number;
}

/**
 * オブジェクトウィンドウの探索のタブ（Windows.md 5節）。発見物のレーン・探索率のバー・補足の1行を持つ。
 *
 * **「探索する」ボタンは持ちません。** 探索は現在地が宣言しているアクション（`explore`）なので、
 * 最下段の操作の行に他のアクションと並びます——画面の都合で足したボタンと、宣言から来たボタンを
 * 分けないためです。
 *
 * **発見物の枠はレーンそのものです**（CardLane）。ここに並ぶのはレーンから来てレーンへ帰っていく
 * 札なので、枠の幾何も送りも、札の出入りの見せ方も、他のレーンと同じ道筋に乗ります。
 */
export class ExplorationPane implements ObjectWindowPane {
  /**
   * この面が要る幅。**発見物の4枠ぶん**で、窓の幅はこれを下回らない（Windows.md 5節）。
   * 枠は縮めない——レーンから来てレーンへ帰る札そのものなので、大きさが変わると別の札に見える。
   */
  static width(metrics: ScreenMetrics): number {
    return laneWidthForCells(metrics, FOUND_CELLS);
  }

  /** この面が要る高さ。窓の中段の高さは、最も高いタブに合わせて決まる（ObjectWindow）。 */
  static height(metrics: ScreenMetrics): number {
    return (
      metrics.px(SIZE.laneHeight) +
      metrics.px(CONTENT_GAP) +
      metrics.px(BAR_HEIGHT) +
      metrics.px(CONTENT_GAP) +
      metrics.px(NOTE_HEIGHT)
    );
  }

  /** 発見物のレーン。並びの差し替えは呼び出し側（PlayScene）が他のレーンと一緒に通す。 */
  readonly lanes: readonly ObjectWindowLane[];

  private readonly content: () => ExplorationContent;
  private readonly lane: CardLane;
  private readonly bar: ProgressBar;
  private readonly percent: Phaser.GameObjects.Text;
  private readonly note: Phaser.GameObjects.Text;
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    area: Rect,
    content: () => ExplorationContent,
    cells: readonly LaneCell[],
  ) {
    this.content = content;
    const ratio = content().ratio;
    const gap = metrics.px(CONTENT_GAP);
    const barHeight = metrics.px(BAR_HEIGHT);
    const laneHeight = metrics.px(SIZE.laneHeight);
    const centerX = area.x + area.width / 2;

    this.lane = new CardLane(
      scene,
      metrics,
      { x: area.x, y: area.y, width: area.width, height: laneHeight },
      COLOR.slotWindowLane,
      cells,
      { clip: true },
    );
    this.lanes = [{ role: 'found', lane: this.lane }];

    let cursorY = area.y + laneHeight + gap;
    this.bar = new ProgressBar(scene, metrics, area.x, cursorY, area.width, barHeight, ratio);
    this.percent = addLabel(scene, metrics, centerX, cursorY + barHeight / 2, percentOf(ratio), {
      size: 32,
      bold: true,
    }).setOrigin(0.5);
    this.objects.push(this.bar, this.percent);

    cursorY += barHeight + gap;
    this.note = addLabel(scene, metrics, centerX, cursorY, noteOf(ratio), {
      size: 24,
      color: COLOR.textMuted,
      wrapWidth: area.width,
    })
      .setOrigin(0.5, 0)
      .setAlign('center');
    this.objects.push(this.note);
  }

  /** 探索率だけを読み直す。**発見物のレーンは触らない**——並びの差し替えはCardTableが受け持つ。 */
  refresh(): void {
    const ratio = this.content().ratio;
    this.bar.setRatio(ratio, { showChange: true });
    this.percent.setText(percentOf(ratio));
    this.note.setText(noteOf(ratio));
  }

  destroy(): void {
    this.lane.destroy();
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }
}

/** 補足の1行が占める高さ（u単位）。**件数によらず窓の寸法を変えない**ため、2行ぶんで決め打つ。 */
const NOTE_HEIGHT = 68;

/** 探索率は整数の%で見せる。100%に届いていない進捗を切り上げて100%と誤解させないよう切り捨てる。 */
function percentOf(ratio: number): string {
  return `${Math.min(100, Math.trunc(ratio * 100))}%`;
}

function noteOf(ratio: number): string {
  return ratio >= 1
    ? 'この土地に隠された道はすべて見つけた。探索を続ければ、まだ何かは見つかる。'
    : '探索を続けると、アイテムや他の土地へ続く道が見つかる。';
}
