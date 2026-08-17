import Phaser from 'phaser';
import type { Rect } from '../../ui/Rect';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import type { CardContent } from './Card';
import { Card, EmptyCard } from './Card';
import { cardFace } from './cardFace';
import { clipToRect } from '../../ui/clip';
import { CONTENT_GAP } from '../looks/childWindowLayout';
import { ProgressBar } from './ProgressBar';
import { addLabel } from '../../ui/labels';
import { wheelPixels } from '../../ui/scroll';
import { ScrollIndicator } from './ScrollIndicator';
import { addPanel } from '../../ui/shapes';
import { COLOR, SIZE } from '../looks/theme';
import { wrapByCharacter } from '../../ui/textLayout';

/** 探索の進み具合を示すバーの高さ（ゲームの主操作なので、ステータスバーより大きく取る）。 */
const BAR_HEIGHT = 72;

/** 発見物の枠の数。1枠はレーンのカードと同じ幅。 */
const FOUND_SLOTS = 4;

/** 発見物の枠に出す1枚。 */
export interface FoundCard {
  /** 見た目だけのカード（操作は持たない）。見つかった個数は`count`が言う。 */
  readonly card: CardContent;
  /**
   * まだ現在地の札から運んでくる途中か。**運んでいる間その1枚はどこの枠にも居ない**
   * （CardInteraction.md 6.2節）ので、着くまで伏せておく。
   */
  readonly arriving: boolean;
}

/** 探索のタブに出すもの。 */
export interface ExplorationContent {
  /** 探索率（0〜1）。 */
  readonly ratio: number;

  /**
   * 直前の探索で見つかったもの（アイテムと道）。枠に収まらない分は横スクロールで見る。
   *
   * **ここに在る札は本物**——見つかったものはまずこの枠へ入り、窓を閉じるか次の探索を始めた時点で
   * 本来の場所へ帰る（Windows.md 5.1節）。そのあいだレーンには並ばない。
   */
  readonly found: readonly FoundCard[];
}

/**
 * オブジェクトウィンドウの探索のタブ（Windows.md 5節）。発見物の枠・探索率のバー・補足の1行を持つ。
 *
 * **「探索する」ボタンは持ちません。** 探索は現在地が宣言しているアクション（`explore`）なので、
 * 最下段の操作の行に他のアクションと並びます——画面の都合で足したボタンと、宣言から来たボタンを
 * 分けないためです。
 */
export class ExplorationPane {
  /**
   * この面が要る幅。**発見物の4枠ぶん**で、窓の幅はこれを下回らない（Windows.md 5節）。
   * 枠は縮めない——レーンから来てレーンへ帰る札そのものなので、大きさが変わると別の札に見える。
   */
  static width(metrics: ScreenMetrics): number {
    return metrics.px(SIZE.cardWidth) * FOUND_SLOTS + metrics.px(SIZE.gap) * (FOUND_SLOTS - 1);
  }

  /** この面が要る高さ。窓の中段の高さは、最も高いタブに合わせて決まる（ObjectWindow）。 */
  static height(metrics: ScreenMetrics): number {
    return (
      metrics.px(SIZE.cardHeight) +
      cardPaddingOf(metrics) +
      metrics.px(CONTENT_GAP) +
      metrics.px(BAR_HEIGHT) +
      metrics.px(CONTENT_GAP) +
      metrics.px(NOTE_HEIGHT)
    );
  }

  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  /** 発見物の並びの切り抜きを解く後始末（送る必要があるときだけ持つ、clip.ts参照）。 */
  private unclip: (() => void) | undefined;

  /** 発見物の枠の並び（左端・上端・送り幅と枠の寸法）と、今の送り量。addFoundが必ず設定する。 */
  private foundLayout!: { x: number; y: number; pitch: number; width: number; height: number };
  private foundScrollX = 0;

