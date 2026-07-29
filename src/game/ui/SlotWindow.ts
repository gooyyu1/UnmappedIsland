import type Phaser from 'phaser';
import type { Rect, ScreenMetrics } from '../layout/ScreenMetrics';
import { addTextButton } from './Button';
import type { CardContent } from './Card';
import { CardLane } from './CardLane';
import { ACTION_HEIGHT, ACTION_MAX_WIDTH, CONTENT_GAP, WINDOW_PADDING, centerWindow } from './childWindow';
import { addLabel } from './labels';
import { addPanel, drawBox } from './shapes';
import { COLOR, SIZE } from './theme';
import { wrapByCharacter } from './textLayout';

/** 中身が空でも保つ枠の数。1枚も無いときにウィンドウが潰れないようにするための最小幅。 */
const MIN_SLOTS = 4;

export interface SlotWindowOptions {
  /** ウィンドウの見出し（「装備」「怪我」、コンテナなら容器の名前）。 */
  readonly title: string;

  /** 並べるカード。枠数は固定ではなく、はみ出した分は横スクロールで送る。 */
  readonly cards: readonly (CardContent | undefined)[];

  /**
   * ウィンドウを収める領域。ハンドレーンを含まない領域を渡す（ScreenLayout.md スロットの子ウィンドウ節）。
   * 手持ちとカードをやり取りする操作があるため、手持ちは開いている間も見えている必要がある。
   */
  readonly area: Rect;

  /**
   * このスロットがカードを受け入れるか。受け入れる場合だけ、並びの末尾に受け皿の空枠を出す
   * （中身が空でも落とせる場所だと分かるように、CardLaneOptions.trailingPlaceholder）。
   */
  readonly acceptsCards: boolean;

  readonly onClose: () => void;
}

/**
 * 1つのスロットの中身をカードで見せる子ウィンドウ（ScreenLayout.md スロットの子ウィンドウ節）。
 * 装備・怪我に加えて、今後のコンテナ（箱・かご）の中身も同じ形で見せる。
 *
 * 中身の並びはレーン（CardLane）そのものなので、横スクロール・ドラッグ＆ドロップ・並び替えは
 * レーン間と同じ仕組みで動く。開いている間は呼び出し側がこのレーンをドラッグの対象へ加える。
 */
export class SlotWindow {
  /** 中身の並び。ドラッグの対象として呼び出し側（PlayScene）が受け取る。 */
  readonly lane: CardLane;

  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, options: SlotWindowOptions) {
    // 覆いは領域の中だけに敷く。画面全体を覆うと、開いている間も操作できるはずの手持ちが
    // 覆いに入力を吸われてしまうため（探索ウィンドウと違い、こちらは外とやり取りする）。
    this.objects.push(addPanel(scene, options.area, COLOR.modalOverlay, 0.5));

    const padding = metrics.px(WINDOW_PADDING);
    const gap = metrics.px(CONTENT_GAP);
    const actionHeight = metrics.px(ACTION_HEIGHT);
    const laneHeight = metrics.px(SIZE.laneHeight);

    // 横幅は中身の枚数で決める。少ないときに間延びせず、多いときは領域いっぱいまで広げて
    // 見える枚数を増やす（それでも収まらない分はレーンの横スクロールで送る）。
    const slots = Math.max(MIN_SLOTS, options.cards.length);
    const contentWidth = slots * metrics.px(SIZE.cardWidth) + (slots - 1) * metrics.px(SIZE.gap);
    const windowWidth = Math.min(contentWidth + padding * 2, options.area.width, metrics.width * 0.92);

    // 台紙は寸法が決まる前に作る。表示順は生成順で決まるため、後から作る文字より先に置く必要がある。
    const card = scene.add.graphics();
    this.objects.push(card);

    const title = addLabel(scene, metrics, 0, 0, options.title, { size: 34, bold: true })
      .setOrigin(0.5, 0)
      .setAlign('center');
    title.setWordWrapCallback(wrapByCharacter(windowWidth - padding * 2));

    const windowHeight = padding * 2 + title.height + gap + laneHeight + gap + actionHeight;
    const window = centerWindow(metrics, options.area, windowWidth, windowHeight);
    const centerX = window.x + windowWidth / 2;
    drawBox(card, window, { fill: COLOR.cardFace, radius: metrics.px(SIZE.radius) });

    title.setPosition(centerX, window.y + padding);
    this.objects.push(title);

    const laneY = window.y + padding + title.height + gap;
    this.lane = new CardLane(
      scene,
      metrics,
      { x: window.x + padding, y: laneY, width: windowWidth - padding * 2, height: laneHeight },
      COLOR.slotWindowLane,
      options.cards,
      { clip: true, trailingPlaceholder: options.acceptsCards },
    );

    this.objects.push(
      addTextButton(
        scene,
        metrics,
        {
          x: centerX - Math.min(metrics.px(ACTION_MAX_WIDTH), windowWidth - padding * 2) / 2,
          y: laneY + laneHeight + gap,
          width: Math.min(metrics.px(ACTION_MAX_WIDTH), windowWidth - padding * 2),
          height: actionHeight,
        },
        '閉じる',
        { fill: COLOR.button },
        () => {
          this.close();
          options.onClose();
        },
      ),
    );
  }

  close(): void {
    this.lane.destroy();
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }
}
