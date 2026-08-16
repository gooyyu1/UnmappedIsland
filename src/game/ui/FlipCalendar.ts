import Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { cssColor } from '../../util/cssColor';
import { COLOR, FONT_FAMILY } from '../looks/theme';
import { drawBox } from '../../ui/shapes';

/** 桁の紙の画像のテクスチャキー（実体はsrc/assets/flip_digit.png、BootSceneが読む）。 */
export const FLIP_DIGIT_TEXTURE = 'flip-digit';

/**
 * 桁の画像の中の、紙の高さとその上に留具のリングが伸びる分（px）。flip_card.py の寸法と
 * 対応していなければならない（ずれるとリングが桁から浮く）。
 */
const IMAGE_PAPER_HEIGHT = 176;
const IMAGE_RING_OVERHEAD = 20;

/** 日数の桁・時刻の桁の寸法（ScreenLayout.md 2節 寸法トークン、縦型・横型共通）。 */
const DAY_DIGIT = { width: 64, height: 88, fontSize: 56 };
const TIME_DIGIT = { width: 44, height: 60, fontSize: 36 };

/** 桁と桁の間隔、日数ブロックと時刻ブロックの間隔。 */
const DIGIT_GAP = 2;
const BLOCK_GAP = 14;

/**
 * 時刻の「:」に確保する幅。字幅はフォントで変わるため実測せず固定で取る——実測すると表示全体の幅、
 * ひいてはダッシュボード列の幅がフォント依存になる。はみ出しても前後のDIGIT_GAPが吸収する。
 */
const COLON_WIDTH = 10;

/**
 * 日時のぶら下げ式フリップカード（ScreenLayout.md 1節）。
 * 各桁は上部の留具（リング）だけで吊り下げられ、台紙のような外枠は持たない。
 * タップは休息（Windows.md 4節）を選ぶ入口なので、押しボタンとして振る舞う。
 */
export class FlipCalendar extends Phaser.GameObjects.Container {
  /** 最も背の高い日数の桁が、この表示全体の高さになる。 */
  static height(metrics: ScreenMetrics): number {
    return metrics.px(DAY_DIGIT.height);
  }

  readonly contentWidth: number;

  /** 日数3桁・時刻4桁の数字。桁の並びは固定なので、値の差し替えは文字だけを書き換える。 */
  private readonly digits: Phaser.GameObjects.Text[] = [];

  constructor(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    y: number,
    elapsedDays: number,
    hour: number,
    minute: number,
    onTap?: () => void,
  ) {
    super(scene, x, y);

    this.contentWidth = this.build(scene, metrics);
    this.setTime(elapsedDays, hour, minute);

    // サイズを設定しない理由はButtonのヒット領域についてのコメントを参照。
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.contentWidth, metrics.px(DAY_DIGIT.height)),
      Phaser.Geom.Rectangle.Contains,
    );
    this.on('pointerup', () => onTap?.());

    scene.add.existing(this);
  }

  /** 表示する日時を差し替える。時間の経過を実時間で見せるため、毎フレーム呼ばれうる。 */
  setTime(elapsedDays: number, hour: number, minute: number): void {
    const value =
      String(Math.min(elapsedDays, 999)).padStart(3, '0') +
      String(hour).padStart(2, '0') +
      String(minute).padStart(2, '0');
    this.digits.forEach((digit, index) => digit.setText(value[index]));
  }

  /**
   * 桁の枠を左から並べ、占有した幅を返す（数字の中身はsetTimeが入れる）。
   *
   * 日数の側に単位のラベルは置かない。日数の桁は時刻の桁より大きく、時刻の側だけが「:」を持つので、
   * 大小と区切りだけで読み分けられる——文字を持たなければ翻訳も要らず、幅も設計値だけで決まる。
   */
  private build(scene: Phaser.Scene, metrics: ScreenMetrics): number {
    const height = metrics.px(DAY_DIGIT.height);
    let cursor = 0;

    for (let i = 0; i < 3; i++) {
      this.addDigit(scene, metrics, cursor, height, DAY_DIGIT);
      cursor += metrics.px(DAY_DIGIT.width + DIGIT_GAP);
    }

    cursor += metrics.px(BLOCK_GAP);
    for (let i = 0; i < 4; i++) {
      this.addDigit(scene, metrics, cursor, height, TIME_DIGIT);
      cursor += metrics.px(TIME_DIGIT.width + DIGIT_GAP);
      if (i === 1) cursor += this.addColon(scene, metrics, cursor, height);
    }
    return cursor - metrics.px(DIGIT_GAP);
  }

  private addDigit(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    blockHeight: number,
    size: { width: number; height: number; fontSize: number },
  ): void {
    const width = metrics.px(size.width);
    const height = metrics.px(size.height);
    // 日数と時刻は桁の高さが違うため、背の高い日数の桁を基準に下端で揃える。中央で揃えると、
    // 小さい時刻の桁が宙に浮いて見える。
    const top = blockHeight - height;

    const card = addCardPaper(scene, metrics, x, top, width, height);

    const text = scene.add
      .text(x + width / 2, top + height / 2, '', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(size.fontSize)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0.5);

    this.add([card, text]);
    this.digits.push(text);
  }

  /**
   * 時・分の間の「:」。確保した幅（COLON_WIDTH）の中央へ置き、占有した幅（後ろの間隔込み）を返す。
   * 高さは時刻の桁の中央に合わせる（桁は下端で揃うので、ブロックの中央とは一致しない）。
   */
  private addColon(scene: Phaser.Scene, metrics: ScreenMetrics, x: number, blockHeight: number): number {
    const width = metrics.px(COLON_WIDTH);
    const text = scene.add
      .text(x + width / 2, blockHeight - metrics.px(TIME_DIGIT.height) / 2, ':', {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(32)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0.5);
    this.add(text);
    return width + metrics.px(DIGIT_GAP);
  }
}

/**
 * 桁の紙と留具。画像（FLIP_DIGIT_TEXTURE）があればそれを貼り、無ければ図形で描く
 * （Card.addFrameと同じ流儀）。画像には留具の穴・リング・落ち影まで描き込まれていて、
 * 紙の部分が指定の矩形に一致し、リングはその上へはみ出す。
 */
function addCardPaper(
  scene: Phaser.Scene,
  metrics: ScreenMetrics,
  x: number,
  top: number,
  width: number,
  height: number,
): Phaser.GameObjects.GameObject {
  if (scene.textures.exists(FLIP_DIGIT_TEXTURE)) {
    const overhead = (height * IMAGE_RING_OVERHEAD) / IMAGE_PAPER_HEIGHT;
    return scene.add
      .image(x, top - overhead, FLIP_DIGIT_TEXTURE)
      .setOrigin(0, 0)
      .setDisplaySize(width, height + overhead);
  }

  // フォールバックの図形。白い紙は明るい地に溶けるため縁の線で輪郭を確保する。
  // リングのCSSはborder-box指定なので、線幅の中心は外径14uから線幅3uを引いた半径になる。
  const card = scene.add.graphics();
  drawBox(
    card,
    { x, y: top, width, height },
    {
      fill: COLOR.flipDigit,
      border: COLOR.flipDigitRing,
      borderWidth: Math.max(1, metrics.px(1)),
      radius: metrics.px(6),
    },
  );
  const ringRadius = metrics.px((14 - 3) / 2);
  card.lineStyle(metrics.px(3), COLOR.flipDigitRing, 1);
  card.strokeCircle(x + metrics.px(13), top - metrics.px(1), ringRadius);
  card.strokeCircle(x + width - metrics.px(13), top - metrics.px(1), ringRadius);
  return card;
}
