import Phaser from 'phaser';
import type { ScreenMetrics } from '../layout/ScreenMetrics';
import { COLOR, FONT_FAMILY, cssColor } from './theme';

/** 日数の桁・時刻の桁の寸法（ScreenLayout.md 寸法トークン節、縦型・横型共通）。 */
const DAY_DIGIT = { width: 64, height: 88, fontSize: 56 };
const TIME_DIGIT = { width: 44, height: 60, fontSize: 36 };

/** 桁と桁の間隔、日数ブロックと時刻ブロックの間隔。 */
const DIGIT_GAP = 8;
const BLOCK_GAP = 28;

/**
 * 日時のぶら下げ式フリップカード（ScreenLayout.md 設計原則）。
 * 各桁は上部の留具（リング）だけで吊り下げられ、台紙のような外枠は持たない。
 * タップで時間経過アクションを選ぶ入口になる想定のため、押しボタンとして振る舞う。
 */
export class FlipCalendar extends Phaser.GameObjects.Container {
  /** 最も背の高い日数の桁が、この表示全体の高さになる。 */
  static height(metrics: ScreenMetrics): number {
    return metrics.px(DAY_DIGIT.height);
  }

  readonly contentWidth: number;

  private readonly metrics: ScreenMetrics;

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
    this.metrics = metrics;

    this.contentWidth = this.draw(elapsedDays, hour, minute);

    // サイズを設定しない理由はButtonのヒット領域についてのコメントを参照。
    this.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, this.contentWidth, metrics.px(DAY_DIGIT.height)),
      Phaser.Geom.Rectangle.Contains,
    );
    this.on('pointerup', () => onTap?.());

    scene.add.existing(this);
  }

  /**
   * 表示する日時を差し替える。桁数は固定（日数3桁・時刻4桁）なので、書き直しても幅は変わらない。
   */
  setTime(elapsedDays: number, hour: number, minute: number): void {
    this.removeAll(true);
    this.draw(elapsedDays, hour, minute);
  }

  /** 桁とラベルを左から並べ、占有した幅を返す。 */
  private draw(elapsedDays: number, hour: number, minute: number): number {
    const scene = this.scene;
    const metrics = this.metrics;
    const height = metrics.px(DAY_DIGIT.height);
    let cursor = 0;

    const days = String(Math.min(elapsedDays, 999)).padStart(3, '0');
    for (const digit of days) {
      this.addDigit(scene, metrics, cursor, height, digit, DAY_DIGIT);
      cursor += metrics.px(DAY_DIGIT.width + DIGIT_GAP);
    }
    cursor += this.addLabel(scene, metrics, cursor, height, '日目', 26);

    cursor += metrics.px(BLOCK_GAP);
    const time = `${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
    for (let i = 0; i < time.length; i++) {
      this.addDigit(scene, metrics, cursor, height, time[i], TIME_DIGIT);
      cursor += metrics.px(TIME_DIGIT.width + DIGIT_GAP);
      if (i === 1) cursor += this.addLabel(scene, metrics, cursor, height, ':', 32);
    }
    return cursor - metrics.px(DIGIT_GAP);
  }

  private addDigit(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    blockHeight: number,
    digit: string,
    size: { width: number; height: number; fontSize: number },
  ): void {
    const width = metrics.px(size.width);
    const height = metrics.px(size.height);
    // 日数と時刻は桁の高さが違うため、背の高い日数の桁を基準に上下中央へ揃える。
    const top = (blockHeight - height) / 2;

    const card = scene.add.graphics();
    card.fillStyle(COLOR.flipDigit, 1);
    card.fillRoundedRect(x, top, width, height, metrics.px(6));

    // 留具のリング。CSSはborder-box指定なので、線幅の中心は外径14uから線幅3uを引いた半径になる。
    const ringRadius = metrics.px((14 - 3) / 2);
    card.lineStyle(metrics.px(3), COLOR.flipDigitRing, 1);
    card.strokeCircle(x + metrics.px(13), top - metrics.px(1), ringRadius);
    card.strokeCircle(x + width - metrics.px(13), top - metrics.px(1), ringRadius);

    const text = scene.add
      .text(x + width / 2, top + height / 2, digit, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(size.fontSize)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.textOnDark),
      })
      .setOrigin(0.5);

    this.add([card, text]);
  }

  /** 「日目」「:」のような桁と桁の間のラベル。占有した幅（前後の間隔込み）を返す。 */
  private addLabel(
    scene: Phaser.Scene,
    metrics: ScreenMetrics,
    x: number,
    blockHeight: number,
    content: string,
    fontSize: number,
  ): number {
    const text = scene.add
      .text(x, blockHeight / 2, content, {
        fontFamily: FONT_FAMILY,
        fontSize: `${metrics.fontPx(fontSize)}px`,
        fontStyle: 'bold',
        color: cssColor(COLOR.text),
      })
      .setOrigin(0, 0.5);
    this.add(text);
    return text.width + metrics.px(DIGIT_GAP);
  }
}
