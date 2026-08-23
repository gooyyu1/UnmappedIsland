import type Phaser from 'phaser';
import type { Rect } from './Rect';
import { clipToRect } from './clip';
import { clampScroll, minScrollFor, wheelPixels } from './scroll';

/**
 * 送り具合の映し先（スクロールバー）。**position・lengthではなくoffsetとminOffsetで渡す**
 * ——つまみの長さは中身に対する可視域の割合で決まるので、送れる範囲そのものが要る。
 */
export interface ScrollReadout {
  setScroll(offset: number, minOffset: number): void;
}

export interface ScrollAreaOptions {
  /** 送る向き。 */
  readonly axis: 'x' | 'y';

  /** 送る対象。**この表示物の位置だけを動かす**ので、中身はここへ入れておく。 */
  readonly content: Phaser.GameObjects.Container;

  /** 見えている範囲（画面座標）。はみ出した分はここで切り抜く。 */
  readonly viewport: Rect;

  /**
   * ドラッグとホイールを受ける表示物。**中身より奥に置くこと**——手前に敷くと中身を押せなくなる。
   *
   * 面を渡さなければ送れない（送る必要が無い場所のため）。**シーン全体の入力は見ない**——外で
   * 始めたドラッグまで拾うと、覆っていない場所を触っただけで中身が動く。
   */
  readonly inputSurfaces?: readonly Phaser.GameObjects.GameObject[];

  /** 送り具合を映す先。省略すると出さない。 */
  readonly readout?: ScrollReadout;

  /** はみ出した分を切り抜くか（既定true）。周りの背景板が覆って隠す場所だけfalseにする。 */
  readonly clip?: boolean;

  /** 送った後にすることがあれば（レーンの地の絵をカードと同じだけ送る、など）。 */
  readonly onScroll?: (offset: number) => void;
}

/**
 * 中身がはみ出した分を、ドラッグとホイールで送れるようにする（`src/ui/clip.ts`のように、既にある
 * 表示物へ振る舞いを足す道具）。
 *
 * **中身は持ちません。** 送るのは渡された1つの表示物の位置だけで、その中に何をどう並べるかは
 * 呼び出し側が決めます——1行に並べるレーンも、折り返して積む一覧も、これに乗ります。
 *
 * ドラッグは**始めた時点を基準に**測ります（`beginDrag`→`dragTo`）。カードの上から始めたドラッグを
 * 途中から送りに変える場合も、外から同じ2つを呼べば同じように動きます（CardDragController）。
 */
export class ScrollArea {
  /** 送り量0のときの中身の位置（座標）。 */
  private readonly contentPositionAtScrollZero: number;

  private readonly axis: 'x' | 'y';
  private readonly content: Phaser.GameObjects.Container;
  private readonly viewportLength: number;
  private readonly readout: ScrollReadout | undefined;
  private readonly onScroll: ((offset: number) => void) | undefined;
  private readonly unclip: (() => void) | undefined;

  /** 送れる下限（中身が可視域に収まるなら0）。送りは0（先頭）から下限までの負の値。 */
  private minOffset = 0;

  /** ドラッグを始めた時点の送り量。 */
  private dragStart = 0;

  constructor(scene: Phaser.Scene, options: ScrollAreaOptions) {
    this.axis = options.axis;
    this.content = options.content;
    this.contentPositionAtScrollZero = options.axis === 'x' ? options.content.x : options.content.y;
    this.viewportLength = options.axis === 'x' ? options.viewport.width : options.viewport.height;
    this.readout = options.readout;
    this.onScroll = options.onScroll;
    this.unclip = options.clip === false ? undefined : clipToRect(scene, options.content, options.viewport);

    for (const surface of options.inputSurfaces ?? []) {
      scene.input.setDraggable(surface);
      surface.on('dragstart', () => this.beginDrag());
      surface.on('drag', (pointer: Phaser.Input.Pointer) =>
        this.dragTo(this.axis === 'x' ? pointer.x - pointer.downX : pointer.y - pointer.downY),
      );
      surface.on('wheel', (pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number) =>
        this.scrollTo(this.offset - wheelPixels(pointer, deltaX, deltaY)),
      );
    }
  }

  /** 今の送り量（0が先頭、送るほど負）。 */
  get offset(): number {
    return (this.axis === 'x' ? this.content.x : this.content.y) - this.contentPositionAtScrollZero;
  }

  /**
   * 中身の長さを知らせる（送れる範囲を引き直す）。並びが変わるたびに呼ぶ。
   * 送り過ぎになっていれば、その場で範囲へ収める。
   */
  setContentLength(length: number): void {
    this.minOffset = minScrollFor(this.viewportLength, length);
    this.scrollTo(this.offset);
  }

  /** 送り量を可動範囲へ収めて反映する。 */
  scrollTo(offset: number): void {
    const clamped = clampScroll(offset, this.minOffset);
    if (this.axis === 'x') this.content.x = this.contentPositionAtScrollZero + clamped;
    else this.content.y = this.contentPositionAtScrollZero + clamped;

    this.onScroll?.(clamped);
    this.readout?.setScroll(clamped, this.minOffset);
  }

  /** ドラッグの始まり（今の送り量を基準として憶える）。 */
  beginDrag(): void {
    this.dragStart = this.offset;
  }

  /** beginDragの時点から測ったポインタの移動量（増分ではなく累積）を、送り量へ反映する。 */
  dragTo(distanceFromDragStart: number): void {
    this.scrollTo(this.dragStart + distanceFromDragStart);
  }

  destroy(): void {
    this.unclip?.();
  }
}
