import Phaser from 'phaser';
import type { ScreenMetrics } from '../looks/ScreenMetrics';
import { skyTintFor } from '../looks/skyTint';
import { COLOR } from '../looks/theme';

/**
 * 日射に応じて画面全体へかぶせる翳り・輝き（ScreenLayout.md 7.5節 空の演出）。見え方はskyTint.tsが
 * 決め、こちらは「その通りに描く」ことだけを行う。
 *
 * 入力は遮らない（下のカードもボタンもそのまま操作できる）。ほぼ全ての表示物より手前へ出す必要が
 * あるため、depthは置く側が与える（PlayScene参照）。
 *
 * **フィルタを使わない。** 薄い色の矩形を1枚重ねるだけなので、画面全体へ広げても持ち物は増えない
 * （[DesignNotes.md](../../../docs/engine/DesignNotes.md)）。
 */
export class ScreenSkyTint extends Phaser.GameObjects.Rectangle {
  constructor(scene: Phaser.Scene, metrics: ScreenMetrics, sunlight: number | undefined) {
    super(scene, metrics.width / 2, metrics.height / 2, metrics.width, metrics.height, COLOR.skyShade, 1);

    scene.add.existing(this);
    this.setSunlight(sunlight);
  }

  /** 今の日射に合わせてかぶせ直す。かぶせるものが無ければ隠す。 */
  setSunlight(sunlight: number | undefined): void {
    const tint = skyTintFor(sunlight);
    if (tint === undefined) {
      this.setVisible(false);
      return;
    }

    this.setVisible(true)
      .setFillStyle(tint.color, 1)
      .setAlpha(tint.alpha)
      .setBlendMode(tint.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
  }
}