  /** 発見物の枠に並べた札（空き枠はundefined）。運んでいる途中の1枚を表に出すために持つ。 */
  private foundCards: (Card | undefined)[] = [];

  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, area: Rect, content: ExplorationContent) {
    const gap = metrics.px(CONTENT_GAP);
    const barHeight = metrics.px(BAR_HEIGHT);
    const foundHeight = metrics.px(SIZE.cardHeight);
    // カードの下は、レーンのカードの余白と同じだけ空けてスクロールバーの場所にする
    // （ScreenLayout.md 7.4節）。送る必要が無い間は空くが、見つかった件数で寸法は変わらない。
    const cardPadding = cardPaddingOf(metrics);
    const centerX = area.x + area.width / 2;

    this.addFound(scene, metrics, content.found, {
      x: area.x,
      y: area.y,
      width: area.width,
      height: foundHeight,
    });

    let cursorY = area.y + foundHeight + cardPadding + gap;
    this.objects.push(
      new ProgressBar(scene, metrics, area.x, cursorY, area.width, barHeight, content.ratio),
      addLabel(scene, metrics, centerX, cursorY + barHeight / 2, percentOf(content.ratio), {
        size: 32,
        bold: true,
      }).setOrigin(0.5),
    );

    cursorY += barHeight + gap;
    const note = addLabel(scene, metrics, centerX, cursorY, noteFor(content.ratio), {
      size: 24,
      color: COLOR.textMuted,
    })
      .setOrigin(0.5, 0)
      .setAlign('center');
    note.setWordWrapCallback(wrapByCharacter(area.width));
    this.objects.push(note);
  }

  /**
   * 見つかったものを並べる枠。枠はFOUND_SLOTS個で固定し、収まらない分は横スクロールで送る。
   * 枠からはみ出したカードは、レーンと違って背景板では隠せないのでマスクで切り抜く。
   *
   * **カードはレーンと同じ寸法のまま縮めない。** ここに並ぶのはレーンから来て、レーンへ帰っていく
   * 札そのもの（Windows.md 5.1節）なので、大きさが変わると別の札に見える。4枠ぶんの幅が無い画面では、
   * 縮める代わりに横スクロールで送る。
   */
  private addFound(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    found: readonly FoundCard[],
    viewport: Rect,
  ): void {
    const gap = metrics.px(SIZE.gap);
    const slotWidth = metrics.px(SIZE.cardWidth);
    const pitch = slotWidth + gap;
    this.foundLayout = {
      x: viewport.x,
      y: viewport.y,
      pitch,
      width: slotWidth,
      height: metrics.px(SIZE.cardHeight),
    };

    const strip = scene.add.container(viewport.x, viewport.y);
    this.objects.push(strip);
    this.foundCards = [];
    for (let i = 0; i < Math.max(FOUND_SLOTS, found.length); i++) {
      const entry = found[i];
      if (entry === undefined) {
        strip.add(new EmptyCard(scene, metrics, 0, 0).setPosition(i * pitch, 0));
        this.foundCards.push(undefined);
        continue;
      }

      const card = new Card(scene, metrics, 0, 0, { ...cardFace(entry.card), count: entry.card.count });
      strip.add(card.setPosition(i * pitch, 0).setVisible(!entry.arriving));
      this.foundCards.push(card);
    }

    const contentWidth = Math.max(FOUND_SLOTS, found.length) * pitch - gap;
    const minScrollX = Math.min(0, viewport.width - contentWidth);
    if (minScrollX === 0) return;

    // 送る必要があるときだけ、枠からはみ出す分を切り抜く（clip.ts参照）。
    this.unclip = clipToRect(scene, strip, viewport);

    // バーはカードの下に空けてある余白（cardPadding）の上寄せに置く。
    const indicator = new ScrollIndicator(
      scene,
      metrics,
      viewport.x,
      viewport.y + viewport.height + metrics.px(SIZE.scrollBarGap),
      viewport.width,
    );
    this.objects.push(indicator);

    const scrollTo = (scrollX: number): void => {
      const clamped = Phaser.Math.Clamp(scrollX, minScrollX, 0);
      strip.x = viewport.x + clamped;
      this.foundScrollX = clamped;
      indicator.setScroll(clamped, minScrollX);
    };
    scrollTo(0);

    let scrollStartX = 0;
    const surface = addPanel(scene, viewport, COLOR.cardFace, 0);
    this.objects.push(surface);
    scene.input.setDraggable(surface);
    surface.on('dragstart', () => {
      scrollStartX = strip.x - viewport.x;
    });
    surface.on('drag', (pointer: Phaser.Input.Pointer) =>
      scrollTo(scrollStartX + (pointer.x - pointer.downX)),
    );
    surface.on('wheel', (pointer: Phaser.Input.Pointer, deltaX: number, deltaY: number) => {
      scrollTo(strip.x - viewport.x - wheelPixels(pointer, deltaX, deltaY));
    });
  }

  /**
   * 発見物の枠（添字の位置）。運んでくる先であり、返すときの出発点でもある。**捨てたあとも答える**
   * ——タブを移るか窓を閉じた時点で本来の場所へ帰す（Windows.md 5.1節）ので、そこから飛ばす必要がある。
   */
  foundRect(index: number): Rect {
    const layout = this.foundLayout;
    return {
      x: layout.x + this.foundScrollX + index * layout.pitch,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    };
  }

  /** 運んできた1枚が枠に着いた（伏せていた札を表に出す）。 */
  showFound(index: number): void {
    this.foundCards[index]?.setVisible(true);
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
    this.foundCards = [];
    this.unclip?.();
    this.unclip = undefined;
  }
}

/** 補足の1行が占める高さ（u単位）。**件数によらず窓の寸法を変えない**ため、2行ぶんで決め打つ。 */
const NOTE_HEIGHT = 68;

/** カードの下に空ける余白（レーンのカードの上下の余白と同じ）。スクロールバーの場所になる。 */
function cardPaddingOf(metrics: ScreenMetrics): number {
  return metrics.px((SIZE.laneHeight - SIZE.cardHeight) / 2);
}

/** 探索率は整数の%で見せる。100%に届いていない進捗を切り上げて100%と誤解させないよう切り捨てる。 */
function percentOf(ratio: number): string {
  return `${Math.min(100, Math.trunc(ratio * 100))}%`;
}

function noteFor(ratio: number): string {
  return ratio >= 1
    ? 'この土地に隠された道はすべて見つけた。探索を続ければ、まだ何かは見つかる。'
    : '探索を続けると、アイテムや他の土地へ続く道が見つかる。';
}
